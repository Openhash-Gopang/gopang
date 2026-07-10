/**
 * phase23_gwp_registry_scaling.test.mjs
 *
 * 2026-07-11 신설 — gwp_registry(무제한 확장 가능한 SP 등록소) worker.js
 * 엔드포인트 검증. phase11/phase22와 동일한 in-memory mock 방식.
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let db;
let idSeq;

function resetDb() {
  db = { gwp_registry: [], sp_draft_requests: [], escalations: [] };
  idSeq = 0;
}

function splitTopLevelAnd(s) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (depth === 0 && s.slice(i, i + 4) === ' && ') {
      parts.push(s.slice(start, i).trim());
      i += 3;
      start = i + 1;
    }
  }
  parts.push(s.slice(start).trim());
  return parts;
}

function evalClause(rec, clause) {
  const parenMatch = clause.match(/^\((.*)\)$/);
  if (parenMatch) {
    return parenMatch[1].split('||').map(s => s.trim()).some(sub => evalClause(rec, sub));
  }
  let m = clause.match(/^(\w+)\s*~\s*'(.*)'$/);
  if (m) return String(rec[m[1]] ?? '').includes(m[2]);
  m = clause.match(/^(\w+)='(.*)'$/);
  if (m) return String(rec[m[1]] ?? '') === m[2].replace(/\\'/g, "'");
  throw new Error(`mock: 필터 절 파싱 실패: ${clause}`);
}

function evalFilter(rec, filter) {
  const decoded = decodeURIComponent(filter);
  return splitTopLevelAnd(decoded).every(clause => evalClause(rec, clause));
}

function installMockFetch() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.pathname === '/api/admins/auth-with-password') {
      return new Response(JSON.stringify({ token: 'mock-admin-token' }), { status: 200 });
    }
    const collMatch = u.pathname.match(/^\/api\/collections\/(\w+)\/records\/?(.*)$/);
    if (!collMatch) throw new Error(`mock: 처리 못하는 경로: ${u.pathname}`);
    const [, collection, recordId] = collMatch;
    if (!db[collection]) throw new Error(`mock: 알 수 없는 컬렉션: ${collection}`);

    if ((!init.method || init.method === 'GET') && !recordId) {
      const filter = u.searchParams.get('filter');
      let items = db[collection];
      if (filter) items = items.filter(r => evalFilter(r, filter));
      return new Response(JSON.stringify({ items, page: 1, perPage: 100, totalItems: items.length }), { status: 200 });
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
    throw new Error(`mock: 처리 못하는 요청: ${init.method || 'GET'} ${u.pathname}`);
  };
  return () => { globalThis.fetch = realFetch; };
}

let worker;
const ENV = { L1_ADMIN_EMAIL: 'admin@test', L1_ADMIN_PASSWORD: 'pw' };

before(async () => {
  installMockFetch();
  worker = (await import('../../../worker.js')).default;
});

beforeEach(() => { resetDb(); });

function req(pathname, { method = 'GET', body, search } = {}) {
  const url = new URL(`https://hondi-proxy.example${pathname}`);
  if (search) for (const [k, v] of Object.entries(search)) url.searchParams.set(k, v);
  return new Request(url, {
    method,
    headers: { 'Origin': 'http://localhost', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function call(pathname, opts) {
  const res = await worker.fetch(req(pathname, opts), ENV, {});
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

describe('GWP-01: /gwp-registry/register — 신규 등록 + 멱등 갱신', () => {
  it('처음엔 registered, 같은 gwp_id로 재호출하면 updated', async () => {
    const first = await call('/gwp-registry/register', {
      method: 'POST',
      body: { gwp_id: 'SP-DO-HOUSING', name: '건설주택국', tier: 'institutional', category: 'GOV', keywords: '건축허가 주택' },
    });
    assert.equal(first.status, 200);
    assert.equal(first.json.status, 'registered');
    assert.equal(db.gwp_registry.length, 1);

    const second = await call('/gwp-registry/register', {
      method: 'POST',
      body: { gwp_id: 'SP-DO-HOUSING', name: '건설주택국(개정)', tier: 'institutional' },
    });
    assert.equal(second.json.status, 'updated');
    assert.equal(db.gwp_registry.length, 1, '중복 레코드가 생기면 안 됨');
    assert.equal(db.gwp_registry[0].name, '건설주택국(개정)');
  });
});

describe('GWP-02: /gwp-registry/lookup — 정확 조회', () => {
  it('있으면 hit, 없으면 miss', async () => {
    await call('/gwp-registry/register', { method: 'POST', body: { gwp_id: 'klaw', name: 'K-Law', tier: 'core' } });
    const hit = await call('/gwp-registry/lookup', { search: { id: 'klaw' } });
    assert.equal(hit.json.status, 'hit');
    const miss = await call('/gwp-registry/lookup', { search: { id: 'does-not-exist' } });
    assert.equal(miss.json.status, 'miss');
  });
});

describe('GWP-03: /gwp-registry/search — 키워드·카테고리·티어 필터', () => {
  it('keywords에 부분일치하면 검색됨(축산분뇨 감독기관 시나리오)', async () => {
    await call('/gwp-registry/register', {
      method: 'POST',
      body: { gwp_id: 'SP-JEJU-LIVESTOCK-WASTE', name: '축산과', tier: 'institutional', category: 'GOV',
              keywords: '축산분뇨 가축분뇨 배출시설 신고' },
    });
    await call('/gwp-registry/register', {
      method: 'POST', body: { gwp_id: 'klaw', name: 'K-Law', tier: 'core', category: 'JUS', keywords: '법률 소송' },
    });

    const { json } = await call('/gwp-registry/search', { search: { q: '축산분뇨' } });
    assert.equal(json.count, 1);
    assert.equal(json.items[0].gwp_id, 'SP-JEJU-LIVESTOCK-WASTE');
  });

  it('status=pending_review인 항목은 검색에서 제외됨', async () => {
    await call('/gwp-registry/register', {
      method: 'POST',
      body: { gwp_id: 'SP-DRAFT-ONLY', name: '검토중', tier: 'institutional', keywords: '테스트', status: 'pending_review' },
    });
    const { json } = await call('/gwp-registry/search', { search: { q: '테스트' } });
    assert.equal(json.count, 0, '아직 승인 안 된 SP는 검색되면 안 됨');
  });

  it('tier/category로 좁힐 수 있음', async () => {
    await call('/gwp-registry/register', { method: 'POST', body: { gwp_id: 'a', name: 'A', tier: 'core', category: 'GOV', keywords: '공통어' } });
    await call('/gwp-registry/register', { method: 'POST', body: { gwp_id: 'b', name: 'B', tier: 'institutional', category: 'GOV', keywords: '공통어' } });
    const { json } = await call('/gwp-registry/search', { search: { q: '공통어', tier: 'institutional' } });
    assert.equal(json.count, 1);
    assert.equal(json.items[0].gwp_id, 'b');
  });
});

describe('GWP-04: SP-Author 승인 → gwp_registry 자동 등록', () => {
  it('draft_requests가 approved로 전이되면 gwp_registry에 자동 등록됨', async () => {
    const created = await call('/sp-author/queue', {
      method: 'POST',
      body: {
        request_type: 'create', signal_source: 'kcompose_match_fail',
        institution: '제주도 축산분뇨처리 감독기관', task: '가축분뇨 배출시설 신고 처리',
        tier_hint: 'municipal',
      },
    });
    const id = created.json.record.id;
    assert.equal(db.gwp_registry.length, 0, '승인 전에는 등록 안 됨');

    const approved = await call(`/sp-author/queue/${id}/status`, { method: 'POST', body: { status: 'approved' } });
    assert.equal(approved.status, 200);
    assert.equal(db.gwp_registry.length, 1, '승인되면 자동 등록돼야 함');
    assert.equal(db.gwp_registry[0].name, '제주도 축산분뇨처리 감독기관');
    assert.equal(db.gwp_registry[0].status, 'active');
    assert.equal(approved.json.gwp_registry.status, 'active', '등록된 gwp_registry 레코드 자체의 status는 active');
    assert.equal(approved.json.gwp_registry.gwp_id, db.gwp_registry[0].gwp_id);
  });

  it('rejected로 전이되면 등록되지 않음', async () => {
    const created = await call('/sp-author/queue', {
      method: 'POST', body: { request_type: 'create', signal_source: 'admin_manual', institution: 'X기관', task: 'x업무' },
    });
    await call(`/sp-author/queue/${created.json.record.id}/status`, { method: 'POST', body: { status: 'rejected' } });
    assert.equal(db.gwp_registry.length, 0);
  });
});
