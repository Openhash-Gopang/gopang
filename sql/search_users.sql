-- ============================================================
-- search_users.sql — 고팡 사용자/프로필 통합 검색 RPC
-- 저장위치: gopang/sql/search_users.sql
-- 실행: Supabase SQL Editor (search_index.sql 실행 후)
-- ============================================================

-- ── search_users RPC ─────────────────────────────────────────
-- GET /search/users?q=키워드 → Worker → Supabase RPC
-- handle 정확 매칭 우선, 이후 FTS 랭킹 순
CREATE OR REPLACE FUNCTION search_users(
  q        TEXT    DEFAULT '',
  limit_n  INT     DEFAULT 20
)
RETURNS TABLE (
  guid        TEXT,
  handle      TEXT,
  name        TEXT,
  entity_type TEXT,
  address     TEXT,
  search_tags TEXT[],
  extra       JSONB,
  match_type  TEXT    -- 'handle_exact' | 'name_prefix' | 'fts'
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  tsq TSQUERY;
BEGIN
  IF q IS NULL OR trim(q) = '' THEN RETURN; END IF;

  -- 1) handle 정확 매칭 (@handle 또는 handle)
  RETURN QUERY
    SELECT p.guid, p.handle, p.name, p.entity_type,
           p.address, p.search_tags, p.extra,
           'handle_exact'::TEXT
    FROM user_profiles p
    WHERE p.is_public = TRUE
      AND (p.handle = q OR p.handle = '@' || q)
    LIMIT limit_n;

  -- 2) 이름 prefix 매칭 (이미 handle로 찾은 경우 제외)
  RETURN QUERY
    SELECT p.guid, p.handle, p.name, p.entity_type,
           p.address, p.search_tags, p.extra,
           'name_prefix'::TEXT
    FROM user_profiles p
    WHERE p.is_public = TRUE
      AND p.name ILIKE q || '%'
      AND NOT (p.handle = q OR p.handle = '@' || q)
    ORDER BY p.name
    LIMIT limit_n;

  -- 3) FTS 전문검색 (위 두 결과에 없는 것)
  BEGIN
    tsq := websearch_to_tsquery('simple', q);
  EXCEPTION WHEN OTHERS THEN
    RETURN;
  END;

  RETURN QUERY
    SELECT p.guid, p.handle, p.name, p.entity_type,
           p.address, p.search_tags, p.extra,
           'fts'::TEXT
    FROM user_profiles p
    WHERE p.is_public = TRUE
      AND p.search_vector @@ tsq
      AND NOT (p.handle = q OR p.handle = '@' || q)
      AND NOT p.name ILIKE q || '%'
    ORDER BY ts_rank_cd(p.search_vector, tsq, 32) DESC
    LIMIT limit_n;
END;
$$;

-- ── search_nearby RPC (위치 기반) ────────────────────────────
-- 가까운 순으로 프로필 반환 (entity_type 필터 가능)
CREATE OR REPLACE FUNCTION search_nearby(
  user_lat   FLOAT8,
  user_lng   FLOAT8,
  radius_km  FLOAT8  DEFAULT 5.0,
  etype      TEXT    DEFAULT NULL,
  lim        INT     DEFAULT 20
)
RETURNS TABLE (
  guid        TEXT,
  handle      TEXT,
  name        TEXT,
  entity_type TEXT,
  address     TEXT,
  search_tags TEXT[],
  phone       TEXT,
  extra       JSONB,
  distance_km FLOAT8
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    p.guid, p.handle, p.name, p.entity_type,
    p.address, p.search_tags, p.phone, p.extra,
    (point(user_lng, user_lat) <@> point(p.lng, p.lat)) * 1.60934 AS distance_km
  FROM user_profiles p
  WHERE p.is_public = TRUE
    AND p.lat IS NOT NULL
    AND p.lng IS NOT NULL
    AND (point(user_lng, user_lat) <@> point(p.lng, p.lat)) * 1.60934 <= radius_km
    AND (etype IS NULL OR p.entity_type = etype)
  ORDER BY distance_km ASC
  LIMIT lim;
$$;

-- ── 완료 확인 ─────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM pg_proc WHERE proname = 'search_users')   AS search_users_ok,
  (SELECT count(*) FROM pg_proc WHERE proname = 'search_nearby')  AS search_nearby_ok,
  (SELECT count(*) FROM pg_proc WHERE proname = 'search_entities') AS search_entities_ok;
-- 모두 1 이면 완료
