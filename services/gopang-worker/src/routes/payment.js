/**
 * routes/payment.js — 8번 항목: 결제수단 다양화 (PG 에스크로)
 *
 * 엔드포인트:
 *   POST /biz/pay/create           PG 결제창 파라미터 생성 (GDC는 여기서 분기만)
 *   POST /biz/pay/webhook/:provider  PG 결제완료 웹훅 → escrow_holds 생성
 * 크론:
 *   scheduledPgReconciliation()   매일 — PG 정산내역과 ledger_entries 대사
 *
 * [2026-07-21 수정 — 사고실험 시나리오2에서 발견한 버그 2건]
 *  1) 웹훅 서명 검증(HMAC)이 애초에 존재하지 않는 헤더를 검증하고 있었다 —
 *     PAYMENT_STATUS_CHANGED엔 서명이 없음(토스 공식 문서 확인). 웹훅은
 *     트리거로만 쓰고 결제조회 API로 재확인하는 방식으로 교체했다.
 *  2) payload.metadata(buyer_guid/seller_guid/mode/items/device_fp)는 토스가
 *     보내주는 필드가 아니다 — 토스 Payment 객체/웹훅엔 가맹점 커스텀
 *     메타데이터 필드 자체가 없다. handleCreatePayment에서 orderId를 키로
 *     PENDING_PG_ORDER_KV에 미리 저장해두고, 웹훅 처리 시 그 값으로
 *     역조회하도록 변경했다.
 */

import { resolveL1Base } from '../lib/l1-registry.js';
import { pbFetch } from '../lib/pb-admin.js';
import { buildFilter } from '../lib/pb-filter.js';
import { flagOpsAlert } from '../lib/ops-alerts.js';
import { getAdapter } from './payment-adapter.js';
import { realtimeFraudCheck } from './fraud.js';
import { recordTxEvent } from '../lib/velocity.js';
import { jsonResponse } from '../lib/http.js';

const RELEASE_GRACE_DAYS = { delivery_confirmation: 7, service_completion: 3, manual_only: 1 };
const PENDING_ORDER_TTL_SEC = 1800; // 결제창 유효시간(30분)과 맞춤
function conditionTypeForMode(mode) {
  if (mode === 'service') return 'service_completion';
  if (mode === 'delivery') return 'manual_only';
  return 'delivery_confirmation';
}

// ── 결제 생성 (프론트가 PG 위젯을 띄우기 전 호출) ───────────────────
export async function handleCreatePayment(request, env) {
  const {
    rail, provider, orderId, amount, itemName,
    buyerGuid, sellerGuid, mode, items, deviceFp, l1Node,
  } = await request.json();
  if (rail !== 'pg') return jsonResponse({ ok: false, reason: 'USE_GDC_FLOW_DIRECTLY' }, 400);

  const providerConfig = await getProviderConfig(env, provider);
  if (!providerConfig || providerConfig.status !== 'active') {
    return jsonResponse({ ok: false, reason: 'PROVIDER_UNAVAILABLE' }, 400);
  }

  // [2026-07-21 신설] 토스는 가맹점 커스텀 메타데이터를 웹훅/조회 응답에
  // 실어주지 않는다 — orderId를 키로 우리 쪽에 직접 저장해뒀다가, 웹훅
  // 도착 시(handlePgWebhook) 이걸로 역조회한다.
  await env.PENDING_PG_ORDER_KV.put(orderId, JSON.stringify({
    buyerGuid, sellerGuid, mode, items: items || [], deviceFp, l1Node,
    createdAt: new Date().toISOString(),
  }), { expirationTtl: PENDING_ORDER_TTL_SEC });

  const adapter = getAdapter(env, provider);
  const orderParams = await adapter.createOrder({
    orderId, amount, itemName,
    successUrl: `${env.APP_BASE_URL}/pay/success`,
    failUrl: `${env.APP_BASE_URL}/pay/fail`,
  });
  return jsonResponse({ ok: true, ...orderParams });
}

// ── 웹훅 (PG사가 결제완료를 통지) ───────────────────────────────
export async function handlePgWebhook(request, env, provider) {
  const adapter = getAdapter(env, provider);

  // [2026-07-21 수정] 서명이 없는 이벤트이므로 body는 트리거로만 사용 —
  // paymentKey만 뽑아내고, 실제 상태·금액은 아래에서 API 재조회로 확보한다.
  let webhookBody;
  try {
    webhookBody = await request.json();
  } catch (e) {
    return jsonResponse({ ok: false, reason: 'INVALID_BODY' }, 400);
  }
  const paymentKey = webhookBody?.data?.paymentKey;
  if (!paymentKey) return jsonResponse({ ok: false, reason: 'MISSING_PAYMENT_KEY' }, 400);

  let payment;
  try {
    payment = await adapter.getPayment(paymentKey);
  } catch (e) {
    console.warn('[PG Webhook] 결제조회 실패:', e.message);
    return jsonResponse({ ok: false, reason: 'PAYMENT_LOOKUP_FAILED' }, 502);
  }
  if (payment.status !== 'DONE') {
    // 아직 승인 전이거나 이미 취소된 건 — 에스크로 hold 생성 대상이 아님
    return jsonResponse({ ok: true, ignored: true, reason: `STATUS_${payment.status}` });
  }

  const pendingRaw = await env.PENDING_PG_ORDER_KV.get(payment.orderId);
  if (!pendingRaw) {
    await flagOpsAlert(env, `pg-webhook-missing-order-meta:${payment.orderId}`, {
      provider, paymentKey, orderId: payment.orderId,
    });
    return jsonResponse({ ok: false, reason: 'ORDER_METADATA_NOT_FOUND' }, 404);
  }
  const pending = JSON.parse(pendingRaw);

  const providerConfig = await getProviderConfig(env, provider);
  const l1Base = await resolveL1Base(env, pending.l1Node);
  if (!l1Base) return jsonResponse({ ok: false, reason: 'UNKNOWN_L1_NODE' }, 400);

  // idempotency: 이미 처리된 paymentKey면 무시
  const dupFilter = buildFilter([['pg_payment_key', '=', paymentKey]]);
  const dupRes = await pbFetch(env, l1Base, `/api/collections/escrow_holds/records?${new URLSearchParams({ filter: dupFilter, perPage: '1' })}`);
  const dupData = await dupRes.json();
  if (dupData.items?.length) return jsonResponse({ ok: true, duplicate: true });

  const conditionType = conditionTypeForMode(pending.mode);
  const heldAt = new Date();
  let deadline = new Date(heldAt.getTime() + RELEASE_GRACE_DAYS[conditionType] * 86400000);
  const feeRate = pending.mode === 'card' ? providerConfig.fee_rate_card : providerConfig.fee_rate_transfer;

  // [2026-07-21 수정] 금액은 웹훅 body가 아니라 결제조회 API 응답(totalAmount)을
  // 신뢰한다 — 위조된 웹훅 body의 금액을 그대로 쓰지 않기 위함.
  const totalAmount = payment.totalAmount;
  const platformFee = Math.round(totalAmount * feeRate);

  // [수정] GDC 레일(afterOrderConfirmed)에서만 실행되던 11번 실시간 체크를 PG 레일에도 적용.
  const fraudResult = await realtimeFraudCheck(env, {
    buyerGuid: pending.buyerGuid,
    sellerGuid: pending.sellerGuid,
    amount: totalAmount,
    deviceFp: pending.deviceFp,
    l1Base,
  });
  let fraudReviewRequired = false;
  if (fraudResult.action === 'hold_for_review') {
    fraudReviewRequired = true;
  } else if (fraudResult.action === 'require_step_up') {
    deadline = new Date(heldAt.getTime() + RELEASE_GRACE_DAYS[conditionType] * 2 * 86400000);
  }

  const res = await pbFetch(env, l1Base, '/api/collections/escrow_holds/records', {
    method: 'POST',
    body: {
      tx_id: paymentKey,
      buyer_guid: pending.buyerGuid,
      seller_guid: pending.sellerGuid,
      total: totalAmount,
      seller_net: totalAmount - platformFee,
      platform_fee: platformFee,
      items: pending.items || [],
      status: 'held',
      condition_type: conditionType,
      payment_rail: 'pg',
      pg_provider: provider,
      pg_payment_key: paymentKey,
      pg_order_id: payment.orderId,
      fee_rate_applied: feeRate,
      held_at: heldAt.toISOString(),
      release_deadline: deadline.toISOString(),
      fraud_review_required: fraudReviewRequired,
      fraud_risk_level: fraudResult.level,
    },
  });
  const created = await res.json();
  if (!res.ok) {
    await flagOpsAlert(env, `pg-webhook-hold-create-fail:${paymentKey}`, { provider, payment, error: created });
    return jsonResponse({ ok: false, reason: 'HOLD_CREATE_FAILED' }, 500);
  }

  // [수정] GDC 레일(afterOrderConfirmed)과 동일하게 velocity KV 기록
  await recordTxEvent(env, pending.buyerGuid, totalAmount);

  // 더 이상 필요 없으니 정리 (TTL로도 자동 소멸하지만 명시적으로 즉시 삭제)
  await env.PENDING_PG_ORDER_KV.delete(payment.orderId);

  return jsonResponse({ ok: true, hold_id: created.id });
}

// ── 정산 대사 (매일 크론) ───────────────────────────────────────
export async function scheduledPgReconciliation(env) {
  for (const provider of await listActiveProviders(env)) {
    const adapter = getAdapter(env, provider);
    if (typeof adapter.fetchSettlementReport !== 'function') continue; // 미구현 어댑터는 스킵

    const settlements = await adapter.fetchSettlementReport(yesterdayDateString());
    for (const s of settlements) {
      const ledgerRow = await findLedgerEntryByPgOrderId(env, s.orderId);
      if (!ledgerRow) {
        await flagOpsAlert(env, `pg-recon-missing:${provider}:${s.orderId}`, { type: 'MISSING_LEDGER_ROW', provider, pgOrderId: s.orderId });
        continue;
      }
      if (Math.abs(ledgerRow.amount - s.settledAmount) > 1) {
        await flagOpsAlert(env, `pg-recon-mismatch:${provider}:${s.orderId}`, {
          type: 'AMOUNT_MISMATCH', provider, pgOrderId: s.orderId,
          expected: ledgerRow.amount, actual: s.settledAmount,
        });
      }
    }
  }
}

// ── 설정 (PG_PROVIDER_CONFIG_KV — L1 레지스트리와 동일 철학: 배포 없이 갱신) ──
async function getProviderConfig(env, provider) {
  const raw = await env.PG_PROVIDER_CONFIG_KV.get(provider);
  return raw ? JSON.parse(raw) : null;
}
async function listActiveProviders(env) {
  const list = await env.PG_PROVIDER_CONFIG_KV.list();
  const configs = await Promise.all(list.keys.map(async (k) => [k.name, JSON.parse(await env.PG_PROVIDER_CONFIG_KV.get(k.name))]));
  return configs.filter(([, v]) => v.status === 'active').map(([name]) => name);
}
export async function upsertProviderConfig(env, provider, value) {
  await env.PG_PROVIDER_CONFIG_KV.put(provider, JSON.stringify(value));
}

// [2026-07-21 수정] fs_ledger → ledger_entries (원장 통합 커밋에서 컬렉션명이
// 바뀌었는데 이 함수만 갱신이 안 돼 있었음 — 정산대사 크론이 항상
// MISSING_LEDGER_ROW를 오탐했을 것)
async function findLedgerEntryByPgOrderId(env, pgOrderId) {
  // pg 레일 원장은 tx_id에 pg_payment_key를 그대로 사용하므로 동일 값으로 조회
  const { listActiveL1Nodes } = await import('../lib/l1-registry.js');
  for (const [, meta] of await listActiveL1Nodes(env)) {
    const filter = buildFilter([['tx_id', '=', pgOrderId]]);
    const res = await pbFetch(env, meta.base_url, `/api/collections/ledger_entries/records?${new URLSearchParams({ filter, perPage: '1' })}`);
    const data = await res.json();
    if (data.items?.length) return data.items[0];
  }
  return null;
}

function yesterdayDateString() {
  const d = new Date(Date.now() - 86400000);
  return d.toISOString().slice(0, 10);
}
