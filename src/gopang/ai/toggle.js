/**
 * ai/toggle.js — AI 비서 활성화·비활성화
 */
import { aiActive, setAiActive } from '../core/state.js';
import { CFG } from '../core/config.js';
import { _isRegistered } from '../core/auth.js';
import { appendBubble } from '../ui/bubble.js';
import { _showRegisterFlow } from '../ui/register-flow.js';

// 마지막 토글 상태 저장 키 — 화면을 닫기 전 상태를 기억하기 위함
const _AI_TOGGLE_KEY = 'gopang_ai_toggle_state';

// v3.3(2026-07-01): 본인 키 등록 여부를 확인해 ai-setup-mobile.html로
// 강제 이동시키던 게이트(_hasApiKey)를 제거했다. call-ai.js의
// _buildCallCandidates()가 'deepseek-default'(DeepSeek V4 Flash, 무료
// 한도 1,000원)를 항상 최종 안전망으로 제공하므로, 등록된 키가 없어도
// AI 비서는 즉시 정상 동작한다 — LLM 선택 자체가 더 이상 필요 없다.

// ── AI 토글 (버튼 클릭) ──────────────────────────────────
export function toggleAI() {
  if (!_isRegistered()) {
    _showRegisterFlow();
    return;
  }

  // 설정 완료 여부와 무관하게 단순 토글 (켬 ↔ 끔)
  if (aiActive) {
    setAiActive(false); // 버튼 화면도 setAiActive() 안에서 같이 갱신됨
    localStorage.setItem(_AI_TOGGLE_KEY, '0');
    appendBubble('system', 'AI 비서 비활성화됨.');
  } else {
    activateAI(false);
  }
}

// ── AI 활성화 (silent: 자동/수동) ────────────────────────
export function activateAI(silent = false) {
  if (aiActive) return;
  if (!_isRegistered()) {
    if (!silent) _showRegisterFlow();
    return;
  }
  setAiActive(true); // 버튼 화면도 setAiActive() 안에서 같이 갱신됨
  localStorage.setItem(_AI_TOGGLE_KEY, '1');
  const sub = document.getElementById('ai-card-sub');
  if (sub) sub.textContent = `${CFG.model} 연결됨`;
}

export function closeAI() {
  document.getElementById('ai-overlay')?.classList.remove('open');
}

// ── 부팅 시점 토글 상태 복원 ──────────────────────────────
// - 마지막으로 명시적으로 끔을 선택한 기록이 있음 → 꺼짐 유지
// - 그 외(기록 없음 또는 켬 기록) → 켬 (deepseek-default가 항상 사용 가능하므로
//   키 등록 여부와 무관하게 기본적으로 켜진 상태로 시작)
export function initAIToggleState() {
  const stored = localStorage.getItem(_AI_TOGGLE_KEY);
  if (stored === '0') return; // 마지막에 명시적으로 꺼둔 상태 → 유지

  activateAI(true);
}
