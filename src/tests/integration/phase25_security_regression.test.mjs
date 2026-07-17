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

function b64(str) { return btoa(str); }

async function buildPhoneVerifyToken(secret, e164, exp) {
  const payload = `${e164}:${exp}`;
  const sig = await hmacSha256Hex(secret, payload);
  return `${b64(payload)}.${sig}`;
}

// ══════════════════════════════════════════════════════════════════

let worker;
const ENV = { L1_ADMIN_EMAIL: 'admin@test', L1_ADMIN_PASSWORD: 'pw', PHONE_VERIFY_SECRET: 'test-secret-key' };

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

describe('I3-2: handleProfileClaim — phone_verify_token 재사용 공격', () => {
  const SECRET = 'test-secret-key';
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

  it('만료된 토큰은 401 TOKEN_EXPIRED로 거부', async () => {
    seedUnclaimedProfile('biz-expired', PHONE_DOMESTIC);
    const expiredExp = Date.now() - 1000;
    const token = await buildPhoneVerifyToken(SECRET, PHONE_E164, expiredExp);

    const { status, json } = await call('/profile/claim', {
      method: 'POST', body: { guid: 'biz-expired', pubkey: 'newpub', phone_verify_token: token },
    });
    assert.equal(status, 401);
    assert.equal(json.error, 'TOKEN_EXPIRED');
  });

  it('같은 토큰으로 같은 프로필을 두 번 claim — 두 번째는 이미 claimed라 거부됨(단일 프로필 재사용 방지 확인)', async () => {
    seedUnclaimedProfile('biz-single', PHONE_DOMESTIC);
    const exp = Date.now() + 5 * 60000;
    const token = await buildPhoneVerifyToken(SECRET, PHONE_E164, exp);

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

  it('[발견] 같은 전화번호를 등록해 둔 서로 다른 두 unclaimed 프로필에 동일 토큰을 재사용 — 현재 둘 다 성공함', async () => {
    // phone_verify_token의 서명 대상은 "e164:exp"뿐이고 guid가 전혀 포함돼
    // 있지 않다. 서버 쪽 유일한 제약은 "토큰의 전화번호 == 그 요청이
    // 지목한 guid 프로필의 등록 전화번호"뿐이라, 동일 전화번호가 등록된
    // 서로 다른 두 unclaimed 프로필이 있으면 만료 전까지 같은 토큰으로
    // 반복 claim이 가능하다 — 토큰이 "전화번호 소유 증명"에 특정 청구
    // 대상을 묶어두지 않는 설계이기 때문.
    seedUnclaimedProfile('biz-alpha', PHONE_DOMESTIC);
    seedUnclaimedProfile('biz-beta', PHONE_DOMESTIC);
    const exp = Date.now() + 5 * 60000;
    const token = await buildPhoneVerifyToken(SECRET, PHONE_E164, exp);

    const claimAlpha = await call('/profile/claim', {
      method: 'POST', body: { guid: 'biz-alpha', pubkey: 'pubA', phone_verify_token: token },
    });
    const claimBeta = await call('/profile/claim', {
      method: 'POST', body: { guid: 'biz-beta', pubkey: 'pubB', phone_verify_token: token },
    });

    assert.equal(claimAlpha.status, 200);
    assert.equal(claimBeta.status, 200, '현재 동작: 같은 번호의 다른 프로필도 같은 토큰으로 claim 성공(재사용 방지 없음)');
    // 이 동작이 의도된 설계(한 사업자가 동일 번호로 여러 업체를 동시에
    // 인증하는 정상 시나리오)인지, 아니면 막아야 할 취약점인지는 코드만
    // 봐서는 판단할 수 없다 — 사용자 설계 판단 필요(§보고서 참고).
  });

  it('전화번호가 다른 프로필에는 토큰 재사용 불가(PHONE_MISMATCH)', async () => {
    seedUnclaimedProfile('biz-other-phone', '01099998888');
    const exp = Date.now() + 5 * 60000;
    const token = await buildPhoneVerifyToken(SECRET, PHONE_E164, exp);

    const { status, json } = await call('/profile/claim', {
      method: 'POST', body: { guid: 'biz-other-phone', pubkey: 'pubX', phone_verify_token: token },
    });
    assert.equal(status, 403);
    assert.equal(json.error, 'PHONE_MISMATCH');
  });

  it('HMAC 서명 부분을 변조한 토큰은 401 TOKEN_INVALID로 거부', async () => {
    seedUnclaimedProfile('biz-tampered', PHONE_DOMESTIC);
    const exp = Date.now() + 5 * 60000;
    const validToken = await buildPhoneVerifyToken(SECRET, PHONE_E164, exp);
    const [payloadB64] = validToken.split('.');
    const tamperedToken = `${payloadB64}.0000000000000000000000000000000000000000000000000000000000000000`;

    const { status, json } = await call('/profile/claim', {
      method: 'POST', body: { guid: 'biz-tampered', pubkey: 'pubY', phone_verify_token: tamperedToken },
    });
    assert.equal(status, 401);
    assert.equal(json.error, 'TOKEN_INVALID');
  });
});
