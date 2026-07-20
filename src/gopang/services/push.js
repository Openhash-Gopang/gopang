/**
 * services/push.js — Web Push(VAPID) 구독 공통 로직
 *
 * 가입 완료 시점에 푸시 알림 권한을 요청하기 위한 공용 모듈.
 * 설정 화면의 토글에서도 동일한 로직을 재사용한다.
 *
 * - 이미 구독돼 있으면 재요청 없이 그대로 서버에만 재등록(guid 갱신)
 * - 이미 거부된 상태(Notification.permission === 'denied')면 조용히 종료
 *   (브라우저가 다이얼로그를 다시 띄우지 않으므로 콘솔 노이즈만 남기지 않게)
 * - 실패해도 호출부의 다른 흐름(가입 등)을 막지 않도록
 *   항상 { ok, reason } 형태로만 반환하고 throw하지 않는다.
 */
const WORKER_URL = 'https://hondi-proxy.tensor-city.workers.dev';

// ── 탈중앙화 이관 ①: VAPID 공개키 하드코딩 (2026-06-23) ─────────────────
// 이전: Worker GET /push/vapid-public-key → env.VAPID_PUBLIC_KEY 반환
// 이후: 공개키는 공개 정보이므로 단말에 직접 내장. Worker 엔드포인트 호출 불필요.
// 공개키가 교체될 경우 이 상수와 함께 Worker secret도 같이 교체해야 함.
//
// ★ 2026-07-20 교체 — 예전 VAPID 개인키를 분실해(어디에도 백업이 없었음)
// 서버가 새 키 쌍(VAPID_PRIVATE_KEY/VAPID_PUBLIC_KEY, wrangler secret으로
// 등록 완료)으로 서명하는데 기존 공개키로 구독한 클라이언트와 안 맞아
// FCM이 403으로 거부하는 문제가 실사로 확인됐다(device-link 웹푸시가
// 조용히 도착 안 하던 근본 원인). 새 공개키로 교체 — 이 시점 이전에
// 구독한 사용자는 전부 재구독이 필요하다(applicationServerKey가 바뀌면
// 브라우저가 기존 구독을 그대로 못 씀 — pushManager.subscribe()가 새
// 구독을 만든다).
const VAPID_PUBLIC_KEY = 'BKgtXbSP0ng9P5fb7Jl6byOZDO7O9gNp1fZ9EC_ClPhKjwA5I-9lNUezY10AFGHTT4UHZfmW_Wyt7LfEp0wAz7I';

function _urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

export async function requestPushSubscription(guid) {
  if (!guid) return { ok: false, reason: 'guid_missing' };
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, reason: 'unsupported' };
  }
  if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
    return { ok: false, reason: 'permission_denied' };
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();

    if (!sub) {
      // 이전: Worker API 호출 → 이후: 내장 상수 직접 사용
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: _urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const sound = localStorage.getItem('gopang_push_sound') || 'ping';
    await fetch(`${WORKER_URL}/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guid, subscription: sub.toJSON(), sound }),
    });

    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}
