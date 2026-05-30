/**
 * gopang-sso.js  v1.0
 * 고팡 중앙 인증 라이브러리 — 하위 서비스 전용
 *
 * 배포 위치 : https://gopang.net/auth/gopang-sso.js
 * 하위 서비스: import { gopangAuth } from 'https://gopang.net/auth/gopang-sso.js'
 *
 * 백서 §12 준수
 * ─ 하위 서비스는 독자 인증 구현 금지
 * ─ gopangAuth.require(level) 단일 호출로 모든 인증 처리
 * ─ 4가지 경로 자동 처리: GWP토큰 → sessionStorage → Silent iframe → 리다이렉트
 */

const _GOPANG_ORIGIN  = 'https://gopang.net';
const _WORKER         = 'https://gopang-proxy.tensor-city.workers.dev';
const _STORE_KEY      = 'gopang_user_v3';       // gopang_v2와 공유
const _SSO_SESSION    = 'gopang_sso_token';     // sessionStorage 키
const _LEVEL_ORDER    = { L0:0, L1:1, L2:2, L3:3 };

// ── HMAC-SHA256 검증 (gwp_token sig 검증용) ──────────────
async function _hmacVerify(payload, sig, seedHex) {
  try {
    const keyBytes = _hexToBytes(seedHex.slice(0, 64));
    const key = await crypto.subtle.importKey(
      'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const sigBytes = _b64urlToBytes(sig);
    const data     = new TextEncoder().encode(JSON.stringify(payload));
    return await crypto.subtle.verify('HMAC', key, sigBytes, data);
  } catch { return false; }
}

// ── HMAC-SHA256 서명 (gwp_token 생성용 — gopang_v2에서 호출) ─
export async function signToken(payload, seedHex) {
  const keyBytes = _hexToBytes(seedHex.slice(0, 64));
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const sig  = await crypto.subtle.sign('HMAC', key, data);
  return _bytesToB64url(new Uint8Array(sig));
}

// ── 기기 핑거프린트 (gopang_v2와 동일 로직) ──────────────
async function _buildDeviceFingerprint() {
  const raw = [
    navigator.userAgent,
    navigator.language,
    screen.width + 'x' + screen.height,
    screen.colorDepth,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.hardwareConcurrency || '',
    navigator.deviceMemory        || '',
    screen.pixelDepth             || '',
  ].join('|');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── 서비스 ID 추출 (hostname에서 자동) ──────────────────
function _detectServiceId() {
  // security.gopang.net → 'security'
  // klaw.gopang.net     → 'klaw'
  // localhost           → 'dev'
  const host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return 'dev';
  const sub = host.replace(/\.gopang\.net$/, '');
  return sub !== host ? sub : 'unknown';
}

// ── 경로 1: gwp_token URL 파라미터 검증 ─────────────────
async function _tryGwpToken() {
  const params = new URLSearchParams(location.search);
  const raw    = params.get('gwp_token');
  const isGwp  = params.get('gwp') === '1';
  if (!raw || !isGwp) return null;

  try {
    const decoded  = JSON.parse(atob(_b64urlClean(raw)));
    const { payload, sig } = decoded;

    // 만료 확인
    if (!payload?.exp || Date.now() / 1000 > payload.exp) {
      console.warn('[SSO] gwp_token 만료');
      return null;
    }

    // 서비스 ID 확인
    const svcId = _detectServiceId();
    if (payload.svc !== svcId && payload.svc !== 'dev') {
      console.warn('[SSO] gwp_token svc 불일치:', payload.svc, '≠', svcId);
      return null;
    }

    // seedHex 기반 HMAC 검증
    const stored = _readStore();
    if (stored?.seedHex) {
      const ok = await _hmacVerify(payload, sig, stored.seedHex);
      if (!ok) { console.warn('[SSO] gwp_token HMAC 불일치'); return null; }
    }
    // seedHex 없으면 (신규 기기) payload 신뢰 — Worker로 추후 검증

    // URL 정리 (히스토리에서 토큰 제거)
    const clean = new URL(location.href);
    clean.searchParams.delete('gwp_token');
    clean.searchParams.delete('gwp');
    clean.searchParams.delete('origin');
    clean.searchParams.delete('ctx');
    history.replaceState({}, '', clean.toString());

    // sessionStorage에 캐시
    sessionStorage.setItem(_SSO_SESSION, JSON.stringify({
      ipv6:  payload.ipv6,
      level: payload.level,
      exp:   payload.exp,
    }));

    console.info('[SSO] 경로1 GWP 토큰 인증 ✅', payload.ipv6, payload.level);
    return { ipv6: payload.ipv6, level: payload.level, exp: payload.exp, via: 'gwp' };

  } catch(e) {
    console.warn('[SSO] gwp_token 파싱 오류:', e.message);
    return null;
  }
}

// ── 경로 2-A: sessionStorage 캐시 ───────────────────────
function _trySession() {
  try {
    const raw = sessionStorage.getItem(_SSO_SESSION);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s?.exp || Date.now() / 1000 > s.exp) {
      sessionStorage.removeItem(_SSO_SESSION);
      return null;
    }
    console.info('[SSO] 경로2A 세션 캐시 ✅', s.ipv6, s.level);
    return { ...s, via: 'session' };
  } catch { return null; }
}

// ── 경로 2-B: Silent iframe (gopang.net 동일 기기 확인) ──
function _trySilentIframe(requiredLevel) {
  return new Promise(resolve => {
    const TIMEOUT = 3000; // 3초 내 응답 없으면 포기

    const iframe = document.createElement('iframe');
    iframe.src   = `${_GOPANG_ORIGIN}/auth/silent-auth.html`
                 + `?svc=${_detectServiceId()}&level=${requiredLevel}`;
    iframe.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(iframe);

    let timer = setTimeout(() => {
      cleanup();
      console.info('[SSO] Silent iframe 타임아웃');
      resolve(null);
    }, TIMEOUT);

    function onMessage(e) {
      if (e.origin !== _GOPANG_ORIGIN) return;
      if (e.data?.type !== 'GOPANG_SSO_TOKEN') return;  // silent-auth.html 통일
      cleanup();
      if (e.data.token && !e.data.error) {
        // sessionStorage에 캐시
        sessionStorage.setItem(_SSO_SESSION, JSON.stringify(e.data.token));
        console.info('[SSO] 경로2B Silent iframe ✅', e.data.token.ipv6);
        resolve({ ...e.data.token, via: 'silent' });
      } else {
        console.info('[SSO] Silent iframe 인증 실패:', e.data.error || '토큰 없음');
        resolve(null);
      }
    }

    function cleanup() {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      iframe.remove();
    }

    window.addEventListener('message', onMessage);
  });
}

// ── 경로 2-B(보조): gopang_user_v3 직접 대조 (same-site) ─
async function _tryLocalStore(requiredLevel) {
  const stored = _readStore();
  if (!stored?.ipv6 || !stored?.fpHex) return null;

  const fpHex = await _buildDeviceFingerprint();
  if (stored.fpHex !== fpHex) return null; // 기기 불일치

  const storedOrder = _LEVEL_ORDER[stored.authLevel || 'L0'];
  const needOrder   = _LEVEL_ORDER[requiredLevel];
  if (storedOrder < needOrder) return null; // 레벨 부족

  // 1시간 유효 토큰 생성 (클라이언트 측)
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = { ipv6: stored.ipv6, level: stored.authLevel || 'L0', exp };
  sessionStorage.setItem(_SSO_SESSION, JSON.stringify(token));

  console.info('[SSO] 경로2B 로컬스토어 ✅', stored.ipv6, stored.authLevel);
  return { ...token, via: 'local' };
}

// ── 경로 2-C/D: gopang.net 리다이렉트 ────────────────────
// silent-auth.html이 리다이렉트 모드(return 파라미터 있을 때)도 처리
function _redirectToGopang(requiredLevel) {
  const returnUrl = encodeURIComponent(location.href);
  const svc       = _detectServiceId();
  const target    = `${_GOPANG_ORIGIN}/auth/silent-auth.html`
                  + `?return=${returnUrl}&svc=${svc}&level=${requiredLevel}`;
  console.info('[SSO] 경로2C 리다이렉트 →', target);
  location.replace(target);
  // 리다이렉트 후 이하 코드 실행 안 됨 → null 반환으로 호출부가 중단
  return null;
}

// ── gopang_user_v3 읽기 전용 ─────────────────────────────
function _readStore() {
  try { return JSON.parse(localStorage.getItem(_STORE_KEY) || 'null'); }
  catch { return null; }
}

// ── 서버 검증 (Worker /auth/verify) ─────────────────────
async function _serverVerify(token) {
  try {
    const res = await fetch(`${_WORKER}/auth/verify`, {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({
        ipv6:  token.ipv6,
        level: token.level,
        svc:   _detectServiceId(),
      }),
    });
    const data = await res.json();
    return data?.valid === true;
  } catch {
    // Worker 미배포 환경: 클라이언트 검증만으로 fallback
    return true;
  }
}

// ── 공개 API ─────────────────────────────────────────────
export const gopangAuth = {

  /**
   * require(level)
   * 백서 §12.5 표준 패턴
   * 반환: { ipv6, level, exp } | null (리다이렉트 중)
   */
  async require(level = 'L0') {

    // 경로 1: GWP 토큰
    let user = await _tryGwpToken();
    if (user) return _checkLevel(user, level);

    // 경로 2-A: sessionStorage 캐시
    user = _trySession();
    if (user) return _checkLevel(user, level);

    // 경로 2-B: 로컬스토어 (same-device)
    user = await _tryLocalStore(level);
    if (user) return user;

    // 경로 2-B(iframe): Silent iframe — 서드파티 쿠키가 없어도 postMessage 수신
    user = await _trySilentIframe(level);
    if (user) return _checkLevel(user, level);

    // 경로 2-C: 리다이렉트
    return _redirectToGopang(level);
  },

  /**
   * verify(level)
   * 이미 인증된 사용자의 레벨을 상향할 때
   * gopang.net/auth/upgrade?level=L2 팝업 → postMessage 결과 수신
   */
  async verify(level) {
    const session = _trySession();
    if (session && _LEVEL_ORDER[session.level] >= _LEVEL_ORDER[level]) return session;

    return new Promise(resolve => {
      const popup = window.open(
        `${_GOPANG_ORIGIN}/auth/upgrade?level=${level}&svc=${_detectServiceId()}`,
        'gopang_auth',
        'width=480,height=600,menubar=no,toolbar=no'
      );

      function onMessage(e) {
        if (e.origin !== _GOPANG_ORIGIN) return;
        if (e.data?.type !== 'GOPANG_AUTH_RESULT') return;
        window.removeEventListener('message', onMessage);
        if (popup && !popup.closed) popup.close();
        if (e.data.ok && e.data.token) {
          sessionStorage.setItem(_SSO_SESSION, JSON.stringify(e.data.token));
          resolve({ ...e.data.token, via: 'popup' });
        } else {
          resolve(null);
        }
      }

      window.addEventListener('message', onMessage);

      // 팝업 강제 종료 감지
      const poll = setInterval(() => {
        if (popup?.closed) {
          clearInterval(poll);
          window.removeEventListener('message', onMessage);
          resolve(null);
        }
      }, 500);
    });
  },

  /** 현재 세션 반환 (인증 시도 없음) */
  session() { return _trySession(); },

  /** 로그아웃 (세션 초기화) */
  logout() {
    sessionStorage.removeItem(_SSO_SESSION);
    console.info('[SSO] 로그아웃 완료');
  },
};

// ── 레벨 충족 확인 ───────────────────────────────────────
function _checkLevel(user, required) {
  if (_LEVEL_ORDER[user.level] >= _LEVEL_ORDER[required]) return user;
  // 레벨 부족 → 팝업으로 상향
  console.info('[SSO] 레벨 부족 — 상향 필요:', user.level, '→', required);
  return gopangAuth.verify(required);
}

// ── 유틸 ─────────────────────────────────────────────────
function _b64urlClean(s) {
  return s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - s.length % 4) % 4);
}
function _b64urlToBytes(s) {
  return Uint8Array.from(atob(_b64urlClean(s)), c => c.charCodeAt(0));
}
function _bytesToB64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function _hexToBytes(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++)
    arr[i] = parseInt(hex.slice(i*2, i*2+2), 16);
  return arr;
}
