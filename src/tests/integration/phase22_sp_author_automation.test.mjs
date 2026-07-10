/**
 * phase22_sp_author_automation.test.mjs
 *
 * 2026-07-11 신설 — SP-Author 자동화(신호 큐잉 + ESCALATE 최소구현 +
 * 갱신스케줄) worker.js 엔드포인트 검증. phase11과 동일한 방식으로
 * L1 PocketBase를 in-memory mock으로 대체하고, "라우팅 → 핸들러 →
 * L1 헬퍼 → fetch" 경계까지 검증한다. SP-Author 자신(실제 조사·작성)은
 * 여전히 사람이 수행하므로 이 테스트 범위 밖이다 — 신호가 큐/알림에
 * 정직하게 남는지만 검증한다.
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ══════════════════════════════════════════════════════════════════
// 픽스처 — 가짜 L1 PocketBase (phase11 대비 필터 파서를 &&/<=까지 확장)
// ══════════════════════════════════════════════════════════════════

let db;
let idSeq;

function resetDb() {
  db = { sp_draft_requests: [], escalations: [], sp_refresh_schedule: [] };
  idSeq = 0;
}

// "a='x' && b='y'" 또는 "field <= 'value'" 형태를 지원(현재 worker.js가
// 이 테스트 대상 엔드포인트에서 실제로 만드는 filter 형태만 커버).
// worker.js의 _l1FindOpenDraftRequest는 "a='x' && b='y' && (c='p' || c='q')"
// 형태도 만들므로, 최상위 &&로 쪼갤 때 괄호로 감싸인 절이 안 잘리도록
// 괄호 깊이를 추적한다.
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

function evalFilter(rec, filter) {
  const decoded = decodeURIComponent(filter);
  const clauses = splitTopLevelAnd(decoded);
  return clauses.every(clause => evalClause(rec, clause));
}

function evalClause(rec, clause) {
  // 괄호로 감싸인 OR 그룹: (a='x' || a='y')
  const parenMatch = clause.match(/^\((.*)\)$/);
  if (parenMatch) {
    return parenMatch[1].split('||').map(s => s.trim()).some(sub => evalClause(rec, sub));
  }
  let m = clause.match(/^(\w+)\s*<=\s*'(.*)'$/);
  if (m) return String(rec[m[1]] ?? '') <= m[2];
  m = clause.match(/^(\w+)='(.*)'$/);
  if (m) return String(rec[m[1]] ?? '') === m[2].replace(/\\'/g, "'");
  m = clause.match(/^(\w+)=(true|false)$/);
  if (m) return Boolean(rec[m[1]]) === (m[2] === 'true');
  throw new Error(`mock: 필터 절 파싱 실패: ${clause}`);
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
      // sort=-created 요청은 무시(테스트에서 순서 무관하게 검증)
      return new Response(JSON.stringify({ items, page: 1, perPage: 200, totalItems: items.length }), { status: 200 });
    }

    if (init.method === 'POST' && !recordId) {
      const body = JSON.parse(init.body);
      const rec = { id: `mock_${collection}_${++idSeq}`, created: new Date().toISOString(), ...body };
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

// ══════════════════════════════════════════════════════════════════

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

// ══════════════════════════════════════════════════════════════════
// 큐잉
// ══════════════════════════════════════════════════════════════════

describe('SPA-01: /sp-author/queue POST — 정상 큐잉 + 자동 ESCALATE', () => {
  it('queued 상태로 생성되고 escalations에도 함께 기록됨', async () => {
    const { status, json } = await call('/sp-author/queue', {
      method: 'POST',
      body: {
        request_type: 'create',
        signal_source: 'kcompose_match_fail',
        institution: '제주도 축산분뇨처리 감독기관',
        task: '가축분뇨 배출시설 신고 처리',
        tier_hint: 'municipal',
        source_conversation: '사용자: 축산분뇨 처리 신고하고 싶어요',
        priority: 'normal',
      },
    });
    assert.equal(status, 200);
    assert.equal(json.status, 'queued');
    assert.equal(json.record.status, 'queued');
    assert.equal(db.sp_draft_requests.length, 1);
    assert.equal(db.escalations.length, 1, 'ESCALATE 알림이 큐잉과 동시에 생성돼야 함');
    assert.equal(db.escalations[0].reason, 'sp_draft_request');
    assert.equal(db.escalations[0].read, false);
  });
});

describe('SPA-02: /sp-author/queue POST — 중복 신호 병합', () => {
  it('같은 institution+task로 queued 상태가 이미 있으면 새로 안 만들고 병합', async () => {
    const first = await call('/sp-author/queue', {
      method: 'POST',
      body: { request_type: 'create', signal_source: 'kcompose_match_fail', institution: '축산분뇨감독기관', task: '신고처리' },
    });
    const second = await call('/sp-author/queue', {
      method: 'POST',
      body: { request_type: 'create', signal_source: 'realtime_ac', institution: '축산분뇨감독기관', task: '신고처리' },
    });
    assert.equal(db.sp_draft_requests.length, 1, '중복이면 레코드가 늘어나면 안 됨');
    assert.equal(second.json.status, 'merged_into_existing');
    assert.equal(second.json.record.id, first.json.record.id);
    // 병합 시에는 추가 ESCALATE도 안 남긴다(중복 알림 방지)
    assert.equal(db.escalations.length, 1);
  });
});

describe('SPA-03: /sp-author/queue GET — 상태별 목록 조회', () => {
  it('status 쿼리로 필터링됨', async () => {
    await call('/sp-author/queue', { method: 'POST', body: { request_type: 'create', signal_source: 'admin_manual', institution: 'A', task: 'a' } });
    await call('/sp-author/queue', { method: 'POST', body: { request_type: 'create', signal_source: 'admin_manual', institution: 'B', task: 'b' } });
    db.sp_draft_requests[1].status = 'approved';

    const { json } = await call('/sp-author/queue', { search: { status: 'queued' } });
    assert.equal(json.items.length, 1);
    assert.equal(json.items[0].institution, 'A');
  });
});

describe('SPA-04: /sp-author/queue/:id/status POST — 상태 전이', () => {
  it('허용된 상태로만 전이되고, approved 시 resolved_at이 찍힘', async () => {
    const created = await call('/sp-author/queue', {
      method: 'POST', body: { request_type: 'create', signal_source: 'admin_manual', institution: 'A', task: 'a' },
    });
    const id = created.json.record.id;

    const bad = await call(`/sp-author/queue/${id}/status`, { method: 'POST', body: { status: 'not_a_real_status' } });
    assert.equal(bad.status, 400);

    const good = await call(`/sp-author/queue/${id}/status`, { method: 'POST', body: { status: 'approved' } });
    assert.equal(good.status, 200);
    assert.equal(good.json.record.status, 'approved');
    assert.ok(good.json.record.resolved_at);
  });

  it('duplicate 전이 시 duplicate_of가 함께 저장됨', async () => {
    const a = await call('/sp-author/queue', { method: 'POST', body: { request_type: 'create', signal_source: 'admin_manual', institution: 'A', task: 'a' } });
    const b = await call('/sp-author/queue', { method: 'POST', body: { request_type: 'create', signal_source: 'admin_manual', institution: 'B', task: 'b' } });
    const res = await call(`/sp-author/queue/${b.json.record.id}/status`, {
      method: 'POST', body: { status: 'duplicate', duplicate_of: a.json.record.id },
    });
    assert.equal(res.json.record.status, 'duplicate');
    assert.equal(res.json.record.duplicate_of, a.json.record.id);
  });
});

// ══════════════════════════════════════════════════════════════════
// ESCALATE
// ══════════════════════════════════════════════════════════════════

describe('SPA-05: /sp-author/escalate POST — 직접 알림', () => {
  it('reason/summary 필수, 정상 생성 시 read=false로 시작', async () => {
    const missing = await call('/sp-author/escalate', { method: 'POST', body: { summary: '요약만 있음' } });
    assert.equal(missing.status, 400);

    const ok = await call('/sp-author/escalate', {
      method: 'POST',
      body: { reason: 'sp_refresh_drift', summary: '기준중위소득 수치 변경 감지', ref_collection: 'sp_refresh_schedule', ref_id: 'x1' },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.record.read, false);
    assert.equal(ok.json.record.to, '@owner', 'to 미지정 시 기본값 @owner');
  });
});

describe('SPA-06: /sp-author/escalations GET — 미확인만 필터', () => {
  it('unread=true면 read=false인 것만 반환', async () => {
    await call('/sp-author/escalate', { method: 'POST', body: { reason: 'other', summary: '1' } });
    await call('/sp-author/escalate', { method: 'POST', body: { reason: 'other', summary: '2' } });
    db.escalations[0].read = true;

    const { json } = await call('/sp-author/escalations', { search: { unread: 'true' } });
    assert.equal(json.items.length, 1);
    assert.equal(json.items[0].summary, '2');
  });
});

// ══════════════════════════════════════════════════════════════════
// 갱신 스케줄
// ══════════════════════════════════════════════════════════════════

describe('SPA-07: /sp-author/refresh-schedule POST — tier별 next_due_at 계산', () => {
  it('weekly=7일, monthly=30일, quarterly=90일 뒤로 계산됨(±1일 오차 허용)', async () => {
    const cases = [['weekly', 7], ['monthly', 30], ['quarterly', 90]];
    for (const [tier, days] of cases) {
      const { json } = await call('/sp-author/refresh-schedule', {
        method: 'POST', body: { sp_id: `SP-TEST-${tier}`, tier },
      });
      const due = new Date(json.record.next_due_at);
      const expected = new Date(Date.now() + days * 86400000);
      const diffDays = Math.abs((due - expected) / 86400000);
      assert.ok(diffDays < 1.5, `${tier}: 기대 ${days}일 근처, 실제 차이 ${diffDays}일`);
    }
  });

  it('같은 sp_id 재호출은 upsert(레코드 중복 안 됨)', async () => {
    await call('/sp-author/refresh-schedule', { method: 'POST', body: { sp_id: 'SP-DO-HOUSING', tier: 'monthly', call_count_30d: 50 } });
    await call('/sp-author/refresh-schedule', { method: 'POST', body: { sp_id: 'SP-DO-HOUSING', tier: 'weekly', call_count_30d: 210 } });
    assert.equal(db.sp_refresh_schedule.length, 1);
    assert.equal(db.sp_refresh_schedule[0].tier, 'weekly');
    assert.equal(db.sp_refresh_schedule[0].call_count_30d, 210);
  });
});

describe('SPA-08: /sp-author/refresh-due GET — 마감 도래 항목만 반환', () => {
  it('next_due_at이 과거인 항목만 포함, 미래인 항목은 제외', async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    db.sp_refresh_schedule.push(
      { id: 'r1', sp_id: 'SP-DUE-NOW', tier: 'weekly', next_due_at: yesterday },
      { id: 'r2', sp_id: 'SP-NOT-DUE', tier: 'monthly', next_due_at: nextMonth },
    );
    const { json } = await call('/sp-author/refresh-due');
    const ids = json.items.map(i => i.sp_id);
    assert.ok(ids.includes('SP-DUE-NOW'));
    assert.ok(!ids.includes('SP-NOT-DUE'));
  });
});
