/**
 * ui/welcome.js — 초기 환영 메시지
 * - 모든 사용자: nickname 표시
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

  bubble.innerHTML = nickname
    ? `안녕하세요, ${nickname}님.`
    : '안녕하세요.';

  row.appendChild(bubble);
  list.appendChild(label);
  list.appendChild(row);

  // 사용자 안내 메시지 — 최초 접속 시에만 표시 (두 번째 방문부터는 생략)
  const GUIDE_SHOWN_KEY = 'gopang_welcome_guide_shown';
  let alreadyShown = false;
  try { alreadyShown = !!localStorage.getItem(GUIDE_SHOWN_KEY); } catch {}

  if (!alreadyShown) {
    const guideRow = document.createElement('div');
    guideRow.className = 'msg-row ai';

    const guideBubble = document.createElement('div');
    guideBubble.className = 'bubble bubble-ai';
    guideBubble.textContent =
      "'나만의 AI 비서'를 설정하십시오. 오른쪽 위 AI 토글을 터치하면, 설정 방법을 자세히 안내합니다. PC에서 혼디넷에 접속하면, 안내 페이지를 편리하게 보실 수 있습니다('AI 비서 설정 가이드' 버튼).";

    guideRow.appendChild(guideBubble);
    list.appendChild(guideRow);

    try { localStorage.setItem(GUIDE_SHOWN_KEY, '1'); } catch {}
  }
}

// ── 입력 필드 ───────────────────────────────────────────
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}
