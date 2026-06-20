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
const WORKER_URL = 'https://gopang-proxy.tensor-city.workers.dev';

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

    // 이미 구독돼 있으면 권한 다이얼로그 없이 그대로 재사용
    let sub = await reg.pushManager.getSubscription();

    if (!sub) {
      const keyRes  = await fetch(`${WORKER_URL}/push/vapid-public-key`);
      const keyData = await keyRes.json().catch(() => ({}));
      if (!keyRes.ok || !keyData.publicKey) {
        return { ok: false, reason: keyData.detail || `vapid_key_http_${keyRes.status}` };
      }
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: _urlBase64ToUint8Array(keyData.publicKey),
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
