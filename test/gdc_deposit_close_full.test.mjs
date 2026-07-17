import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, sign } from 'node:crypto';
import { promisify } from 'node:util';

const genKeyPair = promisify(generateKeyPair);

function toB64u(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('handleGdcDepositClose — 전체 흐름 (실제 Ed25519 서명 사용)', () => {
  let handleGdcDepositClose;
  let pubB64u, privateKey;
  let l1Profiles, l1Deposits, blockWrites;

  before(async () => {
    // 실제 Ed25519 키쌍 생성 — Node 내장(worker.js의 crypto.subtle과 동일 알고리즘)
    const { publicKey, privateKey: priv } = await genKeyPair('ed25519');
    privateKey = priv;
    const rawPub = publicKey.export({ type: 'spki', format: 'der' });
    // SPKI DER의 마지막 32바이트가 raw Ed25519 공개키(worker.js가 'raw'로 import하는 형식과 일치)
    pubB64u = toB64u(rawPub.subarray(rawPub.length - 32));

    l1Profiles = { 'u1': { guid: 'u1', pubkey_ed25519: pubB64u } };
    l1Deposits = {
      'dep-active-1': { id: 'dep-active-1', user_guid: 'u1', principal: 5000, status: 'active' },
      'dep-closed-1': { id: 'dep-closed-1', user_guid: 'u1', principal: 3000, status: 'closed' },
    };
    blockWrites = [];

    global.fetch = async (url, opts) => {
      const u = String(url);
      const method = opts?.method || 'GET';
      const body = opts?.body ? JSON.parse(opts.body) : null;

      if (u.endsWith('/api/admins/auth-with-password')) {
        return { ok: true, json: async () => ({ token: 'fake-admin-token' }) };
      }
      if (u.includes('/api/collections/profiles/records')) {
        const guid = decodeURIComponent(u).match(/guid='([^']+)'/)?.[1] || '';
        const rec = l1Profiles[guid];
        return { ok: true, json: async () => ({ items: rec ? [rec] : [] }) };
      }
      if (u.includes('/api/collections/gdc_deposits/records/') && method === 'GET') {
        const id = decodeURIComponent(u.split('/').pop());
        const rec = l1Deposits[id];
        if (!rec) return { ok: false, status: 404, json: async () => ({}) };
        return { ok: true, json: async () => rec };
      }
      if (u.includes('/api/collections/gdc_deposits/records/') && method === 'PATCH') {
        const id = decodeURIComponent(u.split('/').pop());
        Object.assign(l1Deposits[id], body);
        return { ok: true, json: async () => l1Deposits[id], text: async () => 'ok' };
      }
      if (u.includes('/api/collections/blocks/records') && method === 'POST') {
        blockWrites.push(body);
        return { ok: true, json: async () => ({ id: 'block-return-' + blockWrites.length }) };
      }
      throw new Error('예상치 못한 fetch: ' + method + ' ' + u);
    };

    ({ handleGdcDepositClose } = await import('../worker.js?full=' + Date.now()));
  });

  async function signedRequest(depositId) {
    const ts = String(Date.now());
    const sigMsg = `gdc-deposit-close:u1:${pubB64u}:${ts}`;
    const sigBuf = sign(null, Buffer.from(sigMsg), privateKey); // Ed25519: algorithm=null
    return new Request('https://x/biz/gdc-deposit-close', {
      method: 'POST',
      body: JSON.stringify({ user_guid: 'u1', deposit_id: depositId, pubkey: pubB64u, signature: toB64u(sigBuf), ts }),
    });
  }

  const env = { L1_ADMIN_EMAIL: 'a', L1_ADMIN_PASSWORD: 'b' };

  test('정상 서명 + 활성 예치금 → 인출 성공, 반환 블록이 vault→user 방향', async () => {
    const res = await handleGdcDepositClose(await signedRequest('dep-active-1'), env, {});
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.amount, 5000);

    const written = blockWrites.at(-1);
    assert.equal(written.buyer_guid, 'gdc-deposit-vault');
    assert.equal(written.seller_guid, 'u1');
    const outputs = JSON.parse(written.outputs);
    assert.equal(outputs[0].recipient_guid, 'u1');
    assert.equal(outputs[0].amount, 5000);
  });

  test('인출 후 gdc_deposits.status가 closed로 갱신된다', async () => {
    assert.equal(l1Deposits['dep-active-1'].status, 'closed');
  });

  test('이미 closed인 예치금은 재인출 거부(409) — 이중 인출 방지', async () => {
    const res = await handleGdcDepositClose(await signedRequest('dep-closed-1'), env, {});
    const data = await res.json();
    assert.equal(res.status, 409);
    assert.equal(data.error, 'ALREADY_CLOSED');
  });

  test('같은 활성 예치금을 두 번 연속 인출 시도하면 두 번째는 이미 closed라 거부된다', async () => {
    // 새 활성 예치금 하나 더 준비
    l1Deposits['dep-active-2'] = { id: 'dep-active-2', user_guid: 'u1', principal: 1000, status: 'active' };
    const first  = await handleGdcDepositClose(await signedRequest('dep-active-2'), env, {});
    assert.equal(first.status, 200);
    const second = await handleGdcDepositClose(await signedRequest('dep-active-2'), env, {});
    const data2 = await second.json();
    assert.equal(second.status, 409);
    assert.equal(data2.error, 'ALREADY_CLOSED');
    // blocks에는 반환 블록이 정확히 1번만 생성됐어야 함(중복 지급 방지 핵심 검증)
    const returnsForDep2 = blockWrites.filter(b => JSON.parse(b.outputs)[0].deposit_id === undefined && b.seller_guid === 'u1');
    // deposit_id가 outputs 안에 있으므로 직접 필터링
    const matching = blockWrites.filter(b => JSON.parse(b.outputs)[0].amount === 1000);
    assert.equal(matching.length, 1, '같은 예치금에 대해 반환 블록이 정확히 1개만 생성되어야 함');
  });

  test('존재하지 않는 예치금 ID는 404', async () => {
    const res = await handleGdcDepositClose(await signedRequest('no-such-id'), env, {});
    assert.equal(res.status, 404);
  });
});
