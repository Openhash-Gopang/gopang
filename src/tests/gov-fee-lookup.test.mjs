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
    id: 'rec_construction_cheonan',
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
    id: 'rec_temp_structure_needs_review',
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
  {
    id: 'rec_construction_baseline',
    // 2026-08-15 신설 — 지역 중립 BASELINE. 천안시 데이터를 그대로 복제한
    // 것이지만 region_code는 'baseline'이라는 별도 태그를 쓴다(실제 시코드가
    // 아님). 제주시처럼 아직 자기 데이터가 없는 지역의 폴백 대상이 정확히
    // 이 태그를 쓰는지 검증하기 위한 레코드.
    service_name: '건축신고',
    service_name_norm: '건축신고',
    scope: 'regional',
    region_code: 'baseline',
    fee_type: 'flat',
    gov_reference_fee_min: 50000,
    gov_reference_fee_max: 1600000,
    formula_json: null,
    gdc_multiplier: 2,
    status: 'REAL',
    source: '천안시 민원사무편람 (BASELINE)',
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
      // 2026-08-15 신설 — options.cachedRecordId 경로 테스트용. 실제
      // PocketBase SDK의 pb.collection(x).getOne(id) 계약을 흉내 낸다:
      // 없으면 예외를 던진다(진짜 SDK와 동일하게).
      getOne: async (id) => {
        const record = allRecords.find((r) => r.id === id);
        if (!record) throw new Error(`mock getOne: id '${id}' 없음`);
        return record;
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
  // 제주시(SP-CITY-JEJUSI)에는 해당 레코드가 없으므로 region_code='baseline'으로 폴백
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

// ── 2026-08-15 신설 — options.cityCode 우회 경로 (handleGovTaskSubmit처럼
// trace 배열이 아예 없고 지역코드만 직접 아는 호출부를 위함) ────────────
await check('resolveGovFee — options.cityCode가 trace 없이도 지역 매칭 성공', async () => {
  // trace를 빈 배열로 줘서(=trace로는 지역을 못 뽑음) options.cityCode만으로
  // 매칭되는지 확인. trace만 있고 cityCode가 없는 케이스는 위 기존 테스트가
  // 이미 커버하므로, 여기선 반대 방향(cityCode만 있고 trace 없음)을 검증한다.
  const r = await resolveGovFee(pb, '건축신고 하려고요', [], {}, { cityCode: 'chungnam_cheonan' });
  assert.strictEqual(r.status, 'OK');
  assert.strictEqual(r.record.region_code, 'chungnam_cheonan');
  assert.strictEqual(r.isBaselineFallback, false);
});

await check('resolveGovFee — options.cityCode가 trace보다 우선한다', async () => {
  // trace는 제주(레코드 없음)를 가리키지만 cityCode를 천안으로 명시하면
  // cityCode가 이겨야 한다 — 명시적으로 준 값이 trace 파싱 결과를 덮어써야
  // 호출부가 "내가 이미 아는 지역"을 신뢰할 수 있다.
  const r = await resolveGovFee(pb, '건축신고 하려고요', ['SP-CITY-JEJUSI'], {}, { cityCode: 'chungnam_cheonan' });
  assert.strictEqual(r.status, 'OK');
  assert.strictEqual(r.isBaselineFallback, false);
});

// ── 2026-08-15 신설 — (agency,task_key)→gov_fee_schedule.id 매핑 캐시
// (options.cachedRecordId) 경로 검증 ────────────────────────────────
await check('resolveGovFee — cachedRecordId 적중 시 검색을 건너뛰고 즉시 계산(matchedBy=cache)', async () => {
  const pbNeverSearched = {
    collection: () => ({
      getFullList: async () => { throw new Error('캐시 적중 시엔 getFullList가 호출되면 안 됨'); },
      getOne: async (id) => MOCK_RECORDS.find((r) => r.id === id),
    }),
  };
  const r = await resolveGovFee(pbNeverSearched, '아무 발화(무관해도 캐시가 이김)', [], {}, { cachedRecordId: 'rec_construction_cheonan' });
  assert.strictEqual(r.status, 'OK');
  assert.strictEqual(r.matchedBy, 'cache');
  assert.strictEqual(r.hondiServiceFee, 100000);
  assert.strictEqual(r.isBaselineFallback, false);
});

await check('resolveGovFee — cachedRecordId가 BASELINE 레코드를 가리켜도 승인 필요는 유지된다', async () => {
  // 캐시가 검색 자체는 건너뛰게 해주지만, "BASELINE 추정치는 승인 필요"라는
  // 안전 원칙 자체를 우회시켜서는 안 된다 — 레코드가 REAL이어도 region_code가
  // baseline이면 여전히 NEEDS_APPROVAL이어야 한다.
  const r = await resolveGovFee(pb, '건축신고', [], {}, { cachedRecordId: 'rec_construction_baseline' });
  assert.strictEqual(r.status, 'NEEDS_APPROVAL');
  assert.strictEqual(r.matchedBy, 'cache');
  assert.strictEqual(r.isBaselineFallback, true);
});

await check('resolveGovFee — cachedRecordId가 없는 id를 가리키면(삭제됨) 일반 검색으로 폴백', async () => {
  const r = await resolveGovFee(pb, '건축신고 하려고요', ['SP-CITY-CHUNGNAM_CHEONAN'], {}, { cachedRecordId: 'rec_does_not_exist' });
  assert.strictEqual(r.status, 'OK');
  assert.strictEqual(r.matchedBy, 'keyword'); // 캐시 미스 → 정상 검색 경로(workerBaseUrl 없으니 키워드)
});

await check('resolveGovFee — cachedRecordId가 더 이상 REAL이 아니면(재분류됨) 일반 검색으로 폴백', async () => {
  const r = await resolveGovFee(pb, '가설건축물 축조신고 하려고요', ['SP-CITY-CHUNGNAM_CHEONAN'], {}, { cachedRecordId: 'rec_temp_structure_needs_review' });
  // 캐시가 가리키는 레코드가 NEEDS_REVIEW로 바뀌어 있어 캐시 무효 → 폴백한
  // 일반 검색도 REAL 필터에 걸려 결국 NOT_FOUND(기존 회귀 테스트와 동일 결론).
  assert.strictEqual(r.status, 'NOT_FOUND');
});

restoreFetch();

if (failures > 0) {
  console.error(`\n${failures}건 실패`);
  process.exit(1);
} else {
  console.log('\n전체 통과');
}
