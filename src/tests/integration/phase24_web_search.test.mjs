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
const CTX = { waitUntil: (p) => p }; // 테스트에서는 즉시 await 가능하도록 그대로 반환

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
