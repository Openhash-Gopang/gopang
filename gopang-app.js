/**
 * gopang-app.js — 진입점 v3.0
 * 실제 로직은 전부 src/ 하위 모듈에 있음
 * 이 파일의 역할: import → exposeGlobals → bootstrap
 *
 * webapp.html에서 로드 방식:
 *   <script type="module" src="/gopang-app.js"></script>
 */

// ── Core ─────────────────────────────────────────────────
import { initAuth, initAuthWithPhone, _isRegistered, _isGDCUser, _deviceFullReset, _deviceLocalReset, gopangAuth } from './src/gopang/core/auth.js';
import { loadSettings, CFG, saveSettings }     from './src/gopang/core/config.js';
import { _USER }                               from './src/gopang/core/state.js';

// ── UI ───────────────────────────────────────────────────
import { appendBubble }                        from './src/gopang/ui/bubble.js';
import { openSettings, closeSettings, handleOverlayClick,
         openAISettings, closeAISettings, handleAISettingsOverlayClick,
         _updateHandleChip, _settingsRegisterHandle,
         clearSWCache, _updateSecuritySection,
         openChatHistory, openHashChain, openGopangWallet, openFinancialStatement,
         openMyProfile,
} from './src/gopang/ui/settings.js';
import { openSearch, closeSearch,
         handleSearchOverlayClick,
         runSearch, selectContact,
         openProfile }                          from './src/gopang/ui/search.js';
import { _showRegisterFlow }                   from './src/gopang/ui/register-flow.js';

// ── AI ───────────────────────────────────────────────────
import { toggleAI, activateAI, closeAI }       from './src/gopang/ai/toggle.js';

// ── P2P ──────────────────────────────────────────────────
import { setPeer, _clearPeer,
         _startSignalPoll }                     from './src/gopang/p2p/webrtc.js';

// ── PDV ──────────────────────────────────────────────────
import { recordPDV }                           from './src/gopang/pdv/record.js';
import { loadChainFromIDB }                    from './src/openhash/hashChain.js';

// ── P2P 검색/채팅 (GDUDA Phase 1) ────────────────────────
import { openSearch as openP2PSearch }         from './src/gopang/ui/p2p-search.js';
import { startIncomingWatch }                  from './src/gopang/ui/p2p-chat.js';

// ════════════════════════════════════════════════════════
// 1. 사용자 초기화
// 첫 접속자: 환영 팝업 → 시작하기 → initAuth()
// 기존 사용자: 바로 initAuth()
// ════════════════════════════════════════════════════════
const _isFirstVisit = !localStorage.getItem('gopang_welcomed');
if (!_isFirstVisit) {
  await initAuth();
}

// ════════════════════════════════════════════════════════
// 2. 전역 노출 — import 완료 직후 동기 실행
//    HTML의 onclick이 이 시점 이후 즉시 동작 가능
// ════════════════════════════════════════════════════════
(function exposeGlobals() {
  // 설정
  window.openSettings              = openSettings;
  window.openChatHistory           = openChatHistory;
  window.openHashChain             = openHashChain;
  window.openGopangWallet          = openGopangWallet;
  window.openFinancialStatement    = openFinancialStatement;
  window.openMyProfile             = openMyProfile;
  window.openAISettings            = openAISettings;
  window._deviceFullReset          = _deviceFullReset;
  window._deviceLocalReset         = _deviceLocalReset;
  window._isGDCUser                = _isGDCUser;
  window.closeAISettings           = closeAISettings;
  window.handleAISettingsOverlayClick = handleAISettingsOverlayClick;
  window.closeSettings             = closeSettings;
  window.handleOverlayClick        = handleOverlayClick;
  window.saveSettings              = saveSettings;
  window.clearSWCache              = clearSWCache;
  window._settingsRegisterHandle   = _settingsRegisterHandle;
  window._updateHandleChip         = _updateHandleChip;
  window._settingsRegisterFingerprint = window._settingsRegisterFingerprint || (() => {});
  window._settingsRegisterFace        = window._settingsRegisterFace        || (() => {});

  // 검색
  window.openSearch                = openSearch;
  window.closeSearch               = closeSearch;
  window.runSearch                 = runSearch;
  window.selectContact             = selectContact;
  window.openProfile               = openProfile;
  window.handleSearchOverlayClick  = handleSearchOverlayClick;

  // AI
  window.toggleAI                  = toggleAI;
  window.activateAI                = activateAI;
  window.closeAI                   = closeAI;

  // P2P
  window.setPeer                   = setPeer;
  window._clearPeer                = _clearPeer;

  // P2P 검색/채팅 (GDUDA Phase 1)
  window.openP2PSearch             = openP2PSearch;

  // PDV (하위 시스템 공통)
  window.recordPDV                 = recordPDV;
  window.gopangAuth                = gopangAuth;

  // PWA — gopang-pwa.js 로드 전이므로 빈 함수로 초기화
  // DOMContentLoaded 후 실제 함수로 교체됨
  window.installPWA        = window.installPWA        || (() => {});
  window.dismissInstall    = window.dismissInstall    || (() => {});
  window.dismissIOSInstall = window.dismissIOSInstall || (() => {});
  window.requestInstall    = window.requestInstall    || (() => {});

  console.info('[Gopang v3] 전역 함수 노출 완료');
})();

// ════════════════════════════════════════════════════════
// 3. 설정 복원 + 핸들 칩 초기화
// ════════════════════════════════════════════════════════
loadSettings();
_updateHandleChip(_USER?.nickname || _USER?.handle || null);

// ════════════════════════════════════════════════════════
// 4. DOMContentLoaded — 나머지 모듈 동적 로드
// ════════════════════════════════════════════════════════
const _boot = async () => {

  // 4-0. Hash Chain IDB 복원 — prevHash 연속성 보장
  try {
    await loadChainFromIDB();
  } catch(e) {
    console.warn('[Boot] Hash Chain IDB 복원 실패 (무시):', e.message);
  }

  // 4-1. 부트스트랩 (src/app.js)
  try {
    const { bootstrap } = await import('./src/app.js');
    await bootstrap();
    document.getElementById('status-dot').style.background = 'var(--green)';
  } catch(e) {
    const st = document.getElementById('status-text');
    const sd = document.getElementById('status-dot');
    if (st) st.textContent = '오프라인 모드';
    if (sd) sd.style.background = 'var(--yellow)';
    console.warn('[Boot] 오프라인 모드:', e.message);
  }

  // 4-2. PWA 함수 재노출 (pwa.js 로드 완료 시점)
  ['installPWA','dismissInstall','dismissIOSInstall','requestInstall'].forEach(fn => {
    if (typeof window[fn] === 'function' && window[fn].toString().includes('{}') === false) return;
    // eslint-disable-next-line no-undef
    if (typeof eval(fn) === 'function') window[fn] = eval(fn);
  });

  // 4-3. 나머지 모듈 병렬 로드
  const [
    { sendMessage, handleKey, updateSendBtn, autoResize },
    { triggerAttach, removeAttach, handleFileSelect, triggerCamera },
    { toggleMic },
    { _scheduleLocation, _updateLocationInPrompt, _buildLocNote },
    { _showWelcomeMessage },
    { _onLogoTap, _closeProgressSheet, _progressStart },
    { _gwpLaunch, _gwpClose, _gwpMatch },
    { _handleGwpSignRequest },
    { _klawReview },
    { callAI },
    { runRouter, applyRouterResult },
  ] = await Promise.all([
    import('./src/gopang/ui/send-message.js'),
    import('./src/gopang/ui/file-attach.js'),
    import('./src/gopang/ai/mic.js'),
    import('./src/gopang/services/location.js'),
    import('./src/gopang/ui/welcome.js'),
    import('./src/gopang/ui/progress.js'),
    import('./src/gopang/gwp/engine.js'),
    import('./src/gopang/gwp/sign.js'),
    import('./src/gopang/services/klaw.js'),
    import('./src/gopang/ai/call-ai.js'),
    import('./src/gopang/ai/router.js'),
  ]);

  // 4-4. 동적 로드 함수 전역 노출
  Object.assign(window, {
    sendMessage, handleKey, updateSendBtn, autoResize,
    triggerAttach, removeAttach, handleFileSelect, triggerCamera,
    toggleMic,
    _onLogoTap, _closeProgressSheet,
    _gwpLaunch, _gwpClose,
    callAI, runRouter,
  });


  // 4-6. 입력 이벤트 바인딩
  const input   = document.getElementById('msg-input');
  const sendBtn = document.getElementById('send-btn');
  const camBtn  = document.getElementById('btn-camera');
  const micBtn  = document.getElementById('btn-mic');
  const fileInp = document.getElementById('file-input');
  const camInp  = document.getElementById('camera-input');

  if (input) {
    input.addEventListener('input', (ev) => {
      autoResize(input);
      updateSendBtn();
    });
    input.addEventListener('keydown', (e) => handleKey(e));
  }
  const attBtn = document.getElementById('btn-attach');
  if (attBtn)  attBtn.addEventListener('click',  () => triggerAttach());
  if (sendBtn) sendBtn.addEventListener('click', () => sendMessage());
  if (camBtn)  camBtn.addEventListener('click',  () => triggerCamera());
  if (micBtn)  micBtn.addEventListener('click',  () => toggleMic());
  if (fileInp) fileInp.addEventListener('change', (e) => handleFileSelect(e));
  if (camInp)  camInp.addEventListener('change',  (e) => handleFileSelect(e));

  // 4-7. 초기화
  _showWelcomeMessage();
  _scheduleLocation();

  // 4-8. 등록 사용자 → 시그널 폴링 자동 시작
  if (_isRegistered()) {
    _startSignalPoll();
    console.info('[Signal] 자동 폴링 시작 (등록 사용자)');

    // GDUDA Phase 1 — incoming offer 감시
    if (_USER?.ipv6) startIncomingWatch(_USER.ipv6);
  }

  // 4-9. 세션 저장 훅
  const { _saveOnce } = await import('./src/gopang/core/session.js');
  window.addEventListener('pagehide', _saveOnce);
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') _saveOnce();
  });

  console.info('[Gopang v3] 부트스트랩 완료');

  // 첫 접속자: 환영 팝업 (initAuth 포함)
  // 매 접속마다 환영 팝업 표시 (체크박스로만 숨김)
  _showWelcomePopup();
};
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', _boot);
} else {
  _boot();
}

// ── 첫 접속 환영 팝업 (initAuth 포함) ──────────────────────
function _showWelcomePopup() {
  const stored = (() => {
    try { return JSON.parse(localStorage.getItem('gopang_user_v4') || 'null'); } catch { return null; }
  })();
  const name = stored?.nickname || stored?.handle || null;

  const ov = document.createElement('div');
  ov.id = 'gopang-welcome-overlay';
  ov.style.cssText = [
    'position:fixed;inset:0;z-index:9999',
    'background:rgba(0,0,0,.45)',
    'display:flex;align-items:flex-end;justify-content:center',
  ].join(';');

  ov.innerHTML = `
    <div id="_welcome_sheet" style="
      background:#fff;border-radius:20px 20px 0 0;
      width:100%;max-width:480px;
      max-height:88dvh;overflow-y:auto;
      padding-bottom:calc(24px + env(safe-area-inset-bottom,0px));
      font-family:'Pretendard',-apple-system,sans-serif;
    ">
      <div style="width:36px;height:4px;background:#e5e7eb;border-radius:2px;margin:12px auto 0"></div>

      <!-- 헤더 -->
      <div style="padding:20px 24px 16px;display:flex;align-items:center;gap:14px;border-bottom:1px solid #f3f4f6">
        <div style="width:44px;height:44px;flex-shrink:0;background:#16a34a;border-radius:10px;display:flex;align-items:center;justify-content:center">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
        </div>
        <div>
          <div style="font-size:16px;font-weight:600;color:#111827;line-height:1.3">
            ${name ? name + '님, ' : ''}고팡에 오신 것을<br>환영합니다
          </div>
          <div style="font-size:12px;color:#9ca3af;margin-top:3px">카카오톡과 비슷해 보이지만 근본적으로 다릅니다</div>
        </div>
      </div>

      <!-- 항목 목록 -->
      <div style="padding:16px 24px;display:flex;flex-direction:column;gap:16px">

        ${[
          ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', '완전한 프라이버시', '주고받은 모든 문서와 대화는 스마트폰에 저장되며, 서버가 없습니다. 모든 기록은 본인만 볼 수 있습니다.'],
          ['M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5', '위변조 불가', '모든 기록은 OpenHash 기술로 암호화되어 위조나 변조될 수 없습니다.'],
          ['M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0 1 12 2.944a11.955 11.955 0 0 1-8.618 3.04A12.02 12.02 0 0 0 3 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z', '합법성 보장', '주고받은 데이터의 합법성을 보장하며, 불법적 내용은 적절히 조치합니다(신고 등).'],
          ['M3 6l3 1m0 0-3 9a5.002 5.002 0 0 0 6.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1-3 9a5.002 5.002 0 0 0 6.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3', '판결 추정', '모든 다툼에 대해 수 년 뒤의 대법원 판결문을 상당한 수준의 신뢰도로 예상할 수 있습니다. (자체 평가 일치도 99%)'],
          ['M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M9 15h.01M15 15h.01M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', '정확한 세금', '모든 거래는 즉시 사용자의 장부(재무제표)에 반영되며, 세금은 단 1원도 더 내거나 덜내지 않습니다.'],
          ['M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22', '자세한 정보', 'PC에서 gopang.net에 접속하세요.'],
        ].map(([path, title, desc]) => `
          <div style="display:flex;align-items:flex-start;gap:12px">
            <div style="width:34px;height:34px;flex-shrink:0;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;display:flex;align-items:center;justify-content:center">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#374151" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>
            </div>
            <div>
              <div style="font-size:13px;font-weight:600;color:#111827;margin-bottom:2px">${title}</div>
              <div style="font-size:12px;color:#6b7280;line-height:1.6">${desc}</div>
            </div>
          </div>
        `).join('')}

      </div>

      <!-- 버튼 -->
      <div style="padding:0 24px 4px;display:flex;flex-direction:column;gap:10px">
        <button id="_welcome_ok" style="
          width:100%;padding:14px;
          background:#16a34a;color:#fff;border:none;
          border-radius:12px;font-size:15px;font-weight:600;
          cursor:pointer;font-family:inherit;
        ">시작하기</button>
        <label style="display:flex;align-items:center;justify-content:center;gap:7px;cursor:pointer;margin-top:10px">
          <input type="checkbox" id="_welcome_no_show" style="width:14px;height:14px;accent-color:#16a34a;cursor:pointer">
          <span style="font-size:12px;color:#9ca3af">이 메시지를 다시 표시하지 않음</span>
        </label>
      </div>
    </div>
  `;

  document.body.appendChild(ov);

  // 외부 클릭 닫힘
  ov.addEventListener('click', e => {
    const sheet = document.getElementById('_welcome_sheet');
    if (sheet && !sheet.contains(e.target)) _closeWelcome(ov);
  });

  document.getElementById('_welcome_ok').onclick = () => {
    // 체크박스가 체크된 경우에만 다시 표시 안 함
    if (document.getElementById('_welcome_no_show')?.checked) {
      localStorage.setItem('gopang_welcomed', '1');
    }
    ov.style.opacity = '0';
    ov.style.transition = 'opacity .2s';
    setTimeout(() => ov.remove(), 200);
    // ── Bug Fix: 이미 등록된 사용자는 번호 입력 팝업 표시 안 함 ──
    const _alreadyRegistered = (() => {
      try {
        const s = JSON.parse(localStorage.getItem('gopang_user_v4') || 'null');
        return !!(s?.handle && s?.ipv6);  // ipv6가 실제 저장 키
      } catch { return false; }
    })();
    if (!_alreadyRegistered) {
      // 안내문구 + 번호 입력 통합 팝업
      _showRegisterGuide();
    }
  };
}

function _closeWelcome(ov) {
  localStorage.setItem('gopang_welcomed', '1');
  ov.style.opacity = '0';
  ov.style.transition = 'opacity .2s';
  setTimeout(() => ov.remove(), 200);
}

// ── SW → 앱 메시지 수신 (소리 재생) ────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'PLAY_SOUND') {
      const sound = event.data.sound || localStorage.getItem('gopang_push_sound') || 'ping';
      if (sound === 'none') return;
      const audio = new Audio(`/assets/sounds/${sound}.mp3`);
      audio.play().catch(() => {});
    }
  });
}

// ── 사용자 등록 안내 팝업 (한국 사용자 전화번호 안내) ───────────
function _showRegisterGuide() {
  const ov = document.createElement('div');
  ov.id = 'gopang-register-guide-overlay';
  ov.style.cssText = [
    'position:fixed;inset:0;z-index:10000',
    'background:rgba(0,0,0,.5)',
    'display:flex;align-items:center;justify-content:center',
    'padding:24px',
  ].join(';');

  ov.innerHTML = `
    <div style="
      background:#fff;border-radius:12px;
      width:100%;max-width:340px;
      padding:28px 24px 24px;
      font-family:'Pretendard',-apple-system,sans-serif;
    ">
      <div style="font-size:15px;font-weight:600;color:#111;margin-bottom:20px;letter-spacing:-.2px">
        사용자 등록
      </div>

      <div style="
        border-left:3px solid #111;
        padding:12px 14px;
        font-size:13.5px;color:#333;line-height:1.8;
        margin-bottom:12px;
      ">
        <code style="font-size:13px;font-weight:600;">010</code>을 제외한 나머지
        <strong>8자</strong>를 대시(<code>-</code>)없이 입력하세요.
      </div>

      <div style="font-size:12px;color:#888;margin-bottom:16px;line-height:1.6">
        귀하의 고유 로그인 + 패스워드입니다.
      </div>

      <!-- 번호 입력 필드 -->
      <div style="display:flex;align-items:center;
                  border:1.5px solid #e5e7eb;border-radius:10px;
                  background:#f9fafb;overflow:hidden;margin-bottom:8px"
           id="_rg-field">
        <span style="padding:0 12px;font-size:13px;color:#555;
                     border-right:1px solid #e5e7eb;height:50px;
                     display:flex;align-items:center;white-space:nowrap">
          🇰🇷 010 -
        </span>
        <input id="_rg-input" type="tel" maxlength="8" inputmode="numeric"
          placeholder="12345678"
          style="flex:1;padding:0 14px;height:50px;border:none;background:transparent;
                 font-size:18px;font-family:inherit;outline:none;color:#111;
                 letter-spacing:3px;min-width:0"/>
      </div>
      <div id="_rg-error" style="display:none;font-size:12px;color:#dc2626;margin-bottom:8px;padding:0 4px"></div>
      <div style="font-size:11px;color:#aaa;margin-bottom:20px;padding:0 4px">
        예) 010-1234-5678 → <code style="font-weight:600;color:#555">12345678</code>
      </div>

      <button id="_rg-ok" style="
        width:100%;padding:14px;
        background:#111;color:#fff;border:none;
        border-radius:8px;font-size:14px;font-weight:600;
        cursor:pointer;font-family:inherit;letter-spacing:-.1px;
      ">시작하기</button>
    </div>
  `;

  document.body.appendChild(ov);

  const inp   = ov.querySelector('#_rg-input');
  const okBtn = ov.querySelector('#_rg-ok');
  const errEl = ov.querySelector('#_rg-error');
  const field = ov.querySelector('#_rg-field');

  inp.focus();
  inp.addEventListener('focus', () => field.style.borderColor = '#111');
  inp.addEventListener('blur',  () => field.style.borderColor = '#e5e7eb');
  inp.addEventListener('input', () => {
    inp.value = inp.value.replace(/\D/g, '').slice(0, 8);
    errEl.style.display = 'none';
  });

  const doSubmit = async () => {
    const val = inp.value.trim();
    if (val.length !== 8) {
      errEl.textContent = '8자리를 모두 입력해 주세요.';
      errEl.style.display = 'block';
      inp.focus();
      return;
    }
    okBtn.disabled = true;
    okBtn.textContent = '확인 중…';
    // 번호를 localStorage에 임시 저장 후 initAuth 호출
    // initAuth는 내부적으로 번호 입력 팝업을 띄우므로
    // 여기서는 직접 _phone-input에 값을 주입하는 방식 사용
    ov.remove();
    await initAuthWithPhone(val);
    const stored = JSON.parse(localStorage.getItem('gopang_user_v4') || 'null');
    if (stored?.handle && typeof _updateHandleChip === 'function') {
      _updateHandleChip(stored.nickname || stored.handle);
    }
    // ── Bug Fix: 등록 완료 후 설정 창 자동 열기 제거 ──
    // (사용자가 직접 설정 버튼을 눌러야 열림)
  };

  okBtn.onclick = doSubmit;
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') doSubmit(); });
}
