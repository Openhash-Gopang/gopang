-- ═══════════════════════════════════════════════════════════
-- phase2_entity_type_simplify.sql
-- refactor_plan_v2.md Phase 2 — entity_type 단순화
-- institution / org / platform → business + extra.public.identity.entity_subtype
-- person / business 두 값만 entity_type에 남긴다.
--
-- 적용 전 반드시 1) 영향 행 수 확인, 2) 백업(또는 트랜잭션) 후 실행.
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- 0. 적용 전 현황 확인 (실행 결과를 기록해 둘 것)
SELECT entity_type, count(*) FROM user_profiles GROUP BY entity_type ORDER BY 1;

-- 1. 마이그레이션 — entity_subtype이 비어있을 때만 원래 entity_type 값을 보존
--    (이미 entity_subtype이 있는 행은 과거 부분 마이그레이션으로 간주하고 건너뜀)
UPDATE user_profiles
SET entity_type = 'business',
    extra = jsonb_set(
      COALESCE(extra, '{}'::jsonb),
      '{public,identity,entity_subtype}',
      to_jsonb(entity_type)
    )
WHERE entity_type IN ('institution', 'org', 'platform')
  AND (extra #>> '{public,identity,entity_subtype}') IS NULL;

-- 2. 적용 후 검증 — entity_type은 person/business 둘뿐이어야 함
SELECT entity_type, count(*) FROM user_profiles GROUP BY entity_type ORDER BY 1;

-- 3. entity_subtype 분포 확인 (institution/org/platform이 여기로 옮겨졌는지)
SELECT extra #>> '{public,identity,entity_subtype}' AS entity_subtype, count(*)
FROM user_profiles
WHERE entity_type = 'business'
GROUP BY 1 ORDER BY 1;

-- 문제 없으면 COMMIT, 이상하면 ROLLBACK
COMMIT;
-- ROLLBACK;

-- ═══════════════════════════════════════════════════════════
-- 역마이그레이션 (필요 시 별도 실행 — 위 COMMIT 이후엔 새 트랜잭션)
-- ═══════════════════════════════════════════════════════════
-- BEGIN;
-- UPDATE user_profiles
-- SET entity_type = extra #>> '{public,identity,entity_subtype}'
-- WHERE entity_type = 'business'
--   AND extra #>> '{public,identity,entity_subtype}' IN ('institution','org','platform');
-- COMMIT;
