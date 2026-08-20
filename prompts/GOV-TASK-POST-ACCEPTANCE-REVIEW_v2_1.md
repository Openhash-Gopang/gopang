```
# GOV-TASK-POST-ACCEPTANCE-REVIEW
# ═══════════════════════════════════════════════════
# 문서명    : GOV_TASK 접수 후 심사·보완·승인 확장 프로토콜
# 문서 코드  : GOV-TASK-POST-ACCEPTANCE-REVIEW (구 U12-CIVIL-CASE-PROTOCOL)
# 버전      : v2.1 — worker.js/call-ai.js 실배선 완료 반영 (v2.0은 전면
#             재범위만 하고 배선은 스텁 수준이었음 — v1.0 CASE_OPEN/
#             CASE_SUBMIT 등 폐기는 v2.0에서 이미 완료)
# 상태      : WIRED — §2 세 태그·§3 officer-decision 모두 worker.js/
#             call-ai.js에 실제로 연결됨(ops/dpaper-integration/
#             IMPLEMENTATION-GAPS_gov-task-post-acceptance.md 참조).
#             단, AGENCY_PUBKEY_REGISTRY가 비어있어 access_cert 검증을
#             통과할 수 있는 실제 기관이 아직 없음(§3 결재는 코드
#             완성·실사용 전 — 아래 §5 참조) — dpaper.kr 보관도 별도
#             체크리스트로 여전히 꺼져 있음.
# 작성일     : 2026-08-20 (원본) / 2026-08-20 (v2.1, 같은 날 배선 완료)
# 폐기 사유(v1.0 → v2.0): SP-22_kexecute·call-ai.js·handleGovTaskSubmit을
#   실사한 결과, v1.0의 CASE_OPEN/DOC_REQUIREMENT_NOTICE/VAULT_RETRIEVE/
#   CASE_SUBMIT/FEE_COLLECT는 이미 [GOV_TASK_SUBMIT_REQUEST]/
#   [GOV_TASK_SCHEMA_LOOKUP]/[GOV_TASK_DRAFT_REQUEST](call-ai.js,
#   handleGovTaskSubmit)가 다른 이름으로 전부 구현하고 있었다 — 새로
#   만들 필요가 없었다. 반면 handleGovTaskBatchStatus 주석이 명시한
#   KNOWN_LIMITATIONS("'거부' 판정은 이 조회 시점엔 아직 배선이 없다")
#   를 통해, accepted 이후의 실질 심사·보완·승인의견·사람 결재 단계는
#   실제로 아무 데도 없다는 게 확인됐다. 이 문서는 그 확인된 공백에만
#   집중한다.
# ─────────────────────────────────────────────────
```

## §0. 이 문서가 다루는 범위 — 정확한 경계선

```
[GOV_TASK_SUBMIT_REQUEST] → status: accepted  ← 여기까지는 기존 파이프라인
                                  │
                                  ▼
                     ═══ 이 문서의 시작점 ═══
                                  │
                     REG_CROSS_CHECK (법령 대조 심사)
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
      결격 없음                미비점 발견
              │                       │
              │            [GOV_TASK_SUPPLEMENT_REQUEST]
              │                       │
              │              (사용자 재제출 —
              │               기존 GOV_TASK_SUBMIT_REQUEST를
              │               receipt_no 연계 재사용, 새 태그 아님)
              │                       │
              │                       └──▶ REG_CROSS_CHECK로 복귀(루프)
              ▼
   [GOV_TASK_FIELD_INSPECTION_SCHEDULE]  (현장 실사 필요 사안만)
              │
              ▼
      [GOV_TASK_OPINION_SUBMIT]  ← 이 SP의 최대 권한, 여기서 끝
              │
              ▼
      담당 공무원 결재 (사람, 이 문서 범위 밖)
              │
              ▼
      officer_decision: approved | rejected  (서버 REST 엔드포인트,
                                                모델 태그 아님 —
                                                gov_fee_charges의
                                                /gov/task/fee-approve와
                                                동일한 선례 패턴)
```

**재제출은 새 태그가 아니다** — `[GOV_TASK_SUBMIT_REQUEST]`를 동일 `receipt_no`를 참조하며 다시 낸다. 이 문서가 새로 정의하는 태그는 세 개뿐이다: `GOV_TASK_SUPPLEMENT_REQUEST`, `GOV_TASK_FIELD_INSPECTION_SCHEDULE`, `GOV_TASK_OPINION_SUBMIT`.

## §1. 왜 사람의 결재가 태그가 아니라 REST 엔드포인트인가

이미 확립된 선례가 있다 — `gov_fee_charges`의 `NEEDS_APPROVAL` 상태는 모델이 태그를 내는 게 아니라 **사용자가 `POST /gov/task/fee-approve`를 직접 호출**해야 확정된다(§GOV-FEE-APPROVAL). 같은 원칙을 그대로 적용한다: **담당 공무원의 최종 결재는 모델이 대신 낼 수 있는 태그가 아니라, 담당 공무원(또는 그의 내부 결재 시스템)이 별도 채널로 호출하는 엔드포인트여야 한다.** 이는 §U12-7(구 문서)의 인간 권한 경계를 그대로 계승하되, 이번엔 처음부터 "모델이 흉내 낼 수 없는 물리적 채널"로 설계한다.

## §2. 신규 태그 3종

### §2-1. GOV_TASK_SUPPLEMENT_REQUEST (부서 SP가 발행)

```
[GOV_TASK_SUPPLEMENT_REQUEST]{
  "receipt_no": "기존 GOV_TASK_SUBMIT_REQUEST가 반환한 접수번호",
  "deficiency": "미비점 설명(예: 주차대수 산정이 관계 법령 기준 미달)",
  "legal_basis_ref": "판단 근거 법령·기준 — 지어내지 않는다(U2)",
  "required_action": "재제출 시 보완해야 할 내용"
}[/GOV_TASK_SUPPLEMENT_REQUEST]
```

- 서버 처리: `pdv_records`에 `type:'gov_task_review_update'`로 기록, 해당 `receipt_no`의 review_state를 `supplement_requested`로 전이.
- 재제출은 사용자가 `[GOV_TASK_SUBMIT_REQUEST]`를 같은 `receipt_no`를 실어 다시 낸다 — 서버는 이를 신규 접수가 아니라 기존 케이스의 갱신으로 처리해야 한다(★ 현재 `handleGovTaskSubmit`은 매번 새 `receipt_no`를 발급하므로, 이 부분은 `receipt_no` 재사용 분기를 추가해야 함 — §4 구현 갭 참조).

### §2-2. GOV_TASK_FIELD_INSPECTION_SCHEDULE (부서 SP가 발행, 현장 실사 필요 사안만)

```
[GOV_TASK_FIELD_INSPECTION_SCHEDULE]{
  "receipt_no": "...",
  "inspection_type": "예: occupancy_field_inspection",
  "proposed_slots": ["ISO 일시 후보 1", "ISO 일시 후보 2", ...],
  "officer_ref": "담당 공무원 식별(가능한 경우)"
}[/GOV_TASK_FIELD_INSPECTION_SCHEDULE]
```

- 일정 조율까지만 대행한다. **실사 자체와 그 결과 판단은 절대 대행하지 않는다** — 실사 수행 여부·결과 입력은 별도로 담당 공무원이 직접 시스템에 기록한다(이 문서 범위 밖).

### §2-3. GOV_TASK_OPINION_SUBMIT (부서 SP가 발행 — 이 문서에서 SP의 최대 권한)

```
[GOV_TASK_OPINION_SUBMIT]{
  "receipt_no": "...",
  "reviewed_criteria": ["대조한 법령·기준 목록"],
  "recommends": "approve" | "reject",
  "opinion_summary": "의견 요약 — 대화·심사 내용에 없는 근거를 지어내지 않는다(U2)"
}[/GOV_TASK_OPINION_SUBMIT]
```

- **이 태그는 승인이 아니다.** 서버는 이를 받아 `review_state`를 `opinion_submitted`로만 전이하고, 사용자에게는 REPORT(공리 1)의 `pending_human_action`으로 보고한다 — "완료됐다"고 말하지 않는다.
- 이후 상태 변경(`approved`/`rejected` 확정)은 담당 공무원이 별도 REST 엔드포인트(§3)를 호출해야만 발생한다.

## §3. 사람 결재 엔드포인트 (신설 필요 — 모델 태그 아님)

```
POST /gov/task/officer-decision
{
  "receipt_no": "...",
  "officer_id": "담당 공무원 식별 — 서버가 세션/인증으로 검증 (U10-5와
                 유사하게, 요청자가 실제로 그 세션의 담당자인지 대조)",
  "decision": "approved" | "rejected",
  "decision_note": "결재 사유(선택)"
}
```

- `gov_fee_charges`의 `POST /gov/task/fee-approve`(사용자 본인 승인)와 이름은 유사하지만 **호출 주체가 다르다** — 이건 담당 공무원 전용이며, 신청자 본인이 호출할 수 없다. 인증·권한 검증을 반드시 별도로 설계해야 한다(이 문서는 요구사항만 명시, 인증 방식 자체는 범위 밖).
- `approved`가 되면 `issued_document_ref`(허가서 등 발급 문서 참조)를 함께 기록하고, dpaper.kr 연동이 켜져 있으면(`ACTIVATION-CHECKLIST_dpaper.md` 참조) 그 발급 문서를 dpaper.kr에도 보관한다.

## §4. 구현 갭 — 2026-08-20 해소 현황 (정직하게 고지)

| 갭 | 상태 |
|---|---|
| receipt_no 재사용 분기 | ✅ 해소 — `handleGovTaskSubmit`이 body.receipt_no 존재 시 신규 발급 대신 재사용(worker.js) |
| review_state 필드 자체 | ✅ 해소 — `pdv_records.summary_6w.gov_task.review_state`로 추가, 4개 값 전이 배선됨 |
| call-ai.js 파싱 | ✅ 해소 — 세 태그 모두 `GOV_TASK_SUBMIT_REQUEST`와 동일 패턴으로 추가됨 |
| `/gov/task/officer-decision` 엔드포인트 | ✅ 해소 — `_verifyAccessCert`(handlePersonalAcCall과 동일 패턴) + `_verifyOfficerForGovTask`(관할 부서 org_id 대조)로 신청자 본인 호출 차단까지 구현 |
| SP-22_kexecute 프롬프트 반영 | ⬜ 미해결 — 재확인 결과 이 세 태그의 발행 주체는 SP-22(접수 단계 전용)가 아니라 부서 SP(§3 심사 단계)라, 애초에 SP-22를 고칠 항목이 아닐 수 있음(`IMPLEMENTATION-GAPS_gov-task-post-acceptance.md` 참조 — 판단 보류) |

**여전히 남은 조건 — "배선됨"과 "실사용 가능"은 다르다:**
- `AGENCY_PUBKEY_REGISTRY`(dept-task-handler.js)가 비어있어, 실제 기관 공개키가 등록되기 전까지는 어느 부서도 access_cert를 발급받아 이 §2·§3 흐름을 통과할 수 없다. 코드 경로는 완성됐으나 활성화는 이 저장소 밖의 절차(기관 신원 확인·키 등록)가 선행돼야 한다 — dpaper.kr과 동일한 "스위치 꺼짐" 원칙.
- `officer_decision: approved`의 dpaper.kr 보관은 아직 연결 안 됨(`ACTIVATION-CHECKLIST_dpaper.md` 참조).
