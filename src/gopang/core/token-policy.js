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

  // 2026-0X-XX 신설 — hondi-pro(deepseek-v4-pro) 전용 예산. #180(profile-
  // assistant.html)과 동일 클래스 결함을 call-ai.js에서도 실측 확인(팀원
  // 제보 — K-Telecom switch형 GWP 전환 대화에서 hondi-pro 페일오버 턴이
  // 45초 idle 타임아웃, reasoning_tokens만 280+ 소모하고 content는 거의
  // 못 채움). hondi-pro는 thinking 모드가 원래 의도대로 켜져 있어(patch F
  // 참조 — Flash만 명시적으로 비활성화, Pro는 그대로 유지) 최종 답 전에
  // 추론에 토큰을 먼저 쓴다. v4.0(2026-07-28) 재설계로 AC가 hondi-pro를
  // 기본 호출로 쓰게 되면서, 이 문제가 "가끔 승격될 때"가 아니라 사실상
  // "매 턴"(사용자가 직접 키를 등록하지 않은 대다수 무료 사용자 기준)
  // 발생할 수 있는 상태였다.
  CHAT_REPLY_PRO: 4000,

  // 2026-0X-XX 신설 — profile-assistant.html 전용 예산. 이전엔 이 파일이
  // 자기만의 인라인 삼항연산자(1200/6000)를 따로 갖고 있어서 CHAT_REPLY
  // 계열과 판단 기준이 두 곳으로 쪼개져 있었다(#186 리뷰에서 지적됨).
  // "판단 기준은 한 곳"이라는 이 파일의 원칙 1은 지키되, profile-assistant
  // 는 멀티필드 STATE 추적 + 구조화 출력이라 메인 채팅보다 원래 더 무거운
  // 예산이 필요했던 것(#180에서 실측 튜닝된 값)이라 CHAT_REPLY와 값 자체를
  // 억지로 통일하지는 않는다 — 대신 resolveChatBudget()의 purpose 인자로
  // "판단은 한 곳, 값은 용도별"을 함께 만족시킨다.
  PROFILE_REPLY:     1200,
  PROFILE_REPLY_PRO: 6000,

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

/**
 * resolveChatBudget(modelName, purpose = 'chat') — 2026-0X-XX 신설,
 * 2026-0X-XX purpose 인자 추가(#186 리뷰).
 * 호출부가 candidate의 model 문자열만 보고 "이번 시도가 hondi-pro인지"를
 * 판단해 알맞은 예산을 고른다. 호출부에 삼항연산자를 반복해서 흩뿌리는
 * 대신 이 파일 한 곳에서만 판단 기준(hondi-pro 문자열 비교)을 갖는다
 * (원칙 1과 동일한 이유). purpose로 "메인 채팅"과 "profile-assistant"를
 * 구분하는 건 — 둘 다 hondi-pro 여부는 같은 기준으로 판단하지만, 값 자체는
 * 용도별로 다를 수 있기 때문이다(profile-assistant는 멀티필드 STATE 추적
 * 이라 메인 채팅보다 원래 더 무거움, #180에서 실측 튜닝). 새 purpose가
 * 필요하면 여기에 분기를 추가한다 — 호출부가 자기만의 삼항연산자를 새로
 * 만들지 않는다.
 */
export function resolveChatBudget(modelName, purpose = 'chat') {
  const isPro = modelName === 'hondi-pro';
  if (purpose === 'profile') {
    return isPro ? TOKEN_BUDGET.PROFILE_REPLY_PRO : TOKEN_BUDGET.PROFILE_REPLY;
  }
  return isPro ? TOKEN_BUDGET.CHAT_REPLY_PRO : TOKEN_BUDGET.CHAT_REPLY;
}

// ── 모델 정책 ──────────────────────────────────────────────────────────
// 분류·요약·감시처럼 "사용자가 직접 읽고 평가하지 않는" 보조 작업 전용 모델.
// 사용자가 ai-setup-mobile.html에서 고른 CFG.model과 무관하게 항상 이 값을
// 쓴다 — 그래야 사용자가 고가 모델(Claude/GPT 등)을 메인으로 설정해도,
// 백그라운드 보조 작업이 매번 그 비싼 모델을 따라 호출하지 않는다.
export const FAST_MODEL = 'deepseek-v4-flash';

/**
 * resolveOrchestrationModel(tagType) — 2026-08-05 신설
 * (HANDOFF_2026-08-05_live-smoketest-latency-and-empty-content.md §4-2)
 *
 * 배경: _handleOrchestrationTags(call-ai.js)의 모든 sendFn(=callAI) 재호출이
 * 지금까지 모델 override 없이 CFG.model(hondi-pro 고정, v4.0 설계)을 그대로
 * 물려받아, 오케스트레이션 체인의 모든 홉(AC 판단→K-Intent→K-Compose→
 * K-Execute→K-Deliver, 그리고 그 사이 재주입 턴)이 전부 hondi-pro(thinking
 * 켜짐)로, 그것도 순차 실행돼 5분+ 지연이 실측됐다.
 *
 * 원칙(이 파일 원칙 2·3과 동일): "단순 분기·재주입 소비" — worker.js/API
 * 조회 결과를 받아 그대로 다음 STEP으로 이어받는 턴 — 는 사용자가 직접
 * 평가하는 최종 판단이 아니므로 hondi-flash. "진짜 판단"(신규 계획 수립,
 * 최종 답 합성, SP 간 위임 전환처럼 상대 SP가 처음부터 새로 사고해야 하는
 * 턴)만 hondi-pro를 유지한다. 판단 기준은 이 함수 하나에서만 갖는다 —
 * 호출부(_handleOrchestrationTags)에 삼항연산자를 흩뿌리지 않는다.
 *
 * tagType은 _handleOrchestrationTags 안에서 sendFn(...)을 호출하기 직전의
 * 문맥(어떤 결과를 재주입하는지)을 그대로 넘긴다. 모르는 tagType은 안전
 * 쪽으로 기울어 hondi-pro를 반환한다(보수적 기본값 — #180류 결함은
 * "너무 싼 모델을 씀"이 아니라 "예산 부족"이 원인이었으므로, 분류를
 * 잘못했을 때의 비용은 "느림"이지 "틀림"이 아니다).
 */
const _ORCHESTRATION_FLASH_TAGS = new Set([
  'PROCEDURE_MAP_LOOKUP_RESULT',
  'PROCEDURE_MAP_UPDATE_RESULT',
  'PROCEDURE_MAP_DRAFT_RESULT',
  'BENEFIT_SEMANTIC_SEARCH_RESULT',
  'BENEFIT_CANDIDATE_SEARCH_RESULT',
  'CALL_GOVSYS_RESULT',
  'CALL_GOVTREE_RESULT',
  'GWP_REGISTRY_SEARCH_RESULT',
  'GOV_SP_DRAFT_REQUEST_RESULT',
  'SP_DRAFT_REQUEST_RESULT',
  'ESCALATE_RESULT',
]);

export function resolveOrchestrationModel(tagType) {
  return _ORCHESTRATION_FLASH_TAGS.has(tagType) ? 'hondi-flash' : 'hondi-pro';
}
