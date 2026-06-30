-- ⚠️ 2026-06-30: 폐기됨 — agent_internal_sp는 Supabase가 아니라 L1
-- PocketBase로 이전했습니다. 이 SQL은 실행하지 마세요.
-- 대신 docs/pocketbase_agent_internal_sp_schema.json을 L1 PocketBase
-- Admin UI(Settings → Import collections)에서 임포트하세요.
-- (이유: Supabase 의존도를 줄이고, 보안 필드는 L1을 권위 있는 소스로
--  삼는다는 기존 설계 원칙 — worker.js의 _l1AdminToken 주석 참조 —
--  과 일관성을 맞추기 위함)
--
-- phase11_agent_internal_sp.sql
-- 2026-06-30: 기관(business/org/institution/platform) 그림자 AI의
-- "운영자 전용(internal)" system_prompt를 저장하는 전용 테이블.
--
-- 왜 user_profiles.extra 안에 같이 두지 않는가:
--   worker.js의 GET /profile/@{handle} (handleProfileGet)은 인증 없이
--   user_profiles 행을 SELECT * 통째로 반환한다. internal SP를 그
--   행의 extra(설령 extra.private 같은 별도 키라도) 안에 두면, 누구나
--   GET /profile/@{handle}_ai 한 번으로 운영자 전용 정보(원가·마진·
--   거래처 단가 등이 녹아든 system_prompt)를 그대로 읽어갈 수 있다.
--   그래서 아예 다른 테이블로 분리하고, RLS로 service_role(Worker)만
--   접근 가능하게 만든다 — anon/공개 조회 경로 자체가 없다.
--
-- 접근 경로: GET /profile/my-sp (handleProfileMySP) 단 하나뿐이며,
--   이 엔드포인트는 gopang_token 쿠키로 본인 인증을 거친 뒤
--   principal_guid가 본인 guid와 일치하는 행만 반환한다.

create table if not exists agent_internal_sp (
  principal_guid text primary key references user_profiles(guid) on delete cascade,
  system_prompt  text,
  updated_at     timestamptz not null default now()
);

comment on table agent_internal_sp is
  '기관 그림자 AI의 운영자 전용(internal) system_prompt. user_profiles와 분리 저장 — 공개 GET 경로에 노출되면 안 됨.';

alter table agent_internal_sp enable row level security;

-- 의도적으로 정책(policy)을 하나도 만들지 않는다.
-- RLS가 켜진 테이블에 정책이 없으면 anon/authenticated 키로는
-- 어떤 행도 읽거나 쓸 수 없다 — service_role 키(Worker가 쓰는 키)만
-- RLS를 우회해 접근 가능하다. 이게 의도된 "service_role 전용" 잠금이다.
