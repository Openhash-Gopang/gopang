# minwon-batch-pipeline

발급형 민원(증명서 발급·신청·신고·조회 — 정부24 "민원서비스" 계열) 배치 분류 파이프라인.

- 이 계열의 원본은 아직 공식 API 수집 스크립트가 없다(`fetch_civil_petitions.py`는
  **다른** 계열인 "공공서비스 혜택" 카탈로그용 — 혼동 주의,
  `../../docs/GOV24-DATA-TRACKS-BOUNDARY_v1.0_2026-07-16.md` 참조).
- 사용자가 세션마다 붙여넣는 목록을 `data/minwon-raw/batch_NNN_*.json`으로 수기 적재한 뒤,
  `classify_batch.py`로 자동 분류·이상탐지(R1~R8)를 돌려 `data/minwon-classified/batch_NNN.json`을
  생성한다.
- 실행: `python3 classify_batch.py data/minwon-raw/batch_NNN_*.json data/minwon-classified/batch_NNN.json`
- 3배치(150건) 누적 정리 내용은 `CONSOLIDATION-SUMMARY_2026-07-16.md` 참조 — 다음 배치 작업 전 필독.
- 하류 목적지: `kgov`(`SP-10_kpublic`) / `REQUIRED_DOCUMENTS_REGISTRY` / `gov_task_schema_drafts`.
