// ═══════════════════════════════════════════════════════════
// jeju-router.js v1.0 — 제주 기관 SP 조립 엔진
//
// 여러 문서(national-agency-master-data.json 주석 등)가 "_renderNatTemplate()이
// domain으로 template을 찾고 도코드로 레코드를 찾아 자리표시자를 채운다"고
// 전제해왔으나 실제 구현 파일이 존재하지 않았다(2026-07-08 확인). 이 파일이
// 그 전제를 실제 코드로 채운다 — SP-AUTHOR(PHASE A~E)가 "기존 템플릿 조립"
// 경로를 선택했을 때 실제로 호출하는 엔진이 바로 이것이다.
//
// 설계 원칙:
//   1. 모든 계층(do-dept/national/city/emd)이 "템플릿 파일 + master-data.json
//      레코드"라는 동일 철학을 쓰므로, 계층별 함수는 공통 렌더러
//      (_renderTemplate)의 얇은 래퍼로만 존재한다 — 계층마다 로직을
//      새로 짜지 않는다.
//   2. 레코드 값이 문자열이면 단순 치환, 배열/객체면 마크다운으로
//      자동 직렬화한다(05-emd 레코드처럼 중첩 구조가 있는 경우 대비).
//   3. 템플릿에 있지만 레코드에 없는 자리표시자(예: {DO_ROOT_SP},
//      {GOV_COMMON}, {읍면동})는 조용히 무시하지 않고 unresolved 목록으로
//      반환한다 — 이런 토큰은 이 엔진의 몫이 아니라 상위 조립 단계(다른
//      문서 삽입, 런타임 개인화)의 몫이므로, 호출자가 알고 처리하게 한다.
//   4. 실패를 삼키지 않는다 — 레코드를 못 찾으면 빈 문자열이 아니라
//      명시적 에러를 던진다(SP-AUTHOR PHASE A가 "계층 판별 실패"를
//      정확히 구분해야 하기 때문).
// ═══════════════════════════════════════════════════════════

const _RAW = 'https://raw.githubusercontent.com/Openhash-Gopang/gopang/main/';

const TIER_CONFIG = {
  'do-dept': {
    masterDataPath: 'prompts/Jejudo/02-do-dept/templates/do-dept-master-data.json',
    listKey: '부서목록',
    templateDir: 'prompts/Jejudo/02-do-dept/templates/',
    matchFn: (rec, { domain, doCode }) => rec.domain === domain && rec['도코드'] === doCode,
  },
  'national': {
    masterDataPath: 'prompts/Jejudo/09-national/agencies/templates/national-agency-master-data.json',
    listKey: '기관목록',
    templateDir: 'prompts/Jejudo/09-national/agencies/templates/',
    matchFn: (rec, { domain, doCode }) => rec.domain === domain && rec['도코드'] === doCode,
  },
  'city': {
    masterDataPath: 'prompts/Jejudo/04-city/templates/city-master-data.json',
    listKey: '시목록',
    templateDir: 'prompts/Jejudo/04-city/templates/',
    fixedTemplate: 'SP-CITY-TEMPLATE_v1.0.md',
    matchFn: (rec, { cityCode }) => rec['시코드'] === cityCode,
  },
  'emd': {
    masterDataPath: 'prompts/Jejudo/05-emd/emd-master-data.json',
    listKey: '읍면동목록',
    templateDir: 'prompts/Jejudo/05-emd/',
    fixedTemplate: 'SP-EMD-TEMPLATE_v1.2.md',
    matchFn: (rec, { emdCode }) => rec.emd_code === emdCode,
  },
};

// ── 캐시 ──────────────────────────────────────────────────
const _masterDataCache = new Map(); // tier -> parsed json
const _templateCache = new Map();   // tier+filename -> text

async function _fetchText(relPath) {
  const res = await fetch(_RAW + relPath, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`jeju-router: fetch 실패 (${res.status}) — ${relPath}`);
  return res.text();
}

async function _loadMasterData(tier) {
  if (_masterDataCache.has(tier)) return _masterDataCache.get(tier);
  const cfg = TIER_CONFIG[tier];
  if (!cfg) throw new Error(`jeju-router: 알 수 없는 tier — ${tier}`);
  const text = await _fetchText(cfg.masterDataPath);
  const json = JSON.parse(text);
  _masterDataCache.set(tier, json);
  return json;
}

async function _loadTemplate(tier, filename) {
  const cacheKey = tier + '::' + filename;
  if (_templateCache.has(cacheKey)) return _templateCache.get(cacheKey);
  const cfg = TIER_CONFIG[tier];
  const text = await _fetchText(cfg.templateDir + filename);
  _templateCache.set(cacheKey, text);
  return text;
}

// ── 값 직렬화 (배열/객체 → 마크다운) ───────────────────────
function _serializeValue(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '(없음)';
    if (typeof value[0] === 'object' && value[0] !== null) {
      // 객체 배열 → 마크다운 표 (모든 원소가 같은 키 집합을 공유한다고 가정)
      const keys = Object.keys(value[0]);
      const header = `| ${keys.join(' | ')} |`;
      const sep = `|${keys.map(() => '---').join('|')}|`;
      const rows = value.map((row) => `| ${keys.map((k) => row[k] ?? '').join(' | ')} |`);
      return [header, sep, ...rows].join('\n');
    }
    // 문자열 배열 → 불릿 리스트
    return value.map((v) => `- ${v}`).join('\n');
  }
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([k, v]) => `- ${k}: ${_serializeValue(v)}`)
      .join('\n');
  }
  return String(value);
}

// ── 공통 렌더러 — 순수 함수(테스트 용이) ───────────────────
// meta 키(domain/template/도코드/시코드/emd_code 등 라우팅 전용 키)는
// 본문 치환 대상에서 제외한다 — 그 값 자체가 SP 본문에 노출될 이유가
// 없고(내부 조회 키일 뿐), 실수로 {domain} 같은 토큰이 우연히 일치해
// 엉뚱한 값이 들어가는 것도 막는다.
const _META_KEYS = new Set(['domain', 'template', '_비고', '_schema_설명', '_meta']);

export function _renderTemplate(templateText, record) {
  const usedKeys = new Set();
  const rendered = templateText.replace(/\{([^{}]+)\}/g, (whole, key) => {
    if (_META_KEYS.has(key)) return whole; // meta 키는 애초에 치환 후보가 아님
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      usedKeys.add(key);
      return _serializeValue(record[key]);
    }
    return whole; // 레코드에 없으면 그대로 남김 (unresolved로 보고)
  });

  const allTokens = Array.from(templateText.matchAll(/\{([^{}]+)\}/g)).map((m) => m[1]);
  const unresolved = [...new Set(allTokens.filter((t) => !usedKeys.has(t) && !_META_KEYS.has(t)))];

  return { text: rendered, unresolved };
}

// ── 계층별 조립 ─────────────────────────────────────────────
async function _assemble(tier, matchParams) {
  const cfg = TIER_CONFIG[tier];
  const masterData = await _loadMasterData(tier);
  const list = masterData[cfg.listKey];
  if (!Array.isArray(list)) {
    throw new Error(`jeju-router: master-data 형식 이상 — ${tier}.${cfg.listKey}가 배열이 아님`);
  }
  const record = list.find((rec) => cfg.matchFn(rec, matchParams));
  if (!record) {
    throw new Error(
      `jeju-router: 레코드 없음 — tier=${tier}, params=${JSON.stringify(matchParams)}. ` +
      `SP-AUTHOR PHASE A는 이 에러를 "기존 템플릿 없음 → 신규 초안 필요"로 해석해야 한다.`
    );
  }
  const templateFilename = record.template || cfg.fixedTemplate;
  if (!templateFilename) {
    throw new Error(`jeju-router: 레코드에 template 필드가 없고 tier 기본 템플릿도 없음 — ${tier}`);
  }
  const templateText = await _loadTemplate(tier, templateFilename);
  const { text, unresolved } = _renderTemplate(templateText, record);
  return { text, unresolved, record, templateFilename, tier };
}

/** do-dept 계층 조립 — {부서명} 등 자리표시자를 도코드+domain으로 채움 */
export async function _renderDoDeptTemplate(domain, doCode = 'jeju') {
  return _assemble('do-dept', { domain, doCode });
}

/** 09-national 계층 조립 — jeju-national-agency-catalog.md 주석이 예고했던 함수 */
export async function _renderNatTemplate(domain, doCode = 'jeju') {
  return _assemble('national', { domain, doCode });
}

/** 04-city 계층 조립 — 시코드(jejusi/seogwipo) 단일 매칭, domain 개념 없음 */
export async function _renderCityTemplate(cityCode) {
  return _assemble('city', { cityCode });
}

/** 05-emd 계층 조립 — emd_code(예: SP-EMD-AEWOL) 단일 매칭 */
export async function _renderEmdTemplate(emdCode) {
  return _assemble('emd', { emdCode });
}

/**
 * SP-AUTHOR PHASE A/B가 호출하는 단일 진입점.
 * tier를 이미 판별했다는 전제 하에, 계층에 맞는 params만 넘기면 된다.
 * 레코드가 없으면(=아직 아무도 이 기관을 템플릿화한 적 없으면) 에러가 나며,
 * SP-AUTHOR는 이걸 "PHASE B(웹검색+data.go.kr 조사)로 진행해 새 레코드를
 * 만들어야 한다"는 신호로 받아들인다 — 조용히 빈 SP를 반환하지 않는다.
 */
export async function assembleGovSP(tier, params) {
  return _assemble(tier, params);
}
