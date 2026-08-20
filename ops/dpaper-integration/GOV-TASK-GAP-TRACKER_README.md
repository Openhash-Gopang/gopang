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
| 완료 | 5 (jejusi/seogwipo:food_business_report, jejusi/seogwipo:public_sanitation_business_report — PR#474 / jcgf:credit_guarantee_application — PR#475 / jejusi/seogwipo:disability_registration — PR#477) |
| 제외(오탐) | 2 (SP-EXP-EMERGENCY, SP-EXP-WATER) |
| 재정의 | 4 (JEJU-DO-SP 버전 3개 + JEJU-DO-AGENT-COMMON — 참고: 이 중 v1.0/v1.4는 감사 자체의 중복 카운트 노이즈, 실제 작업 대상은 v1.5와 AGENT-COMMON 2건뿐) |
| 미착수 | 893 |

## 상태 갱신 시 주의 — 경로 오매칭

CSV를 스크립트로 갱신할 때 `경로.str.contains('WELFARE-DISABLED')`처럼
부분 문자열로 매칭하면, 04-city의 `SP-CITYDIV-*-WELFARE-DISABLED`뿐
아니라 이름이 비슷한 02-do-dept의 `SP-DIV-WELFARE-DISABLED`까지 같이
걸려서 손 안 댄 행이 실수로 "완료"가 되는 사고가 실제로 있었다
(2026-08-20). **경로는 반드시 정확히 일치(`==`)시키거나, 최소한
분류(01-do/02-do-dept/... 열)까지 같이 조건에 넣을 것.**

## 복지 계열(WELFARE) 작업 시 반드시 먼저 확인할 것

장애인복지과(2026-08-20)에서 발견: 개인 복지급여 신청(장애인등록·기초
연금·활동지원 등)은 전통적으로 **읍·면·동(주민센터)이 1차 접수, 시청
복지 담당국이 최종 심사**하는 2단계 구조다(`SP-EMD-TEMPLATE_v1.3.md`
§3 "주민복지팀" 참조). 05-emd는 이 감사 스캔 대상이 아니라서(정적 파일
없이 동적 렌더링), 시청 SP의 §INPUT_SCHEMA를 그대로 믿고 "시청이
접수까지 다 한다"고 등록하면 사실과 다르다. 대신 복지로(bokjiro.go.kr)
온라인 접수 선례를 따라 "시청 명의 온라인 접수 통로 — 심사는 원래도
시청" 프레이밍으로 SP §1-2에 disclaimer를 넣는 패턴을 확립했다
(`SP-CITYDIV-{JEJUSI,SEOGWIPO}-WELFARE-DISABLED_v1.1.md` 참조). **남은
복지위생국 계열(주민복지·노인복지·기초생활보장·여성가족 등)을 작업할
때 이 disclaimer 패턴을 재사용할 것 — 매번 새로 판단하지 말 것.**
다만 개별 업무마다 실제로 읍면동 경유인지는 웹검색으로 다시 확인해야
한다(모든 복지 업무가 이 패턴은 아닐 수 있음).

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
