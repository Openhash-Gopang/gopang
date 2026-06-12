-- ══════════════════════════════════════════════════════════
-- Supabase SQL: webauthn_credentials 테이블
-- Supabase 대시보드 → SQL Editor → 아래 내용 실행
-- ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  ipv6            text NOT NULL,          -- 사용자 IPv6 정체성
  credential_id   text NOT NULL UNIQUE,   -- WebAuthn credential ID (base64url)
  public_key      text NOT NULL,          -- 공개키 (base64url, COSE 형식)
  counter         bigint DEFAULT 0,       -- 재사용 공격 방지 카운터
  device_type     text,                   -- 'platform' | 'cross-platform'
  aaguid          text,                   -- 기기 모델 식별자 (선택)
  registered_at   timestamptz DEFAULT now(),
  last_used_at    timestamptz
);

-- IPv6로 빠른 조회를 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_webauthn_ipv6
  ON webauthn_credentials(ipv6);

-- credential_id로 빠른 조회
CREATE INDEX IF NOT EXISTS idx_webauthn_cred_id
  ON webauthn_credentials(credential_id);

-- Row Level Security (공개키는 공개 정보이므로 anon 읽기 허용)
ALTER TABLE webauthn_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon can read credentials"
  ON webauthn_credentials FOR SELECT
  USING (true);

CREATE POLICY "anon can insert credentials"
  ON webauthn_credentials FOR INSERT
  WITH CHECK (true);

CREATE POLICY "anon can update counter"
  ON webauthn_credentials FOR UPDATE
  USING (true);
