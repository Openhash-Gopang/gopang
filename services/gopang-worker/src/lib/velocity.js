/**
 * lib/velocity.js — 11번 실시간 체크용 O(1) 속도 계측
 *
 * [수정 배경] 기존 countRecentHoldsByBuyer()는 realtimeFraudCheck() 경로에서
 * 활성 L1 노드 전체를 fan-out 조회했다. 이는 노드 수가 늘어날수록 모든 거래의
 * 응답시간이 늘어나는 구조라 "50ms 목표"였던 실시간 체크 취지에 어긋났다.
 * 홀드가 생성되는 시점(afterOrderConfirmed/handlePgWebhook)에 KV 카운터를
 * 증분해두면, 실시간 체크는 노드 조회 없이 KV 1회 조회로 끝난다.
 */

const WINDOW_MS = 3600 * 1000; // 1시간
const MAX_EVENTS_KEPT = 200;

export async function recordTxEvent(env, buyerGuid, amount) {
  const key = `velocity:${buyerGuid}`;
  const raw = await env.VELOCITY_KV.get(key);
  const events = raw ? JSON.parse(raw) : [];
  events.push({ at: Date.now(), amount });
  const cutoff = Date.now() - WINDOW_MS;
  const pruned = events.filter((e) => e.at >= cutoff).slice(-MAX_EVENTS_KEPT);
  await env.VELOCITY_KV.put(key, JSON.stringify(pruned), { expirationTtl: 86400 }); // 여유있게 하루 보관
}

export async function getRecentVelocity(env, buyerGuid) {
  const key = `velocity:${buyerGuid}`;
  const raw = await env.VELOCITY_KV.get(key);
  const events = raw ? JSON.parse(raw) : [];
  const cutoff = Date.now() - WINDOW_MS;
  const recent = events.filter((e) => e.at >= cutoff);
  return { count: recent.length, sum: recent.reduce((s, e) => s + e.amount, 0) };
}
