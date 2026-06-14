import re

with open(r'worker.js', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. 라우터에 /p2p/register 추가
old_route = "    // ── 사용자 검색 (GDUDA Phase 1) ──────────────────────────\n    if (pathname === '/search/users')  return handleSearchUsers(request, env, corsHeaders);"
new_route = """    // ── 사용자 P2P 등록 (GDUDA Phase 1) ────────────────────────
    if (pathname === '/p2p/register' && request.method === 'POST')
      return handleP2PRegister(request, env, corsHeaders);

    // ── 사용자 검색 (GDUDA Phase 1) ──────────────────────────
    if (pathname === '/search/users')  return handleSearchUsers(request, env, corsHeaders);"""

if old_route in code:
    code = code.replace(old_route, new_route)
    print("[1] 라우터 추가 완료")
else:
    print("[1] 라우터 위치 못 찾음")

# 2. handleP2PRegister 함수를 handleSearchUsers 함수 바로 앞에 추가
handler = """
// ═══════════════════════════════════════════════════════════
// GDUDA Phase 1 — /p2p/register
// global_profiles에 사용자 등록 (HLR 역할)
// ═══════════════════════════════════════════════════════════
async function handleP2PRegister(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', '', corsHeaders);

  const { guid, handle, nickname, nickname_hash, country_code, region, current_l1 } = body;
  if (!guid)   return _err(400, 'MISSING_FIELDS', 'guid 필수', corsHeaders);
  if (!handle) return _err(400, 'MISSING_FIELDS', 'handle 필수', corsHeaders);

  const sbH = _sbServiceHeaders(env);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/global_profiles`, {
    method: 'POST',
    headers: { ...sbH, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      guid, handle, nickname: nickname || null,
      nickname_hash: nickname_hash || null,
      country_code:  country_code  || null,
      region:        region        || null,
      current_l1:    current_l1   || 'https://l1-hanlim.gopang.net',
      l1_updated_at: new Date().toISOString(),
      is_public: true,
    }),
  });

  if (!res.ok) return _err(500, 'DB_ERROR', await res.text(), corsHeaders);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
}

"""

anchor = "async function handleSearchUsers(request, env, corsHeaders) {"
if anchor in code:
    code = code.replace(anchor, handler + anchor)
    print("[2] handleP2PRegister 함수 추가 완료")
else:
    print("[2] handleSearchUsers 위치 못 찾음")

with open(r'worker.js', 'w', encoding='utf-8') as f:
    f.write(code)

print("완료")
