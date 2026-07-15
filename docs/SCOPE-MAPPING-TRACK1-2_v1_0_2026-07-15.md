# 트랙1/2 scope ↔ 실제 VALID_PDV_SCOPES 매핑 (v1.0)

> **작성일:** 2026-07-15
> **근거:** 사고실험 발견② — `혼디-공무원직무보조-시스템갱신계획_v1.0` §5 레이어A가
> 제안한 20종 scope(`resident-registration`, `family-relation` 등)가
> `worker.js`의 실제 `VALID_PDV_SCOPES`(818행)에 하나도 없어, 그대로 쓰면
> 전부 `400 SCOPE_INVALID`로 실패함(4772행 검증 로직 확인).
> **결론 요약:** 20종 대부분은 **이미 존재하는 넓은 도메인 scope로 매핑 가능** —
> 새 scope를 20개 만들 필요 없음. 실제로 신설이 필요한 건 1개, scope 개념 자체가
> 잘못 끼어든 건 2개뿐.

---

## 1. 매핑표

`SCOPE_SOURCE_MAP`(858행)을 대조 기준으로 삼았다 — 각 실제 scope가 "어느
기관 시스템이 리포터인가"를 이미 정의해두고 있어, 계획서의 증명서 단위
scope가 어느 기관 소관인지만 확인하면 대부분 바로 매핑된다.

| 계획서 scope(가상) | 실제 매핑 | 근거 |
|---|---|---|
| `resident-registration` | `kpublic` | 주민등록은 행안부/읍면동 공공행정 일반 소관 |
| `family-relation` | `kpublic` | 가족관계등록도 행안부 소관, 별도 리포터 없음 |
| `identity` | `kpublic` | 신원 확인은 공공행정 일반 범주로 흡수 |
| `employment-insurance` | `klabor` | 고용노동부 계열(고용보험) |
| `health-insurance` | `knhis` | 국민건강보험공단 — 1:1 정확히 일치 |
| `health-insurance-premium` | `knhis` | 상동 |
| `criminal-record-consent` | `kpolice` | 경찰청 회보 |
| `tax-completion` | `ktax` | 국세청 |
| `local-tax-completion` | `ktax` | `SCOPE_SOURCE_MAP`의 ktax 소스가 `['tax','jeju']`로 지방세(jeju) 포함 |
| `real-estate-registry` | `kcourt` | 등기소는 법원 소관 |
| `military-service` | `kmma` | 병무청 — 1:1 정확히 일치 |
| `pension-history` | `knps` | 국민연금공단 — 1:1 정확히 일치 |
| `lease-contract` | `khousing` | 국토부 주택 계열 |
| `traffic-violation` | `ktraffic` | 이미 존재, 그대로 재사용 |
| `vehicle-registry` | `ktransport` | 국토교통 계열 |
| `business-registry` | `ktax` | 사업자등록은 국세청 소관 |
| `health-condition-optin` | `khealth` | 이미 존재, 그대로 재사용 |
| `disaster-support-optin` | `ksafety` | 안전 계열(재난지원 옵트인) |
| `emergency-contact` | `pdv_general` | 특정 기관 소관 아님 — 일반 PDV로 충분 |

**19종 중 17종이 신규 생성 없이 그대로 매핑됨.**

## 2. 매핑이 안 되는 2종 — scope 개념 자체가 잘못 끼어든 경우

| 계획서 항목 | 문제 |
|---|---|
| `e-signature` | 이건 **데이터 조회 범위가 아니라 인증 수단**이다. "전자서명 여부"는 scope로 조회할 대상이 아니라 서명 절차 자체(별도 API)이므로, scope enum에서 제거하고 §OUTPUT_SCHEMA의 별도 필드(`서명_완료`)로 다뤄야 한다. |
| `document-completeness` | 이것도 조회 scope가 아니라 **SP 자체의 체크리스트 로직 결과**다(건축허가 서류 구비 여부 같은 것은 PDV에서 읽어오는 데이터가 아니라 SP가 여러 조회 결과를 종합해 판정하는 값). `GOV-TIER-IO-SCHEMA-EXTENSION`의 `담당자_확인_필요` 필드 쪽 개념에 가깝다. |

→ 두 항목은 scope 목록에서 빼고, 계획서의 §3 매핑표에서도 "필요 PDV scope" 열이 아니라 별도 처리 방식으로 재분류가 필요하다.

## 3. 신규 생성이 필요한 유일한 항목 — `financial-statement`

이것만 정말로 매핑이 안 된다. 이유: 이건 국세청·행안부처럼 **특정 정부기관이 리포터인 데이터가 아니라, 시민 본인이 PDV에 직접 기록하는 자산·소득 데이터**다(원본 100건 문서 B유형 — 기초생활수급 심사, 국가장학금 소득분위 등에 필요). `SCOPE_SOURCE_MAP`의 어느 항목에도 해당 리포터가 없다.

> **2026-07-15 정정**: 최초 이 문서는 `kfinance`를 신규 scope명으로 제안했으나,
> 실제 코드 반영 직전 확인 결과 `kfinance`는 이미 `SVC_ALIAS`(875행)에서
> `'stock'`(K-Stock/투자 서비스)의 별칭으로, `UNIVERSAL_FORCED_K_SERVICES`
> (5427행)에도 기존 K-서비스 식별자로 선점돼 있었다. 완전히 다른 의미(투자 정보
> vs 복지심사용 자산신고)의 두 개념이 같은 이름을 쓰게 될 뻔했다 — 과거 사례
> (`[GWP: kmarket]`→`[GWP: kcommerce]` 라우팅 버그)와 동일 계열의 위험이라
> **`kassetdecl`(자산신고)로 이름을 바꿔 충돌을 피한다.**

**제안**: `VALID_PDV_SCOPES`에 `kassetdecl` 신규 추가.
```js
// worker.js 818행 VALID_PDV_SCOPES 배열에 추가
'kassetdecl',
```
```js
// worker.js 858행 SCOPE_SOURCE_MAP에 추가
kassetdecl: null,  // pdv_general과 동일하게 시민 자기 PDV 기록, 특정 리포터 없음
```
```js
// SCOPE_MIN_LEVEL에 추가 — 소득·자산 정보는 L1보다 높은 게 맞음
kassetdecl: 'L2',
```
`L2`로 제안하는 이유: 이전 사고실험 발견④에서 확인했듯 L2/L3는 Bearer 토큰 배선이 아직 안 끝나 사실상 아무도 통과 못 하는 상태다(4749행 TODO). 지금 `L1`로 걸면 재무제표 같은 민감 정보가 최소 인증만으로 뚫리는 셈이니, **배선이 끝나기 전까지는 이 scope 자체를 비활성 상태로 두는 게 맞다** — L2로 미리 못박아, 배선 완료 전엔 자동으로 막히게 하는 안전한 실패(fail-safe) 설계다.

이 세 줄(코드 3곳) 외에 `worker.js`를 이번 문서에서 추가로 건드리지 않는다 — 실제 반영 여부는 별도 확인 후 진행한다.

## 4. 갱신계획서 §5 레이어A에 대한 정정 제안

`혼디-공무원직무보조-시스템갱신계획_v1.0` §5의 20종 scope 목록을 위 매핑표로 교체해야 한다. 실질적으로 **레이어A가 "새 scope 20종을 설계"할 필요가 없어지고, "기존 scope를 재사용하도록 SP 프롬프트/스키마를 연결"하는 훨씬 가벼운 작업으로 축소**된다 — `kassetdecl` 1종 추가만이 유일한 신규 작업이다.

---

## KNOWN_LIMITATIONS

1. **`kassetdecl`은 아직 코드에 추가되지 않았다** — 이 문서는 제안까지만 하고, 실제 `worker.js` 3곳 반영은 다음 단계에서 확인 후 진행한다.
2. `local-tax-completion`을 `ktax`로 합친 것에 대한 재검토 여지 — 지방세와 국세는 실제로는 완전히 다른 조직(지자체 세무과 vs 국세청)이 관리하므로, 트래픽이 늘어나면 `kjachi`(자치행정)로 분리하는 게 나을 수 있다. 지금은 `SCOPE_SOURCE_MAP`이 이미 `ktax: ['tax','jeju']`로 지방세를 포함하고 있어 기존 구조를 따랐다.
3. `identity`를 `kpublic`으로 흡수한 게 맞는지도 재검토 여지 — 신원 확인은 사실상 모든 scope에 공통으로 전제되는 성격이라, 별도 scope가 아니라 인증 레벨(L1) 자체로 이미 처리되고 있을 가능성이 있다(중복 설계 우려).

---
*v1.0 (2026-07-15) — 사고실험 발견②(scope 불일치) 해결을 위한 매핑 작업. 코드 변경 없음, 제안만 포함.*
