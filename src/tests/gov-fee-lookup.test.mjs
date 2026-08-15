// gov-fee-lookup.test.mjs — gov_fee_schedule 조회/폴백/승인 로직 검증
// 실행: node src/tests/gov-fee-lookup.test.mjs
//
// PocketBase 실서버 없이, seed 스크립트의 --dry-run 출력(JSON)을 그대로
// in-memory 목 데이터로 사용해 matchServiceName()/resolveGovFee()의 4가지
// 핵심 경로(지역 매칭 성공/전국공통/BASELINE 폴백/매칭 실패)를 검증한다.
//
// ★ 2026-08-15 — 이 테스트가 실제로 잡아낸 버그: 인지세 레코드를 4개
// 문서유형을 한 줄에 나열한 이름으로 만들었더니 키워드 겹침 점수가
// 임계값(0.34)에 근소 미달해 매칭 실패했다. 문서유형별로 레코드를
// 쪼개 해결(tools/gov-fee-seed/scripts/seed_gov_fee_schedule.mjs 참조).
// 이 테스트를 지우지 말 것 — 회귀 방지용.

import assert from 'node:assert';
import { matchServiceName, extractCityCodeFromTrace, resolveGovFee, semanticMatchServiceName } from '../gopang/gov/gov-fee-lookup.js';

// ── 시맨틱 검색(worker.js /gov-fee-semantic-search) mock ────────────
// 2026-08-15 신설 — 실제 Cloudflare Worker/Vectorize 없이 fetch를 가로채서
// semanticMatchServiceName()/resolveGovFee()의 시맨틱 우선 + 키워드 폴백
// 경로를 검증한다. mockSemanticQueue에 순서대로 응답을 채워두면
// /gov-fee-semantic-search 호출마다 하나씩 꺼내 쓴다(호출 순서 = regional
// 먼저, national 그다음 — resolveGovFee 구현 순서와 일치시킬 것).
const _originalFetch = global.fetch;
let mockSemanticQueue = [];
function installSemanticMock() {
  global.fetch = async (url) => {
    const u = new URL(url);
    if (u.pathname === '/gov-fee-semantic-search') {
      const response = mockSemanticQueue.shift() || { status: 'not_found', count: 0, candidates: [] };
      return { ok: true, json: async () => response };
    }
    return _originalFetch(url);
  };
}
function restoreFetch() {
  global.fetch = _originalFetch;
}
const WORKER_URL = 'https://hondi-proxy.example.workers.dev';

// ── 최소 목 레코드 세트 (실제 시드 스크립트 출력 구조를 그대로 축약) ──
const MOCK_RECORDS = [
  {
    service_name: '건축신고',
    service_name_norm: '건축신고',
    scope: 'regional',
    region_code: 'chungnam_cheonan',
    fee_type: 'flat',
    gov_reference_fee_min: 50000,
    gov_reference_fee_max: 1600000,
    formula_json: null,
    gdc_multiplier: 2,
    status: 'REAL',
    source: '천안시 민원사무편람',
  },
  {
    service_name: '인지세(부동산·선박·항공기 소유권이전증서)',
    service_name_norm: '인지세부동산선박항공기소유권이전증서',
    scope: 'national',
    region_code: null,
    fee_type: 'formula',
    gov_reference_fee_min: 0,
    gov_reference_fee_max: 350000,
    formula_json: {
      calc: 'tiered_threshold',
      tiers: [
        { max: 10000000, rate: 0, base: 0 },
        { max: 30000000, rate: 0, base: 20000 },
        { max: 50000000, rate: 0, base: 40000 },
        { max: 100000000, rate: 0, base: 70000 },
        { max: 1000000000, rate: 0, base: 150000 },
        { max: null, rate: 0, base: 350000 },
      ],
    },
    gdc_multiplier: 2,
    status: 'REAL',
    source: '인지세법 제3조',
  },
  {
    service_name: '가설건축물 축조신고',
    service_name_norm: '가설건축물축조신고',
    scope: 'regional',
    region_code: 'chungnam_cheonan',
    fee_type: 'ordinance_ref',
    gov_reference_fee_min: null,
    gov_reference_fee_max: null,
    formula_json: null,
    gdc_multiplier: 2,
    status: 'NEEDS_REVIEW',
    source: '천안시 민원사무편람',
  },
];

function makeMockPb(allRecords) {
  return {
    collection: () => ({
      getFullList: async ({ filter }) => {
        const regionMatch = filter.match(/region_code\s*=\s*"([^"]+)"/g) || [];
        const scopeNational = filter.includes('scope = "national"');
        const regionCodes = regionMatch.map((m) => m.match(/"([^"]+)"/)[1]);
        return allRecords.filter(
          (r) => (regionCodes.length && regionCodes.includes(r.region_code)) || (scopeNational && r.scope === 'national')
        );
      },
    }),
  };
}

const pb = makeMockPb(MOCK_RECORDS);
let failures = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
  } catch (e) {
    failures++;
    console.error(`❌ ${name}`);
    console.error('   ', e.message);
  }
}

await check('extractCityCodeFromTrace — SP-CITY-* 패턴에서 시코드 추출', () => {
  assert.strictEqual(extractCityCodeFromTrace(['JEJU-GOV-COMMON', 'SP-CITY-CHUNGNAM_CHEONAN']), 'chungnam_cheonan');
  assert.strictEqual(extractCityCodeFromTrace([]), null);
});

await check('resolveGovFee — 지역 매칭 성공 (건축신고, 천안)', async () => {
  const r = await resolveGovFee(pb, '건축신고 하려고요', ['SP-CITY-CHUNGNAM_CHEONAN'], {});
  assert.strictEqual(r.status, 'OK');
  assert.strictEqual(r.record.service_name, '건축신고');
  assert.strictEqual(r.govReferenceFee, 50000);
  assert.strictEqual(r.hondiServiceFee, 100000); // 50000 × gdc_multiplier(2)
  assert.strictEqual(r.isBaselineFallback, false);
});

await check('resolveGovFee — 전국공통 인지세 (지역 무관, 구간 계산)', async () => {
  const r = await resolveGovFee(pb, '부동산 소유권이전 인지세 계산해줘', [], { amount: 80000000 });
  assert.strictEqual(r.status, 'OK');
  assert.strictEqual(r.govReferenceFee, 70000); // 5천만~1억 구간
  assert.strictEqual(r.hondiServiceFee, 140000);
});

await check('resolveGovFee — 매칭 지역 없음 → BASELINE 폴백 + 승인 필요', async () => {
  // 제주시(SP-CITY-JEJUSI)에는 해당 레코드가 없으므로 chungnam_cheonan으로 폴백
  const r = await resolveGovFee(pb, '건축신고', ['SP-CITY-JEJUSI'], {});
  assert.strictEqual(r.status, 'NEEDS_APPROVAL');
  assert.strictEqual(r.isBaselineFallback, true);
  assert.strictEqual(r.hondiServiceFee, 100000);
});

await check('resolveGovFee — 조례참조(NEEDS_REVIEW) 레코드는 자동 계산 금지', async () => {
  const r = await resolveGovFee(pb, '가설건축물 축조신고 하려고요', ['SP-CITY-CHUNGNAM_CHEONAN'], {});
  // NEEDS_REVIEW 레코드는 REAL 필터에 안 걸리므로 매칭 자체가 안 되어 NOT_FOUND가 정상
  assert.strictEqual(r.status, 'NOT_FOUND');
});

await check('resolveGovFee — 완전히 무관한 발화는 NOT_FOUND', async () => {
  const r = await resolveGovFee(pb, '오늘 날씨 어때', [], {});
  assert.strictEqual(r.status, 'NOT_FOUND');
});

// ── 시맨틱 검색 경로 테스트 ──────────────────────────────────────
installSemanticMock();

await check('semanticMatchServiceName — 정상 후보 반환 (score 임계값 이상)', async () => {
  mockSemanticQueue = [{
    status: 'matched_list', count: 1,
    candidates: [{ service_name: '건축신고', region_code: 'chungnam_cheonan', scope: 'regional',
      fee_type: 'flat', gov_reference_fee_min: 50000, gdc_multiplier: 2, status: 'REAL', score: 0.91 }],
  }];
  const r = await semanticMatchServiceName(WORKER_URL, '건축신고 하려고요', { regionCode: 'chungnam_cheonan' });
  assert.ok(r);
  assert.strictEqual(r.service_name, '건축신고');
});

await check('semanticMatchServiceName — score 낮으면 null(오탐 방지 안전장치)', async () => {
  mockSemanticQueue = [{ status: 'matched_list', count: 1, candidates: [{ service_name: '전혀다른민원', score: 0.4 }] }];
  const r = await semanticMatchServiceName(WORKER_URL, '아무말', {});
  assert.strictEqual(r, null);
});

await check('semanticMatchServiceName — workerBaseUrl 없으면 null(그레이스풀 디그레이드)', async () => {
  const r = await semanticMatchServiceName(undefined, '건축신고', {});
  assert.strictEqual(r, null);
});

await check('resolveGovFee — workerBaseUrl 제공 시 시맨틱 우선 사용(matchedBy=semantic)', async () => {
  mockSemanticQueue = [
    { status: 'matched_list', count: 1, candidates: [{ service_name: '건축신고', region_code: 'chungnam_cheonan',
      scope: 'regional', fee_type: 'flat', gov_reference_fee_min: 50000, gdc_multiplier: 2, status: 'REAL', score: 0.9 }] },
    { status: 'not_found', count: 0, candidates: [] },
  ];
  const pbNeverCalled = { collection: () => ({ getFullList: async () => {
    throw new Error('키워드 폴백이 호출되면 안 됨(시맨틱이 이미 찾았어야 함)');
  } }) };
  const r = await resolveGovFee(pbNeverCalled, '건축신고 하려고요', ['SP-CITY-CHUNGNAM_CHEONAN'], {}, { workerBaseUrl: WORKER_URL });
  assert.strictEqual(r.status, 'OK');
  assert.strictEqual(r.matchedBy, 'semantic');
  assert.strictEqual(r.hondiServiceFee, 100000);
});

await check('resolveGovFee — 시맨틱 실패(무응답) 시 키워드로 그레이스풀 디그레이드', async () => {
  mockSemanticQueue = [
    { status: 'not_found', count: 0, candidates: [] },
    { status: 'not_found', count: 0, candidates: [] },
  ];
  const r = await resolveGovFee(pb, '건축신고 하려고요', ['SP-CITY-CHUNGNAM_CHEONAN'], {}, { workerBaseUrl: WORKER_URL });
  assert.strictEqual(r.status, 'OK');
  assert.strictEqual(r.matchedBy, 'keyword');
});

restoreFetch();

if (failures > 0) {
  console.error(`\n${failures}건 실패`);
  process.exit(1);
} else {
  console.log('\n전체 통과');
}
