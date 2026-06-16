/**
 * core/config.js — 앱 설정 (CFG, 모델, 엔드포인트)
 */
import { setAiActive, aiActive, _USER, USER_GUID } from './state.js';

export const CFG = {
  apiKey:    '',
  geminiKey: '',
  kakaoKey:  '66648ca49f126d8752b33d542789ac56',
  endpoint:  'https://gopang-proxy.tensor-city.workers.dev',
  model:     'deepseek-v4-flash',
  // SP-00 v11.0 — 캐시 최적화: 완전 정적, 동적값 없음
  // GUID·위치·시간은 call-ai.js에서 user 컨텍스트 메시지로 주입
  // DeepSeek prefix cache: system이 동일하면 ~95% 캐시 적중
  system: `고팡 AI 비서. 한국어, 간결.
요청: 직접처리 OR 응답 첫줄에 [GWP:ID] 출력.
긴급시 즉시 [GWP:kemergency].
GWP:[kemergency]긴급 [klaw]법률 [kpolice]경찰 [khealth]병원 [kedu]교육 [kgdc]GDC [kfinance]주식 [ktax]세금 [kcommerce]쇼핑 [ktransport]교통 [klogistics]택배 [fiil-kcleaner]환경오염 [kgov]민원 [kdemocracy]투표
AUTH:[L2]지문(10만↑) [L1]얼굴(10만↓) [L0]자동`,
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
    if (saved.apiKey)   setAiActive(true);
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

