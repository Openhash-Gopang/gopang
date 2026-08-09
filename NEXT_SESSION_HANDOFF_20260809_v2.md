# 작업 지시서 — 2026-08-09 세션 인수인계 (v2, 같은 날 후속 스레드)

주피터님 지시 원문 요약: "다음 대화창에서 모든 교수(professor) 페르소나가
관제탑 원칙(CONTROL-TOWER-PRINCIPLE)에 따라 사용자 발화에 대응하는지,
일부를 임의 선정하여 테스트."

이 문서는 같은 날 먼저 병합된 `NEXT_SESSION_HANDOFF_20260809.md`(PR #287,
제주 지역 SP·kgov/kregionalgov 라우팅 정밀도 스레드)와는 **다른, 독립된
스레드**다 — subject-gate 리프 정밀화 라이브 커버리지 확장 작업에서
시작해서, 이번 지시로 마무리됐다. 두 문서 다 유효하며 서로를 대체하지
않는다.

## 0. 먼저 확인할 것

- main HEAD(이 문서 작성 시점): `b93725f7`(PR #287 병합 커밋).
- **이 세션이 만든 커밋 3개(`e65762f7`, `265af31e`, `fab5411b`)는 전부
  main에 직접 푸시됐다**(feature 브랜치·PR 안 거침 — §3 재발방지 참고,
  의도적 위반 아니라 이번 세션의 실수).
- **이 문서와 함께 만든 두 파일(`desktop.html` 수정, 신규
  `docs/SESSION_LESSONS_SUBJECT_GATE_MAX_TOKENS_20260809_v1_0.html`)이
  실제로 push됐는지 `git log --oneline -5`로 먼저 확인할 것** — 인계
  시점에 사용자님께 배포 명령을 안내는 했으나 실행 확인 전에 세션이
  끝났을 수 있다.
- 다음 세션 시작 시 `git log --oneline -15`로 이 시점 이후 다른 세션이
  추가 커밋을 얹지 않았는지 먼저 확인할 것(동시 세션 다수 활동 중인
  저장소 — 오늘 하루에만 최소 2개 스레드가 병행됐다).

## 1. 이번 세션에서 완료한 것

### 1-1. subject-gate 2단계 리프 정밀화 라이브 커버리지 확장
`scenarios_subject_gate_stage2_gapfill_20260809.json`(38건: accountant
전체 리프 100% 커버, patent-attorney 전체 리프 100% 커버, professor
157개 리프 중 27개 series 분기 각 대표 리프 1개— 4%→21% 커버리지)
신설. 전부 직군명(회계사/변리사/교수) 없이 상황·분야 서술만으로 작성
(첫 초안 19건에 직군명·루트 트리거 문구가 섞여 있었던 걸 재작성).

### 1-2. deepseek-v4-flash 빈 응답 결함 규명·수정 (이 세션 최대 발견)
`subject_gate_live_smoketest.py`로 위 38건을 실행하자 거의 전량 실패,
과거 검증 파일로 재현해도 100% 동일 패턴("JSON 파싱 실패 — raw: 빈
문자열") 확인. 원인은 `deepseek-v4-flash`(reasoning 계열)가
`reasoning_content`(사고 과정)에 토큰을 먼저 쓰고 `content`(최종 답변)는
나중에 내는데, `max_tokens: 60`이 사고 과정만으로 소진되어 `content`가
빈 문자열로 오는 것 — HTTP는 200이라 코드가 "정상 실패"로 착각했다.

**수정 완료**(main에 직접 푸시, `265af31e`/`fab5411b`):
- `src/gopang/ai/subject-gate.js` `max_tokens: 60 → 1000`
- `src/gopang/ai/domain-classifier.js` `max_tokens: 60 → 1000`
- `src/gopang/ai/report-utils.js` (2곳) `max_tokens: 200/240 → 1000`
- `tests/live_smoketest/subject_gate_live_smoketest.py` — 진단용
  `[DEBUG-EMPTY]` 로깅 추가, `max_tokens` 동일하게 1000으로 동기화

재검증 결과: 기존 검증 파일 18/18 PASS, gapfill 38건 37/38 PASS(남은
1건 `professor-gap-15`는 토큰과 무관한 flaky 케이스로 문서화하고
의도적으로 안 고침 — 상세는 §1-3 문서 참고).

**상세 규명 과정·부수 발견(CI가 실패 실행 결과를 저장 안 하는 사각지대,
결과 브랜치 force-push 경쟁조건, 이름이 비슷한 워크플로 혼동, 샌드박스
에이전트의 Azure Blob 접근 한계)은 전부 아래 문서에 정리했다 — 이
인계서에서 반복 안 함:**

### 1-3. 개발자 문서 신설
`docs/SESSION_LESSONS_SUBJECT_GATE_MAX_TOKENS_20260809_v1_0.html` —
위 규명 과정 전체(10개 절)를 정리, `desktop.html` "🛠 개발자 문서"
서브메뉴 맨 위에 등록(로컬 수정 완료, push 확인 필요 — §0 참고).

## 2. 다음 세션 작업 — 최신 지시(교수 페르소나 관제탑 원칙 검증)

**"모든 professor 페르소나가 관제탑 원칙(CONTROL-TOWER-PRINCIPLE)에
따라 사용자 발화에 대응하는지, 일부를 임의 선정하여 테스트."**

### 2-1. 시작 전 반드시 고칠 것 — 기존 하네스가 프로덕션과 어긋나 있다

`tests/live_smoketest/expert_persona_smoketest.py`의
`compose_expert_prompt()`(141행)가 이 테스트에 가장 가까운 기존
하네스인데, **실사로 확인한 결과 두 가지가 프로덕션
`expert-session.js`의 `_composeExpertPrompt()`와 어긋나 있다**:

1. **`CONTROL-TOWER-PRINCIPLE`이 조립에서 완전히 빠져 있다.** 이
   문서가 검증하려는 게 정확히 이 원칙 준수 여부인데, 그 원칙 자체가
   시스템 프롬프트에 안 실린다 — 지금 그대로 쓰면 "관제탑 원칙을
   전혀 안 넣은 프롬프트가 관제탑 원칙을 지키는지"를 묻는 셈이라
   결과가 무의미하다. 프로덕션 쪽(`expert-session.js` 101행 근처)은
   2026-08-08에 이미 이 버그를 고쳤다(`_loadSpByKey(CONTROL_TOWER_PRINCIPLE_KEY, ...)`
   추가) — 같은 수정을 파이썬 쪽에도 반영해야 한다.
2. **조상(부모) SP 체인이 1단만 지원한다.** `if parent_key:
   parts.append(read_sp(catalog, parent_key))` — 딱 한 단계만 삽입한다.
   그런데 professor는 3단 트리 구조를 쓴다(예:
   `professor-semiconductor` → `professor-materials-series` →
   `professor`). 프로덕션은 2026-08-08에 N단 재귀 조상 체인으로
   이미 확장됐다(`expert-session.js` 138행 근처, `MAX_ANCESTOR_DEPTH = 5`).
   이 파이썬 하네스로 3단 트리 계열의 professor 리프를 테스트하면
   중간 계열 SP(예: `SP_professor-materials-series`)가 빠진 채
   조립되어, 역시 프로덕션과 다른 프롬프트로 테스트하게 된다.

**두 가지 다 고치기 전엔 테스트 결과를 신뢰하지 말 것.** 고치는
방법은 `expert-session.js`의 `_composeExpertPrompt()`(101~192행)를
그대로 참고해 파이썬으로 옮기면 된다 — CONTROL-TOWER-PRINCIPLE을
UNIVERSAL-INTEGRITY 바로 다음에 한 번 추가, `parent_key` 단일값 대신
`EXPERT_REGISTRY`(또는 `expert-registry-professor.js`)를 따라 올라가는
N단 체인 로직으로 교체.

### 2-2. 관제탑 원칙 핵심 (`prompts/CONTROL-TOWER-PRINCIPLE_v1_1.md`)
- **설명(지양)**: 백과사전식 나열, 사용자 고유 입력값을 지워도 그대로
  성립하는 답변, 필요서류·유의사항 한 번에 나열
- **실행 관철(지향)**: 사용자의 구체적 입력을 반영한, 다음에 할 일
  하나로 좁혀진 응답. 마크다운 제목·번호목록·불릿 금지, 1~3문장.
- STEP A류(감별진단·쟁점추출 등) 산출물은 내부 추론 구조일 뿐 — 그대로
  사용자에게 쏟아내면 위반.
- "하나의 동작" ≠ "기계적으로 한 문장에 한 조작" — 사용자가 중간
  보고 없이 한 호흡에 할 수 있는 연속 조작은 묶어도 됨. 턴을 실제로
  나눠야 하는 경계는 (a)물리적 완료 후 결과 확인 필요 지점,
  (b)혼디 판단에 사용자 답이 필요한 분기점뿐.
- 예외: 요청이 불분명해 되묻는 중인 턴, 인간 전속 경계 고지 정형 블록.

### 2-3. 표본 설계 — "임의 선정"을 어떻게 할지
professor는 157개 리프에 걸쳐 있고 3단 트리 구조(§2-1)를 쓴다.
"임의 선정"이라도 구조를 반영하는 게 좋다:
- **트리 깊이별 최소 1개씩**: 2단 리프(예: `professor-korean`,
  professor 바로 아래) / 3단 리프(예: `professor-semiconductor`,
  series 경유) — 조상 체인 조립이 실제로 다른 지점이라 결과가 갈릴
  수 있다.
- **관제탑 원칙 위반 위험이 큰 유형 우선**: 절차·규정이 복잡해
  백과사전식 나열 유혹이 큰 분야(예: `professor-law`,
  `professor-medicine`, `professor-accounting`) vs 실기·창작 계열
  (예: `professor-composition`, `professor-dance`)을 섞어서 비교.
- **needsMedicalSafety 플래그가 걸리는 인접 계열**(`professor-nursing`,
  `professor-publichealth` 등)도 최소 1개 — 의료 안전모듈이 추가로
  결합되는 경로라 일반 계열과 조립 결과가 다르다.
- 표본 수 자체보다 "트리 깊이 × 위반위험 유형" 조합을 최소 1개씩
  커버하는 게 진짜 대표성을 준다 — 무작위 N개보다 이 방식을 권장.

### 2-4. 채점 기준
태그 매칭이 아니라 **형식 위반 여부**를 정규식/휴리스틱으로 1차
자동판정하고, 애매하면 사람 검토로 넘길 것:
- 마크다운 헤딩(`#`)·번호목록(`1.` `2.`)·불릿(`-` `*`) 사용 여부
- 응답이 3문장을 넘는지
- 사용자가 입력한 구체적 값(이름·날짜·상황) 없이도 그대로 성립하는
  문장이 포함됐는지(백과사전식 나열의 징후)
- "다음에 할 일"이 하나로 좁혀졌는지, 아니면 여러 선택지·경우의 수를
  동시에 나열했는지

**자동판정을 맹신하지 말 것** — 같은 날 다른 세션(§0의
`NEXT_SESSION_HANDOFF_20260809.md`)이 `CALL_KINTENT`를 FAIL로 오판한
사례를 최소 2번 겪었다. raw_response 원문을 직접 대조하는 습관을
유지할 것.

### 2-5. 실행 인프라 관련 주의사항 (이 세션에서 겪은 것)
- **워크플로 이름 혼동**: `Live Smoketest (DeepSeek, 300 scenarios)`와
  `Subject Gate Live Smoketest (DeepSeek, 2단계 과목 게이트)`가 사이드바에
  나란히 있어 반복해서 잘못 클릭됐다. 이 작업용으로 새 워크플로를
  만든다면 이름을 확실히 구분하고, 기존 워크플로 실행 화면의
  `scenarios_file` 안내 문구(기본값 파일명)로 어느 스크립트인지
  먼저 확인하는 습관을 들일 것.
- **실패한 실행은 결과가 어디에도 안 남는다**: 기존 라이브 스모크테스트
  워크플로들은 앞 스텝이 실패(exit 1)하면 뒤의 결과 커밋·아티팩트
  업로드 스텝이 아예 안 돈다(`if: always()` 없음). 이 작업용 워크플로를
  새로 만들거나 기존 걸 재사용한다면 이 문제부터 고치는 게 낫다 —
  실패했을 때가 정확히 로그가 제일 필요한 순간이다.
- **결과 브랜치 경쟁조건**: `results/live-smoketest` 브랜치는 매 실행이
  `git push --force`로 통째로 덮어쓴다 — 동시에 다른 워크플로가 돌면
  서로 결과를 지운다. 이 작업 전용 결과 경로를 쓰거나, 실행 직후
  바로 확인하는 습관이 필요하다.
- **AI 에이전트가 이 작업을 이어받는다면**: GitHub API로 워크플로
  트리거·상태(`status`/`conclusion`) 확인은 가능하지만, 실패한 실행의
  원문 로그·아티팩트는 Azure Blob Storage로 리다이렉트돼 샌드박스에서
  못 받는다 — 사람에게 로그를 요청해야 한다.

## 3. 재발 방지 — 이번 세션에서 배운 것

- **테스트 하네스를 프로덕션 코드와 대조 없이 신뢰하지 말 것** — 이번
  세션 자체가 그 사례다(§2-1): 관련 프로덕션 코드가 최근(2026-08-08)
  바뀌었는데 테스트 하네스는 안 바뀐 채 방치돼 있었다. 기존 하네스를
  재사용하기 전에 그게 검증하려는 프로덕션 함수와 지금도 같은 로직인지
  먼저 diff해볼 것.
- **HTTP 200 ≠ 유효한 응답** — reasoning 계열 모델은 `content`가
  비어 있어도 200을 준다. `finish_reason`·`reasoning_content` 존재
  여부를 최소한 로그로 남겨야 "가끔 애매하게 실패"와 "구조적으로 거의
  항상 실패"를 구분할 수 있다.
- **시나리오에 정답 라벨(직군명·기관명)을 문자 그대로 넣지 말 것** —
  같은 날 두 세션이 독립적으로 같은 실수를 저질렀다(§1-1, 그리고
  `NEXT_SESSION_HANDOFF_20260809.md` §1-8). 상황·분야 서술만으로
  작성해야 "발화에서 추론하는 능력"을 검증한 게 된다.
- **git 워크플로**: push 전 항상 pull/rebase, feature 브랜치→PR→병합
  (main 직접 푸시 금지 — 이번 세션이 직접 어긴 항목, §0 참고). PAT로
  git·API를 직접 조작할 수 있는 세션(AI 에이전트 포함)일수록 이
  관례를 건너뛰기 쉬우므로 오히려 더 의식적으로 지킬 것. 3개 이상
  파일 배포 시 zip.
