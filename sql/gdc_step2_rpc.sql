-- ============================================================
-- gdc_step2_rpc.sql — RPC 함수 생성
-- gdc_step1_tables.sql 실행 완료 후 실행
-- ============================================================

-- ── gdc_deposit RPC ──────────────────────────────────────────
DROP FUNCTION IF EXISTS gdc_deposit(TEXT,NUMERIC,NUMERIC,TEXT,TEXT,TEXT,TEXT,TEXT);

CREATE OR REPLACE FUNCTION gdc_deposit(
  p_guid       TEXT,
  p_krw_amount NUMERIC,
  p_gdc_amount NUMERIC,
  p_tx_id      TEXT,
  p_entry_hash TEXT,
  p_prev_hash  TEXT,
  p_bank_ref   TEXT,
  p_sig        TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_utxo_id     TEXT;
  v_extra       JSONB;
  v_pub         JSONB;
  v_finance     JSONB;
  v_fs          JSONB;
  v_new_cash    NUMERIC;
  v_new_revenue NUMERIC;
  v_now         TIMESTAMPTZ := NOW();
  v_now_str     TEXT := to_char(v_now AT TIME ZONE 'Asia/Seoul',
                          'YYYY-MM-DD"T"HH24:MI:SS+09:00');
  v_block_h     BIGINT := EXTRACT(EPOCH FROM v_now)::BIGINT;
BEGIN
  -- A. 이중발행 방지
  IF EXISTS (SELECT 1 FROM fs_ledger WHERE tx_id = p_tx_id) THEN
    RETURN jsonb_build_object(
      'ok', FALSE, 'error', 'DUPLICATE_TX',
      'detail', '이미 처리된 트랜잭션입니다.'
    );
  END IF;

  -- B. UTXO ID 생성
  v_utxo_id := encode(sha256((p_tx_id || ':0')::BYTEA), 'hex');

  -- C. UTXO 원자 생성
  INSERT INTO gdc_utxo (
    utxo_id, tx_id, output_index,
    owner_guid, amount, sig,
    spent, utxo_type, memo,
    entry_hash, prev_hash, block_height
  ) VALUES (
    v_utxo_id, p_tx_id, 0,
    p_guid, p_gdc_amount, p_sig,
    FALSE, 'deposit',
    'GDC 발행 — KRW ' || p_krw_amount::TEXT || '원 입금',
    p_entry_hash, p_prev_hash, v_block_h
  );

  -- D. fs_ledger 기록 (IASB 복식부기)
  INSERT INTO fs_ledger (
    tx_id, guid, tx_type,
    debit_account,  debit_amount,
    credit_account, credit_amount,
    krw_amount, gdc_amount,
    block_hash, prev_hash, bank_ref,
    utxo_ids,
    journal_entry
  ) VALUES (
    p_tx_id, p_guid, 'gdc_deposit',
    'bs-cash',    p_gdc_amount,
    'pl-revenue', p_gdc_amount,
    p_krw_amount, p_gdc_amount,
    p_entry_hash, p_prev_hash, p_bank_ref,
    ARRAY[v_utxo_id],
    jsonb_build_object(
      'standard', 'IASB IAS 38 / IFRS 9',
      'date',      v_now_str,
      'debit',  jsonb_build_array(jsonb_build_object(
        'account', 'bs-cash',
        'label',   '현금 및 현금성자산 (GDC)',
        'amount',   p_gdc_amount,
        'desc',     'GDC 입금 — On-demand Issuance'
      )),
      'credit', jsonb_build_array(jsonb_build_object(
        'account', 'pl-revenue',
        'label',   '영업외수익 — GDC 발행수익',
        'amount',   p_gdc_amount,
        'desc',     'KRW ' || p_krw_amount::TEXT || '원 입금에 의한 GDC 즉시 발행'
      )),
      'utxo', jsonb_build_object(
        'utxo_id',    v_utxo_id,
        'amount',     p_gdc_amount,
        'entry_hash', p_entry_hash,
        'prev_hash',  p_prev_hash
      )
    )
  );

  -- E. user_profiles extra.fs 갱신
  SELECT extra INTO v_extra
  FROM user_profiles WHERE guid = p_guid LIMIT 1;

  v_extra   := COALESCE(v_extra, '{}'::JSONB);
  v_pub     := COALESCE(v_extra->'public', '{}'::JSONB);
  v_finance := COALESCE(v_pub->'finance', '{}'::JSONB);
  v_fs      := COALESCE(v_finance->'fs', '{}'::JSONB);

  v_new_cash    := COALESCE((v_fs->>'bs-cash')::NUMERIC, 0) + p_gdc_amount;
  v_new_revenue := COALESCE((v_fs->>'pl-revenue')::NUMERIC, 0) + p_gdc_amount;

  v_fs := v_fs || jsonb_build_object(
    'bs-cash',         v_new_cash,
    'pl-revenue',      v_new_revenue,
    'last_tx_id',      p_tx_id,
    'last_block_hash', p_entry_hash,
    'last_prev_hash',  p_prev_hash,
    'last_updated_at', v_now_str,
    'last_tx_type',    'gdc_deposit',
    'last_tx_record',  jsonb_build_object(
      'tx_id',      p_tx_id,
      'type',       'gdc_deposit',
      'krw_amount', p_krw_amount,
      'gdc_amount', p_gdc_amount,
      'bank_ref',   p_bank_ref,
      'utxo_id',    v_utxo_id,
      'block_hash', p_entry_hash,
      'timestamp',  v_now_str
    )::TEXT
  );

  v_finance := v_finance || jsonb_build_object('fs', v_fs);
  v_pub     := v_pub     || jsonb_build_object('finance', v_finance);
  v_extra   := v_extra   || jsonb_build_object('public', v_pub);

  UPDATE user_profiles SET extra = v_extra WHERE guid = p_guid;

  RETURN jsonb_build_object(
    'ok',            TRUE,
    'tx_id',         p_tx_id,
    'utxo_id',       v_utxo_id,
    'gdc_issued',    p_gdc_amount,
    'krw_deposited', p_krw_amount,
    'new_balance',   v_new_cash,
    'entry_hash',    p_entry_hash,
    'timestamp',     v_now_str
  );

EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'DUPLICATE_UTXO',
      'detail', '이중발행 시도가 차단되었습니다.');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', SQLERRM);
END;
$$;

-- ── gdc_spend RPC ────────────────────────────────────────────
DROP FUNCTION IF EXISTS gdc_spend(TEXT,TEXT[],JSONB,TEXT,TEXT,TEXT);

CREATE OR REPLACE FUNCTION gdc_spend(
  p_spender_guid TEXT,
  p_input_utxos  TEXT[],
  p_outputs      JSONB,
  p_tx_id        TEXT,
  p_entry_hash   TEXT,
  p_sig          TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_utxo          RECORD;
  v_total_input   NUMERIC := 0;
  v_total_output  NUMERIC := 0;
  v_output        JSONB;
  v_change        NUMERIC;
  v_new_utxo_id   TEXT;
  v_out_idx       INT := 0;
  v_now           TIMESTAMPTZ := NOW();
  v_now_str       TEXT := to_char(v_now AT TIME ZONE 'Asia/Seoul',
                            'YYYY-MM-DD"T"HH24:MI:SS+09:00');
  v_created_utxos TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- A. 이중지불 방지: FOR UPDATE NOWAIT
  FOR v_utxo IN
    SELECT utxo_id, amount, owner_guid, spent
    FROM gdc_utxo
    WHERE utxo_id = ANY(p_input_utxos)
    FOR UPDATE NOWAIT
  LOOP
    IF v_utxo.owner_guid != p_spender_guid THEN
      RETURN jsonb_build_object('ok', FALSE, 'error', 'NOT_OWNER',
        'utxo_id', v_utxo.utxo_id);
    END IF;
    IF v_utxo.spent THEN
      RETURN jsonb_build_object('ok', FALSE, 'error', 'ALREADY_SPENT',
        'utxo_id', v_utxo.utxo_id);
    END IF;
    v_total_input := v_total_input + v_utxo.amount;
  END LOOP;

  IF v_total_input = 0 THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'NO_VALID_INPUTS');
  END IF;

  -- B. 출력 합계
  SELECT SUM((value->>'amount')::NUMERIC)
  INTO v_total_output
  FROM jsonb_array_elements(p_outputs) AS value;

  IF v_total_output > v_total_input THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'INSUFFICIENT_FUNDS',
      'input', v_total_input, 'output', v_total_output);
  END IF;

  -- C. 입력 UTXO 소비
  UPDATE gdc_utxo
  SET spent = TRUE, spent_tx_id = p_tx_id, spent_at = v_now
  WHERE utxo_id = ANY(p_input_utxos) AND spent = FALSE;

  -- D. 출력 UTXO 생성
  FOR v_output IN SELECT * FROM jsonb_array_elements(p_outputs)
  LOOP
    v_new_utxo_id := encode(
      sha256((p_tx_id || ':' || v_out_idx::TEXT)::BYTEA), 'hex');
    INSERT INTO gdc_utxo (
      utxo_id, tx_id, output_index,
      owner_guid, amount,
      spent, utxo_type, memo, entry_hash
    ) VALUES (
      v_new_utxo_id, p_tx_id, v_out_idx,
      v_output->>'recipient_guid',
      (v_output->>'amount')::NUMERIC,
      FALSE, 'transfer',
      COALESCE(v_output->>'memo', ''),
      p_entry_hash
    );
    v_created_utxos := array_append(v_created_utxos, v_new_utxo_id);
    v_out_idx := v_out_idx + 1;
  END LOOP;

  -- E. Change UTXO (잔액 반환)
  v_change := v_total_input - v_total_output;
  IF v_change > 0 THEN
    v_new_utxo_id := encode(sha256((p_tx_id || ':change')::BYTEA), 'hex');
    INSERT INTO gdc_utxo (
      utxo_id, tx_id, output_index,
      owner_guid, amount,
      spent, utxo_type, memo, entry_hash
    ) VALUES (
      v_new_utxo_id, p_tx_id, v_out_idx,
      p_spender_guid, v_change,
      FALSE, 'change', '잔액 반환', p_entry_hash
    );
    v_created_utxos := array_append(v_created_utxos, v_new_utxo_id);
  END IF;

  RETURN jsonb_build_object(
    'ok',            TRUE,
    'tx_id',         p_tx_id,
    'total_input',   v_total_input,
    'total_output',  v_total_output,
    'change',        v_change,
    'spent_utxos',   p_input_utxos,
    'created_utxos', v_created_utxos,
    'entry_hash',    p_entry_hash,
    'timestamp',     v_now_str
  );

EXCEPTION
  WHEN lock_not_available THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'DOUBLE_SPEND_BLOCKED',
      'detail', '동시 소비 시도가 원자적으로 차단되었습니다.');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', SQLERRM);
END;
$$;

-- ── 잔액 조회 ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION gdc_balance(p_guid TEXT)
RETURNS JSONB LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'guid',          p_guid,
    'balance',       COALESCE(SUM(amount), 0),
    'utxo_count',    COUNT(*),
    'largest_utxo',  MAX(amount),
    'smallest_utxo', MIN(amount)
  )
  FROM gdc_utxo
  WHERE owner_guid = p_guid AND spent = FALSE;
$$;

-- ── UTXO Merkle Root ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION gdc_utxo_merkle_root(p_guid TEXT)
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT encode(
    sha256(string_agg(utxo_id, '|' ORDER BY utxo_id)::BYTEA),
    'hex'
  )
  FROM gdc_utxo
  WHERE owner_guid = p_guid AND spent = FALSE;
$$;

-- ── 완료 확인 ────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM pg_proc WHERE proname = 'gdc_deposit')          AS deposit_ok,
  (SELECT count(*) FROM pg_proc WHERE proname = 'gdc_spend')            AS spend_ok,
  (SELECT count(*) FROM pg_proc WHERE proname = 'gdc_balance')          AS balance_ok,
  (SELECT count(*) FROM pg_proc WHERE proname = 'gdc_utxo_merkle_root') AS merkle_ok;
-- 모두 1이면 완료
