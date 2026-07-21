/**
 * EscrowSigner Durable Object (id = l1_node)
 *
 * gopang-escrow는 모든 거래가 공유하는 단일 UTXO 계정이므로, 두 릴리즈가
 * 동시에 일어나면 prev_settle_hash 경합으로 하나는 반드시 409가 난다.
 * DO가 동일 id(l1_node) 요청을 자동 직렬화해 이 경합을 코드 락 없이 해결한다.
 */

import { pbFetch } from '../lib/pb-admin.js';
import { buildFilter } from '../lib/pb-filter.js';
import { insertFsLedger } from '../routes/ledger.js';
// [2026-07 통합] 3행 원장(Σδ=0) 검증은 자체 구현하지 않고, 클라이언트(GDC 송금)와
// 동일한 정본 src/openhash/bivm.js를 그대로 재사용한다(통합 원칙: 같은 검증 로직을
// 두 곳에 두지 않는다). 경로: services/gopang-worker/src/do/ → 저장소 루트 src/openhash/
import { verify as bivmVerify } from '../../../../src/openhash/bivm.js';

async function sha256Hex(input) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function sortedStringify(obj) {
  const sorter = (o) =>
    Array.isArray(o)
      ? o.map(sorter)
      : o && typeof o === 'object'
      ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sorter(o[k])]))
      : o;
  return JSON.stringify(sorter(obj));
}

export class EscrowSigner {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const { holdId, l1Base, action } = await request.json(); // action: 'release_full' | 'refund_full'

    const hold = await this._loadHold(l1Base, holdId);
    if (!hold) return this._json({ ok: false, reason: 'HOLD_NOT_FOUND' }, 404);
    if (hold.status !== 'held' && hold.status !== 'disputed') {
      return this._json({ ok: false, reason: 'ALREADY_SETTLED' });
    }

    const chainState = await this._loadEscrowChainState(l1Base);

    const outputs =
      action === 'release_full'
        ? [
            { recipient_guid: hold.seller_guid, amount: hold.seller_net },
            { recipient_guid: 'gopang-platform', amount: hold.platform_fee },
          ]
        : [{ recipient_guid: hold.buyer_guid, amount: hold.total }];

    const tx = {
      version: 1,
      input: {
        owner_guid: 'gopang-escrow',
        prev_settle_hash: chainState.block_hash || null,
        balance_claimed: null,
      },
      outputs,
      items: hold.items || [],
      nonce: crypto.randomUUID(),
      timestamp: Math.floor(Date.now() / 1000),
      ref_tx_id: hold.tx_id,
    };

    const txHash = await sha256Hex(sortedStringify(tx));
    const escrowSig = await this._signWithEscrowKey(txHash);

    // [2026-07-21 수정] 사고실험 시나리오1에서 실제 재현된 이중 기장 문제 —
    // main.pb.js의 /api/tx 핸들러는 모든 tx에 대해 자동으로 buyerClaim/
    // sellerClaim을 계산해 ledger_entries에 기록한다. EscrowSigner는 이 tx가
    // 이미 자기만의 정확한 3행(buyer/seller/platform)을 별도로 기록할
    // 것이므로, main.pb.js 쪽 자동 기장은 반드시 건너뛰어야 한다 —
    // 그렇지 않으면 판매자 크레딧이 두 번(pl-revenue + revenue) 잡히고,
    // 구매자 쪽은 실제 구매자가 아니라 'gopang-escrow' 시스템 계정으로
    // 잘못 기록된다(실제로 확인됨).
    const l1Res = await fetch(`${l1Base}/api/tx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tx, tx_hash: txHash, buyer_sig: escrowSig,
        buyer_public_key: this.env.ESCROW_PUBLIC_KEY,
        skip_ledger: true,
      }),
    });
    const l1Data = await l1Res.json();
    if (!l1Res.ok) {
      return this._json({ ok: false, reason: l1Data.error || 'L1_REJECTED' }, l1Res.status);
    }

    await this._saveEscrowChainState(l1Base, l1Data.block_hash);
    const newStatus = action === 'release_full' ? 'released' : 'refunded';
    await this._updateHoldStatus(l1Base, holdId, newStatus, l1Data.block_hash);

    // 정상 릴리즈 시에만 재무제표 원장 기록 (9번 append-only 원장 재사용)
    //
    // [수정] 이전 구현은 seller 쪽 revenue 1행만 기록해, 11번(fraud.js buildTxGraph)이
    // buyer→seller 자금흐름 그래프를 그릴 때 buyer 쪽 엣지가 없어 순환거래를 탐지할
    // 수 없었다. 백서 8.3의 3행 구조(구매자 debit / 판매자 credit / 플랫폼 fee)를 실제로
    // 채운다. 환불(refund_full)은 애초에 revenue가 인식된 적이 없으므로(에스크로에서
    // 곧바로 구매자에게 되돌아감) 원장 기록 대상이 아니다 — 순자산 변동이 없다.
    if (action === 'release_full') {
      const ledgerEntries = [
        {
          guid: hold.buyer_guid,
          entry: {
            tx_id: l1Data.block_hash + ':buyer',
            counterpart: hold.seller_guid,
            direction: 'debit',
            amount: hold.total,
            item_name: hold.items?.[0]?.name || '',
            fs_account: 'purchase',
            payment_rail: 'gdc',
            memo: `K-Market 구매 확정 (tx:${hold.tx_id})`,
            tx_at: new Date().toISOString(),
          },
        },
        {
          guid: hold.seller_guid,
          entry: {
            tx_id: l1Data.block_hash + ':seller',
            counterpart: hold.buyer_guid,
            direction: 'credit',
            amount: hold.seller_net,
            item_name: hold.items?.[0]?.name || '',
            fs_account: 'revenue',
            payment_rail: 'gdc',
            memo: `K-Market 에스크로 릴리즈 (tx:${hold.tx_id})`,
            tx_at: new Date().toISOString(),
          },
        },
        {
          guid: 'gopang-platform',
          entry: {
            tx_id: l1Data.block_hash + ':platform',
            counterpart: hold.seller_guid,
            direction: 'credit',
            amount: hold.platform_fee,
            item_name: '',
            fs_account: 'platform_fee',
            payment_rail: 'gdc',
            memo: `K-Market 수수료 (tx:${hold.tx_id})`,
            tx_at: new Date().toISOString(),
          },
        },
      ];

      // [2026-07 통합] 원장 3행을 쓰기 전에 정본 bivm.js로 Σδ=0(집합 잔액 불변성)을
      // 먼저 검증한다. 서버는 잔액 재구성을 L1 tx에 전담시키므로 balanceBefore/After는
      // 0으로 고정(Σδ=0 검증 자체는 delta 합만 보므로 영향 없음 — bivm.js의
      // verifySetInvariant는 delta만 사용, verifyBMI는 balanceBefore+delta=After만
      // 확인하므로 0/0/0으로는 항상 통과함에 유의 — 즉 이 호출은 현재 Σδ=0 검증만
      // 실질적으로 의미 있고, per-tx BMI 산술 검증은 L1이 반환하는 실제 잔액을
      // 채워 넣어야 완전해진다. gopang-worker 병합 후속 작업으로 남겨둔다).
      const bivmTxs = ledgerEntries.map(({ guid, entry }) => ({
        id: entry.tx_id,
        from: hold.buyer_guid, to: hold.seller_guid,
        amount: entry.amount,
        delta: entry.direction === 'debit' ? -entry.amount : entry.amount,
        balanceBefore: 0, balanceAfter: 0,
      }));
      const bivmResult = bivmVerify(bivmTxs);
      if (!bivmResult.setValid) {
        // Σδ≠0 — 3행 구성 자체에 산술 오류가 있다는 뜻이므로, 원장 쓰기 전에
        // 최우선 순위로 플래그한다(원장 쓰기 성공 여부와 무관하게 별도 알림).
        const { flagOpsAlert } = await import('../lib/ops-alerts.js');
        await flagOpsAlert(this.env, `bivm-set-violation:${hold.tx_id}`, {
          holdId: hold.id, txId: hold.tx_id, errors: bivmResult.errors,
        });
      }

      // [수정] L1 tx(자금이동)는 이미 성공적으로 확정된 뒤이므로, 원장 기록 실패는
      // "돈이 잘못 이동한 것"이 아니라 "회계 장부가 실제 자금이동을 못 따라간 것"이다.
      // 실패해도 릴리즈 자체를 되돌리지 않되(자금은 이미 정상 이동했으므로), 반드시
      // 사람이 확인해 정정 전표(9번 handleLedgerCorrection)로 보완할 수 있도록 플래그한다.
      const ledgerFailures = [];
      for (const { guid, entry } of ledgerEntries) {
        try {
          await insertFsLedger(this.env, l1Base, guid, entry);
        } catch (e) {
          ledgerFailures.push({ guid, entry, error: e.message });
        }
      }
      if (ledgerFailures.length) {
        const { flagOpsAlert } = await import('../lib/ops-alerts.js');
        await flagOpsAlert(this.env, `ledger-reconcile-gap:${hold.tx_id}`, {
          holdId: hold.id, txId: hold.tx_id, blockHash: l1Data.block_hash,
          reason: 'ESCROW_RELEASE_LEDGER_WRITE_PARTIAL_FAILURE',
          failures: ledgerFailures,
        });
      }
    }

    return this._json({ ok: true, block_hash: l1Data.block_hash });
  }

  _json(obj, status = 200) {
    return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
  }

  async _loadHold(l1Base, holdId) {
    const res = await pbFetch(this.env, l1Base, `/api/collections/escrow_holds/records/${holdId}`);
    return res.ok ? res.json() : null;
  }

  async _loadEscrowChainState(l1Base) {
    const filter = buildFilter([['guid', '=', 'gopang-escrow']]);
    const res = await pbFetch(this.env, l1Base, `/api/collections/escrow_chain_state/records?${new URLSearchParams({ filter, perPage: '1' })}`);
    const data = await res.json();
    return data.items?.[0] || { block_hash: null };
  }

  async _saveEscrowChainState(l1Base, blockHash) {
    const filter = buildFilter([['guid', '=', 'gopang-escrow']]);
    const res = await pbFetch(this.env, l1Base, `/api/collections/escrow_chain_state/records?${new URLSearchParams({ filter, perPage: '1' })}`);
    const data = await res.json();
    const existing = data.items?.[0];
    const body = { guid: 'gopang-escrow', block_hash: blockHash, updated_at: new Date().toISOString() };
    if (existing) {
      await pbFetch(this.env, l1Base, `/api/collections/escrow_chain_state/records/${existing.id}`, { method: 'PATCH', body });
    } else {
      await pbFetch(this.env, l1Base, '/api/collections/escrow_chain_state/records', { method: 'POST', body });
    }
  }

  async _updateHoldStatus(l1Base, holdId, status, releaseTxHash) {
    await pbFetch(this.env, l1Base, `/api/collections/escrow_holds/records/${holdId}`, {
      method: 'PATCH',
      body: { status, released_at: new Date().toISOString(), release_tx_hash: releaseTxHash },
    });
  }

  async _signWithEscrowKey(txHash) {
    // ESCROW_PRIVATE_KEY: Worker secret, PKCS8 형식 Ed25519 개인키(base64)
    // 파일럿 단계는 Worker Secret, 자금규모 임계치 도달 시 KMS 위임 서명으로 전환 예정(설계 문서 4절 참조)
    const raw = base64ToBuf(this.env.ESCROW_PRIVATE_KEY);
    const key = await crypto.subtle.importKey('pkcs8', raw, { name: 'Ed25519' }, false, ['sign']);
    const sigBuf = await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(txHash));
    return bufToB64u(sigBuf);
  }
}

function base64ToBuf(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}
function bufToB64u(buf) {
  let bin = '';
  new Uint8Array(buf).forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Worker 쪽 호출 헬퍼 */
export async function callEscrowSigner(env, l1Node, l1Base, holdId, action) {
  const id = env.ESCROW_SIGNER.idFromName(l1Node);
  const stub = env.ESCROW_SIGNER.get(id);
  const res = await stub.fetch('https://do/', {
    method: 'POST',
    body: JSON.stringify({ holdId, l1Base, action }),
  });
  return res.json();
}
