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
    // 서명 인증이 항상 먼저 실패하도록 두는 테스트 범위이므로(아래 설명
    // 참고) ins_claims/profiles에 대한 fetch는 여기까지 도달하지 않는다 —
    // 그래도 안전망으로 막아둔다.
    throw new Error('예상치 못한 fetch: ' + method + ' ' + u);
  };
}

// _verifyClaimsRequester는 실제 Ed25519 검증 + L1 프로필 조회를 하므로,
// 이 단위 테스트에서는 서명 검증 자체가 아니라 handleInsClaimCreate/
// handleInsClaimsList의 입력 검증·인증 관문 로직에 집중한다(gdc_deposit_close
// .test.mjs와 동일한 원칙 — 실제 서명이 있는 통합 테스트는 라이브 L1 접근이
// 필요해 이 샌드박스에서 불가능).
describe('handleInsClaimCreate — 입력 검증 / 인증 관문', () => {
  let handleInsClaimCreate;
  before(async () => {
    installFetchMock();
    ({ handleInsClaimCreate } = await import('../worker.js'));
  });

  const env = { L1_ADMIN_EMAIL: 'admin@test', L1_ADMIN_PASSWORD: 'pw' };
  const cors = {};

  test('user_guid 없으면 400', async () => {
    const req = new Request('https://x/biz/ins-claim', {
      method: 'POST', body: JSON.stringify({ insurance_type: '자동차', amount: 1000 }),
    });
    const res = await handleInsClaimCreate(req, env, cors);
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.equal(data.error, 'MISSING_FIELD');
  });

  test('insurance_type 없으면 400', async () => {
    const req = new Request('https://x/biz/ins-claim', {
      method: 'POST', body: JSON.stringify({ user_guid: 'u1', amount: 1000 }),
    });
    const res = await handleInsClaimCreate(req, env, cors);
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.equal(data.error, 'MISSING_FIELD');
  });

  test('amount가 0 이하면 400', async () => {
    const req = new Request('https://x/biz/ins-claim', {
      method: 'POST', body: JSON.stringify({ user_guid: 'u1', insurance_type: '자동차', amount: 0 }),
    });
    const res = await handleInsClaimCreate(req, env, cors);
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.equal(data.error, 'INVALID_AMOUNT');
  });

  test('amount 필드 자체가 없으면 400 (undefined > 0 은 false)', async () => {
    const req = new Request('https://x/biz/ins-claim', {
      method: 'POST', body: JSON.stringify({ user_guid: 'u1', insurance_type: '자동차' }),
    });
    const res = await handleInsClaimCreate(req, env, cors);
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.equal(data.error, 'INVALID_AMOUNT');
  });

  test('서명 없이(signature 누락) 요청하면 인증 실패로 막힌다 — L1 쓰기 전 필수 관문', async () => {
    const req = new Request('https://x/biz/ins-claim', {
      method: 'POST',
      body: JSON.stringify({
        user_guid: 'u1', insurance_type: '자동차', amount: 1000,
        pubkey: 'pk', ts: String(Date.now()),
        // signature 필드 자체를 빼서 _verifyClaimsRequester가 즉시 false 반환
      }),
    });
    const res = await handleInsClaimCreate(req, env, cors);
    const data = await res.json();
    assert.equal(res.status, 403);
    assert.equal(data.error, 'AUTH_REQUIRED');
    // 인증에서 막혔으므로 ins_claims 컬렉션에 절대 쓰기가 일어나지 않아야 함
    assert.equal(requests.some(r => r.url.includes('/collections/ins_claims/records') && r.method === 'POST'), false);
  });

  test('pubkey 없이 요청해도 인증 실패로 막힌다', async () => {
    const req = new Request('https://x/biz/ins-claim', {
      method: 'POST',
      body: JSON.stringify({ user_guid: 'u1', insurance_type: '자동차', amount: 1000, ts: String(Date.now()) }),
    });
    const res = await handleInsClaimCreate(req, env, cors);
    const data = await res.json();
    assert.equal(res.status, 403);
    assert.equal(data.error, 'AUTH_REQUIRED');
  });

  test('만료된 ts(오래된 timestamp)면 인증 실패로 막힌다', async () => {
    const req = new Request('https://x/biz/ins-claim', {
      method: 'POST',
      body: JSON.stringify({
        user_guid: 'u1', insurance_type: '자동차', amount: 1000,
        pubkey: 'pk', signature: 'sig', ts: String(Date.now() - 1000 * 60 * 60), // 1시간 전
      }),
    });
    const res = await handleInsClaimCreate(req, env, cors);
    const data = await res.json();
    assert.equal(res.status, 403);
    assert.equal(data.error, 'AUTH_REQUIRED');
  });
});

describe('handleInsClaimsList — 입력 검증 / 인증 관문', () => {
  let handleInsClaimsList;
  before(async () => {
    installFetchMock();
    ({ handleInsClaimsList } = await import('../worker.js'));
  });

  const env = { L1_ADMIN_EMAIL: 'admin@test', L1_ADMIN_PASSWORD: 'pw' };
  const cors = {};

  test('guid 쿼리 파라미터 없으면 400', async () => {
    const req = new Request('https://x/biz/ins-claims');
    const res = await handleInsClaimsList(req, env, cors);
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.equal(data.error, 'MISSING_FIELD');
  });

  test('서명 없이 조회하면 인증 실패로 막힌다 — 타인 청구 내역(민감 정보) 노출 방지', async () => {
    const req = new Request('https://x/biz/ins-claims?guid=u1&pubkey=pk&ts=' + Date.now());
    const res = await handleInsClaimsList(req, env, cors);
    const data = await res.json();
    assert.equal(res.status, 403);
    assert.equal(data.error, 'AUTH_REQUIRED');
    assert.equal(requests.some(r => r.url.includes('/collections/ins_claims/records') && r.method === 'GET'), false);
  });

  test('pubkey/signature 둘 다 없으면 400이 아니라 403(guid는 있으므로 인증 단계에서 막힘)', async () => {
    const req = new Request('https://x/biz/ins-claims?guid=u1');
    const res = await handleInsClaimsList(req, env, cors);
    const data = await res.json();
    assert.equal(res.status, 403);
    assert.equal(data.error, 'AUTH_REQUIRED');
  });
});
