// gopang-ui.js — 진행시트·UI헬퍼
function _progressStart(intent, location, reportId) {
  _progressJob = {
    id:          reportId || ('RPT-' + Date.now()),
    steps:       PROGRESS_STEPS_CLN,
    currentStep: 0,
    intent,
    location,
    done:        false,
  };
  _progressSetStep(0);
  _topLogoSetProgress(true);
}

// 특정 단계로 진행
function _progressSetStep(idx) {
  if (!_progressJob) return;
  _progressJob.currentStep = idx;
  _progressJob.done = (idx >= _progressJob.steps.length - 1);
  _renderProgressSteps();
  if (_progressJob.done) {
    setTimeout(() => _topLogoSetProgress(false), 3000);
  }
}

// 다음 단계로 전진
function _progressNext() {
  if (!_progressJob || _progressJob.done) return;
  _progressSetStep(_progressJob.currentStep + 1);
}

// 상단 로고 상태 전환
function _topLogoSetProgress(active) {
  const textEl = document.getElementById('top-logo-text');
  const dotEl  = document.getElementById('top-progress-dot');
  if (!textEl) return;
  if (active) {
    textEl.textContent = '⏳ 진행 상황';
    textEl.style.color = 'rgba(255,255,255,0.95)';
    if (dotEl) dotEl.style.display = 'inline-block';
  } else {
    textEl.textContent = '고팡';
    textEl.style.color = 'rgba(255,255,255,0.90)';
    if (dotEl) dotEl.style.display = 'none';
    _progressJob = null;
  }
}

// 로고 탭 핸들러
function _onLogoTap() {
  if (!_progressJob) return;   // 진행 중 없으면 무반응
  _renderProgressSteps();
  document.getElementById('progress-overlay').classList.add('open');
}

// 시트 닫기 (배경 탭)
function _closeProgressSheet(e) {
  if (e.target.id === 'progress-overlay')
    document.getElementById('progress-overlay').classList.remove('open');
}

// 진행 단계 렌더링
function _renderProgressSteps() {
  if (!_progressJob) return;
  const el = document.getElementById('progress-steps');
  const titleEl = document.getElementById('progress-sheet-title');
  if (!el) return;

  if (titleEl) {
    titleEl.textContent = _progressJob.intent || '진행 상황';
  }

  let html = '';

  // 위치 표시
  if (_progressJob.location) {
    html += `<div style="font-size:12px;color:var(--label-3);
                          margin-bottom:16px;padding:8px 12px;
                          background:var(--bg-subtle);border-radius:10px;">
               📍 ${_progressJob.location}
             </div>`;
  }

  // 단계 목록
  _progressJob.steps.forEach((step, i) => {
    const current = i === _progressJob.currentStep;
    const done    = i < _progressJob.currentStep;
    const pending = i > _progressJob.currentStep;

    const dotColor = done    ? 'var(--green)'
                   : current ? 'var(--yellow)'
                   :            'var(--sep-strong)';
    const labelColor = pending ? 'var(--label-3)' : 'var(--label)';
    const fontWeight = current ? '600' : '400';

    html += `
      <div style="display:flex;align-items:center;gap:14px;
                  padding:12px 4px;position:relative;">
        <!-- 연결선 (마지막 제외) -->
        ${i < _progressJob.steps.length - 1 ? `
          <div style="position:absolute;left:17px;top:36px;
                      width:2px;height:calc(100% - 12px);
                      background:${done ? 'var(--green)' : 'var(--sep-strong)'};
                      border-radius:1px;"></div>` : ''}
        <!-- 상태 원 -->
        <div style="width:34px;height:34px;border-radius:50%;
                    background:${dotColor};flex-shrink:0;
                    display:flex;align-items:center;justify-content:center;
                    font-size:16px;z-index:1;
                    ${current ? 'box-shadow:0 0 0 4px rgba(255,214,10,0.2);' : ''}">
          ${done ? '✓' : step.icon}
        </div>
        <!-- 텍스트 -->
        <div>
          <div style="font-size:15px;font-weight:${fontWeight};
                      color:${labelColor};">${step.label}</div>
          ${current ? `<div style="font-size:12px;color:var(--yellow);
                                    margin-top:2px;">진행 중…</div>` : ''}
          ${done    ? `<div style="font-size:12px;color:var(--green);
                                    margin-top:2px;">완료</div>` : ''}
        </div>
      </div>`;
  });

  // 신고 ID
  html += `<div style="font-size:11px;color:var(--label-3);
                        margin-top:16px;text-align:right;">
             ${_progressJob.id}
           </div>`;

  el.innerHTML = html;
}

// ── SP-00-ROUTER 프리로드 (DOMContentLoaded 이후 백그라운드 fetch) ────
// _routerPrompt 변수 초기화 완료 후 실행 — TDZ 오류 방지
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(async () => {
    try {
      await _loadRouterPrompt();
      console.info('[Router] 프리로드 완료 — 버전:', _routerPromptVer);
    } catch(e) {
      console.warn('[Router] 프리로드 실패 (나중에 재시도):', e.message);
    }
  }, 0);
});

// ── 초기 AI 비서 환영 메시지 ────────────────────────────
function _showWelcomeMessage() {
  const list = document.getElementById('message-list');
  if (!list) return;

  // 발신자 레이블 (AI 비서)
  const label = document.createElement('div');
  label.style.cssText =
    'font-size:11px;color:var(--label-3);margin:8px 16px 2px;' +
    'letter-spacing:0.02em;font-weight:500;';
  label.textContent = '전용 AI 비서';

  // 메시지 버블 행
  const row = document.createElement('div');
  row.className = 'msg-row ai';

  const bubble = document.createElement('div');
  bubble.className = 'bubble bubble-ai';
  bubble.style.whiteSpace = 'nowrap';
  bubble.innerHTML = '지시 대기 중.';

  row.appendChild(bubble);
  list.appendChild(label);
  list.appendChild(row);
}

// ── 입력 필드 ───────────────────────────────────────────
