/**
 * ui/bubble.js — 메시지 버블 렌더링
 */

/**
 * 채팅창에 버블 추가
 * @param {'ai'|'user'|'peer'|'system'} role
 * @param {string} text
 * @param {boolean} isHTML
 * @param {string|null} senderName  peer 메시지의 발신자 이름
 */
export function appendBubble(role, text, isHTML = false, senderName = null) {
  const list = document.getElementById('message-list');
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
  const list = document.getElementById('message-list');
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
  const list   = document.getElementById('message-list');
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
  const list = document.getElementById('message-list');
  if (list) list.scrollTop = list.scrollHeight;
}

// ── 리스크 칩 ────────────────────────────────────────────
export function riskChip(level, flags = []) {
  const map = { S0:'✅ 안전', S1:'⚠️ 주의', S2:'🚨 경고', S3:'🛑 차단' };
  const label   = map[level] ?? '—';
  const flagStr = flags.length ? ` · ${flags.slice(0,3).join(' ')}` : '';
  return `<span class="risk-chip ${level.toLowerCase()}">${label}${flagStr}</span>`;
}
