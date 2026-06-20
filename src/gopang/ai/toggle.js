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

// OpenRouter 키 또는 기타 provider가 하나라도 등록돼 있는지 — 모든 활성화
// 경로(toggleAI/activateAI/initAIToggleState)가 반드시 이 함수를 통해서만
// 판단하도록 일원화. 이게 없으면 activateAI()를 직접 호출하는 다른 진입점
// (예: AI 비서 카드의 "AI 비서 시작" 버튼)이 키 체크를 우회할 수 있다.
function _hasApiKey() {
  const providerCount = Array.isArray(CFG.providers) ? CFG.providers.length : 0;
  return !!(CFG.apiKey || CFG.geminiKey || providerCount > 0);
}

// ── AI 토글 (버튼 클릭) ──────────────────────────────────
export function toggleAI() {
  if (!_isRegistered()) {
    _showRegisterFlow();
    return;
  }

  const hasKey = _hasApiKey();
  // ai-setup.html(PC용, 핸들 입력 후 암호화 전송)과는 별개의 파일.
  if (!hasKey) {
    window.open('/pages/ai-setup-mobile.html', '_blank');
    return;
  }

  // 설정 완료 사용자 → 단순 토글 (켬 ↔ 끔)
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
  // ★ 키 체크 — 이게 없으면 toggleAI()를 거치지 않고 activateAI()를 직접
  //   호출하는 다른 진입점(예: AI 비서 카드의 "AI 비서 시작" 버튼)이
  //   OpenRouter 키 등록 없이도 AI를 활성화시킬 수 있다.
  if (!_hasApiKey()) {
    if (!silent) window.open('/pages/ai-setup-mobile.html', '_blank');
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
// - AI 미설정(키 없음) → 항상 꺼짐 (최초 방문자 기본값)
// - 설정은 했지만 켬/끔을 기록한 적 없음(설정 직후 첫 부팅) → 켬 (기존 자동 활성화 동작과 동일)
// - 마지막으로 명시적으로 끔/켬을 선택한 기록이 있음 → 그 상태를 그대로 복원
export function initAIToggleState() {
  if (!_hasApiKey()) return; // 미설정 — 꺼짐 유지

  const stored = localStorage.getItem(_AI_TOGGLE_KEY);
  if (stored === '0') return; // 마지막에 명시적으로 꺼둔 상태 → 유지

  activateAI(true); // stored === '1' 이거나 기록 없음(설정 직후 첫 부팅) → 켬
}
