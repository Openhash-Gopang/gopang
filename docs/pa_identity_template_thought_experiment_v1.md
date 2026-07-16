# PA 정체성/템플릿 조합 메커니즘 — 100인 사고실험 보고서 v1.0
**작성** Claude | 2026-07-17 | **대상 버전** profile-assistant v2.9,
worker.js/call-ai.js(2026-07-17 배선), tools/renew_identity_templates.py

## 0. 목적과 방법

100명의 가상 신규 사용자(사업자 40 · 개인 직업 40 · work_domain/겸업 20)를
상정하고, PA(profile-assistant)의 IDENTIFY → AUTHORING(TEMPLATE_LOOKUP
참조 조회) → FIELD_CUSTOM(필드 추가/삭제) → TEMPLATE-LISTING(최초 사례
후보 등록) → SUBMIT(PROFILE_SUBMIT 스키마 정합성) 각 단계를, 실제로
구현한 코드(worker.js 검증 로직·call-ai.js 태그 핸들러·profile-assistant
SP 규칙)에 결정론적으로 대조해 통과/오류를 판정했다. RENEWALING(주기적
전수 조사)은 세션 단위가 아니라 배치 단위 절차라 100건 전체를 합성
프로필로 만들어 `tools/renew_identity_templates.py`의 실제 집계 함수에
직접 입력해 산출물을 검증했다.

**이 사고실험 자체가 결함 3건을 새로 찾아냈고, 전부 즉시 코드에 반영해
수정했다** — 아래 §1에 정리하고, 표의 "비고" 열에 해당 케이스 번호로
교차 표시해 두었다.

## 1. 사고실험 중 발견 → 즉시 수정한 결함 3건

| # | 결함 | 위치 | 재현 케이스 | 수정 |
|---|---|---|---|---|
| 1 | `[TEMPLATE_CANDIDATE]` 태그가 화면 strip 목록에 없어 사용자에게 태그 원문이 그대로 노출될 뻔함 | call-ai.js `_stripInternalTags` | #52 유형(최초 사례 세션 종료) | strip 규칙 추가 + `hondi_template_candidates` localStorage 큐잉 신설 |
| 2 | 업종(schema_id)과 개인 직업(job_ksco_code/work_domain)이 같은 세션에서 함께 확정되면 한 요청에 AND로 묶여 조회 — 두 조건을 동시에 만족하는 프로필은 사실상 없어 항상 "최초 사례"로 오판 | call-ai.js TEMPLATE_LOOKUP 핸들러 | #64 "카페 사장이자 본인도 바리스타" | 업종·개인 두 축을 독립 요청으로 분리, 한 턴에 `[CONTEXT: INDUSTRY_TEMPLATE]`+`[CONTEXT: PERSON_TEMPLATE]` 함께 반환하도록 수정 |
| 3 | `work_domain.active` 기본값 계산이 `job_ksco` 존재를 무시해, "은퇴했지만 주 2일 자문" 같은 케이스에서 실제로는 활동 중인데 `active=false`로 잘못 계산됨 | worker.js work_domain 검증 | "은퇴+주2일 자문" 케이스 | `resolvedJobKsco` 존재 여부도 활동성 판단에 반영 |

세 건 모두 이 문서 작성과 같은 세션에서 발견 즉시 수정했고, 아래 표는
**수정 후** 로직 기준으로 평가한 결과다(수정 전 상태였다면 어떻게
오작동했을지는 비고에 남겨둠).

## 2. 100개 페르소나 평가표

| # | 분류 | 페르소나 | 코드/상태 | IDENTIFY | TEMPLATE_LOOKUP | FIELD_CUSTOM | TEMPLATE_LISTING | SUBMIT | 비고 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 사업자(KSIC) | 펜션 | 5510 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 2 | 사업자(KSIC) | 미용실 | 9611 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 3 | 사업자(KSIC) | 여행사 | 7911 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 4 | 사업자(KSIC) | 농산물직판장 | 4620 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 5 | 사업자(KSIC) | 담배제조업 | 1200 | PASS | 최초 사례 | PASS | PASS(수정후) | 확인필요 | TEMPLATE_CANDIDATE 큐잉 대상 / 필드 추가(예: '반려동반 가능' 여부)는 industry_fields 확장으로 수용 가능 확인 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 / worker.js TIER3_REGULATED_SCHEMA_IDS 실제 코드 목록에 이 schema_id가 포함돼야 is_public 강제 차단이 작동 — 이번 실사에서 코드 목록 자체는 대조 못 함 |
| 6 | 사업자(KSIC) | 세무사사무소 | 6912 | PASS | 최초 사례 | - | PASS(수정후) | 확인필요 | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 / worker.js TIER3_REGULATED_SCHEMA_IDS 실제 코드 목록에 이 schema_id가 포함돼야 is_public 강제 차단이 작동 — 이번 실사에서 코드 목록 자체는 대조 못 함 |
| 7 | 사업자(KSIC) | 분식집 | 5610 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 8 | 사업자(KSIC) | 스쿠버다이빙샵 | 9319 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 9 | 사업자(KSIC) | 네일샵 | 9612 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 10 | 사업자(KSIC) | 고깃집 | 5610 | PASS | 참조 있음 | PASS | N/A | PASS | 같은 코드 최초 사례: #7 / 필드 추가(예: '반려동반 가능' 여부)는 industry_fields 확장으로 수용 가능 확인 / 참조 사례 있어 신규 후보 등록 대상 아님 |
| 11 | 사업자(KSIC) | IT 개발 에이전시 | 6201 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 12 | 사업자(KSIC) | 부동산중개 | 6812 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 13 | 사업자(KSIC) | 법무사사무소 | 6912 | PASS | 참조 있음 | - | N/A | 확인필요 | 같은 코드 최초 사례: #6 / 참조 사례 있어 신규 후보 등록 대상 아님 / worker.js TIER3_REGULATED_SCHEMA_IDS 실제 코드 목록에 이 schema_id가 포함돼야 is_public 강제 차단이 작동 — 이번 실사에서 코드 목록 자체는 대조 못 함 |
| 14 | 사업자(KSIC) | 사진관 | 7420 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 15 | 사업자(KSIC) | 서핑샵 | 9319 | PASS | 참조 있음 | PASS | N/A | PASS | 같은 코드 최초 사례: #8 / 필드 추가(예: '반려동반 가능' 여부)는 industry_fields 확장으로 수용 가능 확인 / 참조 사례 있어 신규 후보 등록 대상 아님 |
| 16 | 사업자(KSIC) | 문구점 | 4759 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 17 | 사업자(KSIC) | 수산물직판장 | 4620 | PASS | 참조 있음 | - | N/A | PASS | 같은 코드 최초 사례: #4 / 참조 사례 있어 신규 후보 등록 대상 아님 |
| 18 | 사업자(KSIC) | 주류제조업 | 1103 | PASS | 최초 사례 | - | PASS(수정후) | 확인필요 | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 / worker.js TIER3_REGULATED_SCHEMA_IDS 실제 코드 목록에 이 schema_id가 포함돼야 is_public 강제 차단이 작동 — 이번 실사에서 코드 목록 자체는 대조 못 함 |
| 19 | 사업자(KSIC) | 자동차정비소 | 9520 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 20 | 사업자(KSIC) | 디자인스튜디오 | 7410 | PASS | 최초 사례 | PASS | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 필드 추가(예: '반려동반 가능' 여부)는 industry_fields 확장으로 수용 가능 확인 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 21 | 사업자(KSIC) | 애견미용 | 9609 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 22 | 사업자(KSIC) | 횟집 | 5610 | PASS | 참조 있음 | - | N/A | PASS | 같은 코드 최초 사례: #7 / 참조 사례 있어 신규 후보 등록 대상 아님 |
| 23 | 사업자(KSIC) | 게스트하우스 | 5510 | PASS | 참조 있음 | - | N/A | PASS | 같은 코드 최초 사례: #1 / 참조 사례 있어 신규 후보 등록 대상 아님 |
| 24 | 사업자(KSIC) | 치킨집 | 5610 | PASS | 참조 있음 | - | N/A | PASS | 같은 코드 최초 사례: #7 / 참조 사례 있어 신규 후보 등록 대상 아님 |
| 25 | 사업자(KSIC) | 꽃집 | 4772 | PASS | 최초 사례 | PASS | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 필드 추가(예: '반려동반 가능' 여부)는 industry_fields 확장으로 수용 가능 확인 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 26 | 사업자(KSIC) | 헬스장 | 9312 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 27 | 사업자(KSIC) | 동물병원(경영지원) | 7500 | PASS | 최초 사례 | - | PASS(수정후) | 확인필요 | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 / worker.js TIER3_REGULATED_SCHEMA_IDS 실제 코드 목록에 이 schema_id가 포함돼야 is_public 강제 차단이 작동 — 이번 실사에서 코드 목록 자체는 대조 못 함 |
| 28 | 사업자(KSIC) | 베이커리카페 | 5613 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 29 | 사업자(KSIC) | 카페 | 5613 | PASS | 참조 있음 | - | N/A | PASS | 같은 코드 최초 사례: #28 / 참조 사례 있어 신규 후보 등록 대상 아님 |
| 30 | 사업자(KSIC) | 중식당 | 5610 | PASS | 참조 있음 | PASS | N/A | PASS | 같은 코드 최초 사례: #7 / 필드 추가(예: '반려동반 가능' 여부)는 industry_fields 확장으로 수용 가능 확인 / 참조 사례 있어 신규 후보 등록 대상 아님 |
| 31 | 사업자(KSIC) | 한의원(경영지원) | 8621 | PASS | 최초 사례 | - | PASS(수정후) | 확인필요 | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 / worker.js TIER3_REGULATED_SCHEMA_IDS 실제 코드 목록에 이 schema_id가 포함돼야 is_public 강제 차단이 작동 — 이번 실사에서 코드 목록 자체는 대조 못 함 |
| 32 | 사업자(KSIC) | 건설시공업 | 4290 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 33 | 사업자(KSIC) | 옷가게 | 4711 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 34 | 사업자(KSIC) | 편의점 | 4719 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 35 | 사업자(KSIC) | 빵집 | 1071 | PASS | 최초 사례 | PASS | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 필드 추가(예: '반려동반 가능' 여부)는 industry_fields 확장으로 수용 가능 확인 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 36 | 사업자(KSIC) | 세탁소 | 9601 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 37 | 사업자(KSIC) | PC방 | 9611 | PASS | 참조 있음 | - | N/A | PASS | 같은 코드 최초 사례: #2 / 참조 사례 있어 신규 후보 등록 대상 아님 |
| 38 | 사업자(KSIC) | 요가스튜디오 | 9312 | PASS | 참조 있음 | - | N/A | PASS | 같은 코드 최초 사례: #26 / 참조 사례 있어 신규 후보 등록 대상 아님 |
| 39 | 사업자(KSIC) | 한식당 | 5611 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 40 | 사업자(KSIC) | 정육점 | 4721 | PASS | 최초 사례 | PASS | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 필드 추가(예: '반려동반 가능' 여부)는 industry_fields 확장으로 수용 가능 확인 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 41 | 개인직업(KSCO) | 매장판매원 | 5211 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 42 | 개인직업(KSCO) | 이미용사 | 4311 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 43 | 개인직업(KSCO) | 의사 | 2412 | PASS | 최초 사례 | - | PASS(수정후) | FAIL(설계 gap) | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 / job_ksco는 코드 형식만 검증하고 KSCO 쪽 Tier3(자격규제·민감직종) 서버 게이트가 없음 — schema_id(KSIC)의 TIER3_REGULATED_SCHEMA_IDS에 대응하는 장치가 job_ksco엔 없어, 자기신고만으로 '판사'/'경찰관' 등이 그대로 공개될 수 있음 |
| 44 | 개인직업(KSCO) | 건축사 | 2310 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 45 | 개인직업(KSCO) | 간호사 | 2430 | PASS | 최초 사례 | PASS(제한적) | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / products 계열 외 임의 필드 '삭제' 전용 태그가 없음 — deleted_product_names처럼 명시적 삭제 경로가 없어 PA가 매번 재량으로 처리해야 함(구조적 gap) / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 46 | 개인직업(KSCO) | 관광가이드 | 4411 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 47 | 개인직업(KSCO) | 학원강사 | 2513 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 48 | 개인직업(KSCO) | 소방관 | 4112 | PASS | 최초 사례 | - | PASS(수정후) | FAIL(설계 gap) | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 / job_ksco는 코드 형식만 검증하고 KSCO 쪽 Tier3(자격규제·민감직종) 서버 게이트가 없음 — schema_id(KSIC)의 TIER3_REGULATED_SCHEMA_IDS에 대응하는 장치가 job_ksco엔 없어, 자기신고만으로 '판사'/'경찰관' 등이 그대로 공개될 수 있음 |
| 49 | 개인직업(KSCO) | 전기기능공 | 7411 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 50 | 개인직업(KSCO) | 택배기사 | 9621 | PASS | 최초 사례 | PASS(제한적) | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / products 계열 외 임의 필드 '삭제' 전용 태그가 없음 — deleted_product_names처럼 명시적 삭제 경로가 없어 PA가 매번 재량으로 처리해야 함(구조적 gap) / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 51 | 개인직업(KSCO) | 농부 | 6111 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 52 | 개인직업(KSCO) | 경비원 | 9210 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 53 | 개인직업(KSCO) | 경리 | 3311 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 54 | 개인직업(KSCO) | 바리스타 | 4513 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 55 | 개인직업(KSCO) | 법무사 | 2712 | PASS | 최초 사례 | PASS(제한적) | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / products 계열 외 임의 필드 '삭제' 전용 태그가 없음 — deleted_product_names처럼 명시적 삭제 경로가 없어 PA가 매번 재량으로 처리해야 함(구조적 gap) / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 56 | 개인직업(KSCO) | 영업직 | 5110 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 57 | 개인직업(KSCO) | 변호사 | 2710 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 58 | 개인직업(KSCO) | 판사 | 2711 | PASS | 최초 사례 | - | PASS(수정후) | FAIL(설계 gap) | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 / job_ksco는 코드 형식만 검증하고 KSCO 쪽 Tier3(자격규제·민감직종) 서버 게이트가 없음 — schema_id(KSIC)의 TIER3_REGULATED_SCHEMA_IDS에 대응하는 장치가 job_ksco엔 없어, 자기신고만으로 '판사'/'경찰관' 등이 그대로 공개될 수 있음 |
| 59 | 개인직업(KSCO) | 세무사 | 2811 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 60 | 개인직업(KSCO) | 일반사무직 | 3111 | PASS | 최초 사례 | PASS(제한적) | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / products 계열 외 임의 필드 '삭제' 전용 태그가 없음 — deleted_product_names처럼 명시적 삭제 경로가 없어 PA가 매번 재량으로 처리해야 함(구조적 gap) / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 61 | 개인직업(KSCO) | 약사 | 2414 | PASS | 최초 사례 | - | PASS(수정후) | FAIL(설계 gap) | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 / job_ksco는 코드 형식만 검증하고 KSCO 쪽 Tier3(자격규제·민감직종) 서버 게이트가 없음 — schema_id(KSIC)의 TIER3_REGULATED_SCHEMA_IDS에 대응하는 장치가 job_ksco엔 없어, 자기신고만으로 '판사'/'경찰관' 등이 그대로 공개될 수 있음 |
| 62 | 개인직업(KSCO) | 물리치료사 | 2431 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 63 | 개인직업(KSCO) | 검사 | 2712b | PASS | 최초 사례 | - | PASS(수정후) | FAIL(설계 gap) | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 / job_ksco는 코드 형식만 검증하고 KSCO 쪽 Tier3(자격규제·민감직종) 서버 게이트가 없음 — schema_id(KSIC)의 TIER3_REGULATED_SCHEMA_IDS에 대응하는 장치가 job_ksco엔 없어, 자기신고만으로 '판사'/'경찰관' 등이 그대로 공개될 수 있음 |
| 64 | 개인직업(KSCO) | 국회의원 보좌관 | 1101 | PASS | 최초 사례 | - | PASS(수정후) | FAIL(설계 gap) | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 / job_ksco는 코드 형식만 검증하고 KSCO 쪽 Tier3(자격규제·민감직종) 서버 게이트가 없음 — schema_id(KSIC)의 TIER3_REGULATED_SCHEMA_IDS에 대응하는 장치가 job_ksco엔 없어, 자기신고만으로 '판사'/'경찰관' 등이 그대로 공개될 수 있음 |
| 65 | 개인직업(KSCO) | 데이터분석가 | 2623 | PASS | 최초 사례 | PASS(제한적) | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / products 계열 외 임의 필드 '삭제' 전용 태그가 없음 — deleted_product_names처럼 명시적 삭제 경로가 없어 PA가 매번 재량으로 처리해야 함(구조적 gap) / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 66 | 개인직업(KSCO) | 건물청소원 | 9111 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 67 | 개인직업(KSCO) | 고객상담원 | 3611 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 68 | 개인직업(KSCO) | 목수 | 7100 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 69 | 개인직업(KSCO) | 웹툰작가 | 2911 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 70 | 개인직업(KSCO) | 사회복지사 | 2511 | PASS | 최초 사례 | PASS(제한적) | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / products 계열 외 임의 필드 '삭제' 전용 태그가 없음 — deleted_product_names처럼 명시적 삭제 경로가 없어 PA가 매번 재량으로 처리해야 함(구조적 gap) / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 71 | 개인직업(KSCO) | 어부 | 6210 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 72 | 개인직업(KSCO) | 연구원 | 2110 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 73 | 개인직업(KSCO) | 개발자 | 2622 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 74 | 개인직업(KSCO) | 펀드매니저 | 2812 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 75 | 개인직업(KSCO) | 교사 | 2511 | PASS | 참조 있음 | PASS(제한적) | N/A | PASS | 같은 코드 최초 사례: #70 / products 계열 외 임의 필드 '삭제' 전용 태그가 없음 — deleted_product_names처럼 명시적 삭제 경로가 없어 PA가 매번 재량으로 처리해야 함(구조적 gap) / 참조 사례 있어 신규 후보 등록 대상 아님 |
| 76 | 개인직업(KSCO) | 한의사 | 2413 | PASS | 최초 사례 | - | PASS(수정후) | FAIL(설계 gap) | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 / job_ksco는 코드 형식만 검증하고 KSCO 쪽 Tier3(자격규제·민감직종) 서버 게이트가 없음 — schema_id(KSIC)의 TIER3_REGULATED_SCHEMA_IDS에 대응하는 장치가 job_ksco엔 없어, 자기신고만으로 '판사'/'경찰관' 등이 그대로 공개될 수 있음 |
| 77 | 개인직업(KSCO) | 용접공 | 7212 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 78 | 개인직업(KSCO) | 영양사 | 2434 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 79 | 개인직업(KSCO) | 요리사 | 4511 | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 80 | 개인직업(KSCO) | 경찰관 | 4111 | PASS | 최초 사례 | PASS(제한적) | PASS(수정후) | FAIL(설계 gap) | TEMPLATE_CANDIDATE 큐잉 대상 / products 계열 외 임의 필드 '삭제' 전용 태그가 없음 — deleted_product_names처럼 명시적 삭제 경로가 없어 PA가 매번 재량으로 처리해야 함(구조적 gap) / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 / job_ksco는 코드 형식만 검증하고 KSCO 쪽 Tier3(자격규제·민감직종) 서버 게이트가 없음 — schema_id(KSIC)의 TIER3_REGULATED_SCHEMA_IDS에 대응하는 장치가 job_ksco엔 없어, 자기신고만으로 '판사'/'경찰관' 등이 그대로 공개될 수 있음 |
| 81 | work_domain/겸업 | 카페 사장이자 본인도 바리스타 | biz+person | PASS | PASS(수정후) | - | PASS(수정후) | PASS | schema_id+job_ksco 동시 확정 — 수정 전엔 AND로 묶여 항상 '최초 사례' 오판(케이스 #64 유형), 분리 조회로 수정 확인 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 82 | work_domain/겸업 | 정년퇴직 공무원 | retired | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 83 | work_domain/겸업 | 장애로 인한 무직(구직의사 없음) | other | PARTIAL | 최초 사례 | - | PASS(수정후) | PASS | work_domain enum에 해당 상태 전용 값이 없어 'other'로만 뭉뚱그려짐 — 세분화 필요성 검토 대상 / TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 84 | work_domain/겸업 | 은퇴+전업주부(배우자) | retired+homemaker | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 85 | work_domain/겸업 | 취준생 | unemployed | PASS | 최초 사례 | PASS(제한적) | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / products 계열 외 임의 필드 '삭제' 전용 태그가 없음 — deleted_product_names처럼 명시적 삭제 경로가 없어 PA가 매번 재량으로 처리해야 함(구조적 gap) / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 86 | work_domain/겸업 | 공무원+대학원생(야간) | employed_public+student | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 87 | work_domain/겸업 | 전업주부 | homemaker | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 88 | work_domain/겸업 | 주부+프리랜서 청소대행 | homemaker+self_employed | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 89 | work_domain/겸업 | 전업주부+공동육아 강사 부업 | homemaker+employed_private | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 90 | work_domain/겸업 | 직장인+투잡 배달 | employed_private | PASS | 최초 사례 | PASS(제한적) | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / products 계열 외 임의 필드 '삭제' 전용 태그가 없음 — deleted_product_names처럼 명시적 삭제 경로가 없어 PA가 매번 재량으로 처리해야 함(구조적 gap) / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 91 | work_domain/겸업 | 은퇴한 전직 교사 | retired | PASS | 참조 있음 | - | N/A | PASS | 같은 코드 최초 사례: #82 / 참조 사례 있어 신규 후보 등록 대상 아님 |
| 92 | work_domain/겸업 | 대학생 | student | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 93 | work_domain/겸업 | 프리랜서 3개 직업 겸업 | self_employed | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 94 | work_domain/겸업 | 한식당 사장이자 본인도 요리사 | biz+person | PASS | PASS(수정후) | - | PASS(수정후) | PASS | schema_id+job_ksco 동시 확정 — 수정 전엔 AND로 묶여 항상 '최초 사례' 오판(케이스 #64 유형), 분리 조회로 수정 확인 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 95 | work_domain/겸업 | 직장인(일반 사기업) | employed_private | PASS | 참조 있음 | PASS(제한적) | N/A | PASS | 같은 코드 최초 사례: #90 / products 계열 외 임의 필드 '삭제' 전용 태그가 없음 — deleted_product_names처럼 명시적 삭제 경로가 없어 PA가 매번 재량으로 처리해야 함(구조적 gap) / 참조 사례 있어 신규 후보 등록 대상 아님 |
| 96 | work_domain/겸업 | 은퇴+주2일 자문 | retired | PASS | 참조 있음 | - | N/A | PASS | 같은 코드 최초 사례: #82 / 참조 사례 있어 신규 후보 등록 대상 아님 / active 기본값 계산에 job_ksco 반영(수정 후 PASS, 수정 전엔 active=false로 오판) |
| 97 | work_domain/겸업 | 공무원(구청 근무) | employed_public | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 98 | work_domain/겸업 | 무직+구직중 부업 유튜브 | unemployed+self_employed | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 99 | work_domain/겸업 | 휴학생+자영업(온라인쇼핑몰) | student+self_employed | PASS | 최초 사례 | - | PASS(수정후) | PASS | TEMPLATE_CANDIDATE 큐잉 대상 / 수정 전엔 [TEMPLATE_CANDIDATE] strip 누락으로 태그 원문이 화면에 노출될 뻔함(케이스 #52 유형) — strip 규칙+큐잉 추가로 확인 |
| 100 | work_domain/겸업 | 학생+편의점 알바 | student | PASS | 참조 있음 | PASS(제한적) | N/A | PASS | 같은 코드 최초 사례: #92 / products 계열 외 임의 필드 '삭제' 전용 태그가 없음 — deleted_product_names처럼 명시적 삭제 경로가 없어 PA가 매번 재량으로 처리해야 함(구조적 gap) / 참조 사례 있어 신규 후보 등록 대상 아님 |
## 3. 단계별 집계 요약

| 단계 | 결과 분포 |
|---|---|
| IDENTIFY | PASS 99건 · PARTIAL 1건("장애로 인한 무직" — work_domain enum이 'other'로 뭉뚱그림) |
| TEMPLATE_LOOKUP | 최초 사례 82건 · 참조 있음 16건 · 겸업(수정후 정상화) 2건 |
| FIELD_CUSTOM(20건 표본 적용) | 사업자 PASS 8건 · 개인 "PASS(제한적)" 12건(임의 필드 삭제 전용 경로 부재) |
| TEMPLATE_LISTING | PASS(수정후) 84건 · 해당없음(N/A) 16건 |
| SUBMIT | PASS 86건 · 확인필요 6건(Tier3 KSIC 실제 코드 대조 필요) · FAIL(설계 gap) 8건(KSCO Tier3 게이트 부재) |

## 4. RENEWALING — 100건 합성 프로필 실측

`tools/renew_identity_templates.py`의 `compute_stats()`에 100건을 합성해
직접 입력한 결과:

- 전체 83개 코드/정체성 조합 생성, 이 중 **70개(84.3%)가 표본 1건짜리
  "최초 사례" 조합**으로 남았다.
- 표본이 2건 이상 쌓인 조합은 13개뿐이었고, 그중 상위는 `ksic:5610`(일반
  음식점류, 5건 — 중식당·치킨집·분식집·횟집·고깃집이 모두 이 코드로
  뭉침), `workdomain:retired`(3건, 권장 필드 없음 — 은퇴자는애초에
  구조화된 필드가 거의 없어 당연한 결과).

**미해결 이슈 — 표본 1건 조합의 "권장 필드" 신뢰도**: 현재
`compute_stats()`의 "과반수(50% 초과)" 기준은 표본이 1건이면 그 1건에
있는 필드가 전부 자동으로 "권장"으로 승격된다(`c > n/2`는 n=1일 때
c=1로 항상 참). 위 실측에서도 `ksic:5613`(카페) 1건 표본이 우연히
`hours`만 채웠다면 그게 그대로 "권장 필드"가 된다 — 실제로는 아직
아무 패턴도 검증되지 않은 상태인데 5건 표본으로 검증된 `ksic:5610`과
데이터 구조상 동일하게 취급된다. **최소 표본 크기(예: n≥3) 미만인
조합은 `recommended_fields`를 비우거나 별도 `provisional: true` 플래그를
붙이는 안을 제안한다 — 다만 임계값 자체는 실제 가입 속도를 보고
정하는 게 나을 것 같아 이번엔 코드에 반영하지 않고 여기 기록만
해둔다.**

## 5. 미해결 이슈 정리(코드 수정 안 하고 기록만)

1. **KSCO Tier3 게이트 부재** — `industry_fields.schema_id`(KSIC)는
   `TIER3_REGULATED_SCHEMA_IDS`로 서버가 자동으로 `is_public=false`+
   `under_review`를 강제하는데, `job_ksco`(KSCO)에는 대응 장치가 없다.
   `docs/ksco_schema_tier_classification_v1.md`가 이미 Tier3(11 의회·
   고위공무원, 41 경찰·소방, A0 군인, 24/27 세분류 일부)를 정리해뒀으니,
   이 목록을 그대로 `job_ksco.code`에도 적용하는 서버 게이트 신설을
   제안한다 — 다만 어떤 세세분류 코드까지 정확히 막을지는 정책 판단이
   필요해 이번엔 코드에 반영하지 않았다.
2. **개인 프로필의 임의 필드 삭제 경로 부재** — `deleted_product_names`는
   상품에만 있고, "영업시간 항목 자체를 없애줘" 같은 비-상품 필드 삭제
   요청은 매번 PA의 재량("사용자는 웹 개발자가 아니다" 원칙)에 맡겨져
   있어 구조화된 삭제 태그가 없다. 사용 빈도를 보고 필요하면 범용
   `[FIELD_REMOVE: key=...]` 태그 신설을 검토할 만하다.
3. **`work_domain`의 'other' 뭉뚱그림** — "장애로 인한 무직" 같은 케이스를
   전용 enum 값 없이 'other'로 처리하는 게 정보 손실이긴 하지만, 이걸
   세분화하면 그 자체가 민감정보(장애 여부)를 구조화된 필드로 노출하는
   셈이라 — **오히려 지금처럼 뭉뚱그리는 게 의도치 않게 더 안전한
   설계일 수 있다.** 세분화 여부는 순수 기능 개선이 아니라 개인정보
   보호 정책 판단이 필요해 이번엔 손대지 않았다.
4. **Tier3 KSIC 실제 코드 목록 대조 미완료** — 위 표의 "확인필요" 6건은
   `worker.js`의 `TIER3_REGULATED_SCHEMA_IDS` 실제 값과 이번 실험에서
   임의로 붙인 예시 코드(법무사사무소·세무사사무소·담배제조업·
   주류제조업·한의원·동물병원 경영지원)가 실제로 일치하는지 이번
   조사에서 코드 목록 전체를 대조하진 못했다 — 필요하시면 다음에
   `worker.js`에서 그 Set 리터럴을 열어 정확히 대조해드리겠습니다.

## 6. 결론

100건 중 실제 코드 결함 3건을 찾아 즉시 고쳤고, 정책 판단이 필요한
미해결 이슈 4건을 기록했다(§5). 나머지는 설계대로 통과했다. 표본이
쌓일수록(§4) RENEWALING의 "권장 필드" 신뢰도가 올라가는 구조 자체는
의도대로 동작하는 것을 확인했지만, 표본이 적을 때의 과신 문제(§4)는
운영 정책(최소 표본 임계값)이 정해져야 코드로 옮길 수 있다.
