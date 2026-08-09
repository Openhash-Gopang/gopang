# 작업 지시서 — 2026-08-08 세션 인계

주피터님 지시 원문: 17개 광역시도를 제주 수준으로 갱신. 하이브리드 구조(허브+
위성 저장소), 추상 템플릿 재사용, 국가기관은 도메인당 SP 본문 1개를 전국
공유(제주 자신도 이 공유 템플릿을 씀).

## 0. 먼저 확인할 것 — 열려 있는 PR 3개 (전부 main에 미병합)

| PR | 제목 | 상태 |
|---|---|---|
| [#275](https://github.com/Openhash-Gopang/gopang/pull/275) | province-aware SP 저장소 라우팅 인프라(동작 변화 없음) | 리뷰 대기 |
| [#276](https://github.com/Openhash-Gopang/gopang/pull/276) | province-master-data.json 부산 중복 레코드 제거 | 리뷰 대기 |
| [#277](https://github.com/Openhash-Gopang/gopang/pull/277) | 15개 도 국가기관 라우팅 일반화 + 키워드 충돌 3건 수정 | 리뷰 대기 |
| [#278](https://github.com/Openhash-Gopang/gopang/pull/278)(이번 커밋) | 국가기관 관할구역 리서치 스테이징 데이터 | 리뷰 대기 |

**다음 세션 시작 시 이 4개부터 병합 여부 확인.** #277이 병합돼야 #278의
스테이징 데이터를 실제 `national-agency-master-data.json`에 통합하는
작업의 전제(라우팅 인프라)가 갖춰진다.

## 1. 이번 세션에서 완료한 것

### 1-1. 코드 인프라 (PR #275, #277)
- `_rawBase(repo)`/`_currentProvinceRepo()` — province별 SP 저장소 분리 대비 인프라
- `_makeGenericNationalEntries()` — 34개 국가기관 도메인 키워드 매칭을 15개 도
  전체로 일반화(기존엔 police만, 그것도 경기·전남광주 제외)
- 키워드 충돌 3건 수정(police의 '경찰서', prosecution의 '기소', port의
  '해상교통관제') — 실측으로 대전 해양경찰 질의가 완도로 잘못 매칭되는
  버그를 재현 후 수정 확인

### 1-2. 데이터 버그 수정 (PR #276)
- `province-master-data.json`의 busan 중복 레코드(구버전이 실제 서비스되던
  버그) 제거

### 1-3. 저장소 인프라
- `Openhash-Gopang` 조직에 15개 도별 위성 저장소 신설(`busan`, `seoul`,
  `incheon`, `daejeon`, `ulsan`, `sejong`, `chungbuk`, `chungnam`, `jeonbuk`,
  `gyeongbuk`, `gyeongnam`, `gyeonggi`, `gangwon`, `daegu`,
  `jeonnam-gwangju`) — 전부 public, 아직 내용물 없음(다음 세션 이후 과제)

### 1-4. 국가기관 관할구역 리서치 (PR #278, 이번 커밋)
`prompts/gov-tree/09-national/agencies/jurisdiction-staging/`에 10개 도메인
원자재 데이터. 상세 신뢰도는 그 디렉터리의 README.md 참조. **주의: 이건
`national-agency-master-data.json`에 바로 쓸 수 있는 최종 스키마가 아니라
리서치 원자재다.**

### 1-5. 폐기한 접근
`warm-national-agency-cache-v2.mjs`(Serper 실시간 검색 캐시 예열 스크립트)로
시작했다가, 이 방식이 관할이 복잡한 도메인에서 확인된 오답을 냈다는 걸
실측으로 발견하고 폐기했다. `NATIONAL-AGENCY-CLASS-INSTANCE-ARCHITECTURE_v1.0.md`
(2026-07-24, 주피터 지시)가 이미 "관할 깔끔한 소수만 정적 등록, 나머지는
동적 조회"라고 명시했었는데, 그 "동적 조회"가 지금 실제로는 조악한
Serper 검색이라 오답을 낸다는 게 이번 세션에서 실측 확인됐다. → 결론:
법령 별표 기반 정적 데이터로 대체하는 게 맞다(지금 하고 있는 이 작업).

## 2. 다음 세션 작업 순서 (우선순위대로)

### Phase A — 스테이징 데이터 통합 (가장 먼저)
1. `jurisdiction-staging/`의 신뢰도 "높음" 6개 도메인(tax, customs, court,
   coastguard, police, stat)부터 `national-agency-master-data.json` 스키마
   (`{domain, template, 도코드, 지사명, 소속부처}`)로 변환
   - `template`/`소속부처`는 기존 제주 레코드에서 도메인별로 그대로 재사용
     (이미 확인됨 — `national-agency-master-data.json`에서 `도코드: jeju`
     레코드의 `template`/`소속부처` 필드 참조)
   - **다중 지사 도메인(tax 등)은 도 하나에 레코드 여러 개가 정상이다** —
     jeju처럼 1개로 퉁치려 하지 말 것. `_fetchNatText()`가 domain+도코드로
     검색할 때 여러 개 중 하나를 어떻게 고를지(시/군 힌트 필요)는 별도
     설계 필요 — 현재 `_fetchNatText()` 시그니처가 시/군 파라미터를
     받는지 확인부터 할 것
2. 통합 후 실제 fetch 기반 스모크테스트(이번 세션에서 쓴 패턴 재사용 —
   `globalThis.window = globalThis; const {assembleGovSystemPrompt} = await
   import(...)`) 로 최소 5개 도(제주 제외) × 3개 도메인 검증

### Phase B — 신뢰도 "중간"/"낮음" 도메인 재검증
`mma`, `veterans`, `weather`, `port` — namu.wiki 경유로 재검색해서 확정.
방법론은 `jurisdiction-staging/README.md`의 "검증 방법론" 절 그대로 따를 것.

### Phase C — 미착수 6개 도메인
`nhis`, `nps`, `labor` — "4대사회보험 정보연계센터"(공식 통합 사이트) 실제
데이터 추출부터. `laborimprove`, `immigration`, `post`, `probation`, `bok`은
출처 확인부터 시작.

### Phase D — worker.js 쓰기 경로 정리 (PR #275에서 범위 밖으로 미뤄둔 것)
`GITHUB_OWNER`/`GITHUB_REPO_NAME` 하드코딩 9곳 — province 분리 시 SP-AUTHOR
자동 초안·SP-TREE-GUARDIAN 감사 PR도 도별 위성 저장소로 가야 함.

### Phase E — 15개 위성 저장소에 실제 콘텐츠 채우기
지금은 빈 저장소만 있음. `SP-PROVINCE-TEMPLATE`(01-do)은 이미
`province-master-data.json`에 16개 도 전부 레코드가 있어서 즉시 작동
가능 — 02-do-dept 이하부터 순차 실사 필요(강원·대구·전남광주는 02-do-dept
레코드 자체가 0건).

## 3. 재발 방지 — 이번 세션에서 배운 것

- **정직한 "정보없음"이 틀린 확신보다 안전하다** — 이 코드베이스의 기존
  원칙을 이번 세션에서 두 번 실측으로 재확인했다(완도해양경찰서 사례,
  Serper 캐시 예열 폐기 결정).
- **신뢰도가 다른 데이터를 섞어서 넘기지 말 것** — 이번 세션에서 weather/mma
  만들다가 실제로 이 실수를 했다(확인 안 된 값을 확정처럼 적음). 발견 즉시
  고쳤지만, 다음 세션도 같은 실수를 반복하지 않도록 모든 신규 데이터
  파일에 `신뢰도` 필드를 최상위에 명시하는 걸 관례로 삼을 것.
- **정부 사이트(`law.go.kr`, `data.go.kr`, `nts.go.kr` 등)는 robots.txt로
  자동 접근이 막혀 있다** — `namu.wiki`가 대안 경로로 실제 작동함(원문
  법령 별표를 그대로 인용해둔 경우가 많음).
- **git pull --rebase 후 스모크테스트 재실행은 항상 할 것** — 이번 세션
  내내 동시에 다른 세션들이 같은 저장소에 커밋 중이었다(K-School 라우팅,
  UNIVERSAL 감사 등). PR #275/#277 둘 다 rebase 후 재검증 절차를 거쳤다.
