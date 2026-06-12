// ============================================================
// auth.js — M01 인증 모듈 (Cloudflare Worker 공유 라이브러리)
// gopang_module_design_v1.0 §3 기반
// worker.js에서 import 또는 인라인 통합
// ============================================================

// ─────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────
const GOPANG_NS   = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // RFC 4122 DNS NS
const TOKEN_TTL   = 86400;       // JWT 유효시간 24시간 (초)
const REFRESH_TTL = 3600;        // 갱신 허용 만료 전 구간 (1시간)

// 인증이 필요한 엔드포인트 목록
const AUTH_REQUIRED = new Set([
  '/ai-chat', '/ai-setup', '/escalate',
  '/location', '/review', '/community',  // POST만
]);

// ─────────────────────────────────────────────
// GUID 결정성 생성 (uuidv5 — RFC 4122 §4.3)
// 브라우저·Workers 모두 Web Crypto API 사용
// ─────────────────────────────────────────────
async function makeGUID(phoneDigits) {
  // 1. NS UUID → 16바이트
  const nsBytes = uuidToBytes(GOPANG_NS);
  // 2. 전화번호 숫자만 추출 → UTF-8 bytes
  const digits  = phoneDigits.replace(/\D/g, '');
  const nameBytes = new TextEncoder().encode(digits);
  // 3. SHA-1(NS + name)
  const combined = new Uint8Array(nsBytes.length + nameBytes.length);
  combined.set(nsBytes);
  combined.set(nameBytes, nsBytes.length);
  const hashBuf = await crypto.subtle.digest('SHA-1', combined);
  const h = new Uint8Array(hashBuf);
  // 4. RFC 4122 version 5 비트 세팅
  h[6] = (h[6] & 0x0f) | 0x50; // version = 5
  h[8] = (h[8] & 0x3f) | 0x80; // variant = 10xx
  return bytesToUUID(h);
}

function uuidToBytes(uuid) {
  const hex = uuid.replace(/-/g, '');
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = parseInt(hex.slice(i*2, i*2+2), 16);
  return b;
}

function bytesToUUID(b) {
  const h = [...b].map(x => x.toString(16).padStart(2,'0'));
  return [
    h.slice(0,4).join(''), h.slice(4,6).join(''),
    h.slice(6,8).join(''), h.slice(8,10).join(''),
    h.slice(10,16).join('')
  ].join('-');
}

// ─────────────────────────────────────────────
// JWT 발급
// ─────────────────────────────────────────────
async function issueJWT(payload, masterKey) {
  const header  = { alg: 'HS256', typ: 'JWT' };
  const now     = Math.floor(Date.now() / 1000);
  const claims  = { ...payload, iat: now, exp: now + TOKEN_TTL };
  const b64h    = b64url(JSON.stringify(header));
  const b64p    = b64url(JSON.stringify(claims));
  const sig     = await hmacSign(`${b64h}.${b64p}`, masterKey);
  return `${b64h}.${b64p}.${sig}`;
}

// ─────────────────────────────────────────────
// JWT 검증 — 서명 + 만료 확인
// 반환: payload 객체 | null (검증 실패)
// ─────────────────────────────────────────────
async function verifyJWT(token, masterKey) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [b64h, b64p, sig] = parts;
  // 서명 검증
  const expected = await hmacSign(`${b64h}.${b64p}`, masterKey);
  if (!timingSafeEqual(sig, expected)) return null;
  // 페이로드 파싱
  let payload;
  try { payload = JSON.parse(atob(b64p.replace(/-/g,'+').replace(/_/g,'/'))); }
  catch { return null; }
  // 만료 검증
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) return null;
  return payload;
}

// ─────────────────────────────────────────────
// JWT 갱신 — 만료 전 1시간 이내만 허용 (A03, A04)
// ─────────────────────────────────────────────
async function refreshJWT(token, masterKey) {
  const parts = token.split('.');
  if (parts.length !== 3) return { error: 'INVALID_TOKEN' };
  const [b64h, b64p, sig] = parts;
  // 서명 검증 (A05)
  const expected = await hmacSign(`${b64h}.${b64p}`, masterKey);
  if (!timingSafeEqual(sig, expected)) return { error: 'INVALID_SIGNATURE' };
  let payload;
  try { payload = JSON.parse(atob(b64p.replace(/-/g,'+').replace(/_/g,'/'))); }
  catch { return { error: 'INVALID_TOKEN' }; }
  const now = Math.floor(Date.now() / 1000);
  // 이미 만료된 토큰 (A04)
  if (payload.exp < now) return { error: 'EXPIRED' };
  // 갱신 허용 구간 아님 (만료 1시간 이상 남음)
  if (payload.exp - now > REFRESH_TTL) return { error: 'TOO_EARLY' };
  // 신규 토큰 발급
  const { iat, exp, ...claims } = payload;
  const newToken = await issueJWT(claims, masterKey);
  return { token: newToken };
}

// ─────────────────────────────────────────────
// 게이트키퍼 — 인증 필요 엔드포인트 가드 (A06)
// 반환: payload | Response(401)
// ─────────────────────────────────────────────
async function requireAuth(request, masterKey) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7) : null;
  if (!token) return new Response(
    JSON.stringify({ error: 'UNAUTHORIZED', message: '로그인이 필요합니다.' }),
    { status: 401, headers: { 'Content-Type': 'application/json' } }
  );
  const payload = await verifyJWT(token, masterKey);
  if (!payload) return new Response(
    JSON.stringify({ error: 'INVALID_TOKEN', message: '유효하지 않은 토큰입니다.' }),
    { status: 401, headers: { 'Content-Type': 'application/json' } }
  );
  return payload; // 성공 시 payload 객체 반환
}

// ─────────────────────────────────────────────
// 내부 유틸
// ─────────────────────────────────────────────
function b64url(str) {
  return btoa(str).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}

async function hmacSign(data, key) {
  const enc  = new TextEncoder();
  const cKey = await crypto.subtle.importKey(
    'raw', enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cKey, enc.encode(data));
  return b64url(String.fromCharCode(...new Uint8Array(sig)));
}

// 타이밍 어택 방지 비교
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ─────────────────────────────────────────────
// /token-refresh 핸들러
// ─────────────────────────────────────────────
async function handleTokenRefresh(request, env, corsHeaders) {
  // A08: 환경변수 필수 체크
  if (!env.GOPANG_MASTER_KEY) return new Response(
    JSON.stringify({ error: 'SERVER_CONFIG_ERROR',
                     message: 'GOPANG_MASTER_KEY 미등록' }),
    { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return new Response(
    JSON.stringify({ error: 'UNAUTHORIZED' }),
    { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
  const result = await refreshJWT(token, env.GOPANG_MASTER_KEY);
  if (result.error) {
    const status = result.error === 'EXPIRED' ? 401
                 : result.error === 'TOO_EARLY' ? 400 : 401;
    return new Response(
      JSON.stringify({ error: result.error }),
      { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  return new Response(
    JSON.stringify({ token: result.token }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

export {
  makeGUID, issueJWT, verifyJWT, refreshJWT,
  requireAuth, handleTokenRefresh,
  GOPANG_NS, TOKEN_TTL,
};
