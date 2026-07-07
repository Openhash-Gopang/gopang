/**
 * gopang-app.js — 진입점 v3.0
 * 실제 로직은 전부 src/ 하위 모듈에 있음
 * 이 파일의 역할: import → exposeGlobals → bootstrap
 *
 * webapp.html에서 로드 방식:
 *   <script type="module" src="/gopang-app.js"></script>
 */

// ── Core ─────────────────────────────────────────────────
import { initAuth, initAuthWithPhone, _isRegistered, _isGDCUser, _deviceFullReset, _deviceLocalReset, _deleteMyProfile, gopangAuth, _hasConfirmedBackup } from './src/gopang/core/auth.js';
import { loadSettings, CFG, saveSettings, loadDefaultKeyIfNeeded } from './src/gopang/core/config.js';
import { _USER, aiActive, setAiActive, setUser } from './src/gopang/core/state.js';

// ── UI ───────────────────────────────────────────────────
import { appendBubble }                        from './src/gopang/ui/bubble.js';
import { openSettings, closeSettings, handleOverlayClick,
         openAISettings, closeAISettings, handleAISettingsOverlayClick,
         _updateHandleChip, _settingsRegisterHandle,
         clearSWCache, _updateSecuritySection,
         openChatHistory, openHashChain, openGopangWallet, openFinancialStatement,
         openMyProfile, openProfileComposer, openBackupKey,
         applySkinColor,
         openHondiCodeModal, closeHondiCodeModal, _downloadHondiCode,
} from './src/gopang/ui/settings.js';
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
import { startIncomingWatch, checkPendingInvites } from './src/gopang/ui/p2p-chat.js';

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

// ── 신규 가입 직후 처리 ────────────────────────────────────────────
// v3.3(2026-07-01): LLM 선택 창(ai-setup-mobile.html)으로 강제 이동시키던
// 로직을 완전히 제거했다. 이제 혼디는 가입 즉시 DeepSeek V4 Flash를
// 무료 한도(1,000원) 내에서 기본 제공한다(call-ai.js _buildCallCandidates()의
// 'deepseek-default' 안전망) — 사용자가 LLM을 고르거나 키를 입력할 필요가
// 전혀 없다. 플래그만 정리하고 그대로 대화창을 보여준다.
if (localStorage.getItem('hondi_new_registration') === '1') {
  localStorage.removeItem('hondi_new_registration');
}

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

// v6.0: 백업 키를 아직 확인하지 않은 사용자에게 경고 — 가입 직후 단계를
// 거쳤다면 정상적으로는 뜨지 않지만, 이 업데이트 이전에 가입한 기존 사용자나
// (지갑 준비 지연 등으로) 그 단계를 못 거친 경우를 위한 안전망이다.
// v6.1: 이 기기에서 한 번이라도 노출됐으면 이후 영구적으로 다시 표시하지
// 않는다(localStorage). "나중에"를 누르지 않고 그냥 다른 화면으로 이동해도
// 동일하게 적용된다 — 표시되는 순간 바로 "본 것"으로 기록한다.
const BACKUP_WARN_SEEN_KEY = 'gopang_backup_warn_seen_v1';
(function _maybeShowBackupWarn() {
  if (!_isRegistered() || _hasConfirmedBackup()) return;
  if (localStorage.getItem(BACKUP_WARN_SEEN_KEY)) return;
  const banner = document.getElementById('backup-warn-banner');
  if (!banner) return;
  const installShowing = document.getElementById('install-banner')?.classList.contains('show')
    || document.getElementById('ios-install-banner')?.classList.contains('show');
  if (installShowing) banner.classList.add('below-install');
  banner.classList.add('show');
  try { localStorage.setItem(BACKUP_WARN_SEEN_KEY, '1'); } catch (e) {}
})();
window.dismissBackupWarn = function() {
  try { localStorage.setItem(BACKUP_WARN_SEEN_KEY, '1'); } catch (e) {}
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
  window.openProfileComposer       = openProfileComposer;
  window.openAISettings            = openAISettings;
  window._deviceFullReset          = _deviceFullReset;
  window._deviceLocalReset         = _deviceLocalReset;
  window._deleteMyProfile          = _deleteMyProfile;
  window._isGDCUser                = _isGDCUser;
  window.closeAISettings           = closeAISettings;
  window.handleAISettingsOverlayClick = handleAISettingsOverlayClick;
  window.closeSettings             = closeSettings;
  window.openHondiCodeModal        = openHondiCodeModal;
  window.closeHondiCodeModal       = closeHondiCodeModal;
  window._downloadHondiCode        = _downloadHondiCode;
  window.handleOverlayClick        = handleOverlayClick;
  window.saveSettings              = saveSettings;
  window.clearSWCache              = clearSWCache;
  window._settingsRegisterHandle   = _settingsRegisterHandle;
  window._updateHandleChip         = _updateHandleChip;
  window.applySkinColor            = applySkinColor;
  window._settingsRegisterFingerprint = window._settingsRegisterFingerprint || (() => {});
  window._settingsRegisterFace        = window._settingsRegisterFace        || (() => {});

  // 검색 — btn-search는 p2p-search.js의 openSearch(별칭 openP2PSearch)를 쓴다.
  // (2026-07-01 정리: search.js의 openSearch/closeSearch/runSearch/
  //  handleSearchOverlayClick/selectContact/openProfile은 #search-overlay를
  //  대상으로 하나, 그 오버레이를 여는 호출 지점이 코드베이스 어디에도 없어
  //  전부 도달 불가능한 죽은 코드였다 — search.js 파일 자체와 함께 제거.)

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

// 사용자 키가 없으면 체험 기간 디폴트 키를 Worker에서 fetch
loadDefaultKeyIfNeeded().catch(() => {});

// ════════════════════════════════════════════════════════
// 4. DOMContentLoaded — 나머지 모듈 동적 로드
// ════════════════════════════════════════════════════════
// 체험 기간 만료 이벤트 → 안내 배너 표시
window.addEventListener('hondi:trial_expired', (e) => {
  const msg = e.detail?.message || 'AI 비서 무료 체험 기간이 종료됐습니다.';
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);' +
    'background:#1e293b;color:#fff;padding:12px 20px;border-radius:12px;font-size:13px;' +
    'z-index:9999;max-width:90vw;text-align:center;line-height:1.5;' +
    'box-shadow:0 4px 20px rgba(0,0,0,.3)';
  banner.innerHTML = msg;
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 10000);
});

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
    { _gwpLaunch, _gwpClose },
    { _handleGwpSignRequest },
    { _klawReview },
    { callAI, stopGeneration },
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
  ]);

  // 4-4. 동적 로드 함수 전역 노출
  Object.assign(window, {
    sendMessage, handleKey, updateSendBtn, autoResize,
    triggerAttach, removeAttach, handleFileSelect, triggerCamera,
    toggleMic,
    _onLogoTap, _closeProgressSheet,
    _gwpLaunch, _gwpClose,
    callAI,
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

    // 무응답으로 남겨진 P2P 초대 확인 (2026-07-02 신설)
    if (_USER?.ipv6) checkPendingInvites(_USER.ipv6);

    // PC→휴대폰 LLM Key 자동 동기화 — AI 설정 화면을 열지 않아도
    // 앱 시작 시점에 X25519 키를 보장하고, PC가 보낸 대기 설정이 있으면
    // 즉시 적용한다. (전송 채널 자체가 X25519 ECDH로 본인 인증되어 있으므로
    // 추가 확인 버튼 없이 자동 적용해도 안전함)
    import('./src/gopang/ui/settings.js').then(({ _autoApplyPcSyncedSetting }) => {
      if (typeof _autoApplyPcSyncedSetting !== 'function') return;

      // 무한 호출 방지 — 연속 실패 시 재시도 간격을 지수적으로 늘린다(최대 30분).
      // 기존엔 setInterval(60초) 고정이라, L1 wallet/x25519가 526(서버 인증서
      // 오류) 같은 지속적 장애일 때도 영원히 60초마다 같은 실패를 반복했다.
      // (2026-06-27 — 사용량 폭증 원인 분석 중 발견)
      const _SYNC_BASE_MS = 60_000;       // 기본 재시도 간격
      const _SYNC_MAX_MS  = 30 * 60_000;  // 백오프 상한 30분
      let _syncFailCount  = 0;
      let _syncTimerId    = null;

      const _runSync = async () => {
        try {
          const ok = await _autoApplyPcSyncedSetting();
          _syncFailCount = ok ? 0 : _syncFailCount + 1;
          return ok;
        } catch (e) {
          console.warn('[AI설정] 자동 동기화 실패 (무시):', e.message);
          _syncFailCount++;
          return false;
        }
      };

      function _scheduleNextPoll() {
        if (_syncTimerId) clearTimeout(_syncTimerId);
        const delay = Math.min(_SYNC_BASE_MS * (2 ** _syncFailCount), _SYNC_MAX_MS);
        _syncTimerId = setTimeout(async () => {
          await _runSync();
          _scheduleNextPoll(); // 성공/실패 결과에 따라 다음 간격을 다시 계산해 스스로 재예약
        }, delay);
      }

      _runSync().then(_scheduleNextPoll); // 앱 시작 시 1회 즉시 확인 후 폴백 폴링 루프 시작

      // 메인 경로: PC가 키를 전송하면 서버가 즉시 푸시를 보내고, Service Worker가
      // 열려있는 탭에 SYNC_AI_SETTING을 postMessage로 전달한다 — 화면 무관 즉시 반응.
      if (navigator.serviceWorker) {
        navigator.serviceWorker.addEventListener('message', (event) => {
          if (event.data?.type === 'SYNC_AI_SETTING') {
            console.info('[AI설정] 푸시 신호 수신 — 즉시 동기화');
            _runSync(); // 백오프 타이머는 그대로 두고 즉시 1회만 추가 확인(성공 시 실패 카운트도 초기화됨)
          }
        });
      }
      // 폴백 폴링 주기는 위 _scheduleNextPoll()이 기본 60초 → 연속 실패 시
      // 최대 30분까지 늘려가며 스스로 재예약한다 (고정 setInterval 제거).
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
      // 안내 문구는 삭제됨 (2026-06-24, 사용자 요청: 중복 표시 문제로 완전 제거)
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

  // BUG-FIX(2026-07-01): 사용자 요청으로 환영 인사 패널(_showWelcomePopup)
  // 자체를 삭제한다. 다만 그 안에서 미등록 사용자를 번호 입력 화면으로
  // 보내던 역할까지 함께 사라지면 신규 가입 진입로가 없어지므로, 그 부분만
  // 그대로 남긴다.
  if (!_isAlreadyRegistered()) {
    _showRegisterGuide();
  }
};
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', _boot);
} else {
  _boot();
}

// ── 등록 여부 확인 (Guest 모드 폐기 — 부트 시 미등록 사용자 판별용) ──
function _isAlreadyRegistered() {
  try {
    const s = JSON.parse(localStorage.getItem('gopang_user_v4') || 'null');
    return !!(s?.handle && s?.ipv6);  // ipv6가 실제 저장 키
  } catch { return false; }
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
  // BUG-FIX: 이 팝업이 직접 "010 제외 8자리"만 입력받아 initAuthWithPhone을
  // 호출하던 방식은, 실제 가입 화면(_showPhonePopup)이 이미 하는 일(국가 선택,
  // 휴대폰/지역번호 선택, 닉네임, 약관 동의, 색상·숫자 코드 생성)을 못 하는
  // 축소판이었다 — 특히 유선 지역번호(7자리)는 여기서 아예 입력이 안 됐다.
  // 안내만 보여주고, 실제 입력은 검증된 가입 팝업 하나로 통일한다.
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
        margin-bottom:20px;
      ">
        휴대폰 번호 또는 유선 지역번호로 등록할 수 있습니다.<br>
        번호는 귀하의 고유 로그인 + 패스워드입니다.
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

  const okBtn = ov.querySelector('#_rg-ok');

  const doSubmit = async () => {
    okBtn.disabled = true;
    okBtn.textContent = '확인 중…';
    ov.remove();
    await initAuth();
    const stored = JSON.parse(localStorage.getItem('gopang_user_v4') || 'null');
    if (stored?.handle && typeof _updateHandleChip === 'function') {
      _updateHandleChip(stored.nickname || stored.handle);
    }
    // ── Bug Fix: 등록 완료 후 설정 창 자동 열기 제거 ──
    // (사용자가 직접 설정 버튼을 눌러야 열림)
  };

  okBtn.onclick = doSubmit;
}

