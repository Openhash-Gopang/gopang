import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, sign } from 'node:crypto';
import { promisify } from 'node:util';

const genKeyPair = promisify(generateKeyPair);
function toB64u(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('GDC DAO — 제안·투표 (실제 Ed25519 서명, 서버 잔액 재검증)', () => {
  let handleGdcDaoProposalCreate, handleGdcDaoVote, handleGdcDaoProposalsList;
  let pubB64u, privateKey;
  let l1Profiles, l1Proposals, l1Votes;
  const env = { L1_ADMIN_EMAIL: 'a', L1_ADMIN_PASSWORD: 'b' };

  before(async () => {
    const { publicKey, privateKey: priv } = await genKeyPair('ed25519');
    privateKey = priv;
    const rawPub = publicKey.export({ type: 'spki', format: 'der' });
    pubB64u = toB64u(rawPub.subarray(rawPub.length - 32));

    l1Profiles = { u1: { guid: 'u1', pubkey_ed25519: pubB64u } };
    l1Proposals = []; // { id, proposal_id, title, proposer_guid, params_json, expires_at }
    l1Votes = [];     // { proposal_id, user_guid, choice, stake_gdc }
    let balances = { u1: 1500, poor: 500 }; // poor는 최소 스테이킹 미달

    global.__setBalance = (guid, amt) => { balances[guid] = amt; };

    global.fetch = async (url, opts) => {
      const u = String(url);
      const method = opts?.method || 'GET';
      const body = opts?.body ? JSON.parse(opts.body) : null;

      if (u.endsWith('/api/admins/auth-with-password')) return { ok: true, json: async () => ({ token: 't' }) };

      if (u.includes('/api/collections/profiles/records')) {
        const guid = decodeURIComponent(u).match(/guid='([^']+)'/)?.[1] || '';
        const rec = l1Profiles[guid];
        return { ok: true, json: async () => ({ items: rec ? [rec] : [] }) };
      }

      if (u.startsWith('https://l1-hanlim.hondi.net/api/balance')) {
        const guid = new URL(u).searchParams.get('guid');
        return { ok: true, json: async () => ({ ok: true, balance: balances[guid] ?? 0 }) };
      }

      if (u.includes('/api/collections/gdc_dao_proposals/records') && method === 'POST') {
        const row = { id: 'prop-row-' + (l1Proposals.length + 1), ...body };
        l1Proposals.push(row);
        return { ok: true, json: async () => row };
      }
      if (u.includes('/api/collections/gdc_dao_proposals/records') && method === 'GET') {
        const m = decodeURIComponent(u).match(/proposal_id='([^']+)'/);
        const items = m ? l1Proposals.filter(p => p.proposal_id === m[1]) : l1Proposals;
        return { ok: true, json: async () => ({ items }) };
      }

      if (u.includes('/api/collections/gdc_dao_votes/records') && method === 'POST') {
        l1Votes.push(body);
        return { ok: true, json: async () => ({ id: 'vote-row-' + l1Votes.length, ...body }) };
      }
      if (u.includes('/api/collections/gdc_dao_votes/records') && method === 'GET') {
        const dec = decodeURIComponent(u);
        const pidM = dec.match(/proposal_id='([^']+)'/);
        const uidM = dec.match(/user_guid='([^']+)'/);
        let items = l1Votes.filter(v => !pidM || v.proposal_id === pidM[1]);
        if (uidM) items = items.filter(v => v.user_guid === uidM[1]);
        return { ok: true, json: async () => ({ items }) };
      }

      throw new Error('예상치 못한 fetch: ' + method + ' ' + u);
    };

    ({ handleGdcDaoProposalCreate, handleGdcDaoVote, handleGdcDaoProposalsList } =
      await import('../worker.js?dao=' + Date.now()));
  });

  async function signedReq(path, payloadWithoutSig, sigMsgBuilder) {
    const ts = String(Date.now());
    const sigMsg = sigMsgBuilder(ts);
    const sigBuf = sign(null, Buffer.from(sigMsg), privateKey);
    return new Request('https://x' + path, {
      method: 'POST',
      body: JSON.stringify({ ...payloadWithoutSig, pubkey: pubB64u, signature: toB64u(sigBuf), ts }),
    });
  }

  let createdProposalId;

  test('제안 생성 — OWNERSHIP_TRANSFER는 즉시 거부(DAWN 원칙)', async () => {
    const req = await signedReq('/biz/gdc-dao/proposal',
      { proposer_guid: 'u1', title: 't', params: { type: 'OWNERSHIP_TRANSFER' } },
      ts => `gdc-dao-proposal:u1:${pubB64u}:${ts}`);
    const res = await handleGdcDaoProposalCreate(req, env, {});
    assert.equal(res.status, 403);
  });

  test('정상 제안 생성 성공', async () => {
    const req = await signedReq('/biz/gdc-dao/proposal',
      { proposer_guid: 'u1', title: '수수료율 조정', params: { rate: 0.025 } },
      ts => `gdc-dao-proposal:u1:${pubB64u}:${ts}`);
    const res = await handleGdcDaoProposalCreate(req, env, {});
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.ok, true);
    createdProposalId = data.proposal.proposalId;
    assert.ok(createdProposalId);
  });

  test('스테이킹 부족(500 < 1000)이면 투표 거부 — 서버가 실제 잔액을 재조회해 판단', async () => {
    // "poor" 계정은 서명 검증을 위해 프로필도 등록해야 하므로 별도 키로 테스트하지 않고,
    // 대신 u1의 잔액을 일시적으로 낮춰 같은 서명 경로로 검증한다.
    global.__setBalance('u1', 500);
    const req = await signedReq('/biz/gdc-dao/vote',
      { proposal_id: createdProposalId, user_guid: 'u1', choice: 'yes' },
      ts => `gdc-dao-vote:u1:${createdProposalId}:${pubB64u}:${ts}`);
    const res = await handleGdcDaoVote(req, env, {});
    const data = await res.json();
    assert.equal(res.status, 403);
    assert.equal(data.error, 'INSUFFICIENT_STAKE');
    global.__setBalance('u1', 1500); // 원복
  });

  test('클라이언트가 stake_gdc를 조작해서 보내도 무시되고 서버 실제 잔액(1500)이 쓰인다', async () => {
    const ts = String(Date.now());
    const sigMsg = `gdc-dao-vote:u1:${createdProposalId}:${pubB64u}:${ts}`;
    const sigBuf = sign(null, Buffer.from(sigMsg), privateKey);
    // 악의적으로 stake_gdc: 9999999를 페이로드에 끼워 넣어도 서버는 이 필드를 아예 읽지 않는다.
    const req = new Request('https://x/biz/gdc-dao/vote', {
      method: 'POST',
      body: JSON.stringify({
        proposal_id: createdProposalId, user_guid: 'u1', choice: 'yes',
        stake_gdc: 9999999, pubkey: pubB64u, signature: toB64u(sigBuf), ts,
      }),
    });
    const res = await handleGdcDaoVote(req, env, {});
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.stake_gdc, 1500, '클라이언트가 보낸 조작값(9999999)이 아니라 서버가 재조회한 실제 잔액(1500)이어야 함');
  });

  test('같은 사용자가 같은 제안에 재투표하면 거부(409)', async () => {
    const req = await signedReq('/biz/gdc-dao/vote',
      { proposal_id: createdProposalId, user_guid: 'u1', choice: 'no' },
      ts => `gdc-dao-vote:u1:${createdProposalId}:${pubB64u}:${ts}`);
    const res = await handleGdcDaoVote(req, env, {});
    const data = await res.json();
    assert.equal(res.status, 409);
    assert.equal(data.error, 'ALREADY_VOTED');
  });

  test('목록 조회 시 실시간 집계된 투표수와 상태(ACTIVE)가 반환된다', async () => {
    const res = await handleGdcDaoProposalsList(new Request(`https://x/biz/gdc-dao/proposals?proposal_id=${createdProposalId}`), env, {});
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].votes.yes, 1);
    assert.equal(data.items[0].status, 'ACTIVE');
  });

  test('만료된 제안에는 투표할 수 없다', async () => {
    // 이미 만료된 제안을 직접 주입
    const expiredId = 'prop_expired';
    l1Proposals.push({ id: 'x', proposal_id: expiredId, title: 't', proposer_guid: 'u1',
      params_json: '{}', expires_at: new Date(Date.now() - 1000).toISOString() });
    const req = await signedReq('/biz/gdc-dao/vote',
      { proposal_id: expiredId, user_guid: 'u1', choice: 'yes' },
      ts => `gdc-dao-vote:u1:${expiredId}:${pubB64u}:${ts}`);
    const res = await handleGdcDaoVote(req, env, {});
    const data = await res.json();
    assert.equal(res.status, 409);
    assert.equal(data.error, 'PROPOSAL_EXPIRED');
  });
});
