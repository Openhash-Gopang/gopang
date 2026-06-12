-- ============================================================
-- phase1_m02_register.sql — M02 등록 모듈 DB 보완
-- 저장위치: gopang/sql/phase1_m02_register.sql
-- 실행: Supabase SQL Editor
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. user_profiles.handle UNIQUE 인덱스 확인
--    (기존에 없으면 생성)
-- ─────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_handle
  ON user_profiles (handle)
  WHERE handle IS NOT NULL;

-- ─────────────────────────────────────────────
-- 2. handle 컬럼 존재 확인 (없으면 추가)
-- ─────────────────────────────────────────────
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS handle TEXT,
  ADD COLUMN IF NOT EXISTS native_lang TEXT DEFAULT 'ko';

-- ─────────────────────────────────────────────
-- 3. phone_hash 인덱스 (중복 등록 빠른 조회)
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_user_profiles_entity_type
  ON user_profiles (entity_type, is_public);

-- ─────────────────────────────────────────────
-- 완료 확인
-- ─────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
   WHERE table_name='user_profiles'
   AND column_name='handle')          AS handle_col_ok,
  (SELECT count(*) FROM pg_indexes
   WHERE tablename='user_profiles'
   AND indexname='idx_user_profiles_handle') AS handle_idx_ok;
-- 모두 1 이면 완료
