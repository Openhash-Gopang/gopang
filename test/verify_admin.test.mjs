import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

let requests = [];

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
    throw new Error('예상치 못한 fetch: ' + method + ' ' + u);
  };
}

// _verifyClaimsRequester는 실제 Ed25519 검증 + L1 프로필 조회를 하므로,
// ins_claim.test.mjs/gdc_deposit_close.test.mjs와 동일한 원칙으로 이
// 단위 테스트는 인증 관문(서명 없이는 admin_guids 컬렉션을 절대
// 조회하지 않는가)에 집중한다.
describe('handleVerifyAdmin — 입력 검증 / 인증 관문', () => {
  let handleVerifyAdmin;
  before(async () => {
    installFetchMock();
    ({ handleVerifyAdmin } = await import('../worker.js'));
  });

  const env = { L1_ADMIN_EMAIL: 'admin@test', L1_ADMIN_PASSWORD: 'pw' };
  const cors = {};

  test('guid 없으면 400', async () => {
    const req = new Request('https://x/biz/verify-admin?service=tax');
    const res = await handleVerifyAdmin(req, env, cors);
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.equal(data.error, 'MISSING_FIELD');
  });

  test('서명 없이 조회하면 인증 실패로 막힌다 — 남의 guid로 admin 여부 알아내기 방지', async () => {
    const req = new Request('https://x/biz/verify-admin?guid=u1&service=tax&pubkey=pk&ts=' + Date.now());
    const res = await handleVerifyAdmin(req, env, cors);
    const data = await res.json();
    assert.equal(res.status, 403);
    assert.equal(data.error, 'AUTH_REQUIRED');
    // 인증에서 막혔으므로 admin_guids 컬렉션에 절대 조회가 일어나지 않아야 함
    assert.equal(requests.some(r => r.url.includes('/collections/admin_guids/records')), false);
  });

  test('signature 필드 자체가 없으면 403', async () => {
    const req = new Request('https://x/biz/verify-admin?guid=u1&service=tax&pubkey=pk&ts=' + Date.now());
    const res = await handleVerifyAdmin(req, env, cors);
    assert.equal(res.status, 403);
  });

  test('만료된 ts면 403', async () => {
    const oldTs = Date.now() - 1000 * 60 * 60;
    const req = new Request(`https://x/biz/verify-admin?guid=u1&service=tax&pubkey=pk&signature=sig&ts=${oldTs}`);
    const res = await handleVerifyAdmin(req, env, cors);
    assert.equal(res.status, 403);
  });
});
