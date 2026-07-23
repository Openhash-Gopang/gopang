// phase11_push_multidevice.test.js
// 실행: node --test src/tests/network/phase11_push_multidevice.test.js
//
// 배경: docs/PUSH_SUBSCRIPTION_HIJACK_2026_07_21.md — device-link(PC 로그인)
// 승인 알림이 폰이 아니라 PC 자신에게 도착하던 사고. 07-21 수정(지갑 키
// 없는 기기만 자가치유에서 걸러냄)으로도 "PC가 실제로 지갑 키를 가진
// 정당한 기기"인 경우엔 여전히 재현됐다(§4 잔여 한계로 문서에 명시).
//
// 이번 근본 수정: profiles.push_subscription을 "구독 객체 1개"에서
// "기기별 항목 배열"로 바꿔, 여러 기기가 각자 독립적으로 구독을 유지하고
// device-link 알림은 등록된 모든 기기로 발송한다(어느 기기가 실제
// 지갑 키로 승인하든 상관없음 — 다른 기기의 알림은 그냥 무해하게 뜬다).

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import worker from '../../../worker.js';

const L1_BASE = 'https://l1-hanlim.hondi.net';
const ORIGIN  = 'https://hondi-proxy.tensor-city.workers.dev';

function b64uEncodeBytes(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
async function makeVapidEnv(overrides = {}) {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const rawPub  = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const jwkPriv = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return {
    L1_ADMIN_EMAIL: 'a@a.com', L1_ADMIN_PASSWORD: 'pw',
    VAPID_PUBLIC_KEY:  b64uEncodeBytes(rawPub),
    VAPID_PRIVATE_KEY: jwkPriv.d.replace(/=+$/, ''),
    VAPID_SUBJECT: 'mailto:a@a.com',
    ...overrides,
  };
}
async function makeSubscriberKeys() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  return { p256dh: b64uEncodeBytes(rawPub), auth: b64uEncodeBytes(authSecret) };
}
function req(path, body) {
  return new Request(`${ORIGIN}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

let originalFetch;
beforeEach(() => { originalFetch = globalThis.fetch; });
afterEach(()  => { globalThis.fetch = originalFetch; });

describe('PM: push 구독 기기별 분리 (2026-07-23 — device-link 알림이 PC로 가던 사고 근본 수정)', () => {

  it('PM-01: 두 기기(PC, 폰)가 각자 구독하면 서로 덮어쓰지 않고 둘 다 저장된다', async () => {
    let stored = ''; // L1에 저장된 push_subscription 값(순차적으로 갱신됨)
    globalThis.fetch = async (u, init = {}) => {
      const url = typeof u === 'string' ? u : u.url;
      if (url === `${L1_BASE}/api/admins/auth-with-password`)
        return new Response(JSON.stringify({ token: 't' }), { status: 200 });
      if (url.startsWith(`${L1_BASE}/api/collections/profiles/records`) && !url.includes('/records/'))
        return new Response(JSON.stringify({ items: [{ id: 'r1', push_subscription: stored }] }), { status: 200 });
      if (url.includes('/records/r1')) {
        stored = JSON.parse(init.body).push_subscription;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      throw new Error('unexpected fetch: ' + url);
    };

    // 1) PC가 먼저 구독
    await worker.fetch(req('/push/subscribe', {
      guid: 'g1', deviceId: 'pc-1', subscription: { endpoint: 'https://fake/pc' }, sound: 'ping',
    }), await makeVapidEnv());

    // 2) 폰이 나중에 구독 — 이전(PC) 구독을 덮어쓰면 안 됨
    await worker.fetch(req('/push/subscribe', {
      guid: 'g1', deviceId: 'phone-1', subscription: { endpoint: 'https://fake/phone' }, sound: 'ping',
    }), await makeVapidEnv());

    const devices = JSON.parse(stored);
    assert.equal(devices.length, 2, 'PC 구독이 폰 구독으로 덮어써지지 않고 둘 다 남아있어야 함');
    const endpoints = devices.map(d => d.subscription.endpoint).sort();
    assert.deepEqual(endpoints, ['https://fake/pc', 'https://fake/phone']);
  });

  it('PM-02: device-link 알림은 등록된 모든 기기로 발송된다(PC만 받고 끝나지 않음)', async () => {
    const keysPc    = await makeSubscriberKeys();
    const keysPhone = await makeSubscriberKeys();
    const sentTo = [];
    const existingDevices = JSON.stringify([
      { deviceId: 'pc-1',    subscription: { endpoint: 'https://fake/pc',    keys: keysPc },    sound: 'ping', updatedAt: 2000 },
      { deviceId: 'phone-1', subscription: { endpoint: 'https://fake/phone', keys: keysPhone }, sound: 'ping', updatedAt: 1000 },
    ]);

    globalThis.fetch = async (u, init = {}) => {
      const url = typeof u === 'string' ? u : u.url;
      if (url === `${L1_BASE}/api/admins/auth-with-password`)
        return new Response(JSON.stringify({ token: 't' }), { status: 200 });
      // e164 조회(가입 확인)와 guid 조회(fresh profile) 둘 다 같은 프로필을 반환
      if (url.startsWith(`${L1_BASE}/api/collections/profiles/records`))
        return new Response(JSON.stringify({ items: [{ id: 'r1', guid: 'g1', push_subscription: existingDevices }] }), { status: 200 });
      if (url.startsWith('https://fake/')) { sentTo.push(url); return new Response('', { status: 201 }); }
      throw new Error('unexpected fetch: ' + url);
    };

    const res = await worker.fetch(req('/auth/device-link/init', {
      e164: '+821012345678', pcPubKeyB64u: b64uEncodeBytes(new Uint8Array(32)), pcLabel: '테스트 PC',
    }), await makeVapidEnv({ QR_SESSIONS_KV: { put: async () => {} } }));

    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.pushSent, true);
    assert.equal(sentTo.length, 2, 'PC와 폰 둘 다에게 발송돼야 함(이번 사고의 핵심 — 이전엔 마지막에 구독한 기기 1곳에만 갔음)');
    assert.ok(sentTo.some(u => u.startsWith('https://fake/pc')));
    assert.ok(sentTo.some(u => u.startsWith('https://fake/phone')));
  });

  it('PM-03: 구독 취소는 그 기기 항목만 제거하고 다른 기기는 그대로 남는다', async () => {
    let stored = JSON.stringify([
      { deviceId: 'pc-1',    subscription: { endpoint: 'https://fake/pc' },    sound: 'ping', updatedAt: 2000 },
      { deviceId: 'phone-1', subscription: { endpoint: 'https://fake/phone' }, sound: 'ping', updatedAt: 1000 },
    ]);
    globalThis.fetch = async (u, init = {}) => {
      const url = typeof u === 'string' ? u : u.url;
      if (url === `${L1_BASE}/api/admins/auth-with-password`)
        return new Response(JSON.stringify({ token: 't' }), { status: 200 });
      if (url.startsWith(`${L1_BASE}/api/collections/profiles/records`) && !url.includes('/records/'))
        return new Response(JSON.stringify({ items: [{ id: 'r1', push_subscription: stored }] }), { status: 200 });
      if (url.includes('/records/r1')) {
        stored = JSON.parse(init.body).push_subscription;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      throw new Error('unexpected fetch: ' + url);
    };

    await worker.fetch(req('/push/subscribe', { guid: 'g1', deviceId: 'pc-1', unsubscribe: true }), await makeVapidEnv());

    const devices = JSON.parse(stored);
    assert.equal(devices.length, 1, 'pc-1만 제거되고 phone-1은 남아야 함');
    assert.equal(devices[0].deviceId, 'phone-1');
  });

  it('PM-04: 구버전(단일 구독 객체) 데이터도 계속 읽을 수 있다(하위호환)', async () => {
    // 이번 수정 이전 형식 — 배열이 아니라 구독 객체 하나
    const legacyStored = JSON.stringify({ endpoint: 'https://fake/legacy-device', keys: await makeSubscriberKeys() });
    const sentTo = [];
    globalThis.fetch = async (u) => {
      const url = typeof u === 'string' ? u : u.url;
      if (url === `${L1_BASE}/api/admins/auth-with-password`)
        return new Response(JSON.stringify({ token: 't' }), { status: 200 });
      if (url.startsWith(`${L1_BASE}/api/collections/profiles/records`))
        return new Response(JSON.stringify({ items: [{ id: 'r1', push_subscription: legacyStored, push_sound: 'bell' }] }), { status: 200 });
      if (url.startsWith('https://fake/')) { sentTo.push(url); return new Response('', { status: 201 }); }
      throw new Error('unexpected fetch: ' + url);
    };
    const res = await worker.fetch(req('/push/send', { to_guid: 'g1' }), await makeVapidEnv());
    const data = await res.json();
    assert.equal(data.sent, 1, '구버전 단일 객체 형식도 정상적으로 읽혀서 발송돼야 함');
    assert.ok(sentTo[0].startsWith('https://fake/legacy-device'));
  });

  it('PM-05: 같은 deviceId로 재구독하면 교체될 뿐 중복 추가되지 않는다', async () => {
    let stored = '';
    globalThis.fetch = async (u, init = {}) => {
      const url = typeof u === 'string' ? u : u.url;
      if (url === `${L1_BASE}/api/admins/auth-with-password`)
        return new Response(JSON.stringify({ token: 't' }), { status: 200 });
      if (url.startsWith(`${L1_BASE}/api/collections/profiles/records`) && !url.includes('/records/'))
        return new Response(JSON.stringify({ items: [{ id: 'r1', push_subscription: stored }] }), { status: 200 });
      if (url.includes('/records/r1')) {
        stored = JSON.parse(init.body).push_subscription;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      throw new Error('unexpected fetch: ' + url);
    };
    const env = await makeVapidEnv();
    await worker.fetch(req('/push/subscribe', { guid: 'g1', deviceId: 'pc-1', subscription: { endpoint: 'https://fake/pc-old' } }), env);
    await worker.fetch(req('/push/subscribe', { guid: 'g1', deviceId: 'pc-1', subscription: { endpoint: 'https://fake/pc-new' } }), env);

    const devices = JSON.parse(stored);
    assert.equal(devices.length, 1, '같은 deviceId는 추가가 아니라 교체여야 함');
    assert.equal(devices[0].subscription.endpoint, 'https://fake/pc-new');
  });
});
