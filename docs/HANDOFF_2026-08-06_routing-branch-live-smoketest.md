# HANDOFF_2026-08-06_routing-branch-live-smoketest.md
## K-서비스/전문가AI/중앙정부/지방정부/시장 5개 분기 라이브 스모크테스트 — 인수인계 및 작업 지시서

작성일: 2026-08-06 | 선행 문서: 아래 §1 전부 | 이번 세션 목적: 오늘 하루
(PR #233~#251) 동안 고친 AC 라우팅 로직이 **다섯 개 목적지 카테고리
(K-서비스·전문가 AI 페르소나·중앙 정부·지방 정부·시장)로 실제로 정확히
분기되는지** 라이브로 검증

## 이 문서를 받았다면

주피터님이 이 문서를 새 대화창에 올리고 "이어서 진행하십시오"라고
하면, **§4(작업 지시)**부터 진행하면 됩니다. §1~§3은 오늘 무엇을 했고
왜 이 다섯 카테고리를 지금 검증해야 하는지의 배경입니다.

---

## 0. 작업 방식 (변경 없음, 오늘 하루 계속 써온 절차)

1. `git fetch origin main` → 항상 최신 `origin/main` 기준으로 새 브랜치.
2. 시나리오 파일이든 코드든 수정 후 `git format-patch origin/main..HEAD`
   → **별도 클론에 `git am`으로 미리 검증** → `node --test src/tests/*.mjs`
   회귀 확인(기존 베이스라인 225/228 — 무관한 3건 실패는 이 작업과
   무관, 그대로 유지되면 정상) → patch 전달.
3. 스모크테스트 시나리오 배치는 `tests/live_smoketest/scenarios_*.json`에
   추가하고, `live_smoketest.py`의 `grade()` 함수에 **합성 이상적
   응답을 직접 주입**해서(실제 API 호출 없이) 스키마·채점 로직 호환성부터
   드라이런 확인 — 이게 라이브 실행 전 필수 관문이다(오늘 여러 번
   이 단계에서 스키마 실수를 잡았다).
4. **문자열 검색을 반드시 병행할 것(§3-4의 교훈)** — 새 시나리오 발화나
   새 라우팅 규칙에 어떤 단어를 예시로 쓸 때, 그 단어가 이미 다른
   GWP/EXPERT의 trigger나 §CATALOG "분야" 칸에 등록돼 있는지
   `grep`으로 먼저 확인. `tools/check_domain_keyword_collision.py`가
   이 확인을 자동화해준다(§CATALOG 대상, 최근 EXPERT trigger 교차참조
   기능도 추가됨) — 새 라우팅 문구를 추가하기 전에 반드시 돌려볼 것.
5. 사용자는 Windows PowerShell + `gh` CLI. `git am` → `git push -u
   origin <브랜치>` → `gh pr create` → `gh pr merge --auto --squash`
   순서. 이번 세션 내내 이 흐름으로 문제없이 진행됐다.
6. **GitHub Actions 관련 이상 현상을 보면 먼저 `githubstatus.com`부터
   확인할 것** — 오늘 "워크플로가 대기열에서 안 풀린다"는 증상이
   실제로는 GitHub 쪽 Actions 인프라 장애였다(저장소 설정 문제가
   전혀 아니었음). 사용량(Settings→Billing→Actions minutes)도
   같이 확인 가치가 있으나, 오늘은 여유(301/2000분)가 충분했다.
7. **스모크테스트 시나리오를 만들 때 trigger 문자열을 그대로 쓰지
   말 것(§2-2의 핵심 교훈)** — 등록된 trigger 단어를 발화에 그대로
   박아넣으면 "모델이 상황을 이해하는가"가 아니라 "정규식이 문자열을
   찾는가"를 시험하는 동어반복이 된다. 반드시 자연스러운 상황 서술로
   패러프레이즈할 것.

---

## 1. 참조해야 할 저장소 문서 (전부 오늘 갱신됨)

| 문서 | 용도 |
|---|---|
| `docs/혼디_대응시나리오_전체분류_20260712.md` | **1차 참조** — 사용자 발화가 갈 수 있는 모든 목적지의 전체 지도. §1(K-서비스)·§2(EXPERT)·§4(정부·공공기관 3중 구조, 중앙/지방 구분 포함)·§검색순서(§CORE 4단계+R1/R2)가 이번 작업과 직접 관련 |
| `docs/SESSION_LESSONS_ROUTING_ARCHITECTURE_20260806_v1_0.html` | 오늘 배운 설계 원리·실패 패턴 정리 — 특히 ③(도메인 소유권 3계층 미검증)·④(하이브리드 검증 원칙)·⑥(스모크테스트 방법론) |
| `prompts/AC-PRO-CORE_v1_1.txt` | §CORE(4단계+R1/R2 판정축, 2026-08-06 갱신)·§CATALOG(GWP 표)·§CATALOG-EXPERT(62개 페르소나 표)·§GOV_MATCH(342개 밖 확장 레지스트리, 중앙/지방 분기 로직 §454~465행) 원문 |
| `gwp-registry.js` / `src/gopang/ai/expert-registry.js` | 실제 trigger 배열 — 시나리오 설계 전 반드시 grep으로 대조 |
| `tools/check_domain_keyword_collision.py` | 새 예시 문구·trigger가 기존 등록과 충돌하는지 자동 검사 |
| `tests/live_smoketest/live_smoketest.py`, `check_routing_regression_threshold.py` | 실행·채점 하네스. 후자는 `static_verdict=PASS`만 엄격 판정하고 `WARN`은 정보용으로 분리하는 관례(§2-2 참고) |

---

## 2. 오늘(2026-08-06) 있었던 일 — 요약

### 2-1. PR 이력 (전부 origin/main 병합 완료)

| PR | 내용 |
|---|---|
| #233 | EXPERT 세션 죽은 코드 정리 + C50 훅 재배선 |
| #234 | PDV_REQUEST/PDV_HISTORY_REQUEST 원시 태그 노출 방어 |
| #235 | 관제탑 원칙(CONTROL-TOWER-PRINCIPLE) 전체 SP 상속 신설 |
| #236 | flash 디폴트 정책 재역전 |
| #237 | 관제탑 원칙 서버측(worker.js) 6개 릴레이 배선 + 패널 코드강제 |
| #238~#240 | EXPERT 라우팅 정밀도·패러프레이즈 하드모드·GWP 우선 스모크테스트 배치 3종 신설 |
| #241~#242 | 라우팅 시나리오 전체분류 문서 갱신 + 검색순서 정확화 |
| #243 | **라우팅 편향 방지책 4종 일괄**: ① CI 자동 게이트(`check-routing-regression.yml`) ② R1 축 "분야 개념 매칭" 보강 ③ 코드 레벨 자기점검 훅(`_violatesRoutingBias`) ④ EXPERT→GWP 되돌림 태그(`SUGGEST_SERVICE_REDIRECT`) |
| #244 | R1 보강 검증용 스모크테스트 10건 |
| #245 | 3/4번 브라우저 콘솔 검증 훅 추가 |
| #246 | `#7`(CALL_KINTENT 오류) 재현성 확인 20회 반복 — **20/20 재현 확정** |
| #247 | 원인 규명(klaw R1 예시 문구가 klogistics "통관"과 충돌) 후 수정 + **R2 축 신설**(GWP끼리 구체성 우선) |
| #248 | `check_domain_keyword_collision.py` 신설(§CATALOG 충돌 검사기) |
| #249 | `#3`(감정평가 EXPERT 충돌, R1 보강 예시가 이번엔 appraiser trigger와 충돌) 수정 + R2로 `#5`/`#9` 대응 |
| #250 | CI 워크플로 concurrency 그룹 추가(러너 경합 방지) |
| #251 | 오늘 세션 정리 매뉴얼 신설 |

### 2-2. 핵심 교훈 3가지 (반드시 숙지)

1. **"의미로 판단하라"는 지침에 넣는 예시 문구도 문자열 검증이 필요하다.**
   R1 축에 "관세 통관은 klaw 영역"이라는 순수 의미론적 예시를 추가했는데,
   `klogistics`가 이미 "통관"을 §CATALOG 분야 칸에 등록해뒀던 걸 몰라서
   위임의도 명확한 발화가 `[CALL_KINTENT:]`로 새는 회귀를 만들었다.
   재수정("감정평가"로 교체)도 이번엔 `appraiser.triggers`와 충돌해서
   또 실패 — **세 번째 시도만에 겨우 깨끗해졌다.**
2. **재현성 검증 없이는 "버그"라고 확정할 수 없다.** temperature=0이
   이 시스템에서 실질적으로 결정적이라는 걸 20회 반복(19건 문자 그대로
   동일)으로 확인했고, 이게 "체계적 버그 vs 일회성 변동"을 가르는
   근거가 됐다.
3. **trigger 문자열을 그대로 쓴 스모크테스트는 동어반복이다.** 첫
   배치(35건)가 34/35로 "너무 잘 나와서" 의심스러웠는데, 20개 중
   17개가 등록된 trigger 단어를 그대로 박아넣고 있었다.

### 2-3. R1/R2 판정축 요약 (오늘 신설·보강, §CORE 2단계 안에 위치)

- **R1(GWP vs EXPERT)**: 위임의도 명시("~해주실 분"·"~께 직접"·
  "맡기고 싶다") → EXPERT. 제도 정보·제3자 관점("~은 어떻게 되는지
  궁금") → GWP 기본값. GWP 기본값 판정은 **trigger 표 매칭이 아니라
  "분야" 칸 개념 매칭**으로 한다(오늘 세 번의 시행착오 끝에 확정).
- **R2(GWP vs GWP, 오늘 신설)**: 여러 GWP가 동시에 매칭되면 더 길고
  구체적인 trigger(또는 더 좁은 분야 서술)를 가진 쪽을 우선한다.

---

## 3. 왜 지금 이 다섯 카테고리를 검증해야 하는가

오늘 만든 스모크테스트 배치(#238~#249)는 전부 **GWP↔EXPERT 축과
GWP↔GWP 축의 편향 문제**에 집중돼 있었다 — 즉 "같은 카테고리 안에서
어느 서비스로 가는가"를 주로 봤다. 그런데 사용자님이 지금 요청하신 건
**더 상위 레벨의 분기 자체**(발화가 K-서비스로 가는지, EXPERT로
가는지, 정부기관인지, 그중 중앙인지 지방인지, 아니면 시장(상거래)
인지)가 오늘 고친 R1/R2·CONTROL-TOWER-PRINCIPLE 변경들 이후에도
여전히 정확한지다. 이건 아직 전용 배치로 검증된 적이 없다 — 기존
커버리지는 대부분 7월 말~8월 초의 오래된 대형 배치(`scenarios.json`
300건, `scenarios_batch2_20260801.json` 등)에 섞여 있고, 오늘의
trigger-패러프레이즈 방법론이 적용되지 않았다.

지금 코드 기준 카테고리별 커버리지(오래된 배치 포함, 참고용):

| 카테고리 | 현재 태그 | 기존 시나리오 건수(오래된 배치 포함) |
|---|---|---|
| K-서비스 | `[GWP: id]` | 다수(오래된 배치에 분산) |
| 전문가 AI 페르소나 | `[EXPERT: id]` | 오늘 3개 전용 배치(90건) — 단, GWP와의 경계 위주 |
| 중앙 정부 | `[GWP: kgov]` 또는 §GOV_MATCH 확장(`[GWP_REGISTRY_SEARCH:]`) | 35건(오래된 배치) |
| 지방 정부 | `[GWP: kregionalgov]` → gov-tree(`CALL_GOVTREE`) | 38건(오래된 배치) |
| 시장(상거래) | `[GWP: kcommerce]`(사려는 방향)/`[GWP: kcommerce_seller]`(팔려는 방향) | 43건(오래된 배치) |

---

## 4. 작업 지시

### 4-1. 새 스모크테스트 배치 설계 — 5개 카테고리 균등 커버

`tests/live_smoketest/scenarios_branch_5way_20260806.json`(또는 오늘
날짜 기준 새 파일명)으로 신설. 각 카테고리 8~10건씩, 총 40~50건
권장. 설계 시 반드시 지킬 것(§0-4/§0-7 재확인):

1. **trigger 문자열 그대로 쓰지 말 것** — `gwp-registry.js`·
   `expert-registry.js`의 등록 단어를 그대로 안 쓰고 상황을 서술로
   풀어쓸 것(§2-2 참고, 오늘 배치들의 최종 버전을 예시로 참고).
2. **카테고리 간 경계 사례를 의도적으로 포함할 것** — 예를 들어
   "K-서비스인데 표면적으로 시장처럼 보이는 것"(예: kcommerce_seller
   vs kbusiness — 개인 중고거래 vs 사업자 판매), "지방정부인데
   §GOV_MATCH 확장 레지스트리를 거쳐야 하는 것"(전용 인스턴스 없는
   기관), "정부기관인데 EXPERT로 새기 쉬운 것"(R1 축 관련, klaw
   근처는 이미 많이 테스트했으니 kregionalgov 근처 미검증 인접쌍
   위주로).
3. **중앙/지방 구분을 명확히 테스트할 것** — `org_profiles.branch`가
   `admin_central`/`legislative`/`judicial`/`public_institution`인
   기관(중앙) vs `admin_local`인 기관(지방)을 각각 커버. AC 자신은
   이 분류를 직접 안 하고 K-Execute가 실행 시점에 `CALL_GOVSYS`/
   `CALL_GOVTREE`로 분기하므로(§CORE 원문 §454~465행), **AC 단계에서는
   `kgov`/`kregionalgov`/§GOV_MATCH 태그까지만 검증 가능** — 그 이후
   분기는 이 스모크테스트 범위 밖임을 유의(오케스트레이션 내부 로직).
4. **시장(kcommerce) 방향 착각 함정 포함** — §CATALOG 표 자체에
   "등록"이라는 단어가 있어도 사려는 건지 팔려는 건지로 갈리는 경고가
   있음(`kcommerce` vs `kcommerce_seller`). 명시적으로 양쪽 다 테스트.
5. `static_verdict: PASS`/`WARN` 관례 유지, `basis`에 근거(어느
   trigger/분야 서술을 참고했는지, 왜 이 카테고리로 판단했는지) 명시.

### 4-2. 드라이런 → 충돌 검사 → 커밋 → 라이브 실행

1. `check_domain_keyword_collision.py`로 새로 쓴 예시 문구가 기존
   등록과 충돌하지 않는지 확인(§0-4).
2. `live_smoketest.py`의 `grade()`에 합성 응답 주입해 스키마 호환성
   확인(§0-3).
3. `node --test src/tests/*.mjs`로 회귀 확인(무관한 베이스라인
   3건 실패는 정상).
4. patch 생성 → 별도 클론에 `git am` 검증 → 전달 → 사용자가 병합.
5. GitHub Actions에서 `live-smoketest.yml` 워크플로 수동 실행
   (Scenario file name에 새 파일명 입력) — **실행 전 `githubstatus.com`
   확인**(§0-6, 오늘 실제로 장애 있었음).

### 4-3. 결과 분석 시 유의

- `LIVE-FAIL`이 나와도 곧바로 "버그"로 단정하지 말 것 — §2-2처럼
  ground truth 자체가 틀렸을 가능성을 먼저 점검(모델 응답이 더 정확한
  경우가 오늘 여러 번 있었다).
- 의심되는 실패는 **재현성부터 확인**(동일 발화 다회 반복 배치,
  `scenarios_repro_customs_broker_no7_20260806.json`을 템플릿으로
  재사용 가능).
- 원인이 R1/R2 판정축의 예시 문구 충돌로 보이면, 반드시
  `check_domain_keyword_collision.py`부터 돌려서 문자열 충돌
  여부를 확인한 뒤 수정할 것 — 의미론적 판단만으로 새 예시를
  넣지 말 것(§2-2의 교훈을 세 번째로 반복하지 않기 위함).

### 4-4. 완료 후

이 세션에서 발견·수정한 것을 오늘의 `SESSION_LESSONS_ROUTING_
ARCHITECTURE_20260806_v1_0.html`에 이어 붙이거나, 새로운 날짜의
후속 HANDOFF 문서로 남길 것 — 어느 쪽이든 desktop.html 사이드바
"🛠 개발자 문서" 섹션 배선 관례(새 항목은 섹션 맨 위)를 따를 것.

---

## 5. 관련 파일 목록

- `docs/혼디_대응시나리오_전체분류_20260712.md` — 목적지 지도(1차 참조)
- `docs/SESSION_LESSONS_ROUTING_ARCHITECTURE_20260806_v1_0.html` — 오늘의 설계 원리 정리
- `prompts/AC-PRO-CORE_v1_1.txt` — §CORE/§CATALOG/§CATALOG-EXPERT/§GOV_MATCH
- `gwp-registry.js`, `src/gopang/ai/expert-registry.js` — trigger 원본
- `tools/check_domain_keyword_collision.py` — 충돌 검사기
- `tests/live_smoketest/live_smoketest.py`, `check_routing_regression_threshold.py` — 실행·채점 하네스
- `tests/live_smoketest/scenarios_regression_R1_20260801.json`,
  `scenarios_expert_routing_paraphrase_hard_20260806.json`,
  `scenarios_gwp_priority_no_expert_20260806.json`,
  `scenarios_r1_domain_concept_matching_20260806.json`,
  `scenarios_r2_gwp_specificity_20260806.json`,
  `scenarios_repro_customs_broker_no7_20260806.json` — 오늘 만든 배치들(설계 템플릿으로 재사용)
- `.github/workflows/check-routing-regression.yml` — 자동 CI 게이트(3개 배치, concurrency 그룹 있음)
