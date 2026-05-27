-- ══════════════════════════════════════════════════════════════
-- 고팡 사용자 + PDV 테이블
-- Supabase SQL Editor에서 실행
-- ══════════════════════════════════════════════════════════════

-- ── 사용자 테이블 ─────────────────────────────────────────────
create table if not exists users (
  guid          text primary key,          -- 기기 자동 생성 UUID
  device_fp     text not null,             -- 기기 핑거프린트 (SHA-256 32자)
  phone         text,                      -- 전화번호 (WebOTP 수신 후 저장)
  registered_at timestamptz default now(),
  last_seen_at  timestamptz default now()
);

-- 전화번호 중복 방지 (한 번호 = 한 계정)
create unique index if not exists users_phone_unique
  on users (phone) where phone is not null;

-- RLS 활성화
alter table users enable row level security;

-- 자신의 레코드만 읽기/쓰기 (guid 기반)
create policy "users: self read"   on users for select using (true);
create policy "users: self upsert" on users for insert with check (true);
create policy "users: self update" on users for update using (true);

-- ── PDV 로그 테이블 ───────────────────────────────────────────
-- 고팡이 기록하는 사용자 행동 메타데이터
-- 실제 데이터는 각 서비스 Supabase에 저장됨 (여기엔 요약만)
create table if not exists pdv_log (
  id           bigserial primary key,
  user_guid    text not null references users(guid) on delete cascade,
  device_fp    text,
  record_type  text not null,             -- 'service_task' | 'message' | 'search' 등
  service_id   text,                      -- 'fiil-kcleaner' | 'klaw' 등
  summary      text,                      -- 사람이 읽을 수 있는 요약
  payload      jsonb,                     -- 전체 메타데이터 (JSON)
  created_at   timestamptz default now()
);

create index if not exists pdv_log_user_guid_idx on pdv_log (user_guid);
create index if not exists pdv_log_created_at_idx on pdv_log (created_at desc);

alter table pdv_log enable row level security;
create policy "pdv_log: insert" on pdv_log for insert with check (true);
create policy "pdv_log: select" on pdv_log for select using (true);
