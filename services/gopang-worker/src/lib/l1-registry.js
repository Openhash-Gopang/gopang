/**
 * L1 레지스트리 공용 모듈
 * — Worker 전체가 이 파일만 import 한다. 신규 지역 추가 시 배포 없이
 *   L1_REGISTRY_KV 값만 갱신하면 되도록 하드코딩 객체를 쓰지 않는다.
 *
 * KV 스키마 (key = l1_node 코드, 예: "KR-JEJU-JEJU-HANLIM"):
 * {
 *   base_url, region_name, status: 'active'|'pending'|'deprecated',
 *   node_type: 'regional'|'virtual',
 *   center: { lat, lng }, service_radius_km,
 *   admin_region_keys: ["시도|시군구|읍면동", ...],
 *   record_count, record_count_updated_at,
 *   search_perf: { p95_ms, p95_updated_at, consecutive_breaches },
 *   search_backend: 'like'|'fts5',
 *   created_at
 * }
 */

const REGISTRY_CACHE_TTL_MS = 5 * 60 * 1000; // isolate 내 5분 캐시
let _cache = null;
let _cacheAt = 0;

export function invalidateRegistryCache() {
  _cache = null;
  _cacheAt = 0;
}

async function loadRegistry(env) {
  const now = Date.now();
  if (_cache && now - _cacheAt < REGISTRY_CACHE_TTL_MS) return _cache;

  const list = await env.L1_REGISTRY_KV.list();
  const entries = await Promise.all(
    list.keys.map(async (k) => {
      const raw = await env.L1_REGISTRY_KV.get(k.name);
      return [k.name, raw ? JSON.parse(raw) : null];
    })
  );
  _cache = Object.fromEntries(entries.filter(([, v]) => v));
  _cacheAt = now;
  return _cache;
}

/** l1_node 코드 → PocketBase base_url. 비활성/미존재 시 null. */
export async function resolveL1Base(env, l1Node) {
  const reg = await loadRegistry(env);
  const node = reg[l1Node];
  return node?.status === 'active' ? node.base_url : null;
}

export async function getNodeMeta(env, l1Node) {
  const reg = await loadRegistry(env);
  return reg[l1Node] || null;
}

/** [ [l1Node, meta], ... ] 활성 노드 전체 */
export async function listActiveL1Nodes(env) {
  const reg = await loadRegistry(env);
  return Object.entries(reg).filter(([, v]) => v.status === 'active');
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
export { haversine };

/** GPS 좌표로부터 가까운 활성 regional 노드 후보 (검색 팬아웃용) */
export async function nearbyL1Nodes(env, lat, lng, maxCandidates = 3) {
  const reg = await loadRegistry(env);
  return Object.entries(reg)
    .filter(([, v]) => v.status === 'active' && v.node_type !== 'virtual')
    .map(([node, v]) => ({
      node,
      ...v,
      dist: haversine(lat, lng, v.center.lat, v.center.lng),
    }))
    .filter((r) => r.dist <= r.service_radius_km * 1.5)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, maxCandidates);
}

/** 주소 행정구역 키("시도|시군구|읍면동")로 l1_node 역매핑 */
export async function resolveL1ByAdminKey(env, adminKey) {
  const reg = await loadRegistry(env);
  const matched = Object.entries(reg).find(
    ([, v]) => v.status === 'active' && v.admin_region_keys?.includes(adminKey)
  );
  return matched ? { l1Node: matched[0], meta: matched[1] } : null;
}

/** 매일 크론 — search_index 레코드 수 갱신 (virtual 노드는 감시 제외) */
export async function updateRecordCount(env, l1Node, count) {
  const reg = await loadRegistry(env);
  const node = reg[l1Node];
  if (!node) return;
  node.record_count = count;
  node.record_count_updated_at = new Date().toISOString();
  await env.L1_REGISTRY_KV.put(l1Node, JSON.stringify(node));
  invalidateRegistryCache();

  if (node.node_type !== 'virtual' && count > 10000 && node.search_backend === 'like') {
    const { flagOpsAlert } = await import('./ops-alerts.js');
    await flagOpsAlert(env, `fts5-review:${l1Node}`, {
      l1Node,
      reason: 'record_count_threshold',
      count,
    });
  }
}

/** 검색 요청 단위 지연 계측 — p95 근사치 갱신 + 연속 300ms 초과 트리거 */
export async function recordSearchLatency(env, l1Node, durationMs) {
  const reg = await loadRegistry(env);
  const node = reg[l1Node];
  if (!node || node.node_type === 'virtual') return;

  node.search_perf = node.search_perf || { p95_ms: 0, consecutive_breaches: 0 };
  node.search_perf.p95_ms = durationMs;
  node.search_perf.p95_updated_at = new Date().toISOString();
  node.search_perf.consecutive_breaches =
    durationMs > 300 ? (node.search_perf.consecutive_breaches || 0) + 1 : 0;

  await env.L1_REGISTRY_KV.put(l1Node, JSON.stringify(node));
  invalidateRegistryCache();

  if (node.search_perf.consecutive_breaches >= 3 && node.search_backend === 'like') {
    const { flagOpsAlert } = await import('./ops-alerts.js');
    await flagOpsAlert(env, `fts5-review:${l1Node}`, {
      l1Node,
      reason: 'latency_breach',
      p95_ms: durationMs,
    });
  }
}

/** 관리자 전용 — 신규 L1 노드 추가/상태 변경 (배포 없이 즉시 반영) */
export async function upsertL1Node(env, l1Node, value) {
  await env.L1_REGISTRY_KV.put(l1Node, JSON.stringify(value));
  invalidateRegistryCache();
}
