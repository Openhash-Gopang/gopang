/**
 * phase26_gdc_commerce.test.mjs
 *
 * GDC 상거래 완성 계획서(docs/gdc_commerce_completion_plan_v0_1.md)
 * Phase 1~5 워커통합(Worker Integration) 자동화 테스트. 2026-07-19 신설.
 *
 * 배경: 2026-07-18 배치들(fix10~fix13)이 pages/scenario-test.html에
 * 수동 체크리스트 항목(GDC01~GDC09)만 추가하고 실제 자동화 테스트(.mjs)를
 * 만들지 않은 게 지적됐다 — 같은 시점 다른 작업(insurance/admin 등)은
 * 전부 테스트를 동반했는데 이 부분만 빠져 있었다. 이 파일이 그 공백을
 * 메운다. phase25_security_regression.test.mjs와 동일한 워커통합 방식
 * (worker.js 직접 import + L1 mock, 라이브 인프라 불필요)을 그대로 쓴다.
 *
 * 커버리지 범위 — 전부 worker.js 레벨에서 검증 가능한 것만:
 *   GDC02 거래목적 분류(purpose/memo 필수화) — handleGdcTransfer
 *   GDC03 판매자 인증 문턱(₮50) — handleGdcTransfer + _lookupSellerVerification
 *   GDC04 판매자 인증 제출→승인 전체 흐름 — handleSellerVerify{Submit,Queue,Review}
 *   GDC05 거래 이의제기 당사자 제한 — handleTradeDisputeSubmit
 *   GDC07 재무제표 대사 — handleLedgerReconcile
 *   GDC08 발행잔액 집계 — handleLedgerIssuanceSummary
 *
 * 커버리지 밖(이 방식으로 테스트 불가, 다른 수단 필요):
 *   GDC01 Ed25519 서명 암호학적 검증 — pb_hooks/main.pb.js(Goja) 안에
 *     있어서 worker.js import로는 안 닿는다. 2026-07-18 hanlim 실배포
 *     환경에서 curl로 직접 검증 완료(위조서명 TX_HASH_MISMATCH로 차단,
 *     정상서명 통과) — 그 결과가 유일한 증거이며, 여기서 재현하려면
 *     별도로 Goja 호환 순수 JS 구현체를 Node에서 그대로 실행하는 단위
 *     테스트가 필요하다(다음 과제로 남김).
 *   GDC06 ledger_entries 기록 3종(tx/ai-charge/mint) — 전부 pb_hooks
 *     안에서 일어나는 일이라 마찬가지로 이 방식으론 불가. mint 1건은
 *     hanlim에서 실제로 확인됨(credit/bs-cash/mint), tx·ai-charge
 *     경로는 아직 실거래 미확인 상태 그대로다.
 *   GDC09 지갑 18개 저장소 드리프트 — 코드 로직이 아니라 배포 상태
 *     확인이라 이 테스트 방식과 무관.
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ══════════════════════════════════════════════════════════════════
// 픽스처 — 가짜 L1 PocketBase. phase25_security_regression.test.mjs의
// installMockFetch()와 동일 패턴(재사용 안 하고 복붙한 이유: 그쪽은
// profiles 컬렉션 전용으로 짜여 있고, 여기는 컬렉션 종류가 더 많아
// 범용화가 필요해서 이 파일 안에서 완결시켰다 — 다음에 두 파일이 또
// 늘어나면 공통 헬퍼 모듈로 뽑아낼 것).
// ══════════════════════════════════════════════════════════════════

let db;
let idSeq;

function resetDb() {
  db = { profiles: [], admin_guids: [], seller_verifications: [], ledger_entries: [], transaction_disputes: [] };
  idSeq = 0;
}

function evalFilter(rec, filter) {
  const decoded = decodeURIComponent(filter);
  // 이 테스트가 실제로 만드는 필터들: "guid='xxx'", "guid='xxx' && active=true",
  // "tx_id='xxx' && guid='yyy'", "status='pending'", "source='mint'",
  // "status != 'resolved'" — 전부 &&로 묶인 단순 등호/부등호 절의 조합이다.
  const clauses = decoded.split('&&').map(s => s.trim());
  return clauses.every(clause => {
    let m = clause.match(/^(\w+)\s*!=\s*'(.*)'$/);
    if (m) return String(rec[m[1]] ?? '') !== m[2].replace(/\\'/g, "'");
    m = clause.match(/^(\w+)\s*=\s*'(.*)'$/);
    if (m) return String(rec[m[1]] ?? '') === m[2].replace(/\\'/g, "'");
    m = clause.match(/^(\w+)\s*=\s*(true|false)$/);
    if (m) return Boolean(rec[m[1]]) === (m[2] === 'true');
    throw new Error(`mock: 필터 절 파싱 실패: ${clause}`);
  });
}

function installMockFetch() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));

    if (u.pathname === '/api/admins/auth-with-password') {
      return new Response(JSON.stringify({ token: 'mock-admin-token' }), { status: 200 });
    }

    // /api/balance — pb_hooks의 커스텀 라우트(컬렉션 REST 아님).
    // handleLedgerReconcile이 조회한다 — 테스트마다 MOCK_BALANCE로 값을 주입.
    if (u.pathname === '/api/balance') {
      return new Response(JSON.stringify({ ok: true, balance: globalThis.__MOCK_BALANCE__ ?? 0 }), { status: 200 });
    }

    const collMatch = u.pathname.match(/^\/api\/collections\/(\w+)\/records\/?(.*)$/);
    if (!collMatch) throw new Error(`mock: 처리 못하는 경로: ${u.pathname}`);
    const [, collection, recordId] = collMatch;
    if (!db[collection]) throw new Error(`mock: 알 수 없는 컬렉션: ${collection}`);

    if ((!init.method || init.method === 'GET') && !recordId) {
      const filter = u.searchParams.get('filter');
      let items = db[collection];
      if (filter) items = items.filter(r => evalFilter(r, filter));
      const perPage = Number(u.searchParams.get('perPage') || 30);
      const page = Number(u.searchParams.get('page') || 1);
      const start = (page - 1) * perPage;
      const pageItems = items.slice(start, start + perPage);
      const totalPages = Math.max(1, Math.ceil(items.length / perPage));
      return new Response(JSON.stringify({ items: pageItems, page, perPage, totalItems: items.length, totalPages }), { status: 200 });
    }

    if (init.method === 'POST' && !recordId) {
      const body = JSON.parse(init.body);
      const rec = { id: `mock_${collection}_${++idSeq}`, created: new Date().toISOString(), ...body };
      db[collection].push(rec);
      return new Response(JSON.stringify(rec), { status: 200 });
    }

    if (init.method === 'PATCH' && recordId) {
      const idx = db[collection].findIndex(r => r.id === recordId);
      if (idx === -1) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
      const body = JSON.parse(init.body);
      db[collection][idx] = { ...db[collection][idx], ...body };
      return new Response(JSON.stringify(db[collection][idx]), { status: 200 });
    }

    throw new Error(`mock: 처리 못하는 요청: ${init.method || 'GET'} ${u.pathname}`);
  };
  return () => { globalThis.fetch = realFetch; };
}

// ══════════════════════════════════════════════════════════════════
// Ed25519 헬퍼 — worker.js의 _verifyEd25519Simple과 호환
// ══════════════════════════════════════════════════════════════════

function toB64u(bytes) {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function genKeyPair() {
  const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const rawPub = await crypto.subtle.exportKey('raw', kp.publicKey);
  return { privateKey: kp.privateKey, pubkeyB64u: toB64u(rawPub) };
}

async function sign(privateKey, message) {
  const sig = await crypto.subtle.sign('Ed25519', privateKey, new TextEncoder().encode(message));
  return toB64u(sig);
}

// admin_guids/seller_verifications 흐름에서 서명 검증을 통과하려면
// profiles에 해당 guid의 pubkey_ed25519가 등록돼 있어야 한다
// (_verifyClaimsRequester의 TOFU 확인 — worker.js 참고).
function seedProfile(guid, pubkeyB64u) {
  db.profiles.push({ id: `mock_profiles_${++idSeq}`, guid, pubkey_ed25519: pubkeyB64u });
}

async function makeAuthParams(guid, privateKey, pubkeyB64u, prefix) {
  const ts = Date.now().toString();
  const sigMsg = `${prefix}:${guid}:${pubkeyB64u}:${ts}`;
  const signature = await sign(privateKey, sigMsg);
  return { admin_guid: guid, pubkey: pubkeyB64u, signature, ts };
}

// ══════════════════════════════════════════════════════════════════

let worker;
const ENV = { L1_ADMIN_EMAIL: 'admin@test', L1_ADMIN_PASSWORD: 'pw' };

before(async () => {
  installMockFetch();
  worker = (await import('../../../worker.js')).default;
});

beforeEach(() => { resetDb(); globalThis.__MOCK_BALANCE__ = 0; });

function req(pathname, { method = 'GET', body, search } = {}) {
  const url = new URL(`https://hondi-proxy.example${pathname}`);
  if (search) for (const [k, v] of Object.entries(search)) url.searchParams.set(k, v);
  return new Request(url, {
    method,
    headers: { 'Origin': 'http://localhost', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function call(pathname, opts) {
  const res = await worker.fetch(req(pathname, opts), ENV, {});
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

// ══════════════════════════════════════════════════════════════════
// GDC02 — 거래목적 분류(Phase 1)
// ══════════════════════════════════════════════════════════════════
describe('GDC02: 거래목적 분류', () => {
  it('purpose=purchase인데 memo가 비어있으면 MEMO_REQUIRED_FOR_PURCHASE로 거부', async () => {
    const { status, json } = await call('/wallet/gdc-transfer', {
      method: 'POST',
      body: {
        tx_hash: 'a'.repeat(64), sender_sig: 'x', sender_public_key: 'y',
        from_guid: 'guid-a', to_guid: 'guid-b', amount: 100,
        purpose: 'purchase', memo: '',
      },
    });
    assert.equal(status, 400);
    assert.equal(json.error, 'MEMO_REQUIRED_FOR_PURCHASE');
  });

  it('purpose=transfer는 memo 없이도 이 검증 단계는 통과(그 이후 단계에서 막힐 수 있음)', async () => {
    const { json } = await call('/wallet/gdc-transfer', {
      method: 'POST',
      body: {
        tx_hash: 'a'.repeat(64), sender_sig: 'x', sender_public_key: 'y',
        from_guid: 'guid-a', to_guid: 'guid-b', amount: 100,
        purpose: 'transfer', memo: '',
      },
    });
    assert.notEqual(json.error, 'MEMO_REQUIRED_FOR_PURCHASE');
  });

  it("purpose가 'transfer'/'purchase' 외 값이면 INVALID_PURPOSE로 거부", async () => {
    const { status, json } = await call('/wallet/gdc-transfer', {
      method: 'POST',
      body: {
        tx_hash: 'a'.repeat(64), sender_sig: 'x', sender_public_key: 'y',
        from_guid: 'guid-a', to_guid: 'guid-b', amount: 100,
        purpose: 'gift',
      },
    });
    assert.equal(status, 400);
    assert.equal(json.error, 'INVALID_PURPOSE');
  });
});

// ══════════════════════════════════════════════════════════════════
// GDC03 — 판매자 인증 문턱(Phase 2)
// ══════════════════════════════════════════════════════════════════
describe('GDC03: 판매자 인증 문턱(₮50)', () => {
  it('₮50 초과 purchase + 미인증 판매자 → SELLER_NOT_VERIFIED(403)', async () => {
    const { status, json } = await call('/wallet/gdc-transfer', {
      method: 'POST',
      body: {
        tx_hash: 'a'.repeat(64), sender_sig: 'x', sender_public_key: 'y',
        from_guid: 'guid-a', to_guid: 'guid-b', amount: 51,
        purpose: 'purchase', memo: '짜장면',
      },
    });
    assert.equal(status, 403);
    assert.equal(json.error, 'SELLER_NOT_VERIFIED');
  });

  it('₮50 이하 purchase는 미인증 판매자여도 이 문턱 검증은 통과', async () => {
    const { json } = await call('/wallet/gdc-transfer', {
      method: 'POST',
      body: {
        tx_hash: 'a'.repeat(64), sender_sig: 'x', sender_public_key: 'y',
        from_guid: 'guid-a', to_guid: 'guid-b', amount: 50,
        purpose: 'purchase', memo: '짜장면',
      },
    });
    assert.notEqual(json.error, 'SELLER_NOT_VERIFIED');
  });

  it('₮50 초과 purchase + verified 판매자 → 이 문턱 검증은 통과', async () => {
    db.seller_verifications.push({ id: 'sv1', guid: 'guid-b', status: 'verified' });
    const { json } = await call('/wallet/gdc-transfer', {
      method: 'POST',
      body: {
        tx_hash: 'a'.repeat(64), sender_sig: 'x', sender_public_key: 'y',
        from_guid: 'guid-a', to_guid: 'guid-b', amount: 100,
        purpose: 'purchase', memo: '짜장면',
      },
    });
    assert.notEqual(json.error, 'SELLER_NOT_VERIFIED');
  });
});

// ══════════════════════════════════════════════════════════════════
// GDC04 — 판매자 인증 제출 → 승인 전체 흐름
// ══════════════════════════════════════════════════════════════════
describe('GDC04: 판매자 인증 제출 → 승인', () => {
  it('제출(verify-submit) 시 status=pending으로 생성됨', async () => {
    const { status, json } = await call('/seller/verify-submit', {
      method: 'POST',
      body: { guid: 'guid-b', biz_reg_hash: 'a'.repeat(64), biz_reg_filename: 'biz.pdf', biz_reg_size: 1234 },
    });
    assert.equal(status, 200);
    assert.equal(json.status, 'pending');
    assert.equal(db.seller_verifications[0].status, 'pending');
  });

  it('biz_reg_hash가 64자리 hex가 아니면 INVALID_HASH로 거부', async () => {
    const { status, json } = await call('/seller/verify-submit', {
      method: 'POST',
      body: { guid: 'guid-b', biz_reg_hash: 'not-a-hash', biz_reg_filename: 'biz.pdf', biz_reg_size: 1234 },
    });
    assert.equal(status, 400);
    assert.equal(json.error, 'INVALID_HASH');
  });

  it('admin_guids 미등록 guid는 verify-review 시도 시 AUTH_REQUIRED(403)', async () => {
    const { privateKey, pubkeyB64u } = await genKeyPair();
    seedProfile('not-an-admin', pubkeyB64u);
    db.seller_verifications.push({ id: 'sv1', guid: 'guid-b', status: 'pending' });

    const auth = await makeAuthParams('not-an-admin', privateKey, pubkeyB64u, 'seller-verify-admin');
    const { status, json } = await call('/seller/verify-review', {
      method: 'POST',
      body: { ...auth, target_guid: 'guid-b', decision: 'verified' },
    });
    assert.equal(status, 403);
    assert.equal(json.error, 'AUTH_REQUIRED');
  });

  it('service=seller_verification으로 등록된 관리자는 승인 가능, status가 verified로 바뀜', async () => {
    const { privateKey, pubkeyB64u } = await genKeyPair();
    seedProfile('admin-1', pubkeyB64u);
    db.admin_guids.push({ id: 'ag1', guid: 'admin-1', services: ['seller_verification'], active: true });
    db.seller_verifications.push({ id: 'sv1', guid: 'guid-b', status: 'pending' });

    const auth = await makeAuthParams('admin-1', privateKey, pubkeyB64u, 'seller-verify-admin');
    const { status, json } = await call('/seller/verify-review', {
      method: 'POST',
      body: { ...auth, target_guid: 'guid-b', decision: 'verified' },
    });
    assert.equal(status, 200);
    assert.equal(json.status, 'verified');
    assert.equal(db.seller_verifications[0].status, 'verified');
  });

  it('active=false인 관리자는 AUTH_REQUIRED — 비활성화가 실제로 막는지 확인', async () => {
    const { privateKey, pubkeyB64u } = await genKeyPair();
    seedProfile('admin-1', pubkeyB64u);
    db.admin_guids.push({ id: 'ag1', guid: 'admin-1', services: ['seller_verification'], active: false });
    db.seller_verifications.push({ id: 'sv1', guid: 'guid-b', status: 'pending' });

    const auth = await makeAuthParams('admin-1', privateKey, pubkeyB64u, 'seller-verify-admin');
    const { status, json } = await call('/seller/verify-review', {
      method: 'POST',
      body: { ...auth, target_guid: 'guid-b', decision: 'verified' },
    });
    assert.equal(status, 403);
    assert.equal(json.error, 'AUTH_REQUIRED');
  });
});

// ══════════════════════════════════════════════════════════════════
// GDC05 — 거래 이의제기 당사자 제한
// ══════════════════════════════════════════════════════════════════
describe('GDC05: 거래 이의제기 — 당사자만 신고 가능', () => {
  it('거래 당사자가 아닌 guid가 신고 시도 시 NOT_A_PARTY(403)', async () => {
    const { privateKey, pubkeyB64u } = await genKeyPair();
    seedProfile('outsider', pubkeyB64u);
    db.ledger_entries.push({ id: 'le1', tx_id: 'tx-001', guid: 'guid-a', direction: 'debit' });
    db.ledger_entries.push({ id: 'le2', tx_id: 'tx-001', guid: 'guid-b', direction: 'credit' });

    const ts = Date.now().toString();
    const sigMsg = `dispute:tx-001:outsider:${ts}`;
    const signature = await sign(privateKey, sigMsg);
    const { status, json } = await call('/ledger/dispute', {
      method: 'POST',
      body: { tx_id: 'tx-001', reporter_guid: 'outsider', pubkey: pubkeyB64u, signature, ts, reason: '부당하다' },
    });
    assert.equal(status, 403);
    assert.equal(json.error, 'NOT_A_PARTY');
  });

  it('실제 당사자(ledger_entries에 tx_id+guid 조합 존재)는 정상 접수됨', async () => {
    const { privateKey, pubkeyB64u } = await genKeyPair();
    seedProfile('guid-a', pubkeyB64u);
    db.ledger_entries.push({ id: 'le1', tx_id: 'tx-001', guid: 'guid-a', direction: 'debit' });

    const ts = Date.now().toString();
    const sigMsg = `dispute:tx-001:guid-a:${ts}`;
    const signature = await sign(privateKey, sigMsg);
    const { status, json } = await call('/ledger/dispute', {
      method: 'POST',
      body: { tx_id: 'tx-001', reporter_guid: 'guid-a', pubkey: pubkeyB64u, signature, ts, reason: '부당하다' },
    });
    assert.equal(status, 200);
    assert.equal(db.transaction_disputes.length, 1);
    assert.equal(db.transaction_disputes[0].status, 'open');
  });
});

// ══════════════════════════════════════════════════════════════════
// GDC07 — 재무제표 대사(reconcile)
// ══════════════════════════════════════════════════════════════════
describe('GDC07: 재무제표 대사', () => {
  it('ledger_entries 역산 잔액과 L1 실제 잔액이 같으면 anomaly:false', async () => {
    db.ledger_entries.push({ id: 'le1', guid: 'guid-a', direction: 'credit', amount: 100 });
    db.ledger_entries.push({ id: 'le2', guid: 'guid-a', direction: 'debit', amount: 30 });
    globalThis.__MOCK_BALANCE__ = 70; // 100 - 30 = 70, 일치해야 함

    const { status, json } = await call('/ledger/reconcile', { search: { guid: 'guid-a' } });
    assert.equal(status, 200);
    assert.equal(json.expected_bs_cash, 70);
    assert.equal(json.anomaly, false);
  });

  it('불일치하면 anomaly:true — ledger_entries 기록 누락 케이스', async () => {
    db.ledger_entries.push({ id: 'le1', guid: 'guid-a', direction: 'credit', amount: 100 });
    globalThis.__MOCK_BALANCE__ = 50; // ledger_entries는 100인데 L1 실제는 50 — 불일치

    const { json } = await call('/ledger/reconcile', { search: { guid: 'guid-a' } });
    assert.equal(json.expected_bs_cash, 100);
    assert.equal(json.actual_balance_l1, 50);
    assert.equal(json.anomaly, true);
  });
});

// ══════════════════════════════════════════════════════════════════
// GDC08 — 발행잔액 집계
// ══════════════════════════════════════════════════════════════════
describe('GDC08: 발행잔액 집계', () => {
  it('mint 기록 합계를 정확히 집계함', async () => {
    db.ledger_entries.push({ id: 'le1', source: 'mint', amount: 1000 });
    db.ledger_entries.push({ id: 'le2', source: 'mint', amount: 2000 });
    db.ledger_entries.push({ id: 'le3', source: 'gdc_transfer', amount: 9999 }); // 발행 아님 — 집계 제외돼야 함

    const { status, json } = await call('/ledger/issuance-summary');
    assert.equal(status, 200);
    assert.equal(json.total_issued_gdc, 3000);
    assert.equal(json.total_issued_krw, 3000 * 1000);
  });

  it('발행 기록이 하나도 없으면 0으로 정상 응답(에러 아님)', async () => {
    const { status, json } = await call('/ledger/issuance-summary');
    assert.equal(status, 200);
    assert.equal(json.total_issued_gdc, 0);
  });
});
