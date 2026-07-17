/**
 * @file phase7.js
 * @description AI 비서 Phase 7 — 종합 위법 가능성 판단(2단계, LLM 기반)
 * @version 1.0.0
 * @author AI City Inc.
 *
 * 근거: 2026-07-17 세션 논의(마스터 테스트플랜 E-2 아키텍처 갭 (B))
 *
 * Phase 1~5(regex 기반, 비용 0)는 "알려진 문구 패턴"만 잡는다는 한계가
 * 있다. "이 대화 전체를 보면 위법 가능성이 있어 보이는가"처럼 맥락을
 * 종합해야 하는 판단은 LLM이 필요하고, 그건 실제로 토큰 비용이 든다.
 * 이 파일은 그 비용을 다음 두 가지로 최소화한다:
 *
 *   1) Phase 1~5가 이미 S0(안전)로 판정한 대화는 이 함수를 아예 호출하지
 *      않는다 — 일상 대화·잡담엔 LLM을 전혀 안 쓴다. 즉 "개별 위법
 *      탐지"(1단계, 값싼 스크리너)가 "전반적 위법 가능성 판단"(2단계,
 *      LLM)의 게이트 역할을 한다 — 경쟁 관계가 아니라 이어지는 파이프라인.
 *   2) llmCaller가 주입되지 않으면(운영 환경에서 아직 설정 안 됐거나
 *      테스트 환경) 조용히 skip한다 — 실패가 아니라 정상적인 "미사용"
 *      상태로 취급.
 *
 * 이 함수는 규칙기반 riskResult.level을 직접 낮추지 않는다(하향 없음).
 * LLM이 "더 심각해 보인다"고 판단해도 자동으로 등급을 올려 차단하지
 * 않고 recommendReview 플래그로만 기록한다 — LLM 판단 하나만으로
 * 대화를 막지 않는다는 원칙(패턴 매칭 하나로도 안 막는 원칙과 동일 선상).
 */

const OVERALL_ASSESSMENT_PROMPT =
  '다음은 이미 규칙 기반 필터에서 "확인이 필요한 대화"로 분류된 대화 로그다. ' +
  '개별 법령 위반 패턴이 아니라 대화 전체 맥락에서 종합적인 위법 가능성을 판단하라. ' +
  '알려진 정규식 패턴 밖의 위법(예: 완곡어법, 은어, 암시적 협박)도 함께 고려하되, ' +
  '확신이 낮으면 낮은 점수를 매겨라(과잉 확신 금지). ' +
  'JSON만 출력하라(설명 텍스트 금지). ' +
  '형식: {"likelihood":0.0~1.0, "reasoning":"50자 이내 근거", ' +
  '"categories":["관련 법령 카테고리 문자열들"], "recommend_review":true|false}';

/**
 * @param {string} transcript - "[역할] 발화" 형태로 줄바꿈된 대화 로그
 * @param {{level: string}} ruleBasedResult - Phase 5의 riskResult
 * @param {(args: {systemPrompt: string, userMessage: string}) => Promise<string>} [llmCaller]
 *   - LLM 호출 함수(주입식). 시스템/유저 메시지를 받아 원문 텍스트(JSON 문자열)를
 *     반환해야 한다. 주입 안 하면 이 Phase는 항상 skip된다(운영 미설정 환경 안전장치).
 * @returns {Promise<null | {
 *   skipped: boolean, reason?: string,
 *   overallLikelihood?: number, reasoning?: string,
 *   suggestedCategories?: string[], recommendReview?: boolean,
 * }>}
 */
export async function assessOverallViolation(transcript, ruleBasedResult, llmCaller = null) {
  if (!transcript || !transcript.trim()) return null

  // 핵심 게이트 — 규칙기반이 이미 안전하다고 판단했으면 LLM을 아예 안 부른다.
  if (!ruleBasedResult || ruleBasedResult.level === 'S0') {
    return { skipped: true, reason: 'rule_based_s0' }
  }

  if (typeof llmCaller !== 'function') {
    return { skipped: true, reason: 'llm_caller_not_configured' }
  }

  try {
    const raw = await llmCaller({
      systemPrompt: OVERALL_ASSESSMENT_PROMPT,
      userMessage:  transcript.slice(0, 4000),
    })
    const parsed = JSON.parse(String(raw).replace(/```json|```/g, '').trim())

    return {
      skipped:              false,
      overallLikelihood:    Math.max(0, Math.min(1, Number(parsed.likelihood) || 0)),
      reasoning:            String(parsed.reasoning ?? '').slice(0, 200),
      suggestedCategories:  Array.isArray(parsed.categories) ? parsed.categories.slice(0, 5).map(String) : [],
      recommendReview:      !!parsed.recommend_review,
    }
  } catch (e) {
    console.warn('[Phase7] 종합 판단 실패(무시 — 규칙기반 결과만 사용):', e.message)
    return { skipped: true, reason: 'llm_error', error: e.message }
  }
}
