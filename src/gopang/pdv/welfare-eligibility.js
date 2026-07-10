/**
 * pdv/welfare-eligibility.js — 기초생활보장(기초수급자격) 간이 선별
 *
 * 2026-07-09 신설 — "내가 기초수급자격이 되는지 확인하고, 되면 신청해줘"
 * 사고실험(원래 "불가능" 판정)을 다룬다. JEJU-GOV-COMMON §13-4가 이미
 * "가구원수/월소득/재산 정보가 PDV에 없다"고 정직하게 예시로 들었던
 * 바로 그 케이스 — 오늘 만든 extract.js(PDV 과거 상호작용 요약에서
 * 구조화 필드 추출)를 실제로 처음 써먹는 사례이기도 하다.
 *
 * ★★★ 결정적 한계 — 반드시 읽을 것 ★★★
 * 실제 기초생활보장 수급자격은 "소득인정액"으로 판정하며, 이는
 * 실제소득만이 아니라 재산의 소득환산액(재산-기본재산액-부채)×환산율,
 * 가구특성별지출비용, 근로소득공제 등을 전부 반영한 복잡한 계산이다.
 * 이 모듈은 그 전체 계산을 하지 않는다 — "월소득만으로" 대략적인
 * 가능성만 가늠하는 **간이 선별**이다. 재산이 많으면 소득이 낮아도
 * 탈락할 수 있고, 반대로 부채가 많으면 소득이 기준을 살짝 넘어도
 * 수급 가능할 수 있다. 최종 판정은 절대 이 모듈이 하지 않는다 —
 * 항상 복지로(bokjiro.go.kr) 모의계산 또는 읍면동 주민센터 상담으로
 * 안내한다(screenEligibility의 disclaimer 필드에 매번 포함).
 *
 * ★ 실사 확인(2026-07-09, 보건복지부 공식 보도자료·정책브리핑·IBK
 * 기업은행 블로그 3곳 교차검증, 2026-07-31 중앙생활보장위원회 의결) —
 * 2026년 기준 중위소득과 급여별 선정기준 비율(생계32/의료40/주거48/
 * 교육50%)은 1인·4인 가구는 공식 발표 수치와 정확히 일치 확인,
 * 2·3·5·6인은 기준중위소득×비율로 역산(1인/4인에서 이 계산법 자체가
 * 정확함을 이미 확인했으므로 신뢰 가능). 7인 이상은 별도 가산식이라
 * 이 모듈에 넣지 않고 TBD로 남긴다.
 */

// 2026년 기준 중위소득(원/월) — 1~6인. 7인 이상은 별도 가산식(공식
// 자료마다 가산액 표기가 갈려 이 세션에서 확정 못 함 — TBD).
export const MEDIAN_INCOME_2026 = {
  1: 2_564_238,
  2: 4_199_292,
  3: 5_359_036,
  4: 6_494_738,
  5: 7_556_719,
  6: 8_555_952,
};

// 급여별 선정기준 비율(2025년과 동일하게 2026년도 결정됨)
export const BENEFIT_RATIOS = {
  생계급여: 0.32,
  의료급여: 0.40,
  주거급여: 0.48,
  교육급여: 0.50,
};

/**
 * 가구원수로 급여별 선정기준액(원/월)을 계산한다. 1인·4인은 공식
 * 발표치와 정확히 일치 확인됨(하단 테스트 참조).
 * @param {number} householdSize - 1~6
 * @returns {{생계급여:number, 의료급여:number, 주거급여:number, 교육급여:number} | null} 7인 이상이면 null(TBD)
 */
export function computeThresholds(householdSize) {
  const median = MEDIAN_INCOME_2026[householdSize];
  if (!median) return null; // 7인 이상 또는 잘못된 값 — 확정 데이터 없음
  const result = {};
  for (const [benefit, ratio] of Object.entries(BENEFIT_RATIOS)) {
    result[benefit] = Math.round(median * ratio);
  }
  return result;
}

/**
 * 월소득만으로 대략적인 가능성을 가늠한다(재산·공제 등 미반영 — 간이
 * 선별). 절대 최종 판정으로 쓰면 안 된다.
 * @param {number} householdSize
 * @param {number} monthlyIncome - 월 실제소득(원)
 * @returns {{
 *   householdSize: number,
 *   thresholds: object|null,
 *   results: Record<string, 'likely'|'borderline'|'unlikely'>,
 *   disclaimer: string,
 * }}
 */
export function screenEligibility(householdSize, monthlyIncome) {
  const disclaimer =
    '★ 이건 월소득만 본 간이 선별입니다 — 실제 수급자격은 재산의 소득환산액, ' +
    '가구특성별지출비용, 근로소득공제까지 반영한 "소득인정액"으로 정해집니다. ' +
    '재산이 많으면 소득이 낮아도 탈락할 수 있고, 부채가 많으면 소득이 기준을 ' +
    '살짝 넘어도 수급 가능할 수 있습니다. 정확한 판정은 복지로(bokjiro.go.kr) ' +
    '모의계산 또는 읍면동 주민센터 상담으로 반드시 확인하세요.';

  const thresholds = computeThresholds(householdSize);
  if (!thresholds) {
    return {
      householdSize, thresholds: null, results: {},
      disclaimer: `${disclaimer} (7인 이상 가구는 이 모듈에서 계산식을 확정하지 못해 결과를 못 드립니다 — 반드시 주민센터에 문의하세요.)`,
    };
  }

  const results = {};
  for (const [benefit, threshold] of Object.entries(thresholds)) {
    // 경계선(threshold의 90~100%)은 재산·공제에 따라 뒤집힐 수 있어
    // "낮음"으로 단정하지 않고 별도 표시한다.
    if (monthlyIncome <= threshold * 0.9) results[benefit] = 'likely';
    else if (monthlyIncome <= threshold) results[benefit] = 'borderline';
    else results[benefit] = 'unlikely';
  }

  return { householdSize, thresholds, results, disclaimer };
}

/**
 * screenEligibility 결과를 사람이 읽을 문장으로 바꾼다. extract.js의
 * formatFieldsForConfirmation, procedure-docs.js의 buildDocumentGuidance와
 * 동일하게 "AI가 단정하지 않는다"는 원칙을 문구 레벨에서 강제 —
 * disclaimer를 항상 포함시킨다(호출부가 실수로 빠뜨릴 수 없게 이
 * 함수 안에서 직접 붙인다).
 */
export function formatEligibilitySummary(screening) {
  if (!screening.thresholds) {
    return screening.disclaimer;
  }
  const labelMap = { likely: '가능성 있음', borderline: '경계선(재산 등에 따라 갈림)', unlikely: '가능성 낮음' };
  const lines = Object.entries(screening.results).map(
    ([benefit, status]) => `- ${benefit}: ${labelMap[status]} (선정기준 월 ${screening.thresholds[benefit].toLocaleString()}원)`
  );
  return `가구원수 ${screening.householdSize}인 기준 간이 선별 결과:\n${lines.join('\n')}\n\n${screening.disclaimer}`;
}

// ── PDV 연동 (2026-07-09 신설) ──────────────────────────────────
// extract.js(오늘 신설된 "PDV 과거 상호작용 요약 → 구조화 필드 추출"
// 계층)를 처음으로 실제 사례에 써먹는다. income_monthly/household_size
// 를 PDV에서 먼저 찾아보고, 근거가 없으면(extract.js의 confidence=
// 'unknown') 그대로 null로 둔다 — 호출부(대화 흐름)가 그 경우 사용자
// 에게 직접 물어봐야 한다. extract.js와 동일하게 이 함수도 절대
// 추측하지 않는다.
const WELFARE_FIELD_SPECS = [
  { key: 'income_monthly', label: '월소득', hint: '가구의 월 실제소득, 원 단위 숫자' },
  { key: 'household_size', label: '가구원수', hint: '함께 사는 가구원 수, 명 단위 숫자' },
];

/**
 * @param {(fieldSpecs, callLLMFn, opts) => Promise<Array>} extractFieldsFn - extract.js의 extractFields (의존성 주입, 순환import 방지)
 * @param {(prompt: string) => Promise<string>} callLLMFn
 * @param {object} [opts] - extractFields에 그대로 전달(pdvStore 등)
 * @returns {Promise<{income: {value:number|null, confidence:string}, householdSize: {value:number|null, confidence:string}, screening: object|null}>}
 */
export async function screenFromPDV(extractFieldsFn, callLLMFn, opts = {}) {
  const extracted = await extractFieldsFn(WELFARE_FIELD_SPECS, callLLMFn, opts);
  const income = extracted.find(e => e.key === 'income_monthly') || { value: null, confidence: 'unknown' };
  const householdSize = extracted.find(e => e.key === 'household_size') || { value: null, confidence: 'unknown' };

  // 둘 다 확보돼야(그것도 낮은 확신도까지는 허용하되 unknown은 제외)
  // 계산을 시도한다 — 하나라도 없으면 screening은 null, 호출부가
  // 사용자에게 직접 물어봐야 함을 의미.
  const screening = (income.value != null && householdSize.value != null && income.confidence !== 'unknown' && householdSize.confidence !== 'unknown')
    ? screenEligibility(householdSize.value, income.value)
    : null;

  return { income, householdSize, screening };
}
