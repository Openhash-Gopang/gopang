// gopang-pwa.js — PWA 설치·업데이트·배너
// ══════════════════════════════════════════════════════════
// PWA — Service Worker 등록 + 설치 프롬프트
// ══════════════════════════════════════════════════════════

let _deferredInstallPrompt = null;   // beforeinstallprompt 이벤트 보관
const _INSTALL_DISMISSED_KEY = 'gopang_install_dismissed';
const _INSTALL_DONE_KEY      = 'gopang_installed';

// ── Service Worker 등록 + 자동 갱신 ──────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      console.log('[PWA] SW 등록 완료:', reg.scope);

      // 서버 push 즉시 반응 — 배포 시 push로 받는 CHECK_FOR_UPDATE,
      // 알림 클릭 시 받는 PLAY_SOUND를 처리한다.
      // (지금까지 sw.js는 두 메시지를 모두 보내고 있었지만 받는 쪽 리스너가
      //  전혀 없어 둘 다 무반응이었음 — 알림 사운드 미재생 버그의 원인)
      navigator.serviceWorker.addEventListener('message', (event) => {
        const msgType = event.data?.type;
        if (msgType === 'CHECK_FOR_UPDATE') {
          console.log('[PWA] 배포 push 수신 — 즉시 업데이트 체크');
          reg.update().then(() => {
            if (reg.waiting && navigator.serviceWorker.controller) _autoApplyUpdate(reg);
          }).catch(() => {});
        } else if (msgType === 'PLAY_SOUND') {
          const sound = event.data.sound || 'ping';
          if (sound !== 'none') new Audio('/assets/sounds/' + sound + '.mp3').play().catch(() => {});
        }
      });

      // ★ _AUTO_UPDATE_PATCH_APPLIED_
      // ══════════════════════════════════════════════════
      // 이중 자동 업데이트 강제 적용
      //
      // 경로 ①: 새 SW 설치 완료 → 5초 후 자동 skipWaiting + 새로고침
      //          (사용자 입력 불필요, 배너는 카운트다운용으로만 표시)
      // 경로 ②: 30분마다 주기적 update() 체크
      //          (탭을 장시간 열어두는 사용자 대응)
      // ══════════════════════════════════════════════════

      // 자동 적용 타이머 ID (중복 방지)
      let _autoApplyTimer = null;

      function _autoApplyUpdate(reg) {
        if (_autoApplyTimer) return;  // 이미 예약됨

        // ★ 무한 재시작 루프 방지 회로차단기 ★
        // CDN 전파 지연 등으로 sw.js가 edge마다 다르게 응답되면 새로고침
        // 직후에도 또 "새 버전"으로 오인될 수 있다. 최근 20초 내에 이미
        // 자동 재시작했다면 이번엔 건너뛰고 수동 배너만 표시한다.
        // sessionStorage는 reload에도 유지되므로 루프를 끝까지 추적해 막는다.
        const LOOP_KEY = 'gopang_last_auto_reload';
        const lastReload = Number(sessionStorage.getItem(LOOP_KEY) || 0);
        if (Date.now() - lastReload < 20000) {
          console.warn('[PWA] 최근 20초 내 자동 재시작 이력 감지 — 반복 루프 의심, 자동 적용 중단(수동 배너만 표시)');
          _showUpdateBanner(0);
          return;
        }

        console.log('[PWA] 새 버전 감지 — 5초 후 자동 적용');
        _showUpdateBanner(5);         // 카운트다운 배너 표시
        _autoApplyTimer = setTimeout(() => {
          sessionStorage.setItem(LOOP_KEY, String(Date.now()));
          const sw = reg.waiting;
          if (sw) {
            sw.postMessage({ type: 'SKIP_WAITING' });
          } else {
            window.location.reload();
          }
        }, 5000);
      }

      // 경로 ①: 새 SW 설치 완료 → 자동 적용
      reg.addEventListener('updatefound', () => {
        const newSW = reg.installing;
        if (!newSW) return;
        newSW.addEventListener('statechange', () => {
          if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
            _autoApplyUpdate(reg);
          }
        });
      });

      // SW 교체 완료(controllerchange) → 즉시 새로고침
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        console.log('[PWA] 새 버전 적용 — 자동 새로고침');
        window.location.reload();
      });

      // 앱 시작 시 이미 waiting 중인 SW → 즉시 자동 적용
      if (reg.waiting && navigator.serviceWorker.controller) {
        console.log('[PWA] 시작 시 대기 중 버전 감지 → 자동 적용');
        _autoApplyUpdate(reg);
      }

      // 포그라운드 복귀 시 즉시 업데이트 체크
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          reg.update().then(() => {
            console.log('[PWA] 포그라운드 복귀 — SW 업데이트 체크');
            if (reg.waiting && navigator.serviceWorker.controller) {
              _autoApplyUpdate(reg);
            }
          }).catch(() => {});
        }
      });

      // 경로 ②: 30분마다 주기적 업데이트 체크
      setInterval(() => {
        reg.update().then(() => {
          console.log('[PWA] 주기 체크(30분) — SW 업데이트 확인');
          if (reg.waiting && navigator.serviceWorker.controller) {
            _autoApplyUpdate(reg);
          }
        }).catch(() => {});
      }, 30 * 60 * 1000);

    } catch (err) {
      console.warn('[PWA] SW 등록 실패:', err);
    }
  });
}

// ── 앱 갱신 알림 배너 (카운트다운 자동 적용) ───────────────────
function _showUpdateBanner(seconds = 0) {
  if (document.getElementById('update-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'update-banner';
  banner.style.cssText = `
    position: fixed; bottom: 90px; left: 50%; transform: translateX(-50%);
    background: #1C1C1E; border: 1px solid #3A3A3C;
    border-radius: 14px; padding: 12px 20px;
    display: flex; align-items: center; gap: 12px;
    font-size: 14px; color: #F2F2F7;
    box-shadow: 0 8px 32px rgba(0,0,0,.6);
    z-index: 9999; white-space: nowrap;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  `;

  const countdownLabel = seconds > 0
    ? `<span id="update-countdown" style="color:#8E8E93;font-size:12px">${seconds}초 후 자동 적용</span>`
    : '';

  banner.innerHTML = `
    <span>🆕 새 버전이 있습니다</span>
    ${countdownLabel}
    <button onclick="_applyUpdate()" style="
      background:#0057A8; color:#fff; border:none;
      border-radius:8px; padding:6px 14px;
      font-size:13px; font-weight:600; cursor:pointer;">
      지금 적용
    </button>
  `;
  document.body.appendChild(banner);

  // 카운트다운 표시
  if (seconds > 0) {
    let remain = seconds;
    const cd = setInterval(() => {
      remain--;
      const el = document.getElementById('update-countdown');
      if (el) el.textContent = `${remain}초 후 자동 적용`;
      if (remain <= 0) clearInterval(cd);
    }, 1000);
  }
}

// ── 업데이트 적용 (skipWaiting 메시지 전송) ──────────────────
function _applyUpdate() {
  navigator.serviceWorker.ready.then((reg) => {
    if (reg.waiting) {
      // SW에 skipWaiting 지시 → controllerchange → 자동 새로고침
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    } else {
      window.location.reload();
    }
  });
}

// ── Android/Chrome — beforeinstallprompt 이벤트 ─────────
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _deferredInstallPrompt = e;

  // 설치 버튼 상단에 표시
  const installBtn = document.getElementById('btn-install');
  if (installBtn) installBtn.style.display = 'flex';

  // 이미 설치됐거나 사용자가 7일 이내 거절한 경우 표시 안 함
  if (_shouldShowInstallBanner()) {
    // 첫 방문 또는 재방문 시 2초 후 배너 표시
    setTimeout(() => _showInstallBanner('android'), 2000);
  }
});

// ── 앱이 이미 설치된 상태로 실행 시 ────────────────────────
window.addEventListener('appinstalled', () => {
  console.log('[PWA] 앱 설치 완료');
  localStorage.setItem(_INSTALL_DONE_KEY, Date.now());
  _hideInstallBanner();
  // 설치 버튼 숨김
  const btn = document.getElementById('btn-install');
  if (btn) btn.style.display = 'none';
});

// ── iOS Safari 감지 ──────────────────────────────────────
function _isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
function _isInStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches ||
         window.navigator.standalone === true;
}

// ── 배너 표시 여부 판단 ───────────────────────────────────
function _shouldShowInstallBanner() {
  if (localStorage.getItem(_INSTALL_DONE_KEY))    return false;  // 이미 설치
  if (_isInStandaloneMode())                       return false;  // 이미 독립 실행 중
  const dismissed = localStorage.getItem(_INSTALL_DISMISSED_KEY);
  if (dismissed && Date.now() - dismissed < 7 * 24 * 60 * 60 * 1000) return false; // 7일 이내 거절
  return true;
}

// ── 배너 표시 ────────────────────────────────────────────
function _showInstallBanner(type) {
  _installBannerVisible = true;   // 배너 활성 → GPS 요청 대기
  if (type === 'ios') {
    document.getElementById('ios-install-banner')?.classList.add('show');
  } else {
    document.getElementById('install-banner')?.classList.add('show');
  }
}
function _hideInstallBanner() {
  _installBannerVisible = false;  // 배너 해소 → GPS 요청 허용
  document.getElementById('install-banner')?.classList.remove('show');
  document.getElementById('ios-install-banner')?.classList.remove('show');
}

// ── 설치 버튼 클릭 ────────────────────────────────────────
async function installPWA() {
  if (!_deferredInstallPrompt) return;
  _hideInstallBanner();
  _deferredInstallPrompt.prompt();
  const { outcome } = await _deferredInstallPrompt.userChoice;
  console.log('[PWA] 설치 선택:', outcome);
  if (outcome === 'accepted') {
    localStorage.setItem(_INSTALL_DONE_KEY, Date.now());
  }
  _deferredInstallPrompt = null;
  // PWA 처리 완료 → GPS 즉시 요청 (배너 사라진 뒤이므로 충돌 없음)
  if (!_locationReady && !_locationPending) _initLocation();
}

// ── 나중에 버튼 ──────────────────────────────────────────
function dismissInstall() {
  _hideInstallBanner();
  localStorage.setItem(_INSTALL_DISMISSED_KEY, Date.now());
  // 거절 후 → GPS 즉시 요청
  if (!_locationReady && !_locationPending) _initLocation();
}
function dismissIOSInstall() {
  _hideInstallBanner();
  localStorage.setItem(_INSTALL_DISMISSED_KEY, Date.now());
  if (!_locationReady && !_locationPending) _initLocation();
}

// ── 사용자가 직접 설치 요청 (홈 화면 추가 버튼 등) ─────────
function requestInstall() {
  if (_isInStandaloneMode()) {
    appendBubble?.('ai', '✅ 고팡은 이미 홈 화면에 설치되어 있습니다.');
    return;
  }
  if (_deferredInstallPrompt) {
    installPWA();
  } else if (_isIOS()) {
    _showInstallBanner('ios');
  } else {
    appendBubble?.('ai',
      '📱 설치 방법:\n' +
      '• Chrome: 주소창 우측 설치 아이콘(⊕) 탭\n' +
      '• Safari: 공유 버튼 → 홈 화면에 추가\n' +
      '• Samsung Internet: 메뉴 → 홈 화면에 추가');
  }
}

// ── iOS 첫 방문 시 안내 ──────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  if (_isIOS() && !_isInStandaloneMode() && _shouldShowInstallBanner()) {
    setTimeout(() => _showInstallBanner('ios'), 3000);
  }

  // 이미 설치된 상태(독립 실행)면 설치 버튼 숨김
  if (_isInStandaloneMode() || localStorage.getItem(_INSTALL_DONE_KEY)) {
    const btn = document.getElementById('btn-install');
    if (btn) btn.style.display = 'none';
  }

  // URL 파라미터 ?ai=1 — AI 비서 자동 활성화 (manifest shortcuts)
  if (new URLSearchParams(location.search).get('ai') === '1') {
    setTimeout(() => activateAI?.(false), 1000);
  }
});

// ── 상단 설치 버튼 (선택적 노출) ────────────────────────────
// AI 비서가 "홈에 설치해줘" 지시 받을 때도 호출됨
window._requestInstall = requestInstall;
// ══════════════════════════════════════════════════════════
// 고팡 사용자 신원 시스템 v2.0
// IPv6 형식 정체성 + 4단어 시드 + MediaPipe 얼굴 인식
// 다단계 인증 L0(기기) ~ L3(기기+얼굴+지문+4단어)
// private key 저장 없음 — 생체+시드로 매번 재생성
// ══════════════════════════════════════════════════════════

// ── MediaPipe 지연 로드 ──────────────────────────────────
let _mpFaceLandmarker = null;
let _mpLoading        = false;

