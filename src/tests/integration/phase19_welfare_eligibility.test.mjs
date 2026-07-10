/**
 * phase19_welfare_eligibility.test.mjs
 *
 * "내가 기초수급자격이 되는지 확인하고, 되면 신청해줘" 사고실험(원래
 * "불가능" 판정)을 다룬다. src/gopang/pdv/welfare-eligibility.js 검증 —
 * 2026년 기준 중위소득·급여별 선정기준을 실사로 확인한 값과 대조한다.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MEDIAN_INCOME_2026, BENEFIT_RATIOS,
  computeThresholds, screenEligibility, formatEligibilitySummary, screenFromPDV,
} from '../../gopang/pdv/welfare-eligibility.js';

describe('N-63: MEDIAN_INCOME_2026 — 보건복지부 공식 발표치와 교차검증(2026-07-31 의결)', () => {
  it('1인·4인 가구는 공식 보도자료 수치와 정확히 일치', () => {
    assert.equal(MEDIAN_INCOME_2026[1], 2_564_238);
    assert.equal(MEDIAN_INCOME_2026[4], 6_494_738);
  });

  it('2~6인은 정책브리핑·IBK기업은행 블로그 교차검증치와 일치', () => {
    assert.equal(MEDIAN_INCOME_2026[2], 4_199_292);
    assert.equal(MEDIAN_INCOME_2026[3], 5_359_036);
    assert.equal(MEDIAN_INCOME_2026[5], 7_556_719);
    assert.equal(MEDIAN_INCOME_2026[6], 8_555_952);
  });

  it('7인 이상은 별도 가산식이라 이 테이블에 없음(TBD로 정직하게 남김)', () => {
    assert.equal(MEDIAN_INCOME_2026[7], undefined);
  });
});

describe('N-64: BENEFIT_RATIOS — 2025년과 동일하게 결정된 4개 비율', () => {
  it('생계32/의료40/주거48/교육50%', () => {
    assert.deepEqual(BENEFIT_RATIOS, { 생계급여: 0.32, 의료급여: 0.40, 주거급여: 0.48, 교육급여: 0.50 });
  });
});

describe('N-65: computeThresholds — 공식 발표된 선정기준액과 정확히 일치(핵심 검증)', () => {
  it('1인 가구: 생계82만556/의료102만5695/주거123만834/교육128만2119원', () => {
    assert.deepEqual(computeThresholds(1), {
      생계급여: 820_556, 의료급여: 1_025_695, 주거급여: 1_230_834, 교육급여: 1_282_119,
    });
  });

  it('4인 가구: 생계207만8316/의료259만7895/주거311만7474/교육324만7369원', () => {
    assert.deepEqual(computeThresholds(4), {
      생계급여: 2_078_316, 의료급여: 2_597_895, 주거급여: 3_117_474, 교육급여: 3_247_369,
    });
  });

  it('2·3·5·6인도 계산 가능(1·4인에서 계산법 정확성이 이미 확인됐으므로 신뢰)', () => {
    const t2 = computeThresholds(2);
    assert.equal(t2['생계급여'], Math.round(4_199_292 * 0.32));
    const t6 = computeThresholds(6);
    assert.equal(t6['교육급여'], Math.round(8_555_952 * 0.5));
  });

  it('7인 이상이나 0/음수는 null(확정 데이터 없음을 정직하게 반환)', () => {
    assert.equal(computeThresholds(7), null);
    assert.equal(computeThresholds(0), null);
    assert.equal(computeThresholds(-1), null);
  });
});

describe('N-66: screenEligibility — 간이 선별(재산·공제 미반영 명시)', () => {
  it('소득이 생계급여 기준의 90% 이하면 likely', () => {
    // 1인 생계급여 기준 820,556원의 90% = 738,500.4원 → 700,000원은 확실히 이하
    const result = screenEligibility(1, 700_000);
    assert.equal(result.results['생계급여'], 'likely');
  });

  it('소득이 기준의 90~100% 사이면 borderline(재산에 따라 갈릴 수 있음을 인정)', () => {
    // 1인 생계급여 기준 820,556원의 95% ≈ 779,528원
    const result = screenEligibility(1, 800_000);
    assert.equal(result.results['생계급여'], 'borderline');
  });

  it('소득이 기준 초과면 unlikely', () => {
    const result = screenEligibility(1, 2_000_000);
    assert.equal(result.results['생계급여'], 'unlikely');
    assert.equal(result.results['의료급여'], 'unlikely'); // 102만5695원도 초과
  });

  it('4개 급여를 동시에 평가 — 소득이 생계/의료는 넘지만 교육급여 기준(50%)은 안 넘을 수 있음', () => {
    // 1인 가구, 월소득 120만원: 생계(82만556) 초과, 의료(102만5695) 초과,
    // 주거(123만834) 이하, 교육(128만2119) 이하
    const result = screenEligibility(1, 1_200_000);
    assert.equal(result.results['생계급여'], 'unlikely');
    assert.equal(result.results['의료급여'], 'unlikely');
    assert.notEqual(result.results['주거급여'], 'unlikely', '생계/의료는 탈락해도 주거/교육급여는 살아있을 수 있음 — 단일 판정으로 뭉개면 안 됨');
  });

  it('모든 결과에 disclaimer가 항상 포함됨(재산/공제 미반영 명시 — 핵심 안전장치)', () => {
    const result = screenEligibility(2, 1_000_000);
    assert.match(result.disclaimer, /소득인정액/);
    assert.match(result.disclaimer, /재산/);
    assert.match(result.disclaimer, /복지로/);
    assert.match(result.disclaimer, /주민센터/);
  });

  it('7인 이상이면 계산 없이 disclaimer만 반환(결과 없음을 정직하게 알림)', () => {
    const result = screenEligibility(7, 1_000_000);
    assert.equal(result.thresholds, null);
    assert.deepEqual(result.results, {});
    assert.match(result.disclaimer, /7인 이상/);
  });
});

describe('N-67: formatEligibilitySummary — disclaimer를 호출부가 빠뜨릴 수 없게 항상 포함', () => {
  it('정상 결과 — 4개 급여 상태 + disclaimer 전부 포함', () => {
    const screening = screenEligibility(1, 700_000);
    const text = formatEligibilitySummary(screening);
    assert.match(text, /생계급여/);
    assert.match(text, /의료급여/);
    assert.match(text, /주거급여/);
    assert.match(text, /교육급여/);
    assert.match(text, /가능성 있음|경계선|가능성 낮음/);
    assert.match(text, /소득인정액/, 'disclaimer가 함수 안에서 강제로 붙어야 함 — 호출부가 실수로 빠뜨릴 수 없게');
  });

  it('7인 이상(계산 불가) — disclaimer만 그대로 반환', () => {
    const screening = screenEligibility(8, 1_000_000);
    const text = formatEligibilitySummary(screening);
    assert.match(text, /7인 이상/);
  });

  it('금액이 천단위 구분 기호로 표시됨(가독성)', () => {
    const screening = screenEligibility(1, 700_000);
    const text = formatEligibilitySummary(screening);
    assert.match(text, /820,556원/);
  });
});

describe('N-68: screenFromPDV — extract.js 연동(오늘 신설된 추출계층을 처음 실사용)', () => {
  it('income/household_size 둘 다 confidence 있게 추출되면 screening 계산됨', async () => {
    const mockExtractFields = async (fieldSpecs) => fieldSpecs.map(f => {
      if (f.key === 'income_monthly') return { key: f.key, value: 700_000, confidence: 'high', evidence: '월급 70만원' };
      if (f.key === 'household_size') return { key: f.key, value: 1, confidence: 'high', evidence: '혼자 산다' };
      return { key: f.key, value: null, confidence: 'unknown', evidence: null };
    });
    const result = await screenFromPDV(mockExtractFields, async () => '[]', {});
    assert.equal(result.income.value, 700_000);
    assert.equal(result.householdSize.value, 1);
    assert.ok(result.screening, 'PDV에서 둘 다 확보되면 screening을 바로 계산해야 함');
    assert.equal(result.screening.results['생계급여'], 'likely');
  });

  it('둘 중 하나라도 unknown이면 screening은 null(사용자에게 직접 물어봐야 함을 의미)', async () => {
    const mockExtractFields = async (fieldSpecs) => fieldSpecs.map(f => {
      if (f.key === 'income_monthly') return { key: f.key, value: 700_000, confidence: 'high' };
      return { key: f.key, value: null, confidence: 'unknown' }; // household_size 못 찾음
    });
    const result = await screenFromPDV(mockExtractFields, async () => '[]', {});
    assert.equal(result.screening, null);
  });

  it('WELFARE_FIELD_SPECS로 income_monthly/household_size 두 필드만 요청함(정확한 스펙 확인)', async () => {
    let capturedSpecs = null;
    const mockExtractFields = async (fieldSpecs) => { capturedSpecs = fieldSpecs; return []; };
    await screenFromPDV(mockExtractFields, async () => '[]', {});
    const keys = capturedSpecs.map(f => f.key);
    assert.deepEqual(keys, ['income_monthly', 'household_size']);
  });
});
