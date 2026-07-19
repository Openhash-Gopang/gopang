# AC-EXPERT-PARITY-THOUGHT-EXPERIMENT
# ═══════════════════════════════════════════════════
# 문서명    : 공공기관 부서 AC ↔ 전문가 AI 페르소나 동등성 사고실험
# 작성일     : 2026-07-19
# 작성자     : AI City Inc. · 주피터 (Claude 진행)
# 배경      : "각 부서 AC가 전문가 AI 페르소나(STEP R/D)와 동등하게
#             작동하는지 확인하라"는 지시에 따라 실제 코드·SP 파일을
#             직접 조사(추측 아님)해 검증.
# ═══════════════════════════════════════════════════

## 결론 (요약)

**아니오 — 동등하지 않습니다.** 오늘 신설한 G18(담당자 확인·승인)·
G19(정부24 서류)를 포함해, `HUMAN-AUTHORITY-GATE-SCHEMA`(G1~G19) 전체가
**실제로는 어떤 부서 AC의 시스템 프롬프트에도 들어가 있지 않습니다.**
전문가 페르소나 쪽(`_composeExpertPrompt`가 `SP_common_guardrails`를
매 호출마다 자동 삽입)과 근본적으로 다른 메커니즘입니다.

## 조사 방법

1. 실제 배포된 부서 SP 파일(`SP-DO-OCEAN_v1.1.md` 등, 템플릿 아님)과
   템플릿 파일(do-dept/city/emd 전체)에서 `HUMAN-AUTHORITY-GATE-SCHEMA`·
   `STAFF_REVIEW_GATE`·`G1.`~`G19.` 문자열을 grep — **0건**.
2. 상위 체인(province template, JEJU-DO-SP, JEJU-TREE-PROTOCOL) 확인 —
   **0건**.
3. kgov(SP-10, v3.13, 모든 기관 SP의 최상위 공통 조상) 확인 — **6건**,
   그런데 전부 `§준수 문서 (변경 금지 — 참조만)` 절의 **인용**이었다:
   > `HUMAN-AUTHORITY-GATE-SCHEMA_v1_4.md` (G1~G17, §CAPABILITIES 뒤
   > 고정 삽입)
   이건 실제 게이트 본문이 아니라, **"이 문서를 개별 SP 작성 시
   §CAPABILITIES 뒤에 붙여넣어라"는 저작 지침**이다(`SP-AUTHOR_v1_13.md`
   G17 "위반 시 처리" 절과 짝).
4. `jeju-router.js`의 `assembleJejuSystemPrompt()` 전체 조립 경로에서
   `HUMAN-AUTHORITY-GATE-SCHEMA` fetch 여부 확인 — **0건**(kgov·overlay·
   tree-protocol·DO-SP·L2·city·emd 어디에도 이 문서를 가져오는 코드가
   없다).
5. 자동 동기화 스크립트(`docs/SP-AUTHOR-AUTOMATION_v1_0.md`) 확인 —
   해당 문서 자동 배포 기능 없음.

## 근본 원인 — 두 아키텍처의 차이

| | 전문가 페르소나 | 정부기관 AC |
|---|---|---|
| 가드레일 문서 | `SP_common_guardrails` | `HUMAN-AUTHORITY-GATE-SCHEMA` |
| 삽입 방식 | **런타임 자동 합성**(`_composeExpertPrompt`가 매 호출 조립) | **저작 시점 수동 복붙**(SP-AUTHOR 지침만 있고 실제 실행 안 됨) |
| 실제 반영 여부 | 60개 페르소나 전부 항상 최신 | **약 100개 기관 SP 전부 0건 반영** |

이건 이 프로젝트가 이미 여러 번 발견·경고해온 바로 그 패턴이다
(`gwp-report-client.js` 헤더의 "각자 복사 구조에서는 로직을 한 곳만
고치면 나머지는 안 고쳐지는 사고가 반복된다", 오늘 세션 초반 SP-10
버전 고정·jeju-router.js 404 참조 등) — 다만 이번엔 "복사됐는데 낡음"이
아니라 **애초에 한 번도 복사(반영)된 적이 없다**는 더 근본적인 경우다.

## 부차적 발견 — 기관 SP 자체도 kgov의 "직접 수행" 원칙을 스스로 좁힘

메커니즘 문제와 별개로, 실제 부서 템플릿(`SP-DEPT-WELFARE-TEMPLATE`)의
§CAPABILITIES는 복지급여 접수를 **"접수/안내만 수행"**이라고 스스로
규정하고 있다 — kgov §REQUIRED-DOCUMENTS가 이미 "담당 기관 SP가 직접
수행"이라고 정의해둔 것과 다른 방향이다. 다만 이건 "그 업무의 실제
처리 주체는 읍면동/시청"이라는 올바른 위임 설계일 수도 있어서(도청
레벨이 스스로 처리하지 않고 아래로 넘기는 것 자체는 정상), EMD/City
레벨에서 실제로 `GOV_TASK_DRAFT_REQUEST`/`SUBMIT_REQUEST`를 명시적으로
쓰는지 추가 확인함 — EMD 템플릿(`SP-TEAM-OUTREACH-TEMPLATE`)에도
`GOV_TASK` 언급이 전혀 없었다. 단, 메커니즘 문제(위)가 먼저 해결되면
이 부분은 kgov 원칙이 정상 상속되면서 자동으로 맞춰질 가능성이 높다 —
독립적인 2차 문제인지는 메커니즘 수정 후 재검증 필요.

## 권고

`_composeExpertPrompt`와 동일한 원칙("공통은 한 곳에서 조립") 적용 —
`jeju-router.js`의 `assembleJejuSystemPrompt()`(또는 그 상위인
`_loadGovCommon()`)가 `HUMAN-AUTHORITY-GATE-SCHEMA_v1_4.md`를 fetch해
kgov 뒤·overlay 앞(또는 tree-protocol 자리)에 자동 삽입하도록 배선.
약 100개 개별 SP 파일에 수동 복붙하는 방식은 채택하지 않는다 — 바로 이
방식이 오늘 발견한 문제의 원인이다.

이렇게 하면:
- 오늘 만든 G18(담당자 확인·승인)·G19(정부24 서류)가 실제로 살아난다
- G1~G17(기존 게이트, 2026-07-08 신설분)도 처음으로 실제 반영된다
- 향후 G20이 추가돼도 개별 SP 100개를 다시 고칠 필요가 없다

## 다음 단계 (승인 대기)

1. `jeju-router.js`에 `HUMAN-AUTHORITY-GATE-SCHEMA` 동적 삽입 배선
2. 삽입 후 §CAPABILITIES "접수/안내만" 표현이 kgov 원칙과 여전히
   상충하는지 재검증
3. `worker.js`의 `/gov/relay` 서버측도 같은 문서를 강제 삽입해야
   하는지 확인(클라이언트가 조립한 프롬프트를 서버가 신뢰하지 않는
   기존 `UNIVERSAL-INTEGRITY`/`UNIVERSAL-common` 강제 패턴과 동일하게)
