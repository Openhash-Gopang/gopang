/**
 * core/auth.js — 사용자 인증·등록 v3.0
 * - Sign-in: handle로 L1 조회 → 자동 로그인
 * - Sign-up: 이름 입력 → GUID 생성 → L1 등록
 * - 익명 모드: randomUUID → sessionStorage
 * - 내 기기: localStorage / 공용 기기: sessionStorage
 */
import { setUser, _USER, USER_GUID, L1_URL } from './state.js';
import { appendBubble } from '../ui/bubble.js';

const STORE_KEY = 'gopang_user_v4';

// ── SHA-256 헬퍼 ─────────────────────────────────────────
export async function _sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ── UUID → IPv6 형식 GUID ────────────────────────────────
function _uuidToIPv6() {
  const uuid = crypto.randomUUID().replace(/-/g, '');
  const groups = [];
  for (let i = 0; i < 8; i++) groups.push(uuid.slice(i*4, i*4+4));
  groups[0] = '2601';
  groups[1] = 'db80';
  return groups.join(':');
}

// ── 저장소 읽기 ──────────────────────────────────────────
function _loadStored() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || 'null') ||
           JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null');
  } catch { return null; }
}

// ── 사용자 초기화 (앱 시작 시 1회) ──────────────────────
export async function initAuth() {
  const stored = _loadStored();

  if (stored?.ipv6) {
    console.info('[Auth] 자동 로그인 ✅', stored.ipv6);
    setUser(stored);
    return stored;
  }

  return new Promise((resolve) => {
    _showSignPopup(resolve);
  });
}

// ── 진입 팝업 (Sign-in / Sign-up / 익명) ─────────────────
function _showSignPopup(resolve) {
  const overlay = document.createElement('div');
  overlay.id = '_sign-overlay';
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:9999',
    'background:rgba(0,0,0,0.4)',
    'display:flex;align-items:center;justify-content:center',
    'padding:24px;box-sizing:border-box',
  ].join(';');

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:20px;padding:32px 24px;
                width:100%;max-width:340px;box-sizing:border-box;">

      <!-- Sign-in 입력 필드 -->
      <div style="margin-bottom:12px">
        <div style="display:flex;align-items:center;
                    border:1px solid #e5e7eb;border-radius:12px;
                    background:#f9fafb;overflow:hidden">
          <div style="padding:0 14px;display:flex;align-items:center;
                      border-right:1px solid #e5e7eb;height:50px;flex-shrink:0">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
                 stroke="#9ca3af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          </div>
          <input id="_signin-handle" type="text"
            placeholder="고팡 아이디  예: @금능#0996"
            style="flex:1;padding:0 12px;height:50px;border:none;background:transparent;
                   font-size:14px;font-family:inherit;outline:none;color:#111827;min-width:0"
            autocomplete="off" autocorrect="off" spellcheck="false"/>
          <button id="_signin-mic"
            style="padding:0 13px;height:50px;border:none;background:transparent;
                   cursor:pointer;display:flex;align-items:center;
                   border-left:1px solid #e5e7eb;flex-shrink:0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="#9ca3af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="2" width="6" height="11" rx="3"/>
              <path d="M5 10a7 7 0 0 0 14 0"/>
              <line x1="12" y1="19" x2="12" y2="22"/>
              <line x1="8" y1="22" x2="16" y2="22"/>
            </svg>
          </button>
          <button id="_signin-btn"
            style="padding:0 14px;height:50px;border:none;background:transparent;
                   cursor:pointer;display:flex;align-items:center;
                   border-left:1px solid #e5e7eb;flex-shrink:0">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
                 stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
        <div id="_signin-error" style="display:none;font-size:12px;color:#dc2626;
             margin-top:6px;padding:0 4px"></div>
      </div>

      <!-- 구분선 -->
      <div style="display:flex;align-items:center;gap:10px;margin:16px 0">
        <div style="flex:1;height:1px;background:#f3f4f6"></div>
        <span style="font-size:12px;color:#d1d5db">또는</span>
        <div style="flex:1;height:1px;background:#f3f4f6"></div>
      </div>

      <!-- Sign-up -->
      <button id="_signup-btn"
        style="width:100%;padding:13px;border-radius:12px;
               background:#16a34a;border:none;color:#fff;
               font-size:15px;font-weight:600;font-family:inherit;
               cursor:pointer;margin-bottom:10px;
               display:flex;align-items:center;justify-content:center;gap:8px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <line x1="19" y1="8" x2="19" y2="14"/>
          <line x1="22" y1="11" x2="16" y2="11"/>
        </svg>
        새 아이디 만들기
      </button>

      <!-- 익명 모드 -->
      <button id="_anon-btn"
        style="width:100%;padding:12px;border-radius:12px;
               background:transparent;border:1px solid #e5e7eb;
               color:#6b7280;font-size:14px;font-family:inherit;cursor:pointer;
               display:flex;align-items:center;justify-content:center;gap:8px">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
          <line x1="1" y1="1" x2="23" y2="23"/>
        </svg>
        익명 모드
      </button>

    </div>`;

  document.body.appendChild(overlay);

  // 입력 포커스 스타일
  const input = document.getElementById('_signin-handle');
  input.addEventListener('focus', () => input.style.borderColor = '#16a34a');
  input.addEventListener('blur',  () => input.style.borderColor = '#e5e7eb');

  // Sign-in
  const _doSignIn = async () => {
    const handle = input.value.trim();
    if (!handle) { input.focus(); return; }

    const errEl = document.getElementById('_signin-error');
    const btn   = document.getElementById('_signin-btn');
    btn.disabled = true;
    btn.textContent = '확인 중…';
    errEl.style.display = 'none';

    try {
      // handle로 L1 조회
      const filter = encodeURIComponent(`handle='${handle}'`);
      const res  = await fetch(`${L1_URL}?filter=${filter}&perPage=1`);
      const data = await res.json();
      const found = data.items?.[0];

      if (!found?.guid) {
        errEl.textContent = '아이디를 찾을 수 없습니다.';
        errEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = '로그인';
        return;
      }

      overlay.remove();
      _showTrustPopup(resolve, found.guid, {
        handle: found.handle,
        name: found.handle.replace(/@(.+)#.+/, '$1'),
        isGuest: false, isTemp: false,
        registeredAt: found.created
      });

    } catch(e) {
      errEl.textContent = '네트워크 오류. 다시 시도해 주세요.';
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = '로그인';
    }
  };

  document.getElementById('_signin-btn').onclick = _doSignIn;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') _doSignIn(); });

  // Sign-up
  document.getElementById('_signup-btn').onclick = () => {
    overlay.remove();
    _showSignUpPopup(resolve);
  };

  // 익명 모드
  document.getElementById('_anon-btn').onclick = () => {
    overlay.remove();
    const user = {
      ipv6: _uuidToIPv6(),
      isGuest: true, isAnon: true,
      registeredAt: new Date().toISOString()
    };
    sessionStorage.setItem(STORE_KEY, JSON.stringify(user));
    setUser(user);
    resolve(user);
  };
}

// ── Sign-up 팝업 ─────────────────────────────────────────
function _showSignUpPopup(resolve) {
  const overlay = document.createElement('div');
  overlay.id = '_signup-overlay';
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:9999',
    'background:rgba(0,0,0,0.4)',
    'display:flex;align-items:center;justify-content:center',
    'padding:24px;box-sizing:border-box',
  ].join(';');

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:36px 28px;
                width:100%;max-width:360px;box-sizing:border-box;">
      <button id="_signup-back"
        style="background:none;border:none;color:#16a34a;font-size:14px;
               cursor:pointer;padding:0;margin-bottom:20px;font-family:inherit">
        ← 뒤로
      </button>
      <h2 style="margin:0 0 8px;font-size:18px;font-weight:600;color:#111827;
                 letter-spacing:-0.4px">새 아이디 만들기</h2>
      <p style="margin:0 0 20px;font-size:13px;color:#6b7280;line-height:1.6">
        표시될 이름을 입력하세요.<br>
        <span style="color:#9ca3af;font-size:12px">아이디 형식: @이름#고유번호</span>
      </p>
      <input id="_signup-name" type="text" maxlength="20"
        placeholder="표시될 이름"
        style="width:100%;padding:12px 14px;border:1px solid #e5e7eb;border-radius:10px;
               font-size:15px;font-family:inherit;outline:none;
               box-sizing:border-box;margin-bottom:16px"
        autocomplete="off" autocorrect="off" spellcheck="false"/>
      <button id="_signup-confirm"
        style="width:100%;padding:13px;border-radius:10px;
               background:#16a34a;color:#fff;border:none;
               font-size:15px;font-weight:600;font-family:inherit;cursor:pointer">
        아이디 만들기
      </button>
    </div>`;

  document.body.appendChild(overlay);

  const input = document.getElementById('_signup-name');
  input.focus();
  input.addEventListener('focus', () => input.style.borderColor = '#16a34a');
  input.addEventListener('blur',  () => input.style.borderColor = '#e5e7eb');

  document.getElementById('_signup-back').onclick = () => {
    overlay.remove();
    _showSignPopup(resolve);
  };

  const _doSignUp = async () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }

    const btn = document.getElementById('_signup-confirm');
    btn.disabled = true;
    btn.textContent = '생성 중…';

    const ipv6 = _uuidToIPv6();
    overlay.remove();
    _showTrustPopup(resolve, ipv6, null, name);
  };

  document.getElementById('_signup-confirm').onclick = _doSignUp;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') _doSignUp(); });
}

// ── 기기 신뢰 선택 팝업 ─────────────────────────────────
// existingUser: Sign-in 시 L1에서 가져온 사용자 정보
// newName: Sign-up 시 입력한 이름
function _showTrustPopup(resolve, ipv6, existingUser = null, newName = null) {
  const overlay = document.createElement('div');
  overlay.id = '_trust-overlay';
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:9999',
    'background:rgba(0,0,0,0.4)',
    'display:flex;align-items:center;justify-content:center',
    'padding:24px;box-sizing:border-box',
  ].join(';');

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:36px 28px;
                width:100%;max-width:360px;box-sizing:border-box;text-align:center;">
      <h2 style="margin:0 0 8px;font-size:18px;font-weight:600;color:#111827;
                 letter-spacing:-0.4px">이 기기를<br>신뢰하시겠습니까?</h2>
      <p style="margin:0 0 28px;font-size:13px;color:#6b7280;line-height:1.6">
        내 기기를 선택하면 다음에 자동으로 로그인됩니다
      </p>
      <button id="_trust-mine"
        style="width:100%;padding:13px;border-radius:10px;
               background:#16a34a;color:#fff;border:none;
               font-size:15px;font-weight:600;font-family:inherit;
               cursor:pointer;margin-bottom:10px;">
        내 기기 (자동 로그인 유지)
      </button>
      <button id="_trust-public"
        style="width:100%;padding:12px;border-radius:10px;
               background:transparent;color:#6b7280;
               border:1px solid #e5e7eb;
               font-size:14px;font-family:inherit;cursor:pointer;">
        공용 기기 (탭 닫으면 삭제)
      </button>
    </div>`;

  document.body.appendChild(overlay);

  const _save = async (storage) => {
    overlay.remove();

    let user;
    if (existingUser) {
      // Sign-in: L1에서 복원
      user = { ipv6, ...existingUser };
    } else {
      // Sign-up: 새 GUID + 이름 → L1 등록
      user = {
        ipv6, isGuest: false, isTemp: false,
        registeredAt: new Date().toISOString()
      };
      storage.setItem(STORE_KEY, JSON.stringify(user));
      setUser(user);

      // L1 자동 등록
      if (newName) {
        const nickname_hash = await _sha256('ko:' + newName);
        const handle        = '@' + newName + '#' + ipv6.slice(-4);
        try {
          await fetch(L1_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              guid: ipv6, nickname_hash, handle,
              native_lang: navigator.language?.slice(0,2) || 'ko',
              is_public: true
            })
          });
          user.handle = handle;
          user.name   = newName;
          user.isTemp = false;
          console.info('[L1] 등록 완료:', handle);
        } catch(e) {
          console.warn('[L1] 등록 실패:', e.message);
        }
      }
    }

    storage.setItem(STORE_KEY, JSON.stringify(user));
    setUser(user);
    resolve(user);
  };

  document.getElementById('_trust-mine').onclick   = () => _save(localStorage);
  document.getElementById('_trust-public').onclick = () => _save(sessionStorage);
}

// ── 등록 여부 판별 ────────────────────────────────────────
export function _isRegistered() {
  try {
    return !!(_loadStored()?.handle);
  } catch { return false; }
}

export function _isTypeBorC() {
  try {
    const s = _loadStored();
    if (!s) return false;
    return !!(s.seedHex || s.faceVec || s.webauthn?.credentialId || s.handle);
  } catch { return false; }
}

// ── GDC 사용자 판별 ──────────────────────────────────────
export function _isGDCUser() {
  try {
    const s = _loadStored();
    return !!(s?.gdcEnabled && s?.walletPubKey);
  } catch { return false; }
}

// ── L1 PocketBase 등록 (설정 창에서 호출) ────────────────
export async function _registerToL1(name) {
  const user = _USER;
  if (!user) return null;
  const guid          = user.ipv6 || USER_GUID;
  const nickname_hash = await _sha256('ko:' + name);
  const handle        = '@' + name + '#' + guid.slice(-4);

  try {
    const postRes = await fetch(L1_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guid, nickname_hash, handle,
        native_lang: navigator.language?.slice(0,2) || 'ko',
        is_public: true
      }),
    });

    if (!postRes.ok) {
      const safeGuid   = guid.replace(/'/g, "\\'");
      const filter     = encodeURIComponent(`guid='${safeGuid}'`);
      const getRes     = await fetch(`${L1_URL}?filter=${filter}&perPage=1`);
      const getData    = await getRes.json();
      const existingId = getData.items?.[0]?.id;
      if (existingId) {
        await fetch(`${L1_URL}/${existingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guid, nickname_hash, handle, is_public: true }),
        });
      } else {
        throw new Error('레코드 조회 실패: ' + getRes.status);
      }
    }

    user.handle  = handle;
    user.name    = name;
    user.isGuest = false;
    user.isTemp  = false;

    if (localStorage.getItem(STORE_KEY)) {
      localStorage.setItem(STORE_KEY, JSON.stringify(user));
    } else {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(user));
    }

    console.info('[L1] 등록 완료:', handle);
    return handle;

  } catch(e) {
    console.warn('[L1] 등록 실패:', e.message);
    return null;
  }
}

// ── 기기 완전 초기화 ─────────────────────────────────────
export async function _deviceFullReset() {
  if (!confirm('기기를 완전 초기화합니다.\n판매·양도 전 실행하세요.\n\n⚠️ 이 기기의 모든 고팡 데이터가 삭제됩니다.')) return;

  try {
    const stored = _loadStored();
    if (stored?.ipv6) {
      const filter = encodeURIComponent(`guid='${stored.ipv6}'`);
      const res    = await fetch(`${L1_URL}?filter=${filter}&perPage=1`);
      if (res.ok) {
        const data = await res.json();
        const id   = data.items?.[0]?.id;
        if (id) await fetch(`${L1_URL}/${id}`, { method: 'DELETE' });
      }
    }
  } catch(e) { console.warn('[Reset] L1 삭제 실패:', e.message); }

  localStorage.clear();
  sessionStorage.clear();

  const dbs = await indexedDB.databases?.() || [];
  for (const db of dbs) indexedDB.deleteDatabase(db.name);

  const keys = await caches.keys();
  await Promise.all(keys.map(k => caches.delete(k)));
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.map(r => r.unregister()));

  location.reload();
}

// ── gopangAuth — 레벨별 인증 요구 ────────────────────────
export const gopangAuth = {
  async require(level = 'L0') {
    const stored = _loadStored();
    if (!stored?.ipv6) return false;
    const levels  = ['L0','L1','L2','L3'];
    const current = levels.indexOf(stored.authLevel || 'L0');
    const needed  = levels.indexOf(level);
    if (current >= needed) return true;

    if (needed >= 1) {
      if (!stored.faceVec) {
        appendBubble('ai', '⚠️ 얼굴을 먼저 등록해 주세요. (설정 → 보안)', true);
        return false;
      }
      appendBubble('ai', '📷 얼굴 인증이 필요합니다.', true);
      const vec = await _captureFaceVector();
      if (!vec) return false;
      const sim = _cosineSim(vec, stored.faceVec);
      if (sim < 0.90) {
        appendBubble('ai', `❌ 얼굴 인증 실패 (유사도 ${(sim*100).toFixed(1)}%)`, true);
        return false;
      }
      if (needed === 1) return true;
    }

    if (needed >= 2) {
      const credId = stored.webauthn?.credentialId;
      if (!credId) {
        appendBubble('ai', '⚠️ 지문을 먼저 등록해 주세요. (설정 → 보안)', true);
        return false;
      }
      try {
        appendBubble('ai', '🔐 지문 인증이 필요합니다.', true);
        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const assertion = await navigator.credentials.get({
          publicKey: {
            challenge, timeout: 30000, userVerification: 'required',
            allowCredentials: [{
              id: Uint8Array.from(atob(credId.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0)),
              type: 'public-key'
            }],
          },
        });
        if (!assertion) return false;
        if (needed === 2) { appendBubble('ai', '✅ 지문 인증 완료.', true); return true; }
      } catch(e) { appendBubble('ai', '지문 인증이 취소됐습니다.', true); return false; }
    }

    if (needed >= 3) {
      const words = prompt('4단어 시드를 입력하세요:');
      if (!words) return false;
      const inputGUID = await _seedToGUID(words);
      if (inputGUID !== stored.ipv6) {
        appendBubble('ai', '❌ 시드가 일치하지 않습니다.', true);
        return false;
      }
      appendBubble('ai', '✅ L3 인증 완료.', true);
      return true;
    }
    return false;
  }
};

// ── 인증 확인 버튼 ───────────────────────────────────────
export function _injectAuthConfirmButton(level) {
  const list = document.getElementById('message-list');
  if (!list) return;
  const labels = { L1:'얼굴 인증', L2:'지문 인증', L3:'시드 인증' };
  const row = document.createElement('div');
  row.className = 'msg-row ai';
  row.id = '_auth-confirm-row';
  row.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;padding:4px 0;">
      <button onclick="window._executeAuthAndProceed('${level}')"
        style="background:var(--tint);color:#fff;border:none;border-radius:8px;
               padding:10px 20px;font-size:14px;font-weight:600;cursor:pointer;">
        🔐 ${labels[level]||'추가 인증'} 후 진행
      </button>
      <button onclick="window._cancelAuthRequest()"
        style="background:var(--bg-subtle);color:var(--label-2);border:1px solid var(--sep);
               border-radius:8px;padding:10px 16px;font-size:13px;cursor:pointer;">취소</button>
    </div>`;
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;
}

window._executeAuthAndProceed = async function(level) {
  document.getElementById('_auth-confirm-row')?.remove();
  const { callAI } = await import('../ai/call-ai.js');
  const ok = await gopangAuth.require(level);
  if (!ok) { appendBubble('ai', '인증이 취소됐습니다.', true); return; }
  appendBubble('user', `[인증완료:${level}] 인증이 완료됐습니다.`, false);
  await callAI(`[AUTH_CONFIRMED:${level}] 사용자가 ${level} 인증을 완료했습니다. 이전 요청을 즉시 실행하세요.`);
};

window._cancelAuthRequest = function() {
  document.getElementById('_auth-confirm-row')?.remove();
  appendBubble('ai', '거래가 취소됐습니다.', true);
};
