import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

const L1_DEFAULT = 'https://l1-hanlim.hondi.net';
let requests = [];
let l1State = {}; // simple fake DB: { [deposit_id]: {...record} }

function installFetchMock() {
  requests = [];
  global.fetch = async (url, opts) => {
    const u = String(url);
    const method = opts?.method || 'GET';
    const body = opts?.body ? JSON.parse(opts.body) : null;
    requests.push({ url: u, method, body });

    if (u.endsWith('/api/admins/auth-with-password')) {
      return { ok: true, json: async () => ({ token: 'fake-admin-token' }) };
    }
    if (u.includes('/api/collections/gdc_deposits/records/') && method === 'GET') {
      const id = decodeURIComponent(u.split('/').pop());
      const rec = l1State[id];
      if (!rec) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, json: async () => rec };
    }
    if (u.includes('/api/collections/gdc_deposits/records/') && method === 'PATCH') {
      const id = decodeURIComponent(u.split('/').pop());
      Object.assign(l1State[id], body);
      return { ok: true, json: async () => l1State[id], text: async () => 'ok' };
    }
    if (u.includes('/api/collections/blocks/records') && method === 'POST') {
      return { ok: true, json: async () => ({ id: 'block-return-1' }) };
    }
    throw new Error('예상치 못한 fetch: ' + method + ' ' + u);
  };
}

// _verifyClaimsRequester는 실제 Ed25519 검증 + L1 프로필 조회를 하므로,
// 이 단위 테스트에서는 서명 검증 자체가 아니라 handleGdcDepositClose의
// 로직(소유자/상태 검사, 반환 블록 생성, PATCH)에 집중하기 위해
// _verifyEd25519Simple과 프로필 조회 관련 fetch를 우회 가능한 최소
// 입력을 준비하는 대신, worker.js가 내부에서 호출하는 실제 함수를
// 그대로 타게 두면 서명 검증에서 항상 실패한다 — 그래서 아래 테스트는
// "인증 실패 시 401/403으로 안전하게 막히는가"를 검증하는 것으로
// 범위를 좁힌다(실제 서명 있는 통합 테스트는 라이브 L1 접근이 필요해
// 이 샌드박스에서 불가능 — network egress가 l1-hanlim.hondi.net을
// 허용하지 않음, README 참고).
describe('handleGdcDepositClose — 인증/입력 검증 (모킹 가능한 범위)', () => {
  let handleGdcDepositClose;
  before(async () => {
    installFetchMock();
    ({ handleGdcDepositClose } = await import('../worker.js'));
  });

  const env = { L1_ADMIN_EMAIL: 'admin@test', L1_ADMIN_PASSWORD: 'pw' };
  const cors = {};

  test('user_guid 없으면 400', async () => {
    const req = new Request('https://x/biz/gdc-deposit-close', {
      method: 'POST', body: JSON.stringify({ deposit_id: 'd1' }),
    });
    const res = await handleGdcDepositClose(req, env, cors);
    assert.equal(res.status, 400);
  });

  test('deposit_id 없으면 400', async () => {
    const req = new Request('https://x/biz/gdc-deposit-close', {
      method: 'POST', body: JSON.stringify({ user_guid: 'u1' }),
    });
    const res = await handleGdcDepositClose(req, env, cors);
    assert.equal(res.status, 400);
  });

  test('서명 없이(signature 누락) 요청하면 인증 실패로 막힌다 — 자금 이동 전 필수 관문', async () => {
    const req = new Request('https://x/biz/gdc-deposit-close', {
      method: 'POST',
      body: JSON.stringify({ user_guid: 'u1', deposit_id: 'd1', pubkey: 'pk', ts: String(Date.now()) }),
      // signature 필드 자체를 빼서 _verifyClaimsRequester가 즉시 false 반환하도록 함
    });
    const res = await handleGdcDepositClose(req, env, cors);
    const data = await res.json();
    assert.equal(res.status, 403);
    assert.equal(data.error, 'AUTH_REQUIRED');
    // 인증에서 막혔으므로 blocks 컬렉션에 절대 쓰기가 일어나지 않아야 함
    assert.equal(requests.some(r => r.url.includes('/collections/blocks/records') && r.method === 'POST'), false);
  });
});
