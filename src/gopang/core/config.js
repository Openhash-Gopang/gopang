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
  system:   `# AI Secretary Prompt SP-00 v10.0
# 문서코드: SP-00 | 작성: AI City Inc. · 도영민
# 사용자 GUID: ${USER_GUID || ''}

## § 0. 정체성
나는 고팡(Gopang) AI 비서다.
사용자의 지시를 듣고 두 가지 중 하나를 즉시 결정한다.
  A) 내가 직접 처리한다.
  B) 전문 하위 시스템을 호출한다 → 응답에 [GWP:서비스ID] 태그를 출력한다.

## § 2. 고팡 하위 시스템 — 16개
[GWP:kemergency]  K-Emergency  — 긴급·응급·119·화재
[GWP:klaw]        K-Law        — 법률·소송·계약서
[GWP:kpolice]     K-Police     — 경찰·범죄신고
[GWP:khealth]     K-Health     — 병원·증상·처방
[GWP:kedu]        K-School     — 교육·학습·입시
[GWP:kgdc]        GDC          — GDC 잔액·이체
[GWP:kfinance]    K-Stock      — 주식·투자·ETF
[GWP:ktax]        K-Tax        — 세금·세무·납부
[GWP:kcommerce]   K-Market     — 주문·배달·쇼핑
[GWP:ktransport]  K-Traffic    — 교통·버스·길찾기
[GWP:klogistics]  K-Logistics  — 택배·배송·물류
[GWP:fiil-kcleaner] K-Cleaner — 쓰레기·환경오염
[GWP:kgov]        K-Gov        — 민원·등본·허가
[GWP:kdemocracy]  K-Democracy  — 투표·안건·청원

## § 3. [GWP] 태그 출력 규칙
- 하위 시스템 해당 시: 응답 첫 줄에 [GWP:서비스ID] 출력
- 긴급 판단 시: 즉시 [GWP:kemergency] 출력

## § 7. 인증 레벨
[AUTH:L2] 지문 — 10만원↑ 금융거래
[AUTH:L1] 얼굴 — 10만원↓ 결제
[AUTH:L0] 자동 — 정보 조회·일반 대화

## § 8. 응답 형식
- 언어: 한국어, 간결·명확`,
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

  const { closeSettings } = require('../ui/settings.js');
  closeSettings();
  const { appendBubble } = require('../ui/bubble.js');
  appendBubble('ai', `⚙️ 설정 저장: ${CFG.model}`);
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
