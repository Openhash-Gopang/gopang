/**
 * M08 — Heatmap 모듈
 * GET /heatmap
 * 의존: M07 (location_log), Supabase RPC heatmap_by_lang()
 */

const COLOR_LEVELS = [
  { min: 1,   max: 10,  color: '#E1F5EE', label: 'teal-50'  },
  { min: 11,  max: 30,  color: '#9FE1CB', label: 'teal-100' },
  { min: 31,  max: 100, color: '#5DCAA5', label: 'teal-200' },
  { min: 101, max: 300, color: '#1D9E75', label: 'teal-400' },
  { min: 301, max: Infinity, color: '#0F6E56', label: 'teal-600' },
];

export function getColor(count) {
  for (const level of COLOR_LEVELS) {
    if (count >= level.min && count <= level.max) return level.color;
  }
  return COLOR_LEVELS[COLOR_LEVELS.length - 1].color;
}

const VALID_PERIODS = [1, 7, 14, 30];
const VALID_LANGS   = ['ko', 'zh', 'en', 'ja', 'vi', 'th', 'all'];

function parseParams(url) {
  const p = new URL(url).searchParams;
  const lang   = p.get('lang')   ?? 'all';
  const period = parseInt(p.get('period') ?? '7', 10);
  const zoom   = parseInt(p.get('zoom')   ?? '10', 10);
  return { lang, period, zoom };
}

function validateParams({ lang, period }) {
  if (!VALID_LANGS.includes(lang))
    return { error: 'INVALID_LANG', message: `lang must be one of: ${VALID_LANGS.join(', ')}` };
  if (!VALID_PERIODS.includes(period))
    return { error: 'INVALID_PERIOD', message: `period must be one of: ${VALID_PERIODS.join(', ')}` };
  return null;
}

/**
 * Supabase RPC heatmap_by_lang 호출
 * RPC signature: heatmap_by_lang(p_lang text, p_days int)
 * Returns: [{grid_lat, grid_lng, visit_count}]
 * k-익명성: count < 5 격자는 RPC HAVING 절에서 이미 제거됨
 */
async function fetchHeatmapData(env, lang, period) {
  const langParam = lang === 'all' ? null : lang;

  const resp = await fetch(
    `${env.SUPABASE_URL}/rest/v1/rpc/heatmap_by_lang`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': env.SUPABASE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_KEY}`,
      },
      body: JSON.stringify({ p_lang: langParam, p_days: period }),
    }
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Supabase RPC error: ${resp.status} ${text}`);
  }

  return resp.json();  // [{grid_lat, grid_lng, visit_count}]
}

/**
 * 격자 데이터 → cells 배열 변환
 * k-익명성 2차 방어: visit_count < 5 이중 필터
 */
function buildCells(rows) {
  return rows
    .filter(r => r.visit_count >= 5)
    .map(r => ({
      lat:   r.grid_lat,
      lng:   r.grid_lng,
      count: r.visit_count,
      color: getColor(r.visit_count),
    }));
}

export async function handleHeatmap(request, env) {
  const { lang, period, zoom } = parseParams(request.url);

  const validationError = validateParams({ lang, period });
  if (validationError) {
    return new Response(JSON.stringify(validationError), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let rows;
  try {
    rows = await fetchHeatmapData(env, lang, period);
  } catch (err) {
    return new Response(JSON.stringify({ error: 'SUPABASE_ERROR', message: err.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const cells = buildCells(rows);

  const body = JSON.stringify({
    lang,
    period,
    zoom,
    cells,
    count: cells.length,
    notice: '이 데이터는 집계 통계이며 개인을 식별하지 않습니다.',
    // v1.0 활성화 조건: cells가 비어 있으면 안내 문구 함께 반환
    ...(cells.length === 0 && { empty_reason: '참여자가 더 늘면 표시됩니다.' }),
  });

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',  // 5분 Cloudflare 캐시
    },
  });
}
