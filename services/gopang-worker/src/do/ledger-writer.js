/**
 * LedgerWriter Durable Object (id = guid)
 *
 * [2026-07 통합] ledger_entries는 hondi-proxy(pb_hooks/main.pb.js)가 이미
 * GDC 송금/발행/AI과금 시 쓰고 있던 "회계 부기" 컬렉션이다. gopang-worker가
 * 별도로 fs_ledger를 신설하려 했으나, 스키마가 사실상 같은 목적(guid,
 * direction, amount, fs_account, tx_id)이라 fs_ledger는 만들지 않고
 * ledger_entries에 해시체인 필드(entry_hash/prev_entry_hash/seq/anchored/
 * anchor_batch_id)와 gopang-worker 전용 필드(counterpart/item_name/
 * payment_rail/fee_rate_applied/memo/tx_at)를 추가하는 방식으로 통합했다.
 * 기존 hondi-proxy 필드(guid/direction/amount/fs_account/source/block_hash/
 * tx_id)는 이름·id 그대로 유지되어 하위호환 영향 없음.
 *
 * ledger_entries는 append-only 해시체인이므로, 동일 사업자(guid)의 레코드가
 * 동시에 여러 개 들어오면 seq/prev_entry_hash 경합이 생긴다.
 * DO는 동일 id에 대한 요청을 자동 직렬화하므로, 사업자 단위로 DO를 하나씩
 * 두면 코드 레벨 락 없이 순서를 보장할 수 있다.
 *
 * 실제 INSERT 자체는 PocketBase 훅(pb_hooks/fs_ledger.pb.js, 2026-07 통합 후
 * ledger_entries를 대상으로 동작)이 seq/entry_hash를 계산하지만, "같은
 * guid로 동시에 두 요청이 훅에 동시 진입하는 경합"은 훅만으로는 못 막으므로
 * DO가 그 앞단 게이트 역할을 한다.
 *
 * ⚠️ 미검증 사항: hondi-proxy의 pb_hooks/main.pb.js는 이 컬렉션에 쓸 때
 * $app.dao().saveRecord()(내부 DAO 직접 호출)를 쓰는데, 아래 fs_ledger.pb.js의
 * 해시체인 훅은 onRecordBeforeCreateRequest(HTTP 요청 훅)에 걸려있다. 이
 * PocketBase 버전에서 내부 dao().saveRecord() 호출도 요청 훅을 타는지
 * 실증 확인이 안 됐다 — 확인 전까지는 main.pb.js가 쓰는 레코드의
 * seq/entry_hash가 안 채워질 수 있음을 감안할 것.
 */

import { pbFetch } from '../lib/pb-admin.js';

export class LedgerWriter {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const { l1Base, entry } = await request.json();
    // DO 안에서는 요청이 이미 직렬화되어 있으므로 그대로 INSERT만 하면 됨
    const res = await pbFetch(this.env, l1Base, '/api/collections/ledger_entries/records', {
      method: 'POST',
      body: entry,
    });
    const data = await res.json();
    if (!res.ok) {
      return new Response(JSON.stringify({ ok: false, error: data }), {
        status: res.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true, record: data }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/** Worker 쪽에서 이 DO를 호출하는 헬퍼 */
export async function appendLedgerEntry(env, l1Base, guid, entry) {
  const id = env.LEDGER_WRITER.idFromName(guid);
  const stub = env.LEDGER_WRITER.get(id);
  const res = await stub.fetch('https://do/', {
    method: 'POST',
    body: JSON.stringify({ l1Base, entry: { ...entry, guid } }),
  });
  return res.json();
}
