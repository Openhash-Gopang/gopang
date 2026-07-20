/**
 * routes/ledger.js — 9번 항목: 재무제표 위변조 방지
 *
 * 엔드포인트:
 *   insertFsLedger()            내부 헬퍼 — 다른 라우트(escrow 등)가 호출
 *   POST /biz/ledger-correction 정정 전표 발행 (유일한 "수정" 경로)
 *   GET  /biz/ledger-verify     사업자 원장 해시체인 자가검증
 * 크론:
 *   scheduledLedgerAnchoring()      매시간 — 신규 원장 머클루트 앵커링
 *   scheduledLedgerIntegrityAudit() 매일 — 전 사업자 전수 재검증
 */

import { resolveL1Base, listActiveL1Nodes } from '../lib/l1-registry.js';
import { pbFetch } from '../lib/pb-admin.js';
import { buildFilter } from '../lib/pb-filter.js';
import { appendLedgerEntry } from '../do/ledger-writer.js';
import { flagOpsAlert } from '../lib/ops-alerts.js';
import { notifyOwner } from '../lib/notify-owner.js';
import { jsonResponse } from '../lib/http.js';

/** 다른 항목(7번 에스크로 릴리즈, 8번 정산 등)이 원장 기록 시 반드시 이 함수를 통해서만 쓴다 */
export async function insertFsLedger(env, l1Base, guid, entry) {
  return appendLedgerEntry(env, l1Base, guid, entry);
}

// ── 정정 전표 ────────────────────────────────────────────────
export async function handleLedgerCorrection(request, env) {
  const { original_tx_id, correct_fields, reason, requested_by } = await request.json();
  if (!reason?.trim()) return jsonResponse({ ok: false, reason: 'REASON_REQUIRED' }, 400);

  const { l1Base, record: original } = await findFsLedgerByTxId(env, original_tx_id);
  if (!original) return jsonResponse({ ok: false, reason: 'NOT_FOUND' }, 404);

  const isOwner = original.guid === requested_by;
  const diffRatio = Math.abs((correct_fields.amount ?? original.amount) - original.amount) / (original.amount || 1);
  const threshold = Number((await env.CONFIG_KV?.get('ledger_correction_auto_threshold')) || 0.05);
  const autoApprove = isOwner && diffRatio < threshold;

  // 1) 상쇄 전표
  const reversal = await insertFsLedger(env, l1Base, original.guid, {
    tx_id: crypto.randomUUID(),
    counterpart: original.counterpart,
    direction: original.direction === 'credit' ? 'debit' : 'credit',
    amount: original.amount,
    item_name: original.item_name,
    fs_account: original.fs_account + '_reversal',
    memo: `정정 상쇄: ${reason}`,
    tx_at: new Date().toISOString(),
  });

  // 2) 신규 전표 (자동승인일 때만 즉시)
  let correction = null;
  if (autoApprove) {
    correction = await insertFsLedger(env, l1Base, original.guid, {
      tx_id: crypto.randomUUID(),
      counterpart: original.counterpart,
      ...correct_fields,
      memo: `정정: ${reason}`,
      tx_at: new Date().toISOString(),
    });
  }

  await pbFetch(env, l1Base, '/api/collections/fs_ledger_corrections/records', {
    method: 'POST',
    body: {
      original_tx_id,
      reversal_tx_id: reversal.record?.tx_id,
      correction_tx_id: correction?.record?.tx_id || null,
      reason,
      requested_by,
      approved_by: autoApprove ? 'auto' : null,
      created_at: new Date().toISOString(),
    },
  });

  if (!autoApprove) {
    await flagOpsAlert(env, `ledger-correction-review:${crypto.randomUUID()}`, {
      original_tx_id, reason, requested_by, diffRatio,
    });
  }

  return jsonResponse({ ok: true, status: autoApprove ? 'applied' : 'pending_review' });
}

// ── 자가 검증 ────────────────────────────────────────────────
export async function handleLedgerVerify(request, env) {
  const guid = new URL(request.url).searchParams.get('guid');
  if (!guid) return jsonResponse({ ok: false, reason: 'MISSING_GUID' }, 400);

  const { l1Base } = await resolveGuidToL1(env, guid);
  const result = await verifyGuidChain(env, l1Base, guid);
  return jsonResponse(result);
}

export async function verifyGuidChain(env, l1Base, guid) {
  const filter = buildFilter([['guid', '=', guid]]);
  const qs = new URLSearchParams({ perPage: '5000', sort: 'seq', ...(filter ? { filter } : {}) });
  const res = await pbFetch(env, l1Base, `/api/collections/fs_ledger/records?${qs}`);
  const data = await res.json();
  const items = data.items || [];

  let expectedPrev = 'GENESIS';
  for (const row of items) {
    if (row.prev_entry_hash !== expectedPrev) {
      return { ok: true, valid: false, broken_at_seq: row.seq, reason: 'CHAIN_BREAK' };
    }
    const recomputed = await recomputeEntryHash(row);
    if (recomputed !== row.entry_hash) {
      return { ok: true, valid: false, broken_at_seq: row.seq, reason: 'HASH_MISMATCH' };
    }
    expectedPrev = row.entry_hash;
  }
  return { ok: true, valid: true, entries: items.length };
}

async function recomputeEntryHash(row) {
  const canonical = JSON.stringify({
    guid: row.guid,
    seq: row.seq,
    prevHash: row.prev_entry_hash,
    tx_id: row.tx_id,
    direction: row.direction,
    amount: row.amount,
    fs_account: row.fs_account,
    tx_at: row.tx_at,
  });
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── 앵커링 (매시간 크론) ────────────────────────────────────────
export async function scheduledLedgerAnchoring(env) {
  for (const [l1Node, meta] of await listActiveL1Nodes(env)) {
    const filter = buildFilter([['anchored', '=', false]]);
    const qs = new URLSearchParams({ perPage: '500', sort: 'guid,seq', filter });
    const res = await pbFetch(env, meta.base_url, `/api/collections/fs_ledger/records?${qs}`);
    const { items = [] } = await res.json();
    if (!items.length) continue;

    const latestPerGuid = latestByGuid(items);
    const leaves = latestPerGuid.map((r) => r.entry_hash);
    const merkleRoot = await computeMerkleRoot(leaves);

    // 상위 OpenHash 레이어 anchor() 호출 — 이 Worker 배포 환경에서는
    // src/openhash/hashChain.js를 gopang-wallet.js와 동일하게 재사용한다고 가정.
    // (실제 경로는 배포 시 별도 확인 필요 — 여기서는 인터페이스만 고정)
    let anchorResult = { entryHash: merkleRoot };
    try {
      const { anchor } = await import('../openhash/hashChain.js');
      anchorResult = await anchor(merkleRoot, [], `ledger-batch-${l1Node}-${Date.now()}`);
    } catch (e) {
      console.warn('[LedgerAnchor] anchor() 미탑재 — 로컬 앵커로 폴백:', e.message);
    }

    const batchId = crypto.randomUUID();
    await pbFetch(env, meta.base_url, '/api/collections/fs_ledger_anchor_flags/records', {
      // 참고: 실제로는 items 개수만큼 개별 flag 레코드를 만들거나,
      // batch 단위 레코드 하나에 leaf 목록을 JSON으로 묶는 두 방식 모두 가능.
      // 여기서는 배치 단위 1레코드로 단순화.
      method: 'POST',
      body: {
        batch_id: batchId,
        l1_node: l1Node,
        merkle_root: merkleRoot,
        anchor_entry_hash: anchorResult.entryHash,
        leaf_count: leaves.length,
        leaf_entry_hashes: leaves,
        anchored_at: new Date().toISOString(),
      },
    });
  }
}

function latestByGuid(items) {
  const map = new Map();
  for (const r of items) {
    const prev = map.get(r.guid);
    if (!prev || r.seq > prev.seq) map.set(r.guid, r);
  }
  return [...map.values()];
}

async function computeMerkleRoot(leaves) {
  if (!leaves.length) return null;
  let level = leaves;
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const pair = level[i] + (level[i + 1] || level[i]);
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pair));
      next.push(Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join(''));
    }
    level = next;
  }
  return level[0];
}

// ── 전수 무결성 감사 (매일 크론) ─────────────────────────────────
export async function scheduledLedgerIntegrityAudit(env) {
  for (const [l1Node, meta] of await listActiveL1Nodes(env)) {
    const guids = await listSellerGuidsInNode(env, meta.base_url);
    for (const guid of guids) {
      const result = await verifyGuidChain(env, meta.base_url, guid);
      if (!result.valid) {
        await flagOpsAlert(env, `ledger-integrity-breach:${l1Node}:${guid}`, { l1Node, guid, ...result });
        await notifyOwner(env, meta.base_url, guid, {
          eventType: 'ledger_integrity',
          severity: 'critical',
          payload: { msg: '재무제표 무결성 검증에 실패했습니다. 운영팀이 확인 중입니다.' },
        });
      }
    }
  }
}

async function listSellerGuidsInNode(env, l1Base) {
  const res = await pbFetch(env, l1Base, '/api/collections/profiles/records?perPage=1000&filter=' + encodeURIComponent("entity_type='business'"));
  const data = await res.json();
  return (data.items || []).map((r) => r.guid);
}

async function findFsLedgerByTxId(env, txId) {
  for (const [, meta] of await listActiveL1Nodes(env)) {
    const filter = buildFilter([['tx_id', '=', txId]]);
    const res = await pbFetch(env, meta.base_url, `/api/collections/fs_ledger/records?${new URLSearchParams({ filter, perPage: '1' })}`);
    const data = await res.json();
    if (data.items?.length) return { l1Base: meta.base_url, record: data.items[0] };
  }
  return { l1Base: null, record: null };
}

async function resolveGuidToL1(env, guid) {
  for (const [l1Node, meta] of await listActiveL1Nodes(env)) {
    const filter = buildFilter([['guid', '=', guid]]);
    const res = await pbFetch(env, meta.base_url, `/api/collections/profiles/records?${new URLSearchParams({ filter, perPage: '1' })}`);
    const data = await res.json();
    if (data.items?.length) return { l1Node, l1Base: meta.base_url };
  }
  throw new Error('GUID_NOT_FOUND_IN_ANY_L1');
}

export { resolveGuidToL1, findFsLedgerByTxId };
