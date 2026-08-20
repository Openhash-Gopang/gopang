# GOV_TASK 접수 이후(심사·보완·의견제출) 구현 갭

> `GOV-TASK-POST-ACCEPTANCE-REVIEW_v2_0.md`가 정의한 계약을 실제로
> 동작시키는 데 필요한 작업 목록. dpaper.kr API 승인과 **무관하게**
> 착수 가능 — 선행조건이 다르다(`ACTIVATION-CHECKLIST_dpaper.md`와
> 서로 참조하되 혼동하지 않는다).

## 착수 가능 작업 (외부 승인 대기 없음)

- [ ] **`REQUIRED_DOCUMENTS_REGISTRY`에 `building_permit`/
      `occupancy_inspection` 등록** — 지금 이 두 task_key가 없어서
      `GOV_TASK_SUBMIT_REQUEST`가 `TASK_SCHEMA_NOT_FOUND`로 거부됨.
      kcc/court 두 기존 항목과 동일 형식으로 worker.js에 추가.
      (파일: worker.js, `REQUIRED_DOCUMENTS_REGISTRY` 객체)
- [ ] **`pdv_records.summary_6w.gov_task`에 `review_state` 필드 추가** —
      현재 `status`(accepted/pending_documents)만 있음. 추가할 값:
      `under_review` / `supplement_requested` / `opinion_submitted` /
      `officer_decided`.
- [ ] **`handleGovTaskSubmit`에 receipt_no 재사용 분기 추가** — 현재
      매 호출마다 새 접수번호를 발급한다. 요청에 기존 `receipt_no`가
      실려 오면 신규 접수가 아니라 해당 케이스의 재제출로 처리하도록
      분기 필요.
- [ ] **call-ai.js에 3개 태그 파싱 로직 추가** — 기존
      `GOV_TASK_SUBMIT_REQUEST` 처리부(2658행 부근)를 참고해 동일
      패턴으로:
      - `GOV_TASK_SUPPLEMENT_REQUEST` → 서버에 보완요청 기록 +
        review_state 전이
      - `GOV_TASK_FIELD_INSPECTION_SCHEDULE` → 일정 후보 기록
      - `GOV_TASK_OPINION_SUBMIT` → review_state를 `opinion_submitted`로
        전이, `pending_human_action`으로 보고
- [ ] **`POST /gov/task/officer-decision` 엔드포인트 신규 작성** —
      가장 손이 많이 갈 항목. 핵심 미해결 과제는 **담당 공무원 인증·
      권한 검증**(신청자 본인이 이 엔드포인트를 호출할 수 없어야 함) —
      기존 `/gov/task/fee-approve`(신청자 본인 승인용)와 이름은
      비슷하지만 호출 주체가 다르므로 그대로 베끼면 안 됨.
- [ ] **SP-22_kexecute 프롬프트에 3개 태그 발행 지침 추가** —
      `GOV_TASK_SUBMIT_REQUEST` 관련 기존 절(7~322행 부근)과 같은
      형식으로.

## 승인된 뒤에만 의미 있는 작업 (별도 문서 — 혼동 주의)

- dpaper.kr 실제 제출·보관 연동은 `ACTIVATION-CHECKLIST_dpaper.md` 참조.
  `officer_decision: approved` 이후 발급 문서를 dpaper.kr에 보관하는
  지점만 두 문서가 만난다 — 그 외에는 독립적으로 진행 가능하다.

## 이 문서 자체의 갱신 규칙

새 구현 갭이 발견되면 이 문서에 체크박스로 추가한다. dpaper 체크리스트와
마찬가지로, 스위치/갭 목록을 여러 문서에 분산 기록하지 않는다.

최종 갱신: 2026-08-20
