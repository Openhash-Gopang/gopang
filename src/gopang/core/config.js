/**
 * core/config.js — 앱 설정 (CFG, 모델, 엔드포인트)
 */
import { setAiActive, aiActive, _USER, USER_GUID } from './state.js';

// ── Provider별 정보 (모델 → provider 식별 + baseUrl) ────────
// 모든 provider가 OpenAI 호환 /chat/completions 형식 지원
export const PROVIDER_INFO = {
  gemini:     { label: 'Gemini',     baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyField: 'geminiKey' },
  deepseek:   { label: 'DeepSeek',   baseUrl: 'https://api.deepseek.com',                                 keyField: 'apiKey' },
  anthropic:  { label: 'Claude',     baseUrl: 'https://api.anthropic.com/v1',                              keyField: 'apiKey' },
  openai:     { label: 'GPT',        baseUrl: 'https://api.openai.com/v1',                                 keyField: 'apiKey' },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1',                               keyField: 'apiKey', noStreamOptions: true },
};

export function _providerOf(model) {
  if (!model) return null;
  // OpenRouter 모델 ID는 'vendor/model-name' 형식 (예: deepseek/deepseek-r1:free)
  if (model.includes('/'))         return 'openrouter';
  if (model.startsWith('gemini'))  return 'gemini';
  if (model.startsWith('deepseek'))return 'deepseek';
  if (model.startsWith('claude'))  return 'anthropic';
  if (model.startsWith('gpt'))     return 'openai';
  return null;
}

export const CFG = {
  apiKey:    '',
  geminiKey: '',
  kakaoKey:  '66648ca49f126d8752b33d542789ac56',
  endpoint:  'https://gopang-proxy.tensor-city.workers.dev',
  model:     'deepseek-v4-flash',
  // ── 다중 LLM 순차 페일오버 ───────────────────────────────
  // 각 항목: { provider, model, apiKey }
  // 등록된 순서대로 호출하며, 한도 초과(429/402) 시 다음 항목으로 자동 전환
  providers: [],
  // personal-assistant-v1.0 — Profile 온보딩 + 일상 비서 + P2P 대리 응대
  // GitHub raw에서 동적 로드 (loadPersonalAssistantSP 참조)
  // 로드 실패 시 아래 인라인 폴백 사용
  system: `당신은 혼디(Hondi) 나만의 AI 비서입니다. 한국어 해요체.
세션 시작 시: localStorage 'hondi_profile_done'이 없으면 Profile 작성을 시작합니다.
Profile 작성: 이름 → 유형(개인/사업자/기관) → 업종·상품 → 주소 → 연락처 → GDC결제 → 확인 순서로 한 번에 하나씩 질문합니다.
완성 시 PROFILE_SUBMIT {...} 출력 후 PDV_STORE를 출력합니다.
완성 후: 일상 대화 직접 처리, 전문 분야는 라우팅(K-Law/K-Tax/K-Market 등).
P2P 채널에서 상대방 문의 시: 내 Profile 기반으로 대신 응대합니다.`,
  system_base: null,
  locationStr: '',
};

// ── 모델명 교정 매핑 ──────────────────────────────────────
export const MODEL_MIGRATION = {
  'deepseek-v4':  'deepseek-v4-flash',
  'deepseek-v3':  'deepseek-chat',
  'deepseek-r1':  'deepseek-reasoner',
};

// ── 설정 저장 ─────────────────────────────────────────────
export function saveSettings() {
  const modelSel = document.getElementById('setting-model');
  const epSel    = document.getElementById('setting-endpoint');
  const apiInput = document.getElementById('setting-apikey');
  const gKeyInput= document.getElementById('setting-gemini-key');
  const sysInput = document.getElementById('setting-system');
  const custUrl  = document.getElementById('custom-endpoint-url');

  if (modelSel)  CFG.model = modelSel.value;
  if (epSel) {
    CFG.endpoint = epSel.value === 'custom'
      ? (custUrl?.value?.trim() || CFG.endpoint)
      : epSel.value;
  }
  const apiVal = apiInput?.value?.trim();
  if (apiVal && !apiVal.startsWith('•')) CFG.apiKey = apiVal;
  const gVal = gKeyInput?.value?.trim();
  if (gVal && !gVal.startsWith('•'))   CFG.geminiKey = gVal;
  if (sysInput?.value?.trim())         CFG.system    = sysInput.value.trim();

  try {
    localStorage.setItem('gopang_cfg', JSON.stringify({
      model: CFG.model, endpoint: CFG.endpoint,
      apiKey: CFG.apiKey, geminiKey: CFG.geminiKey,
      providers: CFG.providers,
    }));
  } catch {}

  if (typeof window.closeSettings === 'function') window.closeSettings();
  if (typeof window.appendBubble  === 'function') window.appendBubble('ai', `⚙️ 설정 저장: ${CFG.model}`);
}

// ── 설정 불러오기 ─────────────────────────────────────────
export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('gopang_cfg') || '{}');
    if (saved.model)    CFG.model    = MODEL_MIGRATION[saved.model] ?? saved.model;
    if (saved.endpoint) CFG.endpoint = saved.endpoint;
    if (saved.apiKey)   CFG.apiKey   = saved.apiKey;
    if (saved.geminiKey)CFG.geminiKey= saved.geminiKey;
    if (Array.isArray(saved.providers) && saved.providers.length) {
      CFG.providers = saved.providers;
    }
    if (saved.apiKey || saved.geminiKey || CFG.providers.length) setAiActive(true);
  } catch {}
}

// ── 모델 비전 지원 여부 ───────────────────────────────────
export const VISION_MODELS = new Set([
  'deepseek-chat',
  'gpt-4o', 'gpt-4o-mini',
  'claude-sonnet-4-20250514', 'claude-opus-4-20250514',
  'gemini-2.0-flash', 'gemini-1.5-pro',
]);

export function _modelSupportsVision(model) {
  return VISION_MODELS.has(model);
}


// ── Personal Assistant / 그림자 SP 로더 ─────────────────────────────
// 설계 원칙(2026-06-22 합의):
//   1) 그림자(_ai)가 존재하면: Worker에서 그 Profile을 fresh fetch → system_prompt 사용
//      (profile.html이 B의 Profile에서 system_prompt를 가져오는 것과 동일한 메커니즘)
//   2) 그림자 없음(온보딩 미완료): GitHub raw에서 personal-assistant-v1.0.txt 로드
// 영구 localStorage 캐시 제거 — 매 세션 fresh fetch로 통일(갱신 자동 반영)
const _PA_SP_URL = 'https://raw.githubusercontent.com/Openhash-Gopang/gopang/main/prompts/personal-assistant/personal-assistant-v1.0.txt';
const _PROXY_URL = 'https://gopang-proxy.tensor-city.workers.dev';
let _paSPLoaded = false;

export async function loadPersonalAssistantSP() {
  if (_paSPLoaded) return CFG.system;

  // 1) 그림자 우선 경로: hondi_profile_done + _USER.handle 이 있으면 시도
  const profileDone = _profileDone();
  const handle = _USER?.handle || null;
  if (profileDone && handle) {
    try {
      const agentHandle = handle.replace(/^@/, '') + '_ai';
      const res = await fetch(`${_PROXY_URL}/profile/@${agentHandle}`, { cache: 'no-cache' });
      if (res.ok) {
        const data = await res.json();
        const sp = data?.extra?.public?.ai_assistant?.system_prompt;
        if (sp && sp.length > 200) {
          CFG.system = sp;
          CFG.system_base = sp;
          _paSPLoaded = true;
          console.info('[SP] 그림자 system_prompt 로드 완료:', agentHandle, sp.length, 'chars');
          return CFG.system;
        }
      }
    } catch (e) {
      console.warn('[SP] 그림자 SP 로드 실패 — 폴백:', e.message);
    }
  }

  // 2) 폴백: personal-assistant-v1.0.txt (온보딩용)
  //    localStorage 영구 캐시 금지 — 항상 fresh fetch (그림자가 생기면 자동 전환됨)
  try {
    const res = await fetch(_PA_SP_URL, { cache: 'no-cache' });
    if (res.ok) {
      const sp = await res.text();
      if (sp && sp.length > 200) {
        CFG.system = sp;
        CFG.system_base = sp;
        console.info('[SP] personal-assistant-v1.0 로드 완료:', sp.length, 'chars');
      }
    }
  } catch (e) {
    console.warn('[SP] SP 로드 실패 — 인라인 폴백 사용:', e.message);
  }
  _paSPLoaded = true;
  return CFG.system;
}

function _profileDone() {
  try { return !!localStorage.getItem('hondi_profile_done'); } catch { return false; }
}

/**
 * SP 로더 플래그 리셋 — PROFILE_SUBMIT 완료 직후 호출.
 * 이후 loadPersonalAssistantSP()를 다시 호출하면 그림자 SP를 fresh fetch한다.
 * 이렇게 하지 않으면 세션 내에 _paSPLoaded=true가 유지돼
 * 온보딩 SP가 평생 그대로 남는다.
 */
export function resetSPLoader() {
  _paSPLoaded = false;
}
