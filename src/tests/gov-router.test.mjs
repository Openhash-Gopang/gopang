// gov-router.js(중앙 공유 모듈) 실제 코드 라우팅 검증 하네스 — 2026-07-19 jeju 저장소에서 이전
// 실행: node src/tests/jeju-router.test.mjs
//
// ── 2026-07-23 수정 이력 (주피터 지시, PERMIT-CRITERIA-PROTOCOL 강제삽입 작업 중 발견) ──
// 이 테스트 파일이 실제 gov-router.js보다 뒤처져 있던 사전 존재 버그 3건을
// 오늘 작업의 회귀검증 과정에서 우연히 발견해 함께 고쳤다(코드 자체는
// 정상이었고, 이 테스트 파일의 기대값/목 데이터만 낙후돼 있었음):
//   1) sp-catalog.json 목에 SP_common_guardrails 키가 없어 _loadExpertCommonSp()가
//      즉시 throw — 테스트가 아예 실행이 안 됐다.
//   2) 2026-07-21 신설된 window.HONDI_PROVINCE_CODE 오버라이드(jeju 기본값
//      제거에 따른 대체 수단)를 이 테스트가 설정 안 해서, 지역 언급 없는
//      발화가 전부 "지역 미판별"로 (의도대로) 튕겨나갔다.
//   3) resolveGovAgency()가 이미 'gov_do'/'gov_national'로 일반화됐는데
//      CASES 배열은 옛 이름 'jeju_do'/'jeju_national'을 그대로 기대하고 있었다.
// 신규 추가: PERMIT-CRITERIA-PROTOCOL 강제삽입 검증 케이스 1개 + 전용 검증
// 블록(대조군 포함, 파일 하단).

//
// assembleGovSystemPrompt()를 실제로 import해서 실행한다(재구현 아님).
// fetch는 raw.githubusercontent.com 대상 전부를 범용 목으로 대체한다 —
// .json 요청은 구조가 맞는 최소 더미 데이터를, .md 요청은 플레이스홀더
// 텍스트를 돌려준다. 목적은 "어느 SP 코드로 라우팅되는가"(trace)를
// 검증하는 것이므로 텍스트 내용 자체는 중요하지 않다.

globalThis.window = globalThis;
globalThis.window.HONDI_PROVINCE_CODE = 'jeju'; // 2026-07-21 신설 오버라이드 — 원본 테스트가 아직 설정 안 함(별도 버그로 보고)

function fakeText(name) { return `[목 텍스트: ${name}]`; }

const EMD_MASTER = {
  읍면동목록: [
    { 읍면동명: '노형동', 행정시명: '제주시' },
    { 읍면동명: '애월읍', 행정시명: '제주시' },
    { 읍면동명: '중문동', 행정시명: '서귀포시' },
  ],
};
const HALLIM_DATA = { 읍면동명: '한림읍', 행정시명: '제주시' };
const GOV_OVERLAY_MASTER = { 도목록: [{ 도코드: 'jeju', 도이름: '제주특별자치도', 콜센터명: '제주콜센터', 콜센터번호: '064-120' }] };
const NAT_OVERLAY_MASTER = { 도목록: [{ 도코드: 'jeju', 도이름: '제주특별자치도' }] };
const NAT_AGENCY_MASTER = { 기관목록: [
  { 도코드: 'jeju', domain: 'tax', 지사명: '제주세무서', 소속부처: '국세청', 대표전화: '126' },
  { 도코드: 'jeju', domain: 'nps', 지사명: '국민연금공단 제주지역본부', 소속부처: '보건복지부' },
  { 도코드: 'jeju', domain: 'nhis', 지사명: '국민건강보험공단 제주지사', 소속부처: '보건복지부' },
  { 도코드: 'jeju', domain: 'immigration', 지사명: '제주출입국·외국인청', 소속부처: '법무부' },
] };
// 2026-07-19 신설 — SP-PROVINCE-TEMPLATE 렌더링 경로(정적 파일 폴백이
// 아니라) 실제 정상 케이스를 검증하기 위한 최소 목. jeju 레코드 하나만
// 두고, 거버넌스구조.계층모델이 결과 텍스트에 실제로 반영되는지까지 확인.
const PROVINCE_MASTER = { 도목록: [
  { 도코드: 'jeju', 도이름: '제주특별자치도', 통치구조_문구: '단층제 특별자치도',
    이원화_문구: '', 인접기관_문구: '행정시', 광역출력_문구: '행정시 창구 연결',
    위임사무_문구: '위임사무 문구', 하위SP_접두어: 'SP-DO', 유의사항_추가: '유의사항',
    거버넌스구조: { 계층모델: 'TWO_TIER_ADMIN_CITY' } },
] };

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('sp-catalog.json')) return { ok: true, json: async () => ({ 'SP-10_kpublic': 'SP-10_kpublic_v2.2.txt', 'SP_common_guardrails': 'SP-COMMON-02_v1.0.md' }) };
  if (u.endsWith('.json') || u.includes('.json?')) {
    if (u.includes('emd-master-data.json')) return { ok: true, text: async () => JSON.stringify(EMD_MASTER) };
    if (u.includes('hallim-data.json')) return { ok: true, text: async () => JSON.stringify(HALLIM_DATA) };
    if (u.includes('gov-common-overlay-master-data.json')) return { ok: true, text: async () => JSON.stringify(GOV_OVERLAY_MASTER) };
    if (u.includes('national-sp-overlay-master-data.json')) return { ok: true, text: async () => JSON.stringify(NAT_OVERLAY_MASTER) };
    if (u.includes('national-agency-master-data.json')) return { ok: true, text: async () => JSON.stringify(NAT_AGENCY_MASTER) };
    if (u.includes('do-dept-master-data.json')) return { ok: true, text: async () => JSON.stringify({ 부서목록: [
      // 2026-07-23 신설 — PERMIT-CRITERIA-PROTOCOL 강제삽입 검증용 레코드.
      // 나머지 도메인은 여전히 빈 배열 취급(아래 find가 못 찾으면 기존처럼
      // static file 폴백) — 기존 16개 케이스는 전혀 영향받지 않는다.
      { domain: 'housing', 도코드: 'jeju', template: 'SP-DEPT-HOUSING-TEMPLATE_v1.0.md',
        도이름: '제주특별자치도', 부서명: '건설주택국', 산하과목록: '건축과 등',
        콜센터명: '제주콜센터', 콜센터번호: '064-120', 콜센터운영시간: '07:00~22:00',
        처리사무: ['TEST-PILOT-PERMIT'] },
    ] }) };
    if (u.includes('city-master-data.json')) return { ok: true, text: async () => JSON.stringify({ 시목록: [] }) };
    if (u.includes('city-dept-master-data.json')) return { ok: true, text: async () => JSON.stringify({ 국목록: [
      // 2026-07-23 신설 — 시청 국(局) 단위 라우팅 + PERMIT-CRITERIA-PROTOCOL
      // 검증용 실데이터(서귀포시 안전도시건설국, 건축법 제14조 건축신고 실제 반영분).
      { 시코드: 'seogwipo', 국코드: 'construction', 시이름: '서귀포시', 국이름: '안전도시건설국',
        산하과목록: '안전총괄과, 도시과, 건축과, 건설과, 교통행정과, 상하수도과',
        입력_문구: '건축·도시계획 인허가 신청', 출력_문구: '건축허가·도시계획 결정',
        처분성_문구: '건축·도시계획 인허가는 실제 신청·심사를 통해서만 확정된다',
        콜센터명: '제주콜센터', 콜센터번호: '064-120', 콜센터운영시간: '07:00~22:00, 유료',
        처리사무: ['PERMIT-BUILDING-REPORT-14'] },
    ] }) };
    if (u.includes('province-master-data.json')) return { ok: true, text: async () => JSON.stringify(PROVINCE_MASTER) }; // 2026-07-19 신설 — 템플릿 정상 경로 검증용
    return { ok: true, text: async () => '{}' };
  }
  // .md 등 나머지 전부 — 플레이스홀더 텍스트(내용은 trace 검증과 무관)
  return { ok: true, text: async () => fakeText(u.split('/').pop()) };
};

const { assembleGovSystemPrompt, resolveGovAgency } = await import('../gopang/gov/gov-router.js');

// classifyFn 목 — LLM 분류가 필요한 케이스에서 "이럴 법한 판단"을 주입한다.
// (실제 DeepSeek 호출 없이 파이프라인 배선을 검증하는 것이 목적 — router-category
// 테스트와 동일한 한계를 가진다.)
function mockClassify(text) {
  if (/청년\s*월세/.test(text)) return 'SP-DO-WELFARE';
  if (/자치경찰/.test(text)) return null; // 비교·설명형 — NONE
  return null;
}

const CASES = [
  // ── 응급(최우선) ──────────────────────────────
  { text: '지금 쓰러졌어요 숨을 안 쉬어요', expectTrace: ['JEJU-GOV-COMMON', 'SP-EXP-EMERGENCY'] },

  // ── 국가기관 트리(중앙행정기관) ────────────────
  { text: '국민연금 수령 나이가 언제부터예요', expectAgency: 'gov_national', expectContains: 'SP-NAT-NPS' },
  { text: '건강보험료 얼마나 나왔는지 확인하고 싶어요', expectAgency: 'gov_national', expectContains: 'SP-NAT-NHIS' },
  { text: '외국인 배우자 비자 연장하려면 어디로 가나요', expectAgency: 'gov_national', expectContains: 'SP-NAT-IMMIGRATION' },
  { text: '홈택스 종합소득세 신고가 안 열려요', expectAgency: 'gov_national', expectContains: 'SP-NAT-TAX' },

  // ── 도청 트리(지방행정) — 실국 매칭 ────────────
  { text: '지방세 취득세 납부 기한이 언제인가요', expectAgency: 'gov_do', expectContains: 'SP-DO-PLAN' },
  { text: '태풍 대비 재난 문자는 어디서 신청하나요', expectAgency: 'gov_do', expectContains: 'SP-DO-SAFETY' },
  { text: '소상공인 정책자금 대출 상담하고 싶어요', expectAgency: 'gov_do', expectContains: 'SP-DO-ECON' },
  { text: '어린이집 보육료 지원 대상인지 궁금해요', expectAgency: 'gov_do', expectContains: 'SP-DO-WELFARE' },

  // ── 시청 트리 ────────────────────────────────
  { text: '제주시청 주차 관련 문의드립니다', expectAgency: 'gov_do', expectContains: 'SP-CITY-JEJU' },

  // ── 읍면동 트리(GPS/텍스트 힌트) ────────────────
  { text: '노형동 주민센터 몇시까지 하나요', expectAgency: 'gov_do', expectContains: 'SP-EMD-노형동' },
  { text: '수돗물에서 이상한 냄새가 나요', locationHint: '애월읍', expectAgency: 'gov_do', expectContains: 'SP-EXP-WATER' },

  // ── LLM 분류 폴백 ────────────────────────────
  { text: '청년 월세 지원 있어요?', expectAgency: 'gov_do', expectContains: 'SP-DO-WELFARE', useClassify: true },
  { text: '자치경찰이랑 일반경찰 차이가 뭐예요', expectAgency: 'gov_do', expectContains: '(LLM 분류도 NONE', useClassify: true },

  // ── 국세/지방세 혼동 방지(설계 의도 검증) ────────
  { text: '세금 신고하러 왔는데 어디로 가야하나요', expectAgency: 'gov_do', note: '범용어 "세금"만으로는 국가기관 트리로 안 새는지(§0 혼동방지 설계) 확인 — 실제로는 LLM폴백/공통레이어 처리' },

  // ── 복합 관할(SP 위임 후보) ──────────────────
  { text: '전입신고랑 국민연금 가입 둘 다 어디서 처리하나요', note: '전입신고(도청 kgov 트리거)+국민연금(국가기관) 복합 — 배타적 분기라 실제로는 국가기관 트리 하나만 선택됨(§0), U9 위임 시나리오의 실사용 사례로 4절에서 다룸' },

  // ── 인허가류 사무 프로토콜 강제삽입 검증(2026-07-23 신설) ──────
  { text: '공공임대주택 입주 신청하고 싶어요', expectAgency: 'gov_do', expectContains: 'SP-DO-HOUSING',
    note: '처리사무 필드가 있는 부서(housing)라 PERMIT-CRITERIA-PROTOCOL이 trace에 강제로 딸려와야 함(아래 별도 검증 블록에서 trace 전체 확인)' },

  // ── 시청 국(局) 라우팅 + 건축신고 파일럿 실사용 시나리오 (2026-07-23 신설) ──
  { text: '서귀포시 건축허가 신청하고 싶어요', expectAgency: 'gov_do', expectContains: 'SP-CITYDEPT-seogwipo-construction',
    note: '건축법 제14조상 관할은 도청이 아니라 서귀포시장 — 시청 국(안전도시건설국) 단위까지 정확히 내려가야 하고, PERMIT-CRITERIA-PROTOCOL(PERMIT-BUILDING-REPORT-14)까지 딸려와야 함' },

  // ── 지역명 없이 PDV 힌트만으로 관할 특정 (2026-07-23 신설, 주피터 지시) ──
  // "서귀포 시청에 건축 인허가..."처럼 지역을 지정하지 않고 "건축 인허가
  // 신청하고 싶어요"라고만 말해도, PDV 위치로 시(市)·국(局)까지 동적으로
  // 특정해야 한다는 사고실험 결과 반영.
  { text: '건축 인허가 신청하고 싶어요', locationHint: '서귀포시', expectAgency: 'gov_do',
    expectContains: 'SP-CITYDEPT-seogwipo-construction',
    note: '발화에 지역명 없음 — PDV 힌트(시 단위)만으로 cityOnly 경로 진입 후 시청 국까지 특정돼야 함(_matchCity가 힌트를 보도록 수정한 부분 검증)' },
  { text: '건축 인허가 신청하고 싶어요', locationHint: '중문동', expectAgency: 'gov_do',
    expectContains: 'SP-CITYDEPT-seogwipo-construction',
    note: '발화에 지역명 없음 — PDV 힌트가 동(洞) 단위(중문동→서귀포시)라 emdMatch 경로로 들어가지만, 건축 사무는 읍면동이 아니라 시청 국 소관이므로 읍면동 템플릿 대신 시청 국이 붙어야 함(규칙 F 일반화 검증)' },
  { text: '건축 인허가 신청하고 싶어요', expectAgency: 'gov_do',
    note: '발화에도 PDV 힌트도 지역 정보 전혀 없음 — 이 경우 도청 건설주택국으로 잘못 라우팅되지 않는지가 핵심(근본원인 수정 검증). 실제로는 L2 미매칭/LLM폴백으로 흘러가는 게 정직한 처리' },
];

let pass = 0, fail = 0, info = 0;

// ── 2026-07-19 신설 — SP-PROVINCE-TEMPLATE 정상 렌더링 검증 ──────────
// _loadDoSp()는 실패 시 조용히 정적 파일로 폴백하므로(의도된 동작),
// "폴백이 아니라 템플릿 경로를 실제로 탔는지"는 trace만으로 구분되지
// 않는다. console.warn을 가로채 폴백 경고가 안 찍히는지로 검증한다.
{
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(' ')); originalWarn(...args); };
  const r = await assembleGovSystemPrompt('지방세 취득세 납부 기한이 언제인가요');
  console.warn = originalWarn;
  const fellBack = warnings.some(w => w.includes('SP-PROVINCE-TEMPLATE 렌더링 실패'));
  if (!fellBack) {
    pass++; console.log('✅ [신설] SP-PROVINCE-TEMPLATE 정상 경로(폴백 없음) 확인');
  } else {
    fail++; console.log('❌ [신설] SP-PROVINCE-TEMPLATE가 폴백으로 빠짐:', warnings);
  }
}

for (const c of CASES) {
  const r = await assembleGovSystemPrompt(c.text, c.locationHint || null, c.useClassify ? mockClassify : null);
  const agency = resolveGovAgency(r.trace);

  if (!c.expectTrace && !c.expectAgency && !c.expectContains) {
    info++;
    console.log(`ℹ️  [참고] "${c.text}" → trace=[${r.trace.join(' > ')}] agency=${agency}${c.note ? '  (' + c.note + ')' : ''}`);
    continue;
  }

  const traceOk = c.expectTrace ? c.expectTrace.every(t => r.trace.includes(t)) : true;
  const agencyOk = c.expectAgency ? agency === c.expectAgency : true;
  const containsOk = c.expectContains ? r.trace.some(t => t.includes(c.expectContains)) : true;

  if (traceOk && agencyOk && containsOk) {
    pass++;
    console.log(`✅ "${c.text}" → [${r.trace.join(' > ')}] (agency=${agency})`);
  } else {
    fail++;
    console.log(`❌ "${c.text}" → 실제 trace=[${r.trace.join(' > ')}] agency=${agency} / 기대 agency=${c.expectAgency},contains=${c.expectContains}`);
  }
}

console.log(`\n총 ${CASES.length + 1}건(CASES ${CASES.length} + 신설 1) — 판정 가능 ${pass + fail}건 중 통과 ${pass} / 실패 ${fail} / 참고용 ${info}건`);

// ── 2026-07-23 신설 — PERMIT-CRITERIA-PROTOCOL 강제삽입 전용 검증 ──
// expectContains만으로는 "SP-DO-HOUSING이 trace에 있다"까지만 확인되고
// "그 뒤에 프로토콜이 실제로 딸려왔다"는 확인 안 되므로 별도 블록.
{
  const r = await assembleGovSystemPrompt('공공임대주택 입주 신청하고 싶어요');
  const hasProtocolTrace = r.trace.some(t => t.startsWith('PERMIT-CRITERIA-PROTOCOL('));
  const hasCorrectCode = r.trace.some(t => t.includes('PERMIT-CRITERIA-PROTOCOL(TEST-PILOT-PERMIT)'));
  if (hasProtocolTrace && hasCorrectCode) {
    console.log('✅ [신설] 처리사무 필드가 있는 부서 → PERMIT-CRITERIA-PROTOCOL 강제삽입 확인:', r.trace.join(' > '));
  } else {
    console.log('❌ [신설] PERMIT-CRITERIA-PROTOCOL 강제삽입 실패, trace:', r.trace.join(' > '));
    process.exitCode = 1;
  }

  // 대조군 — 처리사무 필드가 없는 부서(welfare)는 프로토콜이 절대 붙지 않아야 함
  const r2 = await assembleGovSystemPrompt('어린이집 보육료 지원 대상인지 궁금해요');
  const wronglyAttached = r2.trace.some(t => t.startsWith('PERMIT-CRITERIA-PROTOCOL('));
  if (!wronglyAttached) {
    console.log('✅ [신설] 처리사무 필드가 없는 부서(welfare) → 프로토콜 미삽입 확인(대조군)');
  } else {
    console.log('❌ [신설] 처리사무 필드가 없는데도 프로토콜이 잘못 삽입됨:', r2.trace.join(' > '));
    process.exitCode = 1;
  }

  // ── 시청 국(局) 라우팅 + 건축신고 파일럿 전용 검증 ──
  const r3 = await assembleGovSystemPrompt('서귀포시 건축허가 신청하고 싶어요');
  const hasCityDept = r3.trace.some(t => t === 'SP-CITYDEPT-seogwipo-construction');
  const hasBuildingPermitProtocol = r3.trace.some(t => t.includes('PERMIT-CRITERIA-PROTOCOL(PERMIT-BUILDING-REPORT-14)'));
  if (hasCityDept && hasBuildingPermitProtocol) {
    console.log('✅ [신설] 서귀포시 건축신고 파일럿 — 시청 국 단위까지 라우팅 + 프로토콜 강제삽입 확인:', r3.trace.join(' > '));
  } else {
    console.log('❌ [신설] 서귀포시 건축신고 파일럿 실패, trace:', r3.trace.join(' > '));
    process.exitCode = 1;
  }

  // ── 지역명 없이 PDV 힌트만으로 관할 특정 — 전용 검증 (2026-07-23 신설) ──
  const r4 = await assembleGovSystemPrompt('건축 인허가 신청하고 싶어요', '서귀포시');
  const r4ok = r4.trace.some(t => t === 'SP-CITYDEPT-seogwipo-construction');
  if (r4ok) {
    console.log('✅ [신설] 지역명 없음 + 시 단위 PDV 힌트 → 시청 국 특정 확인:', r4.trace.join(' > '));
  } else {
    console.log('❌ [신설] 시 단위 PDV 힌트로 시청 국 특정 실패, trace:', r4.trace.join(' > '));
    process.exitCode = 1;
  }

  const r5 = await assembleGovSystemPrompt('건축 인허가 신청하고 싶어요', '중문동');
  const r5ok = r5.trace.some(t => t === 'SP-CITYDEPT-seogwipo-construction')
    && !r5.trace.some(t => t.startsWith('SP-EMD-'));
  if (r5ok) {
    console.log('✅ [신설] 지역명 없음 + 동 단위 PDV 힌트(emdMatch 경로) → 읍면동 대신 시청 국 특정 확인(규칙 F 일반화):', r5.trace.join(' > '));
  } else {
    console.log('❌ [신설] 동 단위 PDV 힌트에서 규칙 F 일반화 실패, trace:', r5.trace.join(' > '));
    process.exitCode = 1;
  }

  // ── 근본원인 수정 회귀검증 — 지역 정보가 전혀 없으면 도청으로 잘못
  // 라우팅되지 않아야 한다(SP-DO-HOUSING 오매칭 방지) ──
  const r6 = await assembleGovSystemPrompt('건축 인허가 신청하고 싶어요');
  const r6ok = !r6.trace.includes('SP-DO-HOUSING');
  if (r6ok) {
    console.log('✅ [신설] 지역 정보 전무 시 도청 건설주택국으로 오매칭되지 않음 확인(근본원인 수정):', r6.trace.join(' > '));
  } else {
    console.log('❌ [신설] 지역 정보 없이도 SP-DO-HOUSING으로 잘못 매칭됨(근본원인 미수정), trace:', r6.trace.join(' > '));
    process.exitCode = 1;
  }
}

process.exit((fail > 0 || process.exitCode === 1) ? 1 : 0);
