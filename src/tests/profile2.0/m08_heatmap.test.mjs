/**
 * M08 Heatmap 모듈 테스트
 * node --experimental-vm-modules src/tests/profile2.0/m08_heatmap.test.mjs
 */

import { getColor, handleHeatmap } from '/home/claude/heatmap.js';

let pass = 0;
let fail = 0;

function assert(id, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ ${id}`);
    pass++;
  } else {
    console.error(`  ❌ ${id}${detail ? ' — ' + detail : ''}`);
    fail++;
  }
}

// ── 색상 매핑 유틸리티 테스트 ─────────────────────────────────────
console.log('\n[getColor]');
assert('COLOR-1',  getColor(1)   === '#E1F5EE', `got ${getColor(1)}`);
assert('COLOR-10', getColor(10)  === '#E1F5EE');
assert('COLOR-11', getColor(11)  === '#9FE1CB');
assert('COLOR-30', getColor(30)  === '#9FE1CB');
assert('COLOR-31', getColor(31)  === '#5DCAA5');
assert('COLOR-100',getColor(100) === '#5DCAA5');
assert('COLOR-101',getColor(101) === '#1D9E75');
assert('COLOR-300',getColor(300) === '#1D9E75');
assert('COLOR-301',getColor(301) === '#0F6E56');
assert('COLOR-999',getColor(999) === '#0F6E56');

// ── Mock 환경 ─────────────────────────────────────────────────────
function makeEnv(rows) {
  return {
    SUPABASE_URL: 'https://mock.supabase.co',
    SUPABASE_KEY: 'anon-key',
    _mockRows: rows,
  };
}

// fetch mock
global.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  const env  = global.__mockEnv;
  let rows   = env._mockRows;

  // lang 필터 적용 (p_lang=null → all)
  if (body.p_lang !== null) {
    rows = rows.filter(r => r.native_lang === body.p_lang);
  }

  // period 필터 (p_days 기준으로 최근 데이터만)
  const cutoff = Date.now() - body.p_days * 24 * 60 * 60 * 1000;
  rows = rows.filter(r => r.ts > cutoff);

  // HAVING count >= 5 (k-익명성 — RPC 역할 시뮬레이션)
  const grouped = {};
  for (const r of rows) {
    const key = `${r.grid_lat},${r.grid_lng}`;
    grouped[key] = (grouped[key] || 0) + 1;
  }

  const result = Object.entries(grouped)
    .filter(([, count]) => count >= 5)
    .map(([key, count]) => {
      const [lat, lng] = key.split(',').map(Number);
      return { grid_lat: lat, grid_lng: lng, visit_count: count };
    });

  return {
    ok: true,
    json: async () => result,
  };
};

function makeRequest(params) {
  const url = new URL('https://hondi.net/heatmap');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return { url: url.toString() };
}

// 현재 시각
const now = Date.now();
const day = 24 * 60 * 60 * 1000;

// 6개 격자 × 5명 = 30건 데이터
function makeRows(lang, gridLat, gridLng, count, tsOffset = 0) {
  return Array.from({ length: count }, () => ({
    native_lang: lang,
    grid_lat: gridLat,
    grid_lng: gridLng,
    ts: now - tsOffset,
  }));
}

// ── 핸들러 테스트 ──────────────────────────────────────────────────
console.log('\n[handleHeatmap]');

// H01 — 정상 집계
{
  const rows = [
    ...makeRows('zh', 33.39, 126.24, 7),
    ...makeRows('zh', 33.40, 126.25, 12),
  ];
  global.__mockEnv = makeEnv(rows);
  const res  = await handleHeatmap(makeRequest({ lang: 'zh', period: '7' }), global.__mockEnv);
  const data = await res.json();
  assert('H01', res.status === 200 && data.cells.length === 2,
    `status=${res.status} cells=${data.cells.length}`);
}

// H02 — k-익명성 필터 (count < 5 제외)
{
  const rows = [
    ...makeRows('zh', 33.39, 126.24, 3),  // 3 < 5 → 제외
    ...makeRows('zh', 33.40, 126.25, 8),  // 8 ≥ 5 → 포함
  ];
  global.__mockEnv = makeEnv(rows);
  const res  = await handleHeatmap(makeRequest({ lang: 'zh', period: '7' }), global.__mockEnv);
  const data = await res.json();
  assert('H02', data.cells.length === 1 && data.cells[0].count === 8,
    `cells=${data.cells.length}`);
}

// H03 — consent=false 제외 (RPC에서 이미 필터링됨 → 모의 데이터에 비동의 없음)
{
  // consent=true 레코드만 있는 상황 (consent=false는 heatmap_by_lang RPC 내부 필터)
  const rows = makeRows('ko', 33.39, 126.24, 6);
  global.__mockEnv = makeEnv(rows);
  const res  = await handleHeatmap(makeRequest({ lang: 'ko', period: '7' }), global.__mockEnv);
  const data = await res.json();
  assert('H03', data.cells.length === 1, `consent 필터 위임 정상, cells=${data.cells.length}`);
}

// H04 — lang=all
{
  const rows = [
    ...makeRows('zh', 33.39, 126.24, 6),
    ...makeRows('en', 33.39, 126.24, 6),
    ...makeRows('ja', 33.40, 126.25, 6),
  ];
  global.__mockEnv = makeEnv(rows);
  const res  = await handleHeatmap(makeRequest({ lang: 'all', period: '7' }), global.__mockEnv);
  const data = await res.json();
  // lang=all → p_lang=null → 전체 18건 → 2개 격자
  assert('H04', data.cells.length === 2, `all-lang cells=${data.cells.length}`);
}

// H05 — 빈 데이터 (신규 파일럿)
{
  global.__mockEnv = makeEnv([]);
  const res  = await handleHeatmap(makeRequest({ lang: 'zh', period: '7' }), global.__mockEnv);
  const data = await res.json();
  assert('H05',
    data.cells.length === 0 && typeof data.empty_reason === 'string',
    `empty_reason=${data.empty_reason}`);
}

// H06 — Cloudflare 캐시 헤더 확인
{
  const rows = makeRows('zh', 33.39, 126.24, 5);
  global.__mockEnv = makeEnv(rows);
  const res = await handleHeatmap(makeRequest({ lang: 'zh', period: '7' }), global.__mockEnv);
  const cc  = res.headers.get('Cache-Control') ?? '';
  assert('H06', cc.includes('max-age=300'), `Cache-Control=${cc}`);
}

// H07 — period 경계: 25시간 전 레코드는 period=1에서 제외
{
  const rows = [
    ...makeRows('zh', 33.39, 126.24, 6, 25 * 60 * 60 * 1000 + 1000),  // 25시간 + 1초 전 → 제외
    ...makeRows('zh', 33.40, 126.25, 6, 60 * 60 * 1000),               // 1시간 전 → 포함
  ];
  global.__mockEnv = makeEnv(rows);
  const res  = await handleHeatmap(makeRequest({ lang: 'zh', period: '1' }), global.__mockEnv);
  const data = await res.json();
  assert('H07', data.cells.length === 1, `period=1 boundary cells=${data.cells.length}`);
}

// H08 — 잘못된 lang 파라미터
{
  global.__mockEnv = makeEnv([]);
  const res  = await handleHeatmap(makeRequest({ lang: 'fr', period: '7' }), global.__mockEnv);
  const data = await res.json();
  assert('H08', res.status === 400 && data.error === 'INVALID_LANG');
}

// H09 — 잘못된 period 파라미터
{
  global.__mockEnv = makeEnv([]);
  const res  = await handleHeatmap(makeRequest({ lang: 'zh', period: '99' }), global.__mockEnv);
  const data = await res.json();
  assert('H09', res.status === 400 && data.error === 'INVALID_PERIOD');
}

// ── 결과 ──────────────────────────────────────────────────────────
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
if (fail > 0) process.exit(1);
