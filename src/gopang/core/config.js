/**
 * core/config.js — 앱 설정 (CFG, 모델, 엔드포인트)
 */
import { setAiActive, aiActive, _USER, USER_GUID } from './state.js';

// ── Provider별 정보 (모델 → provider 식별 + baseUrl) ────────
// 모든 provider가 OpenAI 호환 /chat/completions 형식 지원
// (Anthropic은 공식 OpenAI SDK 호환 레이어 제공 — base_url=api.anthropic.com/v1,
//  Authorization: Bearer 사용. 단, prompt caching 등 일부 고급기능은 미지원이므로
//  stream_options도 보수적으로 비활성화.)
export const PROVIDER_INFO = {
  anthropic:  { label: 'Claude',     baseUrl: 'https://api.anthropic.com/v1',                              keyField: 'apiKey',    noStreamOptions: true },
  gemini:     { label: 'Gemini',     baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyField: 'geminiKey', noStreamOptions: true },
  deepseek:   { label: 'DeepSeek',   baseUrl: 'https://api.deepseek.com',                                 keyField: 'apiKey' },
  openai:     { label: 'ChatGPT',    baseUrl: 'https://api.openai.com/v1',                                 keyField: 'apiKey' },
  xai:        { label: 'Grok',       baseUrl: 'https://api.x.ai/v1',                                       keyField: 'apiKey' },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1',                               keyField: 'apiKey', noStreamOptions: true },
};

// ── 호출 우선순위 (2026-06-24 v2 — OpenRouter 무료풀 1순위, 사용자 조정 가능) ──
// DEFAULT_PRIORITY_ORDER는 사용자가 한 번도 순서를 바꾸지 않았을 때의 기본값이다.
// ai-setup-mobile.html에서 드래그로 순서를 바꾸면 그 결과가
// localStorage(gopang_cfg.providerOrder)에 저장되고, getPriorityOrder()가 그 값을
// 최우선으로 읽는다. call-ai.js·webapp.html(_callPanelAI) 모두 이 함수를 통해서만
// 우선순위를 읽어야 사용자 설정이 실제 호출 순서에 반영된다.
export const DEFAULT_PRIORITY_ORDER = ['openrouter', 'anthropic', 'gemini', 'deepseek', 'openai', 'xai'];
// 하위 호환용 별칭 — 기존에 PRIORITY_ORDER를 직접 import하던 코드가 있어도 깨지지 않게 유지
export const PRIORITY_ORDER = DEFAULT_PRIORITY_ORDER;

export function getPriorityOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem('gopang_cfg') || '{}');
    const order = saved?.providerOrder;
    if (Array.isArray(order) && order.length) {
      // 알려진 provider id만 채택 + 빠진 id는 기본 순서대로 뒤에 보충
      // (새 provider가 추가됐는데 사용자의 저장된 순서가 오래된 경우를 대비)
      const known = new Set(DEFAULT_PRIORITY_ORDER);
      const valid = order.filter(id => known.has(id));
      const missing = DEFAULT_PRIORITY_ORDER.filter(id => !valid.includes(id));
      if (valid.length) return [...valid, ...missing];
    }
  } catch {}
  return DEFAULT_PRIORITY_ORDER;
}

export function _providerOf(model) {
  if (!model) return null;
  // OpenRouter 모델 ID는 'vendor/model-name' 형식 (예: deepseek/deepseek-r1:free)
  if (model.includes('/'))         return 'openrouter';
  if (model.startsWith('gemini'))  return 'gemini';
  if (model.startsWith('deepseek'))return 'deepseek';
  if (model.startsWith('claude'))  return 'anthropic';
  if (model.startsWith('grok'))    return 'xai';
  if (model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3')) return 'openai';
  return null;
}

export const CFG = {
  apiKey:    '',
  geminiKey: '',
  kakaoKey:  '66648ca49f126d8752b33d542789ac56',
  endpoint:  'https://hondi-proxy.tensor-city.workers.dev',
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
  'deepseek-v3':  'deepseek-v4-flash',
  'deepseek-r1':  'deepseek-reasoner',
  // deepseek-chat/reasoner는 2026-07-24 단종 예정 별칭 — 명시적 V4 ID로 선이전
  'deepseek-chat':     'deepseek-v4-flash',
  'deepseek-reasoner': 'deepseek-v4-flash',
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

// ── 디폴트 LLM 키 fetch (체험 기간 사용자 전용) ─────────────
// 사용자가 직접 키를 등록하지 않은 경우에만 호출
// 등록된 키가 있으면 건너뜀 (사용자 키 우선)
export async function loadDefaultKeyIfNeeded() {
  try {
    // 이미 사용자 키가 있으면 건너뜀
    const cfg = JSON.parse(localStorage.getItem('gopang_cfg') || '{}');
    const hasUserKey = (Array.isArray(cfg.providers) && cfg.providers.length > 0)
                    || cfg.apiKey || cfg.geminiKey;
    if (hasUserKey) return;

    // 가입일 확인
    const user = JSON.parse(
      localStorage.getItem('gopang_user_v4') ||
      sessionStorage.getItem('gopang_user_v4') || '{}'
    );
    const registeredAt = user.registeredAt || user.created;
    if (!registeredAt || !user.guid) return;

    // 이미 만료 확인했고 캐시가 유효하면 재요청 안 함 (1시간 캐시)
    const cache = JSON.parse(localStorage.getItem('hondi_default_key_cache') || 'null');
    if (cache && Date.now() - cache.ts < 3600000) {
      if (cache.ok) _applyDefaultKey(cache);
      return;
    }

    const PROXY = (await import('./state.js')).PROXY;
    const res   = await fetch(
      `${PROXY}/default-key?guid=${encodeURIComponent(user.guid)}&registered_at=${encodeURIComponent(registeredAt)}`,
      { signal: AbortSignal.timeout(5000) }
    );
    const data  = await res.json();

    // 캐시 저장
    localStorage.setItem('hondi_default_key_cache', JSON.stringify({ ...data, ts: Date.now() }));

    if (data.ok && data.key) {
      _applyDefaultKey(data);
    } else if (data.status === 'TRIAL_EXPIRED') {
      // 만료 배너 표시 (웹앱에서 처리)
      window._hondiTrialExpiredMsg = data.message;
      window.dispatchEvent(new CustomEvent('hondi:trial_expired', { detail: data }));
    }
  } catch (e) {
    console.info('[DefaultKey] fetch 실패 (무시):', e.message);
  }
}

function _applyDefaultKey({ provider, model, key }) {
  // CFG.providers에 임시 주입 (localStorage 저장 안 함 — 매 세션 fetch)
  const entry = {
    provider,
    baseUrl:  _providerBaseUrl(provider),
    model:    model || _providerDefaultModel(provider),
    apiKey:   key,
    isProxy:  false,
    priority: 0,
    _isDefault: true,  // 구분 플래그
  };
  // 기존에 _isDefault 항목이 있으면 교체, 없으면 앞에 추가
  const existing = Array.isArray(CFG.providers) ? CFG.providers : [];
  CFG.providers = [entry, ...existing.filter(p => !p._isDefault)];
  setAiActive(true);
  console.info('[DefaultKey] 디폴트 키 적용:', provider, model);
}

function _providerBaseUrl(provider) {
  const map = {
    openrouter: 'https://openrouter.ai/api/v1',
    anthropic:  'https://api.anthropic.com/v1',
    openai:     'https://api.openai.com/v1',
    gemini:     'https://generativelanguage.googleapis.com/v1beta',
    deepseek:   'https://api.deepseek.com',
    grok:       'https://api.x.ai/v1',
  };
  return map[provider] || 'https://openrouter.ai/api/v1';
}

function _providerDefaultModel(provider) {
  const map = {
    openrouter: 'deepseek/deepseek-v4-flash',
    anthropic:  'claude-haiku-4-5-20251001',
    openai:     'gpt-4o-mini',
    gemini:     'gemini-2.5-flash-preview-05-20',
    deepseek:   'deepseek-v4-flash',
    grok:       'grok-3-mini',
  };
  return map[provider] || 'deepseek/deepseek-v4-flash';
}

// ── 모델 비전 지원 여부 ───────────────────────────────────
// 2026-06-24: ai-setup-mobile.html에 추가된 현행 모델 ID들을 반영.
// 레거시 ID(구버전 사용자가 이미 등록해둔 값)도 하위호환으로 그대로 둔다.
// DeepSeek V4(Flash/Pro)는 비전 미지원으로 알려져 있어 포함하지 않음.
export const VISION_MODELS = new Set([
  // Claude
  'claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-7',
  'claude-sonnet-4-20250514', 'claude-opus-4-20250514', // 레거시
  // Gemini (전 모델 멀티모달 기본 지원)
  'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.1-pro',
  'gemini-2.0-flash', 'gemini-1.5-pro', // 레거시(단종)
  // OpenAI
  'gpt-5.4', 'gpt-5.4-nano', 'gpt-5.5',
  'gpt-4o', 'gpt-4o-mini', // 레거시
  // xAI
  'grok-4.1-fast', 'grok-4.3',
  // 레거시
  'deepseek-chat',
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
const _PROXY_URL = 'https://hondi-proxy.tensor-city.workers.dev';
let _paSPLoaded = false;

export async function loadPersonalAssistantSP() {
  if (_paSPLoaded) return CFG.system;

  // 1) 그림자 우선 경로: hondi_profile_done + _USER.handle 이 있으면 시도
  const profileDone = _profileDone();
  const handle = _USER?.handle || null;
  if (profileDone && handle) {
    try {
      // ── 이관 ⑪: 그림자 SP fetch → L1 직접 (2026-06-23) ────────────
      // 이전: PROXY /profile/@{handle}_ai → Worker → Supabase/L1
      // 이후: L1 profiles 직접 GET (공개 컬렉션, 인증 불필요)
      const agentHandle = handle.replace(/^@/, '') + '_ai';
      const _L1_BASE = 'https://l1-hanlim.hondi.net/api/collections/profiles/records';
      const _agentFilter = encodeURIComponent(`handle='${agentHandle}'`);
      const res = await fetch(`${_L1_BASE}?filter=${_agentFilter}&perPage=1`, { cache: 'no-cache' });
      if (res.ok) {
        const _raw = await res.json();
        const data = _raw.items?.[0] || null;
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
