/**
 * gov-data-resolve-log.js
 * ---------------------------------------------------------------------------
 * resolveGovData(KOSIS 리졸버)의 검색·매칭 시도를 기록하는 로그 모듈.
 * `resolveGovData-최소버전설계_v1.0_2026-07-16.md` §3/§4 대응.
 *
 * lib/audit-log-schema.js(PDV 감사로그)와 달리 persist()를 스텁으로 두지 않고
 * 지금 바로 구현한다 — 개인정보가 없는 분석 로그라 Phase 4(온나라시스템 연동)를
 * 기다릴 이유가 없다. 저장소는 gov_data_resolve_log 컬렉션(별도 분리 이유는
 * pb_migrations/1785700001_created_gov_data_resolve_log.js 상단 주석 참조).
 *
 * 인증: worker.js의 L1 PocketBase Admin 인증 패턴(_l1AdminTokenFor, 약 1083번
 * 줄 부근)을 그대로 따른다 — 고정 admin token 시크릿이 아니라 L1_ADMIN_EMAIL/
 * L1_ADMIN_PASSWORD로 /api/admins/auth-with-password 호출 후 토큰을 받아
 * 25분간 캐싱한다. base URL도 env 변수가 아니라 L1_BASE_HOST 상수다.
 *
 * lib/pdv-consent.js, lib/audit-log-schema.js와 마찬가지로 이 파일은 아직
 * worker.js에서 require되지 않는 설계 전용 파일이다 — worker.js가 단일 파일
 * 구조라 실제 연결 시에는 이 파일의 로직을 worker.js에 인라인하거나, worker.js가
 * 이미 가진 _l1AdminTokenFor를 그대로 재사용하도록 배선해야 한다(아래
 * _l1AdminTokenFor는 그 배선 전까지 쓰는 독립 실행용 사본).
 * ---------------------------------------------------------------------------
 */

const L1_BASE_HOST = 'https://l1-hanlim.hondi.net'; // worker.js L1_DEFAULT와 동일 값

// worker.js:1091-1117의 _l1AdminTokenFor와 동일 로직 — 실제 배선 시에는 이 사본을
// 지우고 worker.js의 함수를 import/재사용할 것 (지금은 lib/*.js가 worker.js에서
// require되지 않는 기존 관례상 독립 사본으로 둔다).
const _l1AdminTokenCache = {};
async function _l1AdminTokenFor(env, base) {
  const now = Date.now();
  const cached = _l1AdminTokenCache[base];
  if (cached && now < cached.exp) return cached.token;

  const email = env.L1_ADMIN_EMAIL;
  const password = env.L1_ADMIN_PASSWORD;
  if (!email || !password) throw new Error('L1_ADMIN_EMAIL/L1_ADMIN_PASSWORD secret 미설정');

  const res = await fetch(`${base}/api/admins/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: email, password }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`L1 admin auth(${base}) ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json().catch(() => null);
  if (!data?.token) throw new Error(`L1 admin auth(${base}): token 없음`);
  _l1AdminTokenCache[base] = { token: data.token, exp: now + 25 * 60 * 1000 };
  return data.token;
}

/**
 * @typedef {Object} GovDataResolveLogEntry
 * @property {string} raw_query
 * @property {'gov-sp'|'k-public'} requester_type
 * @property {Array<Object>} kosis_search_candidates - 필터링 전 원본 KOSIS 검색 결과
 * @property {Array<Object>} filtered_candidates      - 규칙 A/B/C 적용 후 남은 후보
 * @property {'confirmed'|'ambiguous'|'not_found'} outcome
 * @property {string} [selected_entry_id]  - outcome='confirmed'일 때만
 * @property {string} [human_override]     - 에스컬레이션 후 사람이 최종 선택한 entry_id (나중에 갱신)
 */

/**
 * 로그 기록. resolveGovData()가 매 시도마다 호출한다.
 * @param {GovDataResolveLogEntry} entry
 * @param {Object} env - Worker env (POCKETBASE_URL, POCKETBASE_ADMIN_TOKEN)
 */
async function recordResolveLog(entry, env) {
  const record = {
    raw_query: entry.raw_query,
    requester_type: entry.requester_type,
    kosis_search_candidates: entry.kosis_search_candidates || [],
    filtered_candidates: entry.filtered_candidates || [],
    outcome: entry.outcome,
    selected_entry_id: entry.selected_entry_id || '',
    human_override: entry.human_override || '',
    recorded_at: new Date().toISOString(),
  };

  const token = await _l1AdminTokenFor(env, L1_BASE_HOST);
  const res = await fetch(`${L1_BASE_HOST}/api/collections/gov_data_resolve_log/records`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(record),
  });

  if (!res.ok) {
    // 로그 기록 실패가 본 요청(통계 조회 자체)을 막으면 안 된다 — 조용히 실패하고
    // 상위 호출자(resolveGovData)는 그대로 진행한다. 단, 콘솔에는 남긴다.
    console.error('gov_data_resolve_log 기록 실패:', res.status, await res.text());
    return null;
  }
  return res.json();
}

/**
 * 에스컬레이션된 항목에 사람의 최종 선택을 나중에 채워 넣을 때 사용.
 * (§6 다음 단계: 이 human_override 필드가 쌓여야 2단계 스코어링 설계 근거가 됨)
 * @param {string} recordId - PocketBase record id
 * @param {string} humanOverrideEntryId
 */
async function updateHumanOverride(recordId, humanOverrideEntryId, env) {
  const token = await _l1AdminTokenFor(env, L1_BASE_HOST);
  const res = await fetch(`${L1_BASE_HOST}/api/collections/gov_data_resolve_log/records/${recordId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ human_override: humanOverrideEntryId }),
  });
  if (!res.ok) {
    console.error('human_override 갱신 실패:', res.status, await res.text());
    return null;
  }
  return res.json();
}

/**
 * 감사·분석용 조회. 2단계 스코어링 설계 시 실제 로그를 근거로 삼기 위해 사용.
 * @param {Object} filter
 * @param {string} [filter.outcome]
 * @param {string} [filter.dateFrom]
 * @param {string} [filter.dateTo]
 */
async function queryResolveLog(filter, env) {
  const parts = [];
  if (filter.outcome) parts.push(`outcome='${filter.outcome}'`);
  if (filter.dateFrom) parts.push(`recorded_at>='${filter.dateFrom}'`);
  if (filter.dateTo) parts.push(`recorded_at<='${filter.dateTo}'`);
  const filterQuery = parts.length ? `&filter=${encodeURIComponent(parts.join(' && '))}` : '';

  const token = await _l1AdminTokenFor(env, L1_BASE_HOST);
  const res = await fetch(
    `${L1_BASE_HOST}/api/collections/gov_data_resolve_log/records?perPage=200${filterQuery}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  if (!res.ok) {
    console.error('gov_data_resolve_log 조회 실패:', res.status, await res.text());
    return [];
  }
  const data = await res.json();
  return data.items || [];
}

module.exports = {
  recordResolveLog,
  updateHumanOverride,
  queryResolveLog,
};
