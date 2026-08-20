# GOV_TASK 접수 이후(심사·보완·의견제출) 구현 갭

> `GOV-TASK-POST-ACCEPTANCE-REVIEW_v2_1.md`가 정의한 계약을 실제로
> 동작시키는 데 필요한 작업 목록. dpaper.kr API 승인과 **무관하게**
> 착수 가능 — 선행조건이 다르다(`ACTIVATION-CHECKLIST_dpaper.md`와
> 서로 참조하되 혼동하지 않는다).

## 착수 가능 작업 (외부 승인 대기 없음)

- [x] **`REQUIRED_DOCUMENTS_REGISTRY`에 `building_permit`/
      `occupancy_inspection` 등록** — 2026-08-20 완료.
      (파일: worker.js, `REQUIRED_DOCUMENTS_REGISTRY` 객체,
      `seogwipo:building_permit` / `seogwipo:occupancy_inspection`)
- [x] **`pdv_records.summary_6w.gov_task`에 `review_state` 필드 추가** —
      2026-08-20 완료(`under_review`/`supplement_requested`/
      `opinion_submitted`/`officer_decided`, `handleGovTaskSubmit` +
      3개 신규 엔드포인트 + officer-decision이 전이).
- [x] **`handleGovTaskSubmit`에 receipt_no 재사용 분기 추가** —
      2026-08-20 완료. 부수로 `pdv_records`에 인덱스된 `receipt_no`
      필드를 신설(마이그레이션 `1787500100`)해 케이스 조회를
      guid+type 전체 스캔이 아니라 직접 filter로 바꿨다
      (`_l1FindGovTaskByReceiptNo`).
- [x] **call-ai.js에 3개 태그 파싱 로직 추가** — 2026-08-20 완료.
      `GOV_TASK_SUBMIT_REQUEST` 처리부와 동일 패턴으로 3개 블록 추가.
- [x] **`POST /gov/task/officer-decision` 엔드포인트 신규 작성** —
      2026-08-20 완료. 담당 공무원 인증·권한 검증은 `_verifyAccessCert`
      (dept-task-handler.js, `handlePersonalAcCall`과 동일 패턴)를
      재사용하고, `AGENCY_TO_DEPT_TARGET`으로 케이스의 관할 부서
      org_id와 인증서 org_id를 대조하는 `_verifyOfficerForGovTask`를
      신설해 "신청자 본인이 호출할 수 없어야 함" 요구사항을 만족시켰다.
      나머지 3개 엔드포인트(`supplement-request`/
      `field-inspection-schedule`/`opinion-submit`)도 동일 검증을 공유.
- [ ] **SP-22_kexecute 프롬프트에 3개 태그 발행 지침 추가** — 아직 미완.
      ※ 2026-08-20 재확인: 이 세 태그는 SP-22_kexecute(시민측 오케스트레이터)가
      아니라 부서 SP(SP-CITYDIV-SEOGWIPO-CONSTRUCTION-BUILDING §3 등,
      accepted 이후 케이스를 심사하는 쪽)가 발행하는 게 맞다 — 접수
      단계(`GOV_TASK_SUBMIT_REQUEST`)만 SP-22 통합 대상이었다(§1-1).
      SP-CITYDIV-SEOGWIPO-CONSTRUCTION-BUILDING은 이미 자체 §3에
      지침을 담고 있어(v1.2) 실제로 막힌 곳은 없지만, 이 항목 원문이
      "SP-22"를 지목한 이유가 확인되지 않아 체크박스는 열어둔다 — 다른
      부서 SP를 신설할 때 이 세 태그 지침을 어디에 templetize할지
      (SP-CITYDEPT-TEMPLATE 공통부 vs 개별 SP) 별도 판단 필요.

## 2026-08-20 추가로 확인된 갭 (구현 중 발견, 정직하게 고지)

- **AGENCY_PUBKEY_REGISTRY가 비어있다** — 위 4개 엔드포인트 전부
  `_verifyAccessCert`를 타지만, 실제 기관 공개키가 하나도 등록되지
  않아 지금 이 순간 검증에 성공할 수 있는 기관이 없다(필드테스트
  레지스트리로 우회 가능, 2026-10-01 만료 — dept-task-handler.js
  주석 참조). 메커니즘은 완성됐으나 활성화(키 등록)는 이 저장소
  밖의 절차(기관 신원 오프라인 확인)가 선행돼야 한다 — dpaper.kr과
  동일 패턴.
- **dpaper.kr 미보관** — `officer-decision`의 `approved` 응답에
  `dpaper_note`로 명시했듯, 승인된 발급 문서를 dpaper.kr에 보관하는
  단계는 구현하지 않았다(스위치 꺼짐, `ACTIVATION-CHECKLIST_dpaper.md`
  참조). `dpaper_archived: false` 필드를 이벤트에 남겨두어, 승인 후
  dpaper.kr 연동이 켜지면 일괄 보관 처리할 대상을 나중에 찾을 수
  있게만 해뒀다.
- **`GOV_TASK_FIELD_INSPECTION_SCHEDULE`은 review_state를 바꾸지
  않는다** — §4가 정의한 4개 review_state 값 어디에도 "실사 일정
  조율 중"이 없어서, 없는 값을 지어내지 않고 기존 상태를 유지한 채
  이벤트만 감사로그로 남긴다. 실제 운영해보고 필요하면 review_state
  값 자체를 확장할지 별도 판단 필요.



## 승인된 뒤에만 의미 있는 작업 (별도 문서 — 혼동 주의)

- dpaper.kr 실제 제출·보관 연동은 `ACTIVATION-CHECKLIST_dpaper.md` 참조.
  `officer_decision: approved` 이후 발급 문서를 dpaper.kr에 보관하는
  지점만 두 문서가 만난다 — 그 외에는 독립적으로 진행 가능하다.

## 이 문서 자체의 갱신 규칙

새 구현 갭이 발견되면 이 문서에 체크박스로 추가한다. dpaper 체크리스트와
마찬가지로, 스위치/갭 목록을 여러 문서에 분산 기록하지 않는다.

최종 갱신: 2026-08-20 (worker.js/call-ai.js 실배선 반영)
