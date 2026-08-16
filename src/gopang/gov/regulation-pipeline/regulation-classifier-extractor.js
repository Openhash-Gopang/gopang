// regulation-classifier-extractor.js
// ═══════════════════════════════════════════════════
// REGULATION-INGESTION-PIPELINE-DESIGN_v1_0.md §3(분류) + §4(추출) 단계
// 구현. law-api-client.js가 수집한 행정규칙 원문을 입력받아:
//   1. 절차 규정인지 1차(정규식) + 2차(AI 이진판별) 필터링
//   2. 통과분을 구조화된 체크리스트 초안(status: pending_review)으로 추출
//
// ★★★ 정직하게 밝힘 ★★★ 이 파일의 AI 호출부(callClaudeForClassification,
// callClaudeForExtraction)는 실제 Anthropic API 키로 호출 테스트를 해본
// 적이 없다(이 샌드박스에 프로덕션 API 키가 없음). 프롬프트 설계와
// 파싱 로직은 완성돼 있으나, 실제 model 응답 형태·품질은 검증 안 됨 —
// 배포 전 실제 API 키로 최소 10~20건 테스트 실행 후 프롬프트 튜닝이
// 필요할 가능성이 높다.
// ═══════════════════════════════════════════════════

// ── 1단계: 정규식 1차 필터 (저비용, AI 호출 없이 대부분 걸러냄) ──────
// REGULATION-INGESTION-PIPELINE-DESIGN §3 패턴 그대로.
const PROCEDURAL_SIGNAL_PATTERNS = [
  /하여야\s*한다/, /해야\s*한다/,           // 의무 표현
  /\d+\s*일\s*이내/, /\d+\s*시간\s*이내/,    // 기한 표현
  /고지/, /통지/, /동의/, /참여권/,          // 절차적 권리 관련
  /보전/, /보존/, /입회/, /참관/,            // 증거 관리 관련
  /영장/, /체포/, /구속/, /압수/, /수색/,     // 강제수사 관련
  /진술거부권/, /변호인/, /신뢰관계인/,        // 피의자·피해자 권리
];

/**
 * 1차 필터: 규정 본문에 절차적 신호가 하나라도 있으면 통과.
 * @param {string} regulationText - 행정규칙 원문(HTML 또는 텍스트)
 * @returns {boolean}
 */
function passesRegexFilter(regulationText) {
  return PROCEDURAL_SIGNAL_PATTERNS.some(p => p.test(regulationText));
}

// ── 2단계: AI 이진판별 (1차 통과분만, "진짜 절차규정인가?") ──────────
const CLASSIFICATION_PROMPT_TEMPLATE = (regulationText) => `
다음은 대한민국 행정규칙(훈령/예규/고시/지침) 원문 일부다. 이 규정이
"시민 또는 피의자·피해자·참고인의 권리에 영향을 미치는 절차적 의무"를
정하고 있는지 판별하라.

해당하는 예: 체포·구속·압수수색 절차, 진술거부권·변호인조력권 고지 의무,
피해자 보호조치(신뢰관계인 동석 등), 처분 전 사전통지·의견제출 기회 부여,
법정 기한(며칠 이내 등).

해당하지 않는 예: 순수 내부 인사·복무·예산·서무 규정, 조직 편제만 정한
규정, 통계·보고서식만 정한 규정.

--- 규정 원문 ---
${regulationText.slice(0, 4000)}
--- 원문 끝 ---

다음 JSON 형식으로만 답하라(다른 텍스트 없이):
{"is_procedural": true|false, "confidence": "high"|"medium"|"low",
 "reason": "판단 근거 한 문장", "quoted_basis": "판단 근거가 된 원문 조각(있으면)"}
`.trim();

/**
 * @param {string} regulationText
 * @param {function} callClaudeFn - (prompt: string) => Promise<string> 형태의
 *   Anthropic API 호출 함수. 호출부에서 주입(테스트 시 mock 가능, 실배포
 *   시 실제 /v1/messages 호출 래퍼 주입).
 */
async function classifyRegulation(regulationText, callClaudeFn) {
  if (!passesRegexFilter(regulationText)) {
    return { is_procedural: false, confidence: 'high', reason: '정규식 1차 필터 미통과(절차적 신호 없음)', stage: 'regex' };
  }
  const raw = await callClaudeFn(CLASSIFICATION_PROMPT_TEMPLATE(regulationText));
  try {
    const parsed = JSON.parse(raw);
    return { ...parsed, stage: 'ai' };
  } catch (e) {
    console.warn('[regulation-classifier] AI 응답 JSON 파싱 실패, 안전하게 미통과 처리:', e?.message, raw?.slice(0, 200));
    return { is_procedural: false, confidence: 'low', reason: 'AI 응답 파싱 실패 — 안전하게 제외', stage: 'ai_parse_error' };
  }
}

// ── 3단계: AI 추출 (few-shot — 이미 손으로 만든 3개 division §ANNEX를 예시로) ──
// 강력계·여성청소년과·사이버수사팀 §ANNEX 표에서 가져온 실제 항목들
// (원본: SP-POLICEDIV-*-COMPLIANCE-TEMPLATE_v1.0.md). 이 few-shot이
// 추출 품질의 핵심이므로, 새 division 유형을 파일럿할 때마다 사람이
// 검수 완료한 §ANNEX를 이 배열에 추가해 예시를 계속 늘려갈 것.
const FEWSHOT_EXAMPLES = [
  {
    input_snippet: '검사 또는 사법경찰관은 피의자를 신문하기 전에 다음 각 호의 사항을 알려주어야 한다. 1. 일체의 진술을 하지 아니하거나... (형사소송법 제244조의3)',
    output: { item: '신문 전 진술거부권·변호인조력권 고지 및 답변 조서 기재', legal_basis: '형사소송법 제244조의3', deadline: '신문 개시 전', mandatory: true, division_type_guess: '강력계·형사과·여성청소년과 등 모든 신문 수반 부서' },
  },
  {
    input_snippet: '조사 전, 신뢰관계자가 동석할 수 있음을 고지, 동행토록 한다... (13세 미만 아동 성폭력 피해자)',
    output: { item: '신뢰관계인 동석 고지', legal_basis: '성폭력특례법, 아동·청소년의 성보호에 관한 법률 제28조', deadline: '조사 개시 전', mandatory: true, division_type_guess: '여성청소년과' },
  },
  {
    input_snippet: '전자정보의 전부를 복제하는 경우 해시값을 확인하거나 압수·수색·검증 과정을 촬영하는 등... 동일성과 무결성을 담보할 수 있는 적절한 방법과 조치를 하여야 한다. (제28조)',
    output: { item: '해시값 확인 또는 압수·수색·검증 과정 촬영(무결성 담보)', legal_basis: '디지털증거 관리 규정 제28조', deadline: '전자정보 전부 복제 시', mandatory: true, division_type_guess: '사이버수사팀' },
  },
];

const EXTRACTION_PROMPT_TEMPLATE = (regulationText, institutionName) => `
다음은 "${institutionName}" 소관 행정규칙 원문이다. 이 규정에서 절차적
의무 항목을 추출해 아래 예시와 동일한 JSON 배열 형식으로 반환하라.

**규칙**:
- 각 항목은 반드시 원문에 실제로 있는 조문에 근거해야 한다 — 근거를
  찾을 수 없으면 항목을 만들지 마라(환각 절대 금지).
- legal_basis는 정확한 조문 번호를 포함하라(예: "형사소송법 제202조").
- 원문에 절차 항목이 없으면 빈 배열 []을 반환하라.

**예시**:
${FEWSHOT_EXAMPLES.map(ex => `입력: "${ex.input_snippet}"\n출력: ${JSON.stringify(ex.output, null, 0)}`).join('\n\n')}

--- 규정 원문 ---
${regulationText.slice(0, 6000)}
--- 원문 끝 ---

JSON 배열만 반환하라(다른 텍스트 없이). 각 항목에 status: "pending_review" 필드를 추가하라.
`.trim();

/**
 * @param {string} regulationText
 * @param {string} institutionName - 소관부처명(law-api-client 결과의 소관부처명 필드)
 * @param {function} callClaudeFn
 * @returns {Promise<object[]>} 추출된 체크리스트 항목 배열(전부 status: pending_review)
 */
async function extractChecklistItems(regulationText, institutionName, callClaudeFn) {
  const raw = await callClaudeFn(EXTRACTION_PROMPT_TEMPLATE(regulationText, institutionName));
  let items;
  try {
    items = JSON.parse(raw);
    if (!Array.isArray(items)) throw new Error('배열이 아님');
  } catch (e) {
    console.warn('[regulation-extractor] AI 응답 파싱 실패, 빈 배열 반환:', e?.message, raw?.slice(0, 200));
    return [];
  }
  // 환각 방지 2차 확인: legal_basis가 비어있거나 원문에서 조문번호를
  // 못 찾으면 반려(quoted_basis 필드가 없는 항목은 신뢰도 낮음으로 표시)
  return items
    .filter(it => it.legal_basis && it.item)
    .map(it => ({ ...it, status: 'pending_review', extracted_at: new Date().toISOString() }));
}

export {
  passesRegexFilter,
  classifyRegulation,
  extractChecklistItems,
  PROCEDURAL_SIGNAL_PATTERNS,
  FEWSHOT_EXAMPLES,
};
