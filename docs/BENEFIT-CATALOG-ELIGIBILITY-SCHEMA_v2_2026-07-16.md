# eligibility_gate 스키마 v2 — 29건 실사 기반 확정

> 작성일: 2026-07-16 · 근거: 파일럿 30건 중 정규식 추출 실패 29건을 직접 읽고
> 패턴 분류. `pb_migrations/1786300001_seeded_benefit_catalog_pilot.js`의
> v1(단순 배열)을 대체.

## 왜 바뀌었나

v1 스키마(`[{"item": "...", "source": "...", "confidence": "..."}]`)는
"연령 3~5세" 같은 단순 조건은 담을 수 있지만, 실사 29건에서 반복 확인된
아래 패턴들을 표현할 수 없었다:

1. **분기형 임계값** — 근로장려금: 가구유형(단독/홑벌이/맞벌이)에 따라
   소득기준이 다름. 평평한 배열로는 "어느 조건이 어느 분기에 속하는지"를
   잃어버린다.
2. **자격(eligibility)과 선정(selection)의 혼동** — 상당수 항목이 "충족하면
   받는다"가 아니라 "충족자 중 우선순위로 뽑는다"(에너지절감장비, 원산지검증
   컨설팅 등). 이 둘을 같은 `eligibility_gate`에 섞으면 K-Compose가 "자격 있음
   =지원금 받음"으로 오판할 위험이 있다.
3. **제외 조건 누락** — 발달장애인 주간활동서비스처럼 포함 조건과 별개로
   명시적 제외 대상(노인장기요양보험 대상자 등)이 있는데, v1엔 이걸 담을
   자리가 없었다.
4. **무조건 지원(게이트 없음)** — "전역예정장병 누구나 지원 가능" 같은 경우,
   v1은 억지로 조건을 만들어내거나 `confidence:none`으로 잘못 표시하게 된다.

## 스키마 v2

```json
{
  "universal": false,
  "selection_method": "eligibility_only",
  "conditions": [
    {
      "type": "age",
      "description": "만 18세 미만 학대 피해 아동",
      "branches": null,
      "confidence": "high"
    },
    {
      "type": "income",
      "description": "가구유형별 전년도 부부합산 총소득 기준",
      "branches": [
        {"branch_key": "단독가구", "value": "2,200만원 미만"},
        {"branch_key": "홑벌이가구", "value": "3,200만원 미만"},
        {"branch_key": "맞벌이가구", "value": "4,400만원 미만"}
      ],
      "confidence": "high"
    }
  ],
  "excludes": [
    {"description": "노인장기요양보험법상 노인 등 해당자", "confidence": "high"}
  ],
  "raw_reference": "국적법 제7조제1항제2호 (법조문 인용형일 때만)"
}
```

필드 설명:

- `universal` (bool) — true면 사실상 게이트 없음("누구나 지원 가능" 류).
  true일 때 `conditions`는 빈 배열.
- `selection_method` — `eligibility_only`(충족=수급) / `priority_ranked`
  (충족자 중 경쟁 선발, 우선순위 기준 있음) / `first_come_first_served`
  (충족자 중 선착순) / `unknown`(원문에서 판단 불가).
- `conditions[].type` — `age`/`income`/`residency_status`/
  `category_membership`(직업군·자격증 등)/`diagnosis`(질병·장애 진단)/
  `legal_basis`(법조문 근거형)/`household_composition`/`other`.
- `conditions[].branches` — 분기형 임계값일 때만 채움(null이 기본).
  분기 없는 단일 조건에는 쓰지 않는다.
- `conditions[].confidence` — high(원문에 수치·기준이 명시)/
  medium(원문은 있으나 판단에 해석 필요)/low(원문이 모호해 추정 포함).
  **지어낸 수치는 넣지 않는다 — 모르면 `description`에 "원문 참조 필요"라고
  쓰고 confidence를 low로 둔다.**
- `excludes` — 포함 조건과 별개로 명시된 제외 대상. 없으면 빈 배열.
- `raw_reference` — 법조문·규정 번호가 명시된 경우만 채움(null 기본).

## 처리 규칙

- `eligibility` 필드가 `"지원대상과 동일"`(또는 유사 표현)이면 실패가 아니라
  **정상 패턴** — `target` 필드 텍스트를 대신 파싱한다.
- `target`/`eligibility`/`content` 세 필드를 전부 읽되, 실제 자격 조건은
  `target`+`eligibility`에서, 지원 금액·내용은 `content`에서 나온다는
  원본 스키마 구분을 유지한다(지난 파일럿에서 확인).
- 원문에 없는 조건을 추정해서 채우지 않는다(U2 원칙과 동일 정신) —
  판단이 애매하면 `confidence: low`로 정직하게 남기고 `description`에
  원문 인용을 포함해 사람이 재확인할 수 있게 한다.
