/**
 * core/auth.js — 사용자 인증·등록 v3.2
 * - 휴대폰 뒷 8자리 입력 → L1 조회 → 로그인 또는 자동 등록
 * - 익명 모드 없음
 * - 항상 localStorage 저장 (내 기기)
 */
import { setUser, _USER, USER_GUID, L1_URL } from './state.js';
import { appendBubble } from '../ui/bubble.js';

const STORE_KEY = 'gopang_user_v4';

// ── SHA-256 헬퍼 ─────────────────────────────────────────
export async function _sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ── 8자리 → IPv6 형식 GUID ──────────────────────────────
async function _phoneToIPv6(digits8) {
  const hash = await _sha256('gopang-phone:' + digits8);
  const groups = [];
  for (let i = 0; i < 8; i++) groups.push(hash.slice(i*4, i*4+4));
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
    _showPhonePopup(resolve);
  });
}

// ── 전화번호 입력 팝업 ───────────────────────────────────
function _showPhonePopup(resolve) {
  const overlay = document.createElement('div');
  overlay.id = '_phone-overlay';
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:9999',
    'background:rgba(0,0,0,0.4)',
    'display:flex;align-items:center;justify-content:center',
    'padding:24px;box-sizing:border-box',
  ].join(';');

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:20px;padding:32px 24px;
                width:100%;max-width:340px;box-sizing:border-box;">

      <div style="display:flex;align-items:center;
                  border:1px solid #e5e7eb;border-radius:12px;
                  background:#f9fafb;overflow:hidden;margin-bottom:8px"
           id="_phone-field">
        <div style="padding:0 14px;display:flex;align-items:center;
                    border-right:1px solid #e5e7eb;height:52px;flex-shrink:0">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
               stroke="#9ca3af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.56 3.35 2 2 0 0 1 3.53 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.6a16 16 0 0 0 6 6l.87-.87a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.5 16z"/>
          </svg>
        </div>
        <input id="_phone-input" type="tel" maxlength="8"
          placeholder="휴대폰 뒷 8자리"
          style="flex:1;padding:0 14px;height:52px;border:none;background:transparent;
                 font-size:16px;font-family:inherit;outline:none;color:#111827;
                 min-width:0;letter-spacing:2px"
          autocomplete="off" inputmode="numeric"/>
        <button id="_phone-btn"
          style="padding:0 16px;height:52px;border:none;background:transparent;
                 cursor:pointer;display:flex;align-items:center;
                 border-left:1px solid #e5e7eb;flex-shrink:0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
               stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
      <div id="_phone-error" style="display:none;font-size:12px;color:#dc2626;
           padding:0 4px;margin-bottom:4px"></div>
      <div id="_phone-hint" style="font-size:12px;color:#9ca3af;padding:0 4px">
        예: 010-9662-7170 → 96627170
      </div>

    </div>`;

  document.body.appendChild(overlay);

  const input  = document.getElementById('_phone-input');
  const field  = document.getElementById('_phone-field');
  const errEl  = document.getElementById('_phone-error');

  input.focus();
  input.addEventListener('focus', () => field.style.borderColor = '#16a34a');
  input.addEventListener('blur',  () => field.style.borderColor = '#e5e7eb');
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '').slice(0, 8);
    errEl.style.display = 'none';
  });

  const _submit = async () => {
    const val = input.value.trim();

    if (!/^\d{8}$/.test(val)) {
      errEl.textContent = '숫자 8자리를 입력해 주세요.';
      errEl.style.display = 'block';
      input.focus();
      return;
    }

    const btn = document.getElementById('_phone-btn');
    btn.style.opacity = '0.4';
    btn.style.pointerEvents = 'none';
    errEl.style.display = 'none';

    try {
      const handle = '@' + val;
      const ipv6   = await _phoneToIPv6(val);

      // L1 조회
      const filter = encodeURIComponent(`handle='${handle}'`);
      const res    = await fetch(`${L1_URL}?filter=${filter}&perPage=1`);
      const data   = await res.json();
      const found  = data.items?.[0];

      let user;
      if (found?.guid) {
        // 기존 사용자 → 로그인
        user = {
          ipv6: found.guid, handle: found.handle,
          name: val, isGuest: false, isTemp: false,
          registeredAt: found.created
        };
        console.info('[Auth] 로그인:', handle);
      } else {
        // 신규 사용자 → 자동 등록
        const nickname_hash = await _sha256('phone:' + val);
        user = {
          ipv6, handle, name: val,
          isGuest: false, isTemp: false,
          registeredAt: new Date().toISOString()
        };

        await fetch(L1_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            guid: ipv6, nickname_hash, handle,
            native_lang: navigator.language?.slice(0,2) || 'ko',
            is_public: true
          })
        });
        console.info('[Auth] 신규 등록:', handle);
      }

      localStorage.setItem(STORE_KEY, JSON.stringify(user));
      setUser(user);
      overlay.remove();
      resolve(user);

    } catch(e) {
      errEl.textContent = '네트워크 오류. 다시 시도해 주세요.';
      errEl.style.display = 'block';
      btn.style.opacity = '1';
      btn.style.pointerEvents = '';
    }
  };

  document.getElementById('_phone-btn').onclick = _submit;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') _submit(); });
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
  const nickname_hash = await _sha256('phone:' + name);
  const handle        = '@' + name;

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
      }
    }

    user.handle  = handle;
    user.name    = name;
    user.isGuest = false;
    user.isTemp  = false;
    localStorage.setItem(STORE_KEY, JSON.stringify(user));
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
      const phone = prompt('휴대폰 뒷 8자리를 입력하세요:');
      if (!phone) return false;
      const inputGUID = await _phoneToIPv6(phone.trim());
      if (inputGUID !== stored.ipv6) {
        appendBubble('ai', '❌ 번호가 일치하지 않습니다.', true);
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
  const labels = { L1:'얼굴 인증', L2:'지문 인증', L3:'번호 인증' };
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
