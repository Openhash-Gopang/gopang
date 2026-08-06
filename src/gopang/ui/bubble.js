/**
 * ui/bubble.js — 메시지 버블 렌더링
 */

// [2026-08-06 신설 — 메인 채팅/패널 통합 1단계] 이 모듈의 모든 함수가
// 'message-list'를 하드코딩하고 있었다 — call-ai.js가 오케스트레이션
// 결과를 항상 화면에 안 보이는 #message-list(2026-07-07부터 display:none)
// 에만 쓰고, 실제로 사용자가 보는 #ai-panel-messages(패널)에는 절대
// 못 쓰는 구조적 원인이었다. 이걸 15개 소비자 모두의 하위호환을 깨지
// 않으면서 고치기 위해, 모듈 전역 "현재 타겟 컨테이너" 상태를 둔다:
//   - 아무도 setBubbleTarget을 안 부르면 → 기본값 'message-list' 그대로
//     (기존 15개 파일 전부 동작 무변화).
//   - call-ai.js의 최상위 진입점(callAI)만 명시적으로 이 값을 바꿀 수
//     있고, 재귀 호출(sendFn 체인)은 아무것도 안 넘기면 이 상태를 그대로
//     "상속"한다 — 매 호출마다 컨테이너 인자를 47곳 넘게 스레딩할
//     필요가 없다. 자세한 설계 근거는 call-ai.js의 callAI 주석 참고.
let _activeContainerId = 'message-list';

export function setBubbleTarget(containerId) {
  _activeContainerId = containerId || 'message-list';
}

export function getBubbleTarget() {
  return _activeContainerId;
}

/**
 * 채팅창에 버블 추가
 * @param {'ai'|'user'|'peer'|'system'} role
 * @param {string} text
 * @param {boolean} isHTML
 * @param {string|null} senderName  peer 메시지의 발신자 이름
 */
export function appendBubble(role, text, isHTML = false, senderName = null) {
  const list = document.getElementById(_activeContainerId);
  if (!list) return;

  const row  = document.createElement('div');
  row.className = `msg-row ${role}`;

  // peer 메시지 발신자 이름
  if (senderName && role === 'peer') {
    const nameEl = document.createElement('div');
    nameEl.style.cssText = 'font-size:11px;font-weight:600;color:var(--txt3);margin-bottom:2px;padding-left:2px';
    nameEl.textContent = senderName;
    row.appendChild(nameEl);
  }

  const bubble = document.createElement('div');
  bubble.className = `bubble bubble-${role}`;
  if (isHTML) bubble.innerHTML = text;
  else        bubble.textContent = text;

  row.appendChild(bubble);
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;
  return bubble;
}

// ── 타이핑 인디케이터 ────────────────────────────────────
let typingEl = null;

export function showTyping() {
  const list = document.getElementById(_activeContainerId);
  if (!list) return;
  typingEl = document.createElement('div');
  typingEl.className = 'msg-row ai';
  typingEl.id = 'typing-row';
  typingEl.innerHTML = `<div class="typing-indicator">
    <span></span><span></span><span></span>
  </div>`;
  list.appendChild(typingEl);
  list.scrollTop = list.scrollHeight;
}

export function hideTyping() {
  document.getElementById('typing-row')?.remove();
  typingEl = null;
}

// ── 스트리밍 버블 ────────────────────────────────────────
export function _createStreamBubble() {
  const list   = document.getElementById(_activeContainerId);
  if (!list) return null;
  const row    = document.createElement('div');
  row.className = 'msg-row ai';
  const bubble = document.createElement('div');
  bubble.className = 'bubble bubble-ai streaming';
  row.appendChild(bubble);
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;
  return bubble;
}

export function _updateStreamBubble(bubble, text) {
  if (!bubble) return;
  bubble.innerHTML = text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\n/g,'<br>')
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>');
  const list = document.getElementById(_activeContainerId);
  if (list) list.scrollTop = list.scrollHeight;
}

// ── 리스크 칩 ────────────────────────────────────────────
export function riskChip(level, flags = []) {
  const map = { S0:'✅ 안전', S1:'⚠️ 주의', S2:'🚨 경고', S3:'🛑 차단' };
  const label   = map[level] ?? '—';
  const flagStr = flags.length ? ` · ${flags.slice(0,3).join(' ')}` : '';
  return `<span class="risk-chip ${level.toLowerCase()}">${label}${flagStr}</span>`;
}
