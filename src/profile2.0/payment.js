// ============================================================
// payment.js — M03 결제 모듈 (Cloudflare Worker 핸들러)
// 저장위치: gopang/src/profile2.0/payment.js
// 의존: src/auth/auth.js (verifyJWT, requireAuth)
// 기존 worker.js의 handleBizOrder()를 이 파일로 대체
// ============================================================

// ─────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────
const L1_BASE         = 'http://168.110.123.175:8091';
const L1_TIMEOUT_MS   = 5000;          // 5초 타임아웃 (P09)
const PLATFORM_GUID   = 'gopang-platform';
const FEE_RATE        = 0.005;         // 0.5% 수수료
const CLAIM_TTL_DAYS  = 7;             // buyer_claim 만료 7일 (T08)
const FS_SOURCE       = 'market';      // fs_ledger source 고정 ('kmarket' 금지, P05)

// ─────────────────────────────────────────────
// QR 만료 검증 (BUG-C2, P02)
// created_at: Unix timestamp (초)
// expires: 초 단위 유효시간
// ─────────────────────────────────────────────
function isQRExpired(created_at, expires) {
  const elapsed = Math.floor(Date.now() / 1000) - Number(created_at);
  return elapsed > Number(expires);
}

// ─────────────────────────────────────────────
// tx_id 생성 — 중복 방지용 고유 식별자
// ─────────────────────────────────────────────
async function makeTxId(buyerGuid, amount, createdAt) {
  const raw = `${buyerGuid}:${amount}:${createdAt}:${Date.now()}`;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return 'tx-' + [...new Uint8Array(buf)]
    .map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

// ─────────────────────────────────────────────
// buyer_claim 생성 (T08 설계)
// ─────────────────────────────────────────────
function makeBuyerClaim({ amount, balanceAfter, blockHash, txHash }) {
  return {
    direction:     'debit',
    amount,
    fs_account:    'bs-cash',
    pl_account:    'pl-purchase',
    balance_after: balanceAfter,
    block_hash:    blockHash,
    tx_hash:       txHash,
    expires_at:    new Date(Date.now() + CLAIM_TTL_DAYS * 86400_000).toISOString(),
  };
}

// ─────────────────────────────────────────────
// seller_claim 생성 (T08 설계)
// ─────────────────────────────────────────────
function makeSellerClaim({ amount, blockHash, txHash }) {
  return {
    direction:  'credit',
    amount,
    fs_account: 'bs-cash',
    pl_account: 'pl-revenue',
    block_hash: blockHash,
    tx_hash:    txHash,
    expires_at: new Date(Date.now() + CLAIM_TTL_DAYS * 86400_000).toISOString(),
  };
}

// ─────────────────────────────────────────────
// L1 트랜잭션 전송 (타임아웃 포함, P09)
// ─────────────────────────────────────────────
async function postToL1(txPayload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), L1_TIMEOUT_MS);
  try {
    const res = await fetch(`${L1_BASE}/api/tx`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(txPayload),
      signal:  controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`L1_HTTP_${res.status}`);
    return await res.json();
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('L1_TIMEOUT');
    throw e;
  }
}

// ─────────────────────────────────────────────
// Supabase 공통 fetch
// ─────────────────────────────────────────────
function sbHeaders(key) {
  return {
    apikey:          key,
    Authorization:   `Bearer ${key}`,
    'Content-Type':  'application/json',
    Prefer:          'return=representation',
  };
}
async function sbInsert(supabaseUrl, key, table, data, prefer = 'return=representation') {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
    method:  'POST',
    headers: { ...sbHeaders(key), Prefer: prefer },
    body:    JSON.stringify(data),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SUPABASE_${table.toUpperCase()}_ERROR: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
async function sbRpc(supabaseUrl, key, fn, params) {
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
    method:  'POST',
    headers: sbHeaders(key),
    body:    JSON.stringify(params),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SUPABASE_RPC_${fn}_ERROR: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

// ─────────────────────────────────────────────
// 잔액 조회 — user_profiles.extra.fs.bs-cash
// ─────────────────────────────────────────────
async function getBalance(supabaseUrl, key, guid) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/user_profiles?guid=eq.${encodeURIComponent(guid)}&select=extra`,
    { headers: sbHeaders(key) }
  );
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  return Number(rows[0]?.extra?.fs?.['bs-cash'] ?? 0);
}

// ─────────────────────────────────────────────
// fs_ledger 3행 원자 INSERT (M10 위임 패턴)
// T07 계정 과목 규칙:
//   bs-cash    = Σcredit - Σdebit (순변동분)
//   pl-purchase = Σdebit (양수 누적)
//   pl-revenue  = Σcredit (양수 누적)
// ─────────────────────────────────────────────
async function insertFsLedger(supabaseUrl, key, { txId, blockHash, buyerGuid, sellerGuid, amount, fee, txAt }) {
  const sellerAmount = amount - fee;
  const rows = [
    // 행1: buyer debit (bs-cash 차감)
    {
      tx_id: txId, block_hash: blockHash, guid: buyerGuid,
      direction: 'debit',  amount,        fs_account: 'bs-cash',
      pl_account: 'pl-purchase', source: FS_SOURCE, tx_at: txAt,
    },
    // 행2: seller credit (bs-cash + pl-revenue 증가)
    {
      tx_id: txId, block_hash: blockHash, guid: sellerGuid,
      direction: 'credit', amount: sellerAmount, fs_account: 'bs-cash',
      pl_account: 'pl-revenue', source: FS_SOURCE, tx_at: txAt,
    },
    // 행3: platform credit (수수료)
    {
      tx_id: txId, block_hash: blockHash, guid: PLATFORM_GUID,
      direction: 'credit', amount: fee,   fs_account: 'bs-cash',
      pl_account: 'pl-revenue', source: FS_SOURCE, tx_at: txAt,
    },
  ];
  return await sbInsert(supabaseUrl, key, 'fs_ledger', rows,
    'resolution=ignore-duplicates,return=minimal');
}

// ─────────────────────────────────────────────
// POST /biz/order — 핵심 결제 핸들러
// ─────────────────────────────────────────────
async function handleBizOrder(request, env, corsHeaders) {
  // 환경변수 체크
  if (!env.GOPANG_MASTER_KEY) return _err(500, 'SERVER_CONFIG_ERROR', 'GOPANG_MASTER_KEY 미등록', corsHeaders);

  // JWT 검증 (M01)
  const authResult = await requireAuth(request, env.GOPANG_MASTER_KEY);
  if (authResult instanceof Response) return authResult;
  const buyer = authResult; // { guid, name, lang, type }

  let body;
  try { body = await request.json(); } catch {
    return _err(400, 'INVALID_JSON', '요청 본문이 올바르지 않습니다.', corsHeaders);
  }

  const { to, amount, items = [], created_at, expires = 300 } = body;

  // 필수 필드 검증
  if (!to || !amount || !created_at) {
    return _err(400, 'MISSING_FIELD', 'to, amount, created_at 필수', corsHeaders);
  }
  if (Number(amount) <= 0) {
    return _err(400, 'INVALID_AMOUNT', 'amount > 0 이어야 합니다.', corsHeaders);
  }

  // P02: QR 만료 검증 (서버 측)
  if (isQRExpired(created_at, expires)) {
    return _err(409, 'QR_EXPIRED', 'QR 코드가 만료되었습니다.', corsHeaders);
  }

  const SUPA_URL = `https://${env.SUPABASE_PROJECT_ID}.supabase.co`;

  try {
    // 판매자 GUID 조회
    const sellerRes = await fetch(
      `${SUPA_URL}/rest/v1/user_profiles?handle=eq.${encodeURIComponent(to)}&select=guid,name`,
      { headers: sbHeaders(env.SUPABASE_KEY) }
    );
    const sellers = await sellerRes.json();
    if (!Array.isArray(sellers) || sellers.length === 0) {
      return _err(404, 'SELLER_NOT_FOUND', `업체를 찾을 수 없습니다: ${to}`, corsHeaders);
    }
    const sellerGuid = sellers[0].guid;

    // P03: 잔액 확인
    const balance = await getBalance(SUPA_URL, env.SUPABASE_KEY, buyer.guid);
    if (balance < Number(amount)) {
      return _err(402, 'INSUFFICIENT_BALANCE',
        `잔액 부족: 현재 ₮${balance.toLocaleString()}, 필요 ₮${Number(amount).toLocaleString()}`,
        corsHeaders);
    }

    // tx_id 생성
    const txAt  = new Date().toISOString();
    const txId  = await makeTxId(buyer.guid, amount, created_at);
    const fee   = Math.ceil(Number(amount) * FEE_RATE);

    // L1 전송 (P09: 타임아웃 5초)
    const txPayload = {
      tx_id:           txId,
      buyer_guid:      buyer.guid,
      seller_guid:     sellerGuid,
      amount:          Number(amount),
      fee,
      items,
      balance_claimed: balance,
      ts:              txAt,
    };

    let l1Result;
    try {
      l1Result = await postToL1(txPayload);
    } catch (e) {
      if (e.message === 'L1_TIMEOUT') {
        return _err(504, 'L1_TIMEOUT', 'L1 노드 응답 없음 (5초 초과)', corsHeaders);
      }
      return _err(502, 'L1_ERROR', e.message, corsHeaders);
    }

    const { block_id, block_hash, height } = l1Result;
    const txHash = txId; // tx_hash = tx_id (L1 응답에 없으므로 동일 사용)

    // T08: buyer_claim / seller_claim Worker 직접 생성 (L1은 반환하지 않음)
    const balanceAfter = balance - Number(amount);
    const buyer_claim  = makeBuyerClaim({ amount: Number(amount), balanceAfter, blockHash: block_hash, txHash });
    const seller_claim = makeSellerClaim({ amount: Number(amount) - fee, blockHash: block_hash, txHash });

    // fs_ledger 3행 원자 INSERT (M10)
    await insertFsLedger(SUPA_URL, env.SUPABASE_KEY, {
      txId, blockHash: block_hash, buyerGuid: buyer.guid,
      sellerGuid, amount: Number(amount), fee, txAt,
    });

    // l1_ledger INSERT
    await sbInsert(SUPA_URL, env.SUPABASE_KEY, 'l1_ledger', {
      tx_id:           txId,
      block_id,
      block_hash,
      height,
      buyer_guid:      buyer.guid,
      balance_claimed: String(balance),
      anchored_at:     txAt,
    }, 'resolution=ignore-duplicates,return=minimal');

    // biz_orders INSERT (P10: tx_id UNIQUE 중복 방지)
    try {
      await sbInsert(SUPA_URL, env.SUPABASE_KEY, 'biz_orders', {
        tx_id:       txId,
        buyer_guid:  buyer.guid,
        seller_guid: sellerGuid,
        amount:      Number(amount),
        fee,
        items:       JSON.stringify(items),
        block_hash,
        status:      'completed',
        created_at:  txAt,
      }, 'resolution=ignore-duplicates,return=minimal');
    } catch (e) {
      if (e.message.includes('23505') || e.message.includes('UNIQUE')) {
        return _err(409, 'DUPLICATE_ORDER', '이미 처리된 주문입니다.', corsHeaders);
      }
      throw e;
    }

    // PDV 기록 (M11 — resolution=ignore-duplicates 필수)
    await sbInsert(SUPA_URL, env.SUPABASE_KEY, 'pdv_log', {
      session_id:       txId,
      reporter_guid:    buyer.guid,
      reporter_svc:     'market',
      what:             JSON.stringify({ tx_id: txId, amount, items }),
      chain_local_hash: block_hash,
      recorded_at:      txAt,
    }, 'resolution=ignore-duplicates,return=minimal');

    // GWP_DONE payload 반환
    return new Response(JSON.stringify({
      ok:           true,
      tx_id:        txId,
      block_id,
      block_hash,
      height,
      buyer_claim,
      seller_claim,
      fee,
      amount:       Number(amount),
      balance_after: balanceAfter,
    }), {
      status:  200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    return _err(500, 'PAYMENT_ERROR', e.message, corsHeaders);
  }
}

// ─────────────────────────────────────────────
// 공통 유틸
// ─────────────────────────────────────────────
function _err(status, code, message, corsHeaders) {
  return new Response(JSON.stringify({ error: code, message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ─────────────────────────────────────────────
// worker.js 라우터 스니펫
// ─────────────────────────────────────────────
/*
  // ── Profile 2.0 M03 Payment (기존 handleBizOrder 대체) ───
  if (pathname === '/biz/order' && request.method === 'POST')
    return handleBizOrder(request, env, corsHeaders);
*/

export {
  handleBizOrder,
  isQRExpired,
  makeBuyerClaim,
  makeSellerClaim,
  makeTxId,
  insertFsLedger,
  FEE_RATE,
  CLAIM_TTL_DAYS,
  FS_SOURCE,
};
