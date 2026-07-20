/**
 * 사업주 알림 공통 허브 (18번 항목)
 * — 1(KYC 상태변화), 9(무결성위반), 11(사기의심), 14(배송지연/미입력),
 *   19(경영자문), 21(세무리스크) 등이 전부 이 함수 하나만 호출한다.
 *
 * severity: 'info' | 'warn' | 'critical'
 *   - critical만 즉시 push/카카오 알림톡 (비용이 드는 채널은 최소로)
 *   - 나머지는 인앱 알림함(owner_notifications)에만 적재
 */

import { pbFetch } from './pb-admin.js';

export async function notifyOwner(env, l1Base, sellerGuid, { eventType, severity = 'info', payload }) {
  await pbFetch(env, l1Base, '/api/collections/owner_notifications/records', {
    method: 'POST',
    body: {
      seller_guid: sellerGuid,
      event_type: eventType,
      severity,
      payload,
      read: false,
      channel_sent: 'none',
      created_at: new Date().toISOString(),
    },
  });

  if (severity === 'critical') {
    await sendPushOrKakao(env, sellerGuid, { eventType, payload });
  }
}

async function sendPushOrKakao(env, sellerGuid, { eventType, payload }) {
  // 1단계 롤아웃: Web Push만 시도, 실패해도 알림함 기록은 이미 남아있으므로 무시 가능
  try {
    const sub = await getPushSubscription(env, sellerGuid);
    if (!sub) return;
    await fetch(env.PUSH_GATEWAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscription: sub,
        title: `[K-Market] ${eventTypeLabel(eventType)}`,
        body: payload?.msg || payload?.message || '확인이 필요한 알림이 있습니다.',
      }),
    });
  } catch (e) {
    console.warn('[notifyOwner] push 실패, 인앱 알림함으로만 대체:', e.message);
  }
}

async function getPushSubscription(env, sellerGuid) {
  const raw = await env.PUSH_SUBSCRIPTIONS_KV.get(`sub:${sellerGuid}`);
  return raw ? JSON.parse(raw) : null;
}

function eventTypeLabel(eventType) {
  const map = {
    kyc_status: '사업자 인증 상태 변경',
    ledger_integrity: '재무제표 무결성 경고',
    fraud_case: '이상거래 의심 감지',
    delivery_missing_tracking: '운송장 미입력 안내',
    biz_advisory: '경영 자문 리포트',
    tax_risk: '세무 리스크 경고',
    dispute_opened: '이의제기 접수',
  };
  return map[eventType] || '알림';
}
