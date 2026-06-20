/**
 * ai/toggle.js — AI 비서 활성화·비활성화
 */
import { aiActive, setAiActive } from '../core/state.js';
import { CFG } from '../core/config.js';
import { _isRegistered } from '../core/auth.js';
import { appendBubble } from '../ui/bubble.js';
import { _showRegisterFlow } from '../ui/register-flow.js';

// ── AI 토글 (버튼 클릭) ──────────────────────────────────
export function toggleAI() {
  if (!_isRegistered()) {
    _showRegisterFlow();
    return;
  }

  const providerCount = Array.isArray(CFG.providers) ? CFG.providers.length : 0;
  const hasKey = !!(CFG.apiKey || CFG.geminiKey || providerCount > 0);

  // 미설정 사용자 → 모바일 전용 설정 페이지로 안내 (새 탭, 팝업 없음)
  // ai-setup.html(PC용, 핸들 입력 후 암호화 전송)과는 별개의 파일.
  if (!hasKey) {
    window.open('/pages/ai-setup-mobile.html', '_blank');
    return;
  }

  // 설정 완료 사용자 → 단순 토글 (켬 ↔ 끔)
  if (aiActive) {
    setAiActive(false);
    document.getElementById('btn-ai')?.classList.remove('active');
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
  setAiActive(true);
  document.getElementById('btn-ai')?.classList.add('active');
  const sub = document.getElementById('ai-card-sub');
  if (sub) sub.textContent = `${CFG.model} 연결됨`;
}

export function closeAI() {
  document.getElementById('ai-overlay')?.classList.remove('open');
}
