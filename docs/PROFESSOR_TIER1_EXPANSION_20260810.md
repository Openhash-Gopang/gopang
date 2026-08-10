# PROFESSOR_TIER1_EXPANSION_20260810.md

`PROFESSOR_SUBDIVISION_SURVEY_20260810.md`의 Tier 1(15개 분야) 실제 구현 완료 기록.

## §1 구조 변경 — subject-gate.js flat → 계층형 리팩터 (선행 작업)

**문제**: `refineToLeaf()`가 `getLeafDescendants(personaId)`로 전체 하위 트리를
한 번에 flatten해서 단일 게이트 호출을 했다 — 161개 리프 시점에도
`max_tokens` 1000→1500 재상향이 필요했던 상태(§1-1, 인수인계 문서)에서
Tier 1 93개를 그대로 얹으면 254개 후보가 한 프롬프트에 들어가게 됨.

**수정**: `src/gopang/ai/subject-gate.js`의 `refineToLeaf()`를 재귀 루프로
전환 — `getConsultableChildren()`(이미 존재하던 프로덕션 함수, 직계 자식만
반환)으로 한 단계씩 내려가며, 직계 자식이 2개 이상일 때만 게이트 호출
1회를 쓴다. 자식이 1개면 호출 없이 통과, 0개면(=리프) 그 자리에서 멈춘다.
"해당 없음" 폴백 메커니즘(`_buildGateCandidates`)은 그대로 재사용 —
단계마다 동일하게 작동한다.

**검증**: `tests/live_smoketest/dump_gate_levels.mjs`(신설, production
함수 직접 호출)로 게이트 호출 지점별 후보 수를 실측:

| 시점 | 게이트 호출 지점 수 | 최대 후보 수 |
|---|---|---|
| 리팩터 전(flat) | 1 | 161(전체) |
| 리팩터 후, Tier1 추가 전 | 27 | 29 (`professor` 루트) |
| 리팩터 후, Tier1 93개 추가 후 | 42 | 29 (`professor` 루트, 불변) |

루트 게이트의 후보 수가 리팩터 전후로 **불변(29)** 인 이유: 법학 등
15개 분야가 flat 형제로 추가된 게 아니라, 기존 리프 자리에 새 중계열이
"승격"돼 같은 슬롯을 차지하고(예: `professor-law` → `professor-law-series`),
그 안에서만 세분화됐기 때문 — 기존 배치2(경영·경제 중계열 신설)와
동일한 패턴을 라우팅 로직에도 그대로 적용했다.

## §2 등록 내역

15개 분야 각각: 기존 flat 리프를 중계열로 승격(`parentKey`만 변경, id는
그대로 유지 — 세부분야를 콕 집기 애매한 개론 수준 발화는 계속 이 리프가
받음) + 표준 하위분야를 소계열로 신설.

| 분야 | 신설 중계열 | 신규 소계열 수 |
|---|---|---|
| 법학 | `professor-law-series` | 13 |
| 경제학 | `professor-economics-series` | 9 |
| 물리학 | `professor-physics-series` | 7 |
| 생명과학 | `professor-biology-series` | 7 |
| 심리학 | `professor-psychology-series` | 7 |
| 수학 | `professor-math-series` | 6 |
| 전산학·컴퓨터공학 | `professor-computerscience-series` | 6 |
| 철학·윤리학 | `professor-ethics-series` | 6 |
| 화학 | `professor-chemistry-series` | 5 |
| 사회학 | `professor-sociology-series` | 5 |
| 정치외교학 | `professor-politics-series` | 5 |
| 기계공학 | `professor-mechanicaleng-series` | 5 |
| 경영학 | `professor-business-series` | 5 |
| 역사·고고학 | `professor-history-series` | 4 |
| 전기공학 | `professor-electrical-series` | 3 |
| **합계** | **15개 중계열** | **93개 소계열** |

리프 총합: 161 → **254개**(중복 없음, 전수 검증 완료).

## §3 산출물

- 레지스트리: `src/gopang/ai/expert-registry-professor.js`에 15개 중계열
  + 93개 소계열 등록, 기존 15개 리프 재소속(parentKey 변경).
- SP 파일: 108개 신설(`prompts/SP_professor-<id>_v1_0.md`) — 중계열 15개는
  "공통 상위 맥락"형 짧은 SP(범위·인접분야 구분·하위 소계열 목록), 소계열
  93개는 기존 배치 패턴(세부분야 경계·3훅·Tier 테이블)을 따름.
- 매니페스트: `prompts/sp-catalog.json`에 108개 키 등록 — **이 단계를
  빠뜨리면 SP 파일이 디스크에 있어도 실제로는 로드되지 않는다**(검증
  과정에서 실제로 이 결함을 잡아 수정함, 아래 §4 참고).
- 게이트 리팩터: `src/gopang/ai/subject-gate.js`(§1), 신규 검증 스크립트
  `tests/live_smoketest/dump_gate_levels.mjs`.

## §4 검증 과정에서 발견·수정한 결함

1단계 검증(`render_expert_prompts.mjs`로 신규 리프 6개를 실제 프로덕션
`_composeExpertPrompt()`로 렌더링)에서 `manifest 키 없음` 경고 발견 —
새 SP 파일이 `prompts/` 디렉터리엔 있지만 `sp-catalog.json`에 등록이
안 돼 있어 조상 체인 로드가 조용히 건너뛰어지고 있었다(렌더 자체는
"실패 0건"으로 나와 눈치채기 쉽지 않은 종류의 결함). `sp-catalog.json`에
108개 키를 추가한 뒤 재검증 — 경고 완전히 사라짐, 신규 SP 내용(예:
"미시경제학", "고체물리학" 등)이 최종 조립된 프롬프트에 실제로 포함됨을
grep으로 확인.

## §5 남은 일

- **§4(의료 전문과목)**: Tier 1 서베이 문서에서 별도 승인 필요로 남겨둔
  항목 — 착수 여부 미결정.
- **Tier 2(중간 후보 7개)**: 착수 보류 상태 그대로.
- **실사(라이브 DeepSeek 호출) 검증 미실시**: 이 세션은 네트워크 제약으로
  `subject-gate.js`의 실제 모델 호출을 검증할 수 없었다(§1의 오프라인
  로직 테스트 3건만 통과 확인 — 단일자식 통과·이미리프 종료·다중자식
  네트워크실패시 폴백). 다음 세션에서 GitHub Actions 실사 워크플로로
  254개 리프 전체에 대한 라우팅 정확도 재검증이 필요하다 — 특히 새로
  생긴 15개 중계열 게이트(예: `professor-law-series` 15개 후보)가
  실제로 정확히 분류되는지가 핵심 확인 대상.
