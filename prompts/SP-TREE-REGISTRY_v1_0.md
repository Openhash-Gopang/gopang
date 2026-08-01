# SP-TREE-REGISTRY v1.0 · SP 상호 참조 단일 진실 공급원

## 이 문서의 목적

지금까지 각 SP가 다른 SP를 가리킬 때 자기 헤더나 본문에 `이름_v버전`을
직접 적어 넣었다. 그 SP가 개정되면 참조하는 쪽 전부를 손으로 찾아 고쳐야
했고, 실제로 2026-07-29 감사에서 16개 파일·33건이 갱신되지 않은 채
방치되어 있었다(worker.js·gov-router.js가 URL에 문서 버전을 직접 박아
fetch하던 것과 같은 종류의 버그 — 다만 코드가 아니라 prompts/ 문서
자체에 있었다).

이제부터 규칙은 하나다: **다른 SP를 가리킬 때는 이름만 쓰고, 버전은
절대 적지 않는다.** 최신 버전이 몇 번인지 알아야 할 때는
`prompts/sp-catalog.json`(이름→실제 파일명 매핑, 기계가 읽는 SSOT)을
보거나, 사람이 읽을 때는 이 문서에서 "누가 무엇을 상속/참조하는가"라는
구조 정보를 확인한다. 이름과 버전은 서로 다른 문서가 각자 책임진다 —
sp-catalog.json은 "이름 → 최신 파일명", 이 문서는 "이름 → 이름 관계".

`tools/check_no_hardcoded_sp_refs.py`가 이 규칙을 CI에서 기계적으로
강제한다 — 등록된 SP가 다른 SP의 이름+버전을 나란히 적으면 빌드가
실패한다(변경이력 섹션의 과거 기록은 예외).

## 사용법

- **SP를 새로 작성/개정할 때** 다른 SP를 언급해야 하면: `이름(SP-TREE-REGISTRY 참조)`
  형태로 쓴다. 버전 번호나 확장자(.md/.txt)를 붙이지 않는다.
- **실제 최신 파일이 필요한 코드(worker.js 등)**는 이 문서가 아니라
  `prompts/sp-catalog.json`을 통해 가져온다. 이 문서는 사람·LLM이 구조를
  파악하기 위한 것이지, 런타임이 참조하는 경로가 아니다.
- **새 상속/참조 관계가 생기면** 이 문서의 해당 섹션에 한 줄 추가한다.
  CI는 "버전이 박혀 있는가"만 검사하고 "이 문서가 최신인가"는 검사하지
  않으므로, 최신 상태 유지는 여전히 사람의 책임이다.

## A. 공식 상속 패밀리 (tools/check_sp_inheritance.py가 기계적으로 검증)

이 두 패밀리는 이미 별도 CI(check-sp-inheritance.yml)가 상속 선언·필수
섹션·복붙 여부까지 검사하고 있다. 아래는 그 요약이다.

- **AGENT-SUPPLIER-COMMON** ← AGENT-SUPPLIER-01 ~ 99 (KSIC 업종별 페르소나,
  77개 파일 운영 중, informational — 레거시 버전 세대 차이 존재)
- **SP-INDUSTRY-TRANSFORM-COMMON** ← SP-INDUSTRY-TRANSFORM-01 ~ 56
  (strict — 2026-07-23 신규 패밀리, 위반 이력 없음 유지)
  - SP-INDUSTRY-TRANSFORM-COMMON 자신은 TRANSFORM-COMMON 계열 원칙을
    따르며, AGENT-SUPPLIER-COMMON과는 "§0 정체성 차이" 근거로 별도
    계열임을 명시한다(업종 대변 vs 산업전환 상담이라는 목적 차이).

## B. K-Public 정부기관 계열 (SP_hierarchy_inheritance 문서의 H1~H8 원칙 적용 대상)

```
K-Public (국가/공공기관 AI 공통 규칙 원본 — 상속의 최상위)
 ├─ 행정부: K-Province · K-City · K-County · K-Tax · K-Health ·
 │          police · 911 · K-Insurance(공적 영역만)
 ├─ 사법부: 대법원 대변 AI · 헌법재판소 대변 AI
 └─ 입법부: democracy(국회 + 지방의회)

K-Doctor — 독립. K-Health를 상속하지 않는다(제도 대변과 개인 면허
           전문가 모사는 서로 다른 계열이라는 원칙, SP_hierarchy_inheritance 참조).
```

- **K-Public_common** ← 각 기관 SP(SP-10_kpublic 등)가 상속
- **PROFESSIONAL-common** ← K-Public_common이 상속(직역 전문성 공통 규칙)
- **UNIVERSAL-common** ← PROFESSIONAL-common이 상속(전체 SP 최상위 공통)
  - UNIVERSAL-common은 UNIVERSAL-INTEGRITY와는 별개 문서다(성격이 다름 —
    후자는 무결성/사실성 원칙 전용).
- **HUMAN-AUTHORITY-GATE-SCHEMA** ← SP-10_kpublic, SP-INDUSTRY-TRANSFORM-COMMON
  등 인간 승인 게이트가 필요한 다수 SP가 참조
- **PDV-TRANSFER-PROTOCOL** ← SP-10_kpublic이 개인정보 이전 시 참조
- **GOV-TIER-IO-SCHEMA** ← SP-INDUSTRY-TRANSFORM-COMMON, gov-tree 템플릿군이 참조
  - **DOCUMENT-TYPE-REGISTRY**, **DATA_REQUIREMENT-SCHEMA** ← GOV-TIER-IO-SCHEMA가 참조

## C. gov-tree 계열 (Jeju 중심에서 전국 16개 광역시도로 확장된 라우팅 문서군)

- **gov-tree/00-common/GOV-TREE-PROTOCOL** → kgov(SP-10_kpublic)를 참조
- **gov-tree/00-common/overlays/GOV-COMMON-OVERLAY-TEMPLATE** → kgov(SP-10_kpublic)를 참조
- **gov-tree/01-do/templates/SP-PROVINCE-TEMPLATE** → GOV-TIER-IO-SCHEMA를 참조

> worker.js와 gov-router.js가 이 계열 문서를 각자 다른 코드 경로에서
> fetch한다 — 한쪽만 매니페스트 경유로 고치고 다른 쪽을 놓치는 실수가
> 반복될 위험이 있다(2026-07-29 감사에서 실제로 10곳 중 일부가 그런
> 상태였다). 이 계열을 건드릴 때는 항상 양쪽을 함께 확인한다.

## D. 전문가 페르소나(EXPERT) 안전장치 계열

- **SP_common_guardrails** — 60개 EXPERT 페르소나 전원이 상속하는 안전
  게이트 설계(C30~C34 사용자 등급 분기, 레드플래그 레지스트리 연동).
  본문 안에서 SP_lawyer·SP_physician을 구체 사례로 언급한다(최초 적용
  사례 추적용 — 어느 SP가 먼저 반영됐는지 기록하는 목적이지, 상속
  관계는 아니다).
- **SP_red_flag_registry** ← SP_PDV, SP_dietitian, SP_common_guardrails 등이
  참조(민감정보 감지 시 태깅 정책)
- **SP_PDV** → SP_common_guardrails, SP_red_flag_registry를 참조

## E. 기타 개별 참조

- **business-kr** → k-business를 본문 전체 삽입 방식으로 참조
- **SP_professional-engineer** → SP_nurse, SP_dietitian을 패턴 참고 사례로 언급
- **SP_social-worker** → SP_real-estate-agent를 서술 방식 참고 사례로 언급
- **profile-assistant** → HONDI-CAPABILITIES-COMMON을 참조

## F. 기계 판독용 엣지 목록 (CI·SP-TREE-GUARDIAN 공통 파싱 대상)

A~E는 사람이 읽는 설명이고, 아래 블록은 `tools/check_no_undeclared_inheritance.py`와
`SP-TREE-GUARDIAN`이 똑같이 파싱하는 단일 데이터다 — **새 상속 관계가 필요하면
반드시 여기에 줄을 추가해야 하고(그래야 CI가 통과한다), 그 외의 방식으로
"관습적으로" 새 부모-자식 관계를 선언할 수 없다.**

형식: `CHILD_PATTERN -> PARENT_NAME` 한 줄에 하나. `CHILD_PATTERN`은 정확한
이름이거나 `*` 글롭(예: `AGENT-SUPPLIER-*`)을 쓸 수 있다. `#`으로 시작하는 줄은
주석. `ALIAS: 짧은이름 = 정식이름` 줄로 코드/문서에서 흔히 쓰는 별칭을 등록한다
(예: `kgov`는 `SP-10_kpublic`을 가리키는 관용 별칭).

```edges
# 별칭
ALIAS: kgov = SP-10_kpublic

# 공식 패밀리 (tools/check_sp_inheritance.py가 이미 상세 검증)
AGENT-SUPPLIER-* -> AGENT-SUPPLIER-COMMON
SP-INDUSTRY-TRANSFORM-* -> SP-INDUSTRY-TRANSFORM-COMMON

# UNIVERSAL-INTEGRITY 직속 (SP-NN_xxx 전국 서비스 계열, "# 상위 상속" 헤더로 선언)
SP-02_k119 -> UNIVERSAL-INTEGRITY
SP-03_kpolice -> UNIVERSAL-INTEGRITY
SP-04_khealth -> UNIVERSAL-INTEGRITY
SP-06_ktraffic -> UNIVERSAL-INTEGRITY
SP-10_kpublic -> UNIVERSAL-INTEGRITY
SP-12_kdemocracy -> UNIVERSAL-INTEGRITY
SP-13_klogistics -> UNIVERSAL-INTEGRITY
SP-16_kinsurance -> UNIVERSAL-INTEGRITY

# 공통 레이어 체인 (B 섹션 산문 설명과 동일 관계)
PROFESSIONAL-common -> UNIVERSAL-common
K-Public_common -> PROFESSIONAL-common
UNIVERSAL-common -> UNIVERSAL-INTEGRITY
SP-PROVINCE-TEMPLATE -> kgov
SP-INDUSTRY-TRANSFORM-COMMON -> HUMAN-AUTHORITY-GATE-SCHEMA
SP-INDUSTRY-TRANSFORM-COMMON -> GOV-TIER-IO-SCHEMA
SP-10_kpublic -> HUMAN-AUTHORITY-GATE-SCHEMA
SP-10_kpublic -> PDV-TRANSFER-PROTOCOL
GOV-TIER-IO-SCHEMA -> DOCUMENT-TYPE-REGISTRY
GOV-TIER-IO-SCHEMA -> DATA_REQUIREMENT-SCHEMA
```

**적용 범위 — 2026-07-29 기준 알려진 한계**: 이 edges 블록과
`check_no_undeclared_inheritance.py`는 현재 `sp-catalog.json`에 등록된
최상위 SP(위 목록)에 대해서만 **strict**(위반 시 CI 실패)로 동작한다.
`prompts/gov-tree/` 아래 도청·시청·부서·읍면동 SP는 `# 상위 상속` 헤더
선언이 893건 존재하지만 `sp-catalog.json`에 개별 등록되지 않고, 표기
형식도 파일마다 제각각(중간에 폐기 경고·조건부 표시·플레이스홀더가
섞여 있음)이라 지금 상태로 strict 적용하면 오탐이 정상 작업을 막는다
— 그래서 gov-tree는 **informational**(위반을 출력하되 CI는 통과)로
남겨둔다. gov-tree 헤더 형식을 먼저 정규화하는 게 strict 전환의
선행 조건이다(AGENT-SUPPLIER 레거시와 동일한 처리 원칙,
`check_sp_inheritance.py` 참조).

## 변경 이력

- v1.0 (2026-07-29, 같은 날 F 섹션 추가): 신설. 2026-07-29 감사에서 발견된 16개 파일·33건의
  하드코딩된 SP 상호 참조를 실제로 수정하면서 드러난 관계를 기반으로
  A~E 섹션을 채웠다. A, B 섹션은 기존 문서(check_sp_inheritance.py
  FAMILIES, SP_hierarchy_inheritance_v1_0.md)의 내용을 그대로 반영했고,
  C~E는 이번 감사에서 실제로 발견된 참조만 기록했다 — 카탈로그에 등록된
  198개 SP 전체의 관계를 빠짐없이 다룬 것은 아니며, 앞으로 새 참조가
  생기면 이 문서에 계속 추가한다.
