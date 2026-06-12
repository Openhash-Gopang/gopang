/**
 * M10 — GDC 결제 원장 모듈 (Ledger)
 * 내부 함수 전용 — Worker 엔드포인트 없음
 * 의존: 없음 (L3 도메인 계층)
 *
 * 계정 과목 규칙:
 *   bs-cash    = Σcredit - Σdebit  (순변동분)
 *   pl-purchase = Σdebit            (양수 누적)
 *   pl-revenue  = Σcredit           (양수 누적)
 */

const VALID_SOURCES   = ['market', 'manual', 'gdc', 'bonus'];
const VALID_DIRECTIONS = ['debit', 'credit'];
const PLATFORM_FEE_RATE = 0.03;  // 3%

// ── 입력 유효성 검사 ───────────────────────────────────────────────
export function validateLedgerEntry({ amount, source, direction }) {
  if (typeof amount !== 'number' || amount <= 0)
    return { error: 'INVALID_AMOUNT', message: 'amount must be > 0' };
  if (!VALID_SOURCES.includes(source))
    return { error: 'CHECK_VIOLATION', message: `source must be one of: ${VALID_SOURCES.join(', ')}` };
  if (!VALID_DIRECTIONS.includes(direction))
    return { error: 'INVALID_DIRECTION' };
  return null;
}

// ── fs_ledger 3행 빌더 ────────────────────────────────────────────
export function buildMarketPurchaseRows({ buyerGuid, sellerGuid, platformGuid, amount, blockHash, txId }) {
  if (typeof amount !== 'number' || amount <= 0)
    throw new Error('amount must be > 0');
  if (!VALID_SOURCES.includes('market'))
    throw new Error('source must be market');

  const fee         = Math.round(amount * PLATFORM_FEE_RATE);
  const netAmount   = amount - fee;
  const now         = new Date().toISOString();

  return [
    // 행1: buyer debit (구매자 지출)
    {
      guid:       buyerGuid,
      entry_type: 'bs-cash',
      direction:  'debit',
      amount:     amount,
      source:     'market',
      block_hash: blockHash,
      tx_id:      txId,
      created_at: now,
    },
    // 행2: seller credit (판매자 수입 = amount - fee)
    {
      guid:       sellerGuid,
      entry_type: 'bs-cash',
      direction:  'credit',
      amount:     netAmount,
      source:     'market',
      block_hash: blockHash,
      tx_id:      txId,
      created_at: now,
    },
    // 행3: platform credit (수수료)
    {
      guid:       platformGuid,
      entry_type: 'bs-cash',
      direction:  'credit',
      amount:     fee,
      source:     'market',
      block_hash: blockHash,
      tx_id:      txId,
      created_at: now,
    },
  ];
}

// ── BIVM Σδ=0 검증 ────────────────────────────────────────────────
export function verifyBIVM(rows) {
  const totalDebit  = rows.filter(r => r.direction === 'debit' ).reduce((s, r) => s + r.amount, 0);
  const totalCredit = rows.filter(r => r.direction === 'credit').reduce((s, r) => s + r.amount, 0);
  return { totalDebit, totalCredit, balanced: totalDebit === totalCredit };
}

// ── 잔액 재구성 ───────────────────────────────────────────────────
export function reconstructBalances(rows, guid) {
  const entries = rows.filter(r => r.guid === guid);
  let bsCash    = 0;
  let plPurchase = 0;
  let plRevenue  = 0;

  for (const e of entries) {
    if (e.direction === 'credit') {
      bsCash    += e.amount;
      plRevenue += e.amount;
    } else {
      bsCash     -= e.amount;
      plPurchase += e.amount;  // cur + amount (양수 누적)
    }
  }

  return { bsCash, plPurchase, plRevenue };
}

// ── ktax_balance_anomalies 시뮬레이션 ────────────────────────────
// extra.fs 와 reconstruct_balances 결과 비교
export function detectBalanceAnomalies(rows, profiles) {
  const anomalies = [];
  for (const profile of profiles) {
    const computed = reconstructBalances(rows, profile.guid);
    const stored   = profile.extra?.fs ?? null;
    if (!stored) {
      anomalies.push({ guid: profile.guid, reason: 'PROFILE_MISSING_FS' });
      continue;
    }
    if (stored['bs-cash'] !== computed.bsCash) {
      anomalies.push({
        guid: profile.guid,
        reason: 'BS_CASH_MISMATCH',
        stored: stored['bs-cash'],
        computed: computed.bsCash,
      });
    }
  }
  return anomalies;
}

// ── gdc_settle_ledger — extra.fs 갱신 데이터 생성 ────────────────
export function computeSettledFs(rows, guid) {
  const { bsCash, plPurchase, plRevenue } = reconstructBalances(rows, guid);
  return {
    'bs-cash':     bsCash,
    'pl-purchase': plPurchase,
    'pl-revenue':  plRevenue,
  };
}

// ── Supabase market_purchase RPC 호출 래퍼 ───────────────────────
export async function marketPurchaseRPC(env, params) {
  const { buyerGuid, sellerGuid, platformGuid, amount, blockHash, txId } = params;

  const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/market_purchase`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify({
      p_buyer_guid:    buyerGuid,
      p_seller_guid:   sellerGuid,
      p_platform_guid: platformGuid,
      p_amount:        amount,
      p_block_hash:    blockHash,
      p_tx_id:         txId,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    // source 제약 위반 (PostgreSQL 23514)
    if (text.includes('23514')) throw new Error('CHECK_VIOLATION: source must be market');
    throw new Error(`market_purchase RPC error: ${resp.status} ${text}`);
  }

  return resp.json();
}
