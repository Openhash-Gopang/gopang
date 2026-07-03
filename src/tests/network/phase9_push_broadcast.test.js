/**
 * phase9_push_broadcast.test.js — 배포 push 브로드캐스트 + sw.js push 분기 테스트
 * @테스트항목
 *   PB-01~PB-04: POST /push/broadcast (worker.js)
 *   SW-01~SW-04: sw.js push 이벤트 핸들러 태그 분기
 *
 * 실행: node --test src/tests/network/phase9_push_broadcast.test.js
 * 환경: Node.js 18+ (Web Crypto / fetch / Request / Response 내장)
 */

import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import worker from '../../../worker.js';

const L1_BASE      = 'https://l1-hanlim.hondi.net';
const ADMIN_TOKEN   = 'fake-admin-token';
const ORIGIN        = 'https://hondi-proxy.tensor-city.workers.dev';

// ── 헬퍼 ──────────────────────────────────────────────────────
function b64uEncodeBytes(bytes) {
  return Buffer.from(bytes).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64uToBytes(b64u) {
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}

// web-push generate-vapid-keys와 동일한 형태(65바이트 비압축 포인트 / 32바이트 스칼라)의
// 테스트용 VAPID 키쌍을 즉석에서 생성한다.
async function makeVapidKeyPair() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const rawPub  = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const jwkPriv = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return {
    publicKey:         kp.publicKey, // 서명 검증에 그대로 사용할 CryptoKey
    VAPID_PUBLIC_KEY:  b64uEncodeBytes(rawPub),
    VAPID_PRIVATE_KEY: jwkPriv.d.replace(/=+$/, ''),
  };
}

function makeEnv(overrides = {}) {
  return {
    L1_ADMIN_EMAIL:     'admin@test.local',
    L1_ADMIN_PASSWORD:  'pw',
    VAPID_SUBJECT:      'mailto:test@example.com',
    DEPLOY_PUSH_SECRET: 'correct-secret',
    ...overrides,
  };
}

function buildRequest(path, body) {
  return new Request(`${ORIGIN}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
}

// ══════════════════════════════════════════════════════════════
// PB — POST /push/broadcast (worker.js)
// ══════════════════════════════════════════════════════════════
describe('PB: handlePushBroadcast — /push/broadcast', () => {
  let originalFetch;

  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(()  => { globalThis.fetch = originalFetch; });

  it('PB-01: 시크릿이 틀리면 403 FORBIDDEN, 네트워크 호출 없음', async () => {
    globalThis.fetch = async (u) => { throw new Error('호출되면 안 됨: ' + u); };
    const res = await worker.fetch(buildRequest('/push/broadcast', { secret: 'wrong' }), makeEnv());
    assert.equal(res.status, 403);
    const data = await res.json();
    assert.equal(data.error, 'FORBIDDEN');
  });

  it('PB-02: 시크릿 누락 시 403 FORBIDDEN', async () => {
    globalThis.fetch = async (u) => { throw new Error('호출되면 안 됨: ' + u); };
    const res = await worker.fetch(buildRequest('/push/broadcast', {}), makeEnv());
    assert.equal(res.status, 403);
  });

  it('PB-03: VAPID 환경변수 미설정 시 500 CONFIG_ERROR, L1 호출 없음', async () => {
    globalThis.fetch = async (u) => { throw new Error('호출되면 안 됨: ' + u); };
    const res = await worker.fetch(
      buildRequest('/push/broadcast', { secret: 'correct-secret' }),
      makeEnv() // VAPID_* 없음
    );
    assert.equal(res.status, 500);
    const data = await res.json();
    assert.equal(data.error, 'CONFIG_ERROR');
  });

  it('PB-04: 정상 흐름 — L1 구독자 전체에 검증 가능한 VAPID 서명으로 push 전송', async () => {
    const { publicKey, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = await makeVapidKeyPair();
    const env = makeEnv({ VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY });

    const subA = { endpoint: 'https://fake-push.example.com/dev/aaa', keys: { p256dh: 'x', auth: 'y' } };
    const subB = { endpoint: 'https://fake-push.example.com/dev/bbb', keys: { p256dh: 'x', auth: 'y' } };

    let sentCount = 0;
    globalThis.fetch = async (urlArg, init = {}) => {
      const u = typeof urlArg === 'string' ? urlArg : urlArg.url;

      if (u === `${L1_BASE}/api/admins/auth-with-password`) {
        return new Response(JSON.stringify({ token: ADMIN_TOKEN }), { status: 200 });
      }

      if (u.startsWith(`${L1_BASE}/api/collections/profiles/records`)) {
        const page = Number(/page=(\d+)/.exec(u)?.[1] || 1);
        if (page === 1) {
          return new Response(JSON.stringify({
            items: [
              { id: 'r1', guid: 'guid-a', push_subscription: JSON.stringify(subA) },
              { id: 'r2', guid: 'guid-b', push_subscription: JSON.stringify(subB) },
            ],
          }), { status: 200 });
        }
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }

      // 실제 푸시 엔드포인트 — VAPID JWT 서명을 공개키로 직접 검증한다
      // (importKey 'raw'→'jwk' 수정이 실제로 유효한 서명을 만드는지 끝까지 확인)
      if (u.startsWith('https://fake-push.example.com/')) {
        const auth = init.headers?.Authorization;
        const m = /^vapid t=([^,]+),k=(.+)$/.exec(auth || '');
        assert.ok(m, 'Authorization 헤더가 "vapid t=...,k=..." 형식이어야 함');
        const [, jwt, k] = m;
        assert.equal(k, VAPID_PUBLIC_KEY, 'k= 파라미터가 VAPID_PUBLIC_KEY와 일치해야 함');

        const [header, claims, sig] = jwt.split('.');
        const verified = await crypto.subtle.verify(
          { name: 'ECDSA', hash: 'SHA-256' },
          publicKey,
          b64uToBytes(sig),
          new TextEncoder().encode(`${header}.${claims}`)
        );
        assert.ok(verified, 'VAPID JWT 서명이 공개키로 검증되어야 함');
        sentCount++;
        return new Response('', { status: 201 });
      }

      throw new Error('예상치 못한 fetch 호출: ' + u);
    };

    const res = await worker.fetch(
      buildRequest('/push/broadcast', { secret: 'correct-secret' }),
      env
    );
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.total, 2);
    assert.equal(data.sent, 2);
    assert.equal(data.failed, 0);
    assert.equal(sentCount, 2);
  });
});

// ══════════════════════════════════════════════════════════════
// SW — sw.js push 이벤트 핸들러 태그 분기
// ══════════════════════════════════════════════════════════════
describe('SW: push 이벤트 핸들러 — 태그별 분기', () => {
  const notifyCalls    = [];
  const clientMessages = [];
  let pushHandler;

  before(async () => {
    globalThis.self = {
      addEventListener(type, fn) { if (type === 'push') pushHandler = fn; },
      skipWaiting: async () => {},
      registration: {
        showNotification: async (title, opts) => { notifyCalls.push({ title, opts }); },
      },
    };
    globalThis.clients = {
      matchAll: async () => [{ postMessage: (msg) => clientMessages.push(msg) }],
    };
    await import('../../../sw.js'); // self.addEventListener('push', ...) 등록
    assert.ok(pushHandler, 'sw.js가 push 리스너를 등록해야 함');
  });

  function makePushEvent(dataObj, asText = null) {
    let promise;
    const data = asText !== null
      ? { json: () => { throw new SyntaxError('not json'); }, text: () => asText }
      : { json: () => dataObj, text: () => JSON.stringify(dataObj) };
    return {
      data,
      waitUntil(p) { promise = p; },
      get _settled() { return promise; },
    };
  }

  beforeEach(() => { notifyCalls.length = 0; clientMessages.length = 0; });

  it('SW-01: 일반 메시지 태그 — 알림만 표시, 클라이언트 메시지 없음', async () => {
    const event = makePushEvent({ title: '고팡', body: '안녕', tag: 'gopang-msg', sound: 'ping' });
    pushHandler(event);
    await event._settled;
    assert.equal(notifyCalls.length, 1);
    assert.equal(notifyCalls[0].title, '고팡');
    assert.equal(notifyCalls[0].opts.tag, 'gopang-msg');
    assert.equal(clientMessages.length, 0, '일반 메시지는 postMessage를 보내면 안 됨');
  });

  it('SW-02: AI 설정 동기화 태그 — SYNC_AI_SETTING 브로드캐스트', async () => {
    const event = makePushEvent({ title: 'AI 비서 설정', body: '...', tag: 'gopang-ai-setup-abcd1234' });
    pushHandler(event);
    await event._settled;
    assert.equal(clientMessages.length, 1);
    assert.equal(clientMessages[0].type, 'SYNC_AI_SETTING');
  });

  it('SW-03: 버전 업데이트 태그 — 알림 표시 + CHECK_FOR_UPDATE 브로드캐스트', async () => {
    const event = makePushEvent({ title: '고팡 업데이트', body: '새 버전이 준비됐습니다.', tag: 'gopang-version-update' });
    pushHandler(event);
    await event._settled;
    assert.equal(notifyCalls.length, 1, '버전 업데이트도 알림은 그대로 표시되어야 함');
    assert.equal(clientMessages.length, 1);
    assert.equal(clientMessages[0].type, 'CHECK_FOR_UPDATE');
  });

  it('SW-04: JSON 파싱 실패 시 텍스트로 폴백', async () => {
    const event = makePushEvent(null, '순수 텍스트 메시지');
    pushHandler(event);
    await event._settled;
    assert.equal(notifyCalls[0].title, '고팡');
    assert.equal(notifyCalls[0].opts.body, '순수 텍스트 메시지');
  });
});
