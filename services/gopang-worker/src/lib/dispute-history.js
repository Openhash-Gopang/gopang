/**
 * lib/dispute-history.js — 11번 분쟁남용 탐지용 O(1) 이력 계측
 *
 * [수정 배경] 기존 checkDisputeAbuse()는 이의제기 시점마다 활성 L1 노드 전체를
 * fan-out 조회했다. 이의제기는 velocity보다 빈도가 낮아 상대적으로 덜 급하지만,
 * 동일한 이유(노드 수 증가 시 지연 비례 증가)로 KV 누적 방식으로 통일한다.
 */

const WINDOW_MS = 90 * 24 * 3600 * 1000; // 90일
const MAX_EVENTS_KEPT = 100;

export async function recordDisputeEvent(env, buyerGuid, sellerGuid) {
  const key = `dispute-history:${buyerGuid}`;
  const raw = await env.DISPUTE_ABUSE_KV.get(key);
  const events = raw ? JSON.parse(raw) : [];
  events.push({ sellerGuid, at: Date.now() });
  const cutoff = Date.now() - WINDOW_MS;
  const pruned = events.filter((e) => e.at >= cutoff).slice(-MAX_EVENTS_KEPT);
  await env.DISPUTE_ABUSE_KV.put(key, JSON.stringify(pruned), { expirationTtl: 8_000_000 }); // ~92일
  return pruned;
}

export async function getDisputeHistory(env, buyerGuid) {
  const key = `dispute-history:${buyerGuid}`;
  const raw = await env.DISPUTE_ABUSE_KV.get(key);
  const events = raw ? JSON.parse(raw) : [];
  const cutoff = Date.now() - WINDOW_MS;
  return events.filter((e) => e.at >= cutoff);
}
