-- ═══════════════════════════════════════════════════════════
-- phase1_agent_entity_model.sql
-- agent_profile_pdv_plan_v2.md Phase 1
-- 그림자(agent) 엔티티 데이터 모델 — user_profiles 확장
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- 1. entity_type에 'agent' 추가 (기존 값 영향 없음)
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_entity_type_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_entity_type_check
  CHECK (entity_type IN (
    'person','consumer','individual',
    'org','institution','business','platform',
    'agent'
  ));

-- 2. casts_for — 본체 guid를 가리키는 불변 외래키
--    그림자는 본체 없이 존재할 수 없고, 본체를 바꿀 수도 없음(주주-법인 관계의 그림자 버전)
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS casts_for TEXT REFERENCES user_profiles(guid);

-- casts_for 불변 강제 트리거
CREATE OR REPLACE FUNCTION _enforce_casts_for_immutable() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.casts_for IS NOT NULL
     AND NEW.casts_for IS DISTINCT FROM OLD.casts_for THEN
    RAISE EXCEPTION 'casts_for는 불변입니다 — 그림자는 본체를 바꿀 수 없음';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_casts_for_immutable ON user_profiles;
CREATE TRIGGER trg_casts_for_immutable
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION _enforce_casts_for_immutable();

-- 3. is_active — 본체 비활성화 시 그림자도 cascade 비활성화용
--    (활성/비활성 기능 자체는 별도 구현, 컬럼만 선행 추가)
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- cascade 비활성화 트리거
CREATE OR REPLACE FUNCTION _cascade_deactivate_agent() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_active = false AND OLD.is_active = true THEN
    UPDATE user_profiles
       SET is_active = false
     WHERE casts_for = NEW.guid
       AND entity_type = 'agent';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cascade_deactivate_agent ON user_profiles;
CREATE TRIGGER trg_cascade_deactivate_agent
  AFTER UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION _cascade_deactivate_agent();

-- 4. agent_keys — 그림자 개인키 암호문 별도 테이블
--    user_profiles.extra에 두면 GET /profile 응답에 노출되므로 분리
CREATE TABLE IF NOT EXISTS agent_keys (
  agent_guid  TEXT PRIMARY KEY
                   REFERENCES user_profiles(guid) ON DELETE CASCADE,
  ciphertext  TEXT NOT NULL,   -- AES-256-GCM 암호문 (Base64)
  iv          TEXT NOT NULL,   -- 초기화 벡터 (Base64)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE agent_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_keys_no_public_access ON agent_keys;
CREATE POLICY agent_keys_no_public_access ON agent_keys
  FOR ALL USING (false);   -- anon/authenticated 모두 차단, service_role만 접근

-- 5. 검증 쿼리
SELECT count(*) AS agent_keys_table_exists
  FROM information_schema.tables
 WHERE table_name = 'agent_keys';

SELECT conname
  FROM pg_constraint
 WHERE conname = 'user_profiles_entity_type_check';

SELECT column_name
  FROM information_schema.columns
 WHERE table_name = 'user_profiles'
   AND column_name IN ('casts_for','is_active')
 ORDER BY column_name;

COMMIT;
