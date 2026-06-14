with open('worker.js', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. 라우터에 /p2p/search 추가
old_route = "    // ── 사용자 P2P 등록 (GDUDA Phase 1) ────────────────────────\n    if (pathname === '/p2p/register' && request.method === 'POST')\n      return handleP2PRegister(request, env, corsHeaders);"

new_route = """    // ── 사용자 P2P 등록/검색 (GDUDA Phase 1) ───────────────────
    if (pathname === '/p2p/register' && request.method === 'POST')
      return handleP2PRegister(request, env, corsHeaders);
    if (pathname === '/p2p/search'   && request.method === 'GET')
      return handleP2PSearch(request, env, corsHeaders);"""

if old_route in code:
    code = code.replace(old_route, new_route)
    print("[1] 라우터 추가 완료")
else:
    print("[1] 라우터 위치 못 찾음")

# 2. handleP2PSearch 함수를 handleP2PRegister 함수 바로 뒤에 추가
handler = """
// ═══════════════════════════════════════════════════════════
// GDUDA Phase 1 — /p2p/search
// global_profiles에서 닉네임 검색 (DHT 인덱스 노드 임시 대체)
// GET /p2p/search?q=James&country=US&region=New+York&limit=20
// ═══════════════════════════════════════════════════════════
async function handleP2PSearch(request, env, corsHeaders) {
  const url     = new URL(request.url);
  const q       = url.searchParams.get('q')?.trim();
  const country = url.searchParams.get('country')?.trim();
  const region  = url.searchParams.get('region')?.trim();
  const handle  = url.searchParams.get('handle')?.trim();
  const limit   = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);

  if (!q && !handle) return _err(400, 'QUERY_REQUIRED', 'q 또는 handle 파라미터 필수', corsHeaders);

  const sbH = _sbHeaders(env);
  let queryUrl = `${SUPABASE_URL}/rest/v1/global_profiles?is_public=eq.true&limit=${limit}`;
  queryUrl += `&select=guid,handle,nickname,country_code,region,current_l1`;

  // handle 직접 검색 (정확히 일치)
  if (handle) {
    const h = handle.startsWith('@') ? handle : '@' + handle;
    queryUrl += `&handle=eq.${encodeURIComponent(h)}`;
  } else {
    // 닉네임 부분 일치 (ilike)
    queryUrl += `&nickname=ilike.${encodeURIComponent('%' + q + '%')}`;
    if (country) queryUrl += `&country_code=eq.${encodeURIComponent(country)}`;
    if (region)  queryUrl += `&region=ilike.${encodeURIComponent('%' + region + '%')}`;
  }

  const res  = await fetch(queryUrl, { headers: sbH });
  const data = await res.json().catch(() => []);

  return new Response(JSON.stringify({
    ok:    true,
    users: data,
    count: data.length,
    query: { q, country, region, handle },
  }), { status: 200, headers: corsHeaders });
}

"""

anchor = "// ═══════════════════════════════════════════════════════════\n// GDUDA Phase 1 — /p2p/register"
if anchor in code:
    code = code.replace(anchor, handler + anchor)
    print("[2] handleP2PSearch 함수 추가 완료")
else:
    print("[2] handleP2PRegister 위치 못 찾음")

with open('worker.js', 'w', encoding='utf-8') as f:
    f.write(code)

print("완료")
