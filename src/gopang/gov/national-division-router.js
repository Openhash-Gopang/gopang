// national-division-router.js
// ═══════════════════════════════════════════════════
// 국가기관 division(실·국·과) 단위 지연 합성(lazy composition) + 라우팅 테이블
// 2026-08-16 신설 — §6-1~8(70개 기관) division 전수 실사 데이터(311건)를
// 실제 라우팅에 연결하기 위한 모듈.
//
// ★ 배경 ★ gov-router.js의 _POLICY_BODY_DOMAIN_KEYWORDS는 70개 기관
// "본청" 단위까지만 라우팅한다(SP-NAT-POLICY-{code}_v1.1.md, 정적 파일
// 70개는 이미 존재·배선 완료). 이 모듈은 그 아래 계층 — 실/국/과 단위 —
// 를 다룬다. 제주시 division(CITY_DIVISION_TABLE)과 달리 이 계층은
// division마다 정적 .md 파일을 미리 만들어두지 않았다(311건 전부 만들면
// 유지보수 부담이 매우 큼) — 대신 6개 템플릿 + master-data.json의
// 소관업무_문구를 런타임에 합성하는 "지연 합성" 방식을 쓴다. 이는 기존
// 프로젝트가 도(道) 레벨에서 이미 채택한 "지연 초기화 아키텍처"(메모리
// 기록 참고)와 동일한 설계 원칙이다.
//
// ★ 정직하게 밝힘 ★ 이 모듈은 파일럿 단계다 — MOIS(행정안전부) 12개
// division으로만 로컬 검증했다(compose 결과가 §0/§1/§CAPABILITIES/§2/§3
// 섹션을 전부 포함하는지, 플레이스홀더가 남지 않는지 확인). 나머지
// 299건(§6-1~8 전체 311건 중 MOIS 12건 제외)은 구조는 동일하지만 실제
// fetch 경로로 실행 검증은 하지 않았다 — 배포 전 반드시
// live-policy-bodies-smoketest.mjs와 같은 방식의 실측 스모크테스트가
// 필요하다.
// ═══════════════════════════════════════════════════

// ── 마스터데이터/템플릿 레지스트리 ──────────────────────────────────
// 6개 division 템플릿 클래스와 그에 대응하는 master-data.json 경로.
// 어떤 기관코드가 어떤 클래스에 속하는지는 각 JSON의 division목록에
// 있는 기관코드 집합으로 판별한다(_buildInstitutionClassIndex).
const DIVISION_DATA_SOURCES = [
  {
    template: '09-national/policy-bodies/divisions/SP-COMMISSION-ADMINDIV-TEMPLATE_v1.0.md',
    masterData: '09-national/policy-bodies/divisions/commission-division-master-data.json',
  },
  {
    template: '09-national/policy-bodies/divisions/SP-PRESIDENTIAL-ADMINDIV-TEMPLATE_v1.0.md',
    masterData: '09-national/policy-bodies/divisions/presidential-division-master-data.json',
  },
  {
    template: '09-national/policy-bodies/divisions/SP-JUDICIARY-ADMINDIV-TEMPLATE_v1.0.md',
    masterData: '09-national/policy-bodies/divisions/judiciary-division-master-data.json',
  },
  {
    template: '09-national/policy-bodies/divisions/SP-ASSEMBLY-AGENCYDIV-TEMPLATE_v1.0.md',
    masterData: '09-national/policy-bodies/divisions/assembly-agency-division-master-data.json',
  },
  {
    // 국회 상임위원회(assembly-committee)는 성격이 달라(합의제 위원회,
    // 개별 부서가 아님) 이번 배선 1차 범위에서 제외 — 필요 시 별도 처리.
    template: '09-national/policy-bodies/divisions/SP-BUREAU-ADMINDIV-TEMPLATE_v1.0.md',
    masterData: '09-national/policy-bodies/divisions/bureau-division-master-data.json',
  },
  {
    template: '09-national/policy-bodies/divisions/SP-MINISTRY-ADMINDIV-TEMPLATE_v1.0.md',
    masterData: '09-national/policy-bodies/divisions/ministry-division-master-data.json',
  },
];

// ── 캐시 ────────────────────────────────────────────────────────
const _masterDataCache = new Map(); // masterData path → parsed JSON
const _templateCache = new Map();   // template path → raw text
const _divisionSpCache = new Map(); // "기관코드/부서코드" → composed text
let _divisionIndexCache = null;     // "기관코드/부서코드" → {entry, source}
let _nationalDivisionTable = null;  // 라우팅 테이블 (지연 생성)

// ── 마스터데이터/템플릿 로딩 (fetchTextFn은 호출부의 _fetchText 주입) ──
async function _loadMasterData(source, fetchTextFn) {
  if (_masterDataCache.has(source.masterData)) return _masterDataCache.get(source.masterData);
  const raw = await fetchTextFn(source.masterData);
  const data = JSON.parse(raw);
  _masterDataCache.set(source.masterData, data);
  return data;
}

async function _loadTemplate(source, fetchTextFn) {
  if (_templateCache.has(source.template)) return _templateCache.get(source.template);
  const raw = await fetchTextFn(source.template);
  _templateCache.set(source.template, raw);
  return raw;
}

// ── 전체 인덱스 구축: "기관코드/부서코드" → {entry, source} ──────────
async function _buildDivisionIndex(fetchTextFn) {
  if (_divisionIndexCache) return _divisionIndexCache;
  const index = new Map();
  for (const source of DIVISION_DATA_SOURCES) {
    let data;
    try {
      data = await _loadMasterData(source, fetchTextFn);
    } catch (e) {
      console.warn('[national-division-router] 마스터데이터 로드 실패, 건너뜀:', source.masterData, e?.message);
      continue;
    }
    for (const entry of data.division목록 || []) {
      const key = `${entry.기관코드}/${entry.부서코드}`;
      index.set(key, { entry, source });
    }
  }
  _divisionIndexCache = index;
  return index;
}

// ── 플레이스홀더 치환 합성 ────────────────────────────────────────
// 6개 템플릿 전부 §1 정체성에 {상위기관이름}/{부서이름}/{소관업무_문구}
// 플레이스홀더를, 문서 상단 주석에 {부서유형}을 쓴다(템플릿 원문 확인).
function _composeFromTemplate(templateText, entry) {
  const 상위기관이름 = entry.기관명;
  const 부서이름 = entry.부서명;
  const 소관업무_문구 = entry.소관업무_문구;
  const 부서유형 = entry.부서유형;

  let out = templateText;
  out = out.split('{상위기관이름}').join(상위기관이름);
  out = out.split('{부서이름}').join(부서이름);
  out = out.split('{소관업무_문구}').join(소관업무_문구);
  out = out.split('{부서유형}').join(부서유형);

  // 정직하게 밝힘: 치환 후에도 남은 플레이스홀더가 있으면 즉시 알 수
  // 있도록 마커를 남긴다(운영 중 조용히 깨지는 것보다 눈에 띄는 게 낫다).
  const leftover = out.match(/\{[가-힣A-Za-z_]+\}/g);
  if (leftover) {
    console.warn('[national-division-router] 미치환 플레이스홀더 발견:', leftover, entry.기관코드, entry.부서코드);
  }
  return out;
}

// ── 공개 API 1: 특정 division SP 합성(지연, 캐시) ──────────────────
// resolvePolicyBodyLazy(code)와 동일한 시그니처 관례를 따른다.
async function resolvePolicyDivisionLazy(기관코드, 부서코드, fetchTextFn, onProgress) {
  const cacheKey = `${기관코드}/${부서코드}`;
  if (_divisionSpCache.has(cacheKey)) {
    return { text: _divisionSpCache.get(cacheKey), source: 'cache' };
  }
  try {
    onProgress?.({ stage: 'policy-division-fetch', 기관코드, 부서코드 });
    const index = await _buildDivisionIndex(fetchTextFn);
    const hit = index.get(cacheKey);
    if (!hit) throw new Error(`division 인덱스에 없음: ${cacheKey}`);
    const templateText = await _loadTemplate(hit.source, fetchTextFn);
    const composed = _composeFromTemplate(templateText, hit.entry);
    _divisionSpCache.set(cacheKey, composed);
    return { text: composed, source: 'composed' };
  } catch (e) {
    console.warn('[national-division-router] resolvePolicyDivisionLazy 실패, 상위기관으로 폴백:', e?.message);
    return null; // 호출부에서 null이면 resolvePolicyBodyLazy(상위기관코드)로 폴백하도록 설계
  }
}

// ── 공개 API 2: 라우팅 테이블 생성 (키워드 추출) ────────────────────
// CITY_DIVISION_TABLE과 동일한 형태({code, kw, ...})를 만들되, 파일
// 경로 대신 (기관코드, 부서코드)를 실어 resolvePolicyDivisionLazy로
// 넘긴다. 키워드는 부서명(전체/부분)과 소관업무_문구에서 나이브하게
// 추출한다 — 실측 후 오탐이 보이면 조정 대상(기존 division-tables.js도
// 여러 차례 수작업 보정을 거쳤다는 점을 참고).
//
// ★ 2026-08-16 발견·수정 ★ 초기 버전은 "기획조정"(42개 기관 중복),
// "대변인"(28개), "감사"(14개), "운영지원과"(15개) 등 거의 모든 기관에
// 공통으로 등장하는 일반 행정 상용구까지 키워드로 뽑아, 이 상태로
// 배포하면 라우터 코드 상단 주석이 경고한 "FULLY BLOCKED" 키워드 충돌이
// division 레벨에서도 그대로 재현될 뻔했다(로컬 감사 스크립트로 사전에
// 잡음, 실배포 전 필수 확인 단계였음). 아래 불용어 목록으로 1차 필터링
// 하되, 이 목록조차 완전하지 않을 수 있으므로 배포 전 스모크테스트에서
// "여러 기관에 걸쳐 등장하는 키워드" 재감사를 반드시 다시 돌릴 것.
const _GENERIC_ADMIN_STOPWORDS = new Set([
  '기획조정', '기획조정관', '기획조정실', '기획조정 총괄', '부 전체 기획조정',
  '청 전체 기획조정', '처 전체 기획조정', '기관 전체 기획조정',
  '대변인', '대변인실', '대외 공보',
  '운영지원', '운영지원과', '운영 지원', '청 운영 지원', '처 운영 지원',
  '감사', '감사관', '감사담당관', '감사담당', '내부 감사', '내부 감찰',
  '장관 직속', '차관 직속', '청장 직속', '처장 직속', '위원장 직속',
  '조정', '총괄', '지원', '관리', '정책', '행정', '사무', '기획',
  '운영', '집행', '평가', '진흥', '검토', '연구', '협력', '개선',
  // 2026-08-16 추가 — 조직 계층·직급을 서술하는 표현(실질 소관업무
  // 키워드가 아님에도 여러 division에 공통으로 등장해 충돌을 일으킴)
  '고위공무원단', '제1차관 직속', '제2차관 직속', '1차관 직속', '2차관 직속',
]);

function _extractKeywords(entry) {
  const kw = new Set();
  // 부서명은 그 자체로 고유성이 높으므로 항상 포함(불용어 필터 미적용)
  kw.add(entry.부서명);
  const short = entry.부서명.replace(/(실|국|과|관|단|위원회|본부|사무처|소속기관)$/u, '');
  if (short && short !== entry.부서명 && short.length >= 2) kw.add(short);

  // 소관업무_문구에서 추출한 구는 불용어 필터를 통과해야 채택.
  // ★ 2026-08-16 조정 ★ 처음엔 slice(0,3)으로 앞 3개 구만 썼는데, MOIS
  // AIGOV처럼 문장 뒷부분(괄호 안 설명)에 진짜 핵심 키워드(dpaper API
  // 신청·문서24 운영 감독·행정정보공유과 — 이 프로젝트 최우선순위
  // 라우팅 대상)가 있는 경우를 놓쳤다(실측 시나리오 테스트로 발견).
  // slice(0,6)으로 완화했지만, "행정정보공유과" 자체는 훨씬 긴 문장
  // 조각 안에 묻혀 있어 길이 필터(<=10)에 걸려 여전히 빠졌다 — 그래서
  // 아래 정규식으로 긴 조각 내부에서도 부서명 패턴과 영문·숫자 고유
  // 명사를 별도로 뽑아낸다(2차 안전망).
  const phrases = entry.소관업무_문구
    .split(/[·,()]/)
    .map(s => s.trim())
    .filter(s => s.length >= 2 && s.length <= 10 && !/[.!?]/.test(s))
    .filter(s => !_GENERIC_ADMIN_STOPWORDS.has(s));
  for (const p of phrases.slice(0, 6)) kw.add(p);

  // 부서명 패턴(과/국/실/처/청/원/센터/팀/본부/단으로 끝나는 2~8자 한글
  // 어절) — 문장 어디에 있든(길이 필터로 걸러진 긴 조각 내부라도) 추출.
  // ★ 2026-08-16 재조정 ★ 이 정규식이 상위 기관 자신의 이름("검찰청",
  // "대검찰청" 등 기관명+공식명칭 변형)까지 잡아, 그 기관 소속 division
  // 전부가 공통으로 걸리는 새 충돌을 만들었다(PROSECUTION 실측으로
  // 발견). 상위기관이름과 겹치거나 그것을 포함하는 매치, 그리고
  // "산하 N개과"류 개수 서술은 제외한다.
  const deptPattern = /[가-힣]{2,8}(?:과|국|실|처|청|원|센터|팀|본부|단)(?![가-힣])/g;
  const 상위기관이름_핵심 = entry.기관명.replace(/^대/, ''); // "대검찰청"→"검찰청" 등 접두 변형도 걸러내기 위함
  for (const m of entry.소관업무_문구.matchAll(deptPattern)) {
    const token = m[0];
    if (_GENERIC_ADMIN_STOPWORDS.has(token)) continue;
    if (token === entry.기관명 || token === 상위기관이름_핵심) continue; // 상위기관 자기 자신
    if (/^산하\s*\d+개/.test(entry.소관업무_문구.slice(Math.max(0, m.index - 4), m.index))) continue; // "산하 N개과" 개수 서술
    kw.add(token);
  }
  // 영문·숫자 혼합 고유명사(예: dpaper, 문서24, K-NASS) — 시스템·서비스
  // 이름은 거의 항상 라우팅에 결정적이므로 길이 제한 없이 전부 채택
  const properNounPattern = /[A-Za-z][A-Za-z0-9-]{2,}|[가-힣]+[0-9]+/g;
  for (const m of entry.소관업무_문구.matchAll(properNounPattern)) {
    if (m[0].length >= 3) kw.add(m[0]);
  }
  return Array.from(kw);
}

async function buildNationalDivisionTable(fetchTextFn) {
  if (_nationalDivisionTable) return _nationalDivisionTable;
  const index = await _buildDivisionIndex(fetchTextFn);
  const table = [];
  for (const [key, { entry }] of index.entries()) {
    const [기관코드, 부서코드] = key.split('/');
    table.push({
      code: `SP-NAT-POLICYDIV-${기관코드}-${부서코드}`,
      기관코드, 부서코드,
      name: `${entry.기관명} ${entry.부서명}`,
      kw: _extractKeywords(entry),
    });
  }
  _nationalDivisionTable = table;
  return table;
}

// ── 공개 API 3: 기관 스코프 division 조회 (권장 사용법) ─────────────
// ★ 2026-08-16 설계 정정 ★ buildNationalDivisionTable()이 반환하는
// 전체 550건을 곧바로 전역 키워드 매칭에 쓰면 안 된다 — "기획조정실"
// "대변인" 같은 부서명은 여러 기관에 공통으로 존재하는 게 정상이라
// (제주시·서귀포시 둘 다 "총무과"가 있는 것과 동일한 이유), 전역에서
// 찾으면 필연적으로 충돌한다. 기존 CITY_DIVISION_TABLE도 시코드로
// 먼저 스코프를 좁힌 뒤(_cityTable() 등) 그 안에서만 매칭한다 — 이
// 프로젝트의 확립된 2단계 원칙(상위 계층 먼저 확정 → 그 안에서 하위
// 계층 매칭)과 동일하게, division 매칭은 반드시 **_POLICY_BODY_
// DOMAIN_KEYWORDS로 기관(70개 중 하나)을 먼저 확정한 뒤에만** 호출한다.
async function getDivisionsForInstitution(기관코드, fetchTextFn) {
  const table = await buildNationalDivisionTable(fetchTextFn);
  return table.filter(t => t.기관코드 === 기관코드);
}

// ── gov-router.js 통합 지점 (참고용 — 실제 삽입은 검토 후 수동 반영) ──
// 1. import: `import { resolvePolicyDivisionLazy, getDivisionsForInstitution }
//    from './national-division-router.js';`
// 2. 흐름: 기존 _guessPolicyBodyFromText(text)로 기관코드를 먼저 확정한다
//    (변경 없음, 이미 검증된 70개 기관 라우팅 그대로 재사용).
// 3. 기관코드가 확정되면 `getDivisionsForInstitution(기관코드, _fetchText)`로
//    그 기관의 division만 가져와(보통 5~25건) 그 범위 안에서만 키워드
//    매칭(_scoreMatchTies 재사용 가능)한다 — **전역 550건에서 찾지 않는다.**
// 4. division이 동점 없이 특정되면 resolvePolicyDivisionLazy(기관코드,
//    부서코드, _fetchText)로 합성. division이 안 잡히거나 동점이면
//    기존 resolvePolicyBodyLazy(기관코드)로 폴백(본청 응답) — 이미 있는
//    안전망을 그대로 재사용, 새 실패 모드를 만들지 않는다.
// 5. 배포 전 필수: 이 모듈의 키워드 추출(_extractKeywords)이 만든
//    550건 전체를 대상으로 "여러 기관에 걸쳐 등장하는 키워드" 재감사를
//    돌려(audit_keywords.mjs 참고) 걸러지지 않은 상용구가 남았는지
//    확인할 것 — 불용어 목록(_GENERIC_ADMIN_STOPWORDS)은 이번 세션
//    감사로 찾은 것만 반영했으므로 완전하지 않을 수 있다.

export { resolvePolicyDivisionLazy, buildNationalDivisionTable, getDivisionsForInstitution, _composeFromTemplate, _extractKeywords };
