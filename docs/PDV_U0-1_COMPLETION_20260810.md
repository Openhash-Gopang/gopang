# PDV_U0-1_COMPLETION_20260810.md

주피터님 지시("원칙 자체가 절반만 구현되었다면, 완성해야 합니다")에 따른
`UNIVERSAL-common §U0-1`(모든 SP의 PDV 기록 의무, 이 문서 제1원칙) 4대
요건 완성 작업 기록. 조사 결과는 대화 로그 참고, 이 문서는 구현 내역만
정리.

## 변경 파일 4개

| 파일 | 변경 내용 |
|---|---|
| `worker.js` | 신규 엔드포인트 `POST /owner-pdv/self-history` + 공유 헬퍼 2개(`_ownerPdvWhoHash`, `OWNER_AGENCY_WHITELIST_SHARED`) 추출 |
| `src/gopang/gwp/gwp-report-client.js` | 신규 클라이언트 함수 `queryOwnerPdvSelfHistory()` |
| `pages/expert-chat.html` | ① `ensureSystemPrompt()`에 세션 시작 시 자기이력 조회·주입 ② 세션 종료 기록의 `why` 하드코딩 null 제거 |
| `prompts/UNIVERSAL-common_v1_11.md` | §U0-1의 "현재 구현 상태" 정직 고지 문단을 새 상태로 갱신 |

## 설계 핵심 — DB 마이그레이션 없이 해결

기존 `owner_pdv` 스키마(6하원칙 6필드 + persona_key 등)에 필요한 필드가
이미 다 있었다 — 신설한 게 읽기 **경로**(엔드포인트)이지 데이터 **구조**가
아니다. `listRule/viewRule`이 `null`이라 클라이언트 직접 조회는 여전히
막혀 있지만, 새 엔드포인트는 `_l1AdminToken()`(기존 관리자 인증 헬퍼,
다른 곳에서도 이미 쓰던 패턴 재사용)으로 서버가 대신 조회해서 요약만
클라이언트에 돌려주므로 스키마·룰 변경이 필요 없었다.

## `/owner-pdv/self-history` 설계

**왜 U8(`/pdv/query`)을 재사용하지 않았는가**: U8은 "타 기관 데이터에
대한 동의 기반 접근" 프로토콜(consent.html 리다이렉트까지 거침)이라
용도 자체가 다르다 — 이번 요구는 "같은 기관이 같은 사용자에 대한
자기 과거 기록을 보는" 것으로 기관 간 교차가 전혀 없다(C8과 무관). 게다가
`VALID_PDV_SCOPES`에 개별 EXPERT 페르소나 61개가 애초에 등록돼 있지 않아
U8 경로로는 애초에 성립하지도 않았다. 그래서 동의 절차 없는 훨씬 가벼운
전용 엔드포인트를 신설했다.

**요청**: `{ owner_agency, guid_for_hashing, persona_key_prefix?, limit? }`
**응답**: `{ ok, found, total_visits, recent: [{when, what, how, why, persona_key}] }`
— `who_hash`·PocketBase 내부 id는 응답에 포함하지 않는다(최소권한 원칙).

**해시 일관성**: 쓰기 경로(`_writeOwnerPdvRecord`)와 읽기 경로가 각자
따로 해시를 계산하면 같은 사용자인데 다른 `who_hash`가 나올 위험이 있어,
`_ownerPdvWhoHash(env, ownerAgency, guid)` 공유 헬퍼로 통합했다 — 두
경로가 항상 같은 계산을 쓴다는 게 코드로 보장된다.

## `expert-chat.html` 세션 시작 흐름 변경

`ensureSystemPrompt()`가 시스템 프롬프트 조립 직후, 첫 인사말이 만들어지기
**전에** `queryOwnerPdvSelfHistory()`를 호출하고 결과를 `[PDV_SELF_HISTORY_
RESULT]` 시스템 메시지로 주입한다 — U0-2("인사말은 이 조회 결과가 나온
뒤에 구성한다")·U8-2(대화 시작 시점에도 먼저 시도)를 실제로 만족시킨다.
조회 실패·기록 없음 케이스 모두 U2(정직성) 원칙대로 있는 그대로 모델에
전달되고, 세션 진행 자체를 막지 않는다.

`personaKeyPrefix`는 현재 세션의 리프 id에서 도메인 접두사(`'professor-
math'.split('-')[0]` → `'professor'`)만 뽑아서 쓴다 — 리프 단위로 좁히면
"예전엔 다른 과목(리프)으로 만났던" 기록을 놓치므로, 같은 전문가 계열
전체를 본다.

## `why` 필드 수정

`recordOwnerPDV()` 함수 자체는 처음부터 `why`를 정상 지원했다 — 문제는
유일한 실제 호출부(`expert-chat.html`)가 `why: null`을 하드코딩해온
것뿐이었다. 이제 **세션의 첫 사용자 발화**(상담을 시작한 목적)를 담는다
— 별도 요약용 LLM 호출을 추가하지 않고(비용·지연 증가 회피), 이미 갖고
있는 데이터로 저비용 개선했다. `what`(마지막 발화, 어떻게 끝났는지)과는
다른 축의 정보라 6하원칙 6개 필드가 이제 전부 실질적으로 채워진다.

## 의도적으로 손대지 않은 것 — 분류(③) 전용 필드

`owner_pdv`에 주제·카테고리·키워드용 전용 필드를 새로 만들지 않았다.
이유: `persona_key`가 이미 인덱싱된 필드로 존재하고, professor처럼
subject-gate로 리프까지 정밀화되는 트리는 `persona_key` 자체(예:
`professor-med-internalmedicine`)가 상당히 정밀한 주제 분류를 실질적으로
대신한다 — `who_hash`+`persona_key`로 그룹핑하면 "이 사용자가 무슨 종류의
요청을 몇 번 했는지" 지금도 집계 가능하다. 같은 리프 안에서 여러 세부
주제가 오간 경우까지 구분하는 세밀한 키워드 태깅은 여전히 없지만, 이건
스키마 확장 + 별도 추출 로직이 필요한 더 큰 작업이라 이번 배치에서는
범위 밖으로 남겼다(UNIVERSAL-common에 그렇게 명시).

## 검증

- `worker.js`, `gwp-report-client.js` 문법 검사 통과.
- `expert-chat.html`의 `<script type="module">` 블록 추출 후 문법 검사 통과.
- 이 세션 네트워크 제약으로 실제 라이브 HTTP 호출(엔드포인트 실사)은
  검증 못 했다 — 배포 후 실제 교수 페르소나 세션 하나를 두 번 열어(같은
  사용자로) 두 번째 세션의 인사말에 첫 번째 세션 맥락이 반영되는지
  확인하는 것이 가장 확실한 검증 방법.

## 적용 범위

이번 변경은 `expert-chat.html`을 공유하는 **61개 EXPERT 페르소나 전체**
(교수 포함)에 동시에 적용된다 — 교수 전용 코드가 아니다. 정부기관 SP
경로(`[AGY_VAULT_STORE]` 태그 실제 연결)는 이번 범위 밖으로, 여전히
별도 후속 작업이다.
