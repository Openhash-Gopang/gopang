/**
 * phase25_security_regression.test.mjs
 *
 * PART I-3 (보안 회귀) — 2026-07-17/18 신설.
 * I3-1: handleProfilePost 서명 검증 우회 시나리오 (서명 없음/위조 서명/변조된 메시지)
 * I3-2: phone_verify_token 재사용 공격 (같은 프로필 재사용, 동일 전화번호를 쓰는
 *       서로 다른 프로필에 걸친 재사용)
 *
 * worker.js를 직접 import해서 handleProfilePost/handleProfileClaim을 라우팅을 통해
 * 호출하고, L1 PocketBase는 phase22/24와 동일하게 in-memory mock으로 대체한다.
 * 라이브 인프라가 필요 없는 워커통합(Worker Integration) 방식이라 이 샌드박스에서
 * 완전히 실행 가능하다 — HANDOFF_2026-07-17.md §5 I-3에서 "라이브 공격 시나리오라
 * [불가]로 재분류될 가능성 높음"이라 적었던 우려와 달리, I3-1/I3-2는 실제로는
 * worker.js 레벨 로직 검증만으로 충분히 재현 가능했다.
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ══════════════════════════════════════════════════════════════════
// 픽스처 — 가짜 L1 PocketBase (profiles 컬렉션만 필요)
// ══════════════════════════════════════════════════════════════════

let db;
let idSeq;

function resetDb() {
  db = { profiles: [] };
  idSeq = 0;
}

function evalFilter(rec, filter) {
  const decoded = decodeURIComponent(filter);
  // 이 테스트가 실제로 만드는 필터는 "guid='xxx'" 단일 절뿐이다.
  const m = decoded.match(/^(\w+)='(.*)'$/);
  if (m) return String(rec[m[1]] ?? '') === m[2].replace(/\\'/g, "'");
  throw new Error(`mock: 필터 파싱 실패: ${decoded}`);
}

function installMockFetch() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));

    if (u.pathname === '/api/admins/auth-with-password') {
      return new Response(JSON.stringify({ token: 'mock-admin-token' }), { status: 200 });
    }

    const collMatch = u.pathname.match(/^\/api\/collections\/(\w+)\/records\/?(.*)$/);
    if (!collMatch) throw new Error(`mock: 처리 못하는 경로: ${u.pathname}`);
    const [, collection, recordId] = collMatch;
    if (!db[collection]) throw new Error(`mock: 알 수 없는 컬렉션: ${collection}`);

    if ((!init.method || init.method === 'GET') && !recordId) {
      const filter = u.searchParams.get('filter');
      let items = db[collection];
      if (filter) items = items.filter(r => evalFilter(r, filter));
      return new Response(JSON.stringify({ items, page: 1, perPage: 200, totalItems: items.length }), { status: 200 });
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
// Ed25519 헬퍼 — worker.js의 _verifyEd25519Simple(raw 공개키 + base64url)과
// 호환되는 키쌍 생성/서명 생성
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

async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── 인메모리 KV mock (QR_SESSIONS_KV) ────────────────────────────────
// 2026-07-18: I3-2 테스트가 phone_verify_token을 손으로 조립(btoa 사용)
// 하고 있었는데, 그게 하필 당시 handleProfileClaim의 atob() 버그와
// 우연히 맞아떨어져 "발급부-검증부 인코딩 불일치" 실제 프로덕션 버그를
// 테스트가 놓쳤다. 이후로는 실제 handlePhoneOtpVerify 엔드포인트를
// 그대로 호출해 토큰을 발급받는다 — 손으로 만들지 않는다.
function makeKvMock() {
  const store = new Map();
  return {
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
  };
}

// 실제 /biz/phone-otp-verify를 호출해 진짜 phone_verify_token을 발급받는다.
// OTP 발송(SMS) 자체는 외부 API라 우회한다 — QR_SESSIONS_KV에 이미 코드가
// 발급된 것처럼 직접 시딩하고(handlePhoneOtpRequest가 정상적으로 하는 일과
// 동일한 상태), 그 다음 handlePhoneOtpVerify는 반드시 실제 호출로 태운다.
const OTP_CODE = '123456';
async function issuePhoneVerifyToken(kv, e164, guid) {
  await kv.put(`otp:${e164}`, JSON.stringify({ code: OTP_CODE, attempts: 0 }));
  const { status, json } = await call('/biz/phone-otp-verify', {
    method: 'POST', body: { e164, code: OTP_CODE, ...(guid ? { guid } : {}) },
  });
  assert.equal(status, 200, `테스트 셋업: /biz/phone-otp-verify 실패 — ${JSON.stringify(json)}`);
  return json.phone_verify_token;
}

// ══════════════════════════════════════════════════════════════════

let worker;
const kvMock = makeKvMock();
const ENV = {
  L1_ADMIN_EMAIL: 'admin@test', L1_ADMIN_PASSWORD: 'pw',
  PHONE_VERIFY_SECRET: 'test-secret-key', QR_SESSIONS_KV: kvMock,
};

before(async () => {
  installMockFetch();
  worker = (await import('../../../worker.js')).default;
});

beforeEach(() => { resetDb(); });

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

function minimalProfileBody(overrides = {}) {
  return {
    guid: 'guid-001', pubkey: 'unused-in-post', signature: 'unused-in-post',
    entity_type: 'person', name: '테스트사용자',
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════
// I3-1: /profile POST — 서명 검증 우회 시나리오
// ══════════════════════════════════════════════════════════════════

describe('I3-1: handleProfilePost — 서명 검증 우회 시나리오', () => {
  it('signature 필드 자체가 없으면 400 MISSING_FIELD로 거부', async () => {
    const { status, json } = await call('/profile', {
      method: 'POST',
      body: { guid: 'g1', pubkey: 'somepubkey', entity_type: 'person', name: 'A' },
    });
    assert.equal(status, 400);
    assert.equal(json.error, 'MISSING_FIELD');
  });

  it('위조된(랜덤 문자열) 서명은 401 INVALID_SIGNATURE로 거부', async () => {
    const { pubkeyB64u } = await genKeyPair();
    const { status, json } = await call('/profile', {
      method: 'POST',
      body: minimalProfileBody({ guid: 'g2', pubkey: pubkeyB64u, signature: 'forged-not-base64url-sig-xyz', ts: String(Date.now()) }),
    });
    assert.equal(status, 401);
    assert.equal(json.error, 'INVALID_SIGNATURE');
  });

  it('다른 사람의 유효한 서명을 재사용(공개키 바꿔치기) — 서명·공개키 불일치로 거부', async () => {
    // 공격자는 guid:pubkeyA:ts에 대한 자신의 유효한 서명은 있지만,
    // 요청 본문의 pubkey를 피해자의 pubkeyB로 바꿔 신원을 사칭하려 시도.
    const attacker = await genKeyPair();
    const victim = await genKeyPair();
    const ts = String(Date.now());
    const sigMsg = `victim-guid:${attacker.pubkeyB64u}:${ts}`; // 공격자 자신의 키로 서명
    const forgedSig = await sign(attacker.privateKey, sigMsg);

    const { status, json } = await call('/profile', {
      method: 'POST',
      body: minimalProfileBody({ guid: 'victim-guid', pubkey: victim.pubkeyB64u, signature: forgedSig, ts }), // pubkey만 피해자 것으로 치환
    });
    assert.equal(status, 401);
    assert.equal(json.error, 'INVALID_SIGNATURE');
  });

  it('메시지 변조(다른 guid로 서명 후 요청 본문의 guid만 바꿔치기) — 거부됨', async () => {
    const { privateKey, pubkeyB64u } = await genKeyPair();
    const ts = String(Date.now());
    const sigForGuidA = await sign(privateKey, `guid-A:${pubkeyB64u}:${ts}`);

    // 서명은 guid-A용인데 요청은 guid-B로 제출 (서명 대상 문자열이 실제
    // 전송된 필드와 달라지므로 검증에 반드시 실패해야 함)
    const { status, json } = await call('/profile', {
      method: 'POST',
      body: minimalProfileBody({ guid: 'guid-B', pubkey: pubkeyB64u, signature: sigForGuidA, ts }),
    });
    assert.equal(status, 401);
    assert.equal(json.error, 'INVALID_SIGNATURE');
  });

  it('유효한 서명 + 일치하는 guid/pubkey/ts면 정상 통과(200)', async () => {
    const { privateKey, pubkeyB64u } = await genKeyPair();
    const ts = String(Date.now());
    const guid = 'guid-valid-001';
    const sigMsg = `${guid}:${pubkeyB64u}:${ts}`;
    const validSig = await sign(privateKey, sigMsg);

    const { status } = await call('/profile', {
      method: 'POST',
      body: minimalProfileBody({ guid, pubkey: pubkeyB64u, signature: validSig, ts, entity_type: 'person', name: '정상사용자' }),
    });
    assert.equal(status, 200, '올바른 서명은 거부되면 안 됨(오탐 방지 확인)');
  });
});

// ══════════════════════════════════════════════════════════════════
// I3-2: /profile/claim POST — phone_verify_token 재사용 공격
// ══════════════════════════════════════════════════════════════════

describe('I3-2: handleProfileClaim — phone_verify_token 재사용 공격 + guid 바인딩(2026-07-18 신설)', () => {
  const PHONE_E164 = '+8201012345678';
  // handleProfileClaim은 토큰의 e164에서 '+82' 접두어를 뗀 국내 형식과
  // profiles.phone을 비교한다(_sendSolapiSms 관례와 동일) — 시드 데이터도
  // 국내 형식(0으로 시작)으로 넣어야 실제 저장 형태와 일치한다.
  const PHONE_DOMESTIC = '01012345678';

  function seedUnclaimedProfile(guid, phone) {
    db.profiles.push({
      id: `mock_profiles_seed_${guid}`, guid, handle: guid, entity_type: 'business',
      native_lang: 'ko', is_public: true, phone, extra: { claim_status: 'unclaimed' },
      claim_status: 'unclaimed',
    });
  }

  it('실제 /biz/phone-otp-verify → /profile/claim 정상 흐름 — guid 바인딩된 토큰으로 claim 성공', async () => {
    seedUnclaimedProfile('biz-happy', PHONE_DOMESTIC);
    const token = await issuePhoneVerifyToken(kvMock, PHONE_E164, 'biz-happy');
    const { status } = await call('/profile/claim', {
      method: 'POST', body: { guid: 'biz-happy', pubkey: 'pub1', phone_verify_token: token },
    });
    assert.equal(status, 200, '정상 발급된 guid 바인딩 토큰은 통과해야 함(atob 버그 수정 후 회귀 확인)');
  });

  it('[버그 수정 회귀 확인] 발급부는 더 이상 payload를 base64 인코딩하지 않는다 — 실제 토큰이 atob 없이 파싱돼야 함', async () => {
    seedUnclaimedProfile('biz-encoding', PHONE_DOMESTIC);
    const token = await issuePhoneVerifyToken(kvMock, PHONE_E164, 'biz-encoding');
    const [payload] = token.split('.');
    // payload 자체에 ':' 문자가 그대로 있어야 함(base64였다면 인코딩된
    // 형태라 원문 ':'가 그대로 보이지 않는다) — 2026-07-15 btoa 제거 확인
    assert.ok(payload.includes(':'), 'payload가 base64로 인코딩되지 않은 원문이어야 함');
    assert.ok(payload.startsWith(PHONE_E164), 'payload는 e164로 시작해야 함');
  });

  it('guid 없이 발급된(등록용) 토큰으로 claim 시도 — 400 TOKEN_NOT_BOUND로 거부', async () => {
    seedUnclaimedProfile('biz-noguid', PHONE_DOMESTIC);
    const token = await issuePhoneVerifyToken(kvMock, PHONE_E164, null); // guid 생략 — 등록 흐름 시뮬레이션
    const { status, json } = await call('/profile/claim', {
      method: 'POST', body: { guid: 'biz-noguid', pubkey: 'pub1', phone_verify_token: token },
    });
    assert.equal(status, 400);
    assert.equal(json.error, 'TOKEN_NOT_BOUND');
  });

  it('[수정 확인] 다른 guid용으로 발급된 토큰을 다른 프로필에 재사용 — 403 TOKEN_GUID_MISMATCH로 거부(이전엔 성공했었음)', async () => {
    seedUnclaimedProfile('biz-alpha', PHONE_DOMESTIC);
    seedUnclaimedProfile('biz-beta', PHONE_DOMESTIC);
    const tokenForAlpha = await issuePhoneVerifyToken(kvMock, PHONE_E164, 'biz-alpha');

    const claimAlpha = await call('/profile/claim', {
      method: 'POST', body: { guid: 'biz-alpha', pubkey: 'pubA', phone_verify_token: tokenForAlpha },
    });
    assert.equal(claimAlpha.status, 200, 'biz-alpha용 토큰은 biz-alpha claim엔 성공해야 함');

    const claimBeta = await call('/profile/claim', {
      method: 'POST', body: { guid: 'biz-beta', pubkey: 'pubB', phone_verify_token: tokenForAlpha },
    });
    assert.equal(claimBeta.status, 403, 'biz-alpha용 토큰으로 biz-beta를 claim하면 안 됨 — guid 바인딩 수정 확인');
    assert.equal(claimBeta.json.error, 'TOKEN_GUID_MISMATCH');
  });

  it('같은 토큰으로 같은 프로필을 두 번 claim — 두 번째는 이미 claimed라 거부됨(단일 프로필 재사용 방지 확인)', async () => {
    seedUnclaimedProfile('biz-single', PHONE_DOMESTIC);
    const token = await issuePhoneVerifyToken(kvMock, PHONE_E164, 'biz-single');

    const first = await call('/profile/claim', {
      method: 'POST', body: { guid: 'biz-single', pubkey: 'pub1', phone_verify_token: token },
    });
    assert.equal(first.status, 200, '첫 claim은 성공해야 함');

    const second = await call('/profile/claim', {
      method: 'POST', body: { guid: 'biz-single', pubkey: 'pub2', phone_verify_token: token },
    });
    assert.equal(second.status, 404);
    assert.equal(second.json.error, 'NOT_CLAIMABLE', '이미 claimed된 프로필 재청구는 claim_status 전이로 막힘');
  });

  it('전화번호가 다른 프로필에는 토큰 재사용 불가(PHONE_MISMATCH)', async () => {
    seedUnclaimedProfile('biz-other-phone', '01099998888');
    const token = await issuePhoneVerifyToken(kvMock, PHONE_E164, 'biz-other-phone');

    const { status, json } = await call('/profile/claim', {
      method: 'POST', body: { guid: 'biz-other-phone', pubkey: 'pubX', phone_verify_token: token },
    });
    assert.equal(status, 403);
    assert.equal(json.error, 'PHONE_MISMATCH');
  });

  it('HMAC 서명 부분을 변조한 토큰은 401 TOKEN_INVALID로 거부', async () => {
    seedUnclaimedProfile('biz-tampered', PHONE_DOMESTIC);
    const validToken = await issuePhoneVerifyToken(kvMock, PHONE_E164, 'biz-tampered');
    const [payload] = validToken.split('.');
    const tamperedToken = `${payload}.0000000000000000000000000000000000000000000000000000000000000000`;

    const { status, json } = await call('/profile/claim', {
      method: 'POST', body: { guid: 'biz-tampered', pubkey: 'pubY', phone_verify_token: tamperedToken },
    });
    assert.equal(status, 401);
    assert.equal(json.error, 'TOKEN_INVALID');
  });

  it('만료된 토큰은 401 TOKEN_EXPIRED로 거부', async () => {
    seedUnclaimedProfile('biz-expired', PHONE_DOMESTIC);
    // PHONE_VERIFY_TOKEN_TTL_MS는 발급부 내부 상수라 여기서 직접 조작할
    // 수 없으므로, 서명은 정상인 채로 exp만 과거로 둔 토큰을 동일 HMAC
    // 절차로 재구성한다(발급 로직 자체는 issuePhoneVerifyToken으로 이미
    // 별도 검증됨 — 이 테스트는 만료 검사 자체만 겨냥).
    const expiredPayload = `${PHONE_E164}:biz-expired:${Date.now() - 1000}`;
    const sig = await hmacSha256Hex('test-secret-key', expiredPayload);
    const token = `${expiredPayload}.${sig}`;

    const { status, json } = await call('/profile/claim', {
      method: 'POST', body: { guid: 'biz-expired', pubkey: 'newpub', phone_verify_token: token },
    });
    assert.equal(status, 401);
    assert.equal(json.error, 'TOKEN_EXPIRED');
  });
});
