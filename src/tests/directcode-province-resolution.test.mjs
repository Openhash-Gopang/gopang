// directcode-province-resolution.test.mjs — 2026-08-04 신설
//
// 배경: gov-router.js의 directCode(K-Search 엔티티 매칭 확정 경로, §-0.9)
// 처리부가 tier마다 `_currentResolvedProvinceCode = 'jeju'`를 무조건
// 하드코딩하고 있었다(주피터 지시로 발견). K-Search가 제주 밖 기관을
// 정확히 찾아 directCode를 반환해도, 이 하드코딩 때문에 JEJU_* 테이블에서만
// 찾다가 못 찾고 조용히 폴백으로 떨어지는 구조적 결함 — 이 테스트는 그
// 수정(_findEntryAcrossProvinces 신설)이 실제로 동작하는지 검증한다.
//
// 실행: node src/tests/directcode-province-resolution.test.mjs

globalThis.window = globalThis;
globalThis.window.HONDI_PROVINCE_CODE = undefined; // 오버라이드 없이 순수 directCode 경로만 검증

function fakeText(name) { return `[목 텍스트: ${name}]`; }

// city-master-data.json을 일부러 빈 배열로 둔다 — Busan Haeundae는
// PROVINCE_TABLES 안에서 file:null(자동생성 엔트리)이므로, city-master-data
// 매칭 실패 시 정직하게 file(=null)→플레이스홀더 텍스트로 폴백하는 경로까지
// 함께 검증된다(이 테스트의 관심사는 "어느 도로 확정되는가"이지 렌더링
// 콘텐츠 내용이 아니다).
// ★ 2026-08-04 — 이 목은 기존 gov-router.test.mjs의 sp-catalog.json 목을
// 그대로 베꼈다가, _fetchByManifestKey(2026-07-29 신설)가 요구하는 키가
// 늘어난 걸 반영 안 해서 이 테스트도 처음엔 깨졌다(기존 gov-router.test.mjs
// 도 같은 이유로 현재 브랜치에서 이미 깨져 있음을 확인 — 이 테스트 파일과
// 무관한 별도의 선재 결함, 이번 세션 범위 밖). 여기서는 이 테스트가 실제로
// 거치는 _loadGovCommon()이 요구하는 키를 전부 채워 우회한다.
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('sp-catalog.json')) {
    return { ok: true, json: async () => ({
      'SP-10_kpublic': 'SP-10_kpublic_v2.2.txt',
      'SP_common_guardrails': 'SP-COMMON-02_v1.0.md',
      'GOV-COMMON-OVERLAY-TEMPLATE': 'GOV-COMMON-OVERLAY-TEMPLATE_v1.1.md',
      'GOV-TREE-PROTOCOL': 'GOV-TREE-PROTOCOL_v1.0.md',
      'SP-PROVINCE-TEMPLATE': 'SP-PROVINCE-TEMPLATE_v1.1.md',
      'NATIONAL-SP-CORE': 'NATIONAL-SP-CORE_v1.2.md',
      'NATIONAL-SP-OVERLAY-TEMPLATE': 'NATIONAL-SP-OVERLAY-TEMPLATE_v1.0.md',
    }) };
  }
  if (u.endsWith('.json') || u.includes('.json?')) {
    if (u.includes('gov-common-overlay-master-data.json')) {
      return { ok: true, text: async () => JSON.stringify({ 도목록: [
        { 도코드: 'jeju', 도이름: '제주특별자치도', 콜센터명: '제주콜센터', 콜센터번호: '064-120' },
        { 도코드: 'busan', 도이름: '부산광역시', 콜센터명: '부산콜센터', 콜센터번호: '051-120' },
      ] }) };
    }
    if (u.includes('national-sp-overlay-master-data.json')) {
      return { ok: true, text: async () => JSON.stringify({ 도목록: [{ 도코드: 'jeju', 도이름: '제주특별자치도' }] }) };
    }
    if (u.includes('city-master-data.json')) return { ok: true, text: async () => JSON.stringify({ 시목록: [] }) };
    if (u.includes('city-dept-master-data.json')) return { ok: true, text: async () => JSON.stringify({ 국목록: [] }) };
    if (u.includes('do-dept-master-data.json')) return { ok: true, text: async () => JSON.stringify({ 부서목록: [] }) };
    if (u.includes('emd-master-data.json')) return { ok: true, text: async () => JSON.stringify({ 읍면동목록: [] }) };
    if (u.includes('province-master-data.json')) return { ok: true, text: async () => JSON.stringify({ 도목록: [] }) };
    if (u.includes('sigungu-national-list.json')) return { ok: true, text: async () => JSON.stringify({ 시군구목록: [] }) };
    // 나머지는 정직하게 빈 객체(있는 그대로 폴백 경로를 타게 둠).
    return { ok: true, text: async () => '{}' };
  }
  if (u.includes('SP-ORG-BUSANTRANSIT_v1.0.md')) {
    return { ok: true, text: async () => '당신은 **부산교통공사(BTC)**를 대표하는 AI 레이어다. 지방공기업(지방공사), 부산광역시청과 별도 법인격.' };
  }
  return { ok: true, text: async () => fakeText(u.split('/').pop()) };
};

const { assembleGovSystemPrompt } = await import('../gopang/gov/gov-router.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}`); }
  else { fail++; console.log(`❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

// ── 케이스 1: 회귀 방지 — 기존 제주 do-agency 코드가 여전히 정상 동작하는지 ──
{
  const r = await assembleGovSystemPrompt('', null, null, null, 'do-agency:SP-AGY-AGRITECH');
  const hit = r.trace.some(t => t.includes('SP-AGY-AGRITECH(directCode)'));
  check('[회귀] 제주 do-agency 기존 코드(SP-AGY-AGRITECH) 정상 라우팅', hit, r.trace.join(' | '));
}

// ── 케이스 2: 신규 — 부산 city 코드가 이제 부산으로 확정되는지 ──
// (수정 전이었다면 _currentResolvedProvinceCode가 'jeju'로 강제되어
//  JEJU_CITY_TABLE에서 못 찾고 이 trace 항목 자체가 안 나왔어야 한다.)
{
  const r = await assembleGovSystemPrompt('', null, null, null, 'city:SP-CITY-BUSAN_HAEUNDAE');
  const hit = r.trace.some(t => t.includes('SP-CITY-BUSAN_HAEUNDAE(directCode)'));
  check('[신규] 부산 해운대구 city directCode가 실제로 라우팅됨(더 이상 제주로 잘못 강제되지 않음)', hit, r.trace.join(' | '));
}

// ── 케이스 3: 코드 자체가 어느 도에도 없을 때 — 조용히 폴백하되 크래시 없어야 함 ──
{
  let threw = false;
  let r = null;
  try {
    r = await assembleGovSystemPrompt('', null, null, null, 'do-agency:NONEXISTENT-CODE-XYZ');
  } catch (e) {
    threw = true;
    console.error(e);
  }
  check('[안전망] 존재하지 않는 directCode도 크래시 없이 폴백', !threw && r != null);
}

// ── 케이스 4: 부산 do-agency는 아직 PROVINCE_TABLES.busan에 agency 필드
// 자체가 없다(HANDOFF 확인 사실) — 이 경우도 크래시 없이 정직하게
// "코드 없음" 폴백으로 떨어져야 한다(agency 필드 없는 도는 accessor의
// `|| []` 폴백으로 빈 배열이 되므로 _findEntryAcrossProvinces가 그냥
// 못 찾을 뿐, 에러가 나면 안 된다).
{
  let threw = false;
  try {
    await assembleGovSystemPrompt('', null, null, null, 'do-agency:BUSAN-TRANSIT-CORP-임시코드');
  } catch (e) {
    threw = true;
    console.error(e);
  }
  check('[안전망] 아직 데이터 없는 도의 do-agency 코드도 크래시 없이 폴백', !threw);
}

// ── 케이스 5: 부산 파일럿 1호(부산교통공사) — org tier 실제 콘텐츠까지
// 끝까지 완주하는지 확인. BUSAN_ORG_TABLE + PROVINCE_TABLES.busan.org
// 배선(2026-08-04 신설)이 directCode 수정과 함께 실제로 맞물리는지
// 검증하는 이 세션의 핵심 종단 테스트다.
{
  const r = await assembleGovSystemPrompt('', null, null, null, 'org:SP-ORG-BUSANTRANSIT');
  const hit = r.trace.some(t => t.includes('SP-ORG-BUSANTRANSIT(directCode)'));
  const isBusan = r.systemPrompt.includes('부산교통공사') || r.trace.join(' ').includes('busan');
  check('[파일럿] 부산교통공사 org directCode 종단 라우팅 완주', hit, r.trace.join(' | '));
  check('[파일럿] 부산교통공사 SP 콘텐츠가 실제로 삽입됨(목 텍스트 아님)',
    r.systemPrompt.includes('부산교통공사') && r.systemPrompt.includes('지방공기업'),
    r.systemPrompt.slice(0, 200));
}

console.log(`\n총 ${pass + fail}건 중 ${pass}건 통과, ${fail}건 실패`);
if (fail > 0) process.exit(1);

// ── 케이스 7·8: ★ 진짜 핵심 검증(2026-08-04 세션 후반 재확인) —
// directCode/PocketBase 없이 순수 발화 텍스트만으로 매칭되는가.
// _resolveInstitutionMatch(text, _orgTable(), ...)가 실제 1차 매칭
// 경로이고, directCode는 K-Search가 이미 특정 프로필을 확정한 경우의
// 지름길일 뿐이다 — gov-tree 전용 SP가 있는 기관은 SP-18 RULE-07
// 7-D에 따라 애초에 PocketBase/K-Search 대상이 아니므로
// (docs/SESSION_LESSONS_VECTORIZE_GOVTREE_v1_0.md §⑦ 참조), 이 경로가
// 작동해야 진짜 완주다.
{
  const r = await assembleGovSystemPrompt('부산교통공사 민원은 어디로 문의하나요', '부산광역시');
  const hit = r.trace.some(t => t.includes('SP-ORG-BUSANTRANSIT'));
  check('[핵심] 순수 발화 텍스트만으로(directCode 없이) 부산교통공사 매칭', hit, r.trace.join(' | '));
}
{
  const r = await assembleGovSystemPrompt('휴메트로 분실물센터 전화번호 알려줘', '부산광역시');
  const hit = r.trace.some(t => t.includes('SP-ORG-BUSANTRANSIT'));
  check('[핵심] 별칭("휴메트로")으로도 매칭', hit, r.trace.join(' | '));
}

// ── 케이스 9: ★ 2026-08-04 신설 — kw 리터럴 매칭이 완전히 실패하는
// 자연어 패러프레이즈(paraphrase)도 LLM 분류 폴백으로 구제되는가.
// "지하철 타다가 물건 놓고 내렸는데 어디다 물어봐요"는 BUSAN_ORG_TABLE의
// kw(부산교통공사/부산 지하철/휴메트로/도시철도 N호선) 중 어느 것도
// 리터럴로 포함하지 않는다 — 수정 전에는 _resolveInstitutionMatch가
// topScore===0에서 즉시 null을 반환해 이 케이스는 완전히 새는 사각지대
// 였다(docs/GOVTREE_NATIONWIDE_EXPANSION_LESSONS_v1_0.md 참조). classifyFn을
// 목으로 주입해 이 구제 경로가 실제로 호출·동작하는지 검증한다.
{
  const mockClassifyFn = async (text, candidatesText) => {
    // 실제 LLM이라면 desc("지하철 건설·운영")를 보고 골랐을 상황을 재현.
    if (candidatesText.includes('SP-ORG-BUSANTRANSIT') && text.includes('지하철')) {
      return 'SP-ORG-BUSANTRANSIT';
    }
    return 'NONE';
  };
  const r = await assembleGovSystemPrompt(
    '지하철 타다가 물건 놓고 내렸는데 어디다 물어봐요', '부산광역시', mockClassifyFn
  );
  const hit = r.trace.some(t => t.includes('SP-ORG-BUSANTRANSIT'));
  check('[신규 구제] kw 미포함 패러프레이즈도 classifyFn 폴백으로 매칭', hit, r.trace.join(' | '));
}
{
  // 대조군 — classifyFn 없이(주입 안 됨) 같은 문장을 물으면 여전히
  // 못 찾아야 정상(회귀 확인용, 이 구제 경로가 classifyFn 의존적임을 검증).
  const r = await assembleGovSystemPrompt(
    '지하철 타다가 물건 놓고 내렸는데 어디다 물어봐요', '부산광역시'
  );
  const missed = !r.trace.some(t => t.includes('SP-ORG-BUSANTRANSIT'));
  check('[대조군] classifyFn 미주입 시엔 예상대로 여전히 못 찾음', missed, r.trace.join(' | '));
}

console.log(`\n최종 총 ${pass}건 중 ${pass}건 통과, ${fail}건 실패`);
if (fail > 0) process.exit(1);
