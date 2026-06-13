-- ============================================================
-- step_chat_02_webrtc_signal.sql
-- 목적: WebRTC 시그널링 전용 임시 테이블
-- 원칙: 연결 수립 후 즉시 삭제 — 메시지는 절대 저장 안 함
-- 작성: AI City Inc. 팀 주피터 · 2026-06-13
-- ============================================================

-- ── 1. 시그널링 임시 테이블 ──────────────────────────────────
-- SDP offer/answer, ICE candidate만 저장
-- TTL 60초 — 연결 수립 후 즉시 삭제, 미수신 시 자동 만료
CREATE TABLE IF NOT EXISTS webrtc_signals (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  from_guid   TEXT        NOT NULL,   -- 발신자 GUID
  to_guid     TEXT        NOT NULL,   -- 수신자 GUID
  type        TEXT        NOT NULL,   -- offer | answer | ice
  payload     TEXT        NOT NULL,   -- JSON 직렬화 (암호화됨)
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '60 seconds'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webrtc_signals_to
  ON webrtc_signals (to_guid, created_at ASC);

-- ── 2. 만료된 시그널 자동 삭제 (pg_cron 없으면 앱에서 처리) ─
-- Supabase pg_cron 활성화 시:
-- SELECT cron.schedule('cleanup-signals', '* * * * *',
--   'DELETE FROM webrtc_signals WHERE expires_at < now()');

-- ── 3. RLS 정책 ──────────────────────────────────────────────
ALTER TABLE webrtc_signals ENABLE ROW LEVEL SECURITY;

-- 누구나 자신의 GUID로 수신된 시그널 조회 가능
-- (anon key로 접근 — guid 본인 확인은 앱 레이어에서)
CREATE POLICY "수신자 조회" ON webrtc_signals
  FOR SELECT USING (true);  -- Worker가 검증하므로 DB 레벨은 허용

CREATE POLICY "누구나 삽입" ON webrtc_signals
  FOR INSERT WITH CHECK (true);

CREATE POLICY "누구나 삭제" ON webrtc_signals
  FOR DELETE USING (true);

-- ── 4. Realtime 활성화 ───────────────────────────────────────
-- Supabase 대시보드 → Database → Replication → webrtc_signals 체크

-- ── 5. p2p_chats: 채팅방 메타데이터만 (메시지 저장 없음) ─────
-- 대화 상대 목록 표시용 — 마지막 대화 시각만 기록
-- 메시지 본문은 절대 저장하지 않음
CREATE TABLE IF NOT EXISTS p2p_chats (
  room_id     TEXT        PRIMARY KEY,  -- sha256(sorted(guid_a:guid_b))[:40]
  guid_a      TEXT        NOT NULL,
  guid_b      TEXT        NOT NULL,
  name_a      TEXT,
  name_b      TEXT,
  handle_a    TEXT,
  handle_b    TEXT,
  last_seen_at TIMESTAMPTZ DEFAULT now(),  -- 마지막 연결 시각 (메시지 내용 없음)
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_p2p_chats_a ON p2p_chats (guid_a, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_p2p_chats_b ON p2p_chats (guid_b, last_seen_at DESC);

-- ── 6. search_users RPC (사용자 검색) ────────────────────────
CREATE OR REPLACE FUNCTION search_users(q TEXT, limit_n INT DEFAULT 20)
RETURNS TABLE (
  guid         TEXT,
  name         TEXT,
  handle       TEXT,
  avatar_emoji TEXT,
  entity_type  TEXT,
  address      TEXT,
  native_lang  TEXT
)
LANGUAGE sql STABLE AS $$
  SELECT guid, name, handle, avatar_emoji, entity_type, address, native_lang
  FROM user_profiles
  WHERE is_public = true
    AND (
      name    ILIKE '%' || q || '%'
      OR handle ILIKE '%' || q || '%'
      OR address ILIKE '%' || q || '%'
    )
  ORDER BY
    CASE WHEN handle ILIKE q THEN 0
         WHEN name   ILIKE q THEN 1
         ELSE 2 END,
    name ASC
  LIMIT limit_n;
$$;

-- ── 검증 ─────────────────────────────────────────────────────
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('webrtc_signals', 'p2p_chats')
ORDER BY table_name;
