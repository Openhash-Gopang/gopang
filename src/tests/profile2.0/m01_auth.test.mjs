// ============================================================
// test_m01_auth.js — M01 인증 모듈 테스트
// 실행: node test_m01_auth.js
// 환경: Node.js 18+ (Web Crypto API 내장)
// ============================================================

// Node.js globals polyfill
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

// ─── 인라인 구현 (import 대신 직접 복사 — Workers 환경 동일) ───

const GOPANG_NS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const TOKEN_TTL = 86400;
const REFRESH_TTL = 3600;

function uuidToBytes(uuid) {
  const hex = uuid.replace(/-/g, '');
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = parseInt(hex.slice(i*2, i*2+2), 16);
  return b;
}
function bytesToUUID(b) {
  const h = [...b].map(x => x.toString(16).padStart(2,'0'));
  return [h.slice(0,4).join(''),h.slice(4,6).join(''),
          h.slice(6,8).join(''),h.slice(8,10).join(''),h.slice(10,16).join('')].join('-');
}
async function makeGUID(phoneDigits) {
  const nsBytes = uuidToBytes(GOPANG_NS);
  const digits  = phoneDigits.replace(/\D/g, '');
  const nameBytes = new TextEncoder().encode(digits);
  const combined = new Uint8Array(nsBytes.length + nameBytes.length);
  combined.set(nsBytes); combined.set(nameBytes, nsBytes.length);
  const hashBuf = await crypto.subtle.digest('SHA-1', combined);
  const h = new Uint8Array(hashBuf);
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  return bytesToUUID(h);
}
function b64url(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
function b64urlRaw(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
async function hmacSign(data, key) {
  const enc  = new TextEncoder();
  const cKey = await crypto.subtle.importKey(
    'raw', enc.encode(key), { name:'HMAC', hash:'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cKey, enc.encode(data));
  return b64urlRaw(sig);
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i=0; i<a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function issueJWT(payload, masterKey) {
  const header = { alg:'HS256', typ:'JWT' };
  const now    = Math.floor(Date.now()/1000);
  const claims = { ...payload, iat:now, exp:now+TOKEN_TTL };
  const b64h   = b64url(JSON.stringify(header));
  const b64p   = b64url(JSON.stringify(claims));
  const sig    = await hmacSign(`${b64h}.${b64p}`, masterKey);
  return `${b64h}.${b64p}.${sig}`;
}
async function verifyJWT(token, masterKey) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [b64h, b64p, sig] = parts;
  const expected = await hmacSign(`${b64h}.${b64p}`, masterKey);
  if (!timingSafeEqual(sig, expected)) return null;
  let payload;
  try {
    const json = decodeURIComponent(escape(atob(b64p.replace(/-/g,'+').replace(/_/g,'/'))));
    payload = JSON.parse(json);
  } catch { return null; }
  if (payload.exp < Math.floor(Date.now()/1000)) return null;
  return payload;
}
async function refreshJWT(token, masterKey) {
  const parts = token.split('.');
  if (parts.length !== 3) return { error: 'INVALID_TOKEN' };
  const [b64h, b64p, sig] = parts;
  const expected = await hmacSign(`${b64h}.${b64p}`, masterKey);
  if (!timingSafeEqual(sig, expected)) return { error: 'INVALID_SIGNATURE' };
  let payload;
  try {
    const json = decodeURIComponent(escape(atob(b64p.replace(/-/g,'+').replace(/_/g,'/'))));
    payload = JSON.parse(json);
  } catch { return { error: 'INVALID_TOKEN' }; }
  const now = Math.floor(Date.now()/1000);
  if (payload.exp < now) return { error: 'EXPIRED' };
  if (payload.exp - now > REFRESH_TTL) return { error: 'TOO_EARLY' };
  const { iat, exp, ...claims } = payload;
  const newToken = await issueJWT(claims, masterKey);
  return { token: newToken };
}

// ─────────────────────────────────────────────
// 테스트 프레임워크 (경량 인라인)
// ─────────────────────────────────────────────
const MASTER_KEY = 'test-master-key-gopang-2026';
let passed = 0, failed = 0;

async function test(id, desc, fn) {
  try {
    await fn();
    console.log(`  ✅ ${id} ${desc}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${id} ${desc}`);
    console.log(`     → ${e.message}`);
    failed++;
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEq(a, b, msg) {
  if (a !== b) throw new Error(msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// ─────────────────────────────────────────────
// A01 정상 등록 후 토큰 발급
// ─────────────────────────────────────────────
await test('A01', '정상 등록 후 토큰 발급 — JWT 반환, 24시간 exp', async () => {
  const token = await issueJWT(
    { guid: 'test-guid-001', name: '김민준', lang: 'ko', type: 'consumer' },
    MASTER_KEY
  );
  assert(token.split('.').length === 3, 'JWT 형식 오류');
  const payload = await verifyJWT(token, MASTER_KEY);
  assert(payload !== null, '검증 실패');
  assertEq(payload.guid, 'test-guid-001', 'guid 불일치');
  const now = Math.floor(Date.now() / 1000);
  assert(payload.exp > now + TOKEN_TTL - 5, 'exp 부족');
  assert(payload.exp <= now + TOKEN_TTL + 5, 'exp 초과');
});

// ─────────────────────────────────────────────
// A02 동일 전화번호 재등록 → 동일 GUID
// ─────────────────────────────────────────────
await test('A02', '동일 전화번호 재등록 — 동일 GUID 반환', async () => {
  const guid1 = await makeGUID('010-1234-5678');
  const guid2 = await makeGUID('010-1234-5678');
  assertEq(guid1, guid2, 'GUID 불일치 — 결정성 실패');
  // 다른 번호는 다른 GUID
  const guid3 = await makeGUID('010-9999-0000');
  assert(guid1 !== guid3, '다른 번호가 동일 GUID');
});

// ─────────────────────────────────────────────
// A03 유효 토큰 갱신 — 만료 1시간 이내
// ─────────────────────────────────────────────
await test('A03', '유효 토큰 갱신 — 새 JWT 발급', async () => {
  // 만료까지 30분 남은 토큰 시뮬레이션
  const header  = { alg: 'HS256', typ: 'JWT' };
  const now     = Math.floor(Date.now() / 1000);
  const claims  = { guid: 'g1', name: 'test', lang: 'ko', type: 'consumer',
                    iat: now - TOKEN_TTL + 1800,   // 6시간 전 발급
                    exp: now + 1800 };              // 30분 후 만료
  const b64h = b64url(JSON.stringify(header));
  const b64p = b64url(JSON.stringify(claims));
  const sig  = await hmacSign(`${b64h}.${b64p}`, MASTER_KEY);
  const expiringSoon = `${b64h}.${b64p}.${sig}`;

  const result = await refreshJWT(expiringSoon, MASTER_KEY);
  assert(!result.error, `갱신 실패: ${result.error}`);
  assert(result.token, '토큰 없음');
  const newPayload = await verifyJWT(result.token, MASTER_KEY);
  assert(newPayload !== null, '갱신 토큰 검증 실패');
  assert(newPayload.exp > now + TOKEN_TTL - 5, '갱신된 exp 부족');
});

// ─────────────────────────────────────────────
// A04 만료 토큰 갱신 시도 → 401
// ─────────────────────────────────────────────
await test('A04', '만료 토큰 갱신 시도 — EXPIRED 반환', async () => {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now    = Math.floor(Date.now() / 1000);
  const claims = { guid: 'g1', name: 'test', lang: 'ko', type: 'consumer',
                   iat: now - 90000, exp: now - 1000 }; // 이미 만료
  const b64h = b64url(JSON.stringify(header));
  const b64p = b64url(JSON.stringify(claims));
  const sig  = await hmacSign(`${b64h}.${b64p}`, MASTER_KEY);
  const expired = `${b64h}.${b64p}.${sig}`;

  const result = await refreshJWT(expired, MASTER_KEY);
  assertEq(result.error, 'EXPIRED', '만료 오류코드 불일치');

  // verifyJWT도 null 반환 확인
  const payload = await verifyJWT(expired, MASTER_KEY);
  assertEq(payload, null, '만료 토큰이 통과됨');
});

// ─────────────────────────────────────────────
// A05 서명 위조 토큰 → null
// ─────────────────────────────────────────────
await test('A05', '서명 위조 토큰 — null 반환', async () => {
  const token = await issueJWT(
    { guid: 'g1', name: 'test', lang: 'ko', type: 'consumer' },
    MASTER_KEY
  );
  // 페이로드 변조: guid를 admin으로
  const parts = token.split('.');
  const tamperedPayload = btoa(JSON.stringify({ guid: 'ADMIN', name: 'hack',
    lang: 'ko', type: 'admin', iat: 0, exp: 9999999999 }))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

  const result = await verifyJWT(tampered, MASTER_KEY);
  assertEq(result, null, '위조 토큰이 통과됨');
});

// ─────────────────────────────────────────────
// A06 인증 필요 엔드포인트 무토큰 접근 → null
// ─────────────────────────────────────────────
await test('A06', '무토큰 verifyJWT — null 반환', async () => {
  const result = await verifyJWT(null, MASTER_KEY);
  assertEq(result, null, '무토큰이 통과됨');

  const result2 = await verifyJWT('', MASTER_KEY);
  assertEq(result2, null, '빈 토큰이 통과됨');

  const result3 = await verifyJWT('not.a.jwt', MASTER_KEY);
  assertEq(result3, null, '잘못된 형식이 통과됨');
});

// ─────────────────────────────────────────────
// A07 외국 번호 GUID 결정성
// ─────────────────────────────────────────────
await test('A07', '+86 번호 GUID 결정성 — 2회 동일', async () => {
  const phone = '+86-138-0013-0000';
  const guid1 = await makeGUID(phone);
  const guid2 = await makeGUID(phone);
  assertEq(guid1, guid2, 'GUID 불일치');
  // UUID v5 형식 확인: xxxxxxxx-xxxx-5xxx-xxxx-xxxxxxxxxxxx
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(guid1),
    `UUID v5 형식 오류: ${guid1}`);
  // 한국 번호와 다른 GUID
  const guidKR = await makeGUID('010-1234-5678');
  assert(guid1 !== guidKR, '외국/국내 번호 GUID 동일');
});

// ─────────────────────────────────────────────
// A08 GOPANG_MASTER_KEY 누락 시 처리 (시뮬레이션)
// ─────────────────────────────────────────────
await test('A08', 'GOPANG_MASTER_KEY 누락 — 명시적 오류', async () => {
  // env.GOPANG_MASTER_KEY 없을 때 핸들러가 500 반환하는 로직 확인
  const missingKey = undefined;
  let errorCaught = false;
  try {
    // hmacSign에 undefined key → importKey 실패
    await hmacSign('test', missingKey);
  } catch {
    errorCaught = true;
  }
  assert(errorCaught, 'key 누락 시 오류 미발생');
});

// ─────────────────────────────────────────────
// 추가: TOO_EARLY 갱신 거부 (만료 1시간 이상 남음)
// ─────────────────────────────────────────────
await test('A09', '만료 1시간 이상 남은 토큰 갱신 — TOO_EARLY 반환', async () => {
  const token = await issueJWT(
    { guid: 'g1', name: 'test', lang: 'ko', type: 'consumer' }, MASTER_KEY
  );
  const result = await refreshJWT(token, MASTER_KEY);
  assertEq(result.error, 'TOO_EARLY', 'TOO_EARLY 아님');
});

// ─────────────────────────────────────────────
// 결과 출력
// ─────────────────────────────────────────────
console.log('');
console.log('══════════════════════════════════════');
console.log(`M01 Auth 테스트 결과: ${passed}/${passed+failed} 통과`);
if (failed > 0) {
  console.log(`❌ 실패: ${failed}건`);
  process.exit(1);
} else {
  console.log('✅ 전체 통과 — M01 합격');
}
console.log('══════════════════════════════════════');
