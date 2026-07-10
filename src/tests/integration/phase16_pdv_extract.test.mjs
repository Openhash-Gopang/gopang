/**
 * phase16_pdv_extract.test.mjs
 *
 * PDV 정정 반영 — "PDV는 과거 상호작용 요약으로부터 고정 필드를 가진
 * 테이블을 추출한다"는 주된 용도를 실제로 구현한 src/gopang/pdv/
 * extract.js 검증. 순수 ESM 모듈이라(window 의존은 있지만 opts.pdvStore
 * 주입으로 우회 가능) 바로 import해서 테스트한다.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractFields, formatFieldsForConfirmation } from '../../gopang/pdv/extract.js';

const INCOME_FIELDS = [
  { key: 'income_monthly', label: '월소득', hint: '원 단위 숫자' },
  { key: 'household_size', label: '가구원수', hint: '명 단위 숫자' },
];

function makePdvStore(records) {
  return {
    list: async () => records,
    listByCategory: async (cat) => records.filter(r => r.category === cat),
  };
}

describe('N-42: extractFields — 필드 요청/응답 정확 대조', () => {
  it('요청한 필드만큼, 요청한 키로 정확히 반환(LLM이 여분/누락을 내도 정규화)', async () => {
    const pdvStore = makePdvStore([{ summary: 'K-Tax 상담 중 월급 250만원이라고 언급', ts: Date.now() }]);
    const callLLM = async () => JSON.stringify([
      { key: 'income_monthly', value: 2500000, confidence: 'high', evidence: '월급 250만원' },
      { key: 'unrequested_field', value: '이건 요청 안 함', confidence: 'high' }, // LLM이 여분으로 낸 필드
      // household_size는 LLM이 빠뜨림
    ]);
    const result = await extractFields(INCOME_FIELDS, callLLM, { pdvStore });
    assert.equal(result.length, 2, '요청한 2개 필드만 반환돼야 함(여분 무시)');
    const income = result.find(r => r.key === 'income_monthly');
    assert.equal(income.value, 2500000);
    assert.equal(income.confidence, 'high');
    const household = result.find(r => r.key === 'household_size');
    assert.equal(household.value, null, 'LLM이 빠뜨린 필드는 unknown으로 채워져야 함(임의 추측 금지)');
    assert.equal(household.confidence, 'unknown');
  });

  it('PDV 기록이 아예 없으면 LLM 호출 자체를 안 하고 전부 unknown', async () => {
    let called = false;
    const pdvStore = makePdvStore([]);
    const callLLM = async () => { called = true; return '[]'; };
    const result = await extractFields(INCOME_FIELDS, callLLM, { pdvStore });
    assert.equal(called, false, '빈 기록으로 LLM을 부르면 토큰 낭비이자 지어낼 위험');
    assert.ok(result.every(r => r.confidence === 'unknown'));
  });

  it('pdvStore(window.GopangPDV)가 아예 없으면 에러 대신 전부 unknown', async () => {
    const callLLM = async () => '[]';
    const result = await extractFields(INCOME_FIELDS, callLLM, {}); // pdvStore 미지정, window도 없음(Node 환경)
    assert.ok(result.every(r => r.value === null && r.confidence === 'unknown'));
  });

  it('LLM 응답이 깨진 JSON이어도 예외를 던지지 않고 전부 unknown', async () => {
    const pdvStore = makePdvStore([{ summary: '아무 기록', ts: Date.now() }]);
    const callLLM = async () => '이건 JSON이 아님{{{';
    const result = await extractFields(INCOME_FIELDS, callLLM, { pdvStore });
    assert.ok(result.every(r => r.confidence === 'unknown'));
  });

  it('confidence 값이 이상하면(오타 등) unknown으로 강제 정규화', async () => {
    const pdvStore = makePdvStore([{ summary: '기록', ts: Date.now() }]);
    const callLLM = async () => JSON.stringify([
      { key: 'income_monthly', value: 100, confidence: 'super-sure-maybe' },
    ]);
    const result = await extractFields(INCOME_FIELDS, callLLM, { pdvStore });
    assert.equal(result.find(r => r.key === 'income_monthly').confidence, 'unknown');
  });

  it('callLLMFn이 함수가 아니면 명시적으로 에러', async () => {
    await assert.rejects(() => extractFields(INCOME_FIELDS, 'not-a-function', {}));
  });

  it('fieldSpecs가 비어있으면 빈 배열 즉시 반환(LLM 호출 없음)', async () => {
    let called = false;
    const result = await extractFields([], async () => { called = true; return '[]'; }, {});
    assert.deepEqual(result, []);
    assert.equal(called, false);
  });
});

describe('N-43: extractFields — 카테고리 필터링', () => {
  it('opts.category 지정 시 listByCategory를 씀(list 전체가 아니라)', async () => {
    let usedMethod = null;
    const pdvStore = {
      list: async () => { usedMethod = 'list'; return []; },
      listByCategory: async (cat) => { usedMethod = 'listByCategory:' + cat; return [{ summary: '세금 상담', ts: Date.now() }]; },
    };
    await extractFields(INCOME_FIELDS, async () => '[]', { pdvStore, category: 'ai' });
    assert.equal(usedMethod, 'listByCategory:ai');
  });

  it('opts.category 미지정이면 전체(list)를 씀', async () => {
    let usedMethod = null;
    const pdvStore = {
      list: async () => { usedMethod = 'list'; return []; },
      listByCategory: async () => { usedMethod = 'listByCategory'; return []; },
    };
    await extractFields(INCOME_FIELDS, async () => '[]', { pdvStore });
    assert.equal(usedMethod, 'list');
  });
});

describe('N-44: formatFieldsForConfirmation — 사람 확인용 문장 생성(원칙 강제)', () => {
  it('값이 있으면 confidence와 함께 "맞는지 확인" 문구를 반드시 포함', () => {
    const extracted = [{ key: 'income_monthly', value: 2500000, confidence: 'high', evidence: '월급 250만원' }];
    const [line] = formatFieldsForConfirmation(extracted, INCOME_FIELDS);
    assert.match(line, /월소득/);
    assert.match(line, /2500000/);
    assert.match(line, /확인해 주세요/, '추출값을 그냥 믿고 쓰지 않도록 항상 확인을 요구해야 함');
  });

  it('unknown이면 "직접 입력" 안내로 명확히 구분', () => {
    const extracted = [{ key: 'household_size', value: null, confidence: 'unknown', evidence: null }];
    const [line] = formatFieldsForConfirmation(extracted, INCOME_FIELDS);
    assert.match(line, /직접 입력/);
  });

  it('low confidence는 "불확실" 표시, high는 "확실"(불확실 아님) 표시로 구분', () => {
    const extracted = [
      { key: 'income_monthly', value: 100, confidence: 'high', evidence: 'x' },
      { key: 'household_size', value: 2, confidence: 'low', evidence: 'y' },
    ];
    const [l1, l2] = formatFieldsForConfirmation(extracted, INCOME_FIELDS);
    assert.match(l1, /확실/);
    assert.ok(!l1.includes('불확실'), 'high 등급인데 "불확실"이 섞이면 안 됨');
    assert.match(l2, /불확실/);
  });
});
