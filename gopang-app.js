/**
 * gopang-app.js — 진입점 v3.0
 * 실제 로직은 전부 src/ 하위 모듈에 있음
 * 이 파일의 역할: import → exposeGlobals → bootstrap
 *
 * webapp.html에서 로드 방식:
 *   <script type="module" src="/gopang-app.js"></script>
 */

// ── Core ─────────────────────────────────────────────────
import { initAuth, initAuthWithPhone, _isRegistered, _isGDCUser, _deviceFullReset, _deviceLocalReset, gopangAuth, _hasConfirmedBackup } from './src/gopang/core/auth.js';
import { loadSettings, CFG, saveSettings }     from './src/gopang/core/config.js';
import { _USER, aiActive, setAiActive, setUser } from './src/gopang/core/state.js';

// ── UI ───────────────────────────────────────────────────
import { appendBubble }                        from './src/gopang/ui/bubble.js';
import { openSettings, closeSettings, handleOverlayClick,
         openAISettings, closeAISettings, handleAISettingsOverlayClick,
         _updateHandleChip, _settingsRegisterHandle,
         clearSWCache, _updateSecuritySection,
         openChatHistory, openHashChain, openGopangWallet, openFinancialStatement,
         openMyProfile, openBackupKey, _refreshFreeModelPool,
         applySkinColor,
} from './src/gopang/ui/settings.js';
import { openSearch, closeSearch,
         handleSearchOverlayClick,
         runSearch, selectContact,
         openProfile }                          from './src/gopang/ui/search.js';
import { _showRegisterFlow }                   from './src/gopang/ui/register-flow.js';

// ── AI ───────────────────────────────────────────────────
import { toggleAI, activateAI, closeAI, initAIToggleState } from './src/gopang/ai/toggle.js';

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
// 1. 사용자 초기화 — v6.0: Guest 모드 완전 폐지
//
// 이전 버전: 이미 등록된 사용자일 때만 initAuth()를 호출했다(그래서 "등록
// 안 된 사용자는 initAuth를 건너뛰고 그대로 채팅 화면으로 들어가는" 게스트
// 모드가 사실상 기본 동작이었다). 이제는 정반대다 — 등록이 안 되어 있으면
// "무조건" initAuth()로 가입/로그인 팝업을 띄우고, 그 Promise가 resolve될
// 때까지(=가입 또는 로그인 완료) 이 아래 어떤 코드도 #app을 공개하지 않는다.
//
// #app은 CSS에서 기본적으로 visibility:hidden이며(webapp.html 참조),
// body에 gopang-authed 클래스가 붙어야만 보인다 — 즉 "혼디 대화창을 그렸지만
// 팝업으로 가려놨다"가 아니라 "애초에 그려서 보여주지 않는다". initAuth()의
// 전화번호 입력 팝업에는 닫기(X) 버튼이나 바깥 클릭 닫기가 없으므로(의도적),
// 가입/로그인을 완료하지 않고는 이 await를 빠져나갈 방법이 없다.
// ════════════════════════════════════════════════════════
const _hasRegisteredUser = (() => {
  try {
    const s = JSON.parse(localStorage.getItem('gopang_user_v4') || 'null');
    return !!(s?.handle && s?.ipv6);
  } catch { return false; }
})();
void _hasRegisteredUser; // 참고용 — 실제 분기는 initAuth() 내부에서 처리(이미 등록 시 즉시 resolve)
// initAuth()는 가입/로그인 취소, PC 차단, 기기 불일치 후 "닫기" 등의 경로에서
// null로 resolve될 수 있다 — 그 경우에도 #app을 공개하면 게스트 모드가 되살아나므로,
// _isRegistered()로 실제 등록 여부를 직접 재확인하고 아니면 다시 initAuth()를 띄운다.
while (!_isRegistered()) {
  await initAuth();
}
// 이 줄에 도달했다는 것은 곧 _isRegistered() === true라는 뜻 — 이제 대화창을 공개한다.
document.getElementById('gopang-auth-gate')?.remove();
document.body.classList.add('gopang-authed');

// ★ 버그 수정 — 이미 등록된 사용자(흔한 "재방문" 케이스)는 위 while 루프의
// 조건이 시작부터 참이라 루프 본문(await initAuth())이 단 한 번도 실행되지
// 않는다. setUser()는 initAuth() 내부에서만 호출되므로, 이 경로를 탄
// 사용자는 _isRegistered()(localStorage 기준)는 true이면서도 state.js의
// 메모리 상 _USER는 세션 내내 null로 남는다. p2p-search.js의 연결 요청,
// p2p-chat.js의 시그널링 등 여러 곳이 _isRegistered()가 아니라 메모리 상의
// _USER.ipv6를 직접 참조하므로, 이 상태에서는 분명히 로그인된 사용자인데도
// "로그인이 필요합니다" 오류가 뜨거나 P2P 연결 자체가 조용히 실패한다.
// → while 루프를 빠져나온 시점(_isRegistered()===true가 보장됨)에 _USER가
// 아직 비어있다면, 저장된 사용자 정보로 명시적으로 한 번 동기화한다.
// ※ stored?.ipv6를 추가로 요구하지 않는다 — _isRegistered()는 handle만
// 확인하므로, 여기서 ipv6까지 요구하면 "handle은 있는데 ipv6가 빠진" 데이터에서
// 똑같은 버그가 재발한다. 이미 위에서 _isRegistered()===true가 보장됐으므로
// stored가 존재한다는 사실 자체를 신뢰한다.
if (!_USER) {
  try {
    const stored = JSON.parse(localStorage.getItem('gopang_user_v4') || sessionStorage.getItem('gopang_user_v4') || 'null');
    if (stored) setUser(stored);
  } catch (e) {
    console.warn('[Boot] 이미 등록된 사용자의 _USER 동기화 실패:', e.message);
  }
}

// v6.0: 백업 키를 아직 확인하지 않은 사용자에게 탭마다 경고 — 가입 직후 단계를
// 거쳤다면 정상적으로는 뜨지 않지만, 이 업데이트 이전에 가입한 기존 사용자나
// (지갑 준비 지연 등으로) 그 단계를 못 거친 경우를 위한 안전망이다. "나중에"는
// 이 탭 안에서만 숨기고, 새 탭/새로고침에서는 다시 뜬다(sessionStorage).
(function _maybeShowBackupWarn() {
  if (!_isRegistered() || _hasConfirmedBackup()) return;
  if (sessionStorage.getItem('gopang_backup_warn_dismissed')) return;
  const banner = document.getElementById('backup-warn-banner');
  if (!banner) return;
  const installShowing = document.getElementById('install-banner')?.classList.contains('show')
    || document.getElementById('ios-install-banner')?.classList.contains('show');
  if (installShowing) banner.classList.add('below-install');
  banner.classList.add('show');
})();
window.dismissBackupWarn = function() {
  sessionStorage.setItem('gopang_backup_warn_dismissed', '1');
  document.getElementById('backup-warn-banner')?.classList.remove('show');
};

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
  window.openBackupKey             = openBackupKey;
  window.openFinancialStatement    = openFinancialStatement;
  window.openMyProfile             = openMyProfile;
  window.openAISettings            = openAISettings;
  window._deviceFullReset          = _deviceFullReset;
  window._deviceLocalReset         = _deviceLocalReset;
  window._isGDCUser                = _isGDCUser;
  window.closeAISettings           = closeAISettings;
  window._refreshFreeModelPool     = _refreshFreeModelPool;
  window.handleAISettingsOverlayClick = handleAISettingsOverlayClick;
  window.closeSettings             = closeSettings;
  window.handleOverlayClick        = handleOverlayClick;
  window.saveSettings              = saveSettings;
  window.clearSWCache              = clearSWCache;
  window._settingsRegisterHandle   = _settingsRegisterHandle;
  window._updateHandleChip         = _updateHandleChip;
  window.applySkinColor            = applySkinColor;
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
    { callAI, stopGeneration },
    { runRouter, applyRouterResult },
  ] = await Promise.all([
    import('./src/gopang/ui/send-message.js'),
    import('./src/gopang/ui/file-attach.js'),
    import('./src/gopang/ai/mic.js'),
    import('./src/gopang/services/location.js').then(m => {
      // gopang-pwa.js(일반 스크립트)가 CustomEvent로 GPS 초기화 요청을 보냄
      window.addEventListener('gopang:pwa-install-done', () => {
        if (!m._locationReady && !m._locationPending) m._initLocation();
      });
      return m;
    }),
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
  if (sendBtn) sendBtn.addEventListener('click', () => {
    if (sendBtn.classList.contains('generating')) stopGeneration();
    else sendMessage();
  });
  if (camBtn)  camBtn.addEventListener('click',  () => triggerCamera());
  if (micBtn)  micBtn.addEventListener('click',  () => toggleMic());
  if (fileInp) fileInp.addEventListener('change', (e) => handleFileSelect(e));
  if (camInp)  camInp.addEventListener('change',  (e) => handleFileSelect(e));

  // 4-7. 초기화
  loadSettings();         // CFG 최신화 (initAIToggleState 판단 기준)
  initAIToggleState();    // 마지막 AI 켬/끔 상태 복원 (또는 설정 직후 첫 부팅 시 자동 켬)
  setAiActive(aiActive);  // 강제 재동기화 — 위 단계에서 상태가 안 바뀌었어도 버튼 화면은 항상 맞춘다
  _showWelcomeMessage();
  _scheduleLocation();

  // 4-8. 등록 사용자 → 시그널 폴링 자동 시작
  if (_isRegistered()) {
    // _startSignalPoll() 비활성화 — webrtc.js의 레거시 _handleOffer/_handleSignal이
    // p2p-chat.js의 객체 payload({sdp, from_handle})를 JSON.parse()하다가 크래시함.
    // offer/answer는 영구 jam(삭제 안 됨), ice는 파싱 실패한 채로 삭제되어 증발.
    // 모든 시그널 처리는 startIncomingWatch (p2p-chat.js) 단일 경로로 통일.
    // _startSignalPoll();
    console.info('[Signal] 레거시 폴링 비활성화 — p2p-chat.js Realtime/폴링 단일화');

    // GDUDA Phase 1 — incoming offer 감시
    if (_USER?.ipv6) startIncomingWatch(_USER.ipv6);

    // PC→휴대폰 LLM Key 자동 동기화 — AI 설정 화면을 열지 않아도
    // 앱 시작 시점에 X25519 키를 보장하고, PC가 보낸 대기 설정이 있으면
    // 즉시 적용한다. (전송 채널 자체가 X25519 ECDH로 본인 인증되어 있으므로
    // 추가 확인 버튼 없이 자동 적용해도 안전함)
    import('./src/gopang/ui/settings.js').then(({ _autoApplyPcSyncedSetting }) => {
      if (typeof _autoApplyPcSyncedSetting !== 'function') return;

      const _runSync = () => _autoApplyPcSyncedSetting().catch(e =>
        console.warn('[AI설정] 자동 동기화 실패 (무시):', e.message));

      _runSync(); // 앱 시작 시 1회 즉시 확인

      // 메인 경로: PC가 키를 전송하면 서버가 즉시 푸시를 보내고, Service Worker가
      // 열려있는 탭에 SYNC_AI_SETTING을 postMessage로 전달한다 — 화면 무관 즉시 반응.
      if (navigator.serviceWorker) {
        navigator.serviceWorker.addEventListener('message', (event) => {
          if (event.data?.type === 'SYNC_AI_SETTING') {
            console.info('[AI설정] 푸시 신호 수신 — 즉시 동기화');
            _runSync();
          }
        });
      }

      // 폴백: 알림 권한 거부, 푸시 구독 미완료 등으로 push가 동작하지 않는
      // 경우를 위해 60초 간격으로도 한 번씩 확인한다.
      setInterval(_runSync, 60000);
    }).catch(e => console.warn('[AI설정] settings.js 로드 실패 (무시):', e.message));
  }

  // 4-9. 세션 저장 훅
  const { _saveOnce } = await import('./src/gopang/core/session.js');
  window.addEventListener('pagehide', _saveOnce);
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') _saveOnce();
  });

  // 4-9b. 다른 탭(ai-setup-mobile.html)의 로컬 저장 감지 ──────────
  // 모바일 AI 설정 페이지는 서버를 거치지 않고 localStorage(gopang_cfg)에
  // 직접 쓴다. 그 탭은 닫히고 이 탭(webapp.html)은 계속 떠 있는 경우,
  // storage 이벤트로 변경을 즉시 감지해 새로고침 없이 CFG를 재적용한다.
  // (PC→폰 푸시 동기화용 _runSync와는 별개 경로 — 그쪽은 서버의 seal 큐를
  //  조회하므로 이 로컬 저장 방식의 변경은 감지하지 못한다.)
  //
  // ※ 같은 점검 로직을 visibilitychange(탭 복귀) 시점에도 한 번 더 돌린다.
  //   안드로이드에서 백그라운드 탭이 동결(frozen)되어 storage 이벤트를
  //   놓치는 경우, 탭으로 돌아왔을 때 CFG는 이미 갱신돼 있는데 AI 버튼만
  //   꺼진 채로 남는 "실제로는 켜졌는데 꺼진 것처럼 보이는" 불일치를 막는다.
  const _checkAutoActivateAI = () => {
    loadSettings();
    const hasKey = !!(CFG.apiKey || CFG.geminiKey ||
      (Array.isArray(CFG.providers) && CFG.providers.length));
    if (hasKey && !aiActive) {
      activateAI(true);
      appendBubble('ai', '⚙️ AI 비서 설정이 저장되어 자동으로 활성화되었습니다.');
    }
  };
  window.addEventListener('storage', (e) => {
    if (e.key === 'gopang_cfg' && e.newValue) {
      _checkAutoActivateAI();
    }
    // ai-setup-mobile.html 탭이 저장 완료 후 닫히면서 보내는 신호
    if (e.key === 'gopang_ai_activated' && e.newValue) {
      localStorage.removeItem('gopang_ai_activated');
      _checkAutoActivateAI();
      appendBubble('ai', 'AI 비서가 활성화되었습니다. 지금 바로 대화를 시작해 보세요.');
    }
  });

  // ── 화면이 다시 보일 때마다 AI 버튼 강제 재동기화 ──────────
  // setAiActive()가 호출될 때마다 버튼도 같이 갱신되지만, 상태값 자체는
  // 안 바뀌고(예: 이미 true) 화면만 어떤 이유로든 어긋난 경우는 setAiActive가
  // 다시 호출되지 않는다. 그래서 화면이 다시 보일 수 있는 모든 시점에
  // setAiActive(aiActive)를 그대로 다시 호출해 강제로 한 번 더 맞춘다.
  const _resyncAIButton = () => setAiActive(aiActive);
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      _checkAutoActivateAI();
      _resyncAIButton();
    }
  });
  window.addEventListener('pageshow', _resyncAIButton); // 뒤로가기 등 BFCache 복원 시

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
  // 이 탭이 살아있는 동안(세션) 한 번만 표시 — 채팅 화면으로 돌아올 때마다
  // 다시 뜨지 않게 한다. sessionStorage는 탭을 닫으면 사라지므로,
  // 탭을 닫았다가 다시 열면(=새 세션) 자연스럽게 다시 표시된다.
  if (sessionStorage.getItem('gopang_welcome_shown_session')) return;
  sessionStorage.setItem('gopang_welcome_shown_session', '1');

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

      <!-- 헤더 (터치 후 아래로 스와이프하면 패널이 닫힘) -->
      <div id="_welcome_title" style="padding:20px 24px 16px;display:flex;align-items:center;gap:14px;border-bottom:1px solid #f3f4f6">
        <div style="width:44px;height:44px;flex-shrink:0;background:#16a34a;border-radius:10px;display:flex;align-items:center;justify-content:center">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
        </div>
        <div>
          <div style="font-size:16px;font-weight:600;color:#111827;line-height:1.3">
            ${name ? name + '님, ' : ''}혼디에 오신 것을<br>환영합니다
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

  // ── 제목을 터치해 위→아래로 스와이프하면 패널이 아래로 slide-in(닫힘) ──
  // 기존 settings-overlay의 핸들 스와이프-닫기와 같은 패턴: 손가락을
  // 따라 sheet를 끌어내리고, 일정 거리 이상이면 닫는다.
  (() => {
    const handle = document.getElementById('_welcome_title');
    const sheet  = document.getElementById('_welcome_sheet');
    if (!handle || !sheet) return;

    let startY = 0, dragging = false;

    const start = (e) => {
      startY = e.touches[0].clientY;
      dragging = true;
      sheet.style.transition = 'none';
    };
    const move = (e) => {
      if (!dragging) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0) return; // 위로 끌면 무시 — 아래 방향만 처리
      e.preventDefault();
      sheet.style.transform = `translateY(${dy}px)`;
    };
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      const dy = e.changedTouches[0].clientY - startY;
      sheet.style.transition = 'transform .25s ease';
      if (dy > 100) {
        sheet.style.transform = 'translateY(100%)';
        setTimeout(() => _closeWelcome(ov), 180);
      } else {
        sheet.style.transform = ''; // 임계값 미달 — 원래 위치로 스냅백
      }
    };

    handle.addEventListener('touchstart', start, { passive: true });
    handle.addEventListener('touchmove',  move,  { passive: false });
    handle.addEventListener('touchend',   end,   { passive: true });
  })();

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
    if (!_isAlreadyRegistered()) {
      // 안내문구 + 번호 입력 통합 팝업
      _showRegisterGuide();
    }
  };
}

// ── 등록 여부 확인 (Guest 모드 폐기 — 환영 팝업의 모든 닫기 경로에서 공통 사용) ──
function _isAlreadyRegistered() {
  try {
    const s = JSON.parse(localStorage.getItem('gopang_user_v4') || 'null');
    return !!(s?.handle && s?.ipv6);  // ipv6가 실제 저장 키
  } catch { return false; }
}

function _closeWelcome(ov) {
  localStorage.setItem('gopang_welcomed', '1');
  ov.style.opacity = '0';
  ov.style.transition = 'opacity .2s';
  setTimeout(() => ov.remove(), 200);
  // Guest 모드는 폐기됨 — 배경 클릭으로 닫아도 미등록 사용자는 반드시 가입 안내로 이동
  if (!_isAlreadyRegistered()) {
    _showRegisterGuide();
  }
}

// ── 오디오 자동재생 잠금 해제 (인스턴스 재사용) ──────────────────
// 모바일 브라우저의 자동재생 허용 여부는 "이 페이지가 사용자 동작으로
// 미디어를 재생한 적이 있는가"뿐 아니라, 실무적으로는 동일 Audio
// 인스턴스를 계속 재사용하는 편이 가장 안정적으로 동작한다. 매번
// new Audio()로 새 인스턴스를 만들면 잠금 해제 효과가 새 인스턴스에는
// 적용되지 않아 여전히 차단되는 사례가 있었다 — 그래서 사운드별로 하나의
// Audio 인스턴스만 만들어 두고 이후 전부 그 인스턴스를 재사용한다.
// window에 노출해 p2p-chat.js 등 다른 모듈에서도 같은 인스턴스를 쓴다.
window.__gopangSoundPool = {};
for (const _name of ['ping', 'chime', 'bell', 'drop']) {
  window.__gopangSoundPool[_name] = new Audio(`/assets/sounds/${_name}.mp3`);
}

let _audioUnlocked = false;
function _unlockAudioOnce() {
  if (_audioUnlocked) return;
  _audioUnlocked = true;
  for (const a of Object.values(window.__gopangSoundPool)) {
    const prevVolume = a.volume;
    a.volume = 0.01;
    a.play().then(() => {
      a.pause();
      a.currentTime = 0;
      a.volume = prevVolume;
    }).catch(() => {});
  }
  console.info('[Audio] 첫 사용자 동작 — 자동재생 잠금 해제 시도 완료');
}
document.addEventListener('pointerdown', _unlockAudioOnce, { once: true, capture: true });

// 풀에 있는 같은 인스턴스를 재사용해 재생한다(없으면 새로 생성해 폴백).
function _playPooledSound(name) {
  const a = window.__gopangSoundPool?.[name];
  if (a) {
    a.currentTime = 0;
    a.volume = 1.0;
    return a.play();
  }
  return new Audio(`/assets/sounds/${name}.mp3`).play();
}

function _forcePlayTestSound(tag) {
  console.info(`[TEST-SOUND] ${tag} 트리거됨 — 강제 재생 시도`);
  try { if (navigator.vibrate) navigator.vibrate([300, 100, 300]); }
  catch (e) { console.warn('[TEST-SOUND] vibrate 실패:', e.message); }
  _playPooledSound('ping')
    .then(() => console.info(`[TEST-SOUND] ${tag} 재생 성공`))
    .catch(e => console.warn(`[TEST-SOUND] ${tag} 재생 실패:`, e.name, e.message));
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'PLAY_SOUND') _forcePlayTestSound('postMessage(PLAY_SOUND)');
  });
}

// 알림 클릭으로 새 창이 열린 경우 — URL 쿼리 파라미터(?playSound=...) 존재
// 여부만 보고 무조건 강제 재생 (sound 값/none 체크 등 조건 전부 제거)
(() => {
  const params = new URLSearchParams(location.search);
  if (!params.has('playSound')) return;
  _forcePlayTestSound('URL ?playSound=');
  params.delete('playSound');
  const qs = params.toString();
  history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
})();

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
