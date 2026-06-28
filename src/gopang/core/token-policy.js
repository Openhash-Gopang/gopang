/**
 * core/token-policy.js — LLM 토큰·모델 사용 정책 (단일 기준)
 *
 * 왜 필요한가
 * ───────────
 * max_tokens 값이 호출부마다 제각각 하드코딩되어 있었습니다(router.js 256,
 * call-ai.js 800, routing-engine.js 30/200/1200, klaw.js 512, webapp.html
 * 패널 1500 ...). 같은 종류의 작업(예: 메인 대화 응답)인데도 파일마다 숫자가
 * 달랐고(call-ai.js 800 vs webapp.html 패널 1500), 그게 의도적인 차이인지
 * 그냥 따로 정해서 생긴 우연인지 코드만 보고는 알 수 없었습니다.
 *
 * 더 심각한 사례: src/gopang/services/klaw.js의 백그라운드 감시 기능은
 * 분류 작업인데도 model: CFG.model(사용자가 고른, 비쌀 수 있는 메인 대화
 * 모델)을 그대로 써서, 대화·PDV 기록마다 LLM을 추가로 호출 — 결국
 * "토큰 과다 소모"로 기능 전체가 꺼졌습니다(2026-06-27, KLAW_BACKGROUND_ENABLED
 * = false). router.js는 처음부터 이 원칙을 지켜서(고정 저가 모델
 * deepseek-v4-flash) 같은 함정에 빠지지 않았습니다.
 *
 * 원칙
 * ────
 * 1. max_tokens는 호출부에서 숫자를 새로 정하지 않고, 이 파일의 TOKEN_BUDGET
 *    중 용도에 맞는 키를 골라 쓴다. 새 용도가 필요하면 여기에 키를 추가한다
 *    (다른 파일에 숫자를 직접 적지 않는다).
 * 2. "분류·요약·감시"처럼 사용자가 보는 대화 품질과 무관한 보조 작업은
 *    FAST_MODEL(고정 저가 모델)을 쓴다. CFG.model(사용자가 고른 모델, 비쌀
 *    수 있음)은 사용자가 실제로 읽는 대화 응답에만 쓴다.
 * 3. 새 백그라운드/자동 작업을 추가할 때는 반드시 (a) 쿨다운, (b) 호출
 *    빈도 상한, (c) FAST_MODEL 사용 여부를 따져본다 — klaw.js가 이 셋 중
 *    (c)를 놓쳐서 기능 전체가 꺼진 전례가 있다.
 */

// ── 토큰 예산 — 용도별 max_tokens ──────────────────────────────────────
export const TOKEN_BUDGET = {
  // 후보 중 하나만 골라 ID 등을 반환하는 극소 작업
  TRIVIAL_PICK:    30,

  // SP-00 라우터 등 — 분류 결과를 JSON으로만 반환
  ROUTE_CLASSIFY: 256,

  // 6하원칙 요약 등 — 짧은 구조화 요약
  SUMMARY_SHORT:  240,

  // K-Law 등 백그라운드 감시 — 분류 + 근거 + 권고까지 포함
  MONITOR_REVIEW: 512,

  // 메인 대화 한 턴 응답(PA 온보딩 / AGENT-COMMON / AI 패널) — 표면이
  // 메인 채팅이든 AI 패널이든 "같은 종류의 응답"이면 같은 예산을 쓴다.
  CHAT_REPLY:     800,

  // GWP inline Agent 호출 응답(같은 세션 내 전문 SP 주입 후 응답)
  AGENT_INLINE:  1200,

  // 실시간 SP 자동생성(800자 분량 텍스트 + 여유)
  SP_GENERATE:   1200,
};

/**
 * getTokenBudget(key) — 안전한 조회. 모르는 키를 쓰면 경고를 남기고
 * CHAT_REPLY로 폴백한다(조용히 undefined가 fetch 본문에 들어가는 것을 방지).
 */
export function getTokenBudget(key) {
  const v = TOKEN_BUDGET[key];
  if (v === undefined) {
    console.warn(`[TokenPolicy] 알 수 없는 용도: '${key}' — TOKEN_BUDGET.CHAT_REPLY로 대체`);
    return TOKEN_BUDGET.CHAT_REPLY;
  }
  return v;
}

// ── 모델 정책 ──────────────────────────────────────────────────────────
// 분류·요약·감시처럼 "사용자가 직접 읽고 평가하지 않는" 보조 작업 전용 모델.
// 사용자가 ai-setup-mobile.html에서 고른 CFG.model과 무관하게 항상 이 값을
// 쓴다 — 그래야 사용자가 고가 모델(Claude/GPT 등)을 메인으로 설정해도,
// 백그라운드 보조 작업이 매번 그 비싼 모델을 따라 호출하지 않는다.
export const FAST_MODEL = 'deepseek-v4-flash';
