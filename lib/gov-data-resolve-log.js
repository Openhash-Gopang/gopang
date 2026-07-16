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
 * ---------------------------------------------------------------------------
 */

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

  const res = await fetch(`${env.POCKETBASE_URL}/api/collections/gov_data_resolve_log/records`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // L1 PocketBase Admin 인증 — 기존 worker.js §1083 부근 패턴과 동일한 방식 재사용
      'Authorization': `Bearer ${env.POCKETBASE_ADMIN_TOKEN}`,
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
  const res = await fetch(`${env.POCKETBASE_URL}/api/collections/gov_data_resolve_log/records/${recordId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.POCKETBASE_ADMIN_TOKEN}`,
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

  const res = await fetch(
    `${env.POCKETBASE_URL}/api/collections/gov_data_resolve_log/records?perPage=200${filterQuery}`,
    { headers: { 'Authorization': `Bearer ${env.POCKETBASE_ADMIN_TOKEN}` } }
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
