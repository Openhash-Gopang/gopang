/**
 * OPS_ALERTS_KV — 운영자가 반드시 검토해야 할 신호를 남기는 공용 큐.
 *
 * 원칙(전 항목 공통): 이 모듈을 통해 나가는 알림은 절대 자동으로 조치를
 * 실행하지 않는다. FTS5 전환, 정산 대사 불일치, 재무제표 무결성 위반,
 * 사기 케이스, 보안 이슈 등 "돈/신뢰"에 관계된 모든 자동탐지는 여기로
 * 모이고, 실제 조치는 사람이 결정한다.
 */

export async function flagOpsAlert(env, key, detail) {
  const existing = await env.OPS_ALERTS_KV.get(key);
  if (existing) return; // 이미 플래그됨 — 중복 알림 방지

  await env.OPS_ALERTS_KV.put(
    key,
    JSON.stringify({ ...detail, flagged_at: new Date().toISOString(), resolved: false })
  );
  console.warn(`[OPS_ALERT] ${key} —`, JSON.stringify(detail));
}

export async function resolveOpsAlert(env, key, resolutionNote) {
  const raw = await env.OPS_ALERTS_KV.get(key);
  if (!raw) return;
  const data = JSON.parse(raw);
  data.resolved = true;
  data.resolved_at = new Date().toISOString();
  data.resolution_note = resolutionNote;
  await env.OPS_ALERTS_KV.put(key, JSON.stringify(data));
}

export async function listOpsAlerts(env, { prefix = '', includeResolved = false } = {}) {
  const list = await env.OPS_ALERTS_KV.list({ prefix });
  const items = await Promise.all(
    list.keys.map(async (k) => {
      const raw = await env.OPS_ALERTS_KV.get(k.name);
      return { key: k.name, ...(raw ? JSON.parse(raw) : {}) };
    })
  );
  return includeResolved ? items : items.filter((i) => !i.resolved);
}
