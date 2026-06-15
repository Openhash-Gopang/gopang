/**
 * ui/welcome.js — 초기 환영 메시지
 * - 모든 사용자: nickname + handle 표시
 * - 잔액은 표시 안 함 (사용자 요청 시 응답)
 */
import { appendBubble } from './bubble.js';
import { _USER } from '../core/state.js';

// ── 초기 AI 비서 환영 메시지 ────────────────────────────
export function _showWelcomeMessage() {
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

  const nickname = _USER?.nickname || _USER?.name || '';
  const handle   = _USER?.handle   || '';

  bubble.innerHTML = nickname
    ? `안녕하세요, ${nickname}님 (${handle})<br>지시 대기 중.`
    : '지시 대기 중.';

  row.appendChild(bubble);
  list.appendChild(label);
  list.appendChild(row);
}

// ── 입력 필드 ───────────────────────────────────────────
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}
