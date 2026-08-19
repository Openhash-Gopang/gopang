# 혼디 베타 테스트 기간 한정 통합요금제 v1.0

> **작성일**: 2026-08-17 · **작성 주체**: 팀 주피터(AI City Inc.) · Claude와의 설계 대화 기반
> **적용 범위**: 이 문서는 **베타 테스트 기간에만 한정 적용**됩니다. 베타 종료 후
> 정식 요금제(§관련 문서 참고)로 전환되며, 이 문서의 내용은 그 시점에 폐기됩니다.
> **상태**: 확정 — worker.js에 코드로 반영 완료(2026-08-17).

---

## ⚠️ 이 문서가 하는 일 — 기존 요금제 전부를 잠정 보류합니다

아래 문서들에 있던 모든 요금제(구독 티어, 개별 서비스 정액제)는
**베타 테스트 기간 동안 전부 잠정 보류**되고, 이 문서의 단일 규칙으로
대체됩니다.

- [`business-plan/PRICING_TIER_FINAL_v1_0_2026-08-11.md`](./business-plan/PRICING_TIER_FINAL_v1_0_2026-08-11.md) — 4단계 구독 티어(시민/사업자/학생/전문직)
- [`K_SERVICE_MONETIZATION_v1_0.md`](./K_SERVICE_MONETIZATION_v1_0.md) — K-Law 소송가액 구간별 정액, K-School 단계별 정액
- [`business-plan/PRICING_TIER_MARKETING_PLAN_v1_0_2026-07-25.md`](./business-plan/PRICING_TIER_MARKETING_PLAN_v1_0_2026-07-25.md) — 990/1,990/2,990원 3단계 FUP 상한제
- 전문가 페르소나(리프) 개별 구독(월 9,900원)

각 문서에는 이 공지로 연결되는 배너를 상단에 달아뒀습니다 — 해당 문서
본문 자체는 베타 종료 후 정식 전환 시 참고용으로 그대로 남겨둡니다.

---

## 1. 핵심 규칙 — 딱 두 가지

### 1-1. 모든 이용료 = DeepSeek API 실비용 × 10

정액제·구독제·티어 구분 없이, 혼디의 모든 K-서비스(K-Law·K-School 포함)
이용은 **실제 DeepSeek API 호출 비용의 10배**로 단일화합니다
(`BILLING_MULTIPLIER_DEFAULT = 10`, 기존 일반 대화 종량제와 동일 배수
— 새로 도입한 게 아니라 K-Law 정액제·구독 티어처럼 이 배수를 우회하던
예외 경로들을 전부 없애 하나로 합친 것입니다).

### 1-2. 최소 충전 1만원, 가입 후 1일 무료

- 모든 가입자는 첫 방문 시 무료 GDC(100원 상당)로 최대 1일간 이용해볼
  수 있습니다.
- 가입 후 1일이 지나면, **누적 1만원 이상 GDC를 최소 1회 충전**해야
  계속 이용할 수 있습니다.
- GDC 충전 시 **최소 충전 금액이 1만원**으로 상향됩니다(기존
  1,000원 → 10,000원).

---

## 2. 코드 반영 내용 (worker.js, 2026-08-17)

| 항목 | 이전 | 베타 기간 |
|---|---|---|
| 최소 충전 금액(`CHARGE_MIN_KRW`) | 1,000원 | **10,000원** |
| 시민 구독료(`SUBSCRIPTION_TIERS.citizen`) | 990원/월 | **청구 안 함**(레코드만 유지) |
| 전문가 페르소나 구독료 | 9,900원/월(리프별) | **청구 안 함**(레코드만 유지) |
| K-Law 소송가액 정액(`KLAW_CLAIM_FEE_SCHEDULE`) | 5,000~100,000원(8단계) | **적용 안 함** — 토큰 종량제(×10)로 자동 폴백 |
| 가입 1일 경과 후 게이트 | 없음(잔액 3원 이상이면 통과) | **신규** — 1일 경과 + 1만원 이상 실충전 이력 없으면 차단(`BETA_UNIFIED_PRICING`) |

새로 추가된 상수: `BETA_UNIFIED_PRICING`(플래그) · `BETA_TRIAL_DAYS = 1` ·
`BETA_MIN_CHARGE_KRW_TO_CONTINUE = 10000`. 전부 `worker.js` 안에서
플래그 하나로 켜고 끌 수 있게 설계했습니다 — 베타 종료 시 이 플래그를
`false`로 되돌리면 기존 정액제·구독제 코드가 그대로 되살아납니다(코드
자체를 삭제하지 않고 우회만 시켜뒀습니다).

## 3. 정직하게 밝힘 — 라이브 검증 필요

이 변경은 로컬 환경(L1 PocketBase 서버 없음)에서 문법 검사만 마쳤고,
실제 배포 후 아래 항목은 라이브로 재확인이 필요합니다.

- `_hasCompletedBetaMinCharge`의 `charge_requests` 조회 필터가 실제
  운영 데이터의 `status` 값(`matched`/`confirmed`)과 정확히 일치하는지
- `_getAccountAgeDays`가 `profiles` 컬렉션의 `created` 시스템 필드를
  guid로 정확히 찾아내는지(guid 필드명이 실제 스키마와 일치하는지)
- 가입 1일 경과 + 미충전 사용자가 실제로 차단되는지, 반대로 정상
  이용자가 오탐으로 차단되지 않는지

## 관련 문서

- 저장소 내 `worker.js` — `BETA_UNIFIED_PRICING` 관련 전체 변경
- [`business-plan/PRICING_TIER_FINAL_v1_0_2026-08-11.md`](./business-plan/PRICING_TIER_FINAL_v1_0_2026-08-11.md) · [`K_SERVICE_MONETIZATION_v1_0.md`](./K_SERVICE_MONETIZATION_v1_0.md) · [`GDC_CHARGE_MANUAL_v1_0.md`](./GDC_CHARGE_MANUAL_v1_0.md) — 베타 종료 후 정식 전환 시 참고할 기존 설계
