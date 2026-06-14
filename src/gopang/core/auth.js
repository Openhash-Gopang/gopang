/**
 * core/auth.js — 사용자 인증·등록 v2.0
 * - 4단어 시드 기반 GUID (fpHex 완전 제거)
 * - 내 기기: localStorage / 공용 기기: sessionStorage
 * - 익명 Guest: sessionStorage 임시 UUID
 * - L1 PocketBase 아이디 등록 (upsert)
 * - gopangAuth (레벨별 인증 요구)
 */
import { setUser, _USER, USER_GUID, L1_URL } from './state.js';
import { appendBubble } from '../ui/bubble.js';

const STORE_KEY = 'gopang_user_v4';

// ── SHA-256 헬퍼 ─────────────────────────────────────────
export async function _sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ── 저장소 읽기 (localStorage 우선, sessionStorage 폴백) ─
function _loadStored() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || 'null') ||
           JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null');
  } catch { return null; }
}

// ── 사용자 초기화 (앱 시작 시 1회) ──────────────────────
export async function initAuth() {
  const stored = _loadStored();

  // 자동 로그인
  if (stored?.ipv6) {
    console.info('[Auth] 자동 로그인 ✅', stored.ipv6);
    setUser(stored);
    return stored;
  }

  // 진입 선택 팝업
  return new Promise((resolve) => {
    _showEntryPopup(resolve);
  });
}

// ── 진입 선택 팝업 ───────────────────────────────────────
function _showEntryPopup(resolve) {
  const overlay = document.createElement('div');
  overlay.id = '_entry-overlay';
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:9999',
    'background:rgba(0,0,0,0.4)',
    'display:flex;align-items:center;justify-content:center',
    'padding:24px;box-sizing:border-box',
  ].join(';');

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:40px 28px;
                width:100%;max-width:360px;box-sizing:border-box;text-align:center;">
      <svg width="36" height="36" viewBox="0 0 36 36" fill="none"
           style="margin-bottom:20px" xmlns="http://www.w3.org/2000/svg">
        <circle cx="18" cy="18" r="17" stroke="#16a34a" stroke-width="2"/>
        <text x="18" y="23" text-anchor="middle"
              font-size="14" font-weight="700" fill="#16a34a">고팡</text>
      </svg>
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#111827;
                 letter-spacing:-0.5px">고팡에 오신 것을<br>환영합니다</h2>
      <p style="margin:0 0 32px;font-size:14px;color:#6b7280;line-height:1.6">
        시작하려면 방법을 선택해 주세요
      </p>
      <button id="_entry-seed"
        style="width:100%;padding:13px;border-radius:10px;
               background:#16a34a;color:#fff;border:none;
               font-size:15px;font-weight:600;font-family:inherit;
               cursor:pointer;margin-bottom:10px;">
        4단어로 시작하기
      </button>
      <button id="_entry-anon"
        style="width:100%;padding:12px;border-radius:10px;
               background:transparent;color:#6b7280;
               border:1px solid #e5e7eb;
               font-size:14px;font-family:inherit;cursor:pointer;">
        익명으로 시작하기
      </button>
      <p style="margin:20px 0 0;font-size:11px;color:#9ca3af;line-height:1.5">
        익명 접속은 기록이 저장되지 않습니다
      </p>
    </div>`;

  document.body.appendChild(overlay);

  document.getElementById('_entry-seed').onclick = () => {
    overlay.remove();
    _showSeedPopup(resolve);
  };

  document.getElementById('_entry-anon').onclick = () => {
    overlay.remove();
    const user = {
      ipv6: crypto.randomUUID(),
      isGuest: true, isAnon: true,
      registeredAt: new Date().toISOString()
    };
    sessionStorage.setItem(STORE_KEY, JSON.stringify(user));
    setUser(user);
    resolve(user);
  };
}

// ── 4단어 입력 팝업 ──────────────────────────────────────
function _showSeedPopup(resolve) {
  const overlay = document.createElement('div');
  overlay.id = '_seed-overlay';
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:9999',
    'background:rgba(0,0,0,0.4)',
    'display:flex;align-items:center;justify-content:center',
    'padding:24px;box-sizing:border-box',
  ].join(';');

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:36px 28px;
                width:100%;max-width:360px;box-sizing:border-box;">
      <button id="_seed-back"
        style="background:none;border:none;color:#6b7280;font-size:13px;
               cursor:pointer;padding:0;margin-bottom:20px;display:flex;
               align-items:center;gap:4px;font-family:inherit;">
        ← 뒤로
      </button>
      <h2 style="margin:0 0 8px;font-size:18px;font-weight:600;color:#111827;
                 letter-spacing:-0.4px">나만의 4단어를<br>입력하세요</h2>
      <p style="margin:0 0 6px;font-size:13px;color:#6b7280;line-height:1.6">
        예: <code style="background:#f3f4f6;padding:2px 6px;border-radius:4px;
             font-size:12px">사과 바다 하늘 강</code>
      </p>
      <p style="margin:0 0 20px;font-size:12px;color:#dc2626;line-height:1.5">
        이 단어를 잃으면 계정을 복구할 수 없습니다
      </p>
      <input id="_seed-input" type="text" placeholder="단어를 띄어쓰기로 구분하여 입력"
        style="width:100%;padding:12px;border:1px solid #e5e7eb;border-radius:10px;
               font-size:14px;font-family:inherit;box-sizing:border-box;
               outline:none;margin-bottom:16px;"
        autocomplete="off" autocorrect="off" spellcheck="false"/>
      <button id="_seed-confirm"
        style="width:100%;padding:13px;border-radius:10px;
               background:#16a34a;color:#fff;border:none;
               font-size:15px;font-weight:600;font-family:inherit;cursor:pointer;">
        확인
      </button>
    </div>`;

  document.body.appendChild(overlay);

  const input = document.getElementById('_seed-input');
  input.focus();
  input.addEventListener('focus', () => input.style.borderColor = '#16a34a');
  input.addEventListener('blur',  () => input.style.borderColor = '#e5e7eb');

  const _confirm = async () => {
    const words = input.value.trim();
    if (!words) { input.focus(); return; }
    overlay.remove();
    const ipv6 = await _seedToGUID(words);

    // L1에서 기존 등록 여부 조회 → handle 자동 복원
    let existingHandle = null;
    try {
      const filter = encodeURIComponent(`guid='${ipv6}'`);
      const res = await fetch(`${L1_URL}?filter=${filter}&perPage=1`);
      if (res.ok) {
        const data = await res.json();
        existingHandle = data.items?.[0]?.handle || null;
      }
    } catch(e) { console.warn('[Auth] L1 조회 실패:', e.message); }

    _showTrustPopup(resolve, ipv6, existingHandle);
  };

  document.getElementById('_seed-back').onclick    = () => { overlay.remove(); _showEntryPopup(resolve); };
  document.getElementById('_seed-confirm').onclick = _confirm;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') _confirm(); });
}

// ── 기기 신뢰 선택 팝업 ─────────────────────────────────
function _showTrustPopup(resolve, ipv6, existingHandle = null) {
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

  const _save = (storage) => {
    overlay.remove();
    const user = existingHandle
      ? { ipv6, isGuest: false, isTemp: false,
          handle: existingHandle,
          name: existingHandle.replace(/@(.+)#.+/, '$1'),
          registeredAt: new Date().toISOString() }
      : { ipv6, isGuest: false, isTemp: true,
          registeredAt: new Date().toISOString() };
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

// ── L1 PocketBase 등록 (upsert) ──────────────────────────
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
