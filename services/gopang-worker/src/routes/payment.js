/**
 * routes/payment.js — 8번 항목: 결제수단 다양화 (PG 에스크로)
 *
 * 엔드포인트:
 *   POST /biz/pay/create           PG 결제창 파라미터 생성 (GDC는 여기서 분기만)
 *   POST /biz/pay/webhook/:provider  PG 결제완료 웹훅 → escrow_holds 생성
 * 크론:
 *   scheduledPgReconciliation()   매일 — PG 정산내역과 fs_ledger 대사
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
function conditionTypeForMode(mode) {
  if (mode === 'service') return 'service_completion';
  if (mode === 'delivery') return 'manual_only';
  return 'delivery_confirmation';
}

// ── 결제 생성 (프론트가 PG 위젯을 띄우기 전 호출) ───────────────────
export async function handleCreatePayment(request, env) {
  const { rail, provider, orderId, amount, itemName, sellerGuid, l1Node } = await request.json();
  if (rail !== 'pg') return jsonResponse({ ok: false, reason: 'USE_GDC_FLOW_DIRECTLY' }, 400);

  const providerConfig = await getProviderConfig(env, provider);
  if (!providerConfig || providerConfig.status !== 'active') {
    return jsonResponse({ ok: false, reason: 'PROVIDER_UNAVAILABLE' }, 400);
  }

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
  const providerConfig = await getProviderConfig(env, provider);
  const secretName = providerConfig?.webhook_secret_ref;
  const secret = secretName ? env[secretName] : null;
  if (!secret) return jsonResponse({ ok: false, reason: 'WEBHOOK_SECRET_NOT_CONFIGURED' }, 500);

  const adapter = getAdapter(env, provider);
  let payload;
  try {
    payload = await adapter.verifyWebhook(request, secret);
  } catch (e) {
    console.warn('[PG Webhook] 서명검증 실패:', e.message);
    return jsonResponse({ ok: false, reason: 'INVALID_SIGNATURE' }, 401);
  }

  // idempotency: 이미 처리된 paymentKey면 무시
  const l1Node = payload.metadata?.l1_node;
  const l1Base = await resolveL1Base(env, l1Node);
  if (!l1Base) return jsonResponse({ ok: false, reason: 'UNKNOWN_L1_NODE' }, 400);

  const dupFilter = buildFilter([['pg_payment_key', '=', payload.paymentKey]]);
  const dupRes = await pbFetch(env, l1Base, `/api/collections/escrow_holds/records?${new URLSearchParams({ filter: dupFilter, perPage: '1' })}`);
  const dupData = await dupRes.json();
  if (dupData.items?.length) return jsonResponse({ ok: true, duplicate: true });

  const mode = payload.metadata?.mode;
  const conditionType = conditionTypeForMode(mode);
  const heldAt = new Date();
  let deadline = new Date(heldAt.getTime() + RELEASE_GRACE_DAYS[conditionType] * 86400000);
  const feeRate = mode === 'card' ? providerConfig.fee_rate_card : providerConfig.fee_rate_transfer;
  const platformFee = Math.round(payload.amount * feeRate);

  // [수정] GDC 레일(afterOrderConfirmed)에서만 실행되던 11번 실시간 체크를 PG 레일에도 적용.
  // 결제수단이 다르다고 사기 위험 평가를 건너뛸 이유가 없다.
  const fraudResult = await realtimeFraudCheck(env, {
    buyerGuid: payload.metadata?.buyer_guid,
    sellerGuid: payload.metadata?.seller_guid,
    amount: payload.amount,
    deviceFp: payload.metadata?.device_fp,
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
      tx_id: payload.paymentKey,
      buyer_guid: payload.metadata?.buyer_guid,
      seller_guid: payload.metadata?.seller_guid,
      total: payload.amount,
      seller_net: payload.amount - platformFee,
      platform_fee: platformFee,
      items: payload.metadata?.items || [],
      status: 'held',
      condition_type: conditionType,
      payment_rail: 'pg',
      pg_provider: provider,
      pg_payment_key: payload.paymentKey,
      pg_order_id: payload.orderId,
      fee_rate_applied: feeRate,
      held_at: heldAt.toISOString(),
      release_deadline: deadline.toISOString(),
      fraud_review_required: fraudReviewRequired,
      fraud_risk_level: fraudResult.level,
    },
  });
  const created = await res.json();
  if (!res.ok) {
    await flagOpsAlert(env, `pg-webhook-hold-create-fail:${payload.paymentKey}`, { provider, payload, error: created });
    return jsonResponse({ ok: false, reason: 'HOLD_CREATE_FAILED' }, 500);
  }

  // [수정] GDC 레일(afterOrderConfirmed)과 동일하게 velocity KV 기록 — 11번 실시간체크가
  // PG/GDC 레일 구분 없이 동일한 O(1) 조회로 동작하도록 통일
  await recordTxEvent(env, payload.metadata?.buyer_guid, payload.amount);

  return jsonResponse({ ok: true, hold_id: created.id });
}

// ── 정산 대사 (매일 크론) ───────────────────────────────────────
export async function scheduledPgReconciliation(env) {
  for (const provider of await listActiveProviders(env)) {
    const adapter = getAdapter(env, provider);
    if (typeof adapter.fetchSettlementReport !== 'function') continue; // 미구현 어댑터는 스킵

    const settlements = await adapter.fetchSettlementReport(yesterdayDateString());
    for (const s of settlements) {
      const ledgerRow = await findFsLedgerByPgOrderId(env, s.orderId);
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

async function findFsLedgerByPgOrderId(env, pgOrderId) {
  // pg 레일 원장은 tx_id에 pg_payment_key를 그대로 사용하므로 동일 값으로 조회
  const { listActiveL1Nodes } = await import('../lib/l1-registry.js');
  for (const [, meta] of await listActiveL1Nodes(env)) {
    const filter = buildFilter([['tx_id', '=', pgOrderId]]);
    const res = await pbFetch(env, meta.base_url, `/api/collections/fs_ledger/records?${new URLSearchParams({ filter, perPage: '1' })}`);
    const data = await res.json();
    if (data.items?.length) return data.items[0];
  }
  return null;
}

function yesterdayDateString() {
  const d = new Date(Date.now() - 86400000);
  return d.toISOString().slice(0, 10);
}
