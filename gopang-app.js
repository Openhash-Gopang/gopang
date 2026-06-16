/**
 * gopang-app.js — 진입점 v3.0
 * 실제 로직은 전부 src/ 하위 모듈에 있음
 * 이 파일의 역할: import → exposeGlobals → bootstrap
 *
 * webapp.html에서 로드 방식:
 *   <script type="module" src="/gopang-app.js"></script>
 */

// ── Core ─────────────────────────────────────────────────
import { initAuth, _isRegistered, _isGDCUser, _deviceFullReset, _deviceLocalReset, gopangAuth } from './src/gopang/core/auth.js';
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
_updateHandleChip(_USER?.handle || null);

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
  if (_isFirstVisit) {
    _showWelcomePopup();
  }
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
          ['M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5', '데이터 주권', '모든 데이터는 사용자 단말에 저장됩니다. OpenHash 기술로 위변조가 불가능합니다.'],
          ['M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6', 'AI 비서', '상단 AI 버튼이 법률·의료·세금 등 각종 업무를 대신 처리합니다. 사용 여부는 자유입니다.'],
          ['M12 12m-10 0a10 10 0 1 0 20 0a10 10 0 1 0-20 0M4.93 4.93l14.14 14.14', '광고 없음', '의료·법률·교육 등 전문 AI 서비스를 광고 없이 이용할 수 있습니다.'],
          ['M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z', '고팡 스토어', '앱 스토어처럼 누구나 AI 서비스를 등록하고 배포할 수 있습니다.'],
          ['M2 5h20v14H2zM2 10h20', '결제', '기존 결제 수단을 그대로 이용할 수 있습니다. 전용 화폐 GDC(₮)는 각국 인덱스 투자 수익을 이용자에게 배분합니다.'],
          ['M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22', '완전 오픈소스', '모든 코드를 한 줄도 빠짐없이 공개합니다. github.com/Openhash-Gopang'],
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
        <a href="https://gopang.net" target="_blank" style="
          display:block;text-align:center;
          font-size:12px;color:#9ca3af;text-decoration:none;padding:6px;
        ">PC에서 더 알아보기 → gopang.net</a>
      </div>
    </div>
  `;

  document.body.appendChild(ov);

  // 외부 클릭 닫힘
  ov.addEventListener('click', e => {
    const sheet = document.getElementById('_welcome_sheet');
    if (sheet && !sheet.contains(e.target)) _closeWelcome(ov);
  });

  document.getElementById('_welcome_ok').onclick = async () => {
    localStorage.setItem('gopang_welcomed', '1');
    ov.style.opacity = '0';
    ov.style.transition = 'opacity .2s';
    setTimeout(() => ov.remove(), 200);
    await initAuth();
    const stored = JSON.parse(localStorage.getItem('gopang_user_v4') || 'null');
    if (stored?.handle && typeof _updateHandleChip === 'function') {
      _updateHandleChip(stored.handle);
    }
    // 등록 안내 팝업 (한국 사용자 전화번호 안내) → 확인 후 설정 화면으로
    _showRegisterGuide(() => {
      if (typeof openSettings === 'function') openSettings();
    });
  };
}

function _closeWelcome(ov) {
  localStorage.setItem('gopang_welcomed', '1');
  ov.style.opacity = '0';
  ov.style.transition = 'opacity .2s';
  setTimeout(() => ov.remove(), 200);
}

// ── 사용자 등록 안내 팝업 (한국 사용자 전화번호 안내) ───────────
function _showRegisterGuide(onConfirm) {
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

      <div style="font-size:12px;color:#888;margin-bottom:20px;line-height:1.6">
        귀하의 고유 로그인 + 패스워드입니다.
      </div>

      <div style="
        background:#f5f5f5;border-radius:6px;padding:10px 12px;
        font-size:12px;color:#555;margin-bottom:24px;
      ">
        예) 010-1234-5678 &nbsp;→&nbsp; <code style="font-weight:600;color:#111">12345678</code>
      </div>

      <button id="_register_guide_ok" style="
        width:100%;padding:13px;
        background:#111;color:#fff;border:none;
        border-radius:8px;font-size:14px;font-weight:600;
        cursor:pointer;font-family:inherit;letter-spacing:-.1px;
      ">확인</button>
    </div>
  `;

  document.body.appendChild(ov);

  document.getElementById('_register_guide_ok').onclick = () => {
    ov.style.opacity = '0';
    ov.style.transition = 'opacity .2s';
    setTimeout(() => { ov.remove(); if (typeof onConfirm === 'function') onConfirm(); }, 200);
  };
}
