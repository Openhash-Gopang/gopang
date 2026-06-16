-- ============================================================
-- gdc_step1_tables.sql v2 — 기존 테이블 삭제 후 재생성
-- ============================================================

-- 기존 테이블 제거 (존재하면)
DROP TABLE IF EXISTS gdc_utxo CASCADE;
DROP TABLE IF EXISTS fs_ledger CASCADE;

-- ── gdc_utxo ─────────────────────────────────────────────────
CREATE TABLE gdc_utxo (
  utxo_id       TEXT        NOT NULL,
  tx_id         TEXT        NOT NULL,
  output_index  INT         NOT NULL DEFAULT 0,
  owner_guid    TEXT        NOT NULL,
  amount        NUMERIC(20,6) NOT NULL,
  sig           TEXT,
  spent         BOOLEAN     NOT NULL DEFAULT FALSE,
  spent_tx_id   TEXT,
  spent_at      TIMESTAMPTZ,
  entry_hash    TEXT,
  prev_hash     TEXT,
  block_height  BIGINT,
  utxo_type     TEXT        DEFAULT 'transfer',
  memo          TEXT,
  ts            TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (utxo_id)
);

CREATE INDEX idx_utxo_owner_unspent
  ON gdc_utxo (owner_guid, spent, ts DESC)
  WHERE spent = FALSE;

CREATE INDEX idx_utxo_tx      ON gdc_utxo (tx_id);
CREATE INDEX idx_utxo_spent   ON gdc_utxo (spent_tx_id) WHERE spent = TRUE;

-- ── fs_ledger ────────────────────────────────────────────────
CREATE TABLE fs_ledger (
  id             BIGSERIAL   PRIMARY KEY,
  tx_id          TEXT        UNIQUE NOT NULL,
  guid           TEXT        NOT NULL,
  tx_type        TEXT        NOT NULL,
  debit_account  TEXT,
  debit_amount   NUMERIC(20,6) DEFAULT 0,
  credit_account TEXT,
  credit_amount  NUMERIC(20,6) DEFAULT 0,
  krw_amount     NUMERIC(20,2) DEFAULT 0,
  gdc_amount     NUMERIC(20,6) DEFAULT 0,
  block_hash     TEXT,
  prev_hash      TEXT,
  bank_ref       TEXT,
  journal_entry  JSONB,
  utxo_ids       TEXT[],
  ts             TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_fs_guid ON fs_ledger (guid, ts DESC);
CREATE INDEX idx_fs_type ON fs_ledger (tx_type, ts DESC);

-- 확인
SELECT
  (SELECT count(*) FROM information_schema.tables
   WHERE table_name = 'gdc_utxo')  AS utxo_ok,
  (SELECT count(*) FROM information_schema.tables
   WHERE table_name = 'fs_ledger') AS ledger_ok;
