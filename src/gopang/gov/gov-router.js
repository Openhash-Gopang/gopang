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
// ★ 2026-07-20 수정 — 이전엔 도 하나만 담는 단일 변수였다. 발화마다
// 도가 바뀌는 지금 구조(백지화 이후)에서는 두 번째 도 질문에 첫 번째
// 도의 캐시된 내용이 잘못 나가는 버그였다 — 도코드별 Map으로 전환.
const _govCommonByProvince = new Map();
const _doSpCacheByProvince = new Map();
const _nationalSpCacheByProvince = new Map();

async function _fetchText(path) {
  const r = await fetch(_RAW + path + '?t=' + Math.floor(Date.now() / 3600000)); // 1시간 캐시 버스팅
  if (!r.ok) throw new Error(`fetch 실패: ${path} (${r.status})`);
  return r.text();
}

// ── 시군구명 → 도코드 역매핑 (지연 로드, 세션당 1회) ────────────────
// sigungu-national-list.json(2026-07-20 신설)을 재사용 — 226개+시군구
// 명칭·소속 목록.
let _sigunguListCache = null;
async function _loadSigunguListForProvinceGuess() {
  if (_sigunguListCache) return _sigunguListCache;
  try {
    const r = await fetch('https://raw.githubusercontent.com/Openhash-Gopang/gopang/main/'
      + 'src/gopang/gov/sigungu-national-list.json?t=' + Math.floor(Date.now() / 3600000));
    const data = await r.json();
    _sigunguListCache = data.시군구목록 || [];
  } catch (e) {
    console.warn('[gov-router] 시군구 목록 로드 실패(도 판별에 시군구명 매칭 없이 진행):', e.message);
    _sigunguListCache = [];
  }
  return _sigunguListCache;
}

// 도 이름(전체·축약형) → 내부 도코드. ★ 동명이인 충돌 위험이 있는
// 짧은 형태(예: 그냥 '광주'는 전남광주통합특별시의 구 광주광역시 ·
// 경기도 광주시 둘 다와 겹침)는 일부러 뺐다 — 그런 경우는 시군구명
// 역매핑(아래, 시군구 목록에 도코드까지 정확히 있음)에 맡긴다.
const PROVINCE_NAME_TO_CODE = {
  '제주특별자치도': 'jeju', '제주도': 'jeju', '제주': 'jeju',
  '부산광역시': 'busan', '부산': 'busan',
  '경기도': 'gyeonggi', '경기': 'gyeonggi',
  '서울특별시': 'seoul', '서울': 'seoul',
  '전남광주통합특별시': 'jeonnam-gwangju',
  // ★ 2026-07-24 수정 — "광주광역시"(사용자가 실제로 쓰는 현재 명칭)가
  // 누락돼 있었다. 짧은 '광주'는 기존 설계 의도(경기도 광주시와 충돌
  // 위험)대로 계속 배제하지만, "광주광역시"는 전체 명칭이라 경기도
  // 광주시와 겹칠 일이 없다(경기도 쪽은 "경기도 광주시"/"광주시"로만
  // 불리지 "광주광역시"로 불리지 않는다) — 안전하게 추가 가능.
  '광주광역시': 'jeonnam-gwangju',
  '대구광역시': 'daegu', '대구': 'daegu',
  '인천광역시': 'incheon', '인천': 'incheon',
  '대전광역시': 'daejeon', '대전': 'daejeon',
  '울산광역시': 'ulsan', '울산': 'ulsan',
  '세종특별자치시': 'sejong', '세종': 'sejong',
  '강원특별자치도': 'gangwon', '강원도': 'gangwon', '강원': 'gangwon',
  '충청북도': 'chungbuk', '충북': 'chungbuk',
  '충청남도': 'chungnam', '충남': 'chungnam',
  '전북특별자치도': 'jeonbuk', '전라북도': 'jeonbuk', '전북': 'jeonbuk',
  '경상북도': 'gyeongbuk', '경북': 'gyeongbuk',
  '경상남도': 'gyeongnam', '경남': 'gyeongnam',
};

// ── 일반구(법인격 없는 구) → 도코드 역매핑 (2026-07-24 신설) ────────────
// 일반구는 지방자치법상 기초자치단체가 아니라서(자치구와 달리 법인격이
// 없음) sigungu-national-list.json(기초자치단체 전용 목록)에 의도적으로
// 빠져 있다 — 그 목록에 끼워 넣으면 그 파일의 정의 자체가 흐려진다.
// 대신 이 별도의 작은 표를 둔다. 지금은 창원시 산하 5개 일반구만 채워져
// 있다(2026-07-24 진주·창원·산청군 파일럿) — 다른 도의 일반구(예: 청주시
// 상당구·성남시 분당구)가 인스턴스화되면 여기에 추가한다.
const GENERAL_WARD_TO_PROVINCE = {
  '의창구': 'gyeongnam', '성산구': 'gyeongnam', '마산합포구': 'gyeongnam',
  '마산회원구': 'gyeongnam', '진해구': 'gyeongnam',
};

function _guessProvinceFromText(text, sigunguList, emdNameIndex) {
  // ★ 2026-07-24 수정(주피터 지시 이후 부산 1단계 확대 회귀검증에서 발견) —
  // 예전엔 "도 이름"(1순위)과 "시군구명"(2순위)을 별개 우선순위로 나눠
  // 도 이름을 항상 먼저 검사했다. 그런데 "해운대구"에 대구광역시 짧은
  // 이름 '대구'가 부분문자열로 포함돼 있어서, 2순위(시군구 목록, '해운대구'
  // → 부산광역시)까지 가지도 못하고 1순위에서 대구로 오판별됐다 — 옛
  // 주석의 "짧은 이름이 긴 이름의 부분문자열인 경우는 없다"는 가정 자체가
  // 틀렸던 것이다. 이제 두 후보군을 합쳐 **가장 긴(가장 구체적인) 일치
  // 문자열이 이기도록** 단일 패스로 처리한다 — 이러면 이런 부분문자열
  // 충돌 클래스 전체가 구조적으로 해소된다(개별 예외 등록 불필요).
  const candidates = [];
  for (const [name, code] of Object.entries(PROVINCE_NAME_TO_CODE)) candidates.push({ name, code });
  if (sigunguList && sigunguList.length) {
    for (const rec of sigunguList) {
      const code = rec.이름 && PROVINCE_NAME_TO_CODE[rec.광역];
      if (code) candidates.push({ name: rec.이름, code });
    }
  }
  candidates.sort((a, b) => b.name.length - a.name.length);
  for (const { name, code } of candidates) {
    if (text.includes(name)) return code;
  }
  // 2.5순위(2026-07-24 신설) — 일반구명 역매핑. 일반구는 기초자치단체가
  // 아니라 위 목록(sigunguList)에 없으므로 별도 표에서 찾는다. 일반구
  // 이름은 자치구와 겹치지 않는 고유명이라 별도 tier로 둬도 위 충돌
  // 클래스에 해당하지 않는다(다만 향후 겹치는 사례가 생기면 위 candidates
  // 병합 방식으로 흡수할 것).
  for (const [name, code] of Object.entries(GENERAL_WARD_TO_PROVINCE)) {
    if (text.includes(name)) return code;
  }
  // 3순위(2026-07-21 신설, 버그3 수정) — 읍/면/동명 역매핑. 상위 시/군/구·
  // 도 이름 없이 읍면동만 언급해도(예: "한경면 전입신고") 판별되게 한다.
  // EMD_PATHS가 있는 도(현재 jeju)에 한해서만 가능 — 다른 도에 EMD
  // 데이터가 실사되면 자동으로 확장된다.
  if (emdNameIndex) {
    for (const [name, code] of Object.entries(emdNameIndex)) {
      if (text.includes(name)) return code;
    }
  }
  return null;
}

// ── 도코드 해석 (2026-07-20 재설계 — 백지화, 'jeju' 하드코딩 기본값
// 제거) ──────────────────────────────────────────────────────
// 주피터 지시: "제주는 전체 광역시도 중 하나일 뿐입니다. 완전히
// 걷어내고, 백지 상태에서 사용자의 발화에 대응하는 광역시도 및
// 시군구를 결정하도록 수정하십시오."
//
// 결정 순서: (1) window.HONDI_PROVINCE_CODE — 배포 시점 명시적
// 오버라이드(도별 서브도메인 등, 최우선 유지). (2) 이번 요청의 사용자
// 발화에서 도/시군구 이름을 인식해 판별 — _assembleGovSystemPromptRaw
// 시작 시점에 미리 계산해 _currentResolvedProvinceCode에 저장한다
// (이 함수 자체는 동기 함수로 유지 — 호출부가 많아 시그니처를 바꾸면
// 파급이 크다). (3) 그래도 못 정하면 'jeju' — 더 이상 "의도된
// 기본값"이 아니라 "신호 없을 때의 최후 폴백"일 뿐이다(제주가
// 특별해서가 아니라 데이터가 가장 완비된 인스턴스라 안전망으로 씀).
let _currentResolvedProvinceCode = null;
function _resolveProvinceCode() {
  if (typeof window !== 'undefined' && window.HONDI_PROVINCE_CODE) return window.HONDI_PROVINCE_CODE;
  // ★ 2026-07-21 — 'jeju' 최후 기본값 제거(주피터 지시: jeju 중심 →
  // 전국 중심 전환). #26 이후 정상 흐름은 이 지점에 도달하기 전
  // _assembleGovSystemPromptRaw의 -0.5단계에서 이미 "지역 미판별"로
  // 조기 반환하므로, 이 함수가 null을 반환해도 호출부는 안전하다.
  return _currentResolvedProvinceCode || null;
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

// ── SP-COMMON-02(K-전문직 AI 공통 추론 아키텍처) 동적 로더 (2026-07-21 신설) ──
// 주피터 지시: "모든 클래스(원형)에 '인스턴스는 반드시 전문가 AI 페르소나와
// 동등한 방식으로, 동일한 태도로 사용자 요청에 응해야 한다'고 명시하십시오.
// 전문가 AI 페르소나의 상위 SP를 정부 기관 클래스의 상위 SP로 하십시오."
//
// SP_common_guardrails(=SP-COMMON-02) v3.14 changelog에 이미 이 질문이
// 기록돼 있었다 — "K-Service·공공기관 AC에도 동일 원칙이 적용돼야
// 하는가"라는 지적에, 그때는 핵심 원칙(C44)만 UNIVERSAL-common으로
// 옮기고 나머지는 EXPERT 전용(expert-session.js에서만 로드)으로 남겨
// 뒀다(실사 결과: "이 문서는 K-Service·공공기관 AC·개인 AC 경로에는
// 연결돼 있지 않음을 확인"). 오늘 그 공백을 메운다.
//
// _loadKgovSp()와 완전히 동일한 패턴 — 버전을 하드코딩하지 않고
// sp-catalog.json에서 매번 최신 키를 조회한다(60개 전문가 페르소나가
// 이미 상속하고 있는 것과 동일한 최신본을 정부기관 AC도 그대로 상속).
let _expertCommonSp = null;
async function _loadExpertCommonSp() {
  if (_expertCommonSp) return _expertCommonSp;
  const manifestRaw = await fetch(_RAW_ROOT + 'sp-catalog.json?t=' + Math.floor(Date.now() / 3600000));
  if (!manifestRaw.ok) throw new Error(`[gov-router] sp-catalog.json fetch 실패 (${manifestRaw.status})`);
  const manifest = await manifestRaw.json();
  const fname = manifest['SP_common_guardrails'];
  if (!fname) throw new Error('[gov-router] sp-catalog.json에 SP_common_guardrails 키 없음 — SP-COMMON-02를 찾을 수 없음');
  const r = await fetch(_RAW_ROOT + fname + '?t=' + Math.floor(Date.now() / 3600000));
  if (!r.ok) throw new Error(`[gov-router] SP-COMMON-02(${fname}) fetch 실패 (${r.status})`);
  _expertCommonSp = await r.text();
  return _expertCommonSp;
}

let _jejuTreeProtocol = null;
async function _loadJejuTreeProtocol() {
  if (!_jejuTreeProtocol) _jejuTreeProtocol = await _fetchText('00-common/GOV-TREE-PROTOCOL_v1.0.md');
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
  const provinceCode = _resolveProvinceCode();
  if (_govCommonByProvince.has(provinceCode)) return _govCommonByProvince.get(provinceCode);
  const [kgov, expertCommonSp, gateSchema, overlayTemplate, overlayRecords, treeProtocol] = await Promise.all([
    _loadKgovSp(),
    _loadExpertCommonSp(),
    _fetchText('08-schema/HUMAN-AUTHORITY-GATE-SCHEMA_v1_4.md'),
    _fetchText('00-common/overlays/GOV-COMMON-OVERLAY-TEMPLATE_v1.1.md'),
    _loadGovCommonOverlayMasterData(),
    _loadJejuTreeProtocol(),
  ]);
  const rec = overlayRecords.find(r => r.도코드 === provinceCode);
  let overlay;
  if (rec) {
    overlay = _renderGovCommonOverlay(overlayTemplate, rec);
  } else {
    // ★ 2026-07-20 — 예전엔 여기서 throw했다(오버레이 없는 도는 전부
    // 크래시). 이 세션 내내 써온 TBD 원칙대로 정직한 대체 문구로 바꿈.
    console.warn(`[gov-router] GOV-COMMON-OVERLAY 데이터 없음(도코드=${provinceCode}) — 일반 안내로 대체`);
    overlay = `[참고: 이 지역(${provinceCode})의 상세 안내(콜센터 번호 등)는 아직 준비 중입니다 — ` +
      `정부24(gov.kr) 또는 해당 지자체 대표전화로 확인해 주세요.]`;
  }
  const expertParityNotice =
    '[상위 SP 상속 선언 — 2026-07-21] 아래 SP-COMMON-02(K-전문직 AI 공통 추론 아키텍처)는 ' +
    '노무사·변호사·의사 등 60개 전문가 AI 페르소나의 상위 공통 SP다. 이 정부기관 AC의 5개 ' +
    '원형 클래스(광역시도청·실국·시군구청(기초자치단체)·읍면동사무소·국가기관 지역사무소) 전부 ' +
    '이를 동일하게 상위 SP로 상속한다 — 어느 클래스의 인스턴스든 전문가 AI 페르소나와 동등한 ' +
    '방식, 동일한 태도로 사용자 요청에 응해야 한다.';
  const result = kgov + '\n\n---\n\n' + expertParityNotice + '\n\n' + expertCommonSp +
    '\n\n---\n\n' + gateSchema + '\n\n---\n\n' + overlay + '\n\n---\n\n' + treeProtocol;
  _govCommonByProvince.set(provinceCode, result);
  return result;
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
  const provinceCode = _resolveProvinceCode();
  if (_doSpCacheByProvince.has(provinceCode)) return _doSpCacheByProvince.get(provinceCode);
  let result;
  try {
    const [template, records] = await Promise.all([
      _fetchText('01-do/templates/SP-PROVINCE-TEMPLATE_v1.1.md'),
      _loadProvinceMasterData(),
    ]);
    const rec = records.find(r => r.도코드 === provinceCode);
    if (!rec) throw new Error(`province-master-data.json에 도코드=${provinceCode} 레코드 없음`);
    result = _renderProvinceTemplate(template, rec);
  } catch (e) {
    // ★ 2026-07-21 — 예전엔 여기서 제주 정적 파일(JEJU-DO-SP_v1.5.md)로
    // 조용히 대체했다. 주피터 지시로 jeju 중심 폴백을 폐기하고, 실사
    // 안 된 도는 정직하게 "미확인"으로 안내한다(제주 조직 구조를
    // 다른 도에 잘못 투사하지 않는다).
    console.warn(`[gov-router] SP-PROVINCE-TEMPLATE 렌더링 실패(도코드=${provinceCode}, ${e.message}) — 도청 조직 정보 미확인으로 대체`);
    result = `[도청 조직 정보 — 이 지역(${provinceCode}) 미확인] 광역시도청의 구체적인 조직·부서 정보는 ` +
      `아직 실사되지 않았습니다. 정확한 안내는 정부24(gov.kr) 또는 해당 광역시도 대표전화, ` +
      `국번없이 110(정부민원안내)으로 확인해 주세요.`;
  }
  _doSpCacheByProvince.set(provinceCode, result);
  return result;
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
  const provinceCode = _resolveProvinceCode();
  if (_nationalSpCacheByProvince.has(provinceCode)) return _nationalSpCacheByProvince.get(provinceCode);
  const [core, overlayTemplate, overlayRecords, natRecords] = await Promise.all([
    _fetchText('09-national/NATIONAL-SP-CORE_v1.2.md'),
    _fetchText('09-national/overlays/NATIONAL-SP-OVERLAY-TEMPLATE_v1.0.md'),
    _loadNatOverlayMasterData(),
    _loadNatMasterData(),
  ]);
  const overlayRec = overlayRecords.find(r => r.도코드 === provinceCode);
  let overlay;
  if (overlayRec) {
    overlay = _renderNatOverlay(overlayTemplate, overlayRec);
  } else {
    // ★ 2026-07-20 — 국가기관 지사 데이터는 아직 제주만 있다(세무서·
    // 법원 등 12~15개 도 분량이 별도 후속 작업으로 남아있음). 예전엔
    // 여기서 throw했다 — 정직한 대체 문구로 바꿔 최소한 안 죽게 함.
    console.warn(`[gov-router] NATIONAL-SP-OVERLAY 데이터 없음(도코드=${provinceCode}) — 일반 안내로 대체`);
    overlay = `[참고: 이 지역(${provinceCode})의 국가기관 지사 상세 정보는 아직 준비 중입니다.]`;
  }
  const rowsForProvince = natRecords.filter(r => r.도코드 === provinceCode);
  const catalogSection = rowsForProvince.length > 0
    ? _renderNatCatalogSection(natRecords, provinceCode)
    : `## §3. 라우팅 테이블\n\n이 지역의 국가기관 지사 목록은 아직 조사되지 않았습니다 — ` +
      `정확한 관할 기관은 정부24(gov.kr) 또는 국번없이 110(정부민원안내)으로 확인해 주세요.`;
  const result = core + '\n\n---\n\n' + overlay + '\n\n---\n\n' + catalogSection;
  _nationalSpCacheByProvince.set(provinceCode, result);
  return result;
}

// ── L2 라우팅 테이블 (JEJU-DO-SP §3-1/§3-2/§3-3과 동기화) ─────
// 각 항목: 코드, 파일 경로, 매칭 키워드. 여러 항목이 매칭되면 키워드
// 개수가 가장 많이 일치하는 쪽을 우선한다(단순 스코어링 — v1.1에서
// LLM 기반 분류로 고도화 검토).
const JEJU_L2_TABLE = [
  { code: 'SP-DO-PLAN',     file: '02-do-dept/SP-DO-PLAN_v1.1.md',
    domain: 'plan', 도코드: 'jeju',
    // ★ 2026-07-23 수정 — '취득세'/'재산세'(개별 세액 확인 트리거) 삭제
    // (100건 사고실험에서 발견, 주피터 지시). '세정'/'지방세'는 정책·제도
    // 문의로도 쓰이는 일반 용어라 남기되, 개별 세액 확인은 SP 본문 §3에서
    // 시청 세무과·재산세과로 위임하도록 이미 명시해뒀다(이중 안전장치).
    kw: ['기획조정실', '고향사랑기부', '세정', '지방세', '청년정책', '인구정책', '예산', '기획'] },
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
    // ★ 2026-07-23 수정 — '분리배출' 삭제(100건 사고실험에서 발견,
    // 주피터 지시). "분리배출 위반 신고"처럼 실제로는 시청 생활환경과·
    // 환경지도과 단속 소관인 요청이 이 키워드로 도청에 잘못 걸렸다.
    // 배출규정 자체를 묻는 일반 문의는 '클린하우스'/'폐기물'/'환경'으로도
    // 충분히 잡힌다.
    kw: ['기후환경국', '전기차', '탄소중립', '환경영향평가', '클린하우스', '폐기물', '환경'] },
  { code: 'SP-DO-HOUSING',  file: '02-do-dept/SP-DO-HOUSING_v1.1.md',
    domain: 'housing', 도코드: 'jeju',
    // ★ 2026-07-23 수정 — '건축허가'/'건축인허가'/'건축' 삭제(주피터 지시,
    // 건축법 제14조 사고실험에서 발견). 이 도청 실국이 실제로 하는 일은
    // 주택정책·공공임대주택 등 정책 수립이고, 개별 건축허가는 시청
    // 건축과 소관이다 — division-master-data.json의 jeju-housing/
    // architecture 레코드 처분성_문구가 이미 "개별 건축허가는 시청
    // 건축과에서 확정된다"고 스스로 명시하고 있었는데, 이 라우팅
    // 키워드 테이블만 안 고쳐져 있었다. 지역 특정 없이 "건축허가
    // 신청하고 싶어요"라고만 말하면 이 목록에 걸려 도청으로 잘못
    // 라우팅되던 버그의 근본 원인.
    kw: ['건설주택국', '공공임대주택', '주택정책', '주택'] },
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

// ── 시청 국(局) 단위 키워드 테이블 (2026-07-23 신설) ────────────────
// 도청 실·국(JEJU_L2_TABLE)과 동일 철학 — city-dept-master-data.json에
// 이미 13개 레코드(제주시 6 + 서귀포시 7)가 완결돼 있었으나
// findStaffContact()(연락처 조회)에만 쓰이고 실제 SP 조립 경로에는
// 연결이 안 돼 있었다. 이 테이블이 그 배선을 완성한다.
// ✅ 2026-07-23(2차 수정) — 아래 공백을 city-dept-master-data.json에
// 제주시 '도시건설국'(국코드 housing, 2026-07-24 이전 이름 construction) 레코드를
// 신설해 해소했다. 2026-07-24: 도청 도메인 코드('housing')와 통일하기 위해
// construction → housing으로 국코드명을 바꿨다(실제 부서 실명은 무관, 내부
// 식별자만 통일 — 시청 16개 도메인 클래스 신설과 함께 정리).
// (구 주석: "제주시에는 안전도시건설국이 아직 없다" — jejusi.go.kr 조직도
// 실사 결과 제주시 조직명은 "안전"이 빠진 "도시건설국"으로 확인됨. 교통·
// 안전 업무는 별도로 이미 있는 'safety' 국코드(안전교통국)가 담당한다.)
const JEJU_CITY_DEPT_TABLE = [
  { 국코드: 'jachi', 시코드: 'jejusi',
    // ★ 2026-07-23 수정 — '인허가'/'인사'는 지나치게 포괄적인 일반명사라
    // "건축 인허가" 같은 타 국 소관 질의까지 자치행정국으로 잘못 흡수하는
    // 버그를 유발했다(사고실험으로 발견, 주피터 지시). 자치행정과 고유
    // 업무(총무·세정·조직)를 가리키는 구체적 단어만 남긴다.
    kw: ['자치행정국', '총무과', '기획예산과', '세무과', '재산세과', '지방세'] },
  { 국코드: 'safety', 시코드: 'jejusi',
    kw: ['안전교통국', '안전총괄과', '교통행정과', '차량관리과', '교통', '차량등록', '주정차'] },
  { 국코드: 'welfare', 시코드: 'jejusi',
    // ★ 2026-07-23 수정(100건 사고실험에서 발견, 주피터 지시) — 단독
    // '복지'/'위생'은 지나치게 포괄적이라 "행정복지센터"(읍면동 사무소의
    // 공식 명칭, 복지 상담 요청이 아님)까지 이 국으로 잘못 흡수했다.
    // '기초생활수급'은 반대로 빠져있어서 실제 신청 발화가 아예 안 걸리는
    // 공백이었다 — 추가.
    kw: ['복지위생국', '주민복지과', '노인복지과', '장애인복지과', '기초생활보장과', '여성가족과', '위생관리과', '기초생활수급'] },
  { 국코드: 'econ', 시코드: 'jejusi',
    kw: ['경제일자리국', '경제소상공인과', '일자리에너지과', '마을활력과', '정보화지원과', '소상공인', '일자리'] },
  { 국코드: 'culture', 시코드: 'jejusi',
    kw: ['문화관광체육국', '문화예술과', '관광진흥과', '체육진흥과', '우당도서관', '탐라도서관', '제주아트센터', '문화', '관광', '체육'] },
  { 국코드: 'climate', 시코드: 'jejusi',
    kw: ['청정환경국', '환경관리과', '환경지도과', '생활환경과', '공원녹지과', '절물생태관리소', '환경', '공원'] },
  { 국코드: 'housing', 시코드: 'jejusi',
    // ★ 2026-07-23 신설 — jejusi.go.kr 조직도 실사(복수 독립 출처 교차검증).
    // '인허가'/'건설' 같은 과도하게 포괄적인 일반명사는 넣지 않는다
    // (자치행정국·복지위생국에서 겪은 과잉일반화 재발 방지, 주피터 지시).
    kw: ['도시건설국', '도시계획과', '도시재생과', '건축과', '주택과', '상하수도과',
         '건축', '건축허가', '건축인허가', '건축신고', '도시계획'] },
  { 국코드: 'jachi', 시코드: 'seogwipo',
    kw: ['자치행정국', '총무과', '기획예산과', '세무과', '평생교육과', '지방세'] },
  { 국코드: 'welfare', 시코드: 'seogwipo',
    kw: ['복지위생국', '주민복지과', '노인복지과', '장애인복지과', '여성가족과', '위생관리과', '기초생활수급'] },
  { 국코드: 'culture', 시코드: 'seogwipo',
    kw: ['문화관광체육국', '문화예술과', '관광진흥과', '체육진흥과', '예술의전당', '도서관운영사무소', '공립미술관', '문화', '관광', '체육'] },
  { 국코드: 'agrieconomy', 시코드: 'seogwipo',
    kw: ['농수축산경제국', '경제일자리과', '디지털혁신과', '친환경농정과', '감귤유통과', '해양수산과', '청정축산과', '농업', '감귤', '수산', '축산'] },
  { 국코드: 'climate', 시코드: 'seogwipo',
    kw: ['청정환경국', '기후환경과', '생활환경과', '공원녹지과', '산림휴양관리소', '환경', '공원'] },
  { 국코드: 'housing', 시코드: 'seogwipo',
    kw: ['안전도시건설국', '안전총괄과', '도시과', '건축과', '건설과', '교통행정과', '상하수도과',
         '건축', '건축허가', '건축인허가', '건축신고', '건설', '도시계획', '상하수도'] },
  { 국코드: 'health', 시코드: 'seogwipo',
    kw: ['서귀포보건소', '보건행정과', '건강증진과', '동부보건소', '서부보건소', '보건소', '보건'] },
];

function _matchCityDept(text, 시코드) {
  for (const d of _cityDeptTable()) {
    if (d.시코드 !== 시코드) continue;
    if (d.kw.some(k => text.includes(k))) return d;
  }
  return null;
}

// ── 경남 시/군 파일럿 인스턴스 (2026-07-24 신설) ──────────────────────
// 주피터 지시: "진주·창원·산청군을 샘플로, 관련 법규를 기반으로 시 도메인을
// 작성" — 단, 시청 국코드 도메인 클래스(SP-CITYDEPT-*-TEMPLATE 16개)는
// 이미 실명 없이도 작동하도록 설계됐으므로(2026-07-24 개편), 이 키워드
// 테이블도 제주(JEJU_CITY_DEPT_TABLE)처럼 실사로 확인한 실제 국·과 이름을
// 쓰지 않는다 — 진주·창원 실사는 아직 안 했다. 대신 전국 어디서나 통하는
// 도메인 범용 어휘만 쓴다(원칙 5: 키워드 과잉일반화 금지는 지키되, "지방세"
// 처럼 구체적인 사무명은 범용이라도 안전).
//
// 지자체유형 표본 선택 근거(주피터 지시로 마산 대신 재선정, 2026-07-24):
//   - 진주시: 일반시(구 없음)
//   - 창원시: 특례시(지방자치법 특례시 조항, 인구 100만 이상) + 산하 일반구 5개
//     (의창구·성산구·마산합포구·마산회원구·진해구 — 전부 법인격 없음,
//     처분권자는 창원시장). 마산합포구·마산회원구는 2010년 마산시가
//     창원시에 통합되며 신설된 구다(구 '마산시'는 더 이상 존재하지 않음
//     — "마산시" 자체를 표본으로 쓰면 안 된다는 게 이번 재선정의 핵심).
//   - 산청군: 군(읍면 중심 구조, 광역 산업팀 존재 패턴 검증용).
const GYEONGNAM_CITY_TABLE = [
  { code: 'SP-CITY-JINJU',    file: null, 도코드: 'gyeongnam', 시코드: 'jinju',
    kw: ['진주시', '진주시청'] },
  { code: 'SP-CITY-CHANGWON', file: null, 도코드: 'gyeongnam', 시코드: 'changwon',
    kw: ['창원시', '창원시청'] },
  // 아래 5개는 독립된 시가 아니라 창원시 산하 일반구다 — code는 일부러
  // SP-CITY-CHANGWON을 그대로 재사용한다(법인격이 없어 자체 루트 SP가
  // 없고, 상위 창원시 루트 SP를 공유하는 것이 정확한 법적 지위 반영).
  { code: 'SP-CITY-CHANGWON', file: null, 도코드: 'gyeongnam', 시코드: 'uichang',
    kw: ['의창구'] },
  { code: 'SP-CITY-CHANGWON', file: null, 도코드: 'gyeongnam', 시코드: 'seongsan',
    kw: ['성산구'] },
  { code: 'SP-CITY-CHANGWON', file: null, 도코드: 'gyeongnam', 시코드: 'masanhappo',
    kw: ['마산합포구'] },
  { code: 'SP-CITY-CHANGWON', file: null, 도코드: 'gyeongnam', 시코드: 'masanhoewon',
    kw: ['마산회원구'] },
  { code: 'SP-CITY-CHANGWON', file: null, 도코드: 'gyeongnam', 시코드: 'jinhae',
    kw: ['진해구'] },
  { code: 'SP-CITY-SANCHEONG', file: null, 도코드: 'gyeongnam', 시코드: 'sancheong',
    kw: ['산청군', '산청군청'] },
];

// 도메인 범용 키워드 — 실명(국·과 명칭) 없이 전국 어디서나 통하는 사무명만
// 사용한다(2026-07-24 원칙: "부서 실명은 참고 정보일 뿐 라우팅에 필수가
// 아니다"). 자치구·일반구 구분 없이 동일 키워드를 쓴다 — 처분권 소재는
// city-dept-master-data.json의 지자체유형/처분권_문구가 담당하고, 이
// 테이블은 순수하게 "이 발화가 어느 도메인 사무인가"만 판별한다.
function _makeGenericCityDeptEntries(시코드) {
  return [
    { 국코드: 'plan', 시코드, kw: ['기획예산', '중장기계획', '인구정책'] },
    { 국코드: 'jachi', 시코드, kw: ['지방세', '재산세과', '세무과', '자치행정', '주민등록', '인감증명', '취득세'] },
    { 국코드: 'safety', 시코드, kw: ['재난안전', '안전총괄', '주정차 단속'] },
    { 국코드: 'welfare', 시코드, kw: ['기초생활수급', '기초연금', '장애인복지', '주민복지과'] },
    { 국코드: 'econ', 시코드, kw: ['소상공인', '지역경제', '전통시장', '일자리과'] },
    { 국코드: 'culture', 시코드, kw: ['문화예술과', '생활체육', '평생학습', '도서관'] },
    { 국코드: 'climate', 시코드, kw: ['생활환경과', '폐기물', '공원녹지과'] },
    { 국코드: 'housing', 시코드,
      kw: ['건축허가', '건축인허가', '건축신고', '도시계획과', '상하수도과'] },
    { 국코드: 'transport', 시코드, kw: ['교통행정과', '시내버스', '버스 노선', '버스', '교통약자'] },
    { 국코드: 'health', 시코드, kw: ['보건소', '예방접종', '건강검진'] },
  ];
}

const GYEONGNAM_CITY_DEPT_TABLE = [
  ..._makeGenericCityDeptEntries('jinju'),
  ..._makeGenericCityDeptEntries('changwon'),
  // 5개 일반구 — 국코드 범위를 자치행정/복지/건축 3개로만 좁힌다(§3
  // 파일럿 목적상 "일반구는 처분권이 없다"는 메커니즘 검증이 핵심이고,
  // 16개 전부 채우는 건 표본의 취지를 벗어난다 — 필요해지면 그때 확장).
  ..._makeGenericCityDeptEntries('uichang').filter(e => ['jachi', 'welfare', 'housing'].includes(e.국코드)),
  ..._makeGenericCityDeptEntries('seongsan').filter(e => ['jachi', 'welfare', 'housing'].includes(e.국코드)),
  ..._makeGenericCityDeptEntries('masanhappo').filter(e => ['jachi', 'welfare', 'housing'].includes(e.국코드)),
  ..._makeGenericCityDeptEntries('masanhoewon').filter(e => ['jachi', 'welfare', 'housing'].includes(e.국코드)),
  ..._makeGenericCityDeptEntries('jinhae').filter(e => ['jachi', 'welfare', 'housing'].includes(e.국코드)),
  ..._makeGenericCityDeptEntries('sancheong'),
];

// ── 부산 16개 자치구·군 + 서울 25개 자치구 — 1단계 확대 (2026-07-24) ────
// 경남 파일럿과 달리 여기는 전부 자치구(+기장군 1개는 군)라 처분권 예외
// (일반구)가 없다 — 지자체유형은 전부 '자치구'/'군'로 단순하다. 시코드는
// 부산·서울 동명 자치구(중구·강서구)가 서로 충돌하지 않도록 도 접두어를
// 붙인다(busan_/seoul_). 해운대구만 예외적으로 city-dept-master-data.json에
// 국이름을 실사 데이터(2026-07-24 Research)로 채운다 — "실사+메타데이터
// 혼합" 선례(계획서 v1.1 §5 1단계 참고), 이 배선 테이블 자체는 나머지
// 40개 구·군과 동일하게 범용 도메인 어휘만 쓴다(라우팅은 실명과 무관).
const BUSAN_GU = [
  ['busan_gangseo', '강서구'], ['busan_geumjeong', '금정구'], ['busan_gijang', '기장군'],
  ['busan_nam', '남구'], ['busan_dong', '동구'], ['busan_dongnae', '동래구'],
  ['busan_busanjin', '부산진구'], ['busan_buk', '북구'], ['busan_sasang', '사상구'],
  ['busan_saha', '사하구'], ['busan_seo', '서구'], ['busan_suyeong', '수영구'],
  ['busan_yeonje', '연제구'], ['busan_yeongdo', '영도구'], ['busan_jung', '중구'],
  ['busan_haeundae', '해운대구'],
];
const SEOUL_GU = [
  ['seoul_gangnam', '강남구'], ['seoul_gangdong', '강동구'], ['seoul_gangbuk', '강북구'],
  ['seoul_gangseo', '강서구'], ['seoul_gwanak', '관악구'], ['seoul_gwangjin', '광진구'],
  ['seoul_guro', '구로구'], ['seoul_geumcheon', '금천구'], ['seoul_nowon', '노원구'],
  ['seoul_dobong', '도봉구'], ['seoul_dongdaemun', '동대문구'], ['seoul_dongjak', '동작구'],
  ['seoul_mapo', '마포구'], ['seoul_seodaemun', '서대문구'], ['seoul_seocho', '서초구'],
  ['seoul_seongdong', '성동구'], ['seoul_seongbuk', '성북구'], ['seoul_songpa', '송파구'],
  ['seoul_yangcheon', '양천구'], ['seoul_yeongdeungpo', '영등포구'], ['seoul_yongsan', '용산구'],
  ['seoul_eunpyeong', '은평구'], ['seoul_jongno', '종로구'], ['seoul_jung', '중구'],
  ['seoul_jungnang', '중랑구'],
];

function _makeMetroCityTable(도코드, guList) {
  return guList.map(([시코드, 이름]) => ({
    code: `SP-CITY-${시코드.toUpperCase()}`, file: null, 도코드, 시코드,
    kw: [이름, `${이름}청`],
  }));
}
const BUSAN_CITY_TABLE = _makeMetroCityTable('busan', BUSAN_GU);
const SEOUL_CITY_TABLE = _makeMetroCityTable('seoul', SEOUL_GU);
const BUSAN_CITY_DEPT_TABLE = BUSAN_GU.flatMap(([시코드]) => _makeGenericCityDeptEntries(시코드));
const SEOUL_CITY_DEPT_TABLE = SEOUL_GU.flatMap(([시코드]) => _makeGenericCityDeptEntries(시코드));

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
  // ★ 2026-07-24 신설(100건 사고실험에서 발견) — 아래 6개는 템플릿
  // (09-national/agencies/templates/SP-NAT-*-TEMPLATE_*.md)과
  // national-agency-master-data.json 레코드가 이미 완비돼 있었는데,
  // 이 라우팅 테이블에 등록이 안 돼 있어 "제주세관 통관 절차 문의"
  // 같은 정당한 질문이 전부 L2 미매칭(일반 안내)으로 떨어지고
  // 있었다 — 콘텐츠 저작은 끝났는데 배선만 누락된 사례. 키워드는
  // 이미 다른 도의 지연조회(SP-NATIONAL-LAZY)가 쓰는
  // _NAT_AGENCY_DOMAIN_KEYWORDS의 customs/bok/stat과 동일하게 맞춰
  // 일관성을 유지했다(원형-인스턴스 키워드 불일치 방지).
  { code: 'SP-NAT-CUSTOMS',      file: '09-national/agencies/SP-NAT-CUSTOMS_v1.0.md',
    domain: 'customs', 도코드: 'jeju',
    kw: ['세관', '관세', '통관'] },
  { code: 'SP-NAT-BOK',          file: '09-national/agencies/SP-NAT-BOK_v1.1.md',
    domain: 'bok', 도코드: 'jeju',
    kw: ['한국은행'] },
  { code: 'SP-NAT-STAT',         file: '09-national/agencies/SP-NAT-STAT_v1.0.md',
    domain: 'stat', 도코드: 'jeju',
    kw: ['통계청'] },
  { code: 'SP-NAT-FORESTRESEARCH', file: '09-national/agencies/SP-NAT-FORESTRESEARCH_v1.0.md',
    domain: 'forestresearch', 도코드: 'jeju',
    kw: ['산림과학원', '임업연구'] },
  { code: 'SP-NAT-FORESTSEED',   file: '09-national/agencies/SP-NAT-FORESTSEED_v1.0.md',
    domain: 'forestseed', 도코드: 'jeju',
    kw: ['산림품종관리센터', '산림용 종자', '종자검사'] },
  { code: 'SP-NAT-FORESTCOOP',   file: '09-national/agencies/SP-NAT-FORESTCOOP_v1.0.md',
    domain: 'forestcoop', 도코드: 'jeju',
    kw: ['산림조합'] },
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

// ── 부산 L2 라우팅 테이블 (2026-07-20 실사) ─────────────────────
// 원형 도메인 16개 중 부산이 실제로 보유한 16개 전부 채움(health/family/
// sports 포함 — 부산은 이 3개가 제주와 달리 별도 국으로 분리돼 있음).
// 근거: do-dept-master-data.json 부산 레코드(나무위키 2026-07-10 + 공식
// 조직도 검색결과 2026-07-20 재검증) — 실 이름이 불확실한 econ/culture는
// 안정적인 과 이름 위주로 키워드를 구성했다(§비고 참고, 확정 아님).
const BUSAN_L2_TABLE = [
  { code: 'SP-DO-PLAN', domain: 'plan', 도코드: 'busan', file: null,
    // ★ 2026-07-24 수정 — '취득세'/'재산세' 삭제(제주 SP-DO-PLAN에서
    // 이미 같은 이유로 제거한 것과 동일 — 개별 세액 확인은 도청이 아니라
    // 시/군/구 세무과 소관인데, 이 두 키워드가 도청 기획조정실로 잘못
    // 흡수했다). '지방세'/'세정'은 정책·제도 문의로도 쓰이는 일반 용어라
    // 남긴다.
    kw: ['고향사랑기부', '지방세', '세정', '예산', '기획조정실'] },
  { code: 'SP-DO-SAFETY', domain: 'safety', 도코드: 'busan', file: null,
    kw: ['시민안전실', '재난', '태풍', '호우', '자연재난', '사회재난', '원자력안전', '특별사법경찰'] },
  { code: 'SP-DO-JACHI', domain: 'jachi', 도코드: 'busan', file: null,
    kw: ['자치분권', '협치행정', '통합민원'] },
  { code: 'SP-DO-ECON', domain: 'econ', 도코드: 'busan', file: null,
    kw: ['투자유치', '중소기업', '소상공인', '자영업', '일자리', '신용보증재단', '경제진흥원'] },
  { code: 'SP-DO-INNOV', domain: 'innov', 도코드: 'busan', file: null,
    kw: ['인공지능', '빅데이터', '바이오헬스', '연구개발', '미래기술', '스타트업'] },
  { code: 'SP-DO-WELFARE', domain: 'welfare', 도코드: 'busan', file: null,
    kw: ['기초생활수급', '기초연금', '장애인복지', '노인복지', '돌봄복지'] },
  { code: 'SP-DO-HEALTH', domain: 'health', 도코드: 'busan', file: null,
    kw: ['건강정책', '보건위생', '감염병', '예방접종', '건강검진', '보건'] },
  { code: 'SP-DO-FAMILY', domain: 'family', 도코드: 'busan', file: null,
    kw: ['여성가족', '임신', '출산', '보육', '어린이집', '아동청소년', '아동수당'] },
  { code: 'SP-DO-CLIMATE', domain: 'climate', 도코드: 'busan', file: null,
    kw: ['녹색환경정책실', '기후대기', '자원순환', '분리배출', '폐기물',
         '산림녹지', '공원운영', '하천관리', '수질개선'] },
  { code: 'SP-DO-HOUSING', domain: 'housing', 도코드: 'busan', file: null,
    kw: ['건축주택국', '건축허가', '건축정책', '주택정책', '도시디자인'] },
  { code: 'SP-DO-TRANSPORT', domain: 'transport', 도코드: 'busan', file: null,
    kw: ['도시철도', '지하철', '버스운영', '택시운수', '물류정책', '공공교통'] },
  { code: 'SP-DO-CULTURE', domain: 'culture', 도코드: 'busan', file: null,
    kw: ['문화예술', '문화유산', '영상콘텐츠', '도서관'] },
  { code: 'SP-DO-SPORTS', domain: 'sports', 도코드: 'busan', file: null,
    kw: ['체육정책', '생활체육', '체육시설', '전국체전'] },
  { code: 'SP-DO-TOURISM', domain: 'tourism', 도코드: 'busan', file: null,
    kw: ['관광마이스', '관광정책', '해양레저관광', '국제협력', '숙박업', '여행업'] },
  { code: 'SP-DO-AGRI', domain: 'agri', 도코드: 'busan', file: null,
    kw: ['농축산유통', '축산', '농업'] },
  { code: 'SP-DO-OCEAN', domain: 'ocean', 도코드: 'busan', file: null,
    kw: ['해운항만', '수산정책', '수산진흥', '어업', '수산업', '양식업'] },
];


// ── 서울 L2 라우팅 테이블 (2026-07-20 최초 실사) ─────────────────
// 원형 도메인 16개 중 서울이 보유한 14개(agri/ocean 없음 — 도심형 광역시라
// 정상적 공백) 채움. 근거: org.seoul.go.kr 공식 조직도(2026-07-20) +
// news.seoul.go.kr 2026년 부서별 주요업무계획 + opengov.seoul.go.kr
// 업무추진비 공개문서. 산하과 상세는 다수 도메인에서 TBD로 남아있어
// 안정적인 국/실/본부 단위 키워드 위주로 구성(§비고 참고).
const SEOUL_L2_TABLE = [
  { code: 'SP-DO-PLAN', domain: 'plan', 도코드: 'seoul', file: null,
    // ★ 2026-07-24 수정 — 부산과 동일한 이유로 '취득세'/'재산세' 삭제.
    kw: ['지방세', '예산', '기획조정실', '정책기획관'] },
  { code: 'SP-DO-SAFETY', domain: 'safety', 도코드: 'seoul', file: null,
    kw: ['재난안전실', '재난', '안전관리'] },
  { code: 'SP-DO-JACHI', domain: 'jachi', 도코드: 'seoul', file: null,
    kw: ['행정국', '총무', '자치행정'] },
  { code: 'SP-DO-ECON', domain: 'econ', 도코드: 'seoul', file: null,
    kw: ['경제실', '소상공인', '중소기업', '민생노동', '일자리'] },
  { code: 'SP-DO-INNOV', domain: 'innov', 도코드: 'seoul', file: null,
    kw: ['디지털도시', '스마트시티', '정보화'] },
  { code: 'SP-DO-WELFARE', domain: 'welfare', 도코드: 'seoul', file: null,
    kw: ['복지실', '복지정책', '장애인복지', '기초생활수급', '기초연금'] },
  { code: 'SP-DO-HEALTH', domain: 'health', 도코드: 'seoul', file: null,
    kw: ['시민건강국', '식품정책', '정신건강', '보건', '감염병', '건강증진', '응급의료'] },
  { code: 'SP-DO-FAMILY', domain: 'family', 도코드: 'seoul', file: null,
    kw: ['여성가족실', '저출생', '여성정책', '가족정책', '보육', '아동돌봄', '출산'] },
  { code: 'SP-DO-CLIMATE', domain: 'climate', 도코드: 'seoul', file: null,
    kw: ['기후환경본부', '기후환경', '대기질', '미세먼지', '탄소중립'] },
  { code: 'SP-DO-HOUSING', domain: 'housing', 도코드: 'seoul', file: null,
    kw: ['주택실', '주택정책', '전략주택공급', '공동주택', '재건축'] },
  { code: 'SP-DO-TRANSPORT', domain: 'transport', 도코드: 'seoul', file: null,
    kw: ['교통실', '대중교통', '버스', '지하철', '따릉이'] },
  { code: 'SP-DO-CULTURE', domain: 'culture', 도코드: 'seoul', file: null,
    kw: ['문화본부', '문화정책', '문화예술', '도서관', '박물관'] },
  { code: 'SP-DO-TOURISM', domain: 'tourism', 도코드: 'seoul', file: null,
    kw: ['관광체육국', '관광', '관광정책', '마이스'] },
  { code: 'SP-DO-SPORTS', domain: 'sports', 도코드: 'seoul', file: null,
    kw: ['체육진흥', '생활체육', '체육시설'] },
];


// ── 인천 L2 라우팅 테이블 ⚠️ 전부 "예정(안)" ─────────────────────
// 2026-07-03 발표된 조직개편안(2026-08 시행 예정, 시의회 심의 중) 기준.
// 아직 발효 전이라 실사용 전 8월 조례 통과 여부 재확인 필수. 신설/개편이
// 보도로 확인된 8개 도메인만 채움 — 나머지 도메인은 이번 개편 보도에
// 언급이 없어 전혀 조사되지 않았다(레코드 없음, 허위로 채우지 않음).
const INCHEON_L2_TABLE = [
  { code: 'SP-DO-PLAN', domain: 'plan', 도코드: 'incheon', file: null,
    kw: ['정책조정국', 'ABC+E', '미래기획', '콘텐츠산업', '투자유치'] },
  { code: 'SP-DO-CLIMATE', domain: 'climate', 도코드: 'incheon', file: null,
    kw: ['기후에너지국', '탄소중립', '에너지전환'] },
  { code: 'SP-DO-TRANSPORT', domain: 'transport', 도코드: 'incheon', file: null,
    kw: ['교통정책국', '철도도로국', '대중교통', '철도', '도로'] },
  { code: 'SP-DO-INNOV', domain: 'innov', 도코드: 'incheon', file: null,
    kw: ['미래산업본부', '첨단산업', '바이오산업'] },
  { code: 'SP-DO-ECON', domain: 'econ', 도코드: 'incheon', file: null,
    kw: ['경제국', '민생경제'] },
  { code: 'SP-DO-WELFARE', domain: 'welfare', 도코드: 'incheon', file: null,
    kw: ['보건복지국', '통합돌봄국', '기초생활수급', '기초연금', '돌봄'] },
  { code: 'SP-DO-FAMILY', domain: 'family', 도코드: 'incheon', file: null,
    kw: ['여성가족국', '여성가족', '임신', '출산', '보육'] },
  { code: 'SP-DO-HOUSING', domain: 'housing', 도코드: 'incheon', file: null,
    kw: ['도시계획국', '도시균형국', '원도심혁신국', '제물포', '문학', '부평'] },
];


// ── 대전 L2 라우팅 테이블 (2026-07-20 최초 실사, 확인된 것만) ────────
// 원형 도메인 중 부서명까지 확인된 10개만 채움. 근거 대부분이 2026년 1월
// 인사 명단(전임 시장 체제)이라, 2026-06-03 지방선거로 취임한 신임
// 시장(민선 9기)의 조직개편 여부는 미확인 — 재검증 주기 짧게 가져갈 것.
const DAEJEON_L2_TABLE = [
  { code: 'SP-DO-PLAN', domain: 'plan', 도코드: 'daejeon', file: null,
    kw: ['기획조정실', '예산편성', '정책개발'] },
  { code: 'SP-DO-SAFETY', domain: 'safety', 도코드: 'daejeon', file: null,
    kw: ['시민안전실', '재난', '안전'] },
  { code: 'SP-DO-JACHI', domain: 'jachi', 도코드: 'daejeon', file: null,
    kw: ['행정자치국', '자치행정'] },
  { code: 'SP-DO-ECON', domain: 'econ', 도코드: 'daejeon', file: null,
    kw: ['경제국', '기업지원국', '기업자금', '창업', '투자유치'] },
  { code: 'SP-DO-INNOV', domain: 'innov', 도코드: 'daejeon', file: null,
    kw: ['미래전략산업실', '전략산업'] },
  { code: 'SP-DO-WELFARE', domain: 'welfare', 도코드: 'daejeon', file: null,
    kw: ['복지국', '기초생활수급', '기초연금', '장애인복지', '노인복지'] },
  { code: 'SP-DO-HEALTH', domain: 'health', 도코드: 'daejeon', file: null,
    kw: ['체육건강국', '보건', '건강'] },
  { code: 'SP-DO-SPORTS', domain: 'sports', 도코드: 'daejeon', file: null,
    kw: ['체육건강국', '체육', '생활체육'] },
  { code: 'SP-DO-CULTURE', domain: 'culture', 도코드: 'daejeon', file: null,
    kw: ['문화예술관광국', '문화예술'] },
  { code: 'SP-DO-TOURISM', domain: 'tourism', 도코드: 'daejeon', file: null,
    kw: ['관광'] },
];


// ── 울산 L2 라우팅 테이블 (2026-07-20 최초 실사) ─────────────────
// 원형 도메인 16개 중 울산이 보유한 13개(family/agri/ocean 없음) 채움.
// 근거: ulsan.go.kr 공식 조직도(실국사업소 목록) — 다른 도와 달리 최근
// 개편 보도를 못 찾아 비교적 안정적인 상태로 판단(재검증 급하지 않음).
const ULSAN_L2_TABLE = [
  { code: 'SP-DO-PLAN', domain: 'plan', 도코드: 'ulsan', file: null,
    kw: ['기획조정실', '기획', '예산'] },
  { code: 'SP-DO-SAFETY', domain: 'safety', 도코드: 'ulsan', file: null,
    kw: ['시민안전실', '자연재난', '재난', '안전'] },
  { code: 'SP-DO-JACHI', domain: 'jachi', 도코드: 'ulsan', file: null,
    kw: ['행정국', '자치행정', '세정'] },
  { code: 'SP-DO-ECON', domain: 'econ', 도코드: 'ulsan', file: null,
    kw: ['경제산업실', '경제정책', '기업지원', '기업투자'] },
  { code: 'SP-DO-INNOV', domain: 'innov', 도코드: 'ulsan', file: null,
    kw: ['AI수도추진본부', '인공지능', 'AI'] },
  { code: 'SP-DO-WELFARE', domain: 'welfare', 도코드: 'ulsan', file: null,
    kw: ['복지보훈여성국', '복지정책', '장애인복지', '기초생활수급', '기초연금', '보훈', '여성',
         '임신', '출산', '보육'] },
  { code: 'SP-DO-HEALTH', domain: 'health', 도코드: 'ulsan', file: null,
    kw: ['시민건강국', '시민건강', '감염병', '보건'] },
  { code: 'SP-DO-CLIMATE', domain: 'climate', 도코드: 'ulsan', file: null,
    kw: ['환경국', '환경정책', '녹지정원'] },
  { code: 'SP-DO-HOUSING', domain: 'housing', 도코드: 'ulsan', file: null,
    kw: ['건설주택국', '주택', '건설'] },
  { code: 'SP-DO-TRANSPORT', domain: 'transport', 도코드: 'ulsan', file: null,
    kw: ['교통국', '버스택시', '광역트램', '대중교통'] },
  { code: 'SP-DO-CULTURE', domain: 'culture', 도코드: 'ulsan', file: null,
    kw: ['문화관광체육국', '문화예술', '태화강국가정원'] },
  { code: 'SP-DO-TOURISM', domain: 'tourism', 도코드: 'ulsan', file: null,
    kw: ['관광'] },
  { code: 'SP-DO-SPORTS', domain: 'sports', 도코드: 'ulsan', file: null,
    kw: ['체육', '생활체육'] },
];


// ── 세종 L2 라우팅 테이블 (2026-07-20 최초 실사) ─────────────────
// 원형 도메인 16개 중 세종이 보유한 12개(innov/family/health/ocean 없음)
// 채움. 근거: sejong.go.kr 공식 조직도. 세종은 단층제(시·군·구 없음)라
// city/national 테이블 개념 자체가 다른 도와 다르게 설계돼야 할 수 있음
// (PHASE C에서 검토 필요).
const SEJONG_L2_TABLE = [
  { code: 'SP-DO-PLAN', domain: 'plan', 도코드: 'sejong', file: null,
    kw: ['기획조정실', '기획', '예산'] },
  { code: 'SP-DO-SAFETY', domain: 'safety', 도코드: 'sejong', file: null,
    kw: ['시민안전실', '재난', '안전'] },
  { code: 'SP-DO-JACHI', domain: 'jachi', 도코드: 'sejong', file: null,
    kw: ['자치행정국', '자치행정'] },
  { code: 'SP-DO-ECON', domain: 'econ', 도코드: 'sejong', file: null,
    kw: ['경제산업국', '경제', '산업', '투자유치'] },
  { code: 'SP-DO-WELFARE', domain: 'welfare', 도코드: 'sejong', file: null,
    kw: ['보건복지국', '기초생활수급', '기초연금', '보건', '복지', '임신', '출산', '보육'] },
  { code: 'SP-DO-CLIMATE', domain: 'climate', 도코드: 'sejong', file: null,
    kw: ['환경녹지국', '환경', '녹지'] },
  { code: 'SP-DO-HOUSING', domain: 'housing', 도코드: 'sejong', file: null,
    kw: ['도시주택국', '주택', '건축'] },
  { code: 'SP-DO-TRANSPORT', domain: 'transport', 도코드: 'sejong', file: null,
    kw: ['교통국', '대중교통', 'BRT'] },
  { code: 'SP-DO-CULTURE', domain: 'culture', 도코드: 'sejong', file: null,
    kw: ['문화체육관광국', '문화'] },
  { code: 'SP-DO-TOURISM', domain: 'tourism', 도코드: 'sejong', file: null,
    kw: ['관광'] },
  { code: 'SP-DO-SPORTS', domain: 'sports', 도코드: 'sejong', file: null,
    kw: ['체육', '생활체육'] },
  { code: 'SP-DO-AGRI', domain: 'agri', 도코드: 'sejong', file: null,
    kw: ['도농상생국', '농업', '농촌'] },
];


// ── 충북 L2 라우팅 테이블 (2026-07-20 최초 실사) ─────────────────
// 원형 도메인 16개 중 충북이 보유한 14개(health/ocean 없음) 채움. 근거:
// chungbuk.go.kr 공식 조직도. family는 국이 아니라 도지사 직속 '관'
// (양성평등가족정책관) — 조직 규모가 작아도 라우팅 코드는 동일하게 부여.
const CHUNGBUK_L2_TABLE = [
  { code: 'SP-DO-PLAN', domain: 'plan', 도코드: 'chungbuk', file: null,
    kw: ['기획관리실', '인구청년정책', '법무혁신'] },
  { code: 'SP-DO-SAFETY', domain: 'safety', 도코드: 'chungbuk', file: null,
    kw: ['재난안전실', '사회재난', '자연재난', '재난'] },
  { code: 'SP-DO-JACHI', domain: 'jachi', 도코드: 'chungbuk', file: null,
    kw: ['행정국'] },
  { code: 'SP-DO-ECON', domain: 'econ', 도코드: 'chungbuk', file: null,
    kw: ['경제통상국', '경제기업', '일자리정책', '소상공인', '에너지', '국제통상'] },
  { code: 'SP-DO-INNOV', domain: 'innov', 도코드: 'chungbuk', file: null,
    kw: ['신성장산업국', '바이오산업', '방사광가속기', '과학기술'] },
  { code: 'SP-DO-WELFARE', domain: 'welfare', 도코드: 'chungbuk', file: null,
    kw: ['보건복지국', '기초생활수급', '기초연금', '보건', '복지'] },
  { code: 'SP-DO-FAMILY', domain: 'family', 도코드: 'chungbuk', file: null,
    kw: ['양성평등가족정책관', '여성가족', '임신', '출산', '보육'] },
  { code: 'SP-DO-AGRI', domain: 'agri', 도코드: 'chungbuk', file: null,
    kw: ['농정국', '농업정책', '스마트농산', '농식품유통', '축수산', '동물방역'] },
  { code: 'SP-DO-CLIMATE', domain: 'climate', 도코드: 'chungbuk', file: null,
    kw: ['환경산림국', '환경', '산림'] },
  { code: 'SP-DO-HOUSING', domain: 'housing', 도코드: 'chungbuk', file: null,
    kw: ['균형건설국', '주택', '건설'] },
  { code: 'SP-DO-TRANSPORT', domain: 'transport', 도코드: 'chungbuk', file: null,
    kw: ['균형건설국', '교통'] },
  { code: 'SP-DO-CULTURE', domain: 'culture', 도코드: 'chungbuk', file: null,
    kw: ['문화체육관광국', '문화'] },
  { code: 'SP-DO-TOURISM', domain: 'tourism', 도코드: 'chungbuk', file: null,
    kw: ['관광'] },
  { code: 'SP-DO-SPORTS', domain: 'sports', 도코드: 'chungbuk', file: null,
    kw: ['체육'] },
];


// ── 충남 L2 라우팅 테이블 (2026-07-20 최초 실사) ─────────────────
// 원형 도메인 16개 중 충남이 보유한 15개(health 없음) 채움. 근거:
// chungnam.go.kr 공식 조직도. 자치안전실(jachi+safety)·산업경제실
// (econ+innov)처럼 인접 도메인 2개를 한 실에 담는 패턴이 특징적이다.
const CHUNGNAM_L2_TABLE = [
  { code: 'SP-DO-PLAN', domain: 'plan', 도코드: 'chungnam', file: null,
    kw: ['기획조정실', '데이터담당관', '고등교육정책'] },
  { code: 'SP-DO-SAFETY', domain: 'safety', 도코드: 'chungnam', file: null,
    kw: ['자치안전실', '안전정책', '사회재난', '자연재난', '재난'] },
  { code: 'SP-DO-JACHI', domain: 'jachi', 도코드: 'chungnam', file: null,
    kw: ['자치안전실', '자치행정', '새마을공동체', '세정'] },
  { code: 'SP-DO-ECON', domain: 'econ', 도코드: 'chungnam', file: null,
    kw: ['산업경제실', '경제정책', '일자리기업지원', '산업입지'] },
  { code: 'SP-DO-INNOV', domain: 'innov', 도코드: 'chungnam', file: null,
    kw: ['산업경제실', '미래산업', '산업육성', '탄소중립경제'] },
  { code: 'SP-DO-WELFARE', domain: 'welfare', 도코드: 'chungnam', file: null,
    kw: ['복지보건국', '복지보육', '경로보훈', '장애인복지', '보건정책', '감염병', '건강증진'] },
  { code: 'SP-DO-FAMILY', domain: 'family', 도코드: 'chungnam', file: null,
    kw: ['여성가족정책관', '여성가족', '임신', '출산', '보육'] },
  { code: 'SP-DO-AGRI', domain: 'agri', 도코드: 'chungnam', file: null,
    kw: ['농림축산국', '농업', '축산'] },
  { code: 'SP-DO-CLIMATE', domain: 'climate', 도코드: 'chungnam', file: null,
    kw: ['기후환경국', '기후', '환경'] },
  { code: 'SP-DO-HOUSING', domain: 'housing', 도코드: 'chungnam', file: null,
    kw: ['건설교통국', '주택', '건설'] },
  { code: 'SP-DO-TRANSPORT', domain: 'transport', 도코드: 'chungnam', file: null,
    kw: ['건설교통국', '교통'] },
  { code: 'SP-DO-CULTURE', domain: 'culture', 도코드: 'chungnam', file: null,
    kw: ['문화체육관광국', '문화정책', '문화유산'] },
  { code: 'SP-DO-TOURISM', domain: 'tourism', 도코드: 'chungnam', file: null,
    kw: ['관광진흥', '관광'] },
  { code: 'SP-DO-SPORTS', domain: 'sports', 도코드: 'chungnam', file: null,
    kw: ['체육진흥', '체육'] },
  { code: 'SP-DO-OCEAN', domain: 'ocean', 도코드: 'chungnam', file: null,
    kw: ['해양수산국', '해양', '수산', '어업'] },
];


// ── 전북 L2 라우팅 테이블 (2026-07-20 최초 실사) ─────────────────
// 원형 도메인 16개 전부 채운 첫 사례. welfare/family/health가 전부
// 복지여성보건국 하나를 가리킨다. econ(기업유치지원실 매핑)은 불확실 —
// 재확인 필요. 근거: jeonbuk.go.kr 공식 조직도 + 2026년 하반기 인사 발령.
const JEONBUK_L2_TABLE = [
  { code: 'SP-DO-PLAN', domain: 'plan', 도코드: 'jeonbuk', file: null,
    kw: ['기획조정실', '인구청년정책', '법무행정'] },
  { code: 'SP-DO-SAFETY', domain: 'safety', 도코드: 'jeonbuk', file: null,
    kw: ['도민안전실', '재난', '특별사법경찰', '안전'] },
  { code: 'SP-DO-JACHI', domain: 'jachi', 도코드: 'jeonbuk', file: null,
    kw: ['자치행정국', '자치행정', '세정'] },
  { code: 'SP-DO-ECON', domain: 'econ', 도코드: 'jeonbuk', file: null,
    kw: ['기업유치지원실', '투자유치', '기업지원'] },
  { code: 'SP-DO-INNOV', domain: 'innov', 도코드: 'jeonbuk', file: null,
    kw: ['미래산업국', '이차전지', '탄소산업'] },
  { code: 'SP-DO-WELFARE', domain: 'welfare', 도코드: 'jeonbuk', file: null,
    kw: ['복지여성보건국', '기초생활수급', '기초연금', '복지'] },
  { code: 'SP-DO-FAMILY', domain: 'family', 도코드: 'jeonbuk', file: null,
    kw: ['복지여성보건국', '여성가족', '임신', '출산', '보육'] },
  { code: 'SP-DO-HEALTH', domain: 'health', 도코드: 'jeonbuk', file: null,
    kw: ['복지여성보건국', '보건', '건강'] },
  { code: 'SP-DO-AGRI', domain: 'agri', 도코드: 'jeonbuk', file: null,
    kw: ['농생명축산식품국', '스마트농산', '동물방역', '농업'] },
  { code: 'SP-DO-CLIMATE', domain: 'climate', 도코드: 'jeonbuk', file: null,
    kw: ['환경녹지국', '환경', '녹지'] },
  { code: 'SP-DO-HOUSING', domain: 'housing', 도코드: 'jeonbuk', file: null,
    kw: ['건설교통국', '주택건축', '토지정보'] },
  { code: 'SP-DO-TRANSPORT', domain: 'transport', 도코드: 'jeonbuk', file: null,
    kw: ['건설교통국', '교통'] },
  { code: 'SP-DO-CULTURE', domain: 'culture', 도코드: 'jeonbuk', file: null,
    kw: ['문화체육관광국', '문화산업', '유산관리'] },
  { code: 'SP-DO-TOURISM', domain: 'tourism', 도코드: 'jeonbuk', file: null,
    kw: ['관광산업', '관광'] },
  { code: 'SP-DO-SPORTS', domain: 'sports', 도코드: 'jeonbuk', file: null,
    kw: ['체육정책', '체육'] },
  { code: 'SP-DO-OCEAN', domain: 'ocean', 도코드: 'jeonbuk', file: null,
    kw: ['새만금해양수산국', '새만금', '해양항만', '수산'] },
];


// ── 경북 L2 라우팅 테이블 ⚠️ 조직개편 중으로 신뢰도 낮음 ───────────
// 검색 중 서로 다른 시점의 조직도 스냅샷 3개가 충돌(family/innov/safety
// 담당 부서명이 스냅샷마다 다름) — 3선 이철우 도지사(민선 9기) 취임과
// 함께 실제 개편이 진행 중인 것으로 보인다. 최신으로 보이는 조합을
// 채택했으나 다른 도보다 신뢰도가 명확히 낮다 — 최우선 재검증 대상.
const GYEONGBUK_L2_TABLE = [
  { code: 'SP-DO-PLAN', domain: 'plan', 도코드: 'gyeongbuk', file: null,
    kw: ['기획조정실'] },
  { code: 'SP-DO-SAFETY', domain: 'safety', 도코드: 'gyeongbuk', file: null,
    kw: ['재난안전실', '재난', '안전'] },
  { code: 'SP-DO-JACHI', domain: 'jachi', 도코드: 'gyeongbuk', file: null,
    kw: ['자치행정국', '자치행정'] },
  { code: 'SP-DO-ECON', domain: 'econ', 도코드: 'gyeongbuk', file: null,
    kw: ['경제통상국', '경제산업', '일자리'] },
  { code: 'SP-DO-INNOV', domain: 'innov', 도코드: 'gyeongbuk', file: null,
    kw: ['메타AI과학국', '메타버스', '과학산업', 'AI'] },
  { code: 'SP-DO-WELFARE', domain: 'welfare', 도코드: 'gyeongbuk', file: null,
    kw: ['복지건강국', '기초생활수급', '기초연금', '보건', '복지'] },
  { code: 'SP-DO-FAMILY', domain: 'family', 도코드: 'gyeongbuk', file: null,
    kw: ['저출생극복본부', '여성아동', '출산', '보육', '임신'] },
  { code: 'SP-DO-AGRI', domain: 'agri', 도코드: 'gyeongbuk', file: null,
    kw: ['농축산유통국', '농업', '축산'] },
  { code: 'SP-DO-CLIMATE', domain: 'climate', 도코드: 'gyeongbuk', file: null,
    kw: ['기후환경국', '환경산림', '산림', '환경'] },
  { code: 'SP-DO-HOUSING', domain: 'housing', 도코드: 'gyeongbuk', file: null,
    kw: ['건설도시국', '주택', '건설'] },
  { code: 'SP-DO-TRANSPORT', domain: 'transport', 도코드: 'gyeongbuk', file: null,
    kw: ['건설도시국', '교통'] },
  { code: 'SP-DO-CULTURE', domain: 'culture', 도코드: 'gyeongbuk', file: null,
    kw: ['문화관광체육국', '문화'] },
  { code: 'SP-DO-TOURISM', domain: 'tourism', 도코드: 'gyeongbuk', file: null,
    kw: ['관광'] },
  { code: 'SP-DO-SPORTS', domain: 'sports', 도코드: 'gyeongbuk', file: null,
    kw: ['체육'] },
];


// ── 경남 L2 라우팅 테이블 ⚠️ 조직도 스냅샷 불일치, 신뢰도 낮음 ────────
// 경북과 동일한 문제 — 검색 중 서로 다른 시점의 조직도 스냅샷이 충돌
// (교통/균형발전/산업경제 부서명이 스냅샷마다 다름). 공식 '조직도' 메뉴
// 페이지 기준을 우선 채택했으나 다른 도보다 신뢰도 낮음 — 재검증 권장.
const GYEONGNAM_L2_TABLE = [
  { code: 'SP-DO-PLAN', domain: 'plan', 도코드: 'gyeongnam', file: null,
    kw: ['기획조정실'] },
  { code: 'SP-DO-SAFETY', domain: 'safety', 도코드: 'gyeongnam', file: null,
    kw: ['재난안전건설본부', '도민안전본부', '재난', '안전'] },
  { code: 'SP-DO-JACHI', domain: 'jachi', 도코드: 'gyeongnam', file: null,
    kw: ['자치행정국', '자치행정'] },
  { code: 'SP-DO-ECON', domain: 'econ', 도코드: 'gyeongnam', file: null,
    kw: ['일자리경제국', '경제통상', '경제기업'] },
  { code: 'SP-DO-INNOV', domain: 'innov', 도코드: 'gyeongnam', file: null,
    kw: ['산업혁신국', '산업정책', '산업통상'] },
  { code: 'SP-DO-WELFARE', domain: 'welfare', 도코드: 'gyeongnam', file: null,
    kw: ['복지보건국', '기초생활수급', '기초연금', '보건', '복지'] },
  { code: 'SP-DO-FAMILY', domain: 'family', 도코드: 'gyeongnam', file: null,
    kw: ['여성가족아동국', '여성가족', '아동청소년', '임신', '출산', '보육'] },
  { code: 'SP-DO-AGRI', domain: 'agri', 도코드: 'gyeongnam', file: null,
    kw: ['농정국', '농업정책', '농업'] },
  { code: 'SP-DO-CLIMATE', domain: 'climate', 도코드: 'gyeongnam', file: null,
    kw: ['환경산림국', '기후환경산림', '환경', '산림'] },
  { code: 'SP-DO-HOUSING', domain: 'housing', 도코드: 'gyeongnam', file: null,
    kw: ['도시주택국', '주택'] },
  { code: 'SP-DO-TRANSPORT', domain: 'transport', 도코드: 'gyeongnam', file: null,
    kw: ['도시교통국', '물류공항철도', '교통'] },
  { code: 'SP-DO-CULTURE', domain: 'culture', 도코드: 'gyeongnam', file: null,
    kw: ['문화관광체육국', '문화'] },
  { code: 'SP-DO-TOURISM', domain: 'tourism', 도코드: 'gyeongnam', file: null,
    kw: ['관광'] },
  { code: 'SP-DO-SPORTS', domain: 'sports', 도코드: 'gyeongnam', file: null,
    kw: ['체육'] },
  { code: 'SP-DO-OCEAN', domain: 'ocean', 도코드: 'gyeongnam', file: null,
    kw: ['해양수산국', '해양', '수산', '어업'] },
];

const PROVINCE_TABLES = {
  jeju: { l2: JEJU_L2_TABLE, city: JEJU_CITY_TABLE, national: JEJU_NATIONAL_TABLE, citydept: JEJU_CITY_DEPT_TABLE },
  // 2026-07-24 — 1단계 확대: 부산 16개 자치구·군 + 서울 25개 자치구
  // 메타데이터 등록 완료(계획서 v1.1 §5). L2는 v1.0부터 이미 실사 완료 상태.
  busan: { l2: BUSAN_L2_TABLE, city: BUSAN_CITY_TABLE, national: [], citydept: BUSAN_CITY_DEPT_TABLE },
  seoul: { l2: SEOUL_L2_TABLE, city: SEOUL_CITY_TABLE, national: [], citydept: SEOUL_CITY_DEPT_TABLE },
  incheon: { l2: INCHEON_L2_TABLE, city: [], national: [], citydept: [] },  // ⚠️ 2026-08 시행 예정(안)
  daejeon: { l2: DAEJEON_L2_TABLE, city: [], national: [], citydept: [] },
  ulsan: { l2: ULSAN_L2_TABLE, city: [], national: [], citydept: [] },
  sejong: { l2: SEJONG_L2_TABLE, city: [], national: [], citydept: [] },
  chungbuk: { l2: CHUNGBUK_L2_TABLE, city: [], national: [], citydept: [] },
  chungnam: { l2: CHUNGNAM_L2_TABLE, city: [], national: [], citydept: [] },
  jeonbuk: { l2: JEONBUK_L2_TABLE, city: [], national: [], citydept: [] },
  gyeongbuk: { l2: GYEONGBUK_L2_TABLE, city: [], national: [], citydept: [] },  // ⚠️ 조직개편 중, 신뢰도 낮음
  // 2026-07-24 — 진주·창원(+5개 일반구)·산청군 파일럿 인스턴스 신설(주피터 지시).
  gyeongnam: { l2: GYEONGNAM_L2_TABLE, city: GYEONGNAM_CITY_TABLE, national: [], citydept: GYEONGNAM_CITY_DEPT_TABLE },  // ⚠️ L2는 스냅샷 불일치, 신뢰도 낮음
};
function _l2Table() { return PROVINCE_TABLES[_resolveProvinceCode()]?.l2 || []; }
function _cityTable() { return PROVINCE_TABLES[_resolveProvinceCode()]?.city || []; }
function _nationalTable() { return PROVINCE_TABLES[_resolveProvinceCode()]?.national || []; }
function _cityDeptTable() { return PROVINCE_TABLES[_resolveProvinceCode()]?.citydept || []; }

function _matchNational(text) {
  return _scoreMatch(text, _nationalTable());
}

// ── L2Department 원형(canonical) 키워드 (2026-07-21 신설) ────────────
// 주피터 지시: "도청 등의 원형 클래스를 먼저 구현하고, 제주도청 등의
// 인스턴스를 사전에 혹은 실시간으로 조합해야 합니다." — 지금까지 L2
// 매칭은 도별 실사 테이블(JEJU_L2_TABLE 등)에만 의존해서, 실사 안 된
// 도(강원 등)는 도청 업무 자체를 전혀 판별하지 못했다(사고실험에서
// 확인). 이 원형 키워드는 실사 여부와 무관하게 최소한의 도메인
// 판별("이건 ○○ 관련 업무입니다")까지는 가능하게 하는 안전망이다 —
// 특정 부서명·연락처까지 확정하지는 않는다(실사 데이터가 있을 때만
// 가능한 일이라 정직하게 구분).
//
// 근거: 실사 완료된 12개 도의 L2 테이블을 실측 분석해, 2개 이상 도에서
// 공통으로 쓰인 어휘만 채택(도 하나만의 조직명은 배제). plan 도메인의
// 세정 관련 어휘(지방세/취득세/재산세/세정)는 govType 가드(#27)의
// 발견과 동일한 이유로 의도적으로 제외했다 — 원형에 넣으면 GENERAL
// 도에서 도청 오판정을 원형 단계부터 재생산하게 된다.
const L2_CANONICAL_KEYWORDS = {
  plan: ['기획조정실', '예산', '기획'],
  safety: ['재난', '안전', '태풍', '호우'],
  jachi: ['자치행정', '자치분권'],
  econ: ['소상공인', '일자리', '투자유치', '중소기업', '자영업'],
  innov: ['스타트업', '인공지능', '바이오산업'],
  welfare: ['기초생활수급', '기초연금', '장애인복지'],
  climate: ['환경', '탄소중립', '산림'],
  housing: ['주택', '건설'],
  transport: ['교통', '대중교통', '버스', '지하철'],
  culture: ['문화예술', '문화', '도서관'],
  tourism: ['관광', '숙박업', '여행업'],
  agri: ['농업', '축산'],
  ocean: ['어업', '수산', '해양'],
  health: ['보건', '감염병'],
  family: ['출산', '보육', '임신', '여성가족'],
  sports: ['체육', '생활체육'],
};
const _L2_DOMAIN_LABEL_KO = {
  plan: '기획·예산', safety: '안전·재난', jachi: '자치행정', econ: '경제·소상공인',
  innov: '혁신산업', welfare: '복지', climate: '환경·기후', housing: '주택·건설',
  transport: '교통', culture: '문화', tourism: '관광', agri: '농업·축산',
  ocean: '해양수산', health: '보건', family: '여성가족', sports: '체육',
};
function _matchL2Canonical(text) {
  for (const [domain, kws] of Object.entries(L2_CANONICAL_KEYWORDS)) {
    if (kws.some(k => text.includes(k))) return domain;
  }
  return null;
}
function _renderL2CanonicalFallback(domain) {
  const label = _L2_DOMAIN_LABEL_KO[domain] || domain;
  return `[실국 원형 매칭 — 이 지역 실사 전] '${label}' 관련 업무로 보입니다. ` +
    `담당 부서·연락처는 아직 실사되지 않아 구체적으로 안내하기 어렵습니다 — ` +
    `정부24(gov.kr), 해당 광역시도 대표전화, 또는 국번없이 110(정부민원안내)으로 확인해 주세요.`;
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
  'SP-DO-HEALTH': '보건 담당 [2026-07-20 신설 — 제주는 SP-DO-SAFETY에 통합, 별도 분리된 도만 이 코드 사용]',
  'SP-DO-FAMILY': '여성가족 담당 [2026-07-20 신설 — 제주는 SP-DO-WELFARE에 통합, 별도 분리된 도만 이 코드 사용]',
  'SP-DO-SPORTS': '체육 담당 [2026-07-20 신설 — 제주는 SP-DO-CULTURE에 통합, 별도 분리된 도만 이 코드 사용]',
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
  // ★ 2026-07-24 신설(100건 사고실험에서 발견) — JEJU_NATIONAL_TABLE에
  // 같이 추가한 6개 기관. LLM 분류 폴백(_classifyFallback)이 여기 없는
  // 코드는 무조건 무시하므로(ROUTE_DESCRIPTIONS[code] 존재 확인), 이걸
  // 안 하면 라우팅 테이블에 넣어도 LLM 폴백 경로에서는 여전히 인식 못 함.
  'SP-NAT-CUSTOMS': '제주세관(관세청)',
  'SP-NAT-BOK': '한국은행 제주본부(중앙은행)',
  'SP-NAT-STAT': '통계청 제주사무소(통계청)',
  'SP-NAT-FORESTRESEARCH': '난대·아열대산림연구소(산림청 국립산림과학원)',
  'SP-NAT-FORESTSEED': '국립산림품종관리센터 제주지소(산림청)',
  'SP-NAT-FORESTCOOP': '산림조합중앙회 제주지역본부(국가기관 아님 — 임업인 출자 협동조합)',
  'SP-CITY-JEJU': '제주시청',
  'SP-CITY-SEOGWIPO': '서귀포시청',
  'SP-SIGUNGU-LAZY': '시군구(기초자치단체) 관할 업무 — 텍스트에 정적 테이블에 없는 특정 시/군/구 이름이 언급되고 그 지자체 소관 업무(복지·안전·민원·환경 등) 문의로 보이는 경우 [2026-07-20 신설 — 지연 초기화]',
  'SP-NATIONAL-LAZY': '국가기관 지사(세무서·법원·검찰청·경찰청·건강보험공단 등 19개 핵심 기관) 관할 업무 — 정적 국가기관 테이블이 비어 있는 도(제주 외)에서 국가기관성 키워드가 언급된 경우 [2026-07-20 신설 — 지연 초기화]',
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
// ── candidatesText province-aware 필터링 (2026-07-24 신설, 전국 인스턴스
// 롤아웃 계획 0단계) ─────────────────────────────────────────────
// 이전엔 ROUTE_DESCRIPTIONS의 모든 코드(제주 전용 정적 인스턴스 포함)를
// 도 구분 없이 LLM에게 후보로 통째로 보여줬다. 국가기관 지사가 지금은
// 제주만 정적 인스턴스가 있는 구조라, 비제주 사용자 질문에 LLM이
// SP-NAT-TAX 같은 제주 전용 코드를 골라도 _findTableEntry가 조용히 못
// 찾아 실패하고(SP-NATIONAL-LAZY를 골랐어야 정답) 일반 안내로 떨어지는
// 문제가 있었다. 전국 인스턴스화가 진행될수록(15개 도 추가) 이 문제의
// 발생 빈도가 함께 커지므로, 데이터를 채우기 전에 먼저 후보 목록 자체를
// "이 도에서 실제로 존재하는 코드"로만 한정한다.
function _buildCandidatesText() {
  const provinceCode = _resolveProvinceCode();
  const registryEntry = PROVINCE_REGISTRY[provinceCode];
  const codes = new Set();

  // 실사된 도청 실국·시청·국가기관 코드만 후보에 넣는다(빈 배열이면
  // 아무것도 안 들어가고, 대신 아래에서 LAZY 코드가 그 자리를 메운다).
  for (const e of _l2Table()) codes.add(e.code);
  for (const e of _cityTable()) codes.add(e.code);
  for (const e of _nationalTable()) codes.add(e.code);

  // 국가기관 정적 인스턴스가 없는 도(현재 제주 외 전부)는 SP-NAT-* 코드
  // 대신 SP-NATIONAL-LAZY를 후보로 준다 — 정적 인스턴스가 있으면(제주)
  // 이미 위에서 실제 코드가 채워졌으므로 LAZY는 불필요.
  if (_nationalTable().length === 0) codes.add('SP-NATIONAL-LAZY');

  // 시군구(기초자치단체) 지연조회는 GENERAL 도에서만 의미가 있다
  // (SPECIAL_AUTONOMOUS인 제주는 기초자치단체 자체가 없음).
  if (registryEntry?.govType === 'GENERAL') codes.add('SP-SIGUNGU-LAZY');

  return [...codes]
    .filter(code => ROUTE_DESCRIPTIONS[code])
    .map(code => `${code}: ${ROUTE_DESCRIPTIONS[code]}`)
    .join('\n');
}

async function _classifyFallback(text, classifyFn) {
  if (!classifyFn) return null;
  const candidatesText = _buildCandidatesText();
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

// ── 도 클래스/인스턴스 레지스트리 (2026-07-21 신설) ──────────────
// 주피터 지시: "제주도는 8개 광역시도 중 하나일 뿐입니다. 도청 등의
// 원형 클래스를 먼저 구현하고, 제주도청 등의 인스턴스를 조합해야
// 합니다." — 이 레지스트리가 그 첫 단계다. PROVINCE_TABLES·EMD_PATHS를
// 수기로 다시 베끼지 않고 거기서 그대로 계산한다(이중 관리 시 실사
// 현황이 어긋나는 사고를 구조적으로 막기 위함) — 새 도의 실사가
// 끝나 PROVINCE_TABLES/EMD_PATHS에 반영되면 이 레지스트리는 재계산
// 없이 자동으로 최신 상태가 된다.
//
// govType: 'SPECIAL_AUTONOMOUS'(제주 — 기초자치단체 없음, 도가 세정
// 등을 직할) | 'GENERAL'(그 외 — 시군구가 기초자치단체로 존재).
// 재산세 등 세정 라우팅이 이 필드로 분기해야 한다(제주 규칙을 다른
// 도에 그대로 투사하면 안 됨 — 사고실험에서 확인된 문제).
const SPECIAL_AUTONOMOUS_PROVINCES = new Set(['jeju']);

function _computeProvinceRegistry() {
  const registry = {};
  for (const [name, code] of Object.entries(PROVINCE_NAME_TO_CODE)) {
    if (registry[code]) continue; // 도별로 한 번만 계산(이름은 여러 개, 코드는 하나)
    const t = PROVINCE_TABLES[code] || { l2: [], city: [], national: [] };
    registry[code] = {
      govType: SPECIAL_AUTONOMOUS_PROVINCES.has(code) ? 'SPECIAL_AUTONOMOUS' : 'GENERAL',
      dataStatus: {
        province: '01-do/templates/province-master-data.json' /* 별도 레코드 없으면 호출부(_loadDoSp)가 폴백 처리 */,
        l2: t.l2.length > 0 ? 'available' : 'none',
        city: t.city.length > 0 ? 'available' : 'none',
        national: t.national.length > 0 ? 'available' : 'none',
        emd: EMD_PATHS[code] ? 'available' : 'none',
      },
    };
  }
  return registry;
}
// EMD_PATHS 선언 직후에 즉시 계산 — 아래에서 참조하는 모든 테이블이
// 이 시점에 이미 선언·초기화돼 있어야 한다(모듈 로드 순서 의존).
const PROVINCE_REGISTRY = _computeProvinceRegistry();

// ── 읍면동명 → 도코드 역색인 (2026-07-21 신설, 버그3 수정) ─────────
// EMD_PATHS에 등록된 도(현재 jeju)의 읍면동 마스터 데이터를 전부 읽어
// {읍면동명: 도코드} 평면 색인을 만든다 — _guessProvinceFromText의
// 3순위 판별원. 세션당 1회만 로드(모듈 전역 캐시).
let _emdNameToProvinceIndex = null;
async function _loadEmdNameToProvinceIndex() {
  if (_emdNameToProvinceIndex) return _emdNameToProvinceIndex;
  const index = {};
  for (const [provinceCode, paths] of Object.entries(EMD_PATHS)) {
    try {
      const [masterRaw, ...extraRaws] = await Promise.all([
        _fetchText(paths.master),
        ...(paths.extra || []).map(p => _fetchText(p)),
      ]);
      const master = JSON.parse(masterRaw);
      const extras = extraRaws.map(r => JSON.parse(r));
      for (const rec of [...master.읍면동목록, ...extras]) {
        if (rec.읍면동명 && !index[rec.읍면동명]) index[rec.읍면동명] = provinceCode;
        // ★ 2026-07-24 수정(100건 사고실험에서 발견) — 관할리(里) 이름도
        // 같이 색인한다. _matchEmd()는 리 이름까지 인식하는데, 그보다
        // 앞 단계인 이 도 판별 색인은 읍면동명만 넣고 있어서 "한림리
        // 전입신고"처럼 리 이름만 언급하고 상위 읍 이름·"제주" 언급이
        // 전혀 없으면 도 판별 자체가 실패해 "지역 미판별"로 조기
        // 반환되는 버그였다 — _matchEmd에 도달하기도 전에 걸러짐.
        for (const ri of rec.관할리목록 || []) {
          const riName = ri.split('(')[0].trim();
          if (riName && !index[riName]) index[riName] = provinceCode;
        }
      }
    } catch (e) {
      console.warn(`[gov-router] EMD 이름 역색인 로드 실패(${provinceCode}): ${e.message}`);
    }
  }
  _emdNameToProvinceIndex = index;
  return index;
}

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

// ★ 2026-07-23 수정(주피터 지시 — 건축법 제14조 사고실험) — pdvLocationHint
// 인자 추가. 기존엔 emdMatch(_matchEmd)만 힌트를 봤고 이 함수는 text만
// 봐서, "서귀포시 동홍동" 같은 PDV 위치가 있어도 발화 자체에 지역명이
// 없으면("건축 인허가 신청하고 싶어요") 행정시를 특정 못 하고 놓쳤다
// — _matchEmd와 동일한 우선순위(발화 우선, 없으면 힌트)로 통일한다.
// ★ 2026-07-24 수정(100건 사고실험에서 발견) — 반환값에 _matchedViaTextItself
// 플래그 추가(원본 테이블 항목을 얕은 복사해 새 필드만 얹음 — 공유 상수
// 테이블 자체는 변경하지 않는다). 발화 자체에 시 이름이 있는 경우와
// PDV 힌트로만 시가 특정된 경우를 호출부가 구분할 수 있어야, "힌트로만
// 시가 잡혔고 더 구체적인 도메인 매칭 기회가 남아있으면 그걸 먼저
// 시도한다"는 판단이 가능해진다(아래 stage 2 참고).
function _matchCity(text, pdvLocationHint) {
  for (const c of _cityTable()) {
    if (c.kw.some(k => text.includes(k))) return { ...c, _matchedViaTextItself: true };
  }
  if (pdvLocationHint) {
    for (const c of _cityTable()) {
      if (c.kw.some(k => pdvLocationHint.includes(k))) return { ...c, _matchedViaTextItself: false };
    }
  }
  return null;
}

// ── AdministrativeCity(행정시) 이름 기반 조회 (2026-07-21 신설) ──────
// 주피터 지시: "클래스와 인스턴스 관계를 명확히 규정하십시오(광역시도,
// 시군구, 읍면동, 국가기관 지역 사무소)." — 행정시(AdministrativeCity,
// 자치권 없음, SPECIAL_AUTONOMOUS 도에만 존재·현재는 제주 유일)와
// 시군구청(MunicipalGovernment, 자치권 있음, GENERAL 도의 기초자치
// 단체·sigungu-national-list.json 기반)은 서로 다른 클래스인데, EMD
// 매칭 코드가 "_cityTable()[0]/[1]" 배열 인덱스로 "행정시는 정확히
// 2개, 순서는 제주시가 먼저"라고 암묵 가정하고 있었다 — 다른
// SPECIAL_AUTONOMOUS 도가 추가되거나 순서가 다르면 조용히 잘못된
// 행정시를 반환할 구조였다. 이름으로 조회하도록 일반화한다.
function _findCityByName(cityName) {
  return _cityTable().find(c => c.kw.includes(cityName)) || null;
}


// ── 시군구 지연 초기화 — 클라이언트측(브라우저) 안전한 fetch (2026-07-20) ──
// ⚠️ 비밀키 없음 — worker.js(hondi-proxy)의 /gov/sigungu-dept-resolve를
// 호출할 뿐이다. 실패해도(네트워크 오류·CORS 등) 예외를 던지지 않고 안전한
// 기본 문구로 대체 — 이 기능이 죽어도 기존 라우팅에 영향 없음.
const SIGUNGU_RESOLVE_ORIGIN = 'https://hondi-proxy.tensor-city.workers.dev';

// SSE(text/event-stream) 응답을 파싱해 progress 이벤트마다 onProgress를
// 호출하고, done 이벤트의 payload를 최종 결과로 반환한다.
async function _consumeSigunguSSE(bodyStream, onProgress) {
  const reader = bodyStream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 2);
      if (!chunk.startsWith('data:')) continue;
      let payload;
      try { payload = JSON.parse(chunk.slice(5).trim()); } catch { continue; }
      if (payload.status === 'progress') {
        if (typeof onProgress === 'function') {
          try { onProgress(payload); } catch (e) { console.warn('[gov-router] onProgress 콜백 실패(무시):', e?.message); }
        }
      } else if (payload.status === 'done') {
        result = payload;
      }
    }
  }
  return result;
}

// onProgress(선택) — worker.js가 SSE로 매초 진행상황을 보내면 payload
// ({status:'progress', elapsed, message})를 그대로 넘겨받는 콜백(2026-07-21
// 신설, 주피터 지시: "매 초마다 진행 상황을 알려주고, 정확한 답을
// 제출하는 것"). worker.js가 구버전(단일 JSON) 응답을 주더라도
// Content-Type으로 분기해 안전하게 처리한다.
async function resolveSigunguDept(cityGuess, domain, onProgress) {
  try {
    const url = `${SIGUNGU_RESOLVE_ORIGIN}/gov/sigungu-dept-resolve?city=${encodeURIComponent(cityGuess)}&domain=${encodeURIComponent(domain)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream') && res.body) {
      const streamed = await _consumeSigunguSSE(res.body, onProgress);
      if (streamed) return streamed;
      throw new Error('SSE 스트림이 done 이벤트 없이 종료됨');
    }
    const data = await res.json();
    return data;
  } catch (e) {
    console.warn('[gov-router] resolveSigunguDept 실패, 기본 문구로 대체:', e?.message);
    return {
      text: `${cityGuess} 관련 문의는 해당 시군구 대표전화 또는 정부24(gov.kr)로 확인해 주세요.`,
      verified: false, source: 'error_fallback',
    };
  }
}

// ── 시군구 지연 초기화용 휴리스틱 (2026-07-20 신설) ──────────────
// ★ 정밀하지 않음 — "정읍시가 아니라 정읍시가"처럼 실제 지명이 아닌
// 문자열도 걸릴 수 있다. KOSIS 리졸버와 동일하게 "일단 v1으로 배선하고
// 실사용 로그(sigungu_dept_resolve_log)가 쌓이면 정교화"하는 전략을 쓴다
// — 오탐이 나도 결과 자체가 "확인 안 됨" 톤이라 사용자에게 해를 끼치지
// 않는다(_renderFallback 참고).
const _SIGUNGU_FALSE_POSITIVE_WORDS = [
  '필요시', '동시', '당시', '임시', '수시', '즉시', '항시',
  // ★ 2026-07-21 추가 — 8개 광역시·특별시 이름이 [가-힣]{2,4}(시|군|구)
  // 정규식에 걸려 시/군/구로 오인되던 버그(50개 사고실험 A7 등에서 실증
  // — "서울시 소상공인 지원 문의"가 SEOUL_L2_TABLE의 SP-DO-ECON 정밀
  // 매칭 대신 시군구 지연초기화로 잘못 빠졌었다).
  '서울시', '부산시', '대구시', '인천시', '광주시', '대전시', '울산시', '세종시',
];
function _guessSigunguNameFrom(src) {
  if (!src) return null;
  const pattern = /([가-힣]{2,4}(?:시|군|구))/g;
  let m;
  while ((m = pattern.exec(src)) !== null) {
    const candidate = m[1];
    if (_SIGUNGU_FALSE_POSITIVE_WORDS.includes(candidate)) continue;
    return candidate;
  }
  return null;
}
// ★ 2026-07-21 수정 — pdvLocationHint도 함께 본다(발화에 없으면 PDV로
// 폴백, 도 판별과 동일한 우선순위). 사용자가 "세무서 문의"처럼 지역
// 언급 없이 말해도, AC가 이미 아는 위치(GPS/PDV)로 시/군을 특정한다.
function _guessSigunguName(text, pdvLocationHint) {
  return _guessSigunguNameFrom(text) || _guessSigunguNameFrom(pdvLocationHint);
}

const _SIGUNGU_DOMAIN_KEYWORDS = {
  welfare: ['복지', '기초생활수급', '기초연금'],
  family: ['여성가족', '보육', '어린이집', '임신', '출산'],
  health: ['보건소', '예방접종', '건강검진', '감염병'],
  safety: ['재난', '안전', '화재'],
  // ★ 2026-07-24 추가(100건 사고실험에서 발견) — '여권'이 국가기관 19개
  // 도메인·시군구 15개 도메인 어디에도 없어서, LLM이 올바르게
  // "시군구 소관"(한국 여권은 출입국청이 아니라 시/군/구 여권과 발급)으로
  // 분류해도 도메인 추출 단계에서 실패해 안내가 끊기는 문제였다.
  jachi: ['민원', '주민등록', '인감', '자치행정', '여권'],
  // ★ 2026-07-24 추가(100건 사고실험에서 발견) — '폐업'이 어느 도메인에도
  // 없어서 "폐업 신고하려고요"를 LLM이 SP-SIGUNGU-LAZY로 정확히 분류해도
  // 도메인을 못 뽑아 최종적으로 실패했다. 폐업 신고는 지방세(사업자
  // 등록말소)·인허가(영업신고 반납) 등 시군구 세무·경제 부서 소관이라
  // econ에 추가한다.
  econ: ['일자리', '소상공인', '지역경제', '전통시장', '폐업'],
  climate: ['환경', '쓰레기', '재활용', '분리배출'],
  housing: ['건축', '주택', '도시계획'],
  // ★ 2026-07-24 추가(주피터 지시로 재확인 — 100건 사고실험 항목3) —
  // '자동차등록'/'차량등록'/'반려동물등록'이 어느 시군구 도메인에도
  // 없었다. 제주는 정적 테이블(JEJU_CITY_DEPT_TABLE의 safety 도메인)에
  // '차량등록' 키워드가 있어 이 문제를 안 겪었지만, 정적 테이블이 없는
  // 비제주 지역은 SIGUNGU-LAZY 지연조회 자체가 발동을 못 해 "수원시
  // 자동차 등록하려고요" 같은 정당한 요청이 전부 놓쳤다. 차량등록은
  // 제주에서도 safety(교통행정) 소관이라 같은 도메인에 맞춘다.
  transport: ['버스', '교통', '도로', '자동차등록', '자동차 등록', '차량등록', '차량 등록', '차량말소', '번호판'],
  // ★ 2026-07-24 추가 — '반려동물등록'은 기존 15개 도메인 중 어디에도
  // 안 맞는 새 카테고리라(동물보호법상 시군구 소관이지만 복지/보건/환경
  // 어느 것과도 딱 맞지 않음), 가장 가까운 climate(환경·생활)에 더하지
  // 않고 정직하게 새 도메인을 하나 신설한다 — 억지로 기존 도메인에
  // 끼워넣으면 SP-SIGUNGU-LAZY가 엉뚱한 부서로 조회할 위험이 있다.
  animal: ['반려동물등록', '반려동물 등록', '동물등록', '동물 등록', '유기동물', '동물보호'],
  culture: ['문화', '도서관', '축제'],
  tourism: ['관광'],
  sports: ['체육', '생활체육'],
  agri: ['농정', '농업', '축산'],
  ocean: ['수산', '어업'],
  plan: ['기획', '예산', '지방세', '취득세', '재산세', '세정'],
};
function _guessDomainFromText(text) {
  for (const [domain, kws] of Object.entries(_SIGUNGU_DOMAIN_KEYWORDS)) {
    if (kws.some(k => text.includes(k))) return domain;
  }
  return null;
}

// ── 국가기관 지연 초기화 — 클라이언트측(브라우저) 안전한 fetch (2026-07-20) ──
// ⚠️ 비밀키 없음 — worker.js(hondi-proxy)의 /gov/national-agency-resolve를
// 호출할 뿐이다(SIGUNGU_RESOLVE_ORIGIN과 동일 Worker 재사용). 실패해도
// 예외를 던지지 않고 안전한 기본 문구로 대체 — 이 기능이 죽어도 기존
// 라우팅에 영향 없음(시군구 리졸버와 완전히 동일한 안전 철학).
// onProgress(선택, 2026-07-21 신설) — worker.js가 SSE로 매초 진행상황을
// 보내면 그대로 넘겨받는 콜백. SSE 파싱은 _consumeSigunguSSE(범용 —
// "sigungu" 전용이 아니라 이 프로젝트의 모든 지연조립 리졸버가 쓰는
// data: 라인 프로토콜 파서)를 그대로 재사용한다.
// cityHint(선택, 2026-07-21 신설) — 시/군까지 특정되면 worker.js가 그
// 시/군 관할 지사만 골라 검색한다(도 전체엔 세무서가 여럿이라 시/군
// 없이는 정답을 하나로 좁힐 수 없다 — 실제 배포 재현으로 확인된 문제).
async function resolveNationalAgencyLazy(provinceCode, provinceName, domain, onProgress, cityHint) {
  try {
    const url = `${SIGUNGU_RESOLVE_ORIGIN}/gov/national-agency-resolve?domain=${encodeURIComponent(domain)}&province=${encodeURIComponent(provinceCode)}&provinceName=${encodeURIComponent(provinceName)}` +
      (cityHint ? `&city=${encodeURIComponent(cityHint)}` : '');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream') && res.body) {
      const streamed = await _consumeSigunguSSE(res.body, onProgress);
      if (streamed) return streamed;
      throw new Error('SSE 스트림이 done 이벤트 없이 종료됨');
    }
    const data = await res.json();
    return data;
  } catch (e) {
    console.warn('[gov-router] resolveNationalAgencyLazy 실패, 기본 문구로 대체:', e?.message);
    return {
      text: `${provinceName} 관련 국가기관 지사 문의는 정부24(gov.kr) 또는 국번없이 110(정부민원안내)으로 확인해 주세요.`,
      verified: false, source: 'error_fallback',
    };
  }
}

// 도코드 → 정식 도이름 역매핑(PROVINCE_NAME_TO_CODE에서 각 코드별 가장
// 긴(정식) 이름만 뽑아 구성 — worker.js provinceName 파라미터용).
const PROVINCE_CODE_TO_NAME = {};
for (const [name, code] of Object.entries(PROVINCE_NAME_TO_CODE)) {
  if (!PROVINCE_CODE_TO_NAME[code] || name.length > PROVINCE_CODE_TO_NAME[code].length) {
    PROVINCE_CODE_TO_NAME[code] = name;
  }
}
function _provinceCodeToName(code) {
  return PROVINCE_CODE_TO_NAME[code] || code;
}

// ── 국가기관 지연 초기화용 도메인 휴리스틱 (2026-07-20 신설) ──────
// worker.js NAT_AGENCY_COMMON_PATTERNS/NAT_AGENCY_LABEL_KO의 19개 도메인과
// 1:1 대응. 시군구 휴리스틱과 동일하게 "일단 v1으로 배선하고 실사용 로그
// (national_agency_resolve_log)가 쌓이면 정교화"하는 전략을 쓴다.
const _NAT_AGENCY_DOMAIN_KEYWORDS = {
  tax: ['세무서', '국세', '부가세', '소득세', '법인세', '세무'],
  court: ['법원', '재판', '소송', '판결', '민사', '형사'],
  prosecution: ['검찰', '기소', '공소', '수사'],
  police: ['지방경찰청', '국가경찰'],
  labor: ['근로복지공단', '산재', '산업재해'],
  laborimprove: ['근로개선', '고용노동청', '근로감독'],
  nhis: ['건강보험공단', '국민건강보험'],
  nps: ['국민연금공단', '국민연금'],
  immigration: ['출입국', '비자', '외국인등록', '체류자격'],
  post: ['우정청', '우체국', '우편'],
  mma: ['병무청', '징병', '입영', '병역'],
  customs: ['세관', '관세', '통관'],
  veterans: ['보훈청', '국가유공자', '보훈'],
  weather: ['지방기상청', '기상특보'],
  coastguard: ['해양경찰', '해경'],
  port: ['해양수산청', '항만'],
  probation: ['준법지원센터', '보호관찰'],
  bok: ['한국은행'],
  stat: ['통계청'],
};
function _guessNatAgencyDomainFromText(text) {
  for (const [domain, kws] of Object.entries(_NAT_AGENCY_DOMAIN_KEYWORDS)) {
    if (kws.some(k => text.includes(k))) return domain;
  }
  return null;
}

// ── govType 기반 세정 라우팅 가드 (2026-07-21 신설) ──────────────
// 주피터 지시: "도청 등의 원형 클래스를 먼저 구현하고... 클래스와
// 인스턴스 관계를 명확히 규정하십시오." — PROVINCE_REGISTRY의 govType
// 필드를 실제 라우팅 분기에 처음 연결하는 지점. SPECIAL_AUTONOMOUS(제주)
// 는 기초자치단체가 없어 세정이 도청 직할이 맞지만, GENERAL(그 외 전부)
// 은 세정이 시군구 소관이다 — 이 구분 없이 jeju L2 키워드를 그대로
// 복붙한 도(busan·seoul)의 실사 데이터가 사고실험에서 확인됐다.
const _MUNICIPAL_TAX_KEYWORDS = ['지방세', '취득세', '재산세', '세정'];
function _isMunicipalTaxOnlyMatch(text, entry) {
  if (!entry || entry.code !== 'SP-DO-PLAN') return false;
  const matchedKw = entry.kw.filter(k => text.includes(k));
  if (matchedKw.length === 0) return false;
  return matchedKw.every(k => _MUNICIPAL_TAX_KEYWORDS.includes(k));
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

// ── 인허가류 사무 프로토콜 강제삽입 (2026-07-23 신설) ────────────────
// 주피터 지시(건축법 제14조 건축신고 사고실험): 부서 SP 본문이
// PERMIT-CRITERIA-PROTOCOL을 참조하는 문구를 빠뜨려도 적용되도록,
// 강제 지점을 부서 SP 텍스트가 아니라 이 라우터(코드) 단에 둔다 —
// §LEGAL-BASIS 상속 규칙과 동일한 SSOT 원칙. rec.처리사무 필드가
// 비어있으면 이 함수는 아무 것도 하지 않는다(대다수 부서는 아직
// 이 필드가 없음 — 데이터 채우기는 별도 작업).
let _permitProtocolCache = null;
async function _loadPermitProtocol() {
  if (!_permitProtocolCache) {
    _permitProtocolCache = await _fetchText('08-schema/PERMIT-CRITERIA-PROTOCOL_v1_0.md');
  }
  return _permitProtocolCache;
}

async function _appendPermitProtocolIfNeeded(text, rec) {
  const codes = (rec && Array.isArray(rec.처리사무)) ? rec.처리사무.filter(Boolean) : [];
  if (codes.length === 0) return { text, permitCodes: [] };
  const protocol = await _loadPermitProtocol();
  return { text: text + '\n\n---\n\n' + protocol, permitCodes: codes };
}

async function _fetchDeptText(entry) {
  if (!entry.domain || !entry.도코드) return { text: await _fetchText(entry.file), permitCodes: [] };
  const records = await _loadDeptMasterData();
  const rec = records.find(r => r.domain === entry.domain && r.도코드 === entry.도코드);
  if (!rec || !rec.template) {
    console.warn(`[Jeju] 부서 데이터 레코드/템플릿 없음(domain=${entry.domain}, 도코드=${entry.도코드}) — static file로 폴백`);
    return _appendPermitProtocolIfNeeded(await _fetchText(entry.file), rec);
  }
  const template = await _fetchText(`02-do-dept/templates/${rec.template}`);
  return _appendPermitProtocolIfNeeded(_renderDeptTemplate(template, rec), rec);
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
  if (!entry.domain || !entry.도코드) return { text: await _fetchText(entry.file), permitCodes: [] };
  const records = await _loadNatMasterData();
  const rec = records.find(r => r.domain === entry.domain && r.도코드 === entry.도코드);
  if (!rec || !rec.template) {
    console.warn(`[Jeju] 국가기관 데이터 레코드/템플릿 없음(domain=${entry.domain}, 도코드=${entry.도코드}) — static file로 폴백`);
    return _appendPermitProtocolIfNeeded(await _fetchText(entry.file), rec);
  }
  // ★ 2026-07-21 수정(버그4) — rec.template 필드값은 있는데 그 파일이
  // 실제로 저장소에 없는 경우(예: SP-NAT-TAX-TEMPLATE_v1.0.md 404)를
  // 못 잡고 그대로 throw해 응답 전체가 깨지던 버그(50개 사고실험 D1·D6
  // 에서 세무서·병무청 둘 다 실제로 재현). 템플릿 fetch를 try/catch로
  // 감싸 static file → 그것도 실패하면 정직한 정보없음으로 단계적
  // 폴백한다.
  try {
    const template = await _fetchText(`09-national/agencies/templates/${rec.template}`);
    return _appendPermitProtocolIfNeeded(_renderNatTemplate(template, rec), rec);
  } catch (e) {
    console.warn(`[gov-router] 국가기관 템플릿 파일 없음(${rec.template}): ${e.message} — static file로 폴백`);
    try {
      return _appendPermitProtocolIfNeeded(await _fetchText(entry.file), rec);
    } catch (e2) {
      console.warn(`[gov-router] static 폴백도 실패(${entry.file}): ${e2.message} — 정직한 정보없음으로 대체`);
      return {
        text: `[정보 없음] ${entry.code} 관련 상세 안내를 아직 준비하지 못했습니다. ` +
          `정부24(gov.kr) 또는 국번없이 110(정부민원안내)으로 확인해 주세요.`,
        permitCodes: [],
      };
    }
  }
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

// ── 시청 국(局) 렌더링·fetch ──────────────────────────────────────
// 2026-07-23 신설, 2026-07-24 개편(주피터 지시) — 단일 SP-CITYDEPT-TEMPLATE
// 1개를 쓰던 방식에서, 도청(SP-DEPT-*-TEMPLATE 16개)과 동일하게 **국코드별
// 추상 템플릿**(SP-CITYDEPT-{DOMAIN}-TEMPLATE_v1.0.md, §LEGAL-BASIS에 도메인별
// 개별 소관법 명시)을 쓰도록 바꿨다 — rec.template 필드로 선택.
// 실제 조직명(국이름)을 몰라도 DEFAULT_DEPT_LABEL로 즉시 렌더링 가능(주피터
// 지시: "개별 기관의 부서 명칭이 무엇이든 중요하지 않다") — city-dept-master-data.json
// 레코드에 없으면 상위 시청 텍스트만으로 폴백(호출부가 이미 시청 텍스트를
// parts에 넣은 뒤이므로, 여기서는 추가 텍스트 없이 조용히 스킵).

// 국코드별 기본 표시 라벨 — 실사로 확인된 실명이 아직 없는 인스턴스가
// "정식 명칭 확인 중" 상태로도 즉시 응답 가능하게 한다(SP-CITYDEPT-*-TEMPLATE
// 생성 스크립트의 dept_generic과 1:1 대응, 04-city/templates/에서 재생성 시
// 함께 갱신할 것).
const CITY_DEPT_DEFAULT_LABEL = {
  plan: '기획(예산)담당부서', safety: '안전총괄담당부서', jachi: '자치행정담당부서',
  econ: '지역경제담당부서', innov: '미래산업담당부서', welfare: '사회복지담당부서',
  climate: '환경관리담당부서', housing: '건설(주택)담당부서', transport: '교통행정담당부서',
  culture: '문화체육담당부서', sports: '체육담당부서', tourism: '관광담당부서',
  agri: '농축산담당부서', ocean: '해양수산담당부서', health: '보건소', family: '여성가족담당부서',
};

// 지자체유형별 기본 처분권 문구 — rec.처분권_문구가 있으면 그걸 우선하고,
// 없으면 rec.지자체유형으로 이 표에서 기본값을 고른다(둘 다 없으면 '일반시'
// 취급 — 처분권 있음 쪽을 기본값으로 두는 게 "일반구인데 자치구로 오안내"
// 보다 안전 — 반대 방향 오류(자치구인데 일반구로 안내)는 사용자가 시청으로
// 잘못 이첩되어도 최종적으로는 처리되지만, 반대는 "이 구가 처리 못 한다"는
// 잘못된 안내가 나갈 수 있어 비대칭적으로 위험하다).
const CITY_TYPE_DISPOSITION_DEFAULT = {
  일반시: '이 부서가 직접 처분청이다 — 정식 신청·심사를 통해 확정.',
  특례시: '이 부서가 직접 처분청이다(특례시 조항에 따라 일부 도메인은 광역시급 권한 포함) — 정식 신청·심사를 통해 확정.',
  자치구: '이 부서가 직접 처분청이다 — 정식 신청·심사를 통해 확정.',
  군: '이 부서가 직접 처분청이다 — 정식 신청·심사를 통해 확정.',
  행정시: '이 부서가 직접 처분청이다(행정시 체계 — 도지사 임명 시장 하의 국·과) — 정식 신청·심사를 통해 확정.',
  일반구: '수행 불가 — 이 구는 법인격이 없어 처분권자가 아니다. 실제 처분청은 모시(母市) 시장이며, 이 부서는 접수·안내 창구 기능만 수행한다.',
};

function _renderCityDeptTemplate(template, rec, cityRootSPCode) {
  const 국이름 = rec.국이름 || CITY_DEPT_DEFAULT_LABEL[rec.국코드] || '담당부서';
  const 처분권_문구 = rec.처분권_문구 || CITY_TYPE_DISPOSITION_DEFAULT[rec.지자체유형] || CITY_TYPE_DISPOSITION_DEFAULT.일반시;
  return template
    .replaceAll('{시이름}', rec.시이름 || '')
    .replaceAll('{국이름}', 국이름)
    .replaceAll('{지자체유형}', rec.지자체유형 || '일반시')
    .replaceAll('{처분권_문구}', 처분권_문구)
    .replaceAll('{입력_문구}', rec.입력_문구 || '')
    .replaceAll('{출력_문구}', rec.출력_문구 || '')
    .replaceAll('{처분성_문구}', rec.처분성_문구 || '')
    .replaceAll('{산하과목록}', rec.산하과목록 || '(정식 명칭 확인 중 — 콜센터로 확인 권장)')
    .replaceAll('{콜센터명}', rec.콜센터명 || '')
    .replaceAll('{콜센터번호}', rec.콜센터번호 || '')
    .replaceAll('{콜센터운영시간}', rec.콜센터운영시간 || '')
    .replaceAll('{GOV_COMMON}', 'JEJU-GOV-COMMON')
    .replaceAll('{DO_ROOT_SP}', 'SP-DO-000')
    .replaceAll('{CITY_ROOT_SP}', cityRootSPCode);
}

// 시/군/구 루트 SP 코드 도출 — 예전엔 jejusi/seogwipo 두 곳만 하드코딩된
// 삼항연산자였다(다른 시코드가 오면 전부 SEOGWIPO로 잘못 귀속되는 버그,
// 2026-07-24 발견). city-master-data.json에 SP코드 필드가 있으면 그걸
// 쓰고, 없으면 `SP-CITY-{시코드 대문자}` 관례값으로 즉시 생성한다 —
// 이래야 실사 없이도(주피터 지시 원칙) 새 시/군/구가 바로 작동한다.
async function _resolveCityRootSPCode(시코드) {
  try {
    const records = await _loadCityMasterData();
    const rec = records.find(r => r.시코드 === 시코드);
    if (rec?.SP코드) return rec.SP코드;
  } catch (e) {
    console.warn('[gov-router] city-master-data 조회 실패(관례값으로 대체):', e?.message);
  }
  return `SP-CITY-${String(시코드 || '').toUpperCase()}`;
}

async function _fetchCityDeptText(match) {
  const records = await _loadCityDeptMasterData();
  const rec = records.find(r => r.시코드 === match.시코드 && r.국코드 === match.국코드);
  if (!rec) {
    console.warn(`[gov-router] 시청 국 데이터 레코드 없음(시코드=${match.시코드}, 국코드=${match.국코드}) — 스킵`);
    return { text: null, permitCodes: [] };
  }
  const templateFile = rec.template || 'SP-CITYDEPT-TEMPLATE_v1.0.md';
  // 일반구처럼 법인격이 없어 자체 루트 SP가 없는 인스턴스는 rec.모시코드로
  // 상위(모시) 시코드를 지정한다 — {CITY_ROOT_SP}가 그 상위 시로 귀속된다
  // (2026-07-24 신설, 창원시 산하 5개 일반구 파일럿에서 처음 필요해짐).
  const [template, cityRootSPCode] = await Promise.all([
    _fetchText(`04-city/templates/${templateFile}`),
    _resolveCityRootSPCode(rec.모시코드 || match.시코드),
  ]);
  return _appendPermitProtocolIfNeeded(_renderCityDeptTemplate(template, rec, cityRootSPCode), rec);
}

// ── 응급 즉시 처리 (사고실험 2차 §3 권고 — 최우선, 다른 어떤 매칭보다 먼저) ──
// 분류 LLM 호출조차 기다리게 하면 안 되는 영역이라 순수 정규식으로만 판단하고,
// 애매하면 응급 쪽으로 분류한다(오탐 비용 < 누락 비용, SP-EXP-EMERGENCY §6).
const EMERGENCY_RE = /불\s*이?\s*났|불났|화재|가스.{0,4}(냄새|새는|누출|샌다)|쓰러지|심정지|의식.{0,3}없|숨.{0,3}(안\s*쉬|못\s*쉬)|피.{0,6}흘리|물에\s*빠|익수|침수|물이\s*차오|바다.{0,10}(안\s*보여|사라)|실종|없어졌어요|길을\s*잃|협박|스토킹|납치|칼을\s*들고|흉기|자해|자살|치인|치였|교통사고|지진|흔들려요|무너질|무너지|붕괴|침입했|낯선\s*사람.{0,6}(들어|침입)/;

// ★ 2026-07-23 신설(100건 사고실험에서 발견, 주피터 지시) — '화재'가
// "평화재단"·"문화재"·"화재보험" 같은 무관한 복합어에 부분문자열로
// 걸려 응급 최우선 게이트가 오탐하는 문제. _SIGUNGU_FALSE_POSITIVE_WORDS와
// 동일한 철학 — 알려진 비응급 복합어를 검사 전에 먼저 제거한다.
// "애매하면 응급으로 분류"(오탐 비용 < 누락 비용) 원칙은 진짜 애매한
// 경우를 위한 것이지, 이렇게 명백히 무관한 단어까지 덮으라는 뜻은 아니다.
const _EMERGENCY_FALSE_POSITIVE_WORDS = [
  '평화재단', '문화재', '화재보험', '화재예방', '화재안전', '방화재', '내화재',
];

function _isEmergency(text) {
  let cleaned = text;
  for (const w of _EMERGENCY_FALSE_POSITIVE_WORDS) cleaned = cleaned.split(w).join('');
  return EMERGENCY_RE.test(cleaned);
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
  // ★ 2026-07-24 신설(100건 사고실험에서 발견) — 이걸 빠뜨리면 §13b
  // PDV_HISTORY_REQUEST scope 치환이 이 6개 기관 응답에서 안전한
  // 기본값('pdv_general')으로 조용히 대체돼, 다른 기관들과 달리 이
  // 기관 관련 과거 민원 이력을 못 불러오는 미묘한 버그가 생겼을 것이다.
  'SP-NAT-CUSTOMS': 'kcustoms', 'SP-NAT-BOK': 'kbok', 'SP-NAT-STAT': 'kstat',
  'SP-NAT-FORESTRESEARCH': 'kforestresearch', 'SP-NAT-FORESTSEED': 'kforestseed',
  'SP-NAT-FORESTCOOP': 'kforestcoop',
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
async function _assembleGovSystemPromptRaw(userText, pdvLocationHint = null, classifyFn = null, onProgress = null) {
  // 2026-07-05: UNIVERSAL-INTEGRITY를 여기서 fetch/삽입하던 걸 제거했다.
  // jeju-router.js는 이제 /ai/chat이 아니라 /gov/relay를 호출하고,
  // handleGovRelay()가 UNIVERSAL-INTEGRITY + UNIVERSAL-common(U9 포함)을
  // 항상 최상단에 서버측에서 붙인다(SP-COMMON-05 H2 원칙 — 클라이언트가
  // 공통 규칙을 빠뜨리거나 조작할 여지를 구조적으로 없앤다). 이 함수가
  // 반환하는 systemPrompt는 이제 "agencyPrompt"(JEJU-GOV-COMMON 이하)에
  // 해당하는 부분만 담당한다.
  const text = userText || '';
  // ★ 2026-07-20 — 매 요청(턴)마다 발화 기반으로 도를 다시 판별한다.
  // _resolveProvinceCode()는 동기 함수라 여기서 미리 계산해둔다.
  // ★ 2026-07-21 — 발화에 지역 언급이 없으면 PDV 위치 힌트로 2차 판별
  // (주피터 지시: "제주시 한경면 소재 홍길동의 등본 발급은 한경면사무소
  // 소관" — PDV 위치를 활용하면 관할 기관을 쉽게 특정할 수 있다). 이전엔
  // 여기서 실패하면 _resolveProvinceCode()의 최후 안전망이 조용히
  // 'jeju'로 대체해 "판별 불가"가 아니라 "제주로 확신에 찬 오답"이
  // 나가는 문제가 사고실험으로 확인됐다 — 아래 -0.5단계에서 명시적으로
  // 끊는다.
  const [_sigunguListForGuess, _emdNameIndexForGuess] = await Promise.all([
    _loadSigunguListForProvinceGuess(),
    _loadEmdNameToProvinceIndex(),
  ]);
  _currentResolvedProvinceCode =
    _guessProvinceFromText(text, _sigunguListForGuess, _emdNameIndexForGuess)
    || (pdvLocationHint ? _guessProvinceFromText(pdvLocationHint, _sigunguListForGuess, _emdNameIndexForGuess) : null);
  const govCommon = await _loadGovCommon();
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

  // -0.5) 도 판별 실패(발화·PDV 위치 힌트 둘 다 실패) — 2026-07-21 신설.
  // 정확한 관할(도청/시군구/읍면동/국가기관 지역사무소 어느 계층이든)은
  // 지역 없이는 특정할 수 없다는 원칙(JEJU-GOV-COMMON §10 데이터 연동
  // 공백 고지 원칙)의 연장 — "판별 불가"를 정직하게 알리고, 발화가
  // 애초에 위치와 무관한 일반 질문일 수도 있으므로 GOV-COMMON 공통
  // 레이어까지는 포함해 반환한다(도청/L2/국가기관 트리는 로드하지 않음).
  // ★ 2026-07-21 수정(버그2) — 예전엔 _currentResolvedProvinceCode(발화·
  // PDV 기반 판별값)만 검사해서, window.HONDI_PROVINCE_CODE로 도가 이미
  // 고정된 배포(도별 전용 사이트)에서도 위치 없는 일반 질문이 전부
  // "지역 미판별"로 잘못 튕겨나가는 버그가 있었다(50개 사고실험 E7에서
  // 실증). _resolveProvinceCode()는 오버라이드까지 감안한 최종값이라
  // 이걸 검사해야 맞다.
  if (!_resolveProvinceCode()) {
    parts.push(
      '[지역 미판별] 정확한 관할 기관을 안내하려면 거주 지역(광역시도·시군구, ' +
      '가능하면 읍면동까지)을 알려주세요. PDV에 거주지가 저장돼 있다면 자동으로 반영됩니다.'
    );
    return {
      systemPrompt: parts.join('\n\n---\n\n'),
      trace: [...trace, '(지역 미판별 — 발화·PDV 힌트 모두 실패, 도청/국가기관 트리 로드 안 함)'],
    };
  }

  // 0) 국가기관 매칭 — JEJU-DO-SP(도청 트리)와 배타적인 형제 노드.
  //    매칭되면 도청 트리는 아예 로드하지 않는다(JEJU-NATIONAL-SP §0).
  const natMatch = _matchNational(text);
  if (natMatch) {
    const nationalSp = await _loadNationalSp();
    parts.push(nationalSp);
    trace.push('JEJU-NATIONAL-SP');
    const { text: agencyText, permitCodes: agencyPermitCodes } = await _fetchNatText(natMatch);
    parts.push(agencyText);
    trace.push(natMatch.code);
    if (agencyPermitCodes.length) trace.push(`PERMIT-CRITERIA-PROTOCOL(${agencyPermitCodes.join(',')})`);
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

  // 0.5) 국가기관 지연 초기화(2026-07-20 신설) — 정적 국가기관 테이블이
  // 비어 있는 도(현재 제주 외 전부, national:[])에서 국가기관성 키워드가
  // 언급된 경우. classifyFn이 주입돼 있으면 시군구와 동일한 철학으로
  // 여기서 확정하지 않고 5단계 LLM 분류 폴백에 'SP-NATIONAL-LAZY' 후보로
  // 넘긴다. classifyFn이 없으면(상담할 AI 자체가 없음) 정규식이 즉시 판단.
  if (_nationalTable().length === 0 && !classifyFn) {
    const natDomainGuess = _guessNatAgencyDomainFromText(text);
    if (natDomainGuess) {
      const cityHint = _guessSigunguName(text, pdvLocationHint);
      const nationalSp = await _loadNationalSp();
      parts.push(nationalSp);
      trace.push('JEJU-NATIONAL-SP');
      const resolved = await resolveNationalAgencyLazy(_resolveProvinceCode(), _provinceCodeToName(_resolveProvinceCode()), natDomainGuess, onProgress, cityHint);
      parts.push(resolved.text);
      trace.push(`SP-NATIONAL-LAZY(${natDomainGuess}${cityHint ? '/' + cityHint : ''}/${resolved.source})`);
      return { systemPrompt: parts.join('\n\n---\n\n'), trace };
    }
  }

  // 여기부터는 도청 트리(JEJU-DO-SP) — 국가기관이 아닌 것으로 판단됐으므로 로드.
  const doSp = await _loadDoSp();
  parts.push(doSp);
  trace.push('SP-DO-000');

  // L4 업무영역 SP 매칭 — 지금은 상하수도(SP-EXP-WATER) 하나뿐.
  // JEJU-GOV-COMMON §10(정직성·데이터 연동 공백 고지 원칙)의 첫 실증 사례.
  // ★ 2026-07-24 수정(100건 사고실험에서 발견) — '수압'이 빠져 있어서
  // "수압이 너무 약해요" 같은 정당한 상하수도 민원이 SP-EXP-WATER를
  // 못 띄우고 그냥 EMD 일반 안내로 끝났다.
  const isWaterQuery = /상수도|수돗물|누수|수질|정수|급수|배관|수압/.test(text);
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
    const cityCode = _findCityByName(emdMatch.행정시명);
    if (cityCode) {
      const cityText = await _fetchCityText(cityCode);
      parts.push(cityText);
      trace.push(cityCode.code);

      // ★ 2026-07-23 수정(주피터 지시) — 규칙 F(서귀포 상하수도는 읍면동
      // 생략)를 상하수도 전용에서 모든 시청 국(局) 도메인으로 일반화한다.
      // PDV 힌트에 동 이름이 있어 emdMatch까지는 됐지만("동홍동"),
      // 발화 내용 자체가 읍면동 사무(민원 등)가 아니라 시청 국 소관
      // 사무(예: 건축허가)인 경우, 읍면동 템플릿 대신 시청 국을 붙인다
      // — 읍면동은 건축허가를 처리하지 않으므로 이게 실제로 맞는 관할이다.
      const cityDeptMatch = _matchCityDept(text, cityCode.시코드);
      if (cityDeptMatch) {
        const { text: cityDeptText, permitCodes: cityDeptPermitCodes } = await _fetchCityDeptText(cityDeptMatch);
        if (cityDeptText) {
          parts.push(cityDeptText);
          trace.push(`SP-CITYDEPT-${cityCode.시코드}-${cityDeptMatch.국코드}`,
            '(규칙 F 일반화 — 시청 국 소관 사무라 읍면동 생략)');
          if (cityDeptPermitCodes.length) trace.push(`PERMIT-CRITERIA-PROTOCOL(${cityDeptPermitCodes.join(',')})`);
        }
      } else if (cityCode.code === 'SP-CITY-SEOGWIPO' && isWaterQuery) {
        trace.push('(규칙 F: 서귀포 상하수도는 읍면동 생략)');
      } else {
        const emdTemplate = await _fetchText('05-emd/SP-EMD-TEMPLATE_v1.2.md');
        parts.push(_renderEmdTemplate(emdTemplate, emdMatch));
        trace.push(`SP-EMD-${emdMatch.읍면동명}`);
      }
      await _appendExpertIfMatched();

      return { systemPrompt: parts.join('\n\n---\n\n'), trace };
    }
    // 행정시 테이블(AdministrativeCity)에서 emdMatch.행정시명을 못 찾으면
    // (도 실사 불일치 등) 이 EMD 매칭은 신뢰하지 않고 무시한다 — 잘못된
    // 행정시로 단정하지 않는다(govType 가드·L2 원형키워드와 동일한
    // "정직한 미확정 처리" 원칙). 이후 단계(2·2.5·3 등)로 계속 진행.
  }

  // 2) 행정시만 언급(읍면동 특정 안 됨) → 시청 레이어만
  // ★ 2026-07-24 수정(100건 사고실험에서 발견) — "청년 월세 지원
  // 있어요?"에 제주시 PDV 힌트만 있는 경우, 예전엔 여기서 곧바로
  // 시청 공통 페이지로 확정해버려서 그보다 훨씬 구체적인 답을 줄 수
  // 있는 3)L2 실국 매칭이나 5)LLM 분류 폴백(WELFARE 등)까지 가지도
  // 못하고 끝났다. 발화 자체에 시 이름이 있으면(사용자가 명시적으로
  // 그 시를 지목) 기존처럼 즉시 확정하는 게 맞지만, PDV 힌트로만
  // 시가 잡히고 시청 국(局) 단위 매칭도 안 되고 classifyFn(AI)이
  // 있으면 — 즉시 확정하지 않고 이 결과를 폴백으로만 들고 뒤 단계
  // (L2/LLM)에 더 구체적인 매칭 기회를 먼저 준다. 아무것도 안 걸리면
  // 6)에서 이 폴백을 쓴다(기존 동작과 최종 결과는 동일 — 순서만 바뀜).
  const cityOnly = _matchCity(text, pdvLocationHint);
  let cityOnlyFallback = null;
  if (cityOnly) {
    const cityText = await _fetchCityText(cityOnly);

    // 2-1) 시청 국(局) 단위 매칭 (2026-07-23 신설) — 예: "서귀포시
    // 건축허가 신청하고 싶어요" → 안전도시건설국(국코드 housing)까지 특정.
    // 매칭 안 되면 조용히 시청 레이어에서 멈춘다(기존 동작 그대로).
    const cityDeptMatch = _matchCityDept(text, cityOnly.시코드);
    if (cityDeptMatch) {
      parts.push(cityText);
      trace.push(cityOnly.code);
      const { text: cityDeptText, permitCodes: cityDeptPermitCodes } = await _fetchCityDeptText(cityDeptMatch);
      if (cityDeptText) {
        parts.push(cityDeptText);
        trace.push(`SP-CITYDEPT-${cityOnly.시코드}-${cityDeptMatch.국코드}`);
        if (cityDeptPermitCodes.length) trace.push(`PERMIT-CRITERIA-PROTOCOL(${cityDeptPermitCodes.join(',')})`);
      }
      await _appendExpertIfMatched();
      return { systemPrompt: parts.join('\n\n---\n\n'), trace };
    }

    if (cityOnly._matchedViaTextItself || !classifyFn) {
      // 발화 자체에 시 이름이 있으면(명시적 지목) 즉시 확정, 또는
      // classifyFn이 아예 없으면(AI 상담 불가) 기존처럼 즉시 확정.
      parts.push(cityText);
      trace.push(cityOnly.code);
      await _appendExpertIfMatched();
      return { systemPrompt: parts.join('\n\n---\n\n'), trace };
    }

    // 힌트로만 시가 특정됐고, AI가 있으니 더 구체적인 매칭을 먼저
    // 시도한다 — 이 결과는 6)에서 아무것도 안 걸렸을 때만 쓴다.
    cityOnlyFallback = { parts: [...parts, cityText], trace: [...trace, cityOnly.code] };
  }

  // 2.5) 시군구 이름이 언급됐지만 정적 도시 테이블에는 없는 경우 —
  // 지연 초기화(worker.js /gov/sigungu-dept-resolve 호출, 비밀키 없음).
  // ★ 2026-07-20 재설계: classifyFn(AI)이 주입돼 있으면 여기서 즉시
  // 확정하지 않는다 — 정규식 오탐 가능성이 있어, AI가 있을 땐 5단계
  // LLM 분류 폴백에서 'SP-SIGUNGU-LAZY'를 다른 코드들과 동등한 후보로
  // 놓고 AI가 직접 판단하게 넘긴다(결정권을 코드→AI로 이동). classifyFn이
  // 없으면(상담할 AI 자체가 없음) 기존처럼 정규식이 즉시 판단한다 —
  // 하위호환 100% 유지.
  if (!classifyFn) {
    const sigunguGuess = _guessSigunguName(text, pdvLocationHint);
    if (sigunguGuess) {
      const domainGuess = _guessDomainFromText(text);
      if (domainGuess) {
        const resolved = await resolveSigunguDept(sigunguGuess, domainGuess, onProgress);
        parts.push(resolved.text);
        trace.push(`SP-SIGUNGU-LAZY(${sigunguGuess}/${domainGuess}/${resolved.source})`);
        await _appendExpertIfMatched();
        return { systemPrompt: parts.join('\n\n---\n\n'), trace };
      }
    }
  }

  // 3) 실국 키워드 매칭 → 규칙 A: 짧은 체인
  const divMatch = _scoreMatch(text, _l2Table());
  if (divMatch) {
    // govType 가드(2026-07-21 신설) — 재산세 등 세정 키워드'만'으로
    // 매칭됐고 이 도가 GENERAL(기초자치단체 존재)이면, 도청이 아니라
    // 시군구 소관이므로 여기서 도청 L2로 확정하지 않는다.
    const _registryEntry = PROVINCE_REGISTRY[_resolveProvinceCode()];
    if (_registryEntry?.govType === 'GENERAL' && _isMunicipalTaxOnlyMatch(text, divMatch)) {
      const sigunguGuess = _guessSigunguName(text, pdvLocationHint);
      const domainGuess = _guessDomainFromText(text);
      if (sigunguGuess && domainGuess) {
        const resolved = await resolveSigunguDept(sigunguGuess, domainGuess, onProgress);
        parts.push(resolved.text);
        trace.push(`SP-SIGUNGU-LAZY(${sigunguGuess}/${domainGuess}/${resolved.source})`,
          '(govType 가드 — 세정은 시군구 소관, 도청 L2 매칭 우회)');
        await _appendExpertIfMatched();
        return { systemPrompt: parts.join('\n\n---\n\n'), trace };
      }
      // 시/군/구 이름을 특정 못 하면 도청 소관으로 잘못 답하지 않고
      // 6)의 공통 레이어 응답으로 흘려보낸다(정직한 미확정 처리).
      trace.push('(govType 가드 — 세정은 시군구 소관이나 시군구명 미특정, 도청 L2 매칭 무시)');
    } else {
      const divText = await _fetchDeptText(divMatch);
      parts.push(divText.text);
      trace.push(divMatch.code);
      if (divText.permitCodes.length) trace.push(`PERMIT-CRITERIA-PROTOCOL(${divText.permitCodes.join(',')})`);
      await _appendExpertIfMatched();
      return { systemPrompt: parts.join('\n\n---\n\n'), trace };
    }
  }

  // 3.5) 실국 원형키워드 매칭(2026-07-21 신설, L2Department 원형 —
  // 도 실사 여부와 무관). 여기 도달했다는 것 자체가 3단계 실사 매칭이
  // 확정 응답을 못 만들었다는 뜻이다.
  const canonicalDomain = _matchL2Canonical(text);
  if (canonicalDomain) {
    parts.push(_renderL2CanonicalFallback(canonicalDomain));
    trace.push(`SP-DO-${canonicalDomain.toUpperCase()}(원형 매칭, 도 실사 전)`);
    await _appendExpertIfMatched();
    return { systemPrompt: parts.join('\n\n---\n\n'), trace };
  }

  // 4) 읍면동/실국 어느 쪽도 안 걸렸지만 업무영역만 매칭된 경우(예: 지역 언급 없이 "수돗물 냄새나요")
  // ★ 2026-07-24 수정(100건 사고실험에서 발견) — cityOnlyFallback이 있다는
  // 건 PDV 힌트로 시는 이미 알고 있다는 뜻이라, "지역 미특정" 문구를
  // 그대로 쓰면 모순이다(시청 페이지까지 이미 parts에 있는데 "지역
  // 모른다"고 말하는 셈). 이 경우엔 cityOnlyFallback 쪽(시청 정보 포함)에
  // 전문가 SP만 추가로 얹어 반환한다.
  if (isWaterQuery) {
    if (cityOnlyFallback) {
      const expText = await _fetchText('06-expert/SP-EXP-WATER_v1.1.md');
      cityOnlyFallback.parts.push(expText);
      cityOnlyFallback.trace.push('SP-EXP-WATER', '(2단계 힌트 전용 매칭 폴백 + 상하수도 전문 SP)');
      return { systemPrompt: cityOnlyFallback.parts.join('\n\n---\n\n'), trace: cityOnlyFallback.trace };
    }
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
  if (classified === 'SP-NATIONAL-LAZY') {
    // AI가 "이건 국가기관 지사 문제"라고 직접 판단한 경우 — 결정권은
    // AI에게 있고, 여기서는 도메인만 정규식으로 추출해 실행에 옮긴다
    // (시군구 LLM 분류 폴백과 완전히 동일한 철학).
    const natDomainGuess = _guessNatAgencyDomainFromText(text);
    if (natDomainGuess) {
      const cityHint = _guessSigunguName(text, pdvLocationHint);
      const nationalOnlyParts = [govCommon];
      const nationalSp = await _loadNationalSp();
      nationalOnlyParts.push(nationalSp);
      const resolved = await resolveNationalAgencyLazy(_resolveProvinceCode(), _provinceCodeToName(_resolveProvinceCode()), natDomainGuess, onProgress, cityHint);
      nationalOnlyParts.push(resolved.text);
      return {
        systemPrompt: nationalOnlyParts.join('\n\n---\n\n'),
        trace: ['JEJU-GOV-COMMON', 'JEJU-NATIONAL-SP', `SP-NATIONAL-LAZY(${natDomainGuess}${cityHint ? '/' + cityHint : ''}/${resolved.source})`, '(LLM 분류 폴백)'],
      };
    }
    // AI는 국가기관 문제라고 봤는데 정규식이 도메인을 못 뽑으면 — 억지로
    // 추측하지 않고 6)의 공통 레이어 응답으로 흘려보낸다.
  } else if (classified === 'SP-SIGUNGU-LAZY') {
    // AI가 "이건 시군구 문제"라고 직접 판단한 경우 — 결정권은 AI에게
    // 있고, 여기서는 그 판단을 실행에 옮기기 위해 이름·도메인만 정규식
    // 으로 추출한다(추출은 기계적 실행일 뿐, 판단 자체는 이미 AI가 끝냄).
    const sigunguGuess = _guessSigunguName(text, pdvLocationHint);
    const domainGuess = _guessDomainFromText(text);
    if (sigunguGuess && domainGuess) {
      const resolved = await resolveSigunguDept(sigunguGuess, domainGuess, onProgress);
      parts.push(resolved.text);
      trace.push(`SP-SIGUNGU-LAZY(${sigunguGuess}/${domainGuess}/${resolved.source})`, '(LLM 분류 폴백)');
      await _appendExpertIfMatched();
      return { systemPrompt: parts.join('\n\n---\n\n'), trace };
    }
    // AI는 시군구 문제라고 봤는데 정규식이 이름·도메인을 못 뽑으면 —
    // 억지로 추측하지 않고 6)의 공통 레이어 응답으로 흘려보낸다.
  } else if (classified) {
    if (_isNationalCode(classified)) {
      // 이미 parts에 SP-DO-000이 들어가 있으므로, 도청 트리를 걷어내고
      // 국가기관 트리로 다시 시작한다(JEJU-NATIONAL-SP §0: 배타적 형제 노드).
      const nationalOnlyParts = [govCommon];
      const nationalSp = await _loadNationalSp();
      nationalOnlyParts.push(nationalSp);
      const entry = _findTableEntry(classified);
      const { text: agencyText, permitCodes: agencyPermitCodes } = await _fetchNatText(entry);
      nationalOnlyParts.push(agencyText);
      const natTrace = ['JEJU-GOV-COMMON', 'JEJU-NATIONAL-SP', classified, '(LLM 분류 폴백)'];
      if (agencyPermitCodes.length) natTrace.push(`PERMIT-CRITERIA-PROTOCOL(${agencyPermitCodes.join(',')})`);
      return {
        systemPrompt: nationalOnlyParts.join('\n\n---\n\n'),
        trace: natTrace,
      };
    }
    const entry = _findTableEntry(classified);
    if (entry) {
      const entryText = await _fetchDeptText(entry);
      parts.push(entryText.text);
      trace.push(classified, '(LLM 분류 폴백)');
      if (entryText.permitCodes.length) trace.push(`PERMIT-CRITERIA-PROTOCOL(${entryText.permitCodes.join(',')})`);
      await _appendExpertIfMatched();
      return { systemPrompt: parts.join('\n\n---\n\n'), trace };
    }
  }

  // 6) 그래도 안 걸리면(분류 결과 NONE 포함 — 비교·설명형 질문 등)
  // 도청 공통 레이어만 반환한다. 이건 실패가 아니라, 이런 질문은 원래
  // 특정 기관 SP 없이도 GOV-COMMON/DO-SP의 배경지식으로 충분히 답할 수
  // 있는 경우가 많다(예: 자치경찰 vs 국가경찰 차이 설명).
  // ★ 2026-07-24 수정(100건 사고실험에서 발견) — 2)에서 보류해둔
  // cityOnlyFallback이 있으면 완전히 빈손으로 끝내는 대신 그 시청
  // 페이지로 대체한다(더 구체적인 도메인 매칭은 다 실패했지만, PDV
  // 힌트로 시는 이미 알고 있었으므로 최소한 그 정보는 활용).
  if (cityOnlyFallback) {
    await _appendExpertIfMatched();
    cityOnlyFallback.trace.push('(2단계 힌트 전용 매칭 폴백 — 3~5단계에서 더 구체적인 매칭 실패)');
    return { systemPrompt: cityOnlyFallback.parts.join('\n\n---\n\n'), trace: cityOnlyFallback.trace };
  }
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
// GOV_AGENCIES/SP_DELEGATION_REGISTRY의 'gov_do'/'gov_national'과
// 반드시 동일한 문자열이어야 한다(어긋나면 UNKNOWN_AGENCY로 조용히
// 거부되는 사고가 난다 — SP-00-ROUTER v5.1 manifest 누락과 동일 유형).
// ★ 2026-07-21 개명 — 'jeju_do'/'jeju_national'이었다. 주피터 지시:
// "제주는 전국 광역시도 중 하나일 뿐인데 여전히 특별 취급해야 하는
// 이유는?" — 없다. JEJU-NATIONAL-SP/JEJU-DO-SP라는 트리 이름 자체는
// (파일명 등 여러 저장소에 걸친 문자열이라) 오늘은 그대로 두지만,
// 외부에 노출되는 agency 값만이라도 전국 중립적으로 바꾼다.
export function resolveGovAgency(trace) {
  return (trace || []).includes('JEJU-NATIONAL-SP') ? 'gov_national' : 'gov_do';
}
window.resolveGovAgency = resolveGovAgency;

// ── trace(개발자용 SP 코드 배열) → 사용자용 기관/부서 한글명 (2026-07-23 신설) ──
// 배경: 상단바 배지가 지금까지 trace.join(' > ')를 그대로 노출해
// "JEJU-GOV-COMMON > SP-DO-000 > SP-CITY-JEJU" 같은 개발자용 코드가
// 사용자 화면에 그대로 보였다(실사로 지적됨). 각 매칭 테이블(JEJU_CITY_TABLE
// 등)의 kw 배열 첫 항목이 이미 그 기관/부서의 실제 한글 명칭이라는 점을
// 재사용해, trace를 다시 스캔해 가장 구체적인 명칭을 뽑아낸다 — 라우팅
// 로직 자체(_assembleGovSystemPromptRaw)는 건드리지 않는다.
// 2026-07-24 — 시청 국(局) 트레이스 파싱은 요청 당시의 province 컨텍스트가
// 아니라 trace 문자열만 갖고 사후에 호출될 수 있어(예: UI 배지 렌더링
// 시점), _cityDeptTable()(현재 컨텍스트의 province에 의존)을 쓰면 컨텍스트가
// 어긋날 위험이 있다. 시코드는 전국에서 유일하므로, 전체 도의 citydept
// 테이블을 한 번 평탄화해 시코드만으로 안전하게 조회한다.
const ALL_CITY_DEPT_ENTRIES = Object.values(PROVINCE_TABLES).flatMap(p => p.citydept || []);

export function resolveAgencyDisplayName(trace) {
  const t = Array.isArray(trace) ? trace : [];

  // 시청 국(局) 단위까지 특정된 경우가 가장 구체적 — 우선 확인
  for (const entry of t) {
    const m = /^SP-CITYDEPT-(\w+)-(\w+)$/.exec(entry);
    if (m) {
      const [, 시코드, 국코드] = m;
      const cityRec = Object.values(PROVINCE_TABLES).flatMap(p => p.city || []).find(c => c.시코드 === 시코드);
      const deptRec = ALL_CITY_DEPT_ENTRIES.find(d => d.시코드 === 시코드 && d.국코드 === 국코드);
      if (cityRec && deptRec) {
        const cityName = cityRec.kw.find(k => k.endsWith('청')) || cityRec.kw[0];
        return `${cityName} ${deptRec.kw[0]}`;
      }
    }
  }

  // 읍면동(행정복지센터) — SP-EMD-{읍면동명}에 이름이 그대로 들어있다
  for (const entry of t) {
    const m = /^SP-EMD-(.+)$/.exec(entry);
    if (m) {
      const cityEntry = t.find(e => _cityTable().some(c => c.code === e));
      const cityRec = cityEntry ? _cityTable().find(c => c.code === cityEntry) : null;
      return cityRec ? `${cityRec.kw[0]} ${m[1]}` : m[1];
    }
  }

  // 시청(국 단위 특정 없이 시 전체)
  for (const entry of t) {
    const cityRec = _cityTable().find(c => c.code === entry);
    if (cityRec) return cityRec.kw.find(k => k.endsWith('청')) || cityRec.kw[0];
  }

  // 국가기관
  for (const entry of t) {
    const natRec = _nationalTable().find(n => n.code === entry);
    if (natRec) return natRec.kw[0];
  }

  // 도청 실/국(局) 단위까지 특정된 경우
  for (const entry of t) {
    const l2Rec = _l2Table().find(l => l.code === entry);
    if (l2Rec) return l2Rec.kw[0];
  }

  return null; // 특정 안 됨 — 호출부가 "OO도청" 같은 일반 명칭으로 대체
}
window.resolveAgencyDisplayName = resolveAgencyDisplayName;

// ── 현재 요청의 판별된 도코드 노출 (2026-07-21 신설) ────────────────
// worker.js가 도별 동적 위임 렌더링(gov_do/gov_national)을 하려면
// provinceCode가 필요한데, 지금까지 /gov/relay 요청 바디에 이 정보가
// 아예 없었다(도 판별이 전부 클라이언트 쪽에만 있었음). resolveGovAgency와
// 동일하게 trace 계산 직후 바로 조회 가능하도록 export한다 — 호출부는
// assembleGovSystemPrompt(...) 완료 직후 이 함수를 호출하면 된다
// (모듈 전역 변수 _currentResolvedProvinceCode는 매 요청 시작 시
// 동기적으로 갱신되므로 순서만 지키면 안전).
export function resolveProvinceCode() {
  return _currentResolvedProvinceCode;
}
window.resolveProvinceCode = resolveProvinceCode;

// ── 경량 도 판별(SP 조립 없이) — 2026-07-21 신설 ────────────────────
// public/webapp.html처럼 지방행정 SP를 조립할 필요는 없지만(자기
// 서비스 고유 SP를 따로 쓴다) K-Public→gov_do/gov_national 위임 시
// provinceCode는 실어 보내야 하는 K-서비스를 위한 export. 도 판별에
// 필요한 데이터(시군구 목록, 읍면동 역색인)만 로드하고, 그 밖의 무거운
// SP 조립·네트워크 fetch는 전혀 하지 않는다 — assembleGovSystemPrompt()
// 전체를 부르는 것보다 훨씬 가볍다.
export async function guessProvinceCode(userText, pdvLocationHint = null) {
  const [sigunguList, emdNameIndex] = await Promise.all([
    _loadSigunguListForProvinceGuess(),
    _loadEmdNameToProvinceIndex(),
  ]);
  return _guessProvinceFromText(userText, sigunguList, emdNameIndex)
    || (pdvLocationHint ? _guessProvinceFromText(pdvLocationHint, sigunguList, emdNameIndex) : null);
}
window.guessProvinceCode = guessProvinceCode;

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

export async function assembleGovSystemPrompt(userText, pdvLocationHint = null, classifyFn = null, onProgress = null) {
  const result = await _assembleGovSystemPromptRaw(userText, pdvLocationHint, classifyFn, onProgress);
  if (!_PDV_HISTORY_SCOPE_PLACEHOLDER_RE.test(result.systemPrompt)) return result;
  const scope = _resolvePdvScopeFromTrace(result.trace);
  return {
    ...result,
    systemPrompt: result.systemPrompt.replace(_PDV_HISTORY_SCOPE_PLACEHOLDER_RE, scope),
  };
}

window.assembleGovSystemPrompt = assembleGovSystemPrompt;
