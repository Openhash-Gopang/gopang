/**
 * routes/escrow.js — 7번 항목: 에스크로(결제 보류) 시스템
 *
 * 흐름:
 *   afterOrderConfirmed()   /biz/order 성공 직후 훅 — escrow_holds 레코드 생성
 *   handleBuyerConfirm()    POST /biz/escrow/confirm  (구매자 "구매확정" 버튼)
 *   handleOpenDispute()     POST /biz/escrow/dispute  (이의제기 접수)
 *   handleDisputeResolution() K-Law 중재 콜백
 *   scheduledEscrowAutoRelease() 매일 크론 — 유예기간 만료건 자동 릴리즈
 */

import { listActiveL1Nodes } from '../lib/l1-registry.js';
import { pbFetch } from '../lib/pb-admin.js';
import { buildFilter } from '../lib/pb-filter.js';
import { callEscrowSigner } from '../do/escrow-signer.js';
import { flagOpsAlert } from '../lib/ops-alerts.js';
import { notifyOwner } from '../lib/notify-owner.js';
import { realtimeFraudCheck, checkDisputeAbuse } from './fraud.js';
import { recordTxEvent } from '../lib/velocity.js';
import { recordDisputeEvent } from '../lib/dispute-history.js';
import { jsonResponse } from '../lib/http.js';
// [2026-07 통합] escrow-signer.js와 동일하게, Σδ=0 검증은 정본 src/openhash/bivm.js를
// 재사용한다(같은 검증 로직을 GDC 레일/PG 레일에 각자 다시 구현하지 않는다).
import { verify as bivmVerify } from '../../../../src/openhash/bivm.js';

// mode(업종 4종)별 자동릴리즈 유예기간 — 청약철회권(전자상거래법) 취지 반영
const RELEASE_GRACE_DAYS = {
  delivery_confirmation: 7, // 배송 상품 — 수령 후 7일
  service_completion: 3,    // 서비스 — 이용완료 후 3일
  manual_only: 1,           // 즉시배달류 — 짧게, 확정버튼 유도
};

function conditionTypeForMode(mode) {
  if (mode === 'service') return 'service_completion';
  if (mode === 'delivery') return 'manual_only';
  return 'delivery_confirmation'; // product / hybrid 기본값
}

/**
 * /biz/order 핸들러(L1 블록 생성 성공 직후)에서 호출.
 *
 * ⚠️ 완전성 한계(사고실험에서 다시 짚음): 이 함수는 이름 그대로 "L1 tx가 이미 확정된 뒤"
 * 호출되므로, 11번의 실시간 체크(realtimeFraudCheck)가 여기서 S3(hold_for_review)를
 * 반환해도 자금 이동 자체를 막을 수는 없다 — GDC의 경우 buyer_sig 서명이 이미 L1에
 * 반영된 뒤이기 때문이다. 진짜 사전 차단은 /biz/order 핸들러가 L1 /api/tx를 호출하기
 * "전"에 realtimeFraudCheck를 호출해야 하며, 그 핸들러는 이 저장소 범위 밖 —
 * hondi-proxy(루트 worker.js)의 /biz/order 핸들러 — 에 있다(2026-07 확인:
 * gopang-proxy는 hondi-proxy로 통합·폐지 중이므로 실제 위치를 정정함). 이
 * 함수는 사후 최선책으로 "보류 플래그 + 유예기간 조정"까지만 수행한다.
 */
export async function afterOrderConfirmed(env, l1Base, orderResult, orderMeta) {
  const { seller_guid, buyer_guid, total, seller_net, platform_fee, items, mode, payment_rail, deviceFp } = orderMeta;
  const conditionType = conditionTypeForMode(mode);
  const heldAt = new Date();
  let deadline = new Date(heldAt.getTime() + RELEASE_GRACE_DAYS[conditionType] * 86400000);

  const fraudResult = await realtimeFraudCheck(env, {
    buyerGuid: buyer_guid, sellerGuid: seller_guid, amount: total, deviceFp, l1Base,
  });

  let fraudReviewRequired = false;
  if (fraudResult.action === 'hold_for_review') {
    fraudReviewRequired = true; // scheduledEscrowAutoRelease가 이 플래그 건은 건너뜀
  } else if (fraudResult.action === 'require_step_up') {
    deadline = new Date(heldAt.getTime() + RELEASE_GRACE_DAYS[conditionType] * 2 * 86400000);
  }

  const res = await pbFetch(env, l1Base, '/api/collections/escrow_holds/records', {
    method: 'POST',
    body: {
      tx_id: orderResult.tx_hash,
      buyer_guid, seller_guid, total, seller_net, platform_fee, items,
      status: 'held',
      condition_type: conditionType,
      payment_rail: payment_rail || 'gdc',
      held_at: heldAt.toISOString(),
      release_deadline: deadline.toISOString(),
      fraud_review_required: fraudReviewRequired,
      fraud_risk_level: fraudResult.level,
    },
  });
  const created = await res.json();

  // [수정] 다음 거래의 realtimeFraudCheck가 O(1)로 조회할 수 있도록 지금 이 거래를 KV에 기록
  await recordTxEvent(env, buyer_guid, total);

  return created;
}

// ── (A) 구매자 확정 ──────────────────────────────────────────
export async function handleBuyerConfirm(request, env) {
  const { hold_id, buyer_guid, l1_node, l1_base } = await request.json();
  const hold = await getHold(env, l1_base, hold_id);
  if (!hold) return jsonResponse({ ok: false, reason: 'NOT_FOUND' }, 404);
  if (hold.buyer_guid !== buyer_guid) return jsonResponse({ ok: false, reason: 'NOT_OWNER' }, 403);
  if (hold.status !== 'held') return jsonResponse({ ok: false, reason: 'ALREADY_SETTLED' });

  const result = await releaseHold(env, l1_node, { ...hold, l1_base });
  await patchHoldReleaseReason(env, l1_base, hold_id, 'buyer_confirmed');
  return jsonResponse(result);
}

// ── 이의제기 접수 ────────────────────────────────────────────
export async function handleOpenDispute(request, env) {
  const { hold_id, buyer_guid, l1_base, reason } = await request.json();
  const hold = await getHold(env, l1_base, hold_id);
  if (!hold || hold.buyer_guid !== buyer_guid) return jsonResponse({ ok: false, reason: 'NOT_OWNER' }, 403);

  // 이의제기는 자동타임아웃 크론보다 항상 우선 — 즉시 disputed로 전환
  await pbFetch(env, l1_base, `/api/collections/escrow_holds/records/${hold_id}`, {
    method: 'PATCH',
    body: { status: 'disputed' },
  });

  await pbFetch(env, l1_base, '/api/collections/dispute_cases/records', {
    method: 'POST',
    body: { hold_id, buyer_guid, seller_guid: hold.seller_guid, reason, status: 'human_review', created_at: new Date().toISOString() },
  });

  await notifyOwner(env, l1_base, hold.seller_guid, {
    eventType: 'dispute_opened',
    severity: 'warn',
    payload: { msg: `거래(${hold.tx_id})에 대해 구매자가 이의를 제기했습니다.`, hold_id },
  });

  // 11번(사기탐지) 연동 — 자동조치는 없음, K-Law 중재 참고정보로만 신호를 남긴다
  await recordDisputeEvent(env, buyer_guid, hold.seller_guid);
  await checkDisputeAbuse(env, buyer_guid);

  return jsonResponse({ ok: true, status: 'disputed' });
}

// ── (D) 분쟁 해결 콜백 (12번 K-Law 중재 결과) ───────────────────
export async function handleDisputeResolution(request, env) {
  const { hold_id, l1_node, l1_base, verdict } = await request.json(); // verdict: 'seller_wins' | 'buyer_wins'
  const hold = await getHold(env, l1_base, hold_id);
  if (!hold) return jsonResponse({ ok: false, reason: 'NOT_FOUND' }, 404);

  const action = verdict === 'seller_wins' ? 'release_full' : 'refund_full';
  const result = await releaseHold(env, l1_node, { ...hold, l1_base }, action);
  await patchHoldReleaseReason(
    env, l1_base, hold_id,
    verdict === 'seller_wins' ? 'dispute_resolved_seller' : 'dispute_resolved_buyer'
  );
  return jsonResponse(result);
}

// ── (C) 자동 타임아웃 릴리즈 (매일 크론) ─────────────────────────
export async function scheduledEscrowAutoRelease(env) {
  for (const [l1Node, meta] of await listActiveL1Nodes(env)) {
    const filter = buildFilter([['status', '=', 'held']]);
    const qs = new URLSearchParams({ perPage: '200', filter });
    const res = await pbFetch(env, meta.base_url, `/api/collections/escrow_holds/records?${qs}`);
    const { items = [] } = await res.json();

    const now = Date.now();
    const due = items.filter((h) => new Date(h.release_deadline).getTime() < now);
    for (const hold of due) {
      if (hold.fraud_review_required) {
        // 11번 사기의심 플래그가 걸린 건은 사람이 fraud_cases를 확정(false_positive 등)
        // 처리하기 전까지 자동 릴리즈하지 않는다.
        await flagOpsAlert(env, `escrow-held-past-deadline-fraud-flag:${hold.id}`, { holdId: hold.id });
        continue;
      }

      // [수정] 14번(실시간 배송사 연동)이 아직 구현되지 않아 delivery_confirmed_at이
      // 항상 비어있는 지금 상태에서, 배송여부와 무관하게 유예기간만 지나면 자동지급하는
      // 것은 "판매자가 배송을 안 해도 자동으로 대금을 받는" 악용 경로가 된다.
      // 운송장 미등록 상태의 delivery_confirmation 건은 자동릴리즈 대상에서 제외하고
      // 판매자에게 등록 리마인드만 보낸다 — 구매자 확정 또는 분쟁해결로만 정산 가능.
      if (hold.condition_type === 'delivery_confirmation' && !hold.tracking_no) {
        await notifyOwner(env, meta.base_url, hold.seller_guid, {
          eventType: 'delivery_missing_tracking',
          severity: 'warn',
          payload: { msg: '운송장 번호가 등록되지 않아 자동 정산이 보류되고 있습니다. 운송장을 등록해주세요.', holdId: hold.id },
        });
        await flagOpsAlert(env, `escrow-blocked-no-tracking:${hold.id}`, { holdId: hold.id, releaseDeadline: hold.release_deadline });
        continue;
      }

      try {
        await releaseHold(env, l1Node, { ...hold, l1_base: meta.base_url });
        await patchHoldReleaseReason(env, meta.base_url, hold.id, 'auto_timeout');
      } catch (e) {
        await flagOpsAlert(env, `escrow-auto-release-fail:${hold.id}`, { holdId: hold.id, error: e.message });
      }
    }
  }
}

// ── 레일 무관 공통 릴리즈/환불 (8번 PG 어댑터와 여기서 합류) ───────────
export async function releaseHold(env, l1Node, hold, action = 'release_full') {
  if (hold.payment_rail === 'gdc') {
    // GDC 레일은 EscrowSigner DO 내부에서 릴리즈 성공 시 fs_ledger까지 함께 기록한다.
    return callEscrowSigner(env, l1Node, hold.l1_base, hold.id, action);
  }

  const { getAdapter } = await import('./payment-adapter.js');
  const adapter = getAdapter(env, hold.pg_provider);
  const fn = action === 'release_full' ? 'releaseToSeller' : 'refundToBuyer';
  const result = await adapter[fn]({ paymentKey: hold.pg_payment_key, amount: hold.total, sellerGuid: hold.seller_guid });

  // [수정] GDC와 동일하게 buyer(debit)/seller(credit)/platform(credit) 3행 구조로 통일하고,
  // 원장쓰기 실패는 자금이동을 되돌리지 않되 반드시 사람이 볼 수 있게 플래그한다.
  if (action === 'release_full') {
    const { insertFsLedger } = await import('./ledger.js');
    const nowIso = new Date().toISOString();
    const entries = [
      { guid: hold.buyer_guid, entry: {
        tx_id: hold.pg_payment_key + ':buyer', counterpart: hold.seller_guid, direction: 'debit',
        amount: hold.total, item_name: hold.items?.[0]?.name || '', fs_account: 'purchase',
        payment_rail: 'pg', memo: `K-Market 구매 확정 (${hold.pg_provider})`, tx_at: nowIso,
      }},
      { guid: hold.seller_guid, entry: {
        tx_id: hold.pg_payment_key + ':seller', counterpart: hold.buyer_guid, direction: 'credit',
        amount: hold.seller_net, item_name: hold.items?.[0]?.name || '', fs_account: 'revenue',
        payment_rail: 'pg', fee_rate_applied: hold.fee_rate_applied,
        memo: `K-Market PG 정산 (${hold.pg_provider})`, tx_at: nowIso,
      }},
      { guid: 'gopang-platform', entry: {
        tx_id: hold.pg_payment_key + ':platform', counterpart: hold.seller_guid, direction: 'credit',
        amount: hold.platform_fee, item_name: '', fs_account: 'platform_fee',
        payment_rail: 'pg', memo: `K-Market 수수료 (${hold.pg_provider})`, tx_at: nowIso,
      }},
    ];

    // [2026-07 통합] GDC 레일(escrow-signer.js)과 동일하게, 원장 쓰기 전에 정본
    // bivm.js로 Σδ=0을 먼저 검증한다. balanceBefore/After=0 고정의 한계는
    // escrow-signer.js와 동일(주석 참조) — per-tx BMI 산술 검증까지 완전해지려면
    // PG 어댑터가 반환하는 실제 잔액을 채워야 한다(후속 작업).
    const bivmTxs = entries.map(({ guid, entry }) => ({
      id: entry.tx_id,
      from: hold.buyer_guid, to: hold.seller_guid,
      amount: entry.amount,
      delta: entry.direction === 'debit' ? -entry.amount : entry.amount,
      balanceBefore: 0, balanceAfter: 0,
    }));
    const bivmResult = bivmVerify(bivmTxs);
    if (!bivmResult.setValid) {
      await flagOpsAlert(env, `bivm-set-violation:${hold.pg_payment_key}`, {
        holdId: hold.id, txId: hold.pg_payment_key, errors: bivmResult.errors,
      });
    }

    const failures = [];
    for (const { guid, entry } of entries) {
      try {
        await insertFsLedger(env, hold.l1_base, guid, entry);
      } catch (e) {
        failures.push({ guid, entry, error: e.message });
      }
    }
    if (failures.length) {
      await flagOpsAlert(env, `ledger-reconcile-gap:${hold.pg_payment_key}`, {
        holdId: hold.id, txId: hold.pg_payment_key,
        reason: 'PG_RELEASE_LEDGER_WRITE_PARTIAL_FAILURE', failures,
      });
    }
  }

  await pbFetch(env, hold.l1_base, `/api/collections/escrow_holds/records/${hold.id}`, {
    method: 'PATCH',
    body: { status: action === 'release_full' ? 'released' : 'refunded', released_at: new Date().toISOString() },
  });

  return { ok: true, pgResult: result };
}

async function getHold(env, l1Base, holdId) {
  const res = await pbFetch(env, l1Base, `/api/collections/escrow_holds/records/${holdId}`);
  return res.ok ? res.json() : null;
}

async function patchHoldReleaseReason(env, l1Base, holdId, reason) {
  await pbFetch(env, l1Base, `/api/collections/escrow_holds/records/${holdId}`, {
    method: 'PATCH',
    body: { release_reason: reason },
  });
}
