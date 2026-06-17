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
  if (aiActive) {
    setAiActive(false);
    document.getElementById('btn-ai')?.classList.remove('active');
    appendBubble('system', 'AI 비서 비활성화됨.');
    return;
  }
  _showAISetupPopup();
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
  if (!silent) appendBubble('ai', '귀하의 AI 비서입니다. 지시하십시오.');
}

export function closeAI() {
  document.getElementById('ai-overlay')?.classList.remove('open');
}

// ── AI 설정 안내 팝업 (모바일 — PC 안내) ───────────────────
function _showAISetupPopup() {
  document.getElementById('ai-setup-overlay')?.remove();
  const ov = document.createElement('div');
  ov.id = 'ai-setup-overlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:flex-end;justify-content:center';

  const cfg = CFG.model ? `현재 모델: ${CFG.model}` : '아직 설정되지 않았습니다.';
  const providerCount = Array.isArray(CFG.providers) ? CFG.providers.length : 0;
  const hasKey = !!(CFG.apiKey || CFG.geminiKey || providerCount > 0);

  ov.innerHTML = `
    <div style="background:#fff;border-radius:20px 20px 0 0;padding:24px;width:100%;max-width:480px;
                max-height:80vh;overflow-y:auto;padding-bottom:calc(24px + env(safe-area-inset-bottom,0px))">
      <div style="width:36px;height:4px;background:#e5e7eb;border-radius:2px;margin:0 auto 16px"></div>
      <p style="font-weight:600;font-size:16px;margin:0 0 4px;color:#111827;letter-spacing:-0.3px">나만의 AI 비서 활성화</p>
      <p style="font-size:12.5px;color:#9ca3af;margin:0 0 18px;line-height:1.6">귀하 한 사람만을 위한 맞춤형으로 진화합니다.</p>

      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:16px">
        <p style="font-size:13.5px;color:#374151;line-height:1.8;margin:0 0 4px">
          API Key는 휴대폰에서 입력하기 어렵습니다.<br>
          <b>PC</b>에서 <b>gopang.net</b> 접속 → 화면의<br>
          <b>"AI 비서 활성화"</b> 버튼을 눌러 설정해 주세요.
        </p>
        <p style="font-size:11.5px;color:#9ca3af;margin-top:8px">PC에서 설정하면 이 휴대폰에 자동으로 반영됩니다.</p>
      </div>

      <div style="background:#f0fdf8;border:1px solid #d1fae5;border-radius:12px;padding:14px 16px;margin-bottom:16px">
        <p style="font-size:12.5px;color:#1a9e6a;line-height:1.7;margin:0">
          💡 여러 LLM을 동시에 등록해두면, 한 모델의 무료 한도가 차더라도 등록 순서대로 다음 모델로 자동 전환되어 AI 비서가 끊기지 않습니다.
        </p>
      </div>

      <div style="font-size:12px;color:${hasKey ? '#16a34a' : '#9ca3af'};margin-bottom:16px">
        ${hasKey ? `✅ 설정 완료 — ${providerCount > 0 ? providerCount + '개 LLM 등록됨' : cfg}` : '⏳ ' + cfg}
      </div>

      <button id="_ai_close" style="width:100%;padding:14px;border:none;border-radius:10px;background:#16a34a;color:#fff;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit">확인</button>
    </div>`;
  document.body.appendChild(ov);

  // 외부(배경) 클릭 시 닫힘
  ov.addEventListener('click', (e) => {
    const sheet = ov.querySelector('div');
    if (sheet && !sheet.contains(e.target)) ov.remove();
  });

  ov.querySelector('#_ai_close').onclick = () => {
    ov.remove();
    // PC에서 이미 설정이 있는 경우에만 활성화
    if (CFG.apiKey || CFG.geminiKey || providerCount > 0) {
      setAiActive(true);
      document.getElementById('btn-ai')?.classList.add('active');
      appendBubble('ai', '귀하의 AI 비서입니다. 지시하십시오.');
    }
  };
}
