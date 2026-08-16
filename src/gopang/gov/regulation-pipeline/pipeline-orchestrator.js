// pipeline-orchestrator.js
// ═══════════════════════════════════════════════════
// REGULATION-INGESTION-PIPELINE-DESIGN_v1_0.md 5단계 전체를 엮는
// end-to-end 오케스트레이터. 기관명 하나를 입력받아 "검수 대기 큐"까지
// 만드는 게 이 파일의 종착점이다 — 그 이후(4단계 인간승인, 5단계 실제
// §ANNEX 반영)는 사람이 개입해야 하므로 이 함수가 자동으로 하지 않는다.
//
// ★ 정직하게 밝힘 ★ 이 오케스트레이터 자체는 라이브 환경(law.go.kr
// 실제 API + 실제 Claude API)에서 실행해본 적이 없다. 아래 mock 기반
// 테스트로 각 단계 간 데이터 전달(인터페이스)이 맞는지만 확인했다.
// ═══════════════════════════════════════════════════

import { createLawApiClient } from './law-api-client.js';
import { classifyRegulation, extractChecklistItems } from './regulation-classifier-extractor.js';
import { enqueueForReview } from './review-gate-and-drift.js';

/**
 * 기관 하나에 대해 1~3단계(수집→분류→추출)를 전부 실행하고, 4단계
 * 진입 직전 상태(검수 대기 큐)까지 만든다.
 *
 * @param {object} opts
 * @param {string} opts.institutionName - 소관부처명(예: "경찰청")
 * @param {string} opts.ocId - law.go.kr OC 사용자 ID
 * @param {function} opts.callClaudeFn - Anthropic API 호출 함수(문자열 프롬프트 → 문자열 응답)
 * @param {number} [opts.maxRegulations] - 처리할 최대 규정 수(비용 제한용, 기본 20)
 * @returns {Promise<{stats: object, reviewQueue: object[]}>}
 */
async function runPipelineForInstitution({ institutionName, ocId, callClaudeFn, maxRegulations = 20 }) {
  const client = createLawApiClient(ocId);
  const stats = { collected: 0, regexPassed: 0, aiClassifiedProcedural: 0, extracted: 0, errors: [] };

  let regulations;
  try {
    regulations = await client.searchAdminRulesByInstitutionNameFallback(institutionName, { display: maxRegulations });
  } catch (e) {
    stats.errors.push({ stage: 'collect', message: e.message });
    return { stats, reviewQueue: [] };
  }
  stats.collected = regulations.length;

  const reviewQueue = [];
  for (const reg of regulations.slice(0, maxRegulations)) {
    try {
      const text = await client.fetchAdminRuleText(reg.행정규칙ID || reg.행정규칙일련번호);
      const classification = await classifyRegulation(text, callClaudeFn);
      if (classification.stage !== 'regex') stats.regexPassed++; // regex 통과해서 AI까지 간 것
      if (!classification.is_procedural) continue;
      stats.aiClassifiedProcedural++;

      const items = await extractChecklistItems(text, institutionName, callClaudeFn);
      stats.extracted += items.length;
      if (items.length === 0) continue;

      const queued = enqueueForReview(items, {
        기관코드: null, // 호출부에서 institutionName→기관코드 매핑(§6-1~8 레지스트리) 후 채울 것
        institutionName,
        division_code: null, // items[].division_type_guess를 참고해 사람이 매핑
        source_regulation_id: reg.행정규칙ID || reg.행정규칙일련번호,
        source_regulation_name: reg.행정규칙명,
      });
      reviewQueue.push(...queued);
    } catch (e) {
      stats.errors.push({ stage: 'per-regulation', regulation: reg.행정규칙명, message: e.message });
    }
  }

  return { stats, reviewQueue };
}

export { runPipelineForInstitution };
