import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import worker from '../../../worker.js';

const L1_BASE = 'https://l1-hanlim.hondi.net';
const SB_BASE = 'https://ebbecjfrwaswbdybbgiu.supabase.co';
const ORIGIN  = 'https://hondi-proxy.tensor-city.workers.dev';

function b64uEncodeBytes(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
async function makeVapidEnv(overrides={}) {
  const kp = await crypto.subtle.generateKey({name:'ECDSA', namedCurve:'P-256'}, true, ['sign','verify']);
  const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const jwkPriv = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return {
    L1_ADMIN_EMAIL:'a@a.com', L1_ADMIN_PASSWORD:'pw',
    VAPID_PUBLIC_KEY:  b64uEncodeBytes(rawPub),
    VAPID_PRIVATE_KEY: jwkPriv.d.replace(/=+$/,''),
    VAPID_SUBJECT:'mailto:a@a.com',
    SUPABASE_KEY:'anon', ...overrides
  };
}
function req(path, body) {
  return new Request(`${ORIGIN}${path}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
}

let originalFetch;
beforeEach(() => { originalFetch = globalThis.fetch; });
afterEach(()  => { globalThis.fetch = originalFetch; });

describe('PL: push 구독 L1 우선 동작', () => {
  it('PL-01: handlePushSend는 L1에 구독이 있으면 Supabase를 안 건드린다', async () => {
    let supabaseHit = false;
    globalThis.fetch = async (u) => {
      const url = typeof u === 'string' ? u : u.url;
      if (url === `${L1_BASE}/api/admins/auth-with-password`)
        return new Response(JSON.stringify({ token:'t' }), { status:200 });
      if (url.startsWith(`${L1_BASE}/api/collections/profiles/records`))
        return new Response(JSON.stringify({ items:[{ id:'r1', push_subscription: JSON.stringify({endpoint:'https://fake/x'}), push_sound:'bell' }] }), { status:200 });
      if (url.startsWith(SB_BASE)) { supabaseHit = true; return new Response('[]', { status:200 }); }
      if (url.startsWith('https://fake/')) return new Response('', { status:201 });
      throw new Error('unexpected fetch: ' + url);
    };
    const res = await worker.fetch(req('/push/send', { to_guid:'g1' }), await makeVapidEnv());
    const data = await res.json();
    assert.equal(data.source, 'l1');
    assert.equal(data.sent, 1);
    assert.equal(supabaseHit, false, 'L1 성공 시 Supabase를 조회하면 안 됨');
  });

  it('PL-02: handlePushSend는 L1이 정상 응답했지만 구독이 없으면 Supabase로 폴백하지 않는다', async () => {
    let supabaseHit = false;
    globalThis.fetch = async (u) => {
      const url = typeof u === 'string' ? u : u.url;
      if (url === `${L1_BASE}/api/admins/auth-with-password`)
        return new Response(JSON.stringify({ token:'t' }), { status:200 });
      if (url.startsWith(`${L1_BASE}/api/collections/profiles/records`))
        return new Response(JSON.stringify({ items:[{ id:'r1', push_subscription:'' }] }), { status:200 });
      if (url.startsWith(SB_BASE)) { supabaseHit = true; return new Response('[]', { status:200 }); }
      throw new Error('unexpected fetch: ' + url);
    };
    const res = await worker.fetch(req('/push/send', { to_guid:'g1' }), await makeVapidEnv());
    const data = await res.json();
    assert.equal(data.sent, 0);
    assert.equal(data.reason, 'NO_SUBSCRIPTION');
    assert.equal(supabaseHit, false, 'L1이 정상 응답하면(구독 없음 포함) Supabase 폴백 금지');
  });

  it('PL-03: handlePushSend는 L1 연결 자체가 실패할 때만 Supabase로 폴백한다', async () => {
    globalThis.fetch = async (u) => {
      const url = typeof u === 'string' ? u : u.url;
      if (url === `${L1_BASE}/api/admins/auth-with-password`)
        throw new Error('L1 다운');
      if (url.startsWith(SB_BASE))
        return new Response(JSON.stringify([{ subscription: JSON.stringify({endpoint:'https://fake/y'}), sound:'chime' }]), { status:200 });
      if (url.startsWith('https://fake/')) return new Response('', { status:201 });
      throw new Error('unexpected fetch: ' + url);
    };
    const res = await worker.fetch(req('/push/send', { to_guid:'g1' }), await makeVapidEnv());
    const data = await res.json();
    assert.equal(data.source, 'supabase');
    assert.equal(data.sent, 1);
  });

  it('PL-04: handlePushSubscribe는 L1 저장 성공 후 Supabase에도 best-effort로 미러링한다', async () => {
    let supabaseBody = null;
    globalThis.fetch = async (u, init={}) => {
      const url = typeof u === 'string' ? u : u.url;
      if (url === `${L1_BASE}/api/admins/auth-with-password`)
        return new Response(JSON.stringify({ token:'t' }), { status:200 });
      if (url.startsWith(`${L1_BASE}/api/collections/profiles/records`) && !url.includes('/records/'))
        return new Response(JSON.stringify({ items:[{ id:'r1' }] }), { status:200 });
      if (url.includes('/records/r1'))
        return new Response(JSON.stringify({ ok:true }), { status:200 });
      if (url.startsWith(SB_BASE)) { supabaseBody = JSON.parse(init.body); return new Response('', { status:201 }); }
      throw new Error('unexpected fetch: ' + url);
    };
    const res = await worker.fetch(req('/push/subscribe', { guid:'g1', subscription:{endpoint:'https://fake/z'}, sound:'drop' }), await makeVapidEnv());
    assert.equal(res.status, 200);
    // 백업은 fire-and-forget이라 약간의 지연 후 확인
    await new Promise(r => setTimeout(r, 20));
    assert.ok(supabaseBody, 'Supabase 백업 쓰기가 호출되어야 함');
    assert.equal(supabaseBody.guid, 'g1');
  });
});
