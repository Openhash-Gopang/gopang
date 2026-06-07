// gopang-bubble.js — appendBubble·showTyping·riskChip
function appendBubble(role, text, isHTML = false) {
  const list = document.getElementById('message-list');
  const row  = document.createElement('div');
  row.className = `msg-row ${role}`;

  const bubble = document.createElement('div');
  bubble.className = `bubble bubble-${role}`;
  if (isHTML) bubble.innerHTML = text;
  else        bubble.textContent = text;

  row.appendChild(bubble);
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;
}

function riskChip(level, flags) {
  const map = { S0:'✅ 안전', S1:'⚠️ 주의', S2:'🚨 경고', S3:'🛑 차단' };
  const cls = level.toLowerCase();
  const label = map[level] ?? '—';
  const flagStr = flags.length ? ` · ${flags.slice(0,3).join(' ')}` : '';
  return `<span class="risk-chip ${cls}">${label}${flagStr}</span>`;
}

let typingEl = null;
function showTyping() {
  const list = document.getElementById('message-list');
  typingEl = document.createElement('div');
  typingEl.className = 'msg-row ai';
  typingEl.id = 'typing-row';
  typingEl.innerHTML = `<div class="typing-indicator">
    <span></span><span></span><span></span>
  </div>`;
  list.appendChild(typingEl);
  list.scrollTop = list.scrollHeight;
}
function hideTyping() {
  document.getElementById('typing-row')?.remove();
  typingEl = null;
}

// ── AI 비서 토글 ────────────────────────────────────────
function toggleAI() {
  if (aiActive) {
    // 이미 활성 → 카드 열지 않고 비활성화
    aiActive = false;
    document.getElementById('btn-ai').classList.remove('active');
    return;
  }
  // 미활성 → 카드 열기
  document.getElementById('ai-overlay').classList.toggle('open');
}
function closeAI() {
  document.getElementById('ai-overlay').classList.remove('open');
}
// silent=true : 버튼 클릭이 아닌 자동 활성화 (메시지 미표시)
// silent=false: 버튼 클릭으로 활성화 (안내 메시지 표시)
function activateAI(silent = false) {
  if (aiActive) return;   // 이미 활성 상태면 무시
  aiActive = true;
  document.getElementById('btn-ai').classList.add('active');
  // dot 색상은 CSS .btn-ai.active .ai-dot 으로 자동 처리
  document.getElementById('ai-card-sub').textContent = `${CFG.model} 연결됨`;

  if (!silent) {
    appendBubble('ai', '귀하의 AI 비서입니다. 지시하십시오.');
  }
}

// ── 설정 패널 ───────────────────────────────────────────
