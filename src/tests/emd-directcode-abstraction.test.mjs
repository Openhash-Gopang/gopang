// emd-directcode-abstraction.test.mjs — 2026-08-05 신설
//
// 배경: gov-router.js의 'emd'/'team' tier directCode 해석부가
// `_currentResolvedProvinceCode = 'jeju'` 하드코딩과 `{행정시명}` 전용
// 조회에 묶여 있었다(다른 tier는 2026-08-04에 이미 _findEntryAcrossProvinces로
// 일반화됐으나 emd만 남아있었음). _findEmdEntryAcrossProvinces 신설로
// 하드코딩을 제거했는데, 이 리팩터가 기존 제주 동작을 깨지 않는지 —
// 그리고 v1.3 신규 필드(상위기관명)만 있고 구 필드(행정시명)가 없는
// 레코드(향후 부산 등 신규 도 레코드 형태)도 정상 처리되는지 검증한다.
//
// 실행: node src/tests/emd-directcode-abstraction.test.mjs

globalThis.window = globalThis;
globalThis.window.HONDI_PROVINCE_CODE = undefined;

const FAKE_EMD_RECORD = {
  emd_code: 'SP-EMD-AEWOL',
  읍면동명: '애월읍',
  행정시명: '제주시', // 구 필드 — 하위호환 확인용
  읍면동구분: '읍',
  청사주소: '테스트 청사주소',
  대표전화: '000-0000',
  관할리목록: ['테스트리'],
  팀구성: [{ 팀: '총무팀', 업무: '테스트 업무' }],
};

// v1.3 신규 필드만 쓰고 구 필드(행정시명)는 아예 없는 레코드 —
// 향후 부산 등 신규 도 레코드가 이런 형태일 것으로 예상되므로,
// 같은 emd-master-data.json 안에 섞여 있어도 정상 처리되는지 확인.
const FAKE_EMD_RECORD_V13_ONLY = {
  emd_code: 'SP-EMD-TESTDONG',
  읍면동명: '테스트동',
  상위기관명: '제주시', // 상위기관명만 있고 행정시명 없음
  상위기관구분: '행정시',
  읍면동구분: '동',
  청사주소: '테스트 청사주소2',
  대표전화: '000-0001',
  관할구역목록: ['테스트법정동'],
};

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
  if (u.includes('emd-master-data.json')) {
    return { ok: true, text: async () => JSON.stringify({ 읍면동목록: [FAKE_EMD_RECORD, FAKE_EMD_RECORD_V13_ONLY] }) };
  }
  if (u.endsWith('.json') || u.includes('.json?')) {
    if (u.includes('gov-common-overlay-master-data.json')) {
      return { ok: true, text: async () => JSON.stringify({ 도목록: [
        { 도코드: 'jeju', 도이름: '제주특별자치도', 콜센터명: '제주콜센터', 콜센터번호: '064-120' },
      ] }) };
    }
    if (u.includes('national-sp-overlay-master-data.json')) {
      return { ok: true, text: async () => JSON.stringify({ 도목록: [{ 도코드: 'jeju', 도이름: '제주특별자치도' }] }) };
    }
    if (u.includes('city-master-data.json')) return { ok: true, text: async () => JSON.stringify({ 시목록: [] }) };
    if (u.includes('city-dept-master-data.json')) return { ok: true, text: async () => JSON.stringify({ 국목록: [] }) };
    if (u.includes('do-dept-master-data.json')) return { ok: true, text: async () => JSON.stringify({ 부서목록: [] }) };
    if (u.includes('team-master-data.json')) {
      return { ok: true, text: async () => JSON.stringify({ 팀목록: [
        { emd_code: 'SP-EMD-AEWOL', 팀이름: '총무팀', kw: [] },
      ] }) };
    }
    if (u.includes('province-master-data.json')) return { ok: true, text: async () => JSON.stringify({ 도목록: [] }) };
    if (u.includes('sigungu-national-list.json')) return { ok: true, text: async () => JSON.stringify({ 시군구목록: [] }) };
    return { ok: true, text: async () => '{}' };
  }
  if (u.includes('SP-EMD-TEMPLATE')) {
    return { ok: true, text: async () => '읍면동명={읍면동명} 상위기관명={상위기관명} 상위기관구분={상위기관구분} 관할구역목록={관할구역목록}' };
  }
  return { ok: true, text: async () => `[목 텍스트: ${u.split('/').pop()}]` };
};

const { assembleGovSystemPrompt } = await import('../gopang/gov/gov-router.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}`); }
  else { fail++; console.log(`❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

// ── 케이스 1: 회귀 방지 — 구 스키마(행정시명만 있는) 제주 레코드가
// 리팩터 후에도 emd directCode로 정상 라우팅되는지 ──
{
  const r = await assembleGovSystemPrompt('', null, null, null, 'emd:애월읍');
  const hit = r.trace.some(t => t.includes('SP-EMD-애월읍(directCode)'));
  check('[회귀] 구 스키마(행정시명) 제주 레코드 — emd directCode 정상 라우팅', hit, r.trace.join(' | '));
}

// ── 케이스 2: 신규 — v1.3 신규 필드(상위기관명)만 있고 구 필드(행정시명)가
// 없는 레코드도 emd directCode로 정상 라우팅되는지(향후 부산 등 신규 도
// 레코드 형태를 미리 흉내낸 것) ──
{
  const r = await assembleGovSystemPrompt('', null, null, null, 'emd:테스트동');
  const hit = r.trace.some(t => t.includes('SP-EMD-테스트동(directCode)'));
  check('[신규] v1.3 신규 필드(상위기관명)만 있는 레코드 — emd directCode 정상 라우팅', hit, r.trace.join(' | '));
}

// ── 케이스 3: team tier directCode도 여전히 동작하는지(회귀 방지) ──
{
  const r = await assembleGovSystemPrompt('', null, null, null, 'team:애월읍-총무팀');
  const hit = r.trace.some(t => t.includes('SP-EMD-애월읍'));
  check('[회귀] team directCode(애월읍-총무팀) 정상 라우팅', hit, r.trace.join(' | '));
}

// ── 케이스 4: 존재하지 않는 emd 코드는 크래시 없이 폴백해야 함 ──
{
  let threw = false;
  let r = null;
  try {
    r = await assembleGovSystemPrompt('', null, null, null, 'emd:존재하지않는동');
  } catch (e) {
    threw = true;
    console.error(e);
  }
  check('[안전망] 존재하지 않는 emd directCode도 크래시 없이 폴백', !threw && r != null);
}

console.log(`\n총 ${pass + fail}건 중 ${pass}건 통과, ${fail}건 실패`);
if (fail > 0) process.exit(1);
