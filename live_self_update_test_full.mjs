// live_self_update_test_full.mjs
// ═══════════════════════════════════════════════════
// live_self_update_test.mjs의 확장판 — 1~2단계(수집·정규식 필터)에 더해
// 3단계(AI 분류·추출, DeepSeek API)까지 실제로 돌린다. GitHub Actions
// 워크플로(.github/workflows/regulation-pipeline-live-test.yml)에서
// DEEPSEEK_API_KEY 시크릿을 주입받아 실행하는 것을 전제로 작성했다.
//
// 로컬 실행 시: DEEPSEEK_API_KEY 환경변수를 직접 설정하고 실행 가능.
//   $env:DEEPSEEK_API_KEY = "sk-..."; node live_self_update_test_full.mjs
// ═══════════════════════════════════════════════════

import { createLawApiClient } from './src/gopang/gov/regulation-pipeline/law-api-client.js';
import { classifyRegulation, extractChecklistItems, passesRegexFilter } from './src/gopang/gov/regulation-pipeline/regulation-classifier-extractor.js';
import { enqueueForReview } from './src/gopang/gov/regulation-pipeline/review-gate-and-drift.js';
import { createDeepSeekCaller } from './deepseek-client.mjs';

const OC_ID = 'openhash';
const TARGET_INSTITUTION = '행정중심복합도시건설청';
const TARGET_DIVISION_CODE = 'URBANPLANNING';
const TARGET_DIVISION_NAME = '도시계획국';

async function main() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.error('DEEPSEEK_API_KEY 환경변수가 없습니다. GitHub Actions secret 또는 로컬 환경변수로 설정하세요.');
    process.exit(1);
  }
  const callDeepSeek = createDeepSeekCaller(apiKey);

  console.log(`=== 3단계 포함 실시간 자기갱신 테스트: ${TARGET_INSTITUTION} ${TARGET_DIVISION_NAME} ===\n`);

  // ── 1단계: 수집 ──
  const client = createLawApiClient(OC_ID);
  console.log(`[1단계: 수집] law.go.kr에서 "${TARGET_INSTITUTION}" 검색 중...`);
  const regulations = await client.searchAdminRulesByInstitutionNameFallback(TARGET_INSTITUTION, { display: 50 });
  console.log(`수집: ${regulations.length}건\n`);
  regulations.forEach(r => console.log(`  - [${r.행정규칙종류}] ${r.행정규칙명} (발령 ${r.발령일자})`));

  if (regulations.length === 0) {
    console.log('\n수집된 규정이 없어 이후 단계를 진행할 수 없습니다.');
    return;
  }

  // ── 2~3단계: 각 규정 본문을 실제로 가져와 AI 분류·추출 ──
  console.log(`\n[2~3단계: 본문 조회 + AI 분류·추출] (DeepSeek API 사용)\n`);
  const allReviewItems = [];
  const stats = { fetched: 0, regexPassed: 0, aiProcedural: 0, extracted: 0, errors: 0 };

  // 비용·시간 절약을 위해 최대 15건만 실제 본문까지 조회(전수는 배포 시 배치로).
  // 2026-08-16 첫 실행 결과: 5건일 때는 알파벳순 상위 5건이 전부 인사·감사·
  // 서무 규정이라 정규식 필터를 하나도 통과 못 해 DeepSeek 호출까지 못 갔음
  // — 15건으로 늘려 "민원사무처리 규정" 등 절차 규정이 포함될 확률을 높임.
  for (const reg of regulations.slice(0, 15)) {
    try {
      console.log(`--- "${reg.행정규칙명}" 처리 중 ---`);
      const text = await client.fetchAdminRuleText(reg.행정규칙일련번호 || reg.행정규칙ID);
      stats.fetched++;

      // 디버그: 처음 3건만 본문 실물을 눈으로 확인(전체 로그 도배 방지).
      // 2026-08-16 15건 전부 정규식 미통과 원인 진단용 — HTML 마크업이
      // 섞여서 텍스트 패턴이 안 걸리는 건지, 정말 절차 어휘가 없는
      // 기관인지(NAACC는 형사수사 절차 어휘 위주 필터와 안 맞을 수 있음)
      // 확인해야 다음 조치(정규식 확장 vs 대상 기관 변경)를 정할 수 있다.
      if (stats.fetched <= 3) {
        const snippet = text.slice(0, 400).replace(/\s+/g, ' ').trim();
        console.log(`  [디버그] 본문 길이: ${text.length}자`);
        console.log(`  [디버그] 앞부분: ${snippet}`);
      }

      const regexHit = passesRegexFilter(text);
      console.log(`  정규식 1차 필터: ${regexHit ? '통과(AI 판별로)' : '미통과(제외)'}`);
      if (!regexHit) continue;
      stats.regexPassed++;

      const classification = await classifyRegulation(text, callDeepSeek);
      console.log(`  AI 분류: is_procedural=${classification.is_procedural}, 근거="${classification.reason}"`);
      if (!classification.is_procedural) continue;
      stats.aiProcedural++;

      const items = await extractChecklistItems(text, TARGET_INSTITUTION, callDeepSeek);
      console.log(`  AI 추출: ${items.length}개 절차 항목`);
      items.forEach(it => console.log(`    · ${it.item} (근거: ${it.legal_basis})`));
      stats.extracted += items.length;

      if (items.length > 0) {
        const queued = enqueueForReview(items, {
          기관코드: 'NAACC',
          division_code: TARGET_DIVISION_CODE,
          source_regulation_id: reg.행정규칙ID || reg.행정규칙일련번호,
          source_regulation_name: reg.행정규칙명,
        });
        allReviewItems.push(...queued);
      }
    } catch (e) {
      console.error(`  오류: ${e.message}`);
      stats.errors++;
    }
    console.log('');
  }

  // ── 결과 요약 ──
  console.log(`=== 최종 통계 ===`);
  console.log(JSON.stringify(stats, null, 2));
  console.log(`\n=== 검수 대기 큐(사람 승인 전, status=pending_review) ===`);
  console.log(JSON.stringify(allReviewItems, null, 2));

  console.log(`\n=== 정직하게 밝힘 ===`);
  console.log(`위 검수 대기 큐는 인간(팀장급)의 review-gate-and-drift.js applyReviewDecision()`);
  console.log(`승인 없이는 실제 division SP §ANNEX에 반영되지 않는다(C4 원칙). 이 스크립트는`);
  console.log(`"AI가 실시간으로 근거 법령을 끌어와 추출까지 할 수 있는가"만 검증하며, 그 결과를`);
  console.log(`실제로 SP에 반영하는 것까지는 하지 않는다 — 그건 별도의 인간 승인 단계다.`);
}

main().catch(e => {
  console.error('테스트 실행 중 치명적 오류:', e);
  process.exit(1);
});
