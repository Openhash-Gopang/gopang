/**
 * M11 Audit 모듈 테스트
 * node m11_audit.test.mjs
 */

import { sha256hex, computeMerkleRoot, buildPdvLogInsert, anchorL1MerkleRoot, handleMerkleVerify } from '../../profile2.0/audit.js';

let pass = 0, fail = 0;
function assert(id, cond, detail = '') {
  if (cond) { console.log(`  ✅ ${id}`); pass++; }
  else       { console.error(`  ❌ ${id}${detail ? ' — ' + detail : ''}`); fail++; }
}

// ── sha256 기본 동작 ───────────────────────────────────────────────
console.log('\n[sha256hex]');
{
  const h = await sha256hex('hello');
  assert('SHA-1', h.length === 64, `len=${h.length}`);
  assert('SHA-2', h === await sha256hex('hello'), '동일 입력 → 동일 해시');
  assert('SHA-3', h !== await sha256hex('world'));
}

// ── 머클 루트 계산 ─────────────────────────────────────────────────
console.log('\n[computeMerkleRoot]');
{
  assert('MK-empty', await computeMerkleRoot([]) === null);
  assert('MK-single', await computeMerkleRoot(['abc']) === 'abc');

  const h1 = await sha256hex('h1');
  const h2 = await sha256hex('h2');
  const root2 = await computeMerkleRoot([h1, h2]);
  assert('MK-2hashes', root2 === await sha256hex(h1 + h2));

  // 홀수 개: 마지막 복제
  const h3 = await sha256hex('h3');
  const root3 = await computeMerkleRoot([h1, h2, h3]);
  const expected = await computeMerkleRoot([await sha256hex(h1 + h2), await sha256hex(h3 + h3)]);
  assert('MK-3hashes-odd', root3 === expected, `root3=${root3}`);
}

// ── pdv_log INSERT 파라미터 ────────────────────────────────────────
console.log('\n[buildPdvLogInsert]');
{
  const env   = { SUPABASE_URL: 'https://mock', SUPABASE_KEY: 'anon' };
  const entry = { session_id: 'sess-1', chain_local_hash: 'abc', chain_height: 1 };
  const req   = buildPdvLogInsert(env, entry);
  assert('AU01-prefer', req.headers['Prefer'] === 'resolution=ignore-duplicates');
  assert('AU01-url', req.url.includes('/pdv_log'));
  assert('AU01-body', JSON.parse(req.body).session_id === 'sess-1');
}

// ── Cron anchorL1MerkleRoot ────────────────────────────────────────
console.log('\n[anchorL1MerkleRoot]');

// DB 메모리 시뮬레이터
let pdvStore     = [];
let anchorStore  = [];

global.fetch = async (url, opts = {}) => {
  if (url.includes('/pdv_log') && !opts.method) {
    const qs = new URL(url).searchParams;
    let rows = [...pdvStore];

    // 단건 id 조회
    const idParam = qs.get('id');
    if (idParam) {
      const id = idParam.replace('eq.', '');
      rows = rows.filter(r => r.id === id);
    }

    // 앵커 여부 필터
    const anchoredParam = qs.get('anchored');
    if (anchoredParam === 'eq.false') rows = rows.filter(r => !r.anchored);
    if (anchoredParam === 'eq.true')  rows = rows.filter(r => r.anchored);

    return { ok: true, json: async () => rows };
  }
  if (url.includes('/merkle_anchors') && opts.method === 'POST') {
    const data = JSON.parse(opts.body);
    anchorStore.push(data);
    return { ok: true, status: 201, json: async () => [data] };
  }
  if (url.includes('/pdv_log') && opts.method === 'PATCH') {
    const ids = url.match(/in\.\(([^)]+)\)/)?.[1].split(',') ?? [];
    for (const row of pdvStore) if (ids.includes(String(row.id))) row.anchored = true;
    return { ok: true, json: async () => [] };
  }
  if (url.includes('/merkle_anchors') && !opts.method) {
    const confirmed = anchorStore.filter(a => a.status === 'confirmed');
    return { ok: true, json: async () => confirmed.slice(-1) };
  }
  if (url.includes('/pdv_log') && url.includes('anchored=eq.true')) {
    return { ok: true, json: async () => pdvStore.filter(r => r.anchored) };
  }
  return { ok: false, status: 404, text: async () => 'not found' };
};

const env = { SUPABASE_URL: 'https://mock', SUPABASE_KEY: 'anon', SUPABASE_SERVICE_KEY: 'svc' };

// AU01 — 중복 pdv_log INSERT: 헤더 확인 (buildPdvLogInsert에서 이미 검증)
// AU03 — 머클 앵커링
{
  pdvStore = [
    { id: 'pdv-1', chain_local_hash: await sha256hex('tx1'), chain_height: 1, anchored: false },
    { id: 'pdv-2', chain_local_hash: await sha256hex('tx2'), chain_height: 2, anchored: false },
    { id: 'pdv-3', chain_local_hash: await sha256hex('tx3'), chain_height: 3, anchored: false },
  ];
  anchorStore = [];

  const result = await anchorL1MerkleRoot(env);
  assert('AU03-ok',      result.ok === true, `result=${JSON.stringify(result)}`);
  assert('AU03-count',   result.pdv_count === 3);
  assert('AU03-anchored', pdvStore.every(r => r.anchored));
  assert('AU03-status',  anchorStore[0]?.status === 'confirmed');
}

// 빈 미앵커링 → 스킵
{
  pdvStore = [
    { id: 'pdv-1', chain_local_hash: 'h1', anchored: true },
  ];
  const result = await anchorL1MerkleRoot(env);
  assert('AU03-skip', result.skipped === true && result.reason === 'no_unanchored');
}

// ── /merkle/verify ─────────────────────────────────────────────────
console.log('\n[handleMerkleVerify]');

function makeRequest(pdvId) {
  return { url: `https://mock/merkle/verify?pdv_id=${pdvId}` };
}

// AU04 — 검증 성공
{
  const h1 = await sha256hex('tx-a');
  const h2 = await sha256hex('tx-b');
  const root = await computeMerkleRoot([h1, h2]);

  pdvStore = [
    { id: 'pdv-a', chain_local_hash: h1, chain_height: 1, anchored: true },
    { id: 'pdv-b', chain_local_hash: h2, chain_height: 2, anchored: true },
  ];
  anchorStore = [{ merkle_root: root, status: 'confirmed' }];

  const res  = await handleMerkleVerify(makeRequest('pdv-a'), env);
  const data = await res.json();
  assert('AU04-valid',    data.valid === true, `data=${JSON.stringify(data)}`);
  assert('AU04-included', data.pdv_included === true);
  assert('AU04-root',     data.merkle_root === root);
}

// 미앵커링 pdv → valid=false
{
  pdvStore   = [{ id: 'pdv-x', chain_local_hash: 'h', anchored: false }];
  anchorStore = [];
  const res  = await handleMerkleVerify(makeRequest('pdv-x'), env);
  const data = await res.json();
  assert('AU04-notAnchored', data.valid === false && data.reason === 'NOT_ANCHORED');
}

// pdv_id 없음 → 400
{
  const res = await handleMerkleVerify({ url: 'https://mock/merkle/verify' }, env);
  assert('AU04-missing', res.status === 400);
}

// AU05 — chain_height 연속성은 Supabase View p2_chain_height_gap 에서 처리
// 여기서는 머클 루트 재계산 정확성으로 대체 검증
{
  const hashes = [
    await sha256hex('block1'),
    await sha256hex('block2'),
    await sha256hex('block3'),
    await sha256hex('block4'),
  ];
  const root1 = await computeMerkleRoot(hashes);
  const root2 = await computeMerkleRoot(hashes);
  assert('AU05-deterministic', root1 === root2, '동일 입력 → 동일 루트');
  assert('AU05-notNull', root1 !== null && root1.length === 64);
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
if (fail > 0) process.exit(1);
