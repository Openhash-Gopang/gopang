/**
 * gov-router.js — 광역시도 정부 AC 공용 라우터 (중앙/공유 모듈)
 *
 * 2026-07-19 신설 — 원래 jeju 저장소의 jeju-router.js였던 걸 여기로
 * 이전했다(주피터 지시: "제주는 이제 여러 광역시도 중 하나일 뿐이며,
 * 도청·시청 등 추상 클래스를 상속받아 제주도청 인스턴스를 생성하는
 * 구조여야 한다. jeju의 역할을 중앙의 상위 클래스로 이전하라"). 이
 * 파일이 그 "상위 클래스"다 — jeju 저장소의 jeju-router.js는 이제
 * 이 파일을 그대로 재수출(re-export)하는 얇은 인스턴스 셋업 파일로
 * 축소됐다(gwp-report-client.js가 15개 K-서비스에 이미 쓰고 있는
 * 크로스오리진 공유모듈 패턴과 동일).
 *
 * gwp-registry.js의 다른 서비스(K-Law 등)는 sp_key 하나 → 고정 SP 파일
 * 하나를 로드하지만, 도(道) 단위 행정 도메인은 JEJU-GOV-COMMON §6에서
 * 정의한 [JEJU_CHAIN: SP-DO-000 > L2 > L3? > L4?] 문법에 따라 요청마다
 * 다른 조합의 SP를 동적으로 조립해야 한다. 이 파일이 그 조립을 담당한다
 * (2026-07-19 Phase 1에서 이미 province-agnostic하게 일반화됨 —
 * `PROVINCE_TABLES` 레지스트리에 도 하나를 등록하면 이 파일의 매칭
 * 로직·호출부는 전혀 안 고쳐도 된다).
 *
 * v1.1: JEJU-NATIONAL-SP(국가기관 트리) 추가 — JEJU-DO-SP(도청 트리)와
 * JEJU-GOV-COMMON 바로 아래의 형제 노드다(JEJU-NATIONAL-SP §0). 그래서
 * "고정 접두사"는 JEJU-GOV-COMMON까지만이고, 그 다음 DO-SP냐 NATIONAL-SP냐는
 * 매 요청마다 배타적으로 갈린다 — 두 트리를 동시에 체인하지 않는다.
 *
 * ★ 알려진 한계(2026-07-19, 의도적으로 이번 이전 작업 범위 밖) ★
 * 아래 식별자들은 여전히 "JEJU-" 접두어를 쓴다 — 이 파일이 실제로는
 * province-agnostic한데도: trace 문자열('JEJU-GOV-COMMON',
 * 'JEJU-NATIONAL-SP'), 정적 폴백 파일명('01-do/JEJU-DO-SP_v1.5.md').
 * 이걸 완전히 일반화하려면 `worker.js`의 `SP_DELEGATION_REGISTRY`/
 * `GOV_AGENCIES`가 쓰는 'jeju_do'/'jeju_national' 키, `gwp-registry.js`의
 * jeju 서비스 항목까지 같이 바꿔야 한다(이 파일 하나만 고쳐서 될 일이
 * 아님 — 여러 저장소에 걸친 문자열 일치가 깨지면 조용히 UNKNOWN_AGENCY로
 * 거부되는 사고가 난다, 이 파일 자체의 주석에 이미 그 위험이 기록돼
 * 있음). 오늘은 "중앙 이전"까지만 하고, trace 문자열 전면 일반화는
 * 별도 작업으로 분리한다 — 여러 저장소를 동시에 고쳐야 하는 작업을
 * 이미 큰 이전 작업과 한 커밋에 섞으면 문제 발생 시 원인 분리가
 * 어려워진다.
 */

const _RAW = 'https://raw.githubusercontent.com/Openhash-Gopang/gopang/main/prompts/gov-tree/';
const _RAW_ROOT = 'https://raw.githubusercontent.com/Openhash-Gopang/gopang/main/prompts/';

// ── 고정 접두사(GOV-COMMON) + 배타적 L1 노드(DO-SP/NATIONAL-SP) 캐시 ──
let _govCommon = null;
let _doSpCache = null;
let _nationalSpCache = null;

async function _fetchText(path) {
  const r = await fetch(_RAW + path + '?t=' + Math.floor(Date.now() / 3600000)); // 1시간 캐시 버스팅
  if (!r.ok) throw new Error(`fetch 실패: ${path} (${r.status})`);
  return r.text();
}

// ── 도코드 해석 (2026-07-19 배선 — 하드코딩 제거) ──────────────────
// 기존엔 상수로 고정돼 있었다("두 번째 도가 온보딩되면 고쳐야 한다"고
// 스스로 예언해뒀던 부분). 지금은 province-master-data.json에 경기·
// 서울·부산 등 8개 도 레코드가 이미 조사돼 있으므로(2026-07-19 배선
// 작업 계기) 더 이상 미룰 이유가 없다.
//
// 결정 순서: (1) window.HONDI_PROVINCE_CODE — 배포 시점에 주입하는
// 명시적 오버라이드(예: gyeonggi.hondi.net처럼 도별 서브도메인을 둘
// 경우 그 배포의 index.html/webapp.html이 이 값을 설정). (2) 없으면
// 'jeju' — 현재 유일하게 배포된 jeju.hondi.net과 100% 하위호환.
//
// 아직 안 정한 것(사용자 판단 대기): 도별 서브도메인 다중 배포 vs
// 단일 라우터가 PDV 거주지/호스트명으로 도를 자동 판별하는 통합형 —
// 이 함수는 어느 쪽으로 가든 호출부를 다시 안 고쳐도 되게만 만든다.
function _resolveProvinceCode() {
  return (typeof window !== 'undefined' && window.HONDI_PROVINCE_CODE) || 'jeju';
}

// ── kgov(SP-10_kpublic, 전국 공통) 동적 로더 (2026-07-05 신설) ──────
// 주피터 지시: "kgov는 전국 공통 모듈, jeju는 제주도 특화 모듈이므로
// 기능이 중복되면 안 된다. 모든 지방(제주·서울·부산 등)은 kgov를
// 상속받는다." 이에 따라 도(道) 트리는 자체 GOV-COMMON-CORE를 발명하지
// 않고, 실제 K-Public 서비스(gopang/prompts/SP-10_kpublic_*.txt)를 있는
// 그대로 상속한다.
//
// 버전을 하드코딩하지 않고 gopang/prompts/manifest.json에서 매번 최신
// 키를 조회한다 — kgov 버전이 나중에 v2.3, v2.4로 올라가도 이 코드를
// 고칠 필요가 없다(하드코딩했다면 check_stale_refs.py가 잡아내려는
// "참조가 최신 버전을 안 따라감" 문제가 그대로 재발했을 것이다).
let _kgovSp = null;
async function _loadKgovSp() {
  if (_kgovSp) return _kgovSp;
  // ★ 2026-07-19 긴급 수정 ★ — 여기서 fetch하던 'manifest.json'은
  // prompts/ 밑에 존재한 적이 없다(실사 확인: raw.githubusercontent.com
  // 실제 라이브 URL 404). 즉 이 함수는 지금까지 매 요청마다 예외를
  // 던졌고, webapp.html의 catch가 SP_FALLBACK(한 줄짜리 최소 안내문)으로
  // 조용히 대체해왔다 — 크래시가 안 보여서 지금까지 발견되지 않았을
  // 뿐, 실질적으로 kgov·overlay·tree-protocol·DO-SP 전부가 로드된 적이
  // 없었을 가능성이 높다(오늘 추가한 HUMAN-AUTHORITY-GATE-SCHEMA 포함).
  // 올바른 파일은 prompts/sp-catalog.json(CI가 매 push마다 갱신,
  // 실제 라이브 확인 완료) — 키 구조는 동일하다.
  const manifestRaw = await fetch(_RAW_ROOT + 'sp-catalog.json?t=' + Math.floor(Date.now() / 3600000));
  if (!manifestRaw.ok) throw new Error(`[Jeju] gopang sp-catalog.json fetch 실패 (${manifestRaw.status})`);
  const manifest = await manifestRaw.json();
  const fname = manifest['SP-10_kpublic'];
  if (!fname) throw new Error('[Jeju] sp-catalog.json에 SP-10_kpublic 키 없음 — kgov SP를 찾을 수 없음');
  const r = await fetch(_RAW_ROOT + fname + '?t=' + Math.floor(Date.now() / 3600000));
  if (!r.ok) throw new Error(`[Jeju] kgov SP(${fname}) fetch 실패 (${r.status})`);
  _kgovSp = await r.text();
  return _kgovSp;
}

let _jejuTreeProtocol = null;
async function _loadJejuTreeProtocol() {
  if (!_jejuTreeProtocol) _jejuTreeProtocol = await _fetchText('00-common/JEJU-TREE-PROTOCOL_v1.0.md');
  return _jejuTreeProtocol;
}

let _govCommonOverlayMasterData = null;
async function _loadGovCommonOverlayMasterData() {
  if (!_govCommonOverlayMasterData) {
    const raw = await _fetchText('00-common/overlays/gov-common-overlay-master-data.json');
    _govCommonOverlayMasterData = JSON.parse(raw).도목록;
  }
  return _govCommonOverlayMasterData;
}
function _renderGovCommonOverlay(template, rec) {
  return template
    .replaceAll('{도이름}', rec.도이름 || '')
    .replaceAll('{콜센터명}', rec.콜센터명 || '')
    .replaceAll('{콜센터번호}', rec.콜센터번호 || '')
    .replaceAll('{출자기관예시_문구}', rec.출자기관예시_문구 || '')
    .replaceAll('{행정시목록_문구}', rec.행정시목록_문구 || '')
    .replaceAll('{관할예시_문구}', rec.관할예시_문구 || '');
}

async function _loadGovCommon() {
  // 2026-07-05: GOV-COMMON-CORE(자체 발명한 "전국 공통 원칙") 폐기.
  // kgov(전국 공통, 실사용 중인 K-Public SP) + OVERLAY(도별 사실) +
  // JEJU-TREE-PROTOCOL(도 트리 전용 기술 프로토콜)로 대체 — 캐시 변수
  // (_govCommon)는 조합된 최종 문자열을 저장하므로 이 함수를 호출하는
  // 다른 코드는 전혀 수정할 필요가 없다(내부만 바뀜).
  //
  // 2026-07-19 — HUMAN-AUTHORITY-GATE-SCHEMA(G1~G19) 동적 삽입 신설.
  // 사고실험(AC-EXPERT-PARITY-THOUGHT-EXPERIMENT_2026-07-19.md)에서
  // 발견: 이 문서는 지금까지 "개별 SP 작성 시 §CAPABILITIES 뒤에
  // 수동 복붙하라"는 저작 지침으로만 존재했고, 실제 ~100개 기관 SP
  // 어디에도 반영된 적이 없었다(kgov는 인용만 함). 전문가 페르소나가
  // SP_common_guardrails를 매 호출마다 자동 합성하는 것과 동일한
  // 원칙을 적용 — 개별 SP 100개를 고치는 대신 여기 한 곳에서 kgov
  // 바로 뒤에 끼워 넣는다(kgov §준수 문서가 지시한 삽입 위치 —
  // "§CAPABILITIES 뒤" — 와 동등한 효과: 정체성/능력 정의 직후).
  if (!_govCommon) {
    const provinceCode = _resolveProvinceCode();
    const [kgov, gateSchema, overlayTemplate, overlayRecords, treeProtocol] = await Promise.all([
      _loadKgovSp(),
      _fetchText('08-schema/HUMAN-AUTHORITY-GATE-SCHEMA_v1_4.md'),
      _fetchText('00-common/overlays/GOV-COMMON-OVERLAY-TEMPLATE_v1.1.md'),
      _loadGovCommonOverlayMasterData(),
      _loadJejuTreeProtocol(),
    ]);
    const rec = overlayRecords.find(r => r.도코드 === provinceCode);
    if (!rec) throw new Error(`[Jeju] GOV-COMMON-OVERLAY 데이터 없음(도코드=${provinceCode})`);
    const overlay = _renderGovCommonOverlay(overlayTemplate, rec);
    _govCommon = kgov + '\n\n---\n\n' + gateSchema + '\n\n---\n\n' + overlay + '\n\n---\n\n' + treeProtocol;
  }
  return _govCommon;
}

// ── L1(SP-DO-000) 로딩 — SP-PROVINCE-TEMPLATE 렌더링으로 전환 (2026-07-19) ──
// 기존엔 제주 정적 파일(JEJU-DO-SP_v1.5.md) 하나만 fetch했다. 이제
// province-master-data.json에 도코드 레코드가 있으면 템플릿을 렌더링해
// 쓰고, 레코드가 없으면(아직 온보딩 안 된 도, 또는 jeju 자신의 데이터
// 로드 실패 시) 기존 정적 파일로 폴백한다 — L2/시/국가기관 로더가 이미
// 쓰고 있는 "템플릿 우선, 정적 파일 폴백" 패턴(_fetchDeptText 등)과
// 동일 철학. jeju는 두 경로 모두 존재하므로(province-master-data.json에
// jeju 레코드 신설 완료) 정상 케이스에서는 템플릿 경로를 탄다.
let _provinceMasterData = null;
async function _loadProvinceMasterData() {
  if (!_provinceMasterData) {
    const raw = await _fetchText('01-do/templates/province-master-data.json');
    _provinceMasterData = JSON.parse(raw).도목록;
  }
  return _provinceMasterData;
}
function _renderProvinceTemplate(template, rec) {
  return template
    .replaceAll('{도이름}', rec.도이름 || '')
    .replaceAll('{도코드}', rec.도코드 || '')
    .replaceAll('{통치구조_문구}', rec.통치구조_문구 || '')
    .replaceAll('{이원화_문구}', rec.이원화_문구 || '')
    .replaceAll('{인접기관_문구}', rec.인접기관_문구 || '')
    .replaceAll('{광역출력_문구}', rec.광역출력_문구 || '')
    .replaceAll('{위임사무_문구}', rec.위임사무_문구 || '')
    .replaceAll('{하위SP_접두어}', rec.하위SP_접두어 || '')
    .replaceAll('{유의사항_추가}', rec.유의사항_추가 || '');
}
async function _loadDoSp() {
  if (_doSpCache) return _doSpCache;
  const provinceCode = _resolveProvinceCode();
  try {
    const [template, records] = await Promise.all([
      _fetchText('01-do/templates/SP-PROVINCE-TEMPLATE_v1.1.md'),
      _loadProvinceMasterData(),
    ]);
    const rec = records.find(r => r.도코드 === provinceCode);
    if (!rec) throw new Error(`province-master-data.json에 도코드=${provinceCode} 레코드 없음`);
    _doSpCache = _renderProvinceTemplate(template, rec);
  } catch (e) {
    console.warn(`[Jeju] SP-PROVINCE-TEMPLATE 렌더링 실패(${e.message}) — 정적 파일로 폴백`);
    _doSpCache = await _fetchText('01-do/JEJU-DO-SP_v1.5.md');
  }
  return _doSpCache;
}

let _natOverlayMasterData = null;
async function _loadNatOverlayMasterData() {
  if (!_natOverlayMasterData) {
    const raw = await _fetchText('09-national/overlays/national-sp-overlay-master-data.json');
    _natOverlayMasterData = JSON.parse(raw).도목록;
  }
  return _natOverlayMasterData;
}
function _renderNatOverlay(template, rec) {
  return template.replaceAll('{도이름}', rec.도이름 || '');
}

// 구 JEJU-NATIONAL-SP §3(라우팅 테이블)·§6(레지스트리)에 해당하던 내용을
// national-agency-master-data.json에서 매번 동적으로 생성한다 — 정적
// 텍스트로 유지하다가 실제 완료 상태(28/28)와 어긋나 있었던 버그(2026-07-04
// 발견)가 구조적으로 재발하지 않도록 하는 게 목적이다.
function _renderNatCatalogSection(records, provinceCode) {
  const rows = records.filter(r => r.도코드 === provinceCode);
  const tableRows = rows.map(r =>
    `| SP-NAT-${r.domain.toUpperCase()} | ${r.지사명} | ${r.소속부처 || ''} |`
  ).join('\n');
  return (
    `## §3. 라우팅 테이블 (national-agency-master-data.json 기준, 매 요청 시 동적 생성)\n\n` +
    `| 코드 | 기관명 | 소속 |\n|---|---|---|\n${tableRows}\n\n` +
    `위 ${rows.length}개 기관 전부 개별 SP 작성이 완료된 상태다(§4 공통 폴백은 향후 신규 등록 기관을 위한 대비책으로만 유지).\n\n` +
    `## §6. 하위 SP 레지스트리\n\n` +
    `| 코드 | 상태 |\n|---|---|\n` +
    rows.map(r => `| SP-NAT-${r.domain.toUpperCase()} | ✅ 완료 |`).join('\n')
  );
}

async function _loadNationalSp() {
  if (!_nationalSpCache) {
    const provinceCode = _resolveProvinceCode();
    const [core, overlayTemplate, overlayRecords, natRecords] = await Promise.all([
      _fetchText('09-national/NATIONAL-SP-CORE_v1.2.md'),
      _fetchText('09-national/overlays/NATIONAL-SP-OVERLAY-TEMPLATE_v1.0.md'),
      _loadNatOverlayMasterData(),
      _loadNatMasterData(),
    ]);
    const overlayRec = overlayRecords.find(r => r.도코드 === provinceCode);
    if (!overlayRec) throw new Error(`[Jeju] NATIONAL-SP-OVERLAY 데이터 없음(도코드=${provinceCode})`);
    const overlay = _renderNatOverlay(overlayTemplate, overlayRec);
    const catalogSection = _renderNatCatalogSection(natRecords, provinceCode);
    _nationalSpCache = core + '\n\n---\n\n' + overlay + '\n\n---\n\n' + catalogSection;
  }
  return _nationalSpCache;
}

// ── L2 라우팅 테이블 (JEJU-DO-SP §3-1/§3-2/§3-3과 동기화) ─────
// 각 항목: 코드, 파일 경로, 매칭 키워드. 여러 항목이 매칭되면 키워드
// 개수가 가장 많이 일치하는 쪽을 우선한다(단순 스코어링 — v1.1에서
// LLM 기반 분류로 고도화 검토).
const JEJU_L2_TABLE = [
  { code: 'SP-DO-PLAN',     file: '02-do-dept/SP-DO-PLAN_v1.1.md',
    domain: 'plan', 도코드: 'jeju',
    kw: ['기획조정실', '고향사랑기부', '세정', '지방세', '취득세', '재산세', '청년정책', '인구정책', '예산', '기획'] },
  { code: 'SP-DO-SAFETY',   file: '02-do-dept/SP-DO-SAFETY_v1.1.md',
    domain: 'safety', 도코드: 'jeju',
    kw: ['안전건강실', '재난', '태풍', '호우', '보건정책', '감염병', '예방접종', '응급의료', '안전', '재난', '보건'] },
  { code: 'SP-DO-JACHI',    file: '02-do-dept/SP-DO-JACHI_v1.1.md',
    domain: 'jachi', 도코드: 'jeju',
    kw: ['특별자치행정국', '특별자치', '자치분권', '제주특별법'] },
  { code: 'SP-DO-ECON',     file: '02-do-dept/SP-DO-ECON_v1.1.md',
    domain: 'econ', 도코드: 'jeju',
    kw: ['경제활력국', '소상공인', '자영업', '중소기업', '일자리', '정책자금', '경제'] },
  { code: 'SP-DO-INNOV',    file: '02-do-dept/SP-DO-INNOV_v1.1.md',
    domain: 'innov', 도코드: 'jeju',
    kw: ['혁신산업국', '신재생', '풍력', '태양광', '디지털', 'AI산업', '스타트업', '산업'] },
  // 2026-07-04: 도 부서 13개 전부 템플릿+데이터 방식으로 이전 완료
  // (WELFARE로 시작한 proof of concept을 나머지 12개까지 확장). domain/
  // 도코드가 있으면 static file 대신 템플릿을 렌더링한다 — file은 하위
  // 호환/디버깅용 폴백으로만 남겨둔다(데이터 레코드가 없으면 여기로 폴백).
  { code: 'SP-DO-WELFARE',  file: '02-do-dept/SP-DO-WELFARE_v1.2.md',
    domain: 'welfare', 도코드: 'jeju',
    kw: ['복지가족국', '보건복지여성국', '기초생활수급', '기초연금', '보육료', '어린이집', '장애인복지', '한부모',
         '복지', '임신', '출산', '육아', '보육', '장애인', '여성가족'] },
  { code: 'SP-DO-CLIMATE',  file: '02-do-dept/SP-DO-CLIMATE_v1.1.md',
    domain: 'climate', 도코드: 'jeju',
    kw: ['기후환경국', '전기차', '탄소중립', '환경영향평가', '클린하우스', '분리배출', '폐기물', '환경'] },
  { code: 'SP-DO-HOUSING',  file: '02-do-dept/SP-DO-HOUSING_v1.1.md',
    domain: 'housing', 도코드: 'jeju',
    kw: ['건설주택국', '공공임대주택', '건축허가', '건축인허가', '주택', '건축'] },
  { code: 'SP-DO-TRANSPORT',file: '02-do-dept/SP-DO-TRANSPORT_v1.1.md',
    domain: 'transport', 도코드: 'jeju',
    kw: ['교통항공국', '버스', '준공영제', '교통약자', '콜택시', '공영주차장', '공항', '제2공항', '교통'] },
  { code: 'SP-DO-CULTURE',  file: '02-do-dept/SP-DO-CULTURE_v1.1.md',
    domain: 'culture', 도코드: 'jeju',
    kw: ['문화체육교육국', '생활체육', '평생교육', '평생학습', '문화예술', '체육', '도서관', '문화'] },
  { code: 'SP-DO-TOURISM',  file: '02-do-dept/SP-DO-TOURISM_v1.1.md',
    domain: 'tourism', 도코드: 'jeju',
    kw: ['관광교류국', '관광지', '숙박업', '게스트하우스', '여행업', '국제교류', '관광'] },
  { code: 'SP-DO-AGRI',     file: '02-do-dept/SP-DO-AGRI_v1.1.md',
    domain: 'agri', 도코드: 'jeju',
    kw: ['농축산식품국', '농업경영체', '공익직불금', '농산물재해보험', '축산', '농업', '농사'] },
  { code: 'SP-DO-OCEAN',    file: '02-do-dept/SP-DO-OCEAN_v1.1.md',
    domain: 'ocean', 도코드: 'jeju',
    kw: ['해양수산국', '어업면허', '마을어장', '수산업', '양식업', '어업', '수산'] },
];

const JEJU_CITY_TABLE = [
  { code: 'SP-CITY-JEJU',      file: '04-city/jeju/SP-CITY-JEJU_v1.1.md',
    도코드: 'jeju', 시코드: 'jejusi',
    kw: ['제주시', '제주시청'] },
  { code: 'SP-CITY-SEOGWIPO',  file: '04-city/seogwipo/SP-CITY-SEOGWIPO_v1.1.md',
    도코드: 'jeju', 시코드: 'seogwipo',
    kw: ['서귀포시', '서귀포시청'] },
];

// ── 국가기관 라우팅 테이블 (JEJU-NATIONAL-SP §3-1, 1차 배치 8개) ───
// 도청 트리(JEJU-DO-SP)와 형제 관계 — 매칭되면 DO-SP 대신 이쪽으로 간다.
// 지방세(도청)와 국세(세무서) 혼동 방지를 위해 '세금' 같은 범용어는 넣지
// 않고, 국가기관임이 분명한 고유명사만 트리거로 쓴다.
const JEJU_NATIONAL_TABLE = [
  { code: 'SP-NAT-TAX',          file: '09-national/agencies/SP-NAT-TAX_v1.2.md',
    domain: 'tax', 도코드: 'jeju',
    kw: ['세무서', '국세', '종합소득세', '부가가치세', '법인세', '홈택스'] },
  { code: 'SP-NAT-COURT',        file: '09-national/agencies/SP-NAT-COURT_v1.1.md',
    domain: 'court', 도코드: 'jeju',
    kw: ['지방법원', '등기소', '나의사건검색', '전자소송', '등기부등본'] },
  { code: 'SP-NAT-NPS',          file: '09-national/agencies/SP-NAT-NPS_v1.2.md',
    domain: 'nps', 도코드: 'jeju',
    kw: ['국민연금'] },
  { code: 'SP-NAT-NHIS',         file: '09-national/agencies/SP-NAT-NHIS_v1.2.md',
    domain: 'nhis', 도코드: 'jeju',
    kw: ['건강보험공단', '건강보험료', '건강검진'] },
  { code: 'SP-NAT-IMMIGRATION',  file: '09-national/agencies/SP-NAT-IMMIGRATION_v1.2.md',
    domain: 'immigration', 도코드: 'jeju',
    kw: ['출입국', '외국인청', '체류자격', '비자', '귀화', '하이코리아'] },
  { code: 'SP-NAT-POST',         file: '09-national/agencies/SP-NAT-POST_v1.1.md',
    domain: 'post', 도코드: 'jeju',
    kw: ['우체국', '우정청', '등기우편', '우편'] },
  { code: 'SP-NAT-POLICE',       file: '09-national/agencies/SP-NAT-POLICE_v1.1.md',
    domain: 'police', 도코드: 'jeju',
    kw: ['지방경찰청', '국가경찰', '112', '고소장', '수사'] },
  { code: 'SP-NAT-LABOR',        file: '09-national/agencies/SP-NAT-LABOR_v1.1.md',
    domain: 'labor', 도코드: 'jeju',
    kw: ['근로복지공단', '산재보험', '산업재해'] },
  { code: 'SP-NAT-PROSECUTION',  file: '09-national/agencies/SP-NAT-PROSECUTION_v1.1.md',
    domain: 'prosecution', 도코드: 'jeju',
    kw: ['검찰청', '고소장', '고발', '공소', '검사실'] },
  { code: 'SP-NAT-COASTGUARD',   file: '09-national/agencies/SP-NAT-COASTGUARD_v1.1.md',
    domain: 'coastguard', 도코드: 'jeju',
    kw: ['해양경찰', '122', '해양사고', '해양레저 안전'] },
  { code: 'SP-NAT-WEATHER',      file: '09-national/agencies/SP-NAT-WEATHER_v1.1.md',
    domain: 'weather', 도코드: 'jeju',
    kw: ['기상청', '기상특보', '태풍정보', '태풍 정보', '실시간 기상'] },
  { code: 'SP-NAT-PPS',          file: '09-national/agencies/SP-NAT-PPS_v1.1.md',
    domain: 'pps', 도코드: 'jeju',
    kw: ['조달청', '나라장터'] },
  { code: 'SP-NAT-MMA',          file: '09-national/agencies/SP-NAT-MMA_v1.1.md',
    domain: 'mma', 도코드: 'jeju',
    kw: ['병무청', '징병검사', '입영'] },
  { code: 'SP-NAT-VETERANS',     file: '09-national/agencies/SP-NAT-VETERANS_v1.1.md',
    domain: 'veterans', 도코드: 'jeju',
    kw: ['보훈청', '국가유공자', '보훈급여'] },
  { code: 'SP-NAT-LABORREL',     file: '09-national/agencies/SP-NAT-LABORREL_v1.1.md',
    domain: 'laborrel', 도코드: 'jeju',
    kw: ['노동위원회', '부당해고'] },
  { code: 'SP-NAT-PROBATION',    file: '09-national/agencies/SP-NAT-PROBATION_v1.1.md',
    domain: 'probation', 도코드: 'jeju',
    kw: ['보호관찰', '준법지원센터', '사회봉사명령'] },
  { code: 'SP-NAT-ANIMALQUARANTINE', file: '09-national/agencies/SP-NAT-ANIMALQUARANTINE_v1.1.md',
    domain: 'animalquarantine', 도코드: 'jeju',
    kw: ['동물검역', '가축검역', '반려동물 검역', '반려동물 동반', '축산물 반입'] },
  { code: 'SP-NAT-HUMANQUARANTINE',  file: '09-national/agencies/SP-NAT-HUMANQUARANTINE_v1.1.md',
    domain: 'humanquarantine', 도코드: 'jeju',
    kw: ['검역소', '해외감염병', '해외 출국 예방접종', '검역감염병'] },
  { code: 'SP-NAT-AGROQUALITY',  file: '09-national/agencies/SP-NAT-AGROQUALITY_v1.1.md',
    domain: 'agroquality', 도코드: 'jeju',
    kw: ['농산물품질관리원', '원산지표시', '친환경인증', '친환경 인증', 'GAP 인증'] },
  { code: 'SP-NAT-FISHQUALITY',  file: '09-national/agencies/SP-NAT-FISHQUALITY_v1.1.md',
    domain: 'fishquality', 도코드: 'jeju',
    kw: ['수산물품질관리원', '수산물 원산지', '수산물 검사'] },
  { code: 'SP-NAT-FOODIMPORT',   file: '09-national/agencies/SP-NAT-FOODIMPORT_v1.1.md',
    domain: 'foodimport', 도코드: 'jeju',
    kw: ['수입식품검사', '수입식품 통관'] },
  { code: 'SP-NAT-DATA',         file: '09-national/agencies/SP-NAT-DATA_v1.1.md',
    domain: 'data', 도코드: 'jeju',
    kw: ['공공데이터청', '공공데이터포털'] },
  { code: 'SP-NAT-RADIO',        file: '09-national/agencies/SP-NAT-RADIO_v1.1.md',
    domain: 'radio', 도코드: 'jeju',
    kw: ['전파관리소', '무선국'] },
  { code: 'SP-NAT-ENV',          file: '09-national/agencies/SP-NAT-ENV_v1.1.md',
    domain: 'env', 도코드: 'jeju',
    kw: ['영산강유역환경청', '환경영향평가'] },
  { code: 'SP-NAT-LABORIMPROVE', file: '09-national/agencies/SP-NAT-LABORIMPROVE_v1.1.md',
    domain: 'laborimprove', 도코드: 'jeju',
    kw: ['임금체불', '근로개선지도'] },
  { code: 'SP-NAT-INTERNET',     file: '09-national/agencies/SP-NAT-INTERNET_v1.1.md',
    domain: 'internet', 도코드: 'jeju',
    kw: ['스마트쉼센터', '인터넷과의존', '스마트폰과의존'] },
  { code: 'SP-NAT-AIRPORT',      file: '09-national/agencies/SP-NAT-AIRPORT_v1.1.md',
    domain: 'airport', 도코드: 'jeju',
    kw: ['공항공사', '제주국제공항 운영', '항공편', '제주공항', '비행기 출발', '비행기 도착', '공항 주차장', '공항 이용', '공항 분실물'] },
  { code: 'SP-NAT-PORT',         file: '09-national/agencies/SP-NAT-PORT_v1.1.md',
    domain: 'port', 도코드: 'jeju',
    kw: ['해양수산청', '선박등록', '해상교통관제'] },
];

// ── 카탈로그 등록만 되고 개별 SP는 아직 없는 국가기관 (§4 공통 폴백) ──
// v1.2: 28개 전 기관 SP 작성 완료로 이 목록은 현재 비어 있다. 향후 카탈로그에
// 새 기관이 추가되고 SP가 아직 없을 때를 위해 매커니즘은 유지한다.
const CATALOG_ONLY = [];

// ── 도별 라우팅 테이블 레지스트리 (2026-07-19 전국 확장 Phase 1) ────────
// province-master-data.json(도 단위 SP)과 같은 원칙을 L2(실·국)/시/국가기관
// 라우팅 테이블에도 적용한다 — 다른 도가 추가될 때 GYEONGGI_L2_TABLE 등을
// 새로 선언하고 여기 레지스트리에 키만 추가하면 된다(이 파일의 매칭
// 로직·호출부는 전혀 안 고쳐도 됨).
//
// 2026-07-19 확인 — do-dept-master-data.json에는 이미 gyeonggi(13개)·
// busan(13개) 부서 인스턴스(연락처 등 마스터데이터)가 존재한다. 그런데
// **그건 이 레지스트리와 다른 것**이다 — 여기 필요한 건 "어떤 키워드가
// 어느 부서로 라우팅되는가"이고, 그건 도마다 실사로 조사해야 하는
// 별개 데이터(Phase 2)다. do-dept-master-data.json에 레코드가 있다고
// 자동으로 라우팅 가능한 건 아니다 — 실사 없이 jeju의 키워드를 그대로
// 복붙해 gyeonggi/busan을 "작동하는 것처럼" 보이게 하지 않는다(허위
// 데이터를 실사로 위장하는 것보다, 미등록 상태를 정직하게 유지하는
// 게 낫다는 이 프로젝트의 반복된 원칙 — TBD 마커 관행과 동일).
const PROVINCE_TABLES = {
  jeju: { l2: JEJU_L2_TABLE, city: JEJU_CITY_TABLE, national: JEJU_NATIONAL_TABLE },
};
function _l2Table() { return PROVINCE_TABLES[_resolveProvinceCode()]?.l2 || []; }
function _cityTable() { return PROVINCE_TABLES[_resolveProvinceCode()]?.city || []; }
function _nationalTable() { return PROVINCE_TABLES[_resolveProvinceCode()]?.national || []; }

function _matchNational(text) {
  return _scoreMatch(text, _nationalTable());
}
function _matchCatalogOnly(text) {
  for (const c of CATALOG_ONLY) {
    if (c.kw.some(k => text.includes(k))) return c;
  }
  return null;
}
function _renderCatalogFallback(c) {
  return `[JEJU-NATIONAL-SP §4 공통 폴백]\n` +
    `${c.name}은(는) ${c.ministry}의 제주 지역 사무소로, 아직 이 SP가 상세 안내를 갖추지 못했습니다. ` +
    `${c.brief}을(를) 담당하며, 정확한 절차는 해당 기관 홈페이지 또는 정부24(gov.kr)에서 확인하시는 것을 권장합니다.`;
}

// ── LLM 기반 분류 폴백 (v1.2 신설) ──────────────────────────────
// 키워드 매칭은 빠르지만 "청년 월세 지원 있어요?"처럼 용건만 있고 고유
//명사가 없는 자연어, "자치경찰이랑 일반경찰 차이가 뭐예요" 같은 비교·설명
// 질문에는 원천적으로 약하다(사고실험에서 확인됨). 정규식을 계속 추가하는
// 두더지 잡기 대신, 키워드 매칭이 전부 실패했을 때만 LLM 자체에게 "이 43개
// 코드 중 뭐가 맞는지, 또는 특정 기관 없이 답할 수 있는 질문인지" 분류를
// 맡긴다 — 비용은 매칭 실패 시에만 발생(정상 케이스는 기존처럼 무료·즉시).
const ROUTE_DESCRIPTIONS = {
  'SP-DO-PLAN': '기획조정실 [지방세는 여기, 국세는 SP-NAT-TAX]',
  'SP-DO-SAFETY': '도민안전건강실(안전건강실)',
  'SP-DO-JACHI': '특별자치행정국 [제도 설명용 — 실제 자치경찰 사무는 SP-AGY-POLICE]',
  'SP-DO-ECON': '경제활력국',
  'SP-DO-INNOV': '혁신산업국',
  'SP-DO-WELFARE': '복지가족국(구 보건복지여성국)',
  'SP-DO-CLIMATE': '기후환경국',
  'SP-DO-HOUSING': '건설주택국',
  'SP-DO-TRANSPORT': '교통항공국',
  'SP-DO-CULTURE': '문화체육교육국',
  'SP-DO-TOURISM': '관광교류국',
  'SP-DO-AGRI': '농축산식품국',
  'SP-DO-OCEAN': '해양수산국',
  'SP-NAT-TAX': '제주세무서(국세청) [국세 — 지방세 아님]',
  'SP-NAT-COURT': '제주지방법원(법원행정처(사법부)) [실제 재판 절차 — K-Law(AI 판결 시뮬레이션)와 다름]',
  'SP-NAT-NPS': '국민연금공단 제주지역본부(보건복지부)',
  'SP-NAT-NHIS': '국민건강보험공단 제주지사(보건복지부)',
  'SP-NAT-IMMIGRATION': '제주출입국·외국인청(법무부)',
  'SP-NAT-POST': '제주지방우정청(우정사업본부(과학기술정보통신부))',
  'SP-NAT-POLICE': '제주지방경찰청(경찰청(국가경찰)) [국가경찰 — 형사·수사 전반]',
  'SP-NAT-LABOR': '근로복지공단 제주지사(고용노동부)',
  'SP-NAT-PROSECUTION': '제주지방검찰청(법무부(대검찰청)) [검찰 — 공소·기소. 경찰과 다름]',
  'SP-NAT-COASTGUARD': '제주해양경찰서(해양경찰청)',
  'SP-NAT-WEATHER': '제주지방기상청(기상청)',
  'SP-NAT-PPS': '제주지방조달청(조달청)',
  'SP-NAT-MMA': '제주지방병무청(병무청)',
  'SP-NAT-VETERANS': '제주보훈청(국가보훈부)',
  'SP-NAT-LABORREL': '제주지방노동위원회(고용노동부)',
  'SP-NAT-PROBATION': '제주준법지원센터(법무부(범죄예방정책국))',
  'SP-NAT-ANIMALQUARANTINE': '농림축산검역본부 제주지역본부(농림축산식품부)',
  'SP-NAT-HUMANQUARANTINE': '국립제주검역소(질병관리청)',
  'SP-NAT-AGROQUALITY': '국립농산물품질관리원 제주지원(농림축산식품부)',
  'SP-NAT-FISHQUALITY': '국립수산물품질관리원 제주지원(해양수산부)',
  'SP-NAT-FOODIMPORT': '광주지방식품의약품안전청 제주수입식품검사소(식품의약품안전처)',
  'SP-NAT-DATA': '호남지방데이터청 제주사무소(국가데이터처)',
  'SP-NAT-RADIO': '제주전파관리소(과학기술정보통신부)',
  'SP-NAT-ENV': '영산강유역환경청 제주주재사무실(기후에너지환경부)',
  'SP-NAT-LABORIMPROVE': '광주지방고용노동청 제주근로개선지도센터(고용노동부)',
  'SP-NAT-INTERNET': '한국지능정보사회진흥원 제주스마트쉼센터(과학기술정보통신부/행정안전부)',
  'SP-NAT-AIRPORT': '한국공항공사 제주공항(국토교통부 산하 공기업)',
  'SP-NAT-PORT': '제주지방해양수산청(해양수산부)',
  'SP-CITY-JEJU': '제주시청',
  'SP-CITY-SEOGWIPO': '서귀포시청',
};

function _findTableEntry(code) {
  return _nationalTable().find(e => e.code === code)
    || _l2Table().find(e => e.code === code)
    || _cityTable().find(e => e.code === code)
    || null;
}

function _isNationalCode(code) {
  return _nationalTable().some(e => e.code === code);
}

// classifyFn: async (text, candidatesText) => 'SP-XXX-YYY' | 'NONE' | null
// webapp.html이 실제 LLM 호출로 구현해서 주입한다(라우터 자체는 네트워크 호출을
// 안 한다 — 기존 구조 유지). 주입 안 하면 그냥 기존처럼 무매칭으로 끝난다.
async function _classifyFallback(text, classifyFn) {
  if (!classifyFn) return null;
  const candidatesText = Object.entries(ROUTE_DESCRIPTIONS)
    .map(([code, d]) => `${code}: ${d}`).join('\n');
  try {
    const code = await classifyFn(text, candidatesText);
    if (!code || code === 'NONE' || !ROUTE_DESCRIPTIONS[code]) return null;
    return code;
  } catch (e) {
    console.warn('[Jeju] LLM 분류 폴백 실패:', e.message);
    return null;
  }
}

// ── EMD 데이터 로드 (한림 + 나머지 42개 병합) ───────────────────
// 2026-07-19 Phase 1 — L2/CITY/NATIONAL과 동일하게 도별 경로 레지스트리로
// 감쌌다. 지금은 jeju 값만 있고, 캐시 키도 provinceCode로 분리해뒀다 —
// 나중에 다른 도의 읍면동 데이터가 추가되면 이 함수 자체는 안 고치고
// EMD_PATHS에 키만 추가하면 된다.
const EMD_PATHS = {
  jeju: { master: '05-emd/emd-master-data.json', extra: ['05-emd/hallim/hallim-data.json'] },
};
const _emdRecordsByProvince = {};
async function _loadEmdRecords() {
  const provinceCode = _resolveProvinceCode();
  if (_emdRecordsByProvince[provinceCode]) return _emdRecordsByProvince[provinceCode];
  const paths = EMD_PATHS[provinceCode];
  if (!paths) { _emdRecordsByProvince[provinceCode] = []; return []; }
  const [masterRaw, ...extraRaws] = await Promise.all([
    _fetchText(paths.master),
    ...(paths.extra || []).map(p => _fetchText(p)),
  ]);
  const master = JSON.parse(masterRaw);
  const extras = extraRaws.map(r => JSON.parse(r));
  _emdRecordsByProvince[provinceCode] = [...master.읍면동목록, ...extras];
  return _emdRecordsByProvince[provinceCode];
}

// ── 텍스트에서 읍면동 매칭 ──────────────────────────────────────
// 1) 읍면동명 직접 언급, 2) 관할리목록에 있는 리(里) 이름 언급 순으로 확인.
function _matchEmd(text, records) {
  for (const rec of records) {
    if (text.includes(rec.읍면동명)) return rec;
  }
  for (const rec of records) {
    for (const ri of rec.관할리목록 || []) {
      const riName = ri.split('(')[0].trim(); // "한림리(한림1리·...)" → "한림리"
      if (riName && text.includes(riName)) return rec;
    }
  }
  return null;
}

function _matchCity(text) {
  for (const c of _cityTable()) {
    if (c.kw.some(k => text.includes(k))) return c;
  }
  return null;
}

function _scoreMatch(text, table) {
  let best = null, bestScore = 0;
  for (const entry of table) {
    const score = entry.kw.filter(k => text.includes(k)).length;
    if (score > bestScore) { best = entry; bestScore = score; }
  }
  return best;
}

// ── SP-EMD-TEMPLATE 렌더링 (변수 치환) ──────────────────────────
function _renderEmdTemplate(template, rec) {
  const teamRows = (rec.팀구성 || [])
    .map(t => `| ${t.팀} | ${t.업무} |`).join('\n');
  const linkedRows = (rec.접수전용업무 || [])
    .filter(x => x)
    .map(x => `| ${x.업무영역} | ${x.실질처리주체} | ${x.연결SP || '-'} |`).join('\n');

  return template
    .replaceAll('{읍면동명}', rec.읍면동명)
    .replaceAll('{행정시명}', rec.행정시명)
    .replaceAll('{읍면동구분}', rec.읍면동구분)
    .replaceAll('{청사주소}', rec.청사주소 || 'TBD — 재검증 필요')
    .replaceAll('{대표전화}', rec.대표전화 || 'TBD — 재검증 필요')
    .replaceAll('{운영시간}', rec.운영시간 || '평일 09:00~18:00 (점심 12:00~13:00), 무인민원발급기 24시간')
    .replaceAll('{관할리목록}', (rec.관할리목록 || []).join(', '))
    .replaceAll('{주력산업}', rec.주력산업 || '')
    .replaceAll('{무인발급기위치}', rec.무인발급기위치 || 'TBD — 재검증 필요')
    .replaceAll('{특이사항}', rec.특이사항 || '')
    + (teamRows ? `\n\n### 렌더링된 팀 구성\n| 팀 | 업무 |\n|---|---|\n${teamRows}` : '')
    + (linkedRows ? `\n\n### 렌더링된 연계 업무\n| 업무영역 | 실질 처리 주체 | 연결 SP |\n|---|---|---|\n${linkedRows}` : '');
}

// ── 도(道) 부서 템플릿 렌더링 (2026-07-04, EMD 템플릿과 동일 패턴) ──
// JEJU_L2_TABLE(또는 도별 테이블) 항목에 domain/도코드가 있으면 템플릿+데이터로 렌더링하고,
// 없으면(아직 이전 안 된 나머지 12개 부서) 기존 static file을 그대로
// fetch한다 — 한 번에 다 바꾸지 않고 부서 단위로 점진 이전하기 위함.
let _deptMasterData = null;
async function _loadDeptMasterData() {
  if (_deptMasterData) return _deptMasterData;
  const raw = await _fetchText('02-do-dept/templates/do-dept-master-data.json');
  _deptMasterData = JSON.parse(raw).부서목록;
  return _deptMasterData;
}

// 2026-07-19 신설 — city-dept는 지금까지 do-dept와 달리 별도 로더가 없었다
// (템플릿 렌더링 경로 자체가 아직 do-dept만큼 이전 안 됨). G18
// (STAFF_REVIEW_GATE) 연락처 조회에는 필요해서 최소한으로 추가.
let _cityDeptMasterData = null;
async function _loadCityDeptMasterData() {
  if (_cityDeptMasterData) return _cityDeptMasterData;
  const raw = await _fetchText('04-city/templates/city-dept-master-data.json');
  _cityDeptMasterData = JSON.parse(raw).국목록;
  return _cityDeptMasterData;
}

// ── G18(STAFF_REVIEW_GATE) 연락처 조회 (2026-07-19 신설) ──────────────
// LLM이 [STAFF_REVIEW_GATE: handler_code=...] 태그에 채워 넣는 값은
// 도메인 코드(welfare)·부서 한글명(복지가족국)·SP 코드(SP-DO-WELFARE)
// 중 무엇이든 될 수 있다 — 아직 이 셋을 하나로 강제하는 프롬프트 지시가
// 없으므로(§CAPABILITIES 뒤 삽입 문구가 예시를 안 줌), 셋 다 느슨하게
// 매칭한다. 매칭 실패 시 null — 호출부가 일반 안내 문구로 폴백해야 함.
export async function findStaffContact(handlerCode) {
  if (!handlerCode) return null;
  const norm = String(handlerCode).trim().toLowerCase();
  const hit = (...candidates) => candidates.some(c => {
    if (!c) return false;
    const cs = String(c).toLowerCase();
    return norm.includes(cs) || cs.includes(norm);
  });

  const [deptRecords, cityRecords, emdRecords] = await Promise.all([
    _loadDeptMasterData().catch(() => []),
    _loadCityDeptMasterData().catch(() => []),
    _loadEmdRecords().catch(() => []),
  ]);

  // 1순위 — 정확한 trace 코드 형식(resolveHandlerCodeFromTrace가 넘겨주는 값).
  // SP-DO-{DOMAIN}: 접두어 제거 후 domain과 대소문자 무관 정확히 일치.
  const doMatch = /^SP-DO-([A-Z]+)$/.exec(String(handlerCode).toUpperCase());
  if (doMatch) {
    const dept = deptRecords.find(r => String(r.domain || '').toUpperCase() === doMatch[1]);
    if (dept) return { name: dept.부서명, phone: dept.콜센터번호, hours: dept.콜센터운영시간 };
  }
  // SP-EMD-{읍면동명}: 접두어 제거 후 읍면동명과 정확히 일치.
  const emdMatch1 = /^SP-EMD-(.+)$/.exec(String(handlerCode));
  if (emdMatch1) {
    const emd = emdRecords.find(r => r.읍면동명 === emdMatch1[1]);
    if (emd) return { name: emd.읍면동명, phone: emd.대표전화, hours: emd.운영시간 };
  }
  // SP-CITY-{JEJU|SEOGWIPO}: 시코드로 city-dept 레코드 중 아무 국이나(대표
  // 연락처 성격) 우선 매칭 — city-dept-master-data.json은 국 단위라
  // "시 전체 대표 연락처"가 별도로 없으면 첫 매칭 국으로 폴백.
  const cityMatch1 = /^SP-CITY-(JEJU|SEOGWIPO)$/.exec(String(handlerCode).toUpperCase());
  if (cityMatch1) {
    const cityCodeMap = { JEJU: 'jejusi', SEOGWIPO: 'seogwipo' };
    const city = cityRecords.find(r => r.시코드 === cityCodeMap[cityMatch1[1]]);
    if (city) return { name: `${city.시이름 || ''} ${city.국이름 || ''}`.trim(), phone: city.콜센터번호, hours: city.콜센터운영시간 };
  }

  // 2순위 — LLM이 자유 서술한 값(한글 부서명 등) 대비 느슨한 매칭 폴백.
  const dept = deptRecords.find(r => hit(r.domain, r.부서명, `SP-DO-${String(r.domain || '').toUpperCase()}`));
  if (dept) return { name: dept.부서명, phone: dept.콜센터번호, hours: dept.콜센터운영시간 };

  const city = cityRecords.find(r => hit(r.국이름, r.시이름));
  if (city) return { name: `${city.시이름 || ''} ${city.국이름 || ''}`.trim(), phone: city.콜센터번호, hours: city.콜센터운영시간 };

  const emd = emdRecords.find(r => hit(r.읍면동명));
  if (emd) return { name: emd.읍면동명, phone: emd.대표전화, hours: emd.운영시간 };

  return null;
}

function _renderDeptTemplate(template, rec) {
  return template
    .replaceAll('{도이름}', rec.도이름 || '')
    .replaceAll('{부서명}', rec.부서명 || '')
    .replaceAll('{구명칭_문구}', rec.구명칭_문구 || '')
    .replaceAll('{산하과목록}', rec.산하과목록 || '')
    .replaceAll('{콜센터명}', rec.콜센터명 || '')
    .replaceAll('{콜센터번호}', rec.콜센터번호 || '')
    .replaceAll('{콜센터운영시간}', rec.콜센터운영시간 || '')
    // 2026-07-04 추가: §3 산하 출자·출연기관명 파라미터화(4개 도메인만 해당,
    // 나머지 도메인 템플릿엔 해당 자리표시자 자체가 없어 replaceAll이 무해하게 no-op)
    .replaceAll('{평생교육기관명}', rec.평생교육기관명 || '')
    .replaceAll('{신용보증기관명}', rec.신용보증기관명 || '')
    .replaceAll('{일자리기관명}', rec.일자리기관명 || '')
    .replaceAll('{경제진흥기관명}', rec.경제진흥기관명 || '')
    .replaceAll('{에너지공기업명}', rec.에너지공기업명 || '')
    .replaceAll('{관광공사명}', rec.관광공사명 || '')
    .replaceAll('{GOV_COMMON}', 'JEJU-GOV-COMMON')
    .replaceAll('{DO_ROOT_SP}', 'SP-DO-000');
}

// entry: JEJU_L2_TABLE(또는 도별 테이블)(또는 국가기관 테이블) 항목. domain+도코드가 있으면
// 템플릿을 렌더링해 반환하고, 없으면 기존처럼 static file을 그대로 반환.
async function _fetchDeptText(entry) {
  if (!entry.domain || !entry.도코드) return _fetchText(entry.file);
  const records = await _loadDeptMasterData();
  const rec = records.find(r => r.domain === entry.domain && r.도코드 === entry.도코드);
  if (!rec || !rec.template) {
    console.warn(`[Jeju] 부서 데이터 레코드/템플릿 없음(domain=${entry.domain}, 도코드=${entry.도코드}) — static file로 폴백`);
    return _fetchText(entry.file);
  }
  const template = await _fetchText(`02-do-dept/templates/${rec.template}`);
  return _renderDeptTemplate(template, rec);
}

// ── 국가기관(중앙정부 지역사무소) 템플릿 렌더링 (2026-07-04, 도 부서
// 템플릿과 동일 철학) — 소속 부처·정책 지식은 전국 공통 고정 텍스트,
// province별로 달라지는 건 관할 지역사무소 명칭(지사명)뿐이라 이것만
// 자리표시자로 뺀다. COURT처럼 지사 대표전화가 본문에 하드코딩된 예외
// 케이스는 개별 필드(대표전화)로 추가 파라미터화했다. ────────────────
let _natMasterData = null;
async function _loadNatMasterData() {
  if (_natMasterData) return _natMasterData;
  const raw = await _fetchText('09-national/agencies/templates/national-agency-master-data.json');
  _natMasterData = JSON.parse(raw).기관목록;
  return _natMasterData;
}

function _renderNatTemplate(template, rec) {
  return template
    .replaceAll('{지사명}', rec.지사명 || '')
    .replaceAll('{대표전화}', rec.대표전화 || '');
}

// entry: JEJU_NATIONAL_TABLE(또는 도별 국가기관 테이블) 항목. domain+도코드가 있으면 템플릿을 렌더링해
// 반환하고, 없으면 기존처럼 static file을 그대로 반환(_fetchDeptText와
// 동일한 폴백 철학).
async function _fetchNatText(entry) {
  if (!entry.domain || !entry.도코드) return _fetchText(entry.file);
  const records = await _loadNatMasterData();
  const rec = records.find(r => r.domain === entry.domain && r.도코드 === entry.도코드);
  if (!rec || !rec.template) {
    console.warn(`[Jeju] 국가기관 데이터 레코드/템플릿 없음(domain=${entry.domain}, 도코드=${entry.도코드}) — static file로 폴백`);
    return _fetchText(entry.file);
  }
  const template = await _fetchText(`09-national/agencies/templates/${rec.template}`);
  return _renderNatTemplate(template, rec);
}

// ── 시(市) 템플릿 렌더링 (2026-07-04, 도 부서 템플릿과 동일 철학이나
// 통치구조·상하수도 소관처럼 시마다 실제로 다른 서술까지 전부 데이터
// 필드로 뺀다 — 제주시·서귀포시조차 서로 다르다) ────────────────
let _cityMasterData = null;
async function _loadCityMasterData() {
  if (_cityMasterData) return _cityMasterData;
  const raw = await _fetchText('04-city/templates/city-master-data.json');
  _cityMasterData = JSON.parse(raw).시목록;
  return _cityMasterData;
}

function _renderCityTemplate(template, rec) {
  return template
    .replaceAll('{시이름}', rec.시이름 || '')
    .replaceAll('{통치구조_문구}', rec.통치구조_문구 || '')
    .replaceAll('{행정구역구성_문구}', rec.행정구역구성_문구 || '')
    .replaceAll('{관할읍면동목록}', rec.관할읍면동목록 || '')
    .replaceAll('{상하수도_capability_문구}', rec.상하수도_capability_문구 || '')
    .replaceAll('{상하수도_설명_문구}', rec.상하수도_설명_문구 || '')
    .replaceAll('{상하수도_예외_문구}', rec.상하수도_예외_문구 || '')
    .replaceAll('{유의사항_추가}', rec.유의사항_추가 || '')
    .replaceAll('{하위SP_접두어}', rec.하위SP_접두어 || '')
    .replaceAll('{GOV_COMMON}', 'JEJU-GOV-COMMON')
    .replaceAll('{DO_ROOT_SP}', 'SP-DO-000');
}

async function _fetchCityText(entry) {
  if (!entry.도코드 || !entry.시코드) return _fetchText(entry.file);
  const records = await _loadCityMasterData();
  const rec = records.find(r => r.도코드 === entry.도코드 && r.시코드 === entry.시코드);
  if (!rec) {
    console.warn(`[Jeju] 시 데이터 레코드 없음(도코드=${entry.도코드}, 시코드=${entry.시코드}) — static file로 폴백`);
    return _fetchText(entry.file);
  }
  const template = await _fetchText('04-city/templates/SP-CITY-TEMPLATE_v1.0.md');
  return _renderCityTemplate(template, rec);
}

// ── 응급 즉시 처리 (사고실험 2차 §3 권고 — 최우선, 다른 어떤 매칭보다 먼저) ──
// 분류 LLM 호출조차 기다리게 하면 안 되는 영역이라 순수 정규식으로만 판단하고,
// 애매하면 응급 쪽으로 분류한다(오탐 비용 < 누락 비용, SP-EXP-EMERGENCY §6).
const EMERGENCY_RE = /불\s*이?\s*났|불났|화재|가스.{0,4}(냄새|새는|누출|샌다)|쓰러지|심정지|의식.{0,3}없|숨.{0,3}(안\s*쉬|못\s*쉬)|피.{0,6}흘리|물에\s*빠|익수|침수|물이\s*차오|바다.{0,10}(안\s*보여|사라)|실종|없어졌어요|길을\s*잃|협박|스토킹|납치|칼을\s*들고|흉기|자해|자살|치인|치였|교통사고|지진|흔들려요|무너질|무너지|붕괴|침입했|낯선\s*사람.{0,6}(들어|침입)/;

function _isEmergency(text) {
  return EMERGENCY_RE.test(text);
}

// ── PDV_HISTORY_REQUEST(§13b) scope 결정 테이블 (2026-07-04d) ─────
// ★ scope 명명 원칙(전체 설명은 gopang/worker.js VALID_PDV_SCOPES 위 주석
// 참조): scope 이름에 지역명을 넣지 않는다 — 다른 지역도 같은 종류의
// 부서/기관을 가질 수 있으면 k 접두어 전국 scope로, 실제 구현 지역은
// worker.js SCOPE_SOURCE_MAP의 reporter_svc에만 반영한다. ★
// trace의 마지막 SP 코드를 이 표로 조회해 §13b 자리표시자를 치환한다.
// 국가기관 지사 26개(+ktax/kpolice)와 도 자체 부서 13개 전부 이 원칙에
// 따라 k 접두어(전국 scope)를 쓴다 — jeju는 그 scope들의 현재 유일한
// reporter_svc일 뿐이다.
const SP_CODE_TO_PDV_SCOPE = {
  // 국가기관 지사
  'SP-NAT-TAX': 'ktax', 'SP-NAT-POLICE': 'kpolice',
  'SP-NAT-COURT': 'kcourt', 'SP-NAT-NPS': 'knps', 'SP-NAT-NHIS': 'knhis',
  'SP-NAT-IMMIGRATION': 'kimmigration', 'SP-NAT-POST': 'kpost',
  'SP-NAT-LABOR': 'klabor', 'SP-NAT-PROSECUTION': 'kprosecution',
  'SP-NAT-COASTGUARD': 'kcoastguard', 'SP-NAT-WEATHER': 'kweather',
  'SP-NAT-PPS': 'kpps', 'SP-NAT-MMA': 'kmma', 'SP-NAT-VETERANS': 'kveterans',
  'SP-NAT-LABORREL': 'klaborrel', 'SP-NAT-PROBATION': 'kprobation',
  'SP-NAT-ANIMALQUARANTINE': 'kanimalquarantine', 'SP-NAT-HUMANQUARANTINE': 'khumanquarantine',
  'SP-NAT-AGROQUALITY': 'kagroquality', 'SP-NAT-FISHQUALITY': 'kfishquality',
  'SP-NAT-FOODIMPORT': 'kfoodimport', 'SP-NAT-DATA': 'kdata', 'SP-NAT-RADIO': 'kradio',
  'SP-NAT-ENV': 'kenv', 'SP-NAT-LABORIMPROVE': 'klaborimprove',
  'SP-NAT-INTERNET': 'kinternet', 'SP-NAT-AIRPORT': 'kairport', 'SP-NAT-PORT': 'kport',
  // 도 자체 부서
  'SP-DO-PLAN': 'kplan', 'SP-DO-SAFETY': 'ksafety', 'SP-DO-JACHI': 'kjachi',
  'SP-DO-ECON': 'kecon', 'SP-DO-INNOV': 'kinnov', 'SP-DO-WELFARE': 'kwelfare',
  'SP-DO-CLIMATE': 'kclimate', 'SP-DO-HOUSING': 'khousing', 'SP-DO-TRANSPORT': 'ktransport',
  'SP-DO-CULTURE': 'kculture', 'SP-DO-TOURISM': 'ktourism', 'SP-DO-AGRI': 'kagri',
  'SP-DO-OCEAN': 'kocean',
};
const _PDV_HISTORY_SCOPE_PLACEHOLDER_RE = /\{이 턴에 로드된 SP의 PDV scope\}/g;

// trace 배열에서 뒤에서부터 SP_CODE_TO_PDV_SCOPE에 등록된 코드를 찾는다
// (trace 끝쪽 요소일수록 더 구체적인 노드 — city/emd 코드는 지리 정보라
// 이 표에 없으므로 자연히 건너뛰고 그 앞의 부서/기관 코드를 찾게 된다).
function _resolvePdvScopeFromTrace(trace) {
  for (let i = trace.length - 1; i >= 0; i--) {
    if (SP_CODE_TO_PDV_SCOPE[trace[i]]) return SP_CODE_TO_PDV_SCOPE[trace[i]];
  }
  return 'pdv_general'; // 부서를 특정 못 한 경우(공통 레이어 응답 등)의 안전한 기본값
}


// ── 메인 진입점(내부용) ──────────────────────────────────────────
// userText: 사용자 발화(또는 GWP ctx로 넘어온 최초 요청 텍스트)
// pdvLocationHint: PDV에 저장된 거주 읍면동(있으면 우선 참조, JEJU-GOV-COMMON §2)
// 반환: { systemPrompt, trace } — trace는 디버깅/로그용 체인 경로
// 2026-07-04: export하던 함수를 내부용(_Raw)으로 이름 바꾸고, 실제 export는
// 아래의 얇은 래퍼가 담당한다 — §13b PDV_HISTORY_REQUEST 자리표시자 치환을
// 반환 지점이 8곳 넘게 흩어진 이 함수 내부를 전부 건드리지 않고 한 곳에서
// 처리하기 위함(호출부 입장에서 동작은 완전히 동일, 순수 후처리 wrapper).
async function _assembleGovSystemPromptRaw(userText, pdvLocationHint = null, classifyFn = null) {
  // 2026-07-05: UNIVERSAL-INTEGRITY를 여기서 fetch/삽입하던 걸 제거했다.
  // jeju-router.js는 이제 /ai/chat이 아니라 /gov/relay를 호출하고,
  // handleGovRelay()가 UNIVERSAL-INTEGRITY + UNIVERSAL-common(U9 포함)을
  // 항상 최상단에 서버측에서 붙인다(SP-COMMON-05 H2 원칙 — 클라이언트가
  // 공통 규칙을 빠뜨리거나 조작할 여지를 구조적으로 없앤다). 이 함수가
  // 반환하는 systemPrompt는 이제 "agencyPrompt"(JEJU-GOV-COMMON 이하)에
  // 해당하는 부분만 담당한다.
  const govCommon = await _loadGovCommon();
  const text = userText || '';
  const trace = ['JEJU-GOV-COMMON'];
  const parts = [govCommon].filter(Boolean);

  // -1) 응급 감지 — 다른 모든 매칭·분류보다 먼저, 무조건 최우선.
  if (_isEmergency(text)) {
    const emergencySp = await _fetchText('06-expert/SP-EXP-EMERGENCY_v1.0.md');
    parts.push(emergencySp);
    return {
      systemPrompt: parts.join('\n\n---\n\n'),
      trace: ['JEJU-GOV-COMMON', 'SP-EXP-EMERGENCY', '(응급 감지 — 최우선 즉시 처리)'],
    };
  }

  // 0) 국가기관 매칭 — JEJU-DO-SP(도청 트리)와 배타적인 형제 노드.
  //    매칭되면 도청 트리는 아예 로드하지 않는다(JEJU-NATIONAL-SP §0).
  const natMatch = _matchNational(text);
  if (natMatch) {
    const nationalSp = await _loadNationalSp();
    parts.push(nationalSp);
    trace.push('JEJU-NATIONAL-SP');
    const agencyText = await _fetchNatText(natMatch);
    parts.push(agencyText);
    trace.push(natMatch.code);
    return { systemPrompt: parts.join('\n\n---\n\n'), trace };
  }
  const catalogOnly = _matchCatalogOnly(text);
  if (catalogOnly) {
    const nationalSp = await _loadNationalSp();
    parts.push(nationalSp);
    parts.push(_renderCatalogFallback(catalogOnly));
    trace.push('JEJU-NATIONAL-SP', `(§4 공통 폴백: ${catalogOnly.name})`);
    return { systemPrompt: parts.join('\n\n---\n\n'), trace };
  }

  // 여기부터는 도청 트리(JEJU-DO-SP) — 국가기관이 아닌 것으로 판단됐으므로 로드.
  const doSp = await _loadDoSp();
  parts.push(doSp);
  trace.push('SP-DO-000');

  // L4 업무영역 SP 매칭 — 지금은 상하수도(SP-EXP-WATER) 하나뿐.
  // JEJU-GOV-COMMON §10(정직성·데이터 연동 공백 고지 원칙)의 첫 실증 사례.
  const isWaterQuery = /상수도|수돗물|누수|수질|정수|급수|배관/.test(text);
  async function _appendExpertIfMatched() {
    if (isWaterQuery) {
      const expText = await _fetchText('06-expert/SP-EXP-WATER_v1.1.md');
      parts.push(expText);
      trace.push('SP-EXP-WATER');
    }
  }

  // 1) 읍면동/리 이름이 직접 언급되면 규칙 B/C/F: 행정시 → 읍면동 체인
  const emdRecords = await _loadEmdRecords();
  let emdMatch = _matchEmd(text, emdRecords)
    || (pdvLocationHint ? _matchEmd(pdvLocationHint, emdRecords) : null);

  if (emdMatch) {
    const cityCode = emdMatch.행정시명 === '제주시' ? _cityTable()[0] : _cityTable()[1];
    const cityText = await _fetchCityText(cityCode);
    parts.push(cityText);
    trace.push(cityCode.code);

    // 서귀포시 + 상하수도 키워드 → 규칙 F: 읍면동 생략, 시청 직행 후 바로 SP-EXP-WATER
    if (cityCode.code === 'SP-CITY-SEOGWIPO' && isWaterQuery) {
      trace.push('(규칙 F: 서귀포 상하수도는 읍면동 생략)');
    } else {
      const emdTemplate = await _fetchText('05-emd/SP-EMD-TEMPLATE_v1.2.md');
      parts.push(_renderEmdTemplate(emdTemplate, emdMatch));
      trace.push(`SP-EMD-${emdMatch.읍면동명}`);
    }
    await _appendExpertIfMatched();

    return { systemPrompt: parts.join('\n\n---\n\n'), trace };
  }

  // 2) 행정시만 언급(읍면동 특정 안 됨) → 시청 레이어만
  const cityOnly = _matchCity(text);
  if (cityOnly) {
    const cityText = await _fetchCityText(cityOnly);
    parts.push(cityText);
    trace.push(cityOnly.code);
    await _appendExpertIfMatched();
    return { systemPrompt: parts.join('\n\n---\n\n'), trace };
  }

  // 3) 실국 키워드 매칭 → 규칙 A: 짧은 체인
  const divMatch = _scoreMatch(text, _l2Table());
  if (divMatch) {
    const divText = await _fetchDeptText(divMatch);
    parts.push(divText);
    trace.push(divMatch.code);
    await _appendExpertIfMatched();
    return { systemPrompt: parts.join('\n\n---\n\n'), trace };
  }

  // 4) 읍면동/실국 어느 쪽도 안 걸렸지만 업무영역만 매칭된 경우(예: 지역 언급 없이 "수돗물 냄새나요")
  if (isWaterQuery) {
    await _appendExpertIfMatched();
    trace.push('(지역 미특정 — SP-EXP-WATER가 먼저 지역 확인 유도)');
    return { systemPrompt: parts.join('\n\n---\n\n'), trace };
  }

  // 5) 키워드 매칭 전부 실패 — LLM 분류 폴백 시도 (classifyFn 주입된 경우만).
  // "청년 월세 지원 있어요?"처럼 고유명사 없는 용건형 질문, "자치경찰이랑
  // 일반경찰 차이가 뭐예요"처럼 비교·설명형 질문은 정규식으로 못 잡는다 —
  // 여기서 LLM 자신에게 43개 코드 중 하나를 고르거나 NONE(=이 GOV-COMMON
  // 레이어 지식만으로 답 가능)을 판단하게 한다.
  const classified = await _classifyFallback(text, classifyFn);
  if (classified) {
    if (_isNationalCode(classified)) {
      // 이미 parts에 SP-DO-000이 들어가 있으므로, 도청 트리를 걷어내고
      // 국가기관 트리로 다시 시작한다(JEJU-NATIONAL-SP §0: 배타적 형제 노드).
      const nationalOnlyParts = [govCommon];
      const nationalSp = await _loadNationalSp();
      nationalOnlyParts.push(nationalSp);
      const entry = _findTableEntry(classified);
      const agencyText = await _fetchNatText(entry);
      nationalOnlyParts.push(agencyText);
      return {
        systemPrompt: nationalOnlyParts.join('\n\n---\n\n'),
        trace: ['JEJU-GOV-COMMON', 'JEJU-NATIONAL-SP', classified, '(LLM 분류 폴백)'],
      };
    }
    const entry = _findTableEntry(classified);
    if (entry) {
      const entryText = await _fetchDeptText(entry);
      parts.push(entryText);
      trace.push(classified, '(LLM 분류 폴백)');
      await _appendExpertIfMatched();
      return { systemPrompt: parts.join('\n\n---\n\n'), trace };
    }
  }

  // 6) 그래도 안 걸리면(분류 결과 NONE 포함 — 비교·설명형 질문 등)
  // 도청 공통 레이어만 반환한다. 이건 실패가 아니라, 이런 질문은 원래
  // 특정 기관 SP 없이도 GOV-COMMON/DO-SP의 배경지식으로 충분히 답할 수
  // 있는 경우가 많다(예: 자치경찰 vs 국가경찰 차이 설명).
  trace.push(classifyFn ? '(LLM 분류도 NONE — 공통 레이어 지식으로 답변)' : '(L2 미매칭 — 공통 레이어가 일반 안내만 제공)');
  return { systemPrompt: parts.join('\n\n---\n\n'), trace };
}

// ── 메인 진입점(export) ──────────────────────────────────────────
// _assembleGovSystemPromptRaw의 결과를 받아 §13b(PDV_HISTORY_REQUEST)
// scope 자리표시자를 trace 기반으로 치환한 뒤 반환한다. GOV_AGENCIES
// 쪽(worker.js handleGovRelay)의 서버측 치환과 동일한 목적 — LLM이
// scope 값을 추측하지 않게 한다(2026-07-04, 사고실험에서 발견된
// police/public/911 scope 불일치 버그와 동일 계열 문제를 jeju에서는
// 애초에 만들지 않기 위함).
// trace를 보고 /gov/relay에 넘길 agency 값을 판정한다 — worker.js
// GOV_AGENCIES/SP_DELEGATION_REGISTRY의 'jeju_do'/'jeju_national'과
// 반드시 동일한 문자열이어야 한다(어긋나면 UNKNOWN_AGENCY로 조용히
// 거부되는 사고가 난다 — SP-00-ROUTER v5.1 manifest 누락과 동일 유형).
export function resolveGovAgency(trace) {
  return (trace || []).includes('JEJU-NATIONAL-SP') ? 'jeju_national' : 'jeju_do';
}
window.resolveGovAgency = resolveGovAgency;

// ── G18(STAFF_REVIEW_GATE) handler_code — LLM 출력이 아니라 trace에서 결정
// (2026-07-19, 사용자 지적으로 설계 변경) ──────────────────────────────
// 애초 계획은 "handler_code 형식을 스키마 문서에 못박는다"였다. 그런데
// 이건 결국 LLM이 형식을 정확히 지킬 거라는 가정에 다시 기대는 것이고,
// 이 프로젝트가 오늘만도 여러 번 겪은 "프롬프트 지시 준수 여부에 기능이
// 좌우되는" 취약점을 하나 더 추가하는 셈이다. 라우터는 이번 턴에 어느
// 부서/시/읍면동으로 실제 매칭했는지 trace로 이미 정확히 알고 있으므로
// (SP-DO-WELFARE, SP-CITY-JEJU, SP-EMD-한림읍 형식 — 전부 이 파일이
// 직접 만든 문자열), LLM의 handler_code는 "게이트를 트리거했다"는 신호로만
// 쓰고, 실제 대상은 trace의 가장 구체적인(마지막) 노드에서 결정한다.
// SP-DO-000/JEJU-GOV-COMMON 같은 공통 레이어 노드는 "담당자"가 아니므로
// 건너뛰고, 실제 업무 단위(SP-DO-{domain}/SP-CITY-*/SP-EMD-*/SP-NAT-*)만
// 후보로 삼는다.
export function resolveHandlerCodeFromTrace(trace) {
  if (!Array.isArray(trace)) return null;
  for (let i = trace.length - 1; i >= 0; i--) {
    const t = trace[i];
    if (/^SP-(DO|CITY|EMD|NAT)-/.test(t)) return t;
  }
  return null;
}
window.resolveHandlerCodeFromTrace = resolveHandlerCodeFromTrace;

export async function assembleGovSystemPrompt(userText, pdvLocationHint = null, classifyFn = null) {
  const result = await _assembleGovSystemPromptRaw(userText, pdvLocationHint, classifyFn);
  if (!_PDV_HISTORY_SCOPE_PLACEHOLDER_RE.test(result.systemPrompt)) return result;
  const scope = _resolvePdvScopeFromTrace(result.trace);
  return {
    ...result,
    systemPrompt: result.systemPrompt.replace(_PDV_HISTORY_SCOPE_PLACEHOLDER_RE, scope),
  };
}

window.assembleGovSystemPrompt = assembleGovSystemPrompt;
