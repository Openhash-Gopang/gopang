/**
 * core/auth.js — 사용자 인증·등록 v3.3
 * - 내부: E.164 풀번호 기반 GUID/nickname_hash
 * - UI:   한국 기본(뒷 8자리), 비KR은 국가prefix handle (@US-XXXXXXXX)
 * - 익명 모드 없음
 * - 항상 localStorage 저장 (내 기기)
 */
import { setUser, _USER, USER_GUID, L1_URL } from './state.js';
import { appendBubble } from '../ui/bubble.js';

const STORE_KEY = 'gopang_user_v4';

// ── 국가 설정 ─────────────────────────────────────────────
const COUNTRIES = {
  KR: { flag: '🇰🇷', name: '한국', code: '+82',  prefix: '010', digits: 8 },
  US: { flag: '🇺🇸', name: 'USA',  code: '+1',   prefix: '',    digits: 10 },
  JP: { flag: '🇯🇵', name: '日本', code: '+81',  prefix: '0',   digits: 10 },
  CN: { flag: '🇨🇳', name: '中国', code: '+86',  prefix: '',    digits: 11 },
  GB: { flag: '🇬🇧', name: 'UK',   code: '+44',  prefix: '0',   digits: 10 },
};
const DEFAULT_COUNTRY = 'KR';

// ── E.164 / Handle / GUID 빌더 ────────────────────────────
export function buildE164(phoneDigits, countryKey = DEFAULT_COUNTRY) {
  const c = COUNTRIES[countryKey] || COUNTRIES[DEFAULT_COUNTRY];
  return c.code + c.prefix + phoneDigits;
  // KR 예: +82 + 010 + 96627170 = +821096627170
}

export function buildHandle(phoneDigits, countryKey = DEFAULT_COUNTRY) {
  return countryKey === DEFAULT_COUNTRY
    ? `@${phoneDigits}`
    : `@${countryKey}-${phoneDigits}`;
}

// ── SHA-256 헬퍼 ─────────────────────────────────────────
export async function _sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ── E.164 → IPv6 형식 GUID ───────────────────────────────
async function _e164ToIPv6(e164) {
  const hash = await _sha256('gopang-phone:' + e164);
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
  let selectedCountry = DEFAULT_COUNTRY;

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

      <!-- 국가 선택 드롭다운 (기본 숨김) -->
      <div id="_country-select" style="display:none;margin-bottom:12px;
           border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;background:#f9fafb">
        ${Object.entries(COUNTRIES).map(([key, c]) => `
          <div data-country="${key}"
               style="padding:12px 16px;cursor:pointer;font-size:14px;
                      display:flex;align-items:center;gap:10px;
                      border-bottom:1px solid #f0f0f0"
               onmouseover="this.style.background='#f0fdf4'"
               onmouseout="this.style.background='transparent'">
            <span>${c.flag}</span>
            <span style="flex:1">${c.name}</span>
            <span style="color:#9ca3af;font-size:12px">${c.code}</span>
          </div>`).join('')}
      </div>

      <!-- 입력 필드 -->
      <div style="display:flex;align-items:center;
                  border:1px solid #e5e7eb;border-radius:12px;
                  background:#f9fafb;overflow:hidden;margin-bottom:8px"
           id="_phone-field">

        <!-- 국기 버튼 -->
        <button id="_country-btn"
          style="padding:0 12px;height:52px;border:none;background:transparent;
                 cursor:pointer;font-size:20px;border-right:1px solid #e5e7eb;
                 flex-shrink:0;display:flex;align-items:center;gap:4px">
          <span id="_flag-icon">🇰🇷</span>
          <span style="font-size:10px;color:#9ca3af">▼</span>
        </button>

        <input id="_phone-input" type="tel" maxlength="8"
          placeholder="뒷 8자리"
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

  const input     = document.getElementById('_phone-input');
  const field     = document.getElementById('_phone-field');
  const errEl     = document.getElementById('_phone-error');
  const countryEl = document.getElementById('_country-select');
  const flagIcon  = document.getElementById('_flag-icon');
  const hintEl    = document.getElementById('_phone-hint');

  // 국가 버튼 토글
  document.getElementById('_country-btn').onclick = () => {
    countryEl.style.display = countryEl.style.display === 'none' ? 'block' : 'none';
  };

  // 국가 선택
  countryEl.querySelectorAll('[data-country]').forEach(el => {
    el.onclick = () => {
      selectedCountry = el.dataset.country;
      const c = COUNTRIES[selectedCountry];
      flagIcon.textContent = c.flag;
      input.maxLength = c.digits;
      input.placeholder = selectedCountry === DEFAULT_COUNTRY
        ? '뒷 8자리' : `전화번호 (${c.digits}자리)`;
      hintEl.textContent = selectedCountry === DEFAULT_COUNTRY
        ? '예: 010-9662-7170 → 96627170'
        : `handle: @${selectedCountry}-${'X'.repeat(c.digits)}`;
      countryEl.style.display = 'none';
      input.focus();
    };
  });

  input.focus();
  input.addEventListener('focus', () => field.style.borderColor = '#16a34a');
  input.addEventListener('blur',  () => field.style.borderColor = '#e5e7eb');
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '').slice(0, COUNTRIES[selectedCountry].digits);
    errEl.style.display = 'none';
  });

  const _submit = async () => {
    const val     = input.value.trim();
    const digits  = COUNTRIES[selectedCountry].digits;

    if (!new RegExp(`^\\d{${digits}}$`).test(val)) {
      errEl.textContent = `숫자 ${digits}자리를 입력해 주세요.`;
      errEl.style.display = 'block';
      input.focus();
      return;
    }

    const btn = document.getElementById('_phone-btn');
    btn.style.opacity = '0.4';
    btn.style.pointerEvents = 'none';
    errEl.style.display = 'none';

    try {
      const e164   = buildE164(val, selectedCountry);
      const handle = buildHandle(val, selectedCountry);
      const ipv6   = await _e164ToIPv6(e164);

      // L1 조회 (handle 기준)
      const filter = encodeURIComponent(`handle='${handle}'`);
      const res    = await fetch(`${L1_URL}?filter=${filter}&perPage=1`);
      const data   = await res.json();
      const found  = data.items?.[0];

      let user;
      if (found?.guid) {
        // 기존 사용자 → 로그인
        user = {
          ipv6: found.guid, handle: found.handle,
          e164: found.e164 || e164,
          country_code: found.country_code || selectedCountry,
          name: val, isGuest: false, isTemp: false,
          registeredAt: found.created
        };
        console.info('[Auth] 로그인:', handle);
      } else {
        // 신규 사용자 → 자동 등록
        const nickname_hash = await _sha256('phone:' + e164); // E.164 기반
        user = {
          ipv6, handle, e164, country_code: selectedCountry,
          name: val, isGuest: false, isTemp: false,
          registeredAt: new Date().toISOString()
        };

        await fetch(L1_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            guid: ipv6, nickname_hash, handle,
            e164, country_code: selectedCountry,
            native_lang: navigator.language?.slice(0,2) || 'ko',
            is_public: true
          })
        });
        console.info('[Auth] 신규 등록:', handle, e164);
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
  const countryKey    = user.country_code || DEFAULT_COUNTRY;
  const e164          = user.e164 || buildE164(name, countryKey);
  const guid          = user.ipv6 || USER_GUID;
  const nickname_hash = await _sha256('phone:' + e164);
  const handle        = buildHandle(name, countryKey);

  try {
    const postRes = await fetch(L1_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guid, nickname_hash, handle,
        e164, country_code: countryKey,
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
          body: JSON.stringify({ guid, nickname_hash, handle, e164, country_code: countryKey, is_public: true }),
        });
      }
    }

    user.handle       = handle;
    user.name         = name;
    user.e164         = e164;
    user.country_code = countryKey;
    user.isGuest      = false;
    user.isTemp       = false;
    localStorage.setItem(STORE_KEY, JSON.stringify(user));
    console.info('[L1] 등록 완료:', handle, e164);
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
      const stored = _loadStored();
      const countryKey = stored.country_code || DEFAULT_COUNTRY;
      const phone = prompt('전화번호를 입력하세요:');
      if (!phone) return false;
      const inputE164 = buildE164(phone.trim(), countryKey);
      const inputGUID = await _e164ToIPv6(inputE164);
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
