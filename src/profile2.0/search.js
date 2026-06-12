/**
 * M12 — Search 모듈
 * GET /search?q=...&lang=...&type=...&limit=...
 * 의존: M07 (위치 정렬 — 선택적)
 */

const VALID_TYPES = ['org', 'institution', 'consumer', 'all'];
const SUPPORTED_LANGS = ['ko', 'zh', 'en', 'ja', 'vi', 'th'];

// ── 번역 헬퍼 ─────────────────────────────────────────────────────
async function translateText(env, text, fromLang, toLang) {
  if (!text || fromLang === toLang) return text;
  try {
    const resp = await fetch(`${env.WORKER_BASE_URL}/interpret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, from_lang: fromLang, to_lang: toLang }),
    });
    if (!resp.ok) return text;
    const { translated } = await resp.json();
    return translated ?? text;
  } catch {
    return text;
  }
}

// ── Supabase search_entities RPC ──────────────────────────────────
async function searchEntitiesRPC(env, keyword, type, limit) {
  const body = {
    p_keyword: keyword,
    p_type:    type === 'all' ? null : type,
    p_limit:   limit,
  };
  const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/search_entities`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': env.SUPABASE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) return [];
  return resp.json();
}

// ── GET /search ────────────────────────────────────────────────────
export async function handleSearch(request, env) {
  const p     = new URL(request.url).searchParams;
  const q     = (p.get('q') ?? '').trim();
  const lang  = p.get('lang') ?? 'ko';
  const type  = p.get('type') ?? 'all';
  const limit = Math.min(parseInt(p.get('limit') ?? '20', 10), 100);

  if (!q) return jsonResp({ error: 'MISSING_QUERY', message: 'q 파라미터 필수' }, 400);
  if (!VALID_TYPES.includes(type))
    return jsonResp({ error: 'INVALID_TYPE', message: `type must be one of: ${VALID_TYPES.join(', ')}` }, 400);

  // 다국어 쿼리 → 한국어 번역
  const koQuery = await translateText(env, q, lang, 'ko');

  // Supabase 검색
  const rawResults = await searchEntitiesRPC(env, koQuery, type, limit);

  if (rawResults.length === 0) {
    return jsonResp({ query: q, translated_query: koQuery, lang, results: [] });
  }

  // 결과 번역 (한국어 → viewer 언어)
  const results = await Promise.all(
    rawResults.map(async entity => {
      const name    = await translateText(env, entity.name,    'ko', lang);
      const address = await translateText(env, entity.address, 'ko', lang);
      return { ...entity, name, address };
    })
  );

  return jsonResp({ query: q, translated_query: koQuery, lang, results, count: results.length });
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
