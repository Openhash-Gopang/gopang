#!/usr/bin/env node
/**
 * live-national-agency-smoketest.mjs
 *
 * 2026-08-09 세션(PR #280~#283)에서 넣은 national-agency-master-data.json
 * 151건 + 시/군 단위 다중 지사 분기 인프라 + AC(regional-gov.html) 위치
 * 자체 확보 파이프라인을 실제 네트워크로 검증한다. 자매 스크립트
 * live-gov-router-smoketest.mjs(도청/시청 과·팀 2단계 라우팅)와 동일한
 * 구조·관례를 따르되, 이 스크립트가 검증하는 대상은 국가기관 지사
 * 데이터라 trace 코드만으로는 "도메인 매칭됐다"까지만 확인되고 "그
 * 도의 올바른 지사명이 나왔다"는 확인이 안 된다(entry.code가
 * SP-NAT-{DOMAIN}뿐, 도코드를 안 담음) — 그래서 이 스크립트는 trace
 * 대신 조립된 systemPrompt 본문에서 실제 지사명 마커를 찾는다.
 *
 *   - _fetchText 경로: 실제 raw.githubusercontent.com(mock 없음)
 *   - classifyFn: 사용 안 함(useLLM 없음) — 국가기관 라우팅은 키워드+
 *     시/군 매칭만으로 결정론적이라 LLM 동점 폴백이 애초에 필요 없음
 *     (도청/시청 과·팀 세부매칭과 다른 지점 — 자매 스크립트 헤더 참고)
 *
 * 실행: node tests/live_smoketest/live-national-agency-smoketest.mjs
 * 종료 코드: FAIL 있으면 1, 전부 기대대로면 0.
 */

global.window = {}; // gov-router.js가 top-level에서 window.assembleGovSystemPrompt = ...

const mod = await import('../../src/gopang/gov/gov-router.js');

// expectation:
//   'sp-contains:마커'      → 조립된 systemPrompt에 마커 문자열이 있어야 PASS
//   'honest-fallback'       → 오답(틀린 지사 확정) 없이 정직한 미확정
//                             문구([정보 없음]/관할 확인 필요/지역 미판별)가
//                             있어야 PASS — 이 세션 핵심 원칙(완도해양경찰서
//                             오매칭 사례) 검증용
//   'review'                → 자동판정 안 함, 사람이 raw systemPrompt 확인

const HONEST_FALLBACK_MARKERS = ['정보 없음', '관할 확인 필요', '지역 미판별'];

// ── 1) Phase A/B 국가기관 데이터 HIT — 16개 도 국가기관 지사가 실제로
// 정확한 이름으로 라우팅되는지(도코드당 1건, 안전 통합분) ──────────
const SCENARIOS = [
  ['seoul/국가기관 — 통계청', '서울 통계청 문의', 'sp-contains:경인지방통계청'],
  ['busan/국가기관 — 법원', '부산 지방법원 관할이 어디예요', 'sp-contains:부산지방법원'],
  ['busan/국가기관 — customs FALLBACK', '부산 세관 통관 문의', 'honest-fallback'],
  ['daegu/국가기관 — 통계청', '대구 통계청 문의', 'sp-contains:동북지방통계청'],
  ['daegu/국가기관 — 해양수산청', '대구 해양수산청 항만 문의', 'sp-contains:포항지방해양수산청'],
  ['incheon/국가기관 — 법원', '인천 지방법원 관할', 'sp-contains:인천지방법원'],
  ['incheon/국가기관 — 보훈청', '인천 보훈청 문의', 'sp-contains:인천보훈지청'],
  ['jeonnam-gwangju/국가기관 — 경찰청(도명 인식 필요)', '광주광역시 경찰청 민원', 'sp-contains:광주경찰청'],
  ['daejeon/국가기관 — 법원', '대전 지방법원 관할', 'sp-contains:대전지방법원'],
  ['daejeon/국가기관 — 보훈청', '대전 보훈청 문의', 'sp-contains:대전지방보훈청'],
  ['ulsan/국가기관 — 법원', '울산 지방법원 관할', 'sp-contains:울산지방법원'],
  ['ulsan/국가기관 — 해양수산청', '울산 해양수산청 항만 문의', 'sp-contains:울산지방해양수산청'],
  ['sejong/국가기관 — 보훈청', '세종 보훈청 문의', 'sp-contains:충남동부보훈지청'],
  ['sejong/국가기관 — court FALLBACK(원자재 미확보)', '세종 지방법원 관할', 'honest-fallback'],
  ['gyeonggi/국가기관 — 통계청', '경기 통계청 문의', 'sp-contains:경인지방통계청'],
  ['gyeonggi/국가기관 — court FALLBACK(수원/의정부 시군 원자재 불완전)', '경기도 지방법원 관할', 'honest-fallback'],
  ['gangwon/국가기관 — 법원(시 이름 명시)', '춘천시 지방법원 관할', 'sp-contains:춘천지방법원'],
  ['gangwon/국가기관 — 해양수산청', '강원 해양수산청 문의', 'sp-contains:동해지방해양수산청'],
  ['chungbuk/국가기관 — 법원(시 이름 명시)', '청주시 지방법원 관할', 'sp-contains:청주지방법원'],
  ['chungbuk/국가기관 — 병무청', '충북 병무청 문의', 'sp-contains:충북지방병무청'],
  ['chungnam/국가기관 — court FALLBACK', '충남 지방법원 관할', 'honest-fallback'],
  ['chungnam/국가기관 — veterans FALLBACK', '충남 보훈청 문의', 'honest-fallback'],
  ['jeonbuk/국가기관 — 법원(시 이름 명시)', '전주시 지방법원 관할', 'sp-contains:전주지방법원'],
  ['jeonbuk/국가기관 — 해양수산청', '전북 해양수산청 문의', 'sp-contains:군산지방해양수산청'],
  ['gyeongbuk/국가기관 — court FALLBACK(대구법원 일부 관할 추정, 미확보)', '경북 지방법원 관할', 'honest-fallback'],
  ['gyeongbuk/국가기관 — 기상청', '경북 기상청 문의', 'sp-contains:대구지방기상청'],
  ['gyeongnam/국가기관 — 법원(시 이름 명시)', '창원시 지방법원 관할', 'sp-contains:창원지방법원'],
  ['gyeongnam/국가기관 — veterans FALLBACK', '경남 보훈청 문의', 'honest-fallback'],
  ['jeju/국가기관 — 세무서(유일하게 tax 등록된 도)', '제주 세무서 문의', 'sp-contains:제주세무서'],
  ['jeju/국가기관 — 출입국', '제주 출입국 문의', 'sp-contains:제주출입국'],
];

// ── 2) 시/군 단위 다중 지사 분기(PR #282) — Seoul 5개 법원/검찰청
// 구(區) 단위 실사 검증. 25개 구 전부 커버됐는지, 구 정보 없으면
// 오답(틀린 법원 확정) 대신 정직하게 되묻는지가 핵심. ─────────────
const CITY_LEVEL_SCENARIOS = [
  ['seoul/시군분기 — 강남구→중앙지법', '강남구에 사는데 지방법원 어디로 가야해요', 'sp-contains:서울중앙지방법원'],
  ['seoul/시군분기 — 노원구→북부지법', '노원구 관할 법원이 어디예요', 'sp-contains:서울북부지방법원'],
  ['seoul/시군분기 — 영등포구→남부지검', '영등포구 검찰청 문의', 'sp-contains:서울남부지방검찰청'],
  ['seoul/시군분기 — 마포구→서부지법', '마포구 지방법원 관할', 'sp-contains:서울서부지방법원'],
  ['seoul/시군분기 — 강동구→동부지법', '강동구 지방법원 관할', 'sp-contains:서울동부지방법원'],
  ['seoul/시군분기 — 구 정보 없으면 정직한 되묻기(오답 방지 핵심)',
    '서울 지방법원 어디로 가나요', 'honest-fallback'],
];

// ── 3) AC 위치 전달(PR #283) — pdvLocationHint 인자가 실제로
// 시/군 분기까지 좁히는지. regional-gov.html의 _resolveLocationHint()가
// GPS/역지오코딩으로 확보한 "도로명주소 문자열"을 그대로 이 인자에
// 태워보내므로, 서울 자치구가 포함된 도로명주소 형태로 시뮬레이션한다. ──
const PDV_SCENARIOS = [
  ['PDV 힌트만으로 시군분기 — "서울특별시 강남구 테헤란로" 힌트, 발화엔 지명 없음',
    '지방법원 어디로 가야하나요', '서울특별시 강남구 테헤란로 152',
    'sp-contains:서울중앙지방법원'],
  ['PDV 힌트만으로 도 판별 — "대구광역시 중구" 힌트, 발화엔 지명 없음(#283 핵심 시나리오)',
    '통계청 문의하고 싶어요', '대구광역시 중구 공평로 88',
    'sp-contains:동북지방통계청'],
  ['발화·PDV 둘 다 지역 정보 없음 — 미판별로 정직하게 실패해야 함',
    '세무서 어디로 가야하나요', null,
    'honest-fallback'],
];

let pass = 0, fail = 0, review = 0;
const failures = [];

function grade(label, text, systemPrompt, expectation) {
  if (expectation === 'review') {
    console.log('→ REVIEW (직접 systemPrompt 확인)');
    review++;
    return;
  }
  let ok, detail;
  if (expectation === 'honest-fallback') {
    ok = HONEST_FALLBACK_MARKERS.some(m => systemPrompt.includes(m));
    detail = ok ? '정직한 폴백 확인' : '정직한 폴백 문구 없음(오답 위험!)';
  } else {
    const [kind, marker] = expectation.split(/:(.+)/).filter(Boolean).length === 2
      ? [expectation.split(':')[0], expectation.slice(expectation.indexOf(':') + 1)]
      : [expectation, ''];
    const found = systemPrompt.includes(marker);
    ok = kind === 'sp-contains' ? found : !found;
    detail = ok ? `"${marker}" 확인` : `"${marker}" 없음(기대: ${expectation})`;
  }
  console.log(ok ? `→ PASS (${detail})` : `→ FAIL (${detail})`);
  if (ok) pass++; else { fail++; failures.push({ label, text, expectation, detail }); }
}

console.log('='.repeat(60));
console.log('1) 국가기관 데이터 HIT/FALLBACK —', SCENARIOS.length, '건');
console.log('='.repeat(60));
for (const [label, text, expectation] of SCENARIOS) {
  process.stdout.write(`\n=== ${label} ===\n입력: ${text}\n`);
  try {
    const r = await mod.assembleGovSystemPrompt(text, null, null, null);
    grade(label, text, r.systemPrompt, expectation);
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
    fail++; failures.push({ label, text, expectation, detail: `예외: ${e.message}` });
  }
}

console.log('\n' + '='.repeat(60));
console.log('2) 시/군 단위 다중 지사 분기(Seoul 법원/검찰청) —', CITY_LEVEL_SCENARIOS.length, '건');
console.log('='.repeat(60));
for (const [label, text, expectation] of CITY_LEVEL_SCENARIOS) {
  process.stdout.write(`\n=== ${label} ===\n입력: ${text}\n`);
  try {
    const r = await mod.assembleGovSystemPrompt(text, null, null, null);
    grade(label, text, r.systemPrompt, expectation);
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
    fail++; failures.push({ label, text, expectation, detail: `예외: ${e.message}` });
  }
}

console.log('\n' + '='.repeat(60));
console.log('3) AC 위치 전달(pdvLocationHint) —', PDV_SCENARIOS.length, '건');
console.log('='.repeat(60));
for (const [label, text, pdvHint, expectation] of PDV_SCENARIOS) {
  process.stdout.write(`\n=== [AC위치] ${label} ===\n입력: "${text}" / pdvLocationHint: ${pdvHint === null ? '(없음)' : `"${pdvHint}"`}\n`);
  try {
    const r = await mod.assembleGovSystemPrompt(text, pdvHint, null, null);
    grade(label, text, r.systemPrompt, expectation);
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
    fail++; failures.push({ label, text, expectation, detail: `예외: ${e.message}` });
  }
}

const total = SCENARIOS.length + CITY_LEVEL_SCENARIOS.length + PDV_SCENARIOS.length;
console.log(`\n${'='.repeat(60)}\n결과: PASS ${pass} / FAIL ${fail} / REVIEW ${review} (총 ${total})`);
if (failures.length) {
  console.log('\n--- 실패 상세 ---');
  for (const f of failures) console.log(`[${f.label}] "${f.text}" → ${f.detail}`);
}
process.exit(fail > 0 ? 1 : 0);
