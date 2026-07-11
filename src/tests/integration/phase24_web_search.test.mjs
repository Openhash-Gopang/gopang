/**
 * phase24_web_search.test.mjs
 *
 * 2026-07-11 신설 — POST /web-search(Serper.dev 프록시) 검증. 실제
 * Serper.dev 호출은 이 샌드박스에서 네트워크 접근이 안 되므로 mock
 * fetch로 대체하고, 캐시·예산통제 로직만 검증한다(로직 검증 —
 * 실제 API 응답 형식 일치 여부는 배포 후 별도 확인 필요).
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let db;
let idSeq;
let serperCallCount;
let cacheStore;

function resetDb() {
  db = { web_search_usage: [] };
  idSeq = 0;
  serperCallCount = 0;
  cacheStore = new Map();
  _pendingWaitUntil = [];
}

function evalFilter(rec, filter) {
  const decoded = decodeURIComponent(filter);
  const m = decoded.match(/^(\w+)='(.*)'$/);
  if (m) return String(rec[m[1]] ?? '') === m[2];
  throw new Error(`mock: 필터 파싱 실패: ${filter}`);
}

function installMockFetch() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));

    if (u.pathname === '/api/admins/auth-with-password') {
      return new Response(JSON.stringify({ token: 'mock-admin-token' }), { status: 200 });
    }

    if (u.hostname === 'google.serper.dev') {
      serperCallCount++;
      const body = JSON.parse(init.body);
      if (body.q === 'ERROR_TRIGGER') {
        return new Response('rate limited', { status: 429 });
      }
      return new Response(JSON.stringify({
        organic: [
          { title: `결과: ${body.q}`, link: 'https://example.com/1', snippet: '테스트 스니펫' },
        ],
      }), { status: 200 });
    }

    const collMatch = u.pathname.match(/^\/api\/collections\/(\w+)\/records\/?(.*)$/);
    if (collMatch) {
      const [, collection, recordId] = collMatch;
      if (!db[collection]) throw new Error(`мock: 알 수 없는 컬렉션: ${collection}`);
      if ((!init.method || init.method === 'GET') && !recordId) {
        const filter = u.searchParams.get('filter');
        let items = db[collection];
        if (filter) items = items.filter(r => evalFilter(r, filter));
        return new Response(JSON.stringify({ items }), { status: 200 });
      }
      if (init.method === 'POST' && !recordId) {
        const body = JSON.parse(init.body);
        const rec = { id: `mock_${collection}_${++idSeq}`, ...body };
        db[collection].push(rec);
        return new Response(JSON.stringify(rec), { status: 200 });
      }
      if (init.method === 'PATCH' && recordId) {
        const idx = db[collection].findIndex(r => r.id === recordId);
        if (idx === -1) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
        const body = JSON.parse(init.body);
        db[collection][idx] = { ...db[collection][idx], ...body };
        return new Response(JSON.stringify(db[collection][idx]), { status: 200 });
      }
    }
    throw new Error(`mock: 처리 못하는 요청: ${init.method || 'GET'} ${u}`);
  };
  return () => { globalThis.fetch = realFetch; };
}

function installMockCache() {
  globalThis.caches = {
    default: {
      match: async (req) => cacheStore.get(req.url) || undefined,
      put: async (req, res) => { cacheStore.set(req.url, res); },
    },
  };
}

let worker;
const ENV_WITH_KEY = { L1_ADMIN_EMAIL: 'a', L1_ADMIN_PASSWORD: 'p', WEB_SEARCH_API_KEY: 'test-key' };
const ENV_NO_KEY = { L1_ADMIN_EMAIL: 'a', L1_ADMIN_PASSWORD: 'p' };
// ★ 수정(간헐적 실패 원인) — handleWebSearch는 실제 Cloudflare Workers와
// 동일하게 ctx.waitUntil(...)을 fire-and-forget으로 호출한다(응답을
// 기다리지 않음, 프로덕션에서 맞는 동작). 이전 mock은 그 프라미스를
// 그냥 반환만 하고 아무도 기다리지 않아서, call() 헬퍼가 응답을 받은
// 직후 곧바로 db 상태를 검증하면 예산증분·캐시저장이 아직 안 끝났을
// 수 있었다(타이밍에 따라 간헐적으로 실패 — 이번에 Windows에서 재현됨).
// waitUntil로 넘어온 프라미스를 배열에 모아두고, call()이 응답을 받은
// 뒤 전부 await하도록 고쳐 결정적(deterministic)으로 만든다.
let _pendingWaitUntil;
const CTX = { waitUntil: (p) => { _pendingWaitUntil.push(p); return p; } };

before(async () => {
  installMockFetch();
  installMockCache();
  worker = (await import('../../../worker.js')).default;
});

beforeEach(() => { resetDb(); });

function req(pathname, body) {
  return new Request(`https://hondi-proxy.example${pathname}`, {
    method: 'POST',
    headers: { 'Origin': 'http://localhost', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function call(env, body) {
  const res = await worker.fetch(req('/web-search', body), env, CTX);
  const json = await res.json().catch(() => null);
  // 백그라운드로 넘어간 waitUntil 작업(예산 카운터 증분·캐시 저장)이
  // 전부 끝난 뒤에야 테스트 검증으로 넘어간다 — 실제 Workers는 응답을
  // 안 기다리지만(성능), 테스트는 결정적 검증을 위해 기다려야 한다.
  await Promise.allSettled(_pendingWaitUntil);
  return { status: res.status, json };
}

describe('WS-01: 기본 검색 — 정상 응답 형식', () => {
  it('organic 결과를 정규화해 반환하고 캐시에 저장함', async () => {
    const { status, json } = await call(ENV_WITH_KEY, { query: '축산분뇨 감독기관' });
    assert.equal(status, 200);
    assert.equal(json.cache, 'miss');
    assert.equal(json.organic.length, 1);
    assert.equal(json.organic[0].title, '결과: 축산분뇨 감독기관');
    assert.equal(serperCallCount, 1);
    assert.equal(db.web_search_usage.length, 1);
    assert.equal(db.web_search_usage[0].count, 1);
  });
});

describe('WS-02: 캐시 — 동일 쿼리 재호출은 Serper를 다시 안 부름', () => {
  it('두 번째 호출은 cache:hit, serperCallCount 증가 없음, 예산도 증가 없음', async () => {
    await call(ENV_WITH_KEY, { query: '이삿짐센터' });
    assert.equal(serperCallCount, 1);
    const second = await call(ENV_WITH_KEY, { query: '이삿짐센터' });
    assert.equal(second.json.cache, 'hit');
    assert.equal(serperCallCount, 1, 'Serper가 두 번 호출되면 안 됨');
    assert.equal(db.web_search_usage[0].count, 1, '캐시 히트는 예산 카운트 안 함');
  });
});

describe('WS-03: API 키 미설정 — 정직하게 503', () => {
  it('WEB_SEARCH_API_KEY 없으면 WEB_SEARCH_NOT_CONFIGURED', async () => {
    const { status, json } = await call(ENV_NO_KEY, { query: '아무거나' });
    assert.equal(status, 503);
    assert.equal(json.error, 'WEB_SEARCH_NOT_CONFIGURED');
    assert.equal(serperCallCount, 0, '키 없으면 Serper 호출 자체를 시도하면 안 됨');
  });
});

describe('WS-04: 일일 예산 초과 — 429', () => {
  it('WEB_SEARCH_DAILY_CAP 도달하면 더 이상 실제 호출 안 함', async () => {
    const envCap2 = { ...ENV_WITH_KEY, WEB_SEARCH_DAILY_CAP: '2' };
    await call(envCap2, { query: 'q1' });
    await call(envCap2, { query: 'q2' });
    assert.equal(serperCallCount, 2);
    const third = await call(envCap2, { query: 'q3' });
    assert.equal(third.status, 429);
    assert.equal(third.json.error, 'DAILY_BUDGET_EXCEEDED');
    assert.equal(serperCallCount, 2, '한도 초과 시 Serper를 호출하면 안 됨');
  });
});

describe('WS-05: query 없으면 400', () => {
  it('빈 문자열/누락 모두 거부', async () => {
    const a = await call(ENV_WITH_KEY, {});
    assert.equal(a.status, 400);
    const b = await call(ENV_WITH_KEY, { query: '   ' });
    assert.equal(b.status, 400);
  });
});
