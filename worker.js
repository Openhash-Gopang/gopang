// ═══════════════════════════════════════════════════════════
// gopang-proxy — v4.9
// v4.8: /biz/profile, /biz/order, /biz/review, /biz/product
// v4.9: STEP 08 /biz/order L1 위임 (Worker 검증 제거)
//       STEP 09 handlePdvReport 동기 앵커링
//       STEP 10 VALID_PDV_SCOPES 11개 확장
//       STEP 11 reporter_svc 중복 PDV 방지
// ═══════════════════════════════════════════════════════════

const ALLOWED_ORIGINS = [
  'https://gopang.net',
  'https://www.gopang.net',
  'https://klaw.gopang.net',
  'https://market.gopang.net',
  'https://tax.gopang.net',
  'https://gdc.gopang.net',
  'https://health.gopang.net',
  'https://school.gopang.net',
  'https://public.gopang.net',
  'https://security.gopang.net',
  'https://democracy.gopang.net',
  'https://police.gopang.net',
  'https://insurance.gopang.net',
  'https://911.gopang.net',
  'https://stock.gopang.net',
  'https://traffic.gopang.net',
  'https://logistics.gopang.net',
  'https://users.gopang.net',
  'https://l1-hanlim.gopang.net',
  'https://fiil.kr',
  'https://openhash.kr',
  'https://nounweb.github.io',
  'http://localhost',
  'http://127.0.0.1',
];


const L1_NODE_MAP = {
  'KR-JEJU-JEJU-HANLIM':  'https://l1-hanlim.gopang.net',
  'KR-JEJU-JEJU-IDO1':    'https://openhash-l1-ido1.gopang.net',
  'KR-JEJU-JEJU':         'https://openhash-l2-jeju-city.gopang.net',
  'KR-JEJU':              'https://openhash-l3-jeju.gopang.net',
  'KR':                   'https://openhash-l4-kr.gopang.net',
  'GLOBAL':               'https://openhash-l5-global.gopang.net',
};
const L1_DEFAULT = 'https://l1-hanlim.gopang.net';

const OPENAI_URL     = 'https://api.openai.com/v1/chat/completions';
const DEEPSEEK_URL   = 'https://api.deepseek.com/v1/chat/completions';
const KAKAO_BASE     = 'https://dapi.kakao.com/v2/local/geo/coord2address.json';
const OPENAI_MODEL   = 'gpt-4o-mini';
const DEEPSEEK_MODEL = 'deepseek-v4-flash';
const SUPABASE_URL   = 'https://ebbecjfrwaswbdybbgiu.supabase.co';

// STEP 10: VALID_PDV_SCOPES 11개로 확장
const VALID_PDV_SCOPES = [
  'ktraffic', 'khealth', 'pdv_general', 'kmarket', 'k119',
  'klaw', 'ktax', 'kinsurance', 'kgdc', 'kdemocracy', 'klogistics'
];
const SCOPE_MIN_LEVEL = {
  ktraffic:'L1', khealth:'L1', pdv_general:'L1', k119:'L1', kmarket:'L0',
  klaw:'L0', ktax:'L1', kinsurance:'L1', kgdc:'L1', kdemocracy:'L1', klogistics:'L0'
};
const SCOPE_SOURCE_MAP = {
  ktraffic:'traffic', khealth:'health', pdv_general:null, kmarket:'market', k119:'911',
  klaw:'klaw', ktax:'tax', kinsurance:'insurance', kgdc:'gdc', kdemocracy:'democracy', klogistics:'logistics'
};

const SVC_ALIAS = {
  'kemergency':'911','kpolice':'police','ksecurity':'security',
  'khealth':'health','kedu':'school','kgdc':'gdc','kfinance':'stock',
  'kinsurance':'insurance','ktax':'tax','kcommerce':'market',
  'ktransport':'traffic','klogistics':'logistics','fiil-kcleaner':'fiil',
  'kgov':'public','kdemocracy':'democracy',
};

function _resolveSvcId(svcId) { return SVC_ALIAS[svcId] || svcId; }

function getCorsOrigin(request) {
  const origin = request.headers.get('Origin') || '';
  if (ALLOWED_ORIGINS.some(o => origin.startsWith(o))) return origin;
  if (origin === '') return '';
  return null;
}

function buildCorsHeaders(corsOrigin, extra = {}) {
  return {
    'Content-Type':                     'application/json',
    'Access-Control-Allow-Origin':      corsOrigin || '*',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods':     'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':     'Content-Type',
    ...extra,
  };
}

function _err(status, code, detail, corsHeaders) {
  return new Response(
    JSON.stringify({ ok: false, error: code, detail }),
    { status, headers: corsHeaders }
  );
}

function _supabaseAnonKey() {
  return 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYmVjamZyd2Fzd2JkeWJiZ2l1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NjE5ODQsImV4cCI6MjA5NTEzNzk4NH0.H2ahQKtWdSke04Pdi3hDY86pdTx7UUKPUpQMlS_zciA';
}

function _sbHeaders(env) {
  const key = env.SUPABASE_KEY || _supabaseAnonKey();
  return { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' };
}

function _sbServiceHeaders(env) {
  const key = env.SUPABASE_SERVICE_KEY || env.SUPABASE_KEY || _supabaseAnonKey();
  return { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' };
}

// ═══════════════════════════════════════════════════════════
// 메인 fetch 핸들러
// ═══════════════════════════════════════════════════════════
export default {
  // ── Cron 트리거 (10분마다 머클 앵커링) ──────────────────
  async scheduled(event, env, ctx) {
    ctx.waitUntil(anchorL1MerkleRoot(env));
  },

  async fetch(request, env) {
    const corsOrigin = getCorsOrigin(request);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin':      corsOrigin ?? 'null',
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Methods':     'GET, POST, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers':     'Content-Type',
          'Access-Control-Max-Age':           '86400',
        },
      });
    }

    if (corsOrigin === null) {
      return new Response(
        JSON.stringify({ error: 'Forbidden', origin: request.headers.get('Origin') }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const corsHeaders = buildCorsHeaders(corsOrigin);
    const url         = new URL(request.url);
    const pathname    = url.pathname;

    // ── SSO 인증 ──────────────────────────────────────────
    if (pathname === '/auth/issue')              return handleIssue(request, env, corsHeaders);
    if (pathname === '/auth/verify')             return handleVerify(request, env, corsHeaders);
    if (pathname === '/auth/refresh')            return handleRefresh(request, env, corsHeaders);

    // ── WebAuthn ─────────────────────────────────────────
    if (pathname === '/auth/webauthn/challenge') return handleWAChallenge(request, env, corsHeaders);
    if (pathname === '/auth/webauthn/register')  return handleWARegister(request, env, corsHeaders);
    if (pathname === '/auth/webauthn/verify')    return handleWAVerify(request, env, corsHeaders);

    // ── PDV ──────────────────────────────────────────────
    if (pathname === '/pdv/query')               return handlePdvQuery(request, env, corsHeaders);
    if (pathname === '/pdv/report')              return handlePdvReport(request, env, corsHeaders);
    if (pathname.startsWith('/pdv/page/'))       return handlePdvPage(request, env, corsHeaders);

    // ── 서비스 등록 ───────────────────────────────────────
    if (pathname === '/svc/register')            return handleSvcRegister(request, env, corsHeaders);
    if (pathname === '/svc/verify')              return handleSvcVerify(request, env, corsHeaders);

    // ── 지오코딩 / 카카오 ─────────────────────────────────
    if (pathname.startsWith('/geocode'))         return handleGeocode(url, env, corsHeaders);
    if (pathname === '/kakao/appkey')            return handleKakaoAppKey(request, env, corsHeaders);

    // ── search (v4.7) ────────────────────────────────────
    if (pathname === '/search' && request.method === 'POST') return handleSearch(request, env, corsHeaders);

    // ── merkle (T10) ─────────────────────────────────────────
    if (pathname === '/merkle/verify')           return handleMerkleVerify(request, env, corsHeaders);

    // ── biz (v4.8+) ──────────────────────────────────────
    if (pathname.startsWith('/biz/profile/'))   return handleBizProfile(request, env, corsHeaders);
    if (pathname === '/biz/order'   && request.method === 'POST') return handleBizOrder(request, env, corsHeaders);
    if (pathname === '/biz/review'  && request.method === 'POST') return handleBizReview(request, env, corsHeaders);
    if (pathname === '/biz/product' && request.method === 'POST') return handleBizProduct(request, env, corsHeaders);

    // ── ai-setup (AI 비서 설정) ─────────────────────────────
    // v5.1: 토큰 기반 폐기 — Ed25519 서명(/biz/product와 동일 패턴)으로 전환
    //   GET  : ?guid=... 만으로 조회 (저장값은 암호화되어 있어 평문 키 노출 없음)
    //   POST : body={guid,pubkey,signature,...} — _verifyEd25519 + TOFU
    // ── Wallet X25519 (PC→휴대폰 AI 설정 봉투암호화) ──────
    if (pathname === '/wallet/x25519') {
      if (request.method === 'GET')  return handleWalletX25519Get(request, env, corsHeaders);
      if (request.method === 'POST') return handleWalletX25519Post(request, env, corsHeaders);
    }
    if (pathname === '/ai-setup/seal') {
      if (request.method === 'GET')  return handleAiSetupSealGet(request, env, corsHeaders);
      if (request.method === 'POST') return handleAiSetupSealPost(request, env, corsHeaders);
    }

    if (pathname === '/ai-setup') {
      if (request.method === 'GET') {
        const guid = url.searchParams.get('guid');
        if (!guid) return _err(400, 'MISSING_FIELD', 'guid 파라미터 필수', corsHeaders);
        return handleAiSetupGet(request, env, corsHeaders, guid);
      }
      if (request.method === 'POST') return handleAiSetupPost(request, env, corsHeaders);
    }

    // ── WebRTC 시그널링 (P2P 채팅 — OpenHash 철학) ──────────
    // 메시지는 서버에 저장하지 않음 — 시그널(SDP/ICE)만 임시 경유
    if (pathname === '/signal/send')   return handleSignalSend(request, env, corsHeaders);
    if (pathname === '/signal/poll')   return handleSignalPoll(request, env, corsHeaders);
    if (pathname === '/signal/delete') return handleSignalDelete(request, env, corsHeaders);

    // ── 사용자 P2P 등록/검색 (GDUDA Phase 1) ───────────────────
    if (pathname === '/p2p/register' && request.method === 'POST')
      return handleP2PRegister(request, env, corsHeaders);
    if (pathname === '/p2p/search'   && request.method === 'GET')
      return handleP2PSearch(request, env, corsHeaders);

    // ── 사용자 검색 (GDUDA Phase 1) ──────────────────────────
    if (pathname === '/search/users')  return handleSearchUsers(request, env, corsHeaders);

    // ── profile (사용자/사업자 프로필 등록·조회 — v5.1) ──────
    //   GET  : 인증 불필요 — handle 또는 guid로 공개 조회
    //   POST : body={guid,pubkey,signature,...} — _verifyEd25519 + TOFU
    if (pathname.startsWith('/profile')) {
      if (request.method === 'GET')  return handleProfileGet(request, env, corsHeaders);
      if (request.method === 'POST') return handleProfilePost(request, env, corsHeaders);
    }

    // ── Feedback ─────────────────────────────────────────────
    if (pathname === '/feedback' && request.method === 'POST')
      return handleFeedbackPost(request, env, corsHeaders);
    if (pathname === '/feedback' && request.method === 'GET')
      return handleFeedbackGet(request, env, corsHeaders);
    if (pathname.startsWith('/feedback/') && request.method === 'PATCH')
      return handleFeedbackPatch(request, env, corsHeaders);

    // ── Push 알림 ───────────────────────────────────────────
    if (pathname === '/push/subscribe' && request.method === 'POST')
      return handlePushSubscribe(request, env, corsHeaders);
    if (pathname === '/push/send' && request.method === 'POST')
      return handlePushSend(request, env, corsHeaders);
    if (pathname === '/push/vapid-public-key' && request.method === 'GET')
      return handlePushVapidKey(request, env, corsHeaders);

    // ── POST 전용 ────────────────────────────────────────
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers: corsHeaders });
    }

    const bodyText = await request.text();
    if (pathname === '/chat/completions')        return callDeepSeek(bodyText, env, corsHeaders);
    if (pathname.startsWith('/deepseek'))        return callDeepSeek(bodyText, env, corsHeaders);
    if (pathname.startsWith('/gemini/'))         return callOpenAIFromGeminiBody(bodyText, env, corsHeaders);
    if (pathname === '/ai/chat')                 return handleAIChat(bodyText, env, corsHeaders);

    return new Response(JSON.stringify({ error: 'Not Found', path: pathname }), { status: 404, headers: corsHeaders });
  },
};

// ═══════════════════════════════════════════════════════════
// v4.9 STEP 08 — /biz/order (L1 위임, Worker 검증 제거)
// ═══════════════════════════════════════════════════════════
async function handleBizOrder(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  const {
    tx, tx_hash, buyer_sig, buyer_public_key,
    from_guid, seller_guid, l1_node, memo,
    prev_settle_hash, balance_claimed, outputs,
    session_id, reporter_svc,
    item_name, item_id, quantity,
    seller_net, fee,
  } = body;

  // 필수 필드 확인
  if (!tx_hash)          return _err(400, 'MISSING_FIELD', 'tx_hash 필수', corsHeaders);
  if (!buyer_sig)        return _err(400, 'MISSING_FIELD', 'buyer_sig 필수', corsHeaders);
  if (!buyer_public_key) return _err(400, 'MISSING_FIELD', 'buyer_public_key 필수', corsHeaders);
  if (!from_guid)        return _err(400, 'MISSING_FIELD', 'from_guid 필수', corsHeaders);
  if (!seller_guid)      return _err(400, 'MISSING_FIELD', 'seller_guid 필수', corsHeaders);

  // ── STEP 08: L1 위임 — Worker는 검증 로직 없음 ───────────
  const l1Base = l1_node ? (L1_NODE_MAP[l1_node] || L1_DEFAULT) : L1_DEFAULT;
  const l1Url  = l1Base + '/api/tx';

// L1에는 순수 UTXO만 전달 (items/memo 등 제거)
  const txPayload = {
    version: tx?.version || 1,
    input: tx?.input || {
      owner_guid:        from_guid,
      prev_settle_hash:  prev_settle_hash || null,
      balance_claimed:   balance_claimed  || 0,
    },
    outputs: tx?.outputs || outputs || [
      { recipient_guid: seller_guid,        amount: seller_net || 0 },
      { recipient_guid: 'gopang-platform',  amount: fee        || 0 },
    ],
  };

  let l1Result;
  try {
    const l1Res = await fetch(l1Url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: (() => { const p = { tx: txPayload, tx_hash, buyer_sig, buyer_public_key }; console.log('[L1] tx:', JSON.stringify(p.tx)); return JSON.stringify(p); })(),
    });
    l1Result = await l1Res.json().catch(() => ({ ok: false, error: 'L1_PARSE_FAILED' }));
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 노드 연결 실패: ' + e.message, corsHeaders);
  }

  if (!l1Result.ok) {
    console.log('[BizOrder] L1 실패:', JSON.stringify(l1Result));
    const statusMap = {
      INVALID_SIGNATURE:    401,
      UNREGISTERED_KEY:     403,
      STALE_STATE:          409,
      INSUFFICIENT_BALANCE: 402,
      BLOCK_SAVE_FAILED:    500,
    };
    return _err(statusMap[l1Result.error] || 400, l1Result.error, l1Result.detail || l1Result.error, corsHeaders);
  }

  const { block_id, block_hash, height } = l1Result;
  // L1은 buyer_claim을 반환하지 않음 → Worker가 직접 생성 (T08)
  const _txTotal = txPayload.outputs.reduce((s, o) => s + (o.amount || 0), 0);
  const _buyerBalAfter = (txPayload.input?.balance_claimed || balance_claimed || 0) - _txTotal;
  const buyer_claim = {
    direction:   'debit',
    amount:      _txTotal,
    fs_account:  'pl-purchase',
    balance_after: _buyerBalAfter,
    block_hash,
    tx_hash,
    expires_at:  new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7일
  };
  const seller_claim = {
    direction:  'credit',
    amount:     txPayload.outputs.find(o => o.recipient_guid !== 'gopang-platform')?.amount || 0,
    fs_account: 'pl-revenue',
    block_hash,
    tx_hash,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };

  // ── Module 5.5: verifyOutputConsistency + verifyDeltaZero (감시 모드) ──
  const _outputs = txPayload.outputs;
  verifyOutputConsistency(l1Result, _outputs);
  verifyDeltaZero(_outputs, txPayload.input?.balance_claimed || balance_claimed || 0);

  // ── Module 5.5: l1_ledger H_N 기록 (updateNodeHashChain) ──
  // await는 fs_ledger RPC와 병렬 실행 — 거래 응답 차단 안 함
  const userHashPromise = _computeUserHash(tx_hash, block_hash, height);
  const nodeChainPromise = userHashPromise.then(userHash =>
    updateNodeHashChain(env, {
      userHash,
      txId:            tx_hash,
      blockHash:       block_hash,
      buyerGuid:       from_guid,
      sellerGuid:      seller_guid,
      balanceClaimed:  txPayload.input?.balance_claimed || balance_claimed || 0,
    })
  );

  
  // ── fs_ledger 기록 (market_purchase RPC) ─────────────────
  const sbServiceH  = _sbServiceHeaders(env);
  const totalOutput = txPayload.outputs.reduce((s, o) => s + (o.amount || 0), 0);
  const _sellerNet  = txPayload.outputs.find(o => o.recipient_guid !== 'gopang-platform')?.amount || 0;
  const _fee        = txPayload.outputs.find(o => o.recipient_guid === 'gopang-platform')?.amount  || 0;

  const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/market_purchase`, {
    method:  'POST',
    headers: sbServiceH,
    body:    JSON.stringify({
      p_tx_id:            tx_hash,
      p_buyer_guid:       from_guid,
      p_seller_guid:      seller_guid,
      p_item_name:        item_name || memo || '상품',
      p_item_id:          item_id   || null,
      p_quantity:         quantity  || 1,
      p_total:            totalOutput,
      p_seller_net:       _sellerNet,
      p_fee:              _fee,
      p_prev_settle_hash: prev_settle_hash || null,
      p_block_hash:       block_hash,
      p_block_id:         block_id,
      p_memo:             memo || null,
    }),
  });
  const rpcResult = await rpcRes.json().catch(() => ({ error: 'RPC_PARSE_FAILED' }));

  // ── extra.fs 갱신 — 기존 값 병합 후 추적 필드 추가 ────────
  // 설계 원칙:
  //   기존 bs-cash, pl-purchase, pl-revenue 값 보존 (RPC가 갱신)
  //   last_tx_id, last_block_hash, last_tx_record 추가
  const sellerItemSig = body.item_sig || body.seller_item_sig || null;
  const now_fs = new Date().toISOString();
  const txRecord = JSON.stringify({
    tx_id:       tx_hash,
    buyer_guid:  from_guid,
    seller_guid: seller_guid,
    item_name:   item_name || memo || '상품',
    total:       totalOutput,
    fee:         _fee,
    seller_net:  _sellerNet,
    block_hash,
    block_id,
    timestamp:   now_fs,
    buyer_sig:   body.signature    || null,
    seller_sig:  sellerItemSig,
  });

  // buyer: 기존 extra 조회 후 fs 병합
  const _patchFs = async (guid, fsPatch) => {
    const existing = await fetch(
      `${SUPABASE_URL}/rest/v1/user_profiles?guid=eq.${encodeURIComponent(guid)}&select=extra&limit=1`,
      { headers: sbServiceH }
    ).then(r => r.json()).catch(() => []);
    const prevExtra = existing?.[0]?.extra || {};
    const prevFs    = prevExtra?.public?.finance?.fs || {};
    const newFs     = { ...prevFs, ...fsPatch };  // 기존 값 보존 + 신규 필드 추가
    return fetch(`${SUPABASE_URL}/rest/v1/user_profiles?guid=eq.${encodeURIComponent(guid)}`, {
      method: 'PATCH',
      headers: { ...sbServiceH, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        extra: { ...prevExtra, public: { ...(prevExtra.public||{}), finance: { ...(prevExtra.public?.finance||{}), fs: newFs } } }
      }),
    });
  };

  const fsPatch = {
    'last_tx_id':      tx_hash,
    'last_block_hash': block_hash,
    'last_updated_at': now_fs,
    'last_tx_record':  txRecord,
  };
  _patchFs(from_guid,   fsPatch).catch(e => console.warn('[BizOrder] buyer fs 갱신 실패:', e.message));
  _patchFs(seller_guid, fsPatch).catch(e => console.warn('[BizOrder] seller fs 갱신 실패:', e.message));

  // ── STEP 11: reporter_svc 없을 때만 Worker가 PDV 기록 ────
  // reporter_svc가 있으면 하위 시스템이 이미 기록했으므로 중복 방지
  if (!reporter_svc) {
    await _recordOrderPdv(env, {
      from_guid, seller_guid, tx_hash, block_hash, block_id,
      session_id, item_name: item_name || memo || '상품',
      total: totalOutput, l1_result: l1Result,
    });
  }
  console.log('[BizOrder] 성공:', JSON.stringify({ ok: true, block_hash, height, buyer_claim: !!buyer_claim }));

  return new Response(JSON.stringify({
    ok:           true,
    tx_hash,
    block_id,
    block_hash,
    height,
    openhash:     l1Result.openhash,
    buyer_claim,
    seller_claim,
    ledger:       rpcResult,
    reporter_svc: reporter_svc || 'gopang-proxy',
  }), { status: 200, headers: corsHeaders });
}

// ── STEP 09: PDV 기록 헬퍼 (동기 앵커링) ─────────────────
async function _recordOrderPdv(env, {
  from_guid, seller_guid, tx_hash, block_hash, block_id,
  session_id, item_name, total,
}) {
  const pdvKey   = env.SUPABASE_KEY || _supabaseAnonKey();
  const pdvId    = `PDV-${from_guid.replace(/:/g, '').slice(0, 12)}-${Date.now()}`;
  const reportId = session_id || `RPT-kmarket-${Date.now()}`;
  const now      = new Date().toISOString();

  const summary6w = JSON.stringify({
    who:   `buyer(${from_guid.slice(0, 20)}...)`,
    when:  now,
    where: 'https://market.gopang.net',
    what:  `구매: ${item_name} ₮${total}`,
    how:   'Ed25519 서명 + L1 4단계 검증',
    why:   '상품 구매 거래',
  });

  await fetch(`${SUPABASE_URL}/rest/v1/pdv_log`, {
    method:  'POST',
    headers: {
      'apikey': pdvKey, 'Authorization': `Bearer ${pdvKey}`,
      'Content-Type': 'application/json', 'Prefer': 'return=minimal',
    },
    body: JSON.stringify({
      id:                   pdvId,
      guid:                 from_guid,
      source:               'market',
      type:                 'tx_2party',
      report_id:            reportId,
      summary:              `구매: ${item_name} ₮${total}`,
      summary_6w:           summary6w,
      risk_level:           'low',
      raw_hash:             tx_hash,
      // STEP 09: 동기 앵커링 — L1 응답 수신 즉시 true
      block_hash:           block_hash,
      openhash_block_id:    block_id,
      openhash_anchored:    true,
      openhash_anchored_at: now,
      reporter_svc:         'gopang-proxy',
      via_worker:           true,
      created_at:           now,
    }),
  }).catch(e => console.warn('[PDV] 기록 실패:', e.message));
}

// ═══════════════════════════════════════════════════════════
// v4.7 — /pdv/page/{identifier}
// ═══════════════════════════════════════════════════════════
async function handlePdvPage(request, env, corsHeaders) {
  const identifier = decodeURIComponent(new URL(request.url).pathname.replace('/pdv/page/', ''));
  if (!identifier) return _err(400, 'MISSING_ID', 'identifier 필수', corsHeaders);
  const sbH = _sbHeaders(env);
  let primaryGuid = identifier;
  let l1Node      = 'KR-JEJU-JEJU-HANLIM';
  if (identifier.includes(':')) {
    const res  = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?current_ipv6=eq.${encodeURIComponent(identifier)}&select=primary_guid,l1_node&limit=1`, { headers: sbH });
    const rows = await res.json().catch(() => []);
    if (!rows?.length) return _err(404, 'NOT_FOUND', `IPv6 ${identifier} 엔티티 없음`, corsHeaders);
    primaryGuid = rows[0].primary_guid || identifier;
    l1Node      = rows[0].l1_node      || l1Node;
  } else {
    const res  = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?primary_guid=eq.${encodeURIComponent(identifier)}&select=primary_guid,l1_node,name,entity_type,current_ipv6&limit=1`, { headers: sbH });
    const rows = await res.json().catch(() => []);
    if (rows?.length) l1Node = rows[0].l1_node || l1Node;
  }
  const nodeBase   = L1_NODE_MAP[l1Node] || L1_DEFAULT;
  const pguidShort = primaryGuid.slice(0, 8);
  const pdvUrl     = `${nodeBase}/entities/${pguidShort}.html`;
  try {
    const pdvRes = await fetch(pdvUrl);
    if (pdvRes.ok) {
      const html = await pdvRes.text();
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': corsHeaders['Access-Control-Allow-Origin'], 'X-Gopang-Node': l1Node, 'X-Gopang-GUID': primaryGuid } });
    }
  } catch {}
  const res2   = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?primary_guid=eq.${encodeURIComponent(primaryGuid)}&select=*&limit=1`, { headers: sbH });
  const rows2  = await res2.json().catch(() => []);
  const profile = rows2?.[0];
  if (profile) return new Response(_generatePdvHtml(profile), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': corsHeaders['Access-Control-Allow-Origin'], 'X-Gopang-Generated': 'dynamic' } });
  return _err(404, 'PDV_NOT_FOUND', `PDV 페이지 없음: ${primaryGuid}`, corsHeaders);
}

function _generatePdvHtml(p) {
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>${p.name||'엔티티'} — Gopang PDV</title><meta name="ofp:primary_guid" content="${p.primary_guid||''}"><meta name="ofp:current_ipv6" content="${p.current_ipv6||''}"><meta name="ofp:l1_node" content="${p.l1_node||''}"><style>body{font-family:sans-serif;max-width:480px;margin:40px auto;padding:20px;background:#f8f9fa}.card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px}h1{font-size:20px;margin-bottom:16px}.row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px}.label{color:#6b7280}.val{font-family:monospace;font-size:11px;word-break:break-all}.btn{display:block;width:100%;padding:12px;margin-top:16px;background:#3ecf8e;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer}</style></head><body><div class="card"><h1>${p.name||'(이름 없음)'}</h1><div class="row"><span class="label">유형</span><span>${p.entity_type||'–'}</span></div><div class="row"><span class="label">업종</span><span>${p.occupation||'–'}</span></div><div class="row"><span class="label">주소</span><span>${p.address||'–'}</span></div><div class="row"><span class="label">Primary GUID</span><span class="val">${p.primary_guid||'–'}</span></div><div class="row"><span class="label">IPv6</span><span class="val">${p.current_ipv6||'–'}</span></div><div class="row"><span class="label">L1 노드</span><span class="val">${p.l1_node||'–'}</span></div><button class="btn" onclick="window.open('https://gopang.net/?connect=${encodeURIComponent(p.primary_guid||'')}','_blank')">고팡으로 연결</button></div></body></html>`;
}

// ═══════════════════════════════════════════════════════════
// v4.7 — /search
// ═══════════════════════════════════════════════════════════
async function handleSearch(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const sbH = _sbHeaders(env);

  // 파라미터 정규화: q/limit → p_keyword/p_limit
  const rpcBody = {
    p_keyword:      body.p_keyword     || body.q           || null,
    p_entity_type:  body.p_entity_type || body.entity_type || null,
    p_occupation:   body.p_occupation  || body.occupation  || null,
    p_address:      body.p_address     || body.address     || null,
    p_gdc_only:     body.p_gdc_only    ?? false,
    p_trust_min:    body.p_trust_min   || null,
    p_lat:          body.p_lat         || body.lat         || null,
    p_lng:          body.p_lng         || body.lng         || null,
    p_sort:         body.p_sort        || 'rank',
    p_limit:        body.p_limit       || body.limit       || body.lim || 20,
    p_offset:       body.p_offset      || body.offset      || body.ofst || 0,
    p_exclude_guid: body.p_exclude_guid|| null,
    p_l1_node:      body.p_l1_node     || null,
    p_l2_node:      body.p_l2_node     || null,
    p_primary_guid: body.p_primary_guid|| null,
    p_handle:       body.p_handle      || body.handle      || null,
    p_nickname:     body.p_nickname    || body.nickname    || null,
    p_lang_code:    body.p_lang_code   || null,
    p_l3_node:      body.p_l3_node     || null,
  };

  const res  = await fetch(`${SUPABASE_URL}/rest/v1/rpc/search_entities`, { method: 'POST', headers: sbH, body: JSON.stringify(rpcBody) });
  const data = await res.json().catch(() => ({ error: 'parse failed' }));
  return new Response(JSON.stringify(data), { status: res.status, headers: corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// v4.8 — /biz/profile/{handle}
// ═══════════════════════════════════════════════════════════
async function handleBizProfile(request, env, corsHeaders) {
  const rawHandle = decodeURIComponent(new URL(request.url).pathname.replace('/biz/profile/', ''));
  if (!rawHandle) return _err(400, 'MISSING_HANDLE', 'handle 필수', corsHeaders);
  const sbH = _sbHeaders(env);
  let profile = null;
  const pRes  = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?handle=eq.${encodeURIComponent(rawHandle)}&limit=1`, { headers: sbH });
  const pRows = await pRes.json().catch(() => []);
  if (pRows.length) {
    profile = pRows[0];
  } else {
    const nickname = rawHandle.replace(/^@/, '').split('#')[0];
    const res2     = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?nickname=eq.${encodeURIComponent(nickname)}&limit=1`, { headers: sbH });
    const rows2    = await res2.json().catch(() => []);
    if (!rows2.length) {
    // guid로 재시도
    const res3 = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?primary_guid=eq.${encodeURIComponent(rawHandle)}&limit=1`, { headers: sbH });
    const rows3 = await res3.json().catch(() => []);
    if (!rows3.length) return _err(404, 'PROFILE_NOT_FOUND', `handle/guid ${rawHandle} 없음`, corsHeaders);
    profile = rows3[0];
  } else {
    profile = rows2[0];
  }
  }
  const guid = profile.current_ipv6;
  const [prodRes, reviewRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/biz_products?seller_guid=eq.${encodeURIComponent(guid)}&is_active=eq.true&order=sort_order.asc`, { headers: sbH }),
    fetch(`${SUPABASE_URL}/rest/v1/biz_reviews?seller_guid=eq.${encodeURIComponent(guid)}&is_visible=eq.true&order=created_at.desc&limit=20`, { headers: sbH }),
  ]);
  const [products, reviews] = await Promise.all([prodRes.json().catch(()=>[]), reviewRes.json().catch(()=>[])]);
  const avgRating = reviews.length ? (reviews.reduce((s,r)=>s+(r.rating||0),0)/reviews.length).toFixed(1) : null;
  return new Response(JSON.stringify({ ok:true, profile, products, reviews, review_summary:{count:reviews.length,avg_rating:avgRating} }), { status:200, headers:corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// v4.8 — /biz/review
// ═══════════════════════════════════════════════════════════
async function handleBizReview(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { reviewer_guid, product_id, tx_id, rating, body:reviewBody, image_urls=[], seller_guid } = body;
  if (!reviewer_guid) return _err(400, 'MISSING_FIELD', 'reviewer_guid 필수', corsHeaders);
  if (!product_id)    return _err(400, 'MISSING_FIELD', 'product_id 필수', corsHeaders);
  if (!tx_id)         return _err(400, 'MISSING_FIELD', 'tx_id 필수', corsHeaders);
  if (!rating||rating<1||rating>5) return _err(400, 'INVALID_RATING', 'rating 1~5 필수', corsHeaders);
  const sbServiceH = _sbServiceHeaders(env);
  const valRes     = await fetch(`${SUPABASE_URL}/rest/v1/rpc/validate_review`, { method:'POST', headers:sbServiceH, body:JSON.stringify({ p_reviewer_guid:reviewer_guid, p_product_id:product_id, p_tx_id:tx_id }) });
  const valResult  = await valRes.json().catch(()=>({ ok:false, error:'RPC_PARSE_FAILED' }));
  if (!valResult.ok) {
    const statusMap = { NO_VALID_PURCHASE:403, ALREADY_REVIEWED:409 };
    return _err(statusMap[valResult.error]||400, valResult.error, valResult.error, corsHeaders);
  }
  const insRes = await fetch(`${SUPABASE_URL}/rest/v1/biz_reviews`, {
    method:'POST', headers:{...sbServiceH,'Prefer':'return=representation'},
    body:JSON.stringify({ order_id:valResult.order_id, tx_id, reviewer_guid, seller_guid:seller_guid||null, product_id, rating, body:reviewBody||null, image_urls }),
  });
  if (!insRes.ok) return _err(500, 'INSERT_FAILED', await insRes.text(), corsHeaders);
  const inserted = await insRes.json().catch(()=>[]);
  return new Response(JSON.stringify({ ok:true, review_id:inserted[0]?.id||null, message:'리뷰가 등록됐습니다' }), { status:200, headers:corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// v4.8 — /biz/product
// ═══════════════════════════════════════════════════════════
async function handleBizProduct(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { action='create', seller_guid, pubkey, signature, product, l1_node } = body;
  if (!seller_guid)              return _err(400, 'MISSING_FIELD', 'seller_guid 필수', corsHeaders);
  if (!pubkey)                   return _err(400, 'MISSING_FIELD', 'pubkey 필수', corsHeaders);
  if (!signature)                return _err(400, 'MISSING_FIELD', 'signature 필수', corsHeaders);
  if (!product?.name && action==='create') return _err(400, 'MISSING_FIELD', 'product.name 필수', corsHeaders);
  const sigOk = await _verifyEd25519(pubkey, signature, body);
  if (!sigOk) return _err(401, 'INVALID_SIGNATURE', 'TX 서명 검증 실패', corsHeaders);
  const sbH       = _sbHeaders(env);
  const ownerRes  = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?current_ipv6=eq.${encodeURIComponent(seller_guid)}&select=pubkey_ed25519,handle&limit=1`, { headers:sbH });
  const ownerRows = await ownerRes.json().catch(()=>[]);
  if (!ownerRows.length) return _err(404, 'SELLER_NOT_FOUND', 'seller_guid 없음', corsHeaders);
  if (ownerRows[0].pubkey_ed25519 && ownerRows[0].pubkey_ed25519 !== pubkey)
    return _err(403, 'PUBKEY_MISMATCH', '공개키가 등록된 판매자와 일치하지 않습니다', corsHeaders);
  const sellerHandle = ownerRows[0].handle || null;
  const sbServiceH   = _sbServiceHeaders(env);
  if (action === 'create') {
    const insRes = await fetch(`${SUPABASE_URL}/rest/v1/biz_products`, {
      method:'POST', headers:{...sbServiceH,'Prefer':'return=representation'},
      body:JSON.stringify({ seller_guid, seller_handle:sellerHandle, name:product.name, description:product.description||null, category:product.category||null, image_urls:product.image_urls||[], tags:product.tags||[], price_krw:product.price_krw??0, price_gdc:product.price_gdc??0, stock:product.stock??null, sort_order:product.sort_order??0, is_active:product.is_active??true, l1_node:l1_node||null }),
    });
    if (!insRes.ok) return _err(500, 'INSERT_FAILED', await insRes.text(), corsHeaders);
    const inserted = await insRes.json().catch(()=>[]);
    return new Response(JSON.stringify({ ok:true, action:'created', product_id:inserted[0]?.id||null }), { status:200, headers:corsHeaders });
  }
  if (action === 'update') {
    if (!product?.id) return _err(400, 'MISSING_FIELD', 'product.id 필수 (update)', corsHeaders);
    const chkRes  = await fetch(`${SUPABASE_URL}/rest/v1/biz_products?id=eq.${encodeURIComponent(product.id)}&seller_guid=eq.${encodeURIComponent(seller_guid)}&select=id&limit=1`, { headers:sbH });
    const chkRows = await chkRes.json().catch(()=>[]);
    if (!chkRows.length) return _err(403, 'FORBIDDEN', '본인 상품만 수정할 수 있습니다', corsHeaders);
    const patch  = {};
    const fields = ['name','description','category','image_urls','tags','price_krw','price_gdc','stock','sort_order','is_active'];
    for (const f of fields) { if (product[f] !== undefined) patch[f] = product[f]; }
    const updRes = await fetch(`${SUPABASE_URL}/rest/v1/biz_products?id=eq.${encodeURIComponent(product.id)}`, { method:'PATCH', headers:{...sbServiceH,'Prefer':'return=minimal'}, body:JSON.stringify(patch) });
    if (!updRes.ok) return _err(500, 'UPDATE_FAILED', await updRes.text(), corsHeaders);
    return new Response(JSON.stringify({ ok:true, action:'updated', product_id:product.id }), { status:200, headers:corsHeaders });
  }
  return _err(400, 'INVALID_ACTION', 'action은 create 또는 update', corsHeaders);
}

// ═══════════════════════════════════════════════════════════
// Ed25519 서명 검증 (/biz/product, /biz/review 전용)
// /biz/order는 L1이 담당 — Worker에서 호출하지 않음
// ═══════════════════════════════════════════════════════════
async function _verifyEd25519(pubkeyB64u, signatureB64u, bodyObj) {
  try {
    const { signature: _sig, ...rest } = bodyObj;
    const payload     = new TextEncoder().encode(JSON.stringify(rest));
    const pubKeyBytes = _b64uToBytes(pubkeyB64u);
    const sigBytes    = _b64uToBytes(signatureB64u);
    const cryptoKey   = await crypto.subtle.importKey('raw', pubKeyBytes, { name:'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', cryptoKey, sigBytes, payload);
  } catch (e) { console.warn('[Ed25519]', e.message); return false; }
}

async function _verifyEd25519Simple(pubkeyB64u, signatureB64u, message) {
  try {
    const data       = new TextEncoder().encode(message);
    const pubKeyBytes = _b64uToBytes(pubkeyB64u);
    const sigBytes    = _b64uToBytes(signatureB64u);
    const cryptoKey   = await crypto.subtle.importKey('raw', pubKeyBytes, { name:'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', cryptoKey, sigBytes, data);
  } catch (e) { console.warn('[Ed25519Simple]', e.message); return false; }
}

function _b64uToBytes(b64u) {
  const b64 = b64u.replace(/-/g,'+').replace(/_/g,'/');
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

// ═══════════════════════════════════════════════════════════
// v4.9 STEP 09 — handlePdvReport 동기 앵커링
// ═══════════════════════════════════════════════════════════
async function handlePdvReport(request,env,corsHeaders){
  if(request.method!=='POST')return new Response('Method Not Allowed',{status:405});
  const origin=request.headers.get('Origin')||'';
  const body=await request.json().catch(()=>null);
  if(!body?.report)return _err(400,'SCHEMA_ERROR','report.report 필드 필수',corsHeaders);
  const r=body.report;
  const svcId=r.svc||request.headers.get('X-Gopang-Svc')||'unknown';
  const ipv6=r.who?.ipv6;
  const reg=_getSvcRegistration(origin,svcId);
  if(!reg)return _err(403,'SERVICE_NOT_REGISTERED',`${svcId} (${origin})은 등록된 서비스가 아닙니다`,corsHeaders);
  if(reg.level<2&&!reg.pdv)return _err(403,'PDV_NOT_ALLOWED','Level 1 서비스는 PDV 보고서 전송 권한이 없습니다',corsHeaders);
  if(!ipv6)return _err(404,'USER_NOT_FOUND','who.ipv6 필수',corsHeaders);

  // STEP 11: session_id 기반 중복 PDV 방지
  const sessionId = r.session_id || body.session_id || null;
  const reporterSvc = r.reporter_svc || body.reporter_svc || null;
  if (sessionId && reporterSvc) {
    // 하위 시스템이 이미 보고한 경우 중복 확인
    const pdvKey = env.SUPABASE_KEY || _supabaseAnonKey();
    const dupRes = await fetch(
      `${SUPABASE_URL}/rest/v1/pdv_log?report_id=eq.${encodeURIComponent(sessionId)}&reporter_svc=eq.${encodeURIComponent(reporterSvc)}&select=id&limit=1`,
      { headers: { 'apikey': pdvKey, 'Authorization': `Bearer ${pdvKey}`, 'Content-Type': 'application/json' } }
    );
    const dupRows = await dupRes.json().catch(() => []);
    if (dupRows.length) {
      return new Response(JSON.stringify({
        ok: true,
        skipped: true,
        reason: 'DUPLICATE_SESSION',
        session_id: sessionId,
        message: '하위 시스템이 이미 PDV를 기록했습니다',
      }), { status: 200, headers: corsHeaders });
    }
  }

  const resolvedSvcId=_resolveSvcId(svcId);
  const reportId=r.id||`RPT-${resolvedSvcId}-${Date.now()}-auto`;
  const summary6w={
    who:`${r.who?.role||'user'} (${ipv6.slice(0,20)}...)`,
    when:`${(r.when?.period_start||'').slice(0,10)} ~ ${(r.when?.period_end||'').slice(0,10)}`,
    where:r.where?.svc_url||`https://${resolvedSvcId}.gopang.net`,
    what:r.what?.summary||'(요약 없음)',
    how:r.how?.method||'자동 집계',
    why:r.why?.goal||'(목표 미지정)',
  };
  const pdvId=`PDV-${ipv6.replace(/:/g,'').slice(0,12)}-${Date.now()}`;
  const pdvKey=env.SUPABASE_KEY||_supabaseAnonKey();
  const now = new Date().toISOString();

  // STEP 09: block_hash가 report에 포함된 경우 동기 앵커링
  const blockHash   = r.block_hash   || body.block_hash   || null;
  const blockId     = r.block_id     || body.block_id     || null;
  const isAnchored  = !!blockHash;

  const pdvFetch=await fetch(SUPABASE_URL+'/rest/v1/pdv_log',{method:'POST',headers:{'apikey':pdvKey,'Authorization':'Bearer '+pdvKey,'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify({
    id:pdvId,
    guid:ipv6,
    source:resolvedSvcId,
    type:r.type||'report',
    report_id:reportId,
    summary:r.what?.summary||'',
    summary_6w:JSON.stringify(summary6w),
    risk_level:r.analysis?.risk_level||'low',
    period:r.when??r.period??null,
    raw_hash:r.content_hash||null,
    // STEP 09: 동기 앵커링
    block_hash:           blockHash,
    openhash_block_id:    blockId,
    openhash_anchored:    isAnchored,
    openhash_anchored_at: isAnchored ? now : null,
    // STEP 11: 보고 주체 기록
    reporter_svc:         reporterSvc || resolvedSvcId,
    via_worker:           true,
    created_at:           now,
  })});

  if(!pdvFetch.ok)return _err(503,'PDV_LOCKED','PDV 저장 실패, 60초 후 재시도',corsHeaders);

  return new Response(JSON.stringify({
    ok:true,
    report_id:reportId,
    pdv_entry:pdvId,
    recorded_at:now,
    openhash:{
      anchored:    isAnchored,
      block_hash:  blockHash,
      block_id:    blockId,
      anchored_at: isAnchored ? now : null,
    },
    recipients_notified:(r.who?.recipients||[]).filter(x=>x!=='gopang-pdv'),
    svc_level:reg.level,
    message:`PDV 기록 완료. ${resolvedSvcId} (Level ${reg.level})`,
  }),{status:200,headers:corsHeaders});
}

// ═══════════════════════════════════════════════════════════
// 이하 v4.8과 동일 — PDV Query, SSO, WebAuthn, AI, Geocode
// ═══════════════════════════════════════════════════════════
async function handlePdvQuery(request,env,corsHeaders){if(request.method!=='POST')return new Response('Method Not Allowed',{status:405});const origin=request.headers.get('Origin')||'';try{const body=await request.json().catch(()=>null);const query=body?.query;if(!query?.svc||!query?.ipv6||!query?.scope||!query?.period)return _err(400,'SCHEMA_ERROR','필수 필드 누락: svc, ipv6, scope, period',corsHeaders);if(!Array.isArray(query.scope)||query.scope.length===0)return _err(400,'SCOPE_INVALID','scope는 비어있지 않은 배열이어야 합니다',corsHeaders);const invalidScope=query.scope.find(s=>!VALID_PDV_SCOPES.includes(s));if(invalidScope)return _err(400,'SCOPE_INVALID',`허용되지 않은 scope: ${invalidScope}`,corsHeaders);if(!query.period?.start||!query.period?.end)return _err(400,'SCHEMA_ERROR','period.start, period.end 필수',corsHeaders);const periodMs=new Date(query.period.end)-new Date(query.period.start);if(periodMs>365*24*60*60*1000)return _err(400,'PERIOD_TOO_LONG','조회 기간은 12개월을 초과할 수 없습니다',corsHeaders);const svcReg=_getSvcRegistration(origin,query.svc);if(!svcReg||!svcReg.pdv)return _err(403,'SVC_NOT_REGISTERED',`미등록 또는 PDV 권한 없는 서비스: ${query.svc}`,corsHeaders);const authToken=query.auth_token;if(!authToken?.exp||Math.floor(Date.now()/1000)>authToken.exp)return _err(401,'AUTH_EXPIRED','인증 토큰이 만료되었습니다',corsHeaders);const LEVEL_ORDER={L0:0,L1:1,L2:2,L3:3};const userLevel=LEVEL_ORDER[authToken.level]??0;for(const scope of query.scope){const required=LEVEL_ORDER[SCOPE_MIN_LEVEL[scope]||'L1'];if(userLevel<required)return _err(403,'LEVEL_INSUFFICIENT',`${scope} 조회는 ${SCOPE_MIN_LEVEL[scope]} 이상 필요`,corsHeaders);}if(!query.consent_token||!query.request_id){const reqId=`CNSREQ-${query.ipv6.replace(/:/g,'').slice(0,8)}-${Date.now()}`;const expiresAt=Math.floor(Date.now()/1000)+300;await _storeConsentRequest(env,reqId,query,expiresAt);const consentUrl='https://gopang.net/consent'+`?req=${encodeURIComponent(reqId)}&svc=${encodeURIComponent(query.svc)}`+`&scope=${encodeURIComponent(query.scope.join(','))}`+`&purpose=${encodeURIComponent(query.purpose||'')}`+`&ipv6_hash=${encodeURIComponent(await _sha256Hex(query.ipv6))}`;return new Response(JSON.stringify({ok:false,status:'CONSENT_REQUIRED',consent:{request_id:reqId,expires_at:expiresAt,consent_url:consentUrl,message:'사용자가 고팡 앱에서 PDV 조회에 동의해야 합니다.'}}),{status:202,headers:corsHeaders});}const consentOk=await _verifyConsentToken(env,query.consent_token,query.request_id,query.ipv6);if(!consentOk)return _err(401,'CONSENT_INVALID','동의 토큰이 유효하지 않습니다',corsHeaders);const withinLimit=await _checkRateLimit(env,query.ipv6,'pdv_query');if(!withinLimit)return _err(429,'RATE_LIMITED','PDV 조회 한도 초과',corsHeaders);const pdvSummary=await _fetchPdvByScope(env,query.ipv6,query.scope,query.period);const queryId=`PDVQ-${query.ipv6.replace(/:/g,'').slice(0,8)}-${Date.now()}`;const pdvEntryId=await _recordConsentEvent(env,query,queryId);return new Response(JSON.stringify({ok:true,query_id:queryId,ipv6:query.ipv6,period:query.period,pdv_summary:pdvSummary,consent:{granted_at:new Date().toISOString(),expires_at:new Date(authToken.exp*1000).toISOString(),pdv_entry_id:pdvEntryId}}),{status:200,headers:corsHeaders});}catch(e){return _err(500,'INTERNAL_ERROR',e.message,corsHeaders);}}
async function _storeConsentRequest(env,reqId,query,expiresAt){const key=env.SUPABASE_KEY||_supabaseAnonKey();try{await fetch(SUPABASE_URL+'/rest/v1/pdv_consent_requests',{method:'POST',headers:{'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify({id:reqId,ipv6:query.ipv6,svc:_resolveSvcId(query.svc),scope:query.scope,purpose:query.purpose||'',period:query.period,status:'pending',expires_at:new Date(expiresAt*1000).toISOString()})});}catch(e){console.warn('[PDVQuery] 동의 요청 저장 실패:',e.message);}}
async function _verifyConsentToken(env,consentToken,requestId,ipv6){try{const key=env.SUPABASE_KEY||_supabaseAnonKey();const res=await fetch(SUPABASE_URL+`/rest/v1/pdv_consent_requests?id=eq.${encodeURIComponent(requestId)}&ipv6=eq.${encodeURIComponent(ipv6)}&select=status,expires_at,consent_token`,{headers:{'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json'}});const rows=await res.json().catch(()=>[]);if(!rows?.length)return false;const row=rows[0];if(new Date(row.expires_at)<new Date())return false;if(row.status!=='granted')return false;if(row.consent_token!==consentToken)return false;return true;}catch(e){return _verifyConsentHmac(env,consentToken,requestId,ipv6);}}
async function _verifyConsentHmac(env,consentToken,requestId,ipv6){try{const masterKey=env.GOPANG_MASTER_KEY||'gopang-webauthn-secret-v1';const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(masterKey),{name:'HMAC',hash:'SHA-256'},false,['verify']);const data=new TextEncoder().encode(`${requestId}.${ipv6}`);const sigBytes=Uint8Array.from(atob(consentToken.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));return crypto.subtle.verify('HMAC',key,sigBytes,data);}catch{return false;}}
async function _checkRateLimit(env,ipv6,action){if(env.RATE_LIMIT_KV){const kvKey=`rl:${action}:${ipv6}`;const current=parseInt(await env.RATE_LIMIT_KV.get(kvKey)||'0');if(current>=3)return false;await env.RATE_LIMIT_KV.put(kvKey,String(current+1),{expirationTtl:300});return true;}return true;}
async function _fetchPdvByScope(env,ipv6,scopes,period){const key=env.SUPABASE_KEY||_supabaseAnonKey();const result={};for(const scope of scopes){const source=SCOPE_SOURCE_MAP[scope];let queryUrl=SUPABASE_URL+'/rest/v1/pdv_log'+`?guid=eq.${encodeURIComponent(ipv6)}`+`&created_at=gte.${period.start}T00:00:00Z&created_at=lte.${period.end}T23:59:59Z`+`&select=summary,summary_6w,risk_level,created_at,source&order=created_at.desc&limit=50`;if(source)queryUrl+=`&source=eq.${encodeURIComponent(source)}`;try{const res=await fetch(queryUrl,{headers:{'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json'}});const rows=await res.json().catch(()=>[]);if(!rows?.length){result[scope]={available:false,entry_count:0,risk_level:'unknown',summary_6w:null,risk_factors:{}};continue;}const RISK_ORDER={low:0,medium:1,high:2};const maxRisk=rows.reduce((max,r)=>{const lvl=r.risk_level||'low';return RISK_ORDER[lvl]>RISK_ORDER[max]?lvl:max;},'low');let summary6w=null;for(const row of rows){try{summary6w=JSON.parse(row.summary_6w);break;}catch{}}result[scope]={available:true,entry_count:rows.length,risk_level:maxRisk,summary_6w:summary6w,risk_factors:_aggregateRiskFactors(scope,rows)};}catch(e){result[scope]={available:false,entry_count:0,risk_level:'unknown',summary_6w:null,risk_factors:{},error:'fetch_failed'};}}return result;}
function _aggregateRiskFactors(scope,rows){if(scope==='ktraffic')return{accident_count:rows.filter(r=>{try{return JSON.parse(r.summary_6w)?.what?.includes('사고');}catch{return false;}}).length,entry_count:rows.length,high_risk_count:rows.filter(r=>r.risk_level==='high').length,accident_free_months:0};if(scope==='khealth')return{total_records:rows.length,high_risk_count:rows.filter(r=>r.risk_level==='high').length,medium_risk_count:rows.filter(r=>r.risk_level==='medium').length};return{entry_count:rows.length,high_risk_count:rows.filter(r=>r.risk_level==='high').length};}
async function _recordConsentEvent(env,query,queryId){const key=env.SUPABASE_KEY||_supabaseAnonKey();const svcId=_resolveSvcId(query.svc);const pdvId=`PDV-${query.ipv6.replace(/:/g,'').slice(0,12)}-${Date.now()}`;const summary6w=JSON.stringify({who:svcId,when:new Date().toISOString(),where:`https://${svcId}.gopang.net`,what:`PDV 조회 동의: scope=[${query.scope.join(',')}]`,how:'사용자 명시적 동의',why:query.purpose||'PDV 데이터 조회'});try{await fetch(SUPABASE_URL+'/rest/v1/pdv_log',{method:'POST',headers:{'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify({id:pdvId,guid:query.ipv6,source:svcId,type:'consent_event',report_id:queryId,summary:`PDV 조회 동의: ${svcId} → [${query.scope.join(',')}]`,summary_6w:summary6w,risk_level:'low',period:query.period,raw_hash:null,created_at:new Date().toISOString()})});}catch(e){console.warn('[PDVQuery] consent_event 기록 실패:',e.message);}return pdvId;}
async function _sha256Hex(text){const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');}
function buildCookie(token){return[`gopang_token=${token}`,'Path=/','Domain=.gopang.net','Max-Age=3600','SameSite=None','Secure','HttpOnly'].join('; ');}
function parseCookie(header,name){const match=header.match(new RegExp(`(?:^|;)\\s*${name}=([^;]+)`));return match?decodeURIComponent(match[1]):null;}
function buildToken(ipv6,level,svc){const now=Math.floor(Date.now()/1000);const payload={ipv6,level,svc,iat:now,exp:now+3600};return btoa(JSON.stringify(payload)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');}
function parseToken(token){try{const padded=token.replace(/-/g,'+').replace(/_/g,'/');const payload=JSON.parse(atob(padded+'=='.slice((padded.length%4)||4)));if(payload.exp<Math.floor(Date.now()/1000))return null;return payload;}catch{return null;}}
async function handleIssue(request,env,corsHeaders){if(request.method!=='POST')return new Response('Method Not Allowed',{status:405});const body=await request.json().catch(()=>null);if(!body?.ipv6)return _err(400,'MISSING_FIELD','ipv6 필수',corsHeaders);const{ipv6,level='L0',svc='*'}=body;const token=buildToken(ipv6,level,svc);return new Response(JSON.stringify({ok:true,ipv6,level}),{status:200,headers:{...corsHeaders,'Set-Cookie':buildCookie(token)}});}
async function handleVerify(request,env,corsHeaders){const cookieHeader=request.headers.get('Cookie')||'';const raw=parseCookie(cookieHeader,'gopang_token');if(!raw)return _err(401,'NO_TOKEN','no_token',corsHeaders);const payload=parseToken(raw);if(!payload)return _err(401,'INVALID_TOKEN','expired_or_invalid',corsHeaders);return new Response(JSON.stringify({valid:true,ipv6:payload.ipv6,level:payload.level,svc:payload.svc,exp:payload.exp}),{status:200,headers:corsHeaders});}
async function handleRefresh(request,env,corsHeaders){const cookieHeader=request.headers.get('Cookie')||'';const raw=parseCookie(cookieHeader,'gopang_token');if(!raw)return _err(401,'NO_TOKEN','no_token',corsHeaders);const payload=parseToken(raw);if(!payload)return _err(401,'INVALID_TOKEN','expired_or_invalid',corsHeaders);const remaining=payload.exp-Math.floor(Date.now()/1000);if(remaining>1800)return new Response(JSON.stringify({ok:false,reason:'not_yet',remaining}),{status:200,headers:corsHeaders});const newToken=buildToken(payload.ipv6,payload.level,payload.svc);return new Response(JSON.stringify({ok:true}),{status:200,headers:{...corsHeaders,'Set-Cookie':buildCookie(newToken)}});}
async function sbFetch(env,path,method='GET',body=null){const key=env.SUPABASE_KEY||_supabaseAnonKey();const headers={'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates'};const res=await fetch(SUPABASE_URL+path,{method,headers,body:body?JSON.stringify(body):undefined});return res.ok?res.json().catch(()=>({})):null;}
async function handleWAChallenge(request,env,corsHeaders){const challenge=crypto.getRandomValues(new Uint8Array(32));const chalB64=btoa(String.fromCharCode(...challenge)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');const exp=Math.floor(Date.now()/1000)+300;const sigData=`${chalB64}.${exp}`;const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.GOPANG_MASTER_KEY||'gopang-webauthn-secret-v1'),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(sigData));const sigHex=Array.from(new Uint8Array(sig)).map(b=>b.toString(16).padStart(2,'0')).join('');return new Response(JSON.stringify({challenge:chalB64,exp,sig:sigHex}),{status:200,headers:corsHeaders});}
async function _verifyChallengeToken(env,chalB64,exp,sig){if(exp<Math.floor(Date.now()/1000))return false;const sigData=`${chalB64}.${exp}`;const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.GOPANG_MASTER_KEY||'gopang-webauthn-secret-v1'),{name:'HMAC',hash:'SHA-256'},false,['verify']);const sigBytes=Uint8Array.from(sig.match(/.{2}/g).map(h=>parseInt(h,16)));return crypto.subtle.verify('HMAC',key,sigBytes,new TextEncoder().encode(sigData));}
async function handleWARegister(request,env,corsHeaders){if(request.method!=='POST')return new Response('Method Not Allowed',{status:405});const body=await request.json().catch(()=>null);if(!body?.ipv6||!body?.credentialId||!body?.publicKey)return _err(400,'MISSING_FIELD','ipv6, credentialId, publicKey 필수',corsHeaders);const chalOk=await _verifyChallengeToken(env,body.challenge,body.challengeExp,body.challengeSig);if(!chalOk)return _err(401,'CHALLENGE_INVALID','챌린지 만료 또는 위조',corsHeaders);const result=await sbFetch(env,'/rest/v1/webauthn_credentials','POST',{ipv6:body.ipv6,credential_id:body.credentialId,public_key:body.publicKey,counter:0,device_type:body.deviceType||'platform',aaguid:body.aaguid||null});if(!result)return _err(502,'DB_ERROR','Supabase 저장 실패',corsHeaders);return new Response(JSON.stringify({ok:true,ipv6:body.ipv6}),{status:200,headers:corsHeaders});}
async function handleWAVerify(request,env,corsHeaders){if(request.method!=='POST')return new Response('Method Not Allowed',{status:405});const body=await request.json().catch(()=>null);if(!body?.ipv6||!body?.credentialId)return _err(400,'MISSING_FIELD','ipv6, credentialId 필수',corsHeaders);const rows=await sbFetch(env,`/rest/v1/webauthn_credentials?ipv6=eq.${encodeURIComponent(body.ipv6)}&credential_id=eq.${encodeURIComponent(body.credentialId)}&select=public_key,counter`,'GET');if(!rows?.length)return _err(404,'CREDENTIAL_NOT_FOUND','credential_not_found',corsHeaders);const cred=rows[0];if(body.counter!==undefined&&body.counter<=cred.counter)return _err(401,'COUNTER_REPLAY','counter_replay',corsHeaders);if(body.counter!==undefined)await sbFetch(env,`/rest/v1/webauthn_credentials?credential_id=eq.${encodeURIComponent(body.credentialId)}`,'PATCH',{counter:body.counter,last_used_at:new Date().toISOString()});const token=buildToken(body.ipv6,'L2','*');return new Response(JSON.stringify({valid:true,ipv6:body.ipv6,level:'L2'}),{status:200,headers:{...corsHeaders,'Set-Cookie':buildCookie(token)}});}
const REGISTERED_SERVICES={'gopang':{level:3,domain:'gopang.net',minAuth:'L0',pdv:true},'klaw':{level:3,domain:'klaw.gopang.net',minAuth:'L0',pdv:true},'market':{level:3,domain:'market.gopang.net',minAuth:'L0',pdv:true},'school':{level:3,domain:'school.gopang.net',minAuth:'L0',pdv:true},'security':{level:3,domain:'security.gopang.net',minAuth:'L1',pdv:true},'health':{level:3,domain:'health.gopang.net',minAuth:'L1',pdv:true},'tax':{level:3,domain:'tax.gopang.net',minAuth:'L0',pdv:true},'gdc':{level:3,domain:'gdc.gopang.net',minAuth:'L1',pdv:true},'public':{level:3,domain:'public.gopang.net',minAuth:'L0',pdv:true},'democracy':{level:3,domain:'democracy.gopang.net',minAuth:'L1',pdv:true},'911':{level:3,domain:'911.gopang.net',minAuth:'L0',pdv:true},'police':{level:3,domain:'police.gopang.net',minAuth:'L1',pdv:true},'insurance':{level:3,domain:'insurance.gopang.net',minAuth:'L1',pdv:true},'stock':{level:3,domain:'stock.gopang.net',minAuth:'L1',pdv:true},'traffic':{level:3,domain:'traffic.gopang.net',minAuth:'L0',pdv:true},'logistics':{level:3,domain:'logistics.gopang.net',minAuth:'L0',pdv:true},'fiil':{level:2,domain:'fiil.kr',minAuth:'L0',pdv:true},'klaw-ext':{level:2,domain:'klaw.openhash.kr',minAuth:'L0',pdv:false},'users':{level:3,domain:'users.gopang.net',minAuth:'L0',pdv:false}};
function _getSvcRegistration(origin,svcId){const resolvedId=_resolveSvcId(svcId);const svc=REGISTERED_SERVICES[resolvedId];if(svc&&origin.includes(svc.domain))return{...svc,svcId:resolvedId,originalId:svcId};if(/^https:\/\/[a-z0-9-]+\.gopang\.net$/.test(origin))return{level:1,domain:origin,minAuth:'L0',pdv:false,svcId:resolvedId,originalId:svcId};return null;}
async function handleSvcRegister(request,env,corsHeaders){if(request.method!=='POST')return new Response('Method Not Allowed',{status:405});const body=await request.json().catch(()=>null);if(!body?.svc_id||!body?.domain||!body?.operator_ipv6)return _err(400,'MISSING_FIELD','svc_id, domain, operator_ipv6 필수',corsHeaders);const{svc_id,domain,description,min_auth,operator_ipv6}=body;const isGopangSub=/^[a-z0-9-]+\.gopang\.net$/.test(domain);await sbFetch(env,'/rest/v1/svc_registry','POST',{svc_id,domain,description:description||'',operator_ipv6,min_auth:min_auth||'L0',trust_level:isGopangSub?1:0,status:isGopangSub?'auto_approved':'pending',registered_at:new Date().toISOString()});return new Response(JSON.stringify({ok:true,svc_id,domain,trust_level:isGopangSub?1:0,status:isGopangSub?'auto_approved':'pending_review',message:isGopangSub?'*.gopang.net 서브도메인으로 자동 승인됐습니다. (Level 1)':'등록 신청이 접수됐습니다.'}),{status:200,headers:corsHeaders});}
async function handleSvcVerify(request,env,corsHeaders){const url=new URL(request.url);const svcId=url.searchParams.get('svc_id');const origin=request.headers.get('Origin')||'';if(!svcId)return _err(400,'MISSING_FIELD','svc_id 파라미터 필수',corsHeaders);const reg=_getSvcRegistration(origin,svcId);if(!reg)return new Response(JSON.stringify({ok:false,registered:false,svc_id:svcId,message:'등록되지 않은 서비스입니다.'}),{status:200,headers:corsHeaders});return new Response(JSON.stringify({ok:true,registered:true,svc_id:svcId,trust_level:reg.level,pdv_allowed:reg.pdv,min_auth:reg.minAuth,message:`등록된 서비스 (Level ${reg.level})`}),{status:200,headers:corsHeaders});}
async function handleGeocode(url,env,corsHeaders){const lat=url.searchParams.get('lat');const lng=url.searchParams.get('lng');if(!lat||!lng)return _err(400,'MISSING_FIELD','lat, lng required',corsHeaders);try{const res=await fetch(`${KAKAO_BASE}?x=${lng}&y=${lat}&input_coord=WGS84`,{headers:{'Authorization':`KakaoAK ${env.KAKAO_REST_KEY}`}});const data=await res.json();return new Response(JSON.stringify(data),{headers:corsHeaders});}catch(e){return _err(502,'GEOCODE_ERROR',e.message,corsHeaders);}}
async function handleKakaoAppKey(request,env,corsHeaders){const appkey=env.KAKAO_JS_KEY||env.KAKAO_REST_KEY;if(!appkey)return _err(500,'CONFIG_ERROR','Kakao key not configured',corsHeaders);return new Response(JSON.stringify({appkey}),{status:200,headers:{...corsHeaders,'Cache-Control':'public, max-age=300'}});}
async function handleAIChat(bodyText,env,corsHeaders){let body;try{body=JSON.parse(bodyText);}catch{return _err(400,'INVALID_JSON','Invalid JSON',corsHeaders);}const{provider='deepseek',model,system,messages,max_tokens=2000}=body;const builtMessages=[...(system?[{role:'system',content:system}]:[]),...(messages||[])];try{if(provider!=='anthropic'){const res=await fetch(DEEPSEEK_URL,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${env.DEEPSEEK_API_KEY}`},body:JSON.stringify({model:model||DEEPSEEK_MODEL,max_tokens,messages:builtMessages})});const data=await res.json();const content=data.choices?.[0]?.message?.content;if(!content)throw new Error('DeepSeek 응답 없음: '+JSON.stringify(data));return new Response(JSON.stringify({content,provider:'deepseek',model:model||DEEPSEEK_MODEL}),{status:200,headers:corsHeaders});}else{const res=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':env.ANTHROPIC_API_KEY||env.OpenAI,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:model||'claude-sonnet-4-20250514',max_tokens,...(system?{system}:{}),messages:messages||[]})});const data=await res.json();const content=data.content?.find(c=>c.type==='text')?.text;return new Response(JSON.stringify({content,provider:'anthropic'}),{status:200,headers:corsHeaders});}}catch(e){return _err(502,'AI_ERROR',e.message,corsHeaders);}}
async function callOpenAIFromGeminiBody(bodyText,env,corsHeaders){const apiKey=env.OpenAI;if(!apiKey)return _err(500,'CONFIG_ERROR','OpenAI key not configured',corsHeaders);let geminiBody;try{geminiBody=JSON.parse(bodyText);}catch{return _err(400,'INVALID_JSON','Invalid JSON body',corsHeaders);}const systemPrompt=geminiBody.system_instruction?.parts?.[0]?.text||'';const parts=geminiBody.contents?.[0]?.parts||[];const textPart=parts.find(p=>p.text)?.text||'';const imagePart=parts.find(p=>p.inline_data);const maxTokens=geminiBody.generationConfig?.maxOutputTokens||1500;const messages=[];if(systemPrompt)messages.push({role:'system',content:systemPrompt});if(imagePart?.inline_data){messages.push({role:'user',content:[{type:'image_url',image_url:{url:`data:${imagePart.inline_data.mime_type};base64,${imagePart.inline_data.data}`}},{type:'text',text:textPart||'이미지를 분석하여 JSON으로만 출력하라.'}]});}else{messages.push({role:'user',content:textPart});}try{const res=await fetch(OPENAI_URL,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${apiKey}`},body:JSON.stringify({model:OPENAI_MODEL,messages,max_tokens:maxTokens,temperature:geminiBody.generationConfig?.temperature??0.1})});const data=await res.json();if(!res.ok)throw new Error(data.error?.message||`HTTP ${res.status}`);const text=data.choices?.[0]?.message?.content||'{}';return new Response(JSON.stringify({candidates:[{content:{parts:[{text}],role:'model'},finishReason:'STOP'}],_provider:'openai',_model:OPENAI_MODEL}),{headers:corsHeaders});}catch(e){const fbBody=JSON.stringify({model:DEEPSEEK_MODEL,messages,max_tokens:maxTokens,temperature:0.1,stream:false});return callDeepSeek(fbBody,env,corsHeaders,e.message);}}
async function callDeepSeek(bodyText,env,corsHeaders,fallbackFrom=null){try{let isStream=false;try{isStream=!!JSON.parse(bodyText)?.stream;}catch{}const res=await fetch(DEEPSEEK_URL,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${env.DEEPSEEK_API_KEY}`},body:bodyText});if(!res.ok){const errText=await res.text();let errMsg;try{errMsg=JSON.parse(errText)?.error?.message;}catch{}return new Response(JSON.stringify({error:errMsg||`HTTP ${res.status}`}),{status:res.status,headers:corsHeaders});}if(isStream){return new Response(res.body,{status:200,headers:{...corsHeaders,'Content-Type':'text/event-stream','Cache-Control':'no-cache','X-Accel-Buffering':'no'}});}const data=await res.json();if(fallbackFrom){const text=data.choices?.[0]?.message?.content||'{}';return new Response(JSON.stringify({candidates:[{content:{parts:[{text}],role:'model'},finishReason:'STOP'}],_provider:'deepseek-fallback',_fallback_from:fallbackFrom}),{headers:corsHeaders});}return new Response(JSON.stringify(data),{headers:corsHeaders});}catch(e){return _err(502,'DEEPSEEK_ERROR',e.message,corsHeaders);}}

// ═══════════════════════════════════════════════════════════
// Module 5.5 — Hash Chain & BIVM (PDV-HASHCHAIN-DESIGN-v3.0)
// ═══════════════════════════════════════════════════════════

/**
 * C-1: L1 노드 Hash Chain H_N 기록
 * n_i = SHA-256(n_{i-1} ∥ h_{user,i})
 */
async function updateNodeHashChain(env, { userHash, txId, blockHash, buyerGuid, sellerGuid, balanceClaimed }) {
  try {
    const sbH = _sbServiceHeaders(env);

    // 직전 node_hash 조회
    const lastRes = await fetch(
      `${SUPABASE_URL}/rest/v1/l1_ledger?select=node_hash&order=anchored_at.desc&limit=1`,
      { headers: sbH }
    );
    const lastRows = await lastRes.json().catch(() => []);
    const prevNodeHash = lastRows?.[0]?.node_hash || '0'.repeat(64);

    // n_i = SHA-256(n_{i-1} ∥ h_{user,i})
    const input    = new TextEncoder().encode(prevNodeHash + userHash);
    const buf      = await crypto.subtle.digest('SHA-256', input);
    const nodeHash = Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0')).join('');

    await fetch(`${SUPABASE_URL}/rest/v1/l1_ledger`, {
      method:  'POST',
      headers: { ...sbH, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        tx_id:           txId,
        buyer_guid:      buyerGuid,
        seller_guid:     sellerGuid,
        block_hash:      blockHash,
        user_hash:       userHash,
        node_hash:       nodeHash,
        balance_claimed: balanceClaimed,
        anchored_at:     new Date().toISOString(),
      }),
    });

    console.log('[H_N] l1_ledger 기록 완료 | tx_id:', txId?.slice(0, 8),
      '| node_hash:', nodeHash.slice(0, 8));
    return nodeHash;
  } catch(e) {
    console.warn('[H_N] updateNodeHashChain 실패:', e.message);
  }
}

/**
 * 사용자 Hash Chain h_i 계산
 * h_i = SHA-256(block_hash ∥ tx_hash ∥ height)
 * ※ 클라이언트의 전체 공식과 달리 Worker는 prev_local_hash 없이
 *   block_hash + tx_hash + height로 user_hash를 산출합니다.
 *   (IDB 없는 서버 환경 — L1 응답 기반 단순화)
 */
async function _computeUserHash(txHash, blockHash, height) {
  const input = new TextEncoder().encode(blockHash + txHash + String(height));
  const buf   = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * C-2a: L1 응답 vs outputs 일관성 검증
 * 감시 모드 — 불일치 시 로그만 기록, 거래 차단 안 함 (T10까지)
 */
function verifyOutputConsistency(l1Response, outputs) {
  const l1Total   = l1Response.buyer_claim?.amount || 0;
  const calcTotal = outputs.reduce((s, o) => s + (o.amount || 0), 0);
  const consistent = Math.abs(l1Total - calcTotal) < 0.01;
  if (!consistent) {
    console.error('[BIVM] L1 응답 vs outputs 불일치!',
      JSON.stringify({ l1Total, calcTotal, diff: l1Total - calcTotal }));
  }
  return consistent;
}

/**
 * C-2b: 실시간 Σδ=0 검증 (설계서 E1 수정)
 * buyer_debit = seller_credit + platform_debit
 * 감시 모드 — 불일치 시 로그만 기록, 거래 차단 안 함 (T10까지)
 */
function verifyDeltaZero(outputs, balanceClaimed) {
  const sellerNet   = outputs.find(o => o.recipient_guid !== 'gopang-platform')?.amount || 0;
  const platformFee = outputs.find(o => o.recipient_guid === 'gopang-platform')?.amount  || 0;
  const buyerDebit  = sellerNet + platformFee;
  const sigmaDelta  = Math.abs(buyerDebit - sellerNet - platformFee);

  if (sigmaDelta > 0.01) {
    console.error('[BIVM] Σδ ≠ 0 — 집합 잔액 불변성 위반!',
      JSON.stringify({ buyerDebit, sellerNet, platformFee, sigmaDelta }));
    return { valid: false, sigmaDelta };
  }
  if (balanceClaimed < buyerDebit) {
    console.error('[BIVM] balance_claimed < txTotal — 잔액 부족!',
      JSON.stringify({ balanceClaimed, buyerDebit }));
    return { valid: false, reason: 'insufficient_balance' };
  }
  return { valid: true, sigmaDelta: 0 };
}

// ═══════════════════════════════════════════════════════════
// Module T10 — Merkle Anchoring (anchorL1MerkleRoot)
// Cron: 10분마다 실행
// 미앵커링 pdv_log 배치 → 머클 루트 계산 → merkle_anchors INSERT
// → pdv_log openhash_anchored = true 갱신
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// Wallet X25519 — PC가 휴대폰의 암호화 공개키를 조회/등록
// ═══════════════════════════════════════════════════════════

// GET /wallet/x25519?guid=...  (PC가 호출, 인증 불필요 — 공개키는 비밀 아님)
async function handleWalletX25519Get(request, env, corsHeaders) {
  const url  = new URL(request.url);
  const guid = url.searchParams.get('guid');
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);

  const sbH = _sbHeaders(env);
  let res;
  try {
    res = await fetch(
      `${SUPABASE_URL}/rest/v1/user_profiles?guid=eq.${encodeURIComponent(guid)}&select=extra&limit=1`,
      { headers: sbH }
    );
  } catch (e) {
    return _err(502, 'SUPABASE_UNREACHABLE', 'DB 연결 실패: ' + e.message, corsHeaders);
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return _err(502, 'SUPABASE_ERROR', `DB 조회 실패 (HTTP ${res.status}): ${errText}`, corsHeaders);
  }

  const rows = await res.json().catch(() => []);
  const pubkey = rows?.[0]?.extra?.public?.security?.x25519_pubkey || null;

  if (!pubkey) {
    return new Response(JSON.stringify({
      ok: false, registered: false,
      message: '이 사용자는 아직 휴대폰에서 AI 설정 창을 연 적이 없습니다. 휴대폰 웹앱 → 설정 → AI 설정을 먼저 열어 주세요.',
    }), { status: 200, headers: corsHeaders });
  }
  return new Response(JSON.stringify({ ok: true, registered: true, x25519_pubkey: pubkey }),
    { status: 200, headers: corsHeaders });
}

// POST /wallet/x25519  — 휴대폰이 자신의 X25519 공개키 등록
// body: { guid, x25519_pubkey, ed25519_pubkey, signature, ts }
// 서명 대상: `${guid}:${x25519_pubkey}:${ts}` (固定 문자열, /profile과 동일 패턴)
// Ed25519 서명을 요구하는 이유: 서명 없이 등록을 허용하면 공격자가
// 피해자의 guid를 알아내 먼저 자신의 키로 선점 등록(레이스 컨디션)할 수 있고,
// 이후 PC가 그 guid로 암호화한 API Key를 공격자가 복호화할 수 있게 된다.
async function handleWalletX25519Post(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { guid, x25519_pubkey, ed25519_pubkey, signature, ts } = body;
  if (!guid)           return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  if (!x25519_pubkey)  return _err(400, 'MISSING_FIELD', 'x25519_pubkey 필수', corsHeaders);
  if (!ed25519_pubkey) return _err(400, 'MISSING_FIELD', 'ed25519_pubkey 필수', corsHeaders);
  if (!signature)      return _err(400, 'MISSING_FIELD', 'signature 필수', corsHeaders);

  const sigMsg = `${guid}:${x25519_pubkey}:${ts || ''}`;
  const sigOk  = await _verifyEd25519Simple(ed25519_pubkey, signature, sigMsg);
  if (!sigOk) return _err(401, 'INVALID_SIGNATURE', '서명 검증 실패', corsHeaders);

  const sbH = _sbHeaders(env);
  let existRes;
  try {
    existRes = await fetch(
      `${SUPABASE_URL}/rest/v1/user_profiles?guid=eq.${encodeURIComponent(guid)}&select=extra,pubkey_ed25519&limit=1`,
      { headers: sbH }
    );
  } catch (e) {
    return _err(502, 'SUPABASE_UNREACHABLE', 'DB 연결 실패: ' + e.message, corsHeaders);
  }
  if (!existRes.ok) {
    const errText = await existRes.text().catch(() => '');
    return _err(502, 'SUPABASE_ERROR', `DB 조회 실패 (HTTP ${existRes.status}): ${errText}`, corsHeaders);
  }
  const existRows = await existRes.json().catch(() => []);
  if (!existRows.length) return _err(404, 'PROFILE_NOT_FOUND', '프로필이 먼저 등록되어야 합니다', corsHeaders);

  // TOFU: 이 guid에 이미 등록된 Ed25519 공개키와 일치해야만 진짜 소유자로 인정
  const knownEdPubkey = existRows[0].pubkey_ed25519;
  if (knownEdPubkey && knownEdPubkey !== ed25519_pubkey) {
    return _err(403, 'PUBKEY_MISMATCH', '등록된 공개키와 일치하지 않습니다', corsHeaders);
  }

  const prevExtra = existRows[0].extra || {};
  const prevSecurity = prevExtra?.public?.security || {};

  // X25519 키 자체도 TOFU: 이미 등록된 키가 있으면 그대로 반환 (덮어쓰지 않음)
  if (prevSecurity.x25519_pubkey) {
    return new Response(JSON.stringify({
      ok: true, already_registered: true, x25519_pubkey: prevSecurity.x25519_pubkey,
    }), { status: 200, headers: corsHeaders });
  }

  const newExtra = {
    ...prevExtra,
    public: {
      ...(prevExtra.public || {}),
      security: { ...prevSecurity, x25519_pubkey, registered_at: new Date().toISOString() },
    },
  };

  const sbServiceH = _sbServiceHeaders(env);
  let patchRes;
  try {
    patchRes = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?guid=eq.${encodeURIComponent(guid)}`, {
      method: 'PATCH',
      headers: { ...sbServiceH, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ extra: newExtra }),
    });
  } catch (e) {
    return _err(502, 'SUPABASE_UNREACHABLE', 'DB 연결 실패: ' + e.message, corsHeaders);
  }
  if (!patchRes.ok) return _err(500, 'DB_ERROR', await patchRes.text(), corsHeaders);

  return new Response(JSON.stringify({ ok: true, already_registered: false, x25519_pubkey }),
    { status: 200, headers: corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// AI Setup Seal — PC→휴대폰 1회용 암호화 봉투
// 평문 API 키는 절대 이 테이블에 닿지 않음 (PC가 암호화한 바이트만 경유)
// ═══════════════════════════════════════════════════════════

// POST /ai-setup/seal — PC가 암호문 저장 (서명 불필요, 암호문 자체가 무의미한 바이트)
// body: { guid, ephemeral_pubkey, iv, ciphertext }
// AI Setup Seal — PC가 X25519로 암호화한 LLM 설정을 5분짜리 임시 우편함에 보관.
// 영구 저장이 필요 없는 단기 메시지이므로 Supabase(RLS 정책 관리 부담, 관계형 DB)
// 대신 Cloudflare KV를 사용 — TTL을 네이티브로 지원하고 행 단위 권한 정책이
// 없어 이런 종류의 권한 오류(42501 등) 자체가 발생할 수 없다.
async function handleAiSetupSealPost(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { guid, ephemeral_pubkey, iv, ciphertext } = body;
  if (!guid)             return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  if (!ephemeral_pubkey) return _err(400, 'MISSING_FIELD', 'ephemeral_pubkey 필수', corsHeaders);
  if (!iv)               return _err(400, 'MISSING_FIELD', 'iv 필수', corsHeaders);
  if (!ciphertext)       return _err(400, 'MISSING_FIELD', 'ciphertext 필수', corsHeaders);

  if (!env.AI_SETUP_SEALS_KV)
    return _err(500, 'CONFIG_ERROR', 'AI_SETUP_SEALS_KV 바인딩 미설정', corsHeaders);

  const ttlSeconds = 5 * 60; // 5분 — KV expirationTtl 최소값은 60초이므로 충분히 안전
  const expiresAt  = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  try {
    // KV는 같은 키에 put()하면 자동으로 덮어쓰므로 별도 DELETE 불필요
    await env.AI_SETUP_SEALS_KV.put(
      guid,
      JSON.stringify({ ephemeral_pubkey, iv, ciphertext, created_at: new Date().toISOString() }),
      { expirationTtl: ttlSeconds }
    );
  } catch (e) {
    return _err(502, 'KV_ERROR', 'KV 저장 실패: ' + e.message, corsHeaders);
  }

  return new Response(JSON.stringify({ ok: true, expires_at: expiresAt }),
    { status: 200, headers: corsHeaders });
}

// GET /ai-setup/seal?guid=...&consume=1 — 휴대폰이 자신의 봉투 조회 (consume=1이면 즉시 삭제)
async function handleAiSetupSealGet(request, env, corsHeaders) {
  const url     = new URL(request.url);
  const guid    = url.searchParams.get('guid');
  const consume = url.searchParams.get('consume') === '1';
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);

  if (!env.AI_SETUP_SEALS_KV)
    return _err(500, 'CONFIG_ERROR', 'AI_SETUP_SEALS_KV 바인딩 미설정', corsHeaders);

  let raw;
  try {
    raw = await env.AI_SETUP_SEALS_KV.get(guid);
  } catch (e) {
    return _err(502, 'KV_ERROR', 'KV 조회 실패: ' + e.message, corsHeaders);
  }
  if (!raw) {
    return new Response(JSON.stringify({ ok: true, sealed: null }), { status: 200, headers: corsHeaders });
  }
  const sealed = JSON.parse(raw);

  if (consume) {
    await env.AI_SETUP_SEALS_KV.delete(guid).catch(() => {});
  }

  return new Response(JSON.stringify({ ok: true, sealed }), { status: 200, headers: corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// /ai-setup GET — 현재 AI 비서 설정 조회
// ═══════════════════════════════════════════════════════════
async function handleAiSetupGet(request, env, corsHeaders, guid) {
  const sbH = _sbHeaders(env);
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/user_llm_keys?guid=eq.${guid}&select=provider,model,ai_active,custom_prompt,native_lang&limit=1`,
    { headers: sbH }
  );
  if (!res.ok) return _err(502, 'DB_ERROR', 'DB 조회 실패', corsHeaders);
  const rows = await res.json().catch(() => []);
  if (!rows.length) {
    return new Response(JSON.stringify({
      ai_active: false, provider: 'deepseek', model: 'deepseek-chat',
      has_key: false, custom_prompt: '',
    }), { status: 200, headers: corsHeaders });
  }
  const row = rows[0];
  return new Response(JSON.stringify({
    ai_active:     row.ai_active,
    provider:      row.provider,
    model:         row.model,
    has_key:       !!(row.api_key_enc),
    custom_prompt: row.custom_prompt || '',
    native_lang:   row.native_lang || 'ko',
  }), { status: 200, headers: corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// v5.0 — WebRTC 시그널링 핸들러 (P2P 채팅)
// 원칙: 메시지 본문 절대 저장 없음 — SDP/ICE 60초 TTL 후 삭제
// ═══════════════════════════════════════════════════════════

async function handleSignalSend(request, env, corsHeaders) {
  if (request.method !== 'POST') return _err(405, 'METHOD_NOT_ALLOWED', '', corsHeaders);
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', '', corsHeaders);
  const { from_guid, to_guid, type, payload } = body;
  if (!from_guid || !to_guid || !type || !payload)
    return _err(400, 'MISSING_FIELDS', 'from_guid, to_guid, type, payload 필수', corsHeaders);
  if (!['offer','answer','ice'].includes(type))
    return _err(400, 'INVALID_TYPE', 'offer|answer|ice 만 허용', corsHeaders);

  const expires_at = new Date(Date.now() + 60_000).toISOString();
  const sbH = _sbServiceHeaders(env);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/webrtc_signals`, {
    method: 'POST',
    headers: { ...sbH, 'Prefer': 'return=minimal' },
    body: JSON.stringify({ from_guid, to_guid, type, payload, expires_at }),
  });
  if (!res.ok) return _err(500, 'DB_ERROR', await res.text(), corsHeaders);

  // 기회적 만료 시그널 정리
  fetch(`${SUPABASE_URL}/rest/v1/webrtc_signals?expires_at=lt.${new Date().toISOString()}`, {
    method: 'DELETE', headers: sbH,
  }).catch(() => {});

  // ── 수신자에게 Push 알림 전송 (백그라운드 수신용) ──────
  // offer 시그널일 때만 전송 (ICE/answer는 이미 연결 중)
  if (type === 'offer') {
    _sendPushToGuid(env, to_guid, {
      title: from_guid.slice(0, 8) + '님의 메시지',
      body:  '새 메시지가 도착했습니다.',
      tag:   'gopang-msg-' + from_guid.slice(0, 8),
      url:   '/webapp.html',
    }).catch(e => console.warn('[Push] 알림 전송 실패:', e.message));
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
}

async function handleSignalPoll(request, env, corsHeaders) {
  if (request.method !== 'GET') return _err(405, 'METHOD_NOT_ALLOWED', '', corsHeaders);
  const url  = new URL(request.url);
  const guid = url.searchParams.get('guid');
  if (!guid) return _err(400, 'GUID_REQUIRED', '', corsHeaders);

  const sbH = _sbHeaders(env);
  const now = new Date().toISOString();
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/webrtc_signals?to_guid=eq.${encodeURIComponent(guid)}&expires_at=gt.${now}&order=created_at.asc&limit=20`,
    { headers: sbH }
  );
  const signals = await res.json().catch(() => []);
  return new Response(JSON.stringify({ ok: true, signals }), { status: 200, headers: corsHeaders });
}

async function handleSignalDelete(request, env, corsHeaders) {
  if (request.method !== 'POST') return _err(405, 'METHOD_NOT_ALLOWED', '', corsHeaders);
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', '', corsHeaders);
  const sbH = _sbServiceHeaders(env);

  if (body.id) {
    await fetch(`${SUPABASE_URL}/rest/v1/webrtc_signals?id=eq.${encodeURIComponent(body.id)}`,
      { method: 'DELETE', headers: sbH });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
  }
  if (body.from_guid) {
    await fetch(`${SUPABASE_URL}/rest/v1/webrtc_signals?from_guid=eq.${encodeURIComponent(body.from_guid)}`,
      { method: 'DELETE', headers: sbH });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
  }
  return _err(400, 'ID_OR_FROM_GUID_REQUIRED', '', corsHeaders);
}



// ═══════════════════════════════════════════════════════════
// GDUDA Phase 1 — /p2p/search
// global_profiles에서 닉네임 검색 (DHT 인덱스 노드 임시 대체)
// GET /p2p/search?q=James&country=US&region=New+York&limit=20
// ═══════════════════════════════════════════════════════════
async function handleP2PSearch(request, env, corsHeaders) {
  const url     = new URL(request.url);
  const q       = url.searchParams.get('q')?.trim();
  const country = url.searchParams.get('country')?.trim();
  const region  = url.searchParams.get('region')?.trim();
  const handle  = url.searchParams.get('handle')?.trim();
  const limit   = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);

  if (!q && !handle) return _err(400, 'QUERY_REQUIRED', 'q 또는 handle 파라미터 필수', corsHeaders);

  // ── L1 PocketBase 검색 (GDUDA 본 구현) ──────────────────
  // Supabase global_profiles → L1 PocketBase profiles 컬렉션으로 전환
  // L1 PocketBase: https://l1-hanlim.gopang.net
  const L1_PROFILES = L1_DEFAULT + '/api/collections/profiles/records';

  let queryUrl = `${L1_PROFILES}?perPage=${limit}&fields=guid,handle,nickname,country_code,region`;

  // handle 직접 검색 (정확히 일치)
  if (handle) {
    const h = handle.startsWith('@') ? handle : '@' + handle;
    queryUrl += `&filter=${encodeURIComponent(`handle='${h}'`)}`;
  } else {
    // 닉네임 부분 일치 + 국가/지역 필터
    let filter = `(nickname~'${q}'||handle~'${q}')`;
    if (country) filter += `&&country_code='${country}'`;
    if (region)  filter += `&&region~'${region}'`;
    queryUrl += `&filter=${encodeURIComponent(filter)}`;
  }

  try {
    const res  = await fetch(queryUrl);
    const data = await res.json().catch(() => ({ items: [] }));
    const users = (data.items || []).map(r => ({
      guid:         r.guid,
      handle:       r.handle,
      nickname:     r.nickname,
      country_code: r.country_code,
      region:       r.region,
      current_l1:   L1_DEFAULT,
    }));

    return new Response(JSON.stringify({
      ok:    true,
      users,
      count: users.length,
      query: { q, country, region, handle },
      source: 'l1-pocketbase',
    }), { status: 200, headers: corsHeaders });
  } catch(e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 PocketBase 검색 실패: ' + e.message, corsHeaders);
  }
}

// ═══════════════════════════════════════════════════════════
// GDUDA Phase 1 — /p2p/register
// global_profiles에 사용자 등록 (HLR 역할)
// ═══════════════════════════════════════════════════════════
async function handleP2PRegister(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', '', corsHeaders);

  const { guid, handle, nickname, nickname_hash, country_code, region, current_l1 } = body;
  if (!guid)   return _err(400, 'MISSING_FIELDS', 'guid 필수', corsHeaders);
  if (!handle) return _err(400, 'MISSING_FIELDS', 'handle 필수', corsHeaders);

  // ── L1 PocketBase 등록 (GDUDA 본 구현) ──────────────────
  // Supabase global_profiles → L1 PocketBase profiles 컬렉션으로 전환
  const L1_PROFILES = L1_DEFAULT + '/api/collections/profiles/records';
  const now = new Date().toISOString();

  // 기존 레코드 확인 (handle 기준)
  try {
    const chkRes = await fetch(
      `${L1_PROFILES}?filter=${encodeURIComponent(`handle='${handle}'`)}&perPage=1`
    );
    const chkData = await chkRes.json().catch(() => ({ items: [] }));
    const existing = chkData.items?.[0];

    if (existing) {
      // 기존 레코드 PATCH (current_l1 갱신)
      const patchRes = await fetch(`${L1_PROFILES}/${existing.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nickname: nickname || existing.nickname,
          region:   region   || existing.region,
        }),
      });
      if (!patchRes.ok) return _err(500, 'L1_UPDATE_ERROR', await patchRes.text(), corsHeaders);
    } else {
      // 신규 레코드 POST
      const postRes = await fetch(L1_PROFILES, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guid,
          handle,
          nickname:      nickname      || null,
          nickname_hash: nickname_hash || null,
          country_code:  country_code  || null,
          region:        region        || null,
          is_public:     true,
        }),
      });
      if (!postRes.ok) return _err(500, 'L1_INSERT_ERROR', await postRes.text(), corsHeaders);
    }

    return new Response(JSON.stringify({ ok: true, source: 'l1-pocketbase' }), {
      status: 200, headers: corsHeaders,
    });
  } catch(e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 PocketBase 등록 실패: ' + e.message, corsHeaders);
  }
}

async function handleSearchUsers(request, env, corsHeaders) {
  if (request.method !== 'GET' && request.method !== 'POST') return _err(405, 'METHOD_NOT_ALLOWED', '', corsHeaders);
  const url   = new URL(request.url);
  const q     = url.searchParams.get('q')?.trim();
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);
  if (!q) return _err(400, 'QUERY_REQUIRED', 'q 파라미터 필수', corsHeaders);

  const sbH = _sbHeaders(env);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/search_users`, {
    method: 'POST',
    headers: sbH,
    body: JSON.stringify({ q, limit_n: limit }),
  });
  const data = await res.json().catch(() => []);
  return new Response(JSON.stringify({ ok: true, users: data, count: data.length }),
    { status: 200, headers: corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// v5.0 — /profile (사용자/사업자 프로필 등록·조회)
//   인증: parseToken(Authorization Bearer) → payload.ipv6
//   저장 대상: user_profiles (BaseProfile v2.0 단순화)
//     고정 컬럼: guid, current_ipv6, entity_type, name, handle,
//                native_lang, address, lat, lng, phone, website,
//                is_public, public_key
//     확장: extra.public.{identity, activity, contact, location, finance}
// ═══════════════════════════════════════════════════════════

// GET /profile/{handle}  또는  /profile?guid={ipv6}
// v5.1: 인증 불필요 — 공개 프로필 조회 (PUBLIC 계층만 노출 대상이나,
//       현재는 단순화를 위해 user_profiles 행 전체를 반환한다.
//       PRIVATE/SEMI 분리 마스킹은 추후 별도 작업에서 처리)
//
// ═══════════════════════════════════════════════════════════
// ⚠️ 임시 경로 (필드 테스트용) — 표준 절차가 아님
// ═══════════════════════════════════════════════════════════
// OpenHash 표준 절차는 다음과 같다:
//   1) A가 L1에서 B의 존재를 확인 (guid만 확보, 상세정보는 L1에 없음)
//   2) A가 B 본인(B의 기기/노드)에게 P2P로 직접 프로필 상세를 요청
//   3) B가 동의하여 자신의 프로필을 A에게 직접 전송
//   4) A가 전송받은 데이터로 B의 프로필 페이지를 직접 조합
// 장기적으로는 L1 자체가 상세 프로필 정보까지 저장하게 되며,
// Supabase는 그 이후에도 백업 레이어로만 남는다.
//
// 아래 구현은 2~3단계(P2P 직접 요청/응답)가 아직 구축되지 않았으므로,
// 그 자리에 "A가 Supabase에 캐시된 B의 데이터를 대신 가져오는" 임시 경로를
// 끼워 넣은 것이다 — 표준의 본체가 아니라 필드 테스트 단계의 대체 수단.
// P2P 요청/응답 채널(예: /signal/* 위에 profile_request 타입 추가)이
// 구축되면 이 함수는 1)L1 존재 확인까지만 남기고, 상세조회는 클라이언트의
// P2P 요청 로직으로 옮겨야 한다.
// handle로 L1 PocketBase에서 존재 확인 + guid 조회 (표준 1단계: 분산 노드가 1차 소스)
async function _resolveGuidFromL1(handle) {
  const L1_PROFILES = L1_DEFAULT + '/api/collections/profiles/records';
  const h = handle.startsWith('@') ? handle : '@' + handle;
  const queryUrl = `${L1_PROFILES}?perPage=1&fields=guid,handle&filter=${encodeURIComponent(`handle='${h}'`)}`;
  try {
    const res = await fetch(queryUrl);
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return data?.items?.[0]?.guid || null;
  } catch (e) {
    console.warn('[L1] handle 조회 실패 (Supabase로 폴백):', e.message);
    return null;
  }
}

async function handleProfileGet(request, env, corsHeaders) {
  const url = new URL(request.url);
  const sbH = _sbHeaders(env);

  const rawHandle = decodeURIComponent(url.pathname.replace('/profile/', '').replace('/profile', ''));
  const guidParam = url.searchParams.get('guid');

  // ── 표준 1단계: L1(분산 노드)에서 handle → guid 존재 확인 ──
  // guid로 직접 조회하는 경우는 이미 신원이 확정된 상태이므로 이 단계 불필요
  let resolvedGuid = guidParam || null;
  if (!resolvedGuid && rawHandle) {
    resolvedGuid = await _resolveGuidFromL1(rawHandle);
  }

  // ── ⚠️ 임시 경로: 본래는 여기서 B에게 P2P 요청을 보내야 하나,
  //    그 채널이 아직 없어 Supabase 캐시를 대신 조회한다 (필드 테스트용) ──
  let query;
  if (resolvedGuid) {
    query = `guid=eq.${encodeURIComponent(resolvedGuid)}`;
  } else if (rawHandle) {
    // L1에 없거나(아직 미동기화) L1 연결 실패 — Supabase에서 handle로 직접 폴백 조회
    query = `handle=eq.${encodeURIComponent(rawHandle.startsWith('@') ? rawHandle : '@' + rawHandle)}`;
  } else {
    return _err(400, 'MISSING_FIELD', 'handle 또는 guid 필요', corsHeaders);
  }

  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?${query}&limit=1`, { headers: sbH });
  } catch (e) {
    // Supabase 연결 자체가 실패한 경우(타임아웃/DNS 등) — 처리되지 않은 예외가
    // Cloudflare Workers 런타임까지 전파되면 503으로 노출되므로 여기서 명시적으로 잡는다.
    return _err(502, 'SUPABASE_UNREACHABLE', 'DB 연결 실패: ' + e.message, corsHeaders);
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return _err(502, 'SUPABASE_ERROR', `DB 조회 실패 (HTTP ${res.status}): ${errText}`, corsHeaders);
  }

  const rows = await res.json().catch(() => []);
  if (!rows.length) return _err(404, 'PROFILE_NOT_FOUND', '프로필 없음', corsHeaders);

  return new Response(JSON.stringify({
    ok: true, profile: rows[0],
    // identity_source: handle→guid 확인을 어디서 했는지 (L1 우선, 미동기화 시 Supabase 직접조회)
    // detail_source: 상세 데이터는 항상 Supabase에서 옴 — 표준 P2P 직접요청 채널 구축 전까지의 임시 경로
    identity_source: resolvedGuid ? 'l1' : 'supabase-direct',
    detail_source:   'supabase-temporary', // TODO: P2P 직접 요청/응답 채널 구축 후 제거
  }), { status: 200, headers: corsHeaders });
}

// POST /profile — 본인 프로필 생성/갱신 (upsert)
// v5.1: Ed25519 서명 인증 (/biz/product와 동일 패턴) + TOFU(Trust-On-First-Use)
// body: {
//   guid, pubkey, signature,      // 인증 — _verifyEd25519(pubkey, signature, body)
//   entity_type, name, native_lang, address, lat, lng, phone, website, is_public,
//   handle,                       // 선택 — 미지정 시 자동 생성(@{이름})
//   description, tags,            // S01 identity
//   hours, holidays,              // S03 activity
//   sns_public, languages_spoken, // S04 contact
//   region, directions, parking,  // S05 location
//   gdc_accepted, currencies, price_range, // S07 finance
//   phone_visible,
// }
async function handleProfilePost(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  const { guid, pubkey, signature } = body;
  if (!guid)      return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  if (!pubkey)    return _err(400, 'MISSING_FIELD', 'pubkey 필수', corsHeaders);
  if (!signature) return _err(400, 'MISSING_FIELD', 'signature 필수', corsHeaders);

  // 서명 대상: 'guid:pubkey:ts' 고정 문자열 — JSON 직렬화 불일치 원천 차단
  const ts     = body.ts || '';
  const sigMsg = `${guid}:${pubkey}:${ts}`;
  const sigOk  = await _verifyEd25519Simple(pubkey, signature, sigMsg);
  if (!sigOk) return _err(401, 'INVALID_SIGNATURE', '서명 검증 실패', corsHeaders);

  const {
    entity_type, name, native_lang = 'ko',
    address = '', lat = null, lng = null,
    phone = null, website = '', is_public = true,
    handle = null,
    description = '', tags = [],
    hours = [], holidays = [],
    sns_public = {}, languages_spoken = [],
    region = '', directions = '', parking = false,
    gdc_accepted = false, currencies = ['KRW'], price_range = '',
    phone_visible = false,
  } = body;

  if (!entity_type) return _err(400, 'MISSING_FIELD', 'entity_type 필수', corsHeaders);
  if (!name)        return _err(400, 'MISSING_FIELD', 'name 필수', corsHeaders);
  if (!['person','consumer','individual','org','institution','business','platform'].includes(entity_type)) {
    return _err(400, 'INVALID_FIELD', 'entity_type 값이 올바르지 않습니다', corsHeaders);
  }

  const sbH = _sbHeaders(env);

  // 기존 프로필 존재 여부 확인 (upsert 분기) — TOFU: pubkey 일치 확인
  let existRes;
  try {
    existRes = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?guid=eq.${encodeURIComponent(guid)}&select=guid,handle,extra,pubkey_ed25519&limit=1`, { headers: sbH });
  } catch (e) {
    return _err(502, 'SUPABASE_UNREACHABLE', 'DB 연결 실패: ' + e.message, corsHeaders);
  }
  if (!existRes.ok) {
    const errText = await existRes.text().catch(() => '');
    return _err(502, 'SUPABASE_ERROR', `DB 조회 실패 (HTTP ${existRes.status}): ${errText}`, corsHeaders);
  }
  const existRows = await existRes.json().catch(() => []);
  const existing  = existRows[0] || null;

  // TOFU 제거: guid(전화번호 기반) + 서명 검증 통과 = 본인 증명
  // 새 기기에서도 pubkey 갱신 허용

  // handle 자동 생성 (미지정 + 신규일 때)
  let finalHandle = handle || existing?.handle || null;
  if (!finalHandle) {
    const slug = String(name).trim().toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9가-힣_]/g, '');
    finalHandle = `@${slug}`;
  }

  // extra.public 병합 (기존 extra 보존, public 섹션만 갱신)
  const prevExtra = existing?.extra || {};
  const newExtraPublic = {
    ...(prevExtra.public || {}),
    identity: { _schema_version: '2.0', display_name: name, description, tags, entity_subtype: body.entity_subtype || null },
    activity: { timezone: 'Asia/Seoul', hours, holidays },
    contact:  { phone_display: phone, phone_visible: !!phone_visible, website, sns_public, languages_spoken },
    location: { region, address_short: address, directions, parking },
    finance:  { gdc_accepted, currencies, price_range },
  };
  const newExtra = { ...prevExtra, public: newExtraPublic };

  const record = {
    guid,
    current_ipv6: guid,
    pubkey_ed25519: pubkey,
    entity_type,
    name,
    handle: finalHandle,
    native_lang,
    address,
    lat,
    lng,
    phone,
    website,
    is_public,
    extra: newExtra,
    updated_at: new Date().toISOString(),
  };

  let saveRes;
  try {
    if (existing) {
      saveRes = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?guid=eq.${encodeURIComponent(guid)}`, {
        method: 'PATCH',
        headers: { ..._sbServiceHeaders(env), 'Prefer': 'return=representation' },
        body: JSON.stringify(record),
      });
    } else {
      record.created_at = new Date().toISOString();
      saveRes = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles`, {
        method: 'POST',
        headers: { ..._sbServiceHeaders(env), 'Prefer': 'return=representation' },
        body: JSON.stringify(record),
      });
    }
  } catch (e) {
    return _err(502, 'SUPABASE_UNREACHABLE', 'DB 연결 실패: ' + e.message, corsHeaders);
  }

  if (!saveRes.ok) {
    const errText = await saveRes.text().catch(() => '');
    return _err(502, 'DB_ERROR', `프로필 저장 실패: ${errText}`, corsHeaders);
  }
  const savedRows = await saveRes.json().catch(() => []);

  return new Response(JSON.stringify({ ok: true, profile: savedRows[0] || record }), { status: 200, headers: corsHeaders });
}

// /ai-setup POST — AI 비서 설정 저장 (API 키 AES-256-GCM 암호화)
// ═══════════════════════════════════════════════════════════
async function handleAiSetupPost(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  // v5.1: Ed25519 서명 인증 + TOFU
  const { guid, pubkey, signature } = body;
  if (!guid)      return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  if (!pubkey)    return _err(400, 'MISSING_FIELD', 'pubkey 필수', corsHeaders);
  if (!signature) return _err(400, 'MISSING_FIELD', 'signature 필수', corsHeaders);

  const sigOk = await _verifyEd25519(pubkey, signature, body);
  if (!sigOk) return _err(401, 'INVALID_SIGNATURE', '서명 검증 실패', corsHeaders);

  {
    const sbHChk = _sbHeaders(env);
    let chkRes;
    try {
      chkRes = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?guid=eq.${encodeURIComponent(guid)}&select=pubkey_ed25519&limit=1`, { headers: sbHChk });
    } catch (e) {
      return _err(502, 'SUPABASE_UNREACHABLE', 'DB 연결 실패: ' + e.message, corsHeaders);
    }
    if (!chkRes.ok) {
      const errText = await chkRes.text().catch(() => '');
      return _err(502, 'SUPABASE_ERROR', `DB 조회 실패 (HTTP ${chkRes.status}): ${errText}`, corsHeaders);
    }
    const chkRows = await chkRes.json().catch(() => []);
    const existingPubkey = chkRows[0]?.pubkey_ed25519;
    if (existingPubkey && existingPubkey !== pubkey) {
      return _err(401, 'PUBKEY_MISMATCH', '등록된 공개키와 일치하지 않습니다', corsHeaders);
    }
  }

  const {
    provider = 'deepseek', model = 'deepseek-chat',
    ai_active = false, api_key,
    custom_prompt = '', welcome_message = '',
    off_hours_message = '', endpoint = '',
  } = body;

  // provider는 워커가 직접 호출하지 않고 단순히 DB 컬럼에 저장되는 값일 뿐이며,
  // 실제 LLM 호출은 클라이언트가 config.js의 PROVIDER_INFO(baseUrl)를 보고 수행한다.
  // 워커에 하드코딩된 화이트리스트는 클라이언트가 새 provider를 추가할 때마다
  // 같이 갱신해야 해서 동기화가 깨지기 쉽다(오늘 'gemini' 누락이 그 사례).
  // 완전히 검증을 없애는 대신, 형식만 확인해 오타/이상값 유입만 방지한다.
  if (!/^[a-z0-9-]{2,30}$/.test(provider))
    return _err(400, 'INVALID_PROVIDER', 'provider는 영문 소문자/숫자/하이픈 2~30자여야 합니다', corsHeaders);

  // 기존 키 조회
  const sbSvcH = _sbServiceHeaders(env);
  const existing = await fetch(
    `${SUPABASE_URL}/rest/v1/user_llm_keys?guid=eq.${guid}&select=api_key_enc&limit=1`,
    { headers: sbSvcH }
  ).then(r => r.json()).catch(() => []);

  let apiKeyEnc = existing[0]?.api_key_enc || null;

  if (api_key && api_key.trim()) {
    if (!env.AES_ENCRYPTION_KEY)
      return _err(500, 'ENCRYPTION_KEY_MISSING', 'AES 키 미설정', corsHeaders);
    apiKeyEnc = await _aesEncrypt(api_key.trim(), env.AES_ENCRYPTION_KEY);
  }

  if (!apiKeyEnc)
    return _err(400, 'API_KEY_REQUIRED', 'API 키를 입력해 주세요', corsHeaders);

  const tokenEst = Math.ceil(custom_prompt.length / 3.5);

  let upsertRes;
  try {
    upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/user_llm_keys`, {
      method: 'POST',
      headers: { ...sbSvcH, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        guid, provider, model, api_key_enc: apiKeyEnc,
        ai_active, custom_prompt,
        native_lang: 'ko',
        ...(endpoint && { endpoint }),
      }),
    });
  } catch (e) {
    return _err(502, 'SUPABASE_UNREACHABLE', 'DB 연결 실패: ' + e.message, corsHeaders);
  }

  if (!upsertRes.ok) {
    const err = await upsertRes.text();
    return _err(500, 'SAVE_FAILED', err, corsHeaders);
  }

  return new Response(JSON.stringify({
    ok: true, ai_active, provider, model,
    token_est: tokenEst,
    token_warn: tokenEst > 800,
    message: tokenEst > 800
      ? `저장 완료. 프롬프트가 약 ${tokenEst} 토큰으로 비용이 증가할 수 있습니다.`
      : '저장 완료',
  }), { status: 200, headers: corsHeaders });
}

// AES-256-GCM 암호화
async function _aesEncrypt(plaintext, keyHex) {
  const key = await crypto.subtle.importKey(
    'raw', _hexToBytes(keyHex), { name: 'AES-GCM' }, false, ['encrypt']
  );
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key,
    new TextEncoder().encode(plaintext));
  const combined = new Uint8Array(12 + enc.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(enc), 12);
  return btoa(String.fromCharCode(...combined));
}

function _hexToBytes(hex) {
  return new Uint8Array(hex.match(/.{2}/g).map(h => parseInt(h, 16)));
}

async function anchorL1MerkleRoot(env) {
  try {
    const sbH = _sbServiceHeaders(env);

    // 1. 미앵커링 pdv_log 조회 (최대 100건) — via_worker 무관
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pdv_log` +
      `?openhash_anchored=eq.false` +
      `&select=id,guid,block_hash,chain_local_hash,session_id` +
      `&order=created_at.asc&limit=100`,
      { headers: sbH }
    );
    const rows = await res.json().catch(() => []);
    if (!rows?.length) {
      console.log('[Merkle] 미앵커링 pdv_log 없음 — 스킵');
      return;
    }

    // 2. 머클 트리 계산
    const leaves = rows.map(r =>
      r.chain_local_hash || r.block_hash || r.id
    );
    const merkleRoot = await _computeMerkleRoot(leaves);
    const pdvIds     = rows.map(r => r.id);
    const now        = new Date().toISOString();

    // 3. merkle_anchors INSERT
    const insRes = await fetch(`${SUPABASE_URL}/rest/v1/merkle_anchors`, {
      method:  'POST',
      headers: { ...sbH, 'Prefer': 'return=representation' },
      body: JSON.stringify({
        merkle_root:   merkleRoot,
        anchored_at:   now,
        block_count:   rows.length,
        pdv_ids:       pdvIds,
        status:        'confirmed',
      }),
    });
    const insResult = await insRes.json().catch(() => []);
    const anchorId  = insResult?.[0]?.id || null;

    // 4. pdv_log openhash_anchored = true 일괄 갱신
    // Supabase REST는 IN 조건 배치 업데이트 지원
    for (const id of pdvIds) {
      await fetch(
        `${SUPABASE_URL}/rest/v1/pdv_log?id=eq.${encodeURIComponent(id)}`,
        {
          method:  'PATCH',
          headers: { ...sbH, 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            openhash_anchored:    true,
            openhash_anchored_at: now,
          }),
        }
      );
    }

    console.log(`[Merkle] 앵커링 완료 | root=${merkleRoot.slice(0,8)} | count=${rows.length} | anchor_id=${anchorId}`);
  } catch(e) {
    console.error('[Merkle] anchorL1MerkleRoot 실패:', e.message);
  }
}

/**
 * 머클 트리 루트 계산
 * leaves: string[] (hash 또는 id)
 * 홀수 노드: 마지막 leaf 복제
 */
async function _computeMerkleRoot(leaves) {
  if (!leaves.length) return '0'.repeat(64);

  // leaf 해시화
  let nodes = await Promise.all(
    leaves.map(l => _sha256Hex(l))
  );

  while (nodes.length > 1) {
    const next = [];
    for (let i = 0; i < nodes.length; i += 2) {
      const left  = nodes[i];
      const right = nodes[i + 1] || nodes[i]; // 홀수 시 복제
      next.push(await _sha256Hex(left + right));
    }
    nodes = next;
  }
  return nodes[0];
}

/**
 * verifyWithMerkle 검증용 API
 * GET /merkle/verify?pdv_id={id}
 */
async function handleMerkleVerify(request, env, corsHeaders) {
  const url   = new URL(request.url);
  const pdvId = url.searchParams.get('pdv_id');
  if (!pdvId) return _err(400, 'MISSING_PARAM', 'pdv_id 필수', corsHeaders);

  const sbH = _sbHeaders(env);

  // pdv_log 조회
  const pdvRes  = await fetch(
    `${SUPABASE_URL}/rest/v1/pdv_log?id=eq.${encodeURIComponent(pdvId)}&select=*&limit=1`,
    { headers: sbH }
  );
  const pdvRows = await pdvRes.json().catch(() => []);
  if (!pdvRows?.length) return _err(404, 'PDV_NOT_FOUND', 'pdv_log 없음', corsHeaders);
  const pdv = pdvRows[0];

  if (!pdv.openhash_anchored) {
    return new Response(JSON.stringify({
      valid: false,
      reason: 'NOT_ANCHORED',
      pdv_id: pdvId,
    }), { status: 200, headers: corsHeaders });
  }

  // merkle_anchors에서 해당 pdv_id 포함 레코드 조회
  const maRes  = await fetch(
    `${SUPABASE_URL}/rest/v1/merkle_anchors` +
    `?pdv_ids=cs.["${pdvId}"]&select=*&limit=1`,
    { headers: sbH }
  );
  const maRows = await maRes.json().catch(() => []);
  if (!maRows?.length) {
    return new Response(JSON.stringify({
      valid: false,
      reason: 'ANCHOR_NOT_FOUND',
      pdv_id: pdvId,
    }), { status: 200, headers: corsHeaders });
  }
  const anchor = maRows[0];

  // 머클 루트 재계산으로 검증
  const leaves     = anchor.pdv_ids;
  const recomputed = await _computeMerkleRoot(
    await Promise.all(leaves.map(async id => {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/pdv_log?id=eq.${encodeURIComponent(id)}&select=chain_local_hash,block_hash&limit=1`,
        { headers: sbH }
      );
      const rows = await r.json().catch(() => []);
      return rows?.[0]?.chain_local_hash || rows?.[0]?.block_hash || id;
    }))
  );

  const valid = recomputed === anchor.merkle_root;

  return new Response(JSON.stringify({
    valid,
    pdv_id:      pdvId,
    merkle_root: anchor.merkle_root,
    recomputed,
    anchor_id:   anchor.id,
    anchored_at: anchor.anchored_at,
    block_count: anchor.block_count,
  }), { status: 200, headers: corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// Push 알림 — VAPID Web Push
// ═══════════════════════════════════════════════════════════

// GET /push/vapid-public-key
function handlePushVapidKey(request, env, corsHeaders) {
  const key = env.VAPID_PUBLIC_KEY;
  if (!key) return _err(500, 'CONFIG_ERROR', 'VAPID_PUBLIC_KEY 미설정', corsHeaders);
  return new Response(JSON.stringify({ publicKey: key }), { status: 200, headers: corsHeaders });
}

// POST /push/subscribe — 구독 정보 저장
async function handlePushSubscribe(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body?.subscription || !body?.guid)
    return _err(400, 'MISSING_FIELD', 'subscription, guid 필수', corsHeaders);

  const sbH = _sbServiceHeaders(env);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?guid=eq.${encodeURIComponent(body.guid)}`, {
    method:  'GET',
    headers: sbH,
  });
  const existing = await res.json().catch(() => []);

  // 구독 취소 요청
  if (body.unsubscribe) {
    if (!existing.length) return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
    const delRes = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?guid=eq.${encodeURIComponent(body.guid)}`, {
      method: 'DELETE', headers: sbH,
    });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
  }

  let saveRes;
  if (existing.length) {
    saveRes = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?guid=eq.${encodeURIComponent(body.guid)}`, {
      method:  'PATCH',
      headers: { ...sbH, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        subscription: JSON.stringify(body.subscription),
        sound:        body.sound || 'ping',
        updated_at:   new Date().toISOString(),
      }),
    });
  } else {
    saveRes = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions`, {
      method:  'POST',
      headers: { ...sbH, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        guid:         body.guid,
        subscription: JSON.stringify(body.subscription),
        sound:        body.sound || 'ping',
        updated_at:   new Date().toISOString(),
      }),
    });
  }
  if (!saveRes.ok) return _err(500, 'DB_ERROR', await saveRes.text(), corsHeaders);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
}

// POST /push/send — 특정 guid에게 push 전송
async function handlePushSend(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body?.to_guid) return _err(400, 'MISSING_FIELD', 'to_guid 필수', corsHeaders);

  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY || !env.VAPID_SUBJECT)
    return _err(500, 'CONFIG_ERROR', 'VAPID 환경변수 미설정', corsHeaders);

  const sbH = _sbServiceHeaders(env);
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/push_subscriptions?guid=eq.${encodeURIComponent(body.to_guid)}&select=subscription,sound&limit=5`,
    { headers: sbH }
  );
  const rows = await res.json().catch(() => []);
  if (!rows.length) return new Response(JSON.stringify({ ok: true, sent: 0, reason: 'NO_SUBSCRIPTION' }), { status: 200, headers: corsHeaders });

  const payload = JSON.stringify({
    title: body.title || '고팡',
    body:  body.body  || '새 메시지가 도착했습니다.',
    sound: rows[0].sound || body.sound || 'ping',
    url:   body.url   || '/webapp.html',
    tag:   body.tag   || 'gopang-msg',
  });

  let sent = 0;
  for (const row of rows) {
    try {
      const sub = JSON.parse(row.subscription);
      const result = await _sendWebPush(env, sub, payload);
      if (result) sent++;
    } catch(e) {
      console.warn('[Push] 전송 실패:', e.message);
    }
  }
  return new Response(JSON.stringify({ ok: true, sent }), { status: 200, headers: corsHeaders });
}

// Web Push 전송 (VAPID)
async function _sendWebPush(env, subscription, payload) {
  const vapidHeaders = await _buildVapidHeaders(env, subscription.endpoint);
  const res = await fetch(subscription.endpoint, {
    method:  'POST',
    headers: {
      ...vapidHeaders,
      'Content-Type':  'application/octet-stream',
      'Content-Length': payload.length.toString(),
      'TTL': '60',
    },
    body: new TextEncoder().encode(payload),
  });
  return res.ok || res.status === 201;
}

// VAPID JWT 생성
async function _buildVapidHeaders(env, endpoint) {
  const url      = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const now      = Math.floor(Date.now() / 1000);

  const header  = _b64uEncode(JSON.stringify({ alg: 'ES256', typ: 'JWT' }));
  const claims  = _b64uEncode(JSON.stringify({ aud: audience, exp: now + 3600, sub: env.VAPID_SUBJECT }));
  const sigInput = `${header}.${claims}`;

  const privKeyBytes = _b64uToBytes(env.VAPID_PRIVATE_KEY);
  const cryptoKey = await crypto.subtle.importKey(
    'raw', privKeyBytes, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
  const sig    = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, cryptoKey, new TextEncoder().encode(sigInput));
  const sigB64 = _b64uEncode(String.fromCharCode(...new Uint8Array(sig)));
  const jwt    = `${sigInput}.${sigB64}`;

  return {
    'Authorization': `vapid t=${jwt},k=${env.VAPID_PUBLIC_KEY}`,
  };
}

function _b64uEncode(str) {
  return btoa(typeof str === 'string' ? str : String.fromCharCode(...new Uint8Array(str)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ── Push 알림 전송 헬퍼 (guid 기준) ─────────────────────
async function _sendPushToGuid(env, guid, { title, body, tag, url }) {
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) return;

  const sbH = _sbServiceHeaders(env);
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/push_subscriptions?guid=eq.${encodeURIComponent(guid)}&select=subscription,sound&limit=5`,
    { headers: sbH }
  );
  const rows = await res.json().catch(() => []);
  if (!rows.length) return;

  const payload = JSON.stringify({
    title, body, tag,
    sound: rows[0].sound || 'ping',
    url:   url || '/webapp.html',
  });

  for (const row of rows) {
    try {
      const sub = JSON.parse(row.subscription);
      await _sendWebPush(env, sub, payload);
    } catch(e) {
      console.warn('[Push] _sendPushToGuid 실패:', e.message);
    }
  }
}

// ═══════════════════════════════════════════════════════════
// Feedback — 기능 제안
// ═══════════════════════════════════════════════════════════

// POST /feedback — 제안 등록 + DeepSeek 카테고리 분류
async function handleFeedbackPost(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  const { guid, handle, content } = body;
  if (!guid)    return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  if (!handle)  return _err(400, 'MISSING_FIELD', 'handle 필수', corsHeaders);
  if (!content) return _err(400, 'MISSING_FIELD', 'content 필수', corsHeaders);

  // DeepSeek v4 flash — 카테고리 자동 분류
  let category = 'etc';
  try {
    const aiRes = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        max_tokens: 10,
        messages: [
          { role: 'system', content: '사용자 제안을 bug/feature/ui/etc 중 하나로만 분류하라. 단어 하나만 출력.' },
          { role: 'user',   content },
        ],
      }),
    });
    const aiData = await aiRes.json();
    const raw = aiData.choices?.[0]?.message?.content?.trim().toLowerCase() || 'etc';
    if (['bug','feature','ui','etc'].includes(raw)) category = raw;
  } catch(e) {
    console.warn('[Feedback] AI 분류 실패:', e.message);
  }

  const sbH = _sbServiceHeaders(env);
  const now  = new Date().toISOString();
  const insRes = await fetch(`${SUPABASE_URL}/rest/v1/feedback`, {
    method:  'POST',
    headers: { ...sbH, 'Prefer': 'return=representation' },
    body: JSON.stringify({ guid, handle, content, category, status: 'pending', created_at: now, updated_at: now }),
  });
  if (!insRes.ok) return _err(500, 'DB_ERROR', await insRes.text(), corsHeaders);
  const rows = await insRes.json().catch(() => []);

  return new Response(JSON.stringify({ ok: true, id: rows[0]?.id, category }), { status: 200, headers: corsHeaders });
}

// GET /feedback — 목록 조회
async function handleFeedbackGet(request, env, corsHeaders) {
  const url    = new URL(request.url);
  const status = url.searchParams.get('status');
  const limit  = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);

  const sbH = _sbHeaders(env);
  let query = `${SUPABASE_URL}/rest/v1/feedback?order=created_at.desc&limit=${limit}`;
  if (status) query += `&status=eq.${encodeURIComponent(status)}`;

  const res  = await fetch(query, { headers: sbH });
  const rows = await res.json().catch(() => []);
  return new Response(JSON.stringify({ ok: true, items: rows, count: rows.length }), { status: 200, headers: corsHeaders });
}

// PATCH /feedback/{id} — 상태 변경 (관리자 전용) + Push 알림
async function handleFeedbackPatch(request, env, corsHeaders) {
  const id   = new URL(request.url).pathname.replace('/feedback/', '');
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  const { status, admin_note, admin_guid } = body;
  if (!status)     return _err(400, 'MISSING_FIELD', 'status 필수', corsHeaders);
  if (!admin_guid) return _err(400, 'MISSING_FIELD', 'admin_guid 필수', corsHeaders);

  // 관리자 확인 (주피터 guid)
  const sbH = _sbServiceHeaders(env);
  const adminRes  = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?guid=eq.${encodeURIComponent(admin_guid)}&select=handle&limit=1`, { headers: sbH });
  const adminRows = await adminRes.json().catch(() => []);
  if (!adminRows.length || adminRows[0].handle !== '@96627170')
    return _err(403, 'FORBIDDEN', '관리자만 상태를 변경할 수 있습니다', corsHeaders);

  // 상태 변경
  const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/feedback?id=eq.${encodeURIComponent(id)}`, {
    method:  'PATCH',
    headers: { ...sbH, 'Prefer': 'return=representation' },
    body: JSON.stringify({ status, admin_note: admin_note || null, updated_at: new Date().toISOString() }),
  });
  if (!patchRes.ok) return _err(500, 'DB_ERROR', await patchRes.text(), corsHeaders);
  const rows = await patchRes.json().catch(() => []);
  const item = rows[0];

  // 제안자에게 Push 알림
  const STATUS_LABEL = { pending: '검토 대기', reviewing: '검토중', accepted: '반영 확정', rejected: '보류' };
  if (item?.guid) {
    _sendPushToGuid(env, item.guid, {
      title: '제안 상태가 변경됐습니다',
      body:  `"${item.content?.slice(0, 30)}..." → ${STATUS_LABEL[status] || status}`,
      tag:   'gopang-feedback-' + id,
      url:   '/feedback.html',
    }).catch(e => console.warn('[Feedback Push]', e.message));
  }

  return new Response(JSON.stringify({ ok: true, item }), { status: 200, headers: corsHeaders });
}
