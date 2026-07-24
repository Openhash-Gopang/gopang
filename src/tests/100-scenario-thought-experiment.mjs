// 100건 사고실험 — 실제 gov-router.js를 import해서 다양한 지역·형식의
// 발화 100건을 흘려보내고 trace를 확인한다(재구현이 아니라 실제 코드 실행).
// 실행: node src/tests/100-scenario-thought-experiment.mjs
//
// 기존 gov-router.test.mjs와 달리 window.HONDI_PROVINCE_CODE를 고정하지
// 않는다 — 이 스크립트의 목적 자체가 "발화 기반 도 판별"을 포함한 전국
// 단위 라우팅(제주 12개 도 + 온보딩 안 된 도 포함)을 검증하는 것이기
// 때문이다(고정하면 모든 케이스가 강제로 jeju로만 흐른다).

import fs from 'node:fs';
import path from 'node:path';

globalThis.window = globalThis;

function fakeText(name) { return `[목 텍스트: ${name}]`; }

// 2026-07-24 신설 — city-master-data.json / city-dept-master-data.json은
// 이제 234개 시/군/구를 담고 있어(3단계 전수 등록), 이 파일 상단의
// 손으로 쓴 소규모 mock(CITY_DEPT_MASTER)로는 커버리지가 계속 뒤처진다.
// 이 두 파일만 실제 repo 파일을 디스크에서 읽어 대체한다(gyeongnam-pilot/
// metro-districts-phase1 테스트와 동일 패턴) — 그 외 mock(SIGUNGU_LIST,
// PROVINCE_MASTER, DO_DEPT_MASTER 등)은 이 파일 고유의 축소 표본을 그대로
// 유지한다(도청·국가기관 계층은 아직 실사 범위가 제한적이라 손 mock이 더
// 명확함).
const CITY_MASTER_REAL_PATH = path.resolve(import.meta.dirname, '..', '..', 'prompts', 'gov-tree', '04-city', 'templates', 'city-master-data.json');
const CITY_DEPT_MASTER_REAL_PATH = path.resolve(import.meta.dirname, '..', '..', 'prompts', 'gov-tree', '04-city', 'templates', 'city-dept-master-data.json');
const CITY_MASTER_REAL = fs.readFileSync(CITY_MASTER_REAL_PATH, 'utf-8');
const CITY_DEPT_MASTER_REAL = fs.readFileSync(CITY_DEPT_MASTER_REAL_PATH, 'utf-8');

// ── 대표 시군구 목록(도 판별 3순위, sigungu-national-list.json 목) ──
const SIGUNGU_LIST = [
  { 이름: '수원시', 광역: '경기도' }, { 이름: '성남시', 광역: '경기도' },
  { 이름: '고양시', 광역: '경기도' }, { 이름: '용인시', 광역: '경기도' },
  { 이름: '천안시', 광역: '충청남도' }, { 이름: '청주시', 광역: '충청북도' },
  { 이름: '전주시', 광역: '전북특별자치도' }, { 이름: '포항시', 광역: '경상북도' },
  { 이름: '창원시', 광역: '경상남도' }, { 이름: '춘천시', 광역: '강원특별자치도' },
  { 이름: '여수시', 광역: '전남광주통합특별시' }, { 이름: '해운대구', 광역: '부산광역시' },
  { 이름: '수영구', 광역: '부산광역시' }, { 이름: '강남구', 광역: '서울특별시' },
  { 이름: '노원구', 광역: '서울특별시' }, { 이름: '연수구', 광역: '인천광역시' },
  { 이름: '유성구', 광역: '대전광역시' }, { 이름: '남구', 광역: '울산광역시' },
  // ★ 실제 sigungu-national-list.json 조회 결과 반영(2026-07-24) — 제주시·
  // 서귀포시는 "행정시(자치권 없음)"로 분류되지만 이 목록에 포함돼 있다.
  // 처음 목에서 누락시켰다가 "서귀포시 건축허가..." 같은 케이스가 전부
  // 지역 미판별로 잘못 튕겨나가는 걸 보고서야 발견 — 목 데이터 누락이었지
  // 실제 코드 버그가 아니었음(재검증 완료).
  { 이름: '제주시', 광역: '제주특별자치도' }, { 이름: '서귀포시', 광역: '제주특별자치도' },
];

const EMD_MASTER = {
  읍면동목록: [
    { 읍면동명: '노형동', 행정시명: '제주시', 관할리목록: [] },
    { 읍면동명: '애월읍', 행정시명: '제주시', 관할리목록: ['애월리', '한담리'] },
    { 읍면동명: '한림읍', 행정시명: '제주시', 관할리목록: ['한림리(한림1리·한림2리)'] },
    { 읍면동명: '한경면', 행정시명: '제주시', 관할리목록: [] },
    { 읍면동명: '중문동', 행정시명: '서귀포시', 관할리목록: [] },
    { 읍면동명: '동홍동', 행정시명: '서귀포시', 관할리목록: [] },
    { 읍면동명: '표선면', 행정시명: '서귀포시', 관할리목록: [] },
  ],
};
const GOV_OVERLAY_MASTER = { 도목록: [{ 도코드: 'jeju', 도이름: '제주특별자치도', 콜센터명: '제주콜센터', 콜센터번호: '064-120' }] };
const NAT_OVERLAY_MASTER = { 도목록: [{ 도코드: 'jeju', 도이름: '제주특별자치도' }] };
const NAT_AGENCY_MASTER = { 기관목록: [
  { 도코드: 'jeju', domain: 'tax', 지사명: '제주세무서', 소속부처: '국세청' },
  { 도코드: 'jeju', domain: 'nps', 지사명: '국민연금공단 제주지역본부', 소속부처: '보건복지부' },
  { 도코드: 'jeju', domain: 'nhis', 지사명: '국민건강보험공단 제주지사', 소속부처: '보건복지부' },
  { 도코드: 'jeju', domain: 'immigration', 지사명: '제주출입국·외국인청', 소속부처: '법무부' },
  { 도코드: 'jeju', domain: 'court', 지사명: '제주지방법원', 소속부처: '법원행정처' },
  { 도코드: 'jeju', domain: 'police', 지사명: '제주지방경찰청', 소속부처: '경찰청' },
  { 도코드: 'jeju', domain: 'customs', 지사명: '제주세관', 소속부처: '관세청' },
  { 도코드: 'jeju', domain: 'mma', 지사명: '제주지방병무청', 소속부처: '병무청' },
] };
const PROVINCE_MASTER = { 도목록: [
  { 도코드: 'jeju', 도이름: '제주특별자치도', 통치구조_문구: '단층제 특별자치도',
    이원화_문구: '', 인접기관_문구: '행정시', 광역출력_문구: '행정시 창구 연결',
    위임사무_문구: '위임사무 문구', 하위SP_접두어: 'SP-DO', 유의사항_추가: '유의사항' },
] };
const DO_DEPT_MASTER = { 부서목록: [
  { domain: 'housing', 도코드: 'jeju', 도이름: '제주특별자치도', 부서명: '건설주택국',
    산하과목록: '건축과 등', 콜센터명: '제주콜센터', 콜센터번호: '064-120', 콜센터운영시간: '07:00~22:00',
    처리사무: ['TEST-PILOT-PERMIT'] },
] };

// ── hondi-proxy(지연 초기화) 응답 목 — 도시별로 다르게 준다 ─────────
function mockSigunguResolve(city, domain) {
  // "존재하지 않는 시" 계열은 일부러 오류처럼 취급(실사 안 된 도 케이스 재현)
  return { text: `[목] ${city} ${domain} 담당 부서 안내(실시간 조회 성공 가정)`, verified: true, source: 'live_search' };
}
function mockNationalAgencyResolve(province, domain, city) {
  return { text: `[목] ${province}${city ? '/' + city : ''} ${domain} 국가기관 지사 안내(실시간 조회 성공 가정)`, verified: true, source: 'live_search' };
}

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('sp-catalog.json')) {
    return { ok: true, json: async () => ({ 'SP-10_kpublic': 'SP-10_kpublic_v2.2.txt', 'SP_common_guardrails': 'SP-COMMON-02_v1.0.md' }) };
  }
  if (u.includes('sigungu-national-list.json')) {
    return { ok: true, json: async () => ({ 시군구목록: SIGUNGU_LIST }) };
  }
  if (u.includes(SIGUNGU_RESOLVE_ORIGIN_MARKER)) {
    const urlObj = new URL(u);
    if (u.includes('/gov/sigungu-dept-resolve')) {
      const city = urlObj.searchParams.get('city');
      const domain = urlObj.searchParams.get('domain');
      const data = mockSigunguResolve(city, domain);
      return { ok: true, headers: { get: () => 'application/json' }, json: async () => data };
    }
    if (u.includes('/gov/national-agency-resolve')) {
      const province = urlObj.searchParams.get('provinceName');
      const domain = urlObj.searchParams.get('domain');
      const city = urlObj.searchParams.get('city');
      const data = mockNationalAgencyResolve(province, domain, city);
      return { ok: true, headers: { get: () => 'application/json' }, json: async () => data };
    }
  }
  if (u.endsWith('.json') || u.includes('.json?')) {
    if (u.includes('emd-master-data.json')) return { ok: true, text: async () => JSON.stringify(EMD_MASTER) };
    if (u.includes('hallim-data.json')) return { ok: true, text: async () => JSON.stringify({ 읍면동명: '한림읍', 행정시명: '제주시' }) };
    if (u.includes('gov-common-overlay-master-data.json')) return { ok: true, text: async () => JSON.stringify(GOV_OVERLAY_MASTER) };
    if (u.includes('national-sp-overlay-master-data.json')) return { ok: true, text: async () => JSON.stringify(NAT_OVERLAY_MASTER) };
    if (u.includes('national-agency-master-data.json')) return { ok: true, text: async () => JSON.stringify(NAT_AGENCY_MASTER) };
    if (u.includes('do-dept-master-data.json')) return { ok: true, text: async () => JSON.stringify(DO_DEPT_MASTER) };
    if (u.includes('city-master-data.json')) return { ok: true, text: async () => CITY_MASTER_REAL };
    if (u.includes('city-dept-master-data.json')) return { ok: true, text: async () => CITY_DEPT_MASTER_REAL };
    if (u.includes('province-master-data.json')) return { ok: true, text: async () => JSON.stringify(PROVINCE_MASTER) };
    return { ok: true, text: async () => '{}' };
  }
  return { ok: true, text: async () => fakeText(u.split('/').pop()) };
};
const SIGUNGU_RESOLVE_ORIGIN_MARKER = 'hondi-proxy.tensor-city.workers.dev';

const { assembleGovSystemPrompt, resolveGovAgency, resolveProvinceCode } = await import('../gopang/gov/gov-router.js');

function mockClassify(text) {
  if (/청년\s*월세/.test(text)) return 'SP-DO-WELFARE';
  if (/자치경찰|국가경찰.{0,4}차이/.test(text)) return null;
  if (/폐업.{0,6}(신고|절차)/.test(text)) return 'SP-SIGUNGU-LAZY';
  if (/여권.{0,6}(발급|재발급|분실)/.test(text)) return 'SP-SIGUNGU-LAZY'; // 한국 여권은 출입국청이 아니라 시/군/구 여권과 소관
  return null;
}

// ═══════════════════════════════════════════════════════════════
// 100건 시나리오 — 카테고리별로 그룹화, 각 항목에 기대치(note)를 남긴다.
// expectTrace: trace 배열에 이 코드들이 "포함"돼야 함(순서 무관, 부분집합).
// expectNotTrace: 이 코드가 trace에 있으면 안 됨.
// ═══════════════════════════════════════════════════════════════
const CASES = [];
function add(group, text, opts = {}) { CASES.push({ group, text, ...opts }); }

// ── A. 응급 상황 (8) — 다양한 형식 ──────────────────────────────
add('A-응급', '지금 불났어요 도와주세요!!', { expectTrace: ['SP-EXP-EMERGENCY'] });
add('A-응급', '가스 냄새가 계속 나요 무서워요', { expectTrace: ['SP-EXP-EMERGENCY'] });
add('A-응급', '아버지가 갑자기 쓰러지셨어요', { expectTrace: ['SP-EXP-EMERGENCY'] });
add('A-응급', 'ㅜㅜ 애가 물에 빠졌어요 살려주세요', { expectTrace: ['SP-EXP-EMERGENCY'] });
add('A-응급', '흉기를 든 사람이 쫓아와요', { expectTrace: ['SP-EXP-EMERGENCY'] });
add('A-응급', '건물이 무너질 것 같아요 흔들려요', { expectTrace: ['SP-EXP-EMERGENCY'] });
add('A-응급', '어제부터 애가 안 보여요 실종된 것 같아요', { expectTrace: ['SP-EXP-EMERGENCY'] });
add('A-응급', '방금 교통사고 났어요 사람이 피 흘려요', { expectTrace: ['SP-EXP-EMERGENCY'] });

// ── B. 응급 오탐 방지 (4) ─────────────────────────────────────
add('B-오탐방지', '제주4·3평화재단 후원하고 싶어요', { expectNotTrace: ['SP-EXP-EMERGENCY'] });
add('B-오탐방지', '동네 문화재 답사 코스 추천해주세요', { expectNotTrace: ['SP-EXP-EMERGENCY'] });
add('B-오탐방지', '화재보험 가입 관련 세제혜택 있나요', { expectNotTrace: ['SP-EXP-EMERGENCY'] });
add('B-오탐방지', '신축 건물 화재예방 점검은 어디서 받나요', { expectNotTrace: ['SP-EXP-EMERGENCY'] });

// ── C. 지역 미판별 (4) ────────────────────────────────────────
add('C-지역미판별', '민원 신청 방법 좀 알려주세요', { expectTrace: ['(지역 미판별'] });
add('C-지역미판별', '세금 어디서 내나요', { expectTrace: ['(지역 미판별'] });
add('C-지역미판별', '복지 혜택 뭐 있어요?', { expectTrace: ['(지역 미판별'] });
add('C-지역미판별', '안녕하세요 문의드립니다', { expectTrace: ['(지역 미판별'] });

// ── D. 제주 국가기관 (8, 정적 테이블 완비) ─────────────────────
add('D-제주국가기관', '제주 세무서 부가세 신고 문의', { expectAgency: 'gov_national', expectTrace: ['SP-NAT-TAX'] });
add('D-제주국가기관', '제주에서 국민연금 언제부터 받아요', { expectAgency: 'gov_national', expectTrace: ['SP-NAT-NPS'] });
add('D-제주국가기관', '제주도 건강보험공단 문의사항 있어요', { expectAgency: 'gov_national', expectTrace: ['SP-NAT-NHIS'] });
add('D-제주국가기관', '제주 출입국관리사무소 비자 연장', { expectAgency: 'gov_national', expectTrace: ['SP-NAT-IMMIGRATION'] });
add('D-제주국가기관', '제주지방법원 민사 소송 절차 궁금해요', { expectAgency: 'gov_national', expectTrace: ['SP-NAT-COURT'] });
add('D-제주국가기관', '제주 지방경찰청에 신고하려고요', { expectAgency: 'gov_national', expectTrace: ['SP-NAT-POLICE'] });
add('D-제주국가기관', '제주세관 통관 절차 문의', { expectAgency: 'gov_national', expectTrace: ['SP-NAT-CUSTOMS'] });
add('D-제주국가기관', '제주 병무청 입영 연기 신청', { expectAgency: 'gov_national', expectTrace: ['SP-NAT-MMA'] });

// ── E. 타 도 국가기관 (지연조회 SP-NATIONAL-LAZY, 4) ──────────────
add('E-타도국가기관-지연', '부산 세무서 종합소득세 신고 언제까지예요', { expectTrace: ['SP-NATIONAL-LAZY'] });
add('E-타도국가기관-지연', '수원시 근로복지공단 산재 신청하려고요', { expectTrace: ['SP-NATIONAL-LAZY'] });
add('E-타도국가기관-지연', '천안시 출입국사무소 체류자격 변경', { expectTrace: ['SP-NATIONAL-LAZY'] });
add('E-타도국가기관-지연', '창원시 지방법원 재판 일정 확인', { expectTrace: ['SP-NATIONAL-LAZY'] });

// ── F. 제주 도청 실국 — 13개 도메인 순회 ────────────────────────
add('F-제주도청', '제주도 고향사랑기부 어떻게 하나요', { expectTrace: ['SP-DO-PLAN'] });
add('F-제주도청', '제주 태풍 대비 재난문자 신청', { expectTrace: ['SP-DO-SAFETY'] });
add('F-제주도청', '제주특별법 특례 내용이 궁금해요', { expectTrace: ['SP-DO-JACHI'] });
add('F-제주도청', '제주 소상공인 정책자금 대출', { expectTrace: ['SP-DO-ECON'] });
add('F-제주도청', '제주 AI산업 스타트업 지원 사업', { expectTrace: ['SP-DO-INNOV'] });
add('F-제주도청', '제주 기초생활수급 신청 조건', { expectTrace: ['SP-DO-WELFARE'] });
add('F-제주도청', '제주 전기차 보조금 신청', { expectTrace: ['SP-DO-CLIMATE'] });
add('F-제주도청', '제주 공공임대주택 정책 문의', { expectTrace: ['SP-DO-HOUSING'] });
add('F-제주도청', '제주 버스 준공영제가 뭔가요', { expectTrace: ['SP-DO-TRANSPORT'] });
add('F-제주도청', '제주 평생학습관 프로그램 신청', { expectTrace: ['SP-DO-CULTURE'] });
add('F-제주도청', '제주 게스트하우스 등록 절차', { expectTrace: ['SP-DO-TOURISM'] });
add('F-제주도청', '제주 농산물재해보험 가입', { expectTrace: ['SP-DO-AGRI'] });
add('F-제주도청', '제주 어업면허 발급 절차', { expectTrace: ['SP-DO-OCEAN'] });

// ── G. 제주 시청 국 단위 (8) ────────────────────────────────────
add('G-제주시청국', '서귀포시 건축허가 신청하고 싶어요', { expectTrace: ['SP-CITYDEPT-seogwipo-housing', 'PERMIT-CRITERIA-PROTOCOL'] });
add('G-제주시청국', '제주시 건축신고 하려는데요', { expectTrace: ['SP-CITYDEPT-jejusi-housing', 'PERMIT-CRITERIA-PROTOCOL'] });
add('G-제주시청국', '제주시 기초생활수급 신청 어디서 하나요', { expectTrace: ['SP-CITYDEPT-jejusi-welfare'] });
add('G-제주시청국', '서귀포시 기초생활수급 신청하고 싶어요', { expectTrace: ['SP-CITYDEPT-seogwipo-welfare'] });
add('G-제주시청국', '제주시청 주차 관련 문의드립니다', { expectTrace: ['SP-CITY-JEJU'], expectNotTrace: ['SP-CITYDEPT'] });
add('G-제주시청국', '서귀포시청 대표번호 알려주세요', { expectTrace: ['SP-CITY-SEOGWIPO'] });
add('G-제주시청국', '제주시 차량등록 어디서 하나요', { expectTrace: ['SP-CITYDEPT-jejusi-safety'] });
add('G-제주시청국', '행정복지센터 몇시까지 하나요', { expectTrace: ['(지역 미판별'], note: '지역명 전혀 없음 — 시청 welfare로 오배정되면 버그' });

// ── H. 제주 읍면동 (EMD, 5) ─────────────────────────────────────
add('H-제주읍면동', '노형동 주민센터 운영시간이 어떻게 되나요', { expectTrace: ['SP-EMD-노형동'] });
add('H-제주읍면동', '애월읍 행정복지센터 위치 알려주세요', { expectTrace: ['SP-EMD-애월읍'] });
add('H-제주읍면동', '한림리 전입신고 하려고 하는데요', { expectTrace: ['SP-EMD-한림읍'], note: '리 이름으로 상위 읍 매칭' });
add('H-제주읍면동', '한경면 인감증명서 발급받고 싶어요', { expectTrace: ['SP-EMD-한경면'] });
add('H-제주읍면동', '중문동에서 상수도 누수 신고하려고요', { expectTrace: ['SP-EXP-WATER'] });

// ── I. PDV 힌트 기반(발화엔 지역 없음) (4) ──────────────────────
add('I-PDV힌트', '수돗물에서 이상한 냄새가 나요', { pdvHint: '제주시 애월읍', expectTrace: ['SP-EMD-애월읍', 'SP-EXP-WATER'] });
add('I-PDV힌트', '건축허가 신청하고 싶어요', { pdvHint: '서귀포시', expectTrace: ['SP-CITYDEPT-seogwipo-housing'] });
add('I-PDV힌트', '기초생활수급 신청하고 싶어요', { pdvHint: '제주시', expectTrace: ['SP-CITYDEPT-jejusi-welfare'] });
add('I-PDV힌트', '세무서 문의하려고요', { pdvHint: '천안시', expectTrace: ['SP-NATIONAL-LAZY'] });

// ── J. 타 도 도청 실국 — 9개 도 순회 ────────────────────────
add('J-타도도청', '부산 스타트업 인공지업 지원사업 문의', { expectTrace: ['SP-DO-INNOV'], expectProvince: 'busan', note: '오타(인공지업) 포함' });
add('J-타도도청', '서울시 재건축 관련 주택정책 문의', { expectTrace: ['SP-DO-HOUSING'], expectProvince: 'seoul' });
add('J-타도도청', '인천 투자유치 문의드립니다', { expectProvince: 'incheon' });
add('J-타도도청', '대전 스타트업 지원 정책 있나요', { expectProvince: 'daejeon' });
add('J-타도도청', '세종시 스마트시티 사업 문의', { expectProvince: 'sejong' });
add('J-타도도청', '충남 축산 농가 지원 정책', { expectTrace: ['SP-DO-AGRI'], expectProvince: 'chungnam' });
add('J-타도도청', '전북 새만금 투자 문의', { expectProvince: 'jeonbuk' });
add('J-타도도청', '경북 포항 이차전지 산업 지원', { expectProvince: 'gyeongbuk' });
add('J-타도도청', '경남 조선업 지원 정책 문의', { expectProvince: 'gyeongnam' });

// ── K. govType 가드 — 세정 라우팅 (4) ────────────────────────────
add('K-govType가드', '제주 재산세 납부 기한 언제인가요', { expectTrace: ['L2 미매칭'], note: '2026-07-23 수정으로 PLAN 키워드에서 재산세/취득세가 빠짐 — 지역(시) 미특정 시 도청으로도 안 가는 게 의도된 최신 동작(정직한 미확정 처리). SP 본문상 개별 세액은 시청 소관이므로 도청 원형 매칭도 하지 않는 게 맞음' });
add('K-govType가드', '부산 재산세 얼마 나왔는지 궁금해요', { expectTrace: ['L2 미매칭'], expectNotTrace: ['SP-DO-PLAN'], note: '2026-07-24 수정 — 제주와 동일하게 부산 PLAN에서도 재산세/취득세를 뺐다. 이러면 divMatch 자체가 안 생겨 govType 가드 코드에 도달하지 않고 곧바로 L2 미매칭으로 떨어진다(제주 K-1과 동일 경로) — 원래 이 테스트가 기대하던 "govType 가드" 트레이스는 키워드를 남겨두고 가드로 잡는 다른 구현을 가정한 것이었는데, 실제로는 제주 쪽 구현(키워드 삭제)으로 통일했으므로 기대값도 맞춘다. 최종 결과(도청이 특정 세액 답을 안 준다)는 동일, 트레이스 메시지만 다름.' });
add('K-govType가드', '해운대구 취득세 계산 좀 도와주세요', { expectTrace: ['SP-CITYDEPT-busan_haeundae-jachi'], note: '2026-07-24 이전엔 SP-SIGUNGU-LAZY로 빠졌으나, 해운대구가 정적 시청 인스턴스로 등록되며 이제 SP-CITYDEPT-busan_haeundae-jachi(지방세 도메인)로 더 정밀하게 잡힌다 — govType 가드의 핵심(도청 SP-DO-PLAN으로 잘못 흡수되지 않음)은 그대로 유지, 목만 더 구체화됨' });
add('K-govType가드', '인천 지방세 및 예산 편성 문의', { note: '세정+예산(비세정 키워드) 혼합 — govType 가드 미작동 가능성 검증 대상' });

// ── L. 2026-07-24 신규 수정분 (3) — 광주 이름 인식, 자동차등록, 반려동물등록 ──
add('L-신규수정', '광주광역시 세무서 어디예요', { expectProvince: 'jeonnam-gwangju', note: '"전남광주통합특별시"라는 미래 통합명칭만 있고 실제로 다들 쓰는 "광주광역시"가 빠져있던 버그 — 짧은 "광주"는 경기도 광주시와 겹쳐 기존 설계대로 계속 배제, 전체 명칭만 추가' });
add('L-신규수정', '수원시 자동차 등록하려고요', { expectTrace: ['SP-CITY-GYEONGGI_SUWON'], note: '2026-07-24 3단계 이후 수원시가 정적 시청 인스턴스로 등록되며 SP-SIGUNGU-LAZY보다 먼저 SP-CITY-GYEONGGI_SUWON에서 멈춘다 — 자동차등록은 아직 시청 국코드 도메인 키워드에 없어(범용 10개 도메인 밖) 국(局) 단위까지는 못 가지만, 최소한 올바른 시는 특정된다. 도메인 키워드 확장은 별도 작업.' });
add('L-신규수정', '고양시 반려동물 등록하고 싶어요', { expectTrace: ['SP-CITY-GYEONGGI_GOYANG'], note: '2026-07-24 3단계 이후 고양시가 정적 시청 인스턴스로 등록되며 SP-SIGUNGU-LAZY보다 먼저 SP-CITY-GYEONGGI_GOYANG에서 멈춘다 — 반려동물등록도 자동차등록과 동일한 이유로 국(局) 단위까지는 아직 안 감.' });

// ── L. 시군구 지연조회(GENERAL 도, 5) ───────────────────────────
add('L-시군구지연', '수원시 기초생활수급 신청하고 싶어요', { expectTrace: ['SP-CITYDEPT-gyeonggi_suwon-welfare'], note: '2026-07-24 3단계 이후 SP-SIGUNGU-LAZY 대신 정적 welfare 도메인으로 정밀하게 잡힌다' });
add('L-시군구지연', '성남시 어린이집 입소 신청 방법', { expectTrace: ['SP-CITYDEPT-gyeonggi_seongnam-welfare'], note: '2026-07-24 welfare 키워드에 어린이집/보육 추가 — 정적 도메인으로 잡힌다' });
add('L-시군구지연', '청주시 쓰레기 분리배출 규정', { expectTrace: ['SP-CITYDEPT-chungbuk_cheongju-climate'], note: '2026-07-24 climate 키워드에 쓰레기/분리배출 추가 — 정적 도메인으로 잡힌다' });
add('L-시군구지연', '천안시 건축 인허가 문의', { expectTrace: ['SP-CITYDEPT-chungnam_cheonan-housing'], note: '2026-07-24 housing 키워드에 띄어쓰기 변형(건축 인허가) 추가 — 정적 도메인으로 잡힌다' });
add('L-시군구지연', '창원시 버스 노선 문의', { expectTrace: ['SP-CITYDEPT-changwon-transport'], note: '2026-07-24 이전엔 SP-SIGUNGU-LAZY로 빠졌으나, 창원시가 정적 시청 인스턴스로 등록되며 이제 SP-CITYDEPT-changwon-transport로 더 정밀하게 잡힌다' });

// ── M. 온보딩 안 된 도(강원/경기/대구) — 원형 폴백 (3) ───
add('M-미온보딩도', '강원도 산불 예방 안전 대책 문의', { expectTrace: ['원형 매칭'], expectProvince: 'gangwon' });
add('M-미온보딩도', '경기도 소상공인 지원 문의', { expectTrace: ['원형 매칭'], expectProvince: 'gyeonggi' });
add('M-미온보딩도', '대구 문화예술 지원사업 문의', { expectTrace: ['SP-DO-CULTURE'], expectProvince: 'daegu', note: '2026-07-24 도청 실국 완비(주피터 지시) 이후 대구도 범용 도메인 L2 테이블이 생겨 "원형 매칭"(3.5단계 최후 안전망)보다 먼저 SP-DO-CULTURE에서 정확히 잡힌다 — 원형 매칭 자체는 아직 이 배치에 없는 도/도메인 조합을 위한 안전망으로 계속 유효.' });

// ── N. 상하수도 전문가 SP (3) ────────────────────────────────────
add('N-상하수도', '급수 중단 안내 문자 받았는데 언제 복구되나요', { pdvHintNone: true, note: '지역 없음 — 상하수도 질문이지만 지역 미판별로 조기 반환될 수 있음(검증 대상)' });
add('N-상하수도', '노형동 우리집 수압이 너무 약해요', { expectTrace: ['SP-EMD-노형동', 'SP-EXP-WATER'] });
add('N-상하수도', '서귀포시 배관 공사 문의', { expectTrace: ['SP-CITY-SEOGWIPO', 'SP-EXP-WATER'] });

// ── O. 형식 다양성(사투리·오타·이모지·반말·복합의도·장문) (7) ────
add('O-형식다양성', '제주도 어린이집 보육료 지원되나요??', { expectTrace: ['SP-DO-WELFARE'] });
add('O-형식다양성', '제주시 건축허가요', { expectTrace: ['SP-CITYDEPT-jejusi-housing'], note: '극도로 짧은 발화' });
add('O-형식다양성', '저기.. 제주도에서 어업면허 낼라면 어떻게 해야되나마씸', { expectTrace: ['SP-DO-OCEAN'], note: '제주 방언(마씸) 포함' });
add('O-형식다양성', '제주 태풍온다는데 재난문자 어디서신청함ㅋㅋ', { expectTrace: ['SP-DO-SAFETY'], note: '띄어쓰기 붕괴+ㅋㅋ' });
add('O-형식다양성', '제주에서 관광 숙박업이랑 게스트하우스 등록을 하고 싶은데 정확히 어떤 서류가 필요하고 어디에 제출해야 하는지 그리고 처리 기간은 보통 얼마나 걸리는지 궁금합니다', { expectTrace: ['SP-DO-TOURISM'], note: '장문' });
add('O-형식다양성', '🏠 제주 공공임대주택 신청하고 싶어용', { expectTrace: ['SP-DO-HOUSING'], note: '이모지+구어체 어미' });
add('O-형식다양성', '자치경찰이랑 일반경찰 차이가 뭐야', { pdvHint: '제주시', useLLM: true, note: 'LLM 분류 NONE 예상 — 공통 레이어로 답변' });

// ── P. LLM 분류 폴백 검증 (3) ───────────────────────────────────
add('P-LLM폴백', '청년 월세 지원 있어요?', { pdvHint: '제주시', useLLM: true, expectTrace: ['SP-DO-WELFARE', 'LLM 분류 폴백'] });
add('P-LLM폴백', '가게 폐업 신고하려고 하는데요', { pdvHint: '천안시', useLLM: true, expectTrace: ['SP-SIGUNGU-LAZY', 'LLM 분류 폴백'] });
add('P-LLM폴백', '여권 재발급 받으려고요', { pdvHint: '창원시', useLLM: true, expectTrace: ['SP-SIGUNGU-LAZY', 'LLM 분류 폴백'], note: '한국 여권은 시/군/구 여권과 소관 — 100건 사고실험에서 발견한 도메인 키워드 공백(여권) 수정 검증' });

// ── Q. PERMIT-CRITERIA-PROTOCOL 강제삽입 대조군 (2) ─────────────
add('Q-PERMIT대조군', '제주 공공임대주택 입주 신청하고 싶어요', { expectTrace: ['SP-DO-HOUSING', 'PERMIT-CRITERIA-PROTOCOL(TEST-PILOT-PERMIT)'] });
add('Q-PERMIT대조군', '제주 소상공인 대출 상담', { expectTrace: ['SP-DO-ECON'], expectNotTrace: ['PERMIT-CRITERIA-PROTOCOL'], note: '처리사무 필드 없는 부서 — 대조군' });

// ── R. 나머지(응급/국가기관/도청 혼합 확인, 카운트 채우기) ────────
add('R-복합', '숨을 못 쉬겠어요 도와주세요 서귀포시 중문동이에요', { expectTrace: ['SP-EXP-EMERGENCY'], note: '지역명 있어도 응급이 최우선' });
add('R-복합', '제주도 세무서 어디 있어요', { expectAgency: 'gov_national', expectTrace: ['SP-NAT-TAX'] });
add('R-복합', '제주도 지방세는 어디서 내나요', { expectTrace: ['SP-DO-PLAN'], expectNotTrace: ['SP-NAT-TAX'], note: '지방세(도청) vs 국세(세무서) 구분 확인' });
add('R-복합', '서귀포시 청정축산 인증 절차', { expectTrace: ['SP-CITYDEPT-seogwipo-'], note: '서귀포시만의 농수축산경제국 도메인' });
add('R-복합', '제주공항 주차장 요금 문의', { note: '국가기관(공항공사) vs 도청(교통항공국) 애매 케이스 — 실제 매칭 확인' });
add('R-복합', '제주 스타트업 창업 지원금 얼마나 받을 수 있나요', { expectTrace: ['SP-DO-INNOV'] });

console.log(`총 시나리오 ${CASES.length}건 생성됨 — 실행 시작\n`);

let pass = 0, fail = 0, info = 0;
const failures = [];
const results = [];

for (const c of CASES) {
  try {
    const classifyFn = c.useLLM ? async (text) => mockClassify(text) : null;
    const { systemPrompt, trace } = await assembleGovSystemPrompt(c.text, c.pdvHint || null, classifyFn, null);
    const agency = resolveGovAgency(trace);
    const traceStr = trace.join(' > ');
    results.push({ ...c, trace, traceStr, agency });

    let ok = true;
    const reasons = [];
    if (c.expectTrace) {
      for (const t of c.expectTrace) {
        if (!traceStr.includes(t)) { ok = false; reasons.push(`기대 trace 조각 누락: "${t}"`); }
      }
    }
    if (c.expectNotTrace) {
      for (const t of c.expectNotTrace) {
        if (traceStr.includes(t)) { ok = false; reasons.push(`있으면 안 되는 trace 조각 발견: "${t}"`); }
      }
    }
    if (c.expectAgency && agency !== c.expectAgency) {
      ok = false; reasons.push(`agency 불일치: 기대=${c.expectAgency}, 실제=${agency}`);
    }
    if (c.expectProvince && resolveProvinceCode() !== c.expectProvince) {
      ok = false; reasons.push(`도 판별 불일치: 기대=${c.expectProvince}, 실제=${resolveProvinceCode()}`);
    }

    if (c.expectTrace || c.expectNotTrace || c.expectAgency || c.expectProvince) {
      if (ok) { pass++; console.log(`✅ [${c.group}] "${c.text.slice(0, 40)}${c.text.length > 40 ? '…' : ''}" → ${traceStr} (agency=${agency}, province=${resolveProvinceCode()})`); }
      else {
        fail++;
        failures.push({ ...c, traceStr, agency, province: resolveProvinceCode(), reasons });
        console.log(`❌ [${c.group}] "${c.text}" → ${traceStr} (agency=${agency}, province=${resolveProvinceCode()})`);
        reasons.forEach(r => console.log(`   ↳ ${r}`));
      }
    } else {
      info++;
      console.log(`ℹ️  [${c.group}] "${c.text.slice(0, 40)}${c.text.length > 40 ? '…' : ''}" → ${traceStr} (agency=${agency}, province=${resolveProvinceCode()})${c.note ? '  (' + c.note + ')' : ''}`);
    }
  } catch (e) {
    fail++;
    failures.push({ ...c, error: e.message, reasons: [`실행 중 예외 발생: ${e.message}`] });
    console.log(`💥 [${c.group}] "${c.text}" → 예외 발생: ${e.message}`);
  }
}

console.log(`\n총 ${CASES.length}건 — 판정 가능 ${pass + fail}건 중 통과 ${pass} / 실패 ${fail} / 참고용(판정 기준 없음) ${info}건`);
if (failures.length) {
  console.log('\n=== 실패 상세 ===');
  failures.forEach((f, i) => {
    console.log(`${i + 1}. [${f.group}] "${f.text}"`);
    console.log(`   trace: ${f.traceStr || '(예외로 trace 없음)'}`);
    (f.reasons || []).forEach(r => console.log(`   - ${r}`));
  });
}

console.log('\n=== 0단계 전용 검증 — candidatesText province-aware 필터링 ===');
await (async () => {
  const captureFn = (holder) => async (text, candidatesText) => { holder.value = candidatesText; return null; };
  const jejuHolder = {}, busanHolder = {};
  await assembleGovSystemPrompt('아무 상담이나 부탁드려요', '제주시', captureFn(jejuHolder), null);
  await assembleGovSystemPrompt('아무 상담이나 부탁드려요', '해운대구', captureFn(busanHolder), null);
  const capturedJeju = jejuHolder.value || '';
  const capturedBusan = busanHolder.value || '';

  const checks = [
    { label: '제주 후보엔 SP-NAT-TAX(정적 인스턴스 있음) 포함', ok: capturedJeju.includes('SP-NAT-TAX') },
    { label: '제주 후보엔 SP-NATIONAL-LAZY 없음(정적 인스턴스 있어 불필요)', ok: !capturedJeju.includes('SP-NATIONAL-LAZY') },
    { label: '제주 후보엔 SP-SIGUNGU-LAZY 없음(SPECIAL_AUTONOMOUS라 기초자치단체 없음)', ok: !capturedJeju.includes('SP-SIGUNGU-LAZY') },
    { label: '부산 후보엔 SP-NAT-TAX 없음(정적 인스턴스 없어 골라도 실패했을 코드)',
      // ★ 2026-07-24 수정 — naive .includes('SP-NAT-TAX')는 SP-DO-PLAN 설명문의
      // "[지방세는 여기, 국세는 SP-NAT-TAX]" 참고문구까지 걸려 오탐이었다
      // (부산 도판별 버그 수정으로 SP-DO-PLAN이 후보에 정상적으로 뜨면서
      // 처음 드러남 — capturedBusan.includes 자체가 아니라 후보 "항목"인지를
      // 정밀하게 확인하도록 고친다).
      ok: !/(^|\n)SP-NAT-TAX:/.test(capturedBusan) },
    { label: '부산 후보엔 SP-NATIONAL-LAZY 포함(국가기관 정적 인스턴스 없음)', ok: capturedBusan.includes('SP-NATIONAL-LAZY') },
    { label: '부산 후보엔 SP-SIGUNGU-LAZY 포함(GENERAL 도)', ok: capturedBusan.includes('SP-SIGUNGU-LAZY') },
  ];
  let stage0Pass = 0, stage0Fail = 0;
  for (const c of checks) {
    if (c.ok) { stage0Pass++; console.log(`✅ ${c.label}`); }
    else { stage0Fail++; console.log(`❌ ${c.label}`); }
  }
  console.log(`0단계 검증: ${stage0Pass}/${checks.length} 통과`);
  if (stage0Fail > 0) process.exitCode = 1;
})();
