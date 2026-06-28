/**
 * core/config.js — 앱 설정 (CFG, 모델, 엔드포인트)
 */
import { setAiActive, aiActive, _USER, USER_GUID } from '../gopang/core/state.js';

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


// ── Personal Assistant SP 로더 ────────────────────────────────────
// personal-assistant-LATEST.txt 포인터로 버전 결정 후 CFG.system에 적용
// 버전 갱신 시 포인터 파일만 수정 — 코드 배포 불필요
// 캐시: 세션당 1회 (페이지 리로드 시 재로드)
const _RAW_BASE_CFG = 'https://raw.githubusercontent.com/Openhash-Gopang/gopang/main/prompts/';
const _PA_PTR_URL   = _RAW_BASE_CFG + 'personal-assistant/personal-assistant-LATEST.txt';
let _paSPLoaded = false;

export async function loadPersonalAssistantSP() {
  if (_paSPLoaded) return CFG.system;
  // gopang_cfg에 저장된 system이 있으면 사용자가 직접 설정한 것 → 우선
  const saved = JSON.parse(localStorage.getItem('gopang_cfg') || '{}');
  if (saved.system && saved.system.length > 100) {
    CFG.system = saved.system;
    _paSPLoaded = true;
    return CFG.system;
  }
  try {
    // Step 1: 포인터 파일로 최신 버전 파일명 결정
    const ptrRes = await fetch(_PA_PTR_URL, { cache: 'no-cache' });
    if (!ptrRes.ok) throw new Error('PA 포인터 없음: ' + ptrRes.status);
    const latestFile = (await ptrRes.text()).trim().replace(/[\n\r]/g, '');
    if (!latestFile) throw new Error('PA 포인터 내용 비어있음');
    // Step 2: 포인터가 가리키는 실제 SP 로드
    const res = await fetch(_RAW_BASE_CFG + 'personal-assistant/' + latestFile, { cache: 'no-cache' });
    if (res.ok) {
      const sp = await res.text();
      if (sp && sp.length > 200) {
        CFG.system = sp;
        CFG.system_base = sp;
        // gopang_cfg에도 저장 (다음 세션 빠른 로드용)
        try {
          const cfg2 = JSON.parse(localStorage.getItem('gopang_cfg') || '{}');
          cfg2.system = sp;
          localStorage.setItem('gopang_cfg', JSON.stringify(cfg2));
        } catch {}
        console.info('[PA-SP] SP 로드 완료:', latestFile, sp.length, 'chars');
      }
    }
  } catch (e) {
    console.warn('[PA-SP] SP 로드 실패 — 인라인 폴백 사용:', e.message);
  }
  _paSPLoaded = true;
  return CFG.system;
}
