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

// ── AI 설정 팝업 ─────────────────────────────────────────
function _showAISetupPopup() {
  document.getElementById('ai-setup-overlay')?.remove();
  const ov = document.createElement('div');
  ov.id = 'ai-setup-overlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:flex-end;justify-content:center';
  ov.innerHTML = `
    <div style="background:#fff;border-radius:20px 20px 0 0;padding:24px;width:100%;max-width:480px;
                max-height:80vh;overflow-y:auto;padding-bottom:calc(24px + env(safe-area-inset-bottom,0px))">
      <div style="width:36px;height:4px;background:#e5e7eb;border-radius:2px;margin:0 auto 16px"></div>
      <p style="font-weight:600;font-size:16px;margin:0 0 16px;color:#111827;letter-spacing:-0.3px">AI 비서 활성화</p>
      <label style="font-size:12px;font-weight:600;color:var(--txt2);display:block;margin-bottom:6px">LLM 모델</label>
      <select id="_ai_model" style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;margin-bottom:12px;font-family:inherit">
        <option value="deepseek-v4-flash">DeepSeek V4 Flash (빠름)</option>
        <option value="deepseek-v4-pro">DeepSeek V4 Pro</option>
        <option value="deepseek-chat">DeepSeek V3</option>
        <option value="gpt-4o">GPT-4o</option>
        <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
        <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
      </select>
      <label style="font-size:12px;font-weight:600;color:var(--txt2);display:block;margin-bottom:6px">API Key</label>
      <div style="display:flex;align-items:center;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:16px">
        <input id="_ai_key" type="password" placeholder="sk-... (고팡 프록시 사용 시 불필요)"
          style="flex:1;padding:10px 12px;border:none;outline:none;font-size:14px;font-family:inherit;min-width:0">
        <button id="_ai_key_toggle" type="button"
          style="padding:0 12px;height:42px;border:none;background:transparent;cursor:pointer;
                 border-left:1px solid #e5e7eb;display:flex;align-items:center;flex-shrink:0">
          <svg id="_ai_key_eye" width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="#9ca3af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </button>
      </div>
      <div style="display:flex;gap:8px">
        <button id="_ai_cancel" style="flex:1;padding:12px;border:1px solid #e5e7eb;border-radius:10px;background:none;cursor:pointer;font-size:14px;font-family:inherit">취소</button>
        <button id="_ai_ok" style="flex:2;padding:12px;border:none;border-radius:10px;background:#16a34a;color:#fff;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit">AI 활성화</button>
      </div>
    </div>`;
  document.body.appendChild(ov);

  const modelSel = ov.querySelector('#_ai_model');

  // API Key 보기/숨기기
  ov.querySelector('#_ai_key_toggle').onclick = () => {
    const inp = ov.querySelector('#_ai_key');
    const eye = ov.querySelector('#_ai_key_eye');
    if (inp.type === 'password') {
      inp.type = 'text';
      eye.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>';
    } else {
      inp.type = 'password';
      eye.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
    }
  };
  if (CFG.model) modelSel.value = CFG.model;

  ov.querySelector('#_ai_cancel').onclick = () => ov.remove();
  ov.querySelector('#_ai_ok').onclick = () => {
    const model = modelSel.value;
    const key   = ov.querySelector('#_ai_key').value.trim();
    const isProxy = CFG.endpoint.includes('gopang-proxy');
    if (!isProxy && !key) { alert('고팡 프록시가 아닌 경우 API Key가 필요합니다.'); return; }
    if (model) CFG.model  = model;
    if (key)   CFG.apiKey = key;
    try {
      localStorage.setItem('gopang_cfg', JSON.stringify({
        model: CFG.model, endpoint: CFG.endpoint,
        apiKey: CFG.apiKey, geminiKey: CFG.geminiKey,
      }));
    } catch {}
    ov.remove();
    setAiActive(true);
    document.getElementById('btn-ai')?.classList.add('active');
    appendBubble('ai', '귀하의 AI 비서입니다. 지시하십시오.');
  };
}
