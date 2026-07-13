-- 2026-07-13 신설 — PDV 일상/업무 영역 분할(AC-EVOLUTION_v1_1.md §PDV-SPLIT)
--
-- 대상: Supabase pdv_log 테이블(레거시 — handlePdvReport는 이미 L1
-- pdv_records로 쓰기가 전환됐지만, 클라이언트 _recordPDV()는 여전히
-- 이 테이블에 직접 INSERT한다. pb_migrations/1784700001_added_pdv_
-- domain_split.js가 L1 pdv_records 쪽은 이미 처리했으므로, 이 SQL은
-- Supabase 쪽 대응 컬럼만 추가한다).
--
-- ★ 실행 전 확인사항: 이번 사고실험(AC-EVOLUTION-GAPS #12 작업) 중
-- handlePdvQuery의 조회 경로(_fetchPdvByScope)가 여전히 이 pdv_log
-- 테이블을 읽는데, 쓰기 경로(handlePdvReport)는 이미 L1 pdv_records로
-- 전환된 상태라 실제로 최신 데이터를 못 읽고 있을 가능성이 있다 —
-- 이건 이번 작업이 만든 문제가 아니라 기존 이관 과정에서 생긴 공백으로
-- 보인다. 이 SQL만으로는 그 공백이 해결되지 않는다 — 별도 확인 필요.

ALTER TABLE pdv_log
  ADD COLUMN IF NOT EXISTS domain text DEFAULT 'personal'
    CHECK (domain IN ('personal', 'work')),
  ADD COLUMN IF NOT EXISTS affiliation_org_id text;

CREATE INDEX IF NOT EXISTS idx_pdv_log_domain
  ON pdv_log (guid, domain, affiliation_org_id);
