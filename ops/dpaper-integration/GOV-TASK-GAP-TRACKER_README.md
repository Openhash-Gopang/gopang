# GOV-TASK-GAP-TRACKER 사용법

이 폴더의 `GOV-TASK-GAP-TRACKER_2026-08-20.csv`는 [[gov-task-904-gap-filling]]
프로젝트(REQUIRED_DOCUMENTS_REGISTRY 904개 기관 공백 채우기)의 **진행상황
추적 표**다. `gov-tree-hondi-readiness-audit.xlsx`(전수조사 시트, Q1=Y & Q2=N
필터링된 904행)를 원본으로 만들었고, 이후 상태 갱신은 원본 xlsx가 아니라
**이 CSV에서만** 한다 — xlsx는 최초 스냅샷일 뿐, 계속 갱신되는 건 이 파일이다.

## 열 설명

| 열 | 의미 |
|---|---|
| 분류 | 01-do / 02-do-dept / 03-do-agency / 04-city / 06-expert / 07-org / 09-national / benefit-categories |
| 경로 | 저장소 내 SP 파일 경로(`prompts/gov-tree/` 기준 상대경로) |
| 이름 | 기관·부서명 |
| Q1/Q2 | 원본 감사(2026-08-20)의 판정값 — 방법론은 요약 시트 참조, 키워드 매칭이라 오탐 가능 |
| **상태** | `미착수` / `완료` / `제외(오탐)` / `재정의` / `진행중` 중 하나 |
| 비고 | 상태 판단 근거, 등록한 task_key, 오탐 사유 등 |
| PR | 완료 시 병합된 PR 번호 |
| 완료일 | 완료 처리된 날짜 |

## 상태값 정의

- **미착수**: 아직 아무 작업 안 함(기본값)
- **완료**: §3의 5단계 체크리스트(SP 본문 수정, REQUIRED_DOCUMENTS_REGISTRY
  등록, AGENCY_TO_DEPT_TARGET/GOV_TASK_AGENCY_TO_ORGID, 필요시
  division-tables.js)를 실제로 마치고 PR이 main에 병합된 상태
- **제외(오탐)**: 실사 결과 애초에 GOV_TASK 배선이 필요 없다고 판단된 것
  (예: SP-EXP-EMERGENCY — 응급신고 안내이지 인허가가 아님). **주의**:
  "안내형으로 보여서 제외"는 2026-08-20에 07-org 전체(312건)에 한 번
  잘못 적용했다가 정정된 전례가 있다 — 공공기관은 안내로만 끝나지 않고
  반드시 실제 업무·집행이 있다는 원칙(사용자 지시)을 어기지 않는 한도
  내에서만, 개별 파일 단위로 확실한 근거가 있을 때만 이 상태를 쓸 것.
  카테고리 전체를 이 상태로 일괄 처리하지 말 것.
- **재정의**: 진짜 공백은 맞지만 REQUIRED_DOCUMENTS_REGISTRY 패턴이 안
  맞아 다른 종류의 작업으로 다시 정의된 것(예: 01-do 최상위 도청 SP —
  실제 서류를 심사하는 게 아니라 하위 실·국에 위임하는 조정 레이어라서,
  "위임 안 되는 광역 인허가의 처리 경로 명시"가 필요. 아직 그 재정의된
  작업 자체는 미착수).
- **진행중**: 작업 시작했지만 PR 미병합 상태(세션 중간에 끊길 때 이
  상태로 남겨두고 비고에 어디까지 했는지 적을 것).

## 2026-08-20 시점 현황

| 상태 | 건수 |
|---|---|
| 완료 | 2 (jejusi:food_business_report, jejusi:public_sanitation_business_report, seogwipo:food_business_report, seogwipo:public_sanitation_business_report — main 병합 확인됨, 정확한 PR 번호는 `git log --oneline --grep=위생관리과`로 조회) |
| 진행중 | 1 (SP-ORG-JCGF — jcgf:credit_guarantee_application 작업은 끝났고 PR 생성 명령어까지 전달했으나, 이 문서 작성 시점에 main 병합 확인을 아직 못 받음. 다음 세션은 먼저 `git log --oneline --grep=JCGF`로 병합 여부부터 확인할 것 — 병합됐으면 상태=완료로 갱신, 안 됐으면 이어서 병합 진행) |
| 제외(오탐) | 2 (SP-EXP-EMERGENCY, SP-EXP-WATER) |
| 재정의 | 4 (JEJU-DO-SP 버전 3개 + JEJU-DO-AGENT-COMMON — 참고: 이 중 v1.0/v1.4는 감사 자체의 중복 카운트 노이즈, 실제 작업 대상은 v1.5와 AGENT-COMMON 2건뿐) |
| 미착수 | 895 |

## 다음 세션이 할 일

1. 이 CSV를 열어 `상태=미착수`인 행 중 작업할 배치를 고른다(카테고리 단위
   또는 국/부서 단위로 묶어서 — 04-city/02-do-dept/03-do-agency는 이미
   패턴 검증됨, 04-city 나머지 134건부터 이어가는 게 자연스러움).
2. §3의 5단계(SP 본문·REQUIRED_DOCUMENTS_REGISTRY·AGENCY_TO_DEPT_TARGET·
   division-tables.js) + 법적 근거 웹검색을 거쳐 실제로 배선한다.
3. PR이 병합되면 **이 CSV의 해당 행들**을 상태=완료, 비고·PR·완료일을
   채워 다시 커밋한다 — 다음 세션이 또 같은 곳을 조사하지 않도록.
4. 오탐이나 재정의로 판단되면 위 기준을 반드시 지켜서(카테고리 일괄
   처리 금지, 개별 근거 필수) 상태를 갱신한다.
5. `python tools/check_stale_refs.py`로 회귀 검증 후 커밋 — division-
   tables.js/gov-router.js의 file 포인터 오탈자는 매 배치마다 반복되는
   실수이니 반드시 확인할 것(2026-08-20 실사에서 실제로 8건 발견된 전례).

이 표 자체가 커지거나 다음 세션 판단이 이전 판단과 어긋나면, 이 README도
함께 갱신할 것 — 특히 "제외(오탐)" 기준은 한 번 잘못 적용된 전례가 있으니
바뀌면 반드시 사유를 남길 것.
