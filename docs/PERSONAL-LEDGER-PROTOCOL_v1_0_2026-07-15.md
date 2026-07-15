# 개인 간 합의·기록 원장 프로토콜 (PERSONAL-LEDGER-PROTOCOL) v1.0

> **문서 코드:** PROTO-PERSONAL-LEDGER
> **작성일:** 2026-07-15
> **근거:** `CROSS-ACTOR-SCENARIOS-100_v1_0` D축(시민↔시민) 사고실험 —
> 61(돈 빌려주기)·67(용돈 송금)·68(더치페이)·76(채무 독촉)에 대응할 프리미티브가
> 코드베이스에 전혀 없음을 확인(GDC는 AI 과금 전용, `payout_account`는 사업자
> 정산 계좌 저장뿐, `GDUDA_P2P_Design_v2.md`는 신원 탐색만 다룸).
> **범위 확정(주피터님 승인):** **(B) 합의·기록 서비스로 한정한다.** 실제
> 자금이동(전자금융업 성격)은 이번 설계 범위 밖 — 이유는 §1 참조.
> **관련 문서:** `PERSONAL-AC-CALL-PROTOCOL_v1_0`(고지·수신확인 재사용),
> `AGENCY-AC-COMMON_v1.3`(6하원칙 PDV_RECORDING 패턴 재사용),
> `handleProfileClaim`(worker.js 8870행, Ed25519 서명 검증 패턴 재사용)

---

## 1. 왜 (B)로 한정하는가

| | (A) 실제 자금이동 | (B) 합의·기록(채택) |
|---|---|---|
| 필요 인프라 | 전자금융업 등록/인가, AML 체계, 은행 API | 기존 서명·PDV·알림 재사용만으로 가능 |
| 법적 성격 | 타인 자금을 중개·보관·이체 — 전자금융거래법 등 규제 대상 가능성 (확정적 법률 판단은 변호사 자문 필요, Claude는 법률가가 아님) | 위변조 불가 기록의 보관 — PDV/Openhash 철학의 자연스러운 연장 |
| 이번 D축 4건 실제 필요 | 76번(채무 독촉)도 실제로 필요한 건 "증거 기록"이지 "대신 받아주는 것"이 아님 | 4건 전부 충족 |

**이 프로토콜은 "누가 누구에게 얼마를 언제까지 갚기로 했는지"를 양측 동의 하에 위변조 불가능하게 기록하는 것까지만 한다. 실제 계좌이체는 시민들이 기존 수단(계좌이체, 토스, 카카오페이 등)으로 각자 처리하고, 혼디는 그 사실을 사후에 "완료"로 기록만 한다.**

---

## 2. 설계 원칙

```
원칙 1: 혼디는 기록자이지 이체자·집행자가 아니다
  실제 자금 이동에 관여하지 않는다. 분쟁 시 이 기록이 법적 증거로 쓰일 수는
  있으나(당사자 간 서명된 합의), 혼디가 강제집행하지 않는다 — 이건 사법
  절차의 영역이다(이전 사고실험 "발견②-강제조사"와 동일한 경계 원칙).

원칙 2: 양측 서명 없이는 레코드가 성립하지 않는다
  한쪽이 일방적으로 "OO가 나에게 50만원 빚졌다"를 기록할 수 없다 —
  상대방의 서명(handleProfileClaim과 동일한 Ed25519 서명 검증 패턴)이
  있어야 레코드가 CONFIRMED 상태가 된다. 그 전까지는 PROPOSED(제안)일 뿐.

원칙 3: 새 동의·고지 메커니즘을 만들지 않는다
  PERSONAL-AC-CALL-PROTOCOL의 [PERSONAL_AC_CALL] 왕복 구조와
  _sendPushToGuid 고지·수신확인(sent→delivered→acknowledged)을 그대로
  재사용한다 — "돈 관련 제안이 왔다"는 것도 결국 개인 AC가 사람에게
  전달해야 하는 사안 중 하나일 뿐이다.

원칙 4: 이자·연체료 계산 로직을 만들지 않는다(v1.0 범위)
  당사자가 합의한 조건(terms)을 텍스트로 기록할 뿐, 이자 계산·자동 정산은
  하지 않는다 — 이건 (A)에 가까운 금융 로직이라 v1.0 범위 밖.

원칙 5: 신용정보로 활용하지 않는다
  이 기록은 당사자 간 사적 합의 증거일 뿐, 신용평가·대출심사 등에 자동
  연동되지 않는다(개인정보 목적외 이용 금지 원칙 — 발견①의 목적구속
  원칙과 동일 사상).
```

---

## 3. 데이터 모델

```js
// L1 pdv_records 재사용 — 새 컬렉션 만들지 않는다. type: 'personal_ledger'로 구분.
{
  ledger_id:        'PLED-{proposer_guid8}-{timestamp}',
  proposer_guid:    '...',           // 제안자
  counterparty_guid:'...',           // 상대방
  amount:           500000,
  currency:         'KRW',
  purpose:          '생활비 대여',    // 목적구속 원칙 — 텍스트로만 기록
  due_date:         '2026-08-15' | null,  // null이면 상환기한 없음(67번 용돈 송금형)
  terms:            '무이자, 일시상환',
  status:           'proposed'|'confirmed'|'rejected'|'completed'|'disputed',
  proposer_signature:    { pubkey, signature, ts },
  counterparty_signature:{ pubkey, signature, ts } | null,
  completion_signatures: { proposer: {...}|null, counterparty: {...}|null },
  group_members:    [...] | null,    // 더치페이(N인) 확장 시에만 사용, §5 참조
  created_at, updated_at,
}
```

기존 `pdv_records`(L1) 테이블·6하원칙 요약 패턴(`AGENCY-AC-COMMON` §PDV_RECORDING)을 그대로 재사용한다 — 신규 컬렉션이 아니라 `type: 'personal_ledger'`로 기존 스키마 안에서 구분한다.

---

## 4. 프로토콜 흐름

```
시민A                                                    시민B
  │                                                        │
  │ ① [PERSONAL_LEDGER_PROPOSE: counterparty_guid=B,      │
  │    amount=500000, due_date=..., terms=...,            │
  │    proposer_signature={A 서명, msg="ledger-propose:    │
  │    {ledger_id}:{amount}:{counterparty_guid}:{ts}"}]    │
  ├───────────────────────────────────────────────────────▶│
  │                                          ② B의 개인 AC:  │
  │                              PERSONAL-AC-CALL-PROTOCOL │
  │                              §5~6 그대로 재사용(고지→   │
  │                              수신확인→사람 응답)         │
  │                                                        │
  │ ③-a B 동의: [PERSONAL_LEDGER_CONFIRM: ledger_id=...,   │
  │    counterparty_signature={B 서명}]                    │
  │◀───────────────────────────────────────────────────────┤
  │  → status='confirmed', 양쪽 PDV에 동일 ledger_id로 기록 │
  │                                                        │
  │ ③-b B 거부: [PERSONAL_LEDGER_REJECT: ledger_id=...]    │
  │◀───────────────────────────────────────────────────────┤
  │  → status='rejected', A의 PDV에만 "제안했으나 거부됨"   │
  │    기록(B의 PDV엔 남지 않음 — B가 동의 안 한 사실을 B의  │
  │    원장에 강제로 남기지 않는다는 게 원칙2의 연장)        │
  │                                                        │
  │ ④ due_date 도래 임박 시 양쪽 AC에 자동 고지             │
  │    (AGENCY-AC-COMMON [AGY_NOTICE] 패턴 재사용,          │
  │     "OO건 상환기한이 3일 남았습니다")                   │
  │                                                        │
  │ ⑤ 실제 상환(계좌이체 등, 혼디 관여 없음) 후:            │
  │    [PERSONAL_LEDGER_COMPLETE: ledger_id=...,           │
  │     completion_signature={완료 확인 서명}]              │
  │    → 양측 모두 서명해야 status='completed'로 종결       │
  │      (한쪽만 서명하면 'completed_pending_counterparty') │
  ▼                                                        ▼
```

---

## 5. N인 확장 — 더치페이(68번)

`group_members` 필드로 확장한다. 새 프로토콜이 아니라 위 구조의 반복이다:

```js
{
  ledger_id: 'PLED-GROUP-{organizer_guid8}-{ts}',
  group_members: [
    { guid: 'A', share: 30000, status: 'confirmed' },
    { guid: 'B', share: 30000, status: 'proposed' },
    { guid: 'C', share: 30000, status: 'proposed' },
  ],
  amount: 90000, // 총액, share 합과 일치해야 함(서버 검증)
  ...
}
```

주최자(organizer) 1인이 N명에게 각각 §4의 PROPOSE를 발화하고, 각자 독립적으로 CONFIRM/REJECT한다 — N개의 1:1 레코드가 아니라 하나의 group ledger 안에서 각자 상태만 갱신되는 구조다.

---

## 6. 61·67·68·76번 매핑

| 항목 | 매핑 |
|---|---|
| 61. 친구에게 돈 빌려주기 | §4 기본 흐름, `due_date` 있음 |
| 67. 부모→자녀 용돈 송금 | §4 기본 흐름, `due_date=null`(상환 개념 없음 — `terms="증여, 상환 없음"`) |
| 68. 여행 경비 더치페이 | §5 그룹 확장 |
| 76. 채무 변제 독촉 | 새 프로토콜 불필요 — 이미 `confirmed` 상태인 기존 레코드의 `due_date` 경과를 §4-④ 고지가 반복 트리거하는 것으로 충분 |

---

## KNOWN_LIMITATIONS (v1.0)

1. **법적 효력은 별도 검토 대상이다** — 양측 서명 기록이 실제 재판에서 어떤 증거능력을 갖는지는 Claude가 단정할 수 없다(법률가가 아님, 사용자 안내에서도 항상 이렇게 고지해야 함). "위변조 불가"와 "법적 구속력"은 다른 개념이다.
2. **사기 방지의 한계** — 양측 서명을 요구해 일방적 위조는 막지만, "실제로는 돈을 안 빌려줬는데 상대를 압박해 서명하게 만드는" 사회공학적 위험까지는 막지 못한다. 이건 기술로 해결할 문제가 아니라 사용자 교육 영역.
3. **환율·다중통화 미고려** — `currency` 필드는 있으나 실제 환산 로직 없음.
4. **이자·연체료 자동계산 없음**(원칙4) — 필요해지면 v2.0에서 별도 검토, (A) 방향에 가까워지므로 신중해야 함.
5. **완료(COMPLETE) 단계의 비대칭 위험** — 한쪽만 서명하고 다른 쪽이 서명을 거부하면 `completed_pending_counterparty` 상태로 영원히 남을 수 있다. 이 상태의 후속 처리(예: 90일 후 자동 만료?)는 아직 미정.
6. **실제 코드 반영 안 됨** — 이 문서는 설계까지만이다. 돈이 관련된 기능이라 이전 문서들과 달리 코드 반영 전 별도 검토를 한 번 더 거치는 걸 권장(원칙적으로 이 세션의 다른 발견사항들보다 신중해야 할 영역).

---
*v1.0 (2026-07-15) — D축(시민-시민) 금전 거래 프리미티브 최초 설계. 범위를
합의·기록으로 한정(주피터님 승인). 코드 미반영, 설계 단계.*
