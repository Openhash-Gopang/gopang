# 훈령·예규·규칙·지침 일괄 수집 파이프라인 — 구현체 (2026-08-16)

## 무엇이 들어있나 (5개 모듈)

| 파일 | 역할 | 대응 단계 |
|---|---|---|
| `law-api-client.js` | law.go.kr 행정규칙 목록조회·본문조회 | §2 수집 |
| `regulation-classifier-extractor.js` | 정규식+AI 절차규정 판별, few-shot 추출 | §3 분류, §4 추출 |
| `review-gate-and-drift.js` | 인간 검수 게이트(C4 강제), 버전 드리프트 감지 | §5 인간검수, §6 배포·재검증 |
| `pipeline-orchestrator.js` | 위 4개를 엮는 end-to-end 함수 | 전체 |
| `test_*.mjs` (5개) | 각 모듈 단위 검증 스크립트 | — |

## 검증 범위 — 정직하게 구분 (2026-08-16 업데이트: 라이브 검증 완료)

### ✅ 실제 라이브 API로 검증한 것 (2026-08-16, 주피터의 OC=openhash 계정)
- **law.go.kr 목록조회 API 실제 호출** — `query=경찰청` 검색으로 실제
  응답(246건 중 20건) 확보, 13개 필드명 전부 정확히 일치 확인
- **CDATA 파싱 버그를 실제 응답으로 발견·수정** — `행정규칙명` 필드가
  CDATA로 감싸져 있었고(개행 포함), 기존 단순 정규식이 이를 놓쳤다.
  실제 응답 기반 회귀 테스트(`tests/test_real_response_regression.mjs`
  + `tests/fixtures_real_response_20260816.xml`)로 고정.
- **query 기반 검색의 신뢰성** — `query=경찰청`으로 검색한 20건 전부
  `소관부처명=경찰청`으로 확인돼, `org` 파라미터 없이도
  `searchAdminRulesByInstitutionNameFallback()`이 실전에서 잘 작동함을
  확인. **org 파라미터 확인은 더 이상 급하지 않음.**
- 정규식 1차 필터, AI 호출 스킵(비용 절감), 환각 방지, C4 강제(reviewer
  없이 승인 불가), 드리프트 감지 — 전부 mock 기반으로 검증 완료(아래
  "여전히 mock 기반" 참고).

### ⚠️ 여전히 mock 기반 (실제 검증 필요)
1. **본문조회(`lawService.do`) 응답** — 목록조회만 실제로 확인됐고,
   본문 HTML 구조는 아직 실물을 못 봤음.
2. **실제 Claude API 응답 품질** — `classifyRegulation`·
   `extractChecklistItems`의 AI 호출부는 프롬프트만 설계, 실제 모델
   응답 품질은 미검증.
3. **PocketBase 연동** — `review-gate-and-drift.js`는 순수 함수.
4. **JSON 응답 지원 여부** — XML만 실증됨, `type=JSON`은 추정.

## 적용 순서(갱신)

1. 이 5개 모듈을 저장소에 추가(예: `src/gopang/gov/regulation-pipeline/`).
2. ~~org 파라미터 검증~~ — **완료, query 방식이 신뢰할 만하다고 확인됨.**
3. **다음 우선순위**: `fetchAdminRuleText()`로 실제 본문 1건 조회해서
   HTML 구조 확인(경찰청 예시: ID=29940, "경찰 소관 회계직 공무원...").
4. `callClaudeFn`을 실제 Anthropic API 호출로 교체 후, 강력계·
   여성청소년과·사이버수사팀에서 이미 손으로 확인한 규정(형사소송법
   제244조의3 등)을 다시 넣어봐서 AI 추출 결과가 기존 §ANNEX와
   비슷하게 나오는지 회귀 테스트.
5. 경찰청 하나로 파일럿 실행(이미 246건의 행정규칙이 존재함을 확인—
   전부 처리하지 말고 §ANNEX와 겹치는 절차 관련 규정부터 우선 선별)
   → 검수 큐 결과를 사람이 직접 살펴보고 품질 판단 → 문제 없으면
   §6-1~8 기관코드 순회로 확대.

## 남은 설계 결정 사항 (사람이 판단해야 함)

- `division_type_guess`(AI가 추정한 소관 division 유형)를 실제
  §6-9 division 구조와 매핑하는 규칙 — 지금은 사람이 검수 화면에서
  수동 매핑하는 걸 전제로 했는데, 자동 매핑까지 필요하면 추가 설계 필요.
- 검수자 권한 체계(누가 "팀장급"인지 시스템이 어떻게 확인하는지) —
  이 프로젝트의 기존 인증체계와 연동 필요, 이번 구현 범위 밖.
