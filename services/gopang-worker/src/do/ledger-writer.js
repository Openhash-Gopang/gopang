/**
 * LedgerWriter Durable Object (id = guid)
 *
 * fs_ledger는 append-only 해시체인이므로, 동일 사업자(guid)의 레코드가
 * 동시에 여러 개 들어오면 seq/prev_entry_hash 경합이 생긴다.
 * DO는 동일 id에 대한 요청을 자동 직렬화하므로, 사업자 단위로 DO를 하나씩
 * 두면 코드 레벨 락 없이 순서를 보장할 수 있다.
 *
 * 실제 INSERT 자체는 PocketBase 훅(pb_hooks/fs_ledger.pb.js)이
 * seq/entry_hash를 계산하지만, "같은 guid로 동시에 두 요청이 훅에
 * 동시 진입하는 경합"은 훅만으로는 못 막으므로 DO가 그 앞단 게이트 역할을 한다.
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
    const res = await pbFetch(this.env, l1Base, '/api/collections/fs_ledger/records', {
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
