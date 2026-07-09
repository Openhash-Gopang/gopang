/**
 * phase11_orchestration_registry_and_ksearch.test.mjs
 *
 * 2026-07-09 하루 동안 흩어져서 고친 것들(worker.js 오케스트레이션
 * 레지스트리 3곳 + call-ai.js K-Search 배선)을 한 번도 통합으로
 * 흔들어보지 않았다는 지적에 따른 검증. 실제 L1 PocketBase(Oracle
 * Cloud)에는 여기서 붙을 수 없으므로, worker.js의 fetch 호출을
 * mock으로 대체해 "라우팅 → 핸들러 → L1 헬퍼 → fetch" 경계까지만
 * 검증한다. call-ai.js는 브라우저 전역(window/document/location 등)에
 * 깊게 의존해 전체 모듈 import가 안 되므로, 문제의 순수 함수
 * (_stripBracketTag/_stripInternalTags)만 실제 소스에서 그대로
 * 추출해 격리 테스트한다(재구현이 아니라 실제 배포되는 코드 자체를
 * 추출해서 돌린다 — 사본이 원본과 달라질 위험 없음).
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

// ══════════════════════════════════════════════════════════════════
// 픽스처 — 가짜 L1 PocketBase (컬렉션별 in-memory 배열 + 최소 filter 파싱)
// ══════════════════════════════════════════════════════════════════

let db;       // { org_profiles: [...], atom_rows: [...], procedure_maps: [...] }
let authCalls;
let idSeq;

function resetDb() {
  db = { org_profiles: [], atom_rows: [], procedure_maps: [] };
  authCalls = 0;
  idSeq = 0;
}

// filter 문자열 "field='value'" 하나만 파싱(현재 worker.js가 실제로 만드는
// filter 형태 — org_id/atom_id/goal 단일 등치 조건뿐이라 이 정도면 충분).
function parseEqFilter(filter) {
  const m = decodeURIComponent(filter).match(/^(\w+)='(.*)'$/);
  if (!m) throw new Error(`mock: filter 파싱 실패: ${filter}`);
  return { field: m[1], value: m[2].replace(/\\'/g, "'") };
}

function installMockFetch() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));

    // ── admin 인증 ──────────────────────────────────────────────
    if (u.pathname === '/api/admins/auth-with-password') {
      authCalls++;
      return new Response(JSON.stringify({ token: 'mock-admin-token' }), { status: 200 });
    }

    const collMatch = u.pathname.match(/^\/api\/collections\/(\w+)\/records\/?(.*)$/);
    if (!collMatch) throw new Error(`mock: 처리 못하는 경로: ${u.pathname}`);
    const [, collection, recordId] = collMatch;
    if (!db[collection]) throw new Error(`mock: 알 수 없는 컬렉션: ${collection}`);

    // ── LIST (filter 조회) ──────────────────────────────────────
    if ((!init.method || init.method === 'GET') && !recordId) {
      const filter = u.searchParams.get('filter');
      let items = db[collection];
      if (filter) {
        const { field, value } = parseEqFilter(filter);
        items = items.filter(r => r[field] === value);
      }
      return new Response(JSON.stringify({ items, page: 1, perPage: 1, totalItems: items.length }), { status: 200 });
    }

    // ── CREATE ──────────────────────────────────────────────────
    if (init.method === 'POST' && !recordId) {
      const body = JSON.parse(init.body);
      const rec = { id: `mock_${collection}_${++idSeq}`, ...body };
      db[collection].push(rec);
      return new Response(JSON.stringify(rec), { status: 200 });
    }

    // ── PATCH ───────────────────────────────────────────────────
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
// worker.js 로드 (mock 설치 후 — 모듈 자체는 부작용 없이 로드됨)
// ══════════════════════════════════════════════════════════════════

let worker, restoreFetch;
const ENV = { L1_ADMIN_EMAIL: 'admin@test', L1_ADMIN_PASSWORD: 'pw' };

before(async () => {
  restoreFetch = installMockFetch();
  worker = (await import('../../../worker.js')).default;
});

beforeEach(() => {
  resetDb();
  // _l1AdminTokenCache는 worker.js 모듈 스코프에 캐시되므로(25분) 매
  // 테스트마다 재인증을 강제할 수 없다 — 그래도 무해하다: 캐시된
  // 토큰이면 mock이 어떤 값이든 그대로 받아주므로 로직 검증에는 영향
  // 없다(authCalls 카운트만 테스트 실행 순서에 따라 달라질 뿐).
});

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
// N-01~N-07: org_profiles / atom_rows POST 생성 엔드포인트
// ══════════════════════════════════════════════════════════════════

describe('N-01: org-profile/draft 정상 생성', () => {
  it('pending_review로만 생성되고 필드가 그대로 저장됨', async () => {
    const { status, json } = await call('/orchestration/org-profile/draft', {
      method: 'POST',
      body: { org_id: 'court-jeju', org_name: '제주지방법원', branch: 'judicial' },
    });
    assert.equal(status, 200);
    assert.equal(json.status, 'created');
    assert.ok(json.id);
    const stored = db.org_profiles.find(r => r.id === json.id);
    assert.equal(stored.status, 'pending_review', '생성 시점에 active면 안 됨');
    assert.equal(stored.org_name, '제주지방법원');
  });
});

describe('N-02: org-profile/draft 중복 org_id', () => {
  it('이미 있으면 409', async () => {
    await call('/orchestration/org-profile/draft', {
      method: 'POST', body: { org_id: 'dup-org', org_name: 'A', branch: 'admin_local' },
    });
    const second = await call('/orchestration/org-profile/draft', {
      method: 'POST', body: { org_id: 'dup-org', org_name: 'B', branch: 'admin_local' },
    });
    assert.equal(second.status, 409);
    assert.equal(second.json.error, 'already exists');
    assert.equal(db.org_profiles.length, 1, '중복 생성이 실제로 막혔는지');
  });
});

describe('N-03: org-profile/draft 필수 필드 누락', () => {
  it('branch 없으면 400', async () => {
    const { status, json } = await call('/orchestration/org-profile/draft', {
      method: 'POST', body: { org_id: 'x', org_name: 'y' },
    });
    assert.equal(status, 400);
    assert.match(json.error, /branch/);
  });
});

describe('N-04: atom-row/draft 정상 생성 — connected 기본값', () => {
  it('connected를 안 넘기면 false로 저장됨(거짓 자동화 방지)', async () => {
    const { status, json } = await call('/orchestration/atom-row/draft', {
      method: 'POST',
      body: { atom_id: 'court-filing', pattern: 'ADJUDICATE' },
    });
    assert.equal(status, 200);
    const stored = db.atom_rows.find(r => r.id === json.id);
    assert.equal(stored.status, 'pending_review');
    assert.equal(stored.connected, false);
  });
});

describe('N-05: atom-row/draft — connected:true 명시', () => {
  it('명시적으로 true를 주면 그대로 저장됨', async () => {
    const { json } = await call('/orchestration/atom-row/draft', {
      method: 'POST',
      body: { atom_id: 'gov24-family-cert', pattern: 'QUERY', connected: true, automation_sp: 'GOVSYS-GOV24-FAMILY-CERT' },
    });
    const stored = db.atom_rows.find(r => r.id === json.id);
    assert.equal(stored.connected, true);
  });
});

describe('N-06: atom-row/draft 잘못된 pattern', () => {
  it('VALID_PATTERNS 밖이면 400', async () => {
    const { status, json } = await call('/orchestration/atom-row/draft', {
      method: 'POST', body: { atom_id: 'x', pattern: 'FOO' },
    });
    assert.equal(status, 400);
    assert.match(json.error, /REPORT/);
  });
});

describe('N-07: atom-row/draft 중복 atom_id', () => {
  it('이미 있으면 409', async () => {
    await call('/orchestration/atom-row/draft', { method: 'POST', body: { atom_id: 'dup-atom', pattern: 'QUERY' } });
    const second = await call('/orchestration/atom-row/draft', { method: 'POST', body: { atom_id: 'dup-atom', pattern: 'PAY' } });
    assert.equal(second.status, 409);
    assert.equal(db.atom_rows.length, 1);
  });
});

// ══════════════════════════════════════════════════════════════════
// N-08~N-11: 새 생성 경로 → 기존 execute-atom 경로가 실제로 맞물리는지
// (이게 오늘의 핵심 통합 지점 — 각각은 어제/오늘 따로 짠 코드)
// ══════════════════════════════════════════════════════════════════

describe('N-08: 방금 심은 atom은 execute-atom에서 바로 실행되면 안 됨', () => {
  it('atom-row/draft 직후 status=pending_review이므로 execute-atom은 not_active를 반환', async () => {
    const created = await call('/orchestration/atom-row/draft', {
      method: 'POST', body: { atom_id: 'fresh-atom', pattern: 'QUERY' },
    });
    assert.equal(created.status, 200);

    const exec = await call('/orchestration/execute-atom', {
      method: 'POST', body: { atom_id: 'fresh-atom', atom_input: {} },
    });
    assert.equal(exec.json.status, 'not_active');
  });

  it('★ 2026-07-09 메움: atom-row/update로 active 승격 후에는 execute-atom이 정상 실행됨', async () => {
    await call('/orchestration/atom-row/draft', {
      method: 'POST', body: { atom_id: 'promotable-atom', pattern: 'QUERY' },
    });
    const notYet = await call('/orchestration/execute-atom', {
      method: 'POST', body: { atom_id: 'promotable-atom' },
    });
    assert.equal(notYet.json.status, 'not_active', '승격 전에는 여전히 막혀야 함');

    const updated = await call('/orchestration/atom-row/update', {
      method: 'POST',
      body: { atom_id: 'promotable-atom', changes: [{ field: 'status', value: 'active' }] },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.json.status, 'updated');
    assert.equal(updated.json.record.status, 'active');

    const nowExec = await call('/orchestration/execute-atom', {
      method: 'POST', body: { atom_id: 'promotable-atom' },
    });
    assert.equal(nowExec.json.status, 'requires_user_action', '승격 후에는 실제 패턴 로직까지 도달해야 함');
    assert.equal(nowExec.json.pattern, 'QUERY');
  });

  it('atom-row/update — 존재하지 않는 atom_id는 404', async () => {
    const { status, json } = await call('/orchestration/atom-row/update', {
      method: 'POST', body: { atom_id: 'no-such-atom', changes: [{ field: 'status', value: 'active' }] },
    });
    assert.equal(status, 404);
    assert.equal(json.error, 'not found');
  });
});

describe('N-16: org-profile/update — 승격 + 일반 필드 갱신, as_of_date 자동 갱신', () => {
  it('changes로 status를 active로 올리고 as_of_date가 오늘 날짜로 갱신됨', async () => {
    await call('/orchestration/org-profile/draft', {
      method: 'POST', body: { org_id: 'promotable-org', org_name: '원래이름', branch: 'admin_local' },
    });
    const today = new Date().toISOString().slice(0, 10);

    const updated = await call('/orchestration/org-profile/update', {
      method: 'POST',
      body: {
        org_id: 'promotable-org',
        changes: [{ field: 'status', value: 'active' }, { field: 'org_name', value: '검토후이름' }],
      },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.json.record.status, 'active');
    assert.equal(updated.json.record.org_name, '검토후이름');
    assert.equal(updated.json.record.as_of_date, today);
  });

  it('org-profile/update — 존재하지 않는 org_id는 404', async () => {
    const { status, json } = await call('/orchestration/org-profile/update', {
      method: 'POST', body: { org_id: 'no-such-org', changes: [] },
    });
    assert.equal(status, 404);
    assert.equal(json.error, 'not found');
  });
});

describe('N-09: active + connected:false → pattern별 정직한 requires_user_action', () => {
  it('QUERY 패턴: 조회·발급 절차 안내', async () => {
    db.atom_rows.push({ id: 'a1', atom_id: 'gov24-cert', pattern: 'QUERY', status: 'active', connected: false });
    const { json } = await call('/orchestration/execute-atom', {
      method: 'POST', body: { atom_id: 'gov24-cert' },
    });
    assert.equal(json.status, 'requires_user_action');
    assert.equal(json.pattern, 'QUERY');
    assert.match(json.reason, /본인인증/);
  });

  it('ADJUDICATE 패턴: escalation_to가 결과에 실림', async () => {
    db.atom_rows.push({
      id: 'a2', atom_id: 'court-filing', pattern: 'ADJUDICATE', status: 'active', connected: false,
      escalation_to: 'appeal-court-filing',
    });
    const { json } = await call('/orchestration/execute-atom', {
      method: 'POST', body: { atom_id: 'court-filing' },
    });
    assert.equal(json.status, 'requires_user_action');
    assert.equal(json.escalation_to, 'appeal-court-filing');
  });
});

describe('N-10: active + connected:true인데 automation_sp가 미등록 — 거짓 자동화 금지', () => {
  it('GOVSYS_FUNCTIONS 표가 비어있으므로 automated로 둔갑하지 않고 requires_user_action 유지', async () => {
    db.atom_rows.push({
      id: 'a3', atom_id: 'biz-registration', pattern: 'REPORT', status: 'active',
      connected: true, automation_sp: 'GOVSYS-NOT-REGISTERED-YET', creates_new_status: true,
    });
    const { json } = await call('/orchestration/execute-atom', {
      method: 'POST', body: { atom_id: 'biz-registration' },
    });
    assert.equal(json.status, 'requires_user_action',
      'connected:true만으로 자동화된 것처럼 보이면 안 된다 — automation_sp가 실제 구현돼야 한다');
    assert.match(json.reason, /창설적 신고/);
  });
});

describe('N-11: execute-atom — 존재하지 않는 atom_id', () => {
  it('miss 반환(500/예외 아님)', async () => {
    const { status, json } = await call('/orchestration/execute-atom', {
      method: 'POST', body: { atom_id: 'no-such-atom' },
    });
    assert.equal(status, 200);
    assert.equal(json.status, 'miss');
  });
});

describe('N-12: org-profile 전체 왕복 — draft 생성 후 GET 조회', () => {
  it('생성 직후 GET하면 hit_pending_review로 뜸', async () => {
    await call('/orchestration/org-profile/draft', {
      method: 'POST', body: { org_id: 'roundtrip-org', org_name: 'T', branch: 'judicial' },
    });
    const { json } = await call('/orchestration/org-profile', { search: { org_id: 'roundtrip-org' } });
    assert.equal(json.status, 'hit_pending_review');
    assert.equal(json.org.org_name, 'T');
  });
});

// ══════════════════════════════════════════════════════════════════
// N-13~N-15: call-ai.js의 K-Search 관련 순수 함수 (실제 소스에서 추출)
// ══════════════════════════════════════════════════════════════════

function loadStripFns() {
  const src = readFileSync(path.join(REPO_ROOT, 'src/gopang/ai/call-ai.js'), 'utf-8');
  const fnMatch = src.match(/function _stripBracketTag\(text, tagName\) \{[\s\S]*?\n\}\n/);
  const chainMatch = src.match(/export const _stripInternalTags = [\s\S]*?\n  \.trim\(\);\n/);
  assert.ok(fnMatch, '_stripBracketTag를 call-ai.js에서 찾지 못함 — 함수 시그니처가 바뀌었나?');
  assert.ok(chainMatch, '_stripInternalTags를 call-ai.js에서 찾지 못함');
  const body = fnMatch[0] + '\n' + chainMatch[0].replace('export const', 'const') +
    '\nreturn { _stripBracketTag, _stripInternalTags };\n';
  // eslint-disable-next-line no-new-func
  return new Function(body)();
}

describe('N-13: _stripBracketTag — 중첩 배열 값을 가진 태그를 정확히 통째로 지움', () => {
  const { _stripBracketTag } = loadStripFns();

  it('KSEARCH_CANDIDATES처럼 배열 안에 ]가 여러 번 나와도 첫 ]에서 안 멈춤(★ 실제 버그였던 케이스)', () => {
    const text = '안내 텍스트 [KSEARCH_CANDIDATES: items=[{"a":1},{"b":[2,3]}]] 뒤에 이어지는 문장';
    const out = _stripBracketTag(text, 'KSEARCH_CANDIDATES');
    assert.equal(out, '안내 텍스트  뒤에 이어지는 문장');
    assert.ok(!out.includes('KSEARCH_CANDIDATES'));
    assert.ok(!out.includes(']'), '태그 뒷부분이 잘려서 노출되면 안 됨(옛 정규식 버그 재현 방지)');
  });

  it('태그가 없으면 원문 그대로', () => {
    const text = '태그가 전혀 없는 평범한 문장입니다.';
    assert.equal(_stripBracketTag(text, 'PROCEDURE_MAP_DRAFT'), text);
  });

  it('같은 태그가 여러 번 나오면 전부 지움', () => {
    const text = '[PROCEDURE_MAP_DRAFT: a=[1]] 중간 [PROCEDURE_MAP_DRAFT: b=[2,[3,4]]] 끝';
    const out = _stripBracketTag(text, 'PROCEDURE_MAP_DRAFT');
    assert.equal(out, ' 중간  끝');
  });

  it('짝이 안 맞으면(응답 잘림) 무한루프 없이 안전하게 중단', () => {
    const text = '[KSEARCH_CANDIDATES: items=[1,2 이후로 잘린 응답';
    // 무한루프에 걸리면 이 assert 자체가 타임아웃으로 실패한다.
    const out = _stripBracketTag(text, 'KSEARCH_CANDIDATES');
    assert.ok(typeof out === 'string');
  });
});

describe('N-14: _stripInternalTags — K-Search 태그 체인이 실제로 strip 목록에 들어있음', () => {
  const { _stripInternalTags } = loadStripFns();

  it('KSEARCH_HANDOFF/RESULT/CLARIFY/HANDOFF_BACK 전부 제거', () => {
    const text = '앞 [KSEARCH_HANDOFF: query=제주 맛집] 중간1 [KSEARCH_RESULT: n=3] ' +
      '중간2 [KSEARCH_CLARIFY: options=a,b] 중간3 [KSEARCH_HANDOFF_BACK: reason=done] 뒤';
    const out = _stripInternalTags(text);
    for (const tag of ['KSEARCH_HANDOFF', 'KSEARCH_RESULT', 'KSEARCH_CLARIFY', 'KSEARCH_HANDOFF_BACK']) {
      assert.ok(!out.includes(tag), `${tag}가 안 지워짐`);
    }
    assert.match(out, /앞.*중간1.*중간2.*중간3.*뒤/s);
  });

  it('중첩 배열 태그(PROCEDURE_MAP_DRAFT)와 뒤이은 단순 태그가 함께 있어도 둘 다 지워짐', () => {
    const text = '결과: [PROCEDURE_MAP_DRAFT: goal=x, steps=[{"atom_id":"a"},{"atom_id":"b"}]] ' +
      '완료 [ORCHESTRATION_COMPLETE: summary=ok]';
    const out = _stripInternalTags(text);
    assert.ok(!out.includes('PROCEDURE_MAP_DRAFT'));
    assert.ok(!out.includes('ORCHESTRATION_COMPLETE'));
    assert.equal(out, '결과:  완료');
  });
});
