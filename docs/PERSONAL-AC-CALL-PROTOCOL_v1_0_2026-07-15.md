# 개인 AC 호출 프로토콜 (PERSONAL-AC-CALL-PROTOCOL) v1.0

> **문서 코드:** PROTO-PERSONAL-AC-CALL
> **작성일:** 2026-07-15
> **근거:** `공무원_업무지시_100건_해법_PDV완전보급_가정.md` 트랙1/2(58건) 갱신계획
> (`혼디-공무원직무보조-시스템갱신계획_v1.0`) 실사 중 발견된 근본 공백 — 주피터님
> 지시: "대화는 한 사용자의 AI 비서와 다른 사용자의 AI 비서 간에 진행된다.
> 응답이 없거나 사람의 개입이 필요할 경우, 각자의 AI 비서가 사람 사용자에게
> 이를 고지해야 한다."
> **관련 문서:** `SP-INTERCALL-PROTOCOL_v1_0.md`(§7의 한계를 이 문서가 메움),
> `PDV_QUERY_PROTOCOL_v1_0.md`, `AGENCY-AC-COMMON_v1.3.md`(공리 1 NOTICE/REPORT),
> `HUMAN-AUTHORITY-GATE`(G2~G3 완료/대기 구분)
> **구현 위치(예정):** `worker.js` 신규 `handlePersonalAcCall()`,
> `_resolvePersonalAcTarget()`, 기존 `_sendPushToGuid`/`sw.js` 재사용

---

## 1. 왜 필요한가 — 기존 두 프로토콜의 틈

| 기존 자산 | 다루는 관계 | 왜 이번 문제에 못 쓰는가 |
|---|---|---|
| `SP-INTERCALL-PROTOCOL`(U9 SP_CALL) | 기관 SP ↔ 기관 SP | §7에서 스스로 "PDV 조회·개인식별 필요한 질의는 위임 대상 아님"이라 명시. 호출 대상도 `SP_DELEGATION_REGISTRY`에 사전 등록된 기관뿐 — 특정 시민 1인을 동적으로 지정할 수 없음 |
| `handlePdvQuery`/`pdv-history-client.js` | 시민 본인 ↔ 자기 자신 | 동의 확인이 "지금 이 브라우저 세션"을 전제 — 요청자가 시민 본인이 아니면(공무원이 대신 조회) 그 브라우저에 시민의 동의를 물을 방법이 없음 |
| `requestWorkDomainPdvCore` | 기관 ↔ 특정 시민(`work_pdv` scope 한정) | 동적 대상 지정은 가능하나, 시민에게 요청 도착을 알리는 통지 채널이 없고 트랙1/2가 필요로 하는 일반 scope(가족관계·재무제표 등)로 확장돼 있지 않음 |

**결론**: "공무원 AC가 특정 시민의 개인 AC를 호출하고, 그 개인 AC가 대신 판단하거나 사람에게 물어 응답한다"는 흐름 자체를 담당하는 프로토콜이 없다. 이 문서가 그 트렁크를 정의한다.

---

## 2. 설계 원칙

```
원칙 1: 개인 AC는 요청을 받을 뿐 강제로 열람당하지 않는다
  공무원 AC의 호출은 항상 "요청(request)"이지 "조회(read)"가 아니다.
  최종적으로 데이터를 내줄지는 개인 AC(및 그 뒤의 사람)가 결정한다
  — requestWorkDomainPdvCore §설계원칙과 동일 사상, work_pdv 이외 scope로 확장.

원칙 2: 응답 경로는 3단계 중 하나로 항상 귀결된다
  (a) 개인 AC가 사전 등록된 동의 정책으로 즉시 자동 응답
  (b) 개인 AC가 사람에게 고지 → 사람이 응답 → 개인 AC가 회신
  (c) 응답 없이 만료(expire) → 양쪽 AC 모두 각자의 사람에게 고지

원칙 3: 고지는 대칭적 의무다
  시민에게만 알리는 게 아니다. 공무원 쪽도 응답 지연·거부·모호한 상황에서는
  담당공무원에게 능동적으로 알려야 한다(AGENCY-AC-COMMON 공리1의 NOTICE/REPORT
  구분과 동일 원칙을 개인 AC 쪽에도 대칭 적용).

원칙 4: 대상은 동적으로 지정하되, 요청자 신원은 반드시 검증한다
  SP_DELEGATION_REGISTRY처럼 대상을 사전 등록하지 않는다(시민 전원을 미리
  등록할 수 없음) — 대신 handlePdvQuery의 official_access_cert 검증(4812행)을
  그대로 재사용해 "누가 요청했는지"를 확정한다.

원칙 5: 새 동의 메커니즘을 만들지 않는다
  _storeConsentRequest/_verifyConsentToken/_recordConsentEvent(기존 handlePdvQuery
  인프라)를 그대로 재사용한다. 이 문서가 신설하는 건 "호출·고지·회신"의 왕복
  구조이지 동의 검증 로직 자체가 아니다.
```

---

## 3. 프로토콜 흐름

```
공무원 AC (담당SP)                                        시민 개인 AC
      │                                                          │
      │ ① [PERSONAL_AC_CALL: target_guid={시민 ipv6},           │
      │    scope=[...], purpose={...},                          │
      │    official_access_cert={기존 4812행 검증 재사용}]        │
      ├─────────────────────────────────────────────────────────▶│
      │                                                          │
      │                                          ② 개인 AC 판단:  │
      │                              ┌─ 자동응답 정책 있음? ──예──┤
      │                              │                          ▼
      │                              │              [PERSONAL_AC_RESPONSE:
      │                              │               status=granted,
      │                              │               consent_token=...]
      │                              │  즉시 회신 ◀───────────────┤
      │                              │아니오
      │                              ▼
      │                    ③ 사람에게 고지 (기존 _sendPushToGuid 재사용,
      │                       request_id를 tag에 실음)
      │                              │
      │                    ④ 수신확인 3단계 기록
      │                       (sent→delivered→acknowledged, §5 참조)
      │                              │
      │                    ⑤ 사람이 승인/거부 응답
      │                              │
      │ [PERSONAL_AC_RESPONSE: status=granted|denied,             │
      │  consent_token=... (거부 시 null)]                        │
      │◀─────────────────────────────────────────────────────────┤
      │                                                          │
⑥ 응답 없이 TTL 만료 시 ─────────────────────────────────────────▶│
      │  [PERSONAL_AC_TIMEOUT: request_id=...]                   │
      ▼                                                          ▼
공무원 AC → 담당공무원에게 고지                      시민 AC → 시민에게 고지
  "OO 확인 요청이 아직 응답 대기 중입니다"              "응답하지 않은 요청이 있습니다"
  (AGY_NOTICE 재사용, §6 참조)                        (재고지 또는 만료 안내)
```

---

## 4. 태그 정의

### `[PERSONAL_AC_CALL]` — 공무원 AC → 시민 개인 AC

```
[PERSONAL_AC_CALL: target_guid={시민 ipv6}, scope=[...],
 purpose={조회 목적, 시민에게 그대로 노출됨}, period={start,end},
 official_access_cert={official_guid, org_id, role, signature},
 request_id={자동 생성}, ttl_sec={기본 3600}]
```

- `official_access_cert`는 기존 `handlePdvQuery`의 `_verifyAccessCert` 경로(4812~4816행)를 그대로 통과해야 한다 — 검증 실패 시 이 호출 자체가 성립하지 않는다(`ACCESS_CERT_INVALID`와 동일 오류 재사용).
- `scope`는 트랙1/2 갱신계획의 20종 후보 목록이 아니라, **실제 `VALID_PDV_SCOPES`에 등록된 값**이어야 한다(사고실험 발견②). 세분화된 증명서 단위가 필요하면 이 문서가 아니라 별도로 `VALID_PDV_SCOPES` 확장이 선행돼야 한다.

### `[PERSONAL_AC_RESPONSE]` — 시민 개인 AC → 공무원 AC

```
[PERSONAL_AC_RESPONSE: request_id={}, status=granted|denied|pending,
 consent_token={granted일 때만}, responded_by=auto_policy|human,
 responded_at={ISO}]
```

- `responded_by=auto_policy`인 경우, 어떤 정책이 적용됐는지(예: "가족관계 확인은 항상 자동 승인"으로 등록된 개인 설정)를 감사 로그에 남겨야 한다 — 사람이 결정한 것처럼 뭉뚱그리지 않는다(U2 정직성 원칙과 동일).

### `[PERSONAL_AC_TIMEOUT]` — TTL 만료 시 양방향 발생

```
[PERSONAL_AC_TIMEOUT: request_id={}, expired_at={ISO},
 last_known_status=delivered|acknowledged|not_delivered]
```

- 이 태그가 발생하면 **양쪽 AC 모두**가 각자의 §6 고지 절차를 수행한다(원칙 3).
- `last_known_status`가 `not_delivered`면(§5의 ② 도달조차 안 됨) 공무원 쪽 고지 문구는 "시민이 무응답"이 아니라 "통지 자체가 실패했을 가능성"으로 정확히 구분해 전달해야 한다 — 이전 사고실험에서 짚은 "실패의 책임 소재" 구분을 그대로 반영.

### `[PERSONAL_AC_EMERGENCY_BYPASS]` — 긴급 신호 시 알림 긴급도 상향 (2026-07-15 신설, 2026-07-15 구현 시 정정)

> **근거:** `CROSS-ACTOR-SCENARIOS-100` C축 51번(가정폭력 피해 신고) 사고실험 —
> 이 프로토콜의 표준 흐름(제안→고지→수신확인→응답 대기→TTL 만료)을 그대로
> 적용하면, 위급 상황에서도 "아직 응답 대기 중"이라는 절차적 지연이 발생한다.
> 이건 R0(응급 최우선) 원칙과 정면으로 충돌한다.

> **2026-07-15 구현 시 정정**: 최초 설계는 "emergency=true 시 §4 표준 왕복
> 전체(②③④⑤)를 생략한다"고 썼으나, 실제 `handlePersonalAcCall` 구현에서는
> **동의 요건 자체를 생략하지 않기로 결정했다.** 이유: 동의 없는 PDV 열람을
> 정당화하려면 강제조사·긴급조항 같은 법적 근거가 있어야 하고, 이건 AI가
> 코드 차원에서 단독으로 판단할 사안이 아니다(이전 사고실험 "강제조사·수사성
> 업무" 논의의 원칙과 동일 — 영장주의는 절차의 편의를 위해 없앨 수 있는 게
> 아니다). 실제 구현은 두 가지만 다르게 처리한다:

- `emergency=true`인 요청은 **알림의 긴급도만** 다르게 처리된다 — 제목·문구가 "긴급 확인 요청"으로 바뀌고, TTL이 일반(`ttl_sec`, 기본 3600초)보다 길게(24시간) 설정돼 "짧은 시간 안에 응답 안 하면 무효"가 되지 않는다. **동의 자체는 여전히 필요하다.**
- 이 플래그를 남용해 일반 요청을 긴급으로 위장하는 걸 막기 위해, `emergency=true`는 `official_access_cert.role`이 사전 등록된 화이트리스트(`EMERGENCY_ELIGIBLE_ROLES`, 현재는 자리표시자 값만 등록됨 — KNOWN_LIMITATIONS 5 참조)에 있을 때만 허용된다.
- 51번(가정폭력 신고) 같은 상황에서 실제로 필요한 건 "동의 없는 열람"이 아니라 "일반 행정 절차보다 훨씬 빠르게, 그리고 확실하게 대상자에게 닿는 알림"이라는 게 이번 구현 결정의 근거다 — 진짜 동의 예외가 필요한 영역(수사기관의 강제 조사 등)은 이 프로토콜이 아니라 별도의 법적 근거 기반 경로(이전 사고실험 "②-B 대인범죄형" 참조)로 처리해야 한다.

---

## 5. 수신확인 3단계 (기존 설계 재사용, 이 프로토콜의 ③④에 해당)

이전 논의에서 확정한 sent → delivered → acknowledged 3단계를 그대로 사용한다. 재정의하지 않고 인용만 한다:

- **sent**: `_sendPushToGuid` 호출 시점(기존 함수 그대로 재사용, tag에 `personal-ac-call-{request_id}` 실음)
- **delivered**: `sw.js`의 `push` 이벤트 핸들러(182행)에 `fetch(consent-receipt, {event:'delivered'})` 한 줄 추가
- **acknowledged**: `sw.js`의 `notificationclick` 핸들러(238행)에 동일 패턴으로 한 줄 추가
- 신규 엔드포인트: `POST /pdv/consent-receipt {request_id, event}` — `pdv_consent_requests`에 `delivered_at`/`acknowledged_at` 필드 추가

---

## 6. 고지(NOTICE) — 대칭 설계

### 6-1. 시민 쪽 고지
§5의 push 알림이 그대로 시민 쪽 고지다. 추가로, push가 `not_delivered`로 확인되면(구독 없음 등) **대기함 폴백**이 필요하다 — 이전 논의에서 제안한 대로 `dept_tasks`의 게시-구독 큐 패턴을 재사용해 webapp.html에 "내게 요청된 확인함" 뷰를 추가한다(신규 큐 메커니즘 아님, 기존 패턴의 시민판 재사용).

### 6-2. 공무원 쪽 고지 (신규 — 지금까지 논의에서 다루지 않았던 대칭 축)
`AGENCY-AC-COMMON` 공리1의 `[AGY_NOTICE]` 태그(이미 "단계 착수 직전에 낸다"는 규칙이 있음)를 이 상황에도 재사용한다:

```
[AGY_NOTICE: step=PDV확인/대기, doing="{시민 이름 또는 사건번호} 확인 요청이
 아직 응답 대기 중입니다 — 마지막 확인 시각 {ts}", ts={ISO}]
```

담당공무원이 자기 SP 화면을 열 때마다 매번 이 상태를 확인시켜주는 게 아니라, TTL 만료(`PERSONAL_AC_TIMEOUT`) 시점과 이후 정기 폴링(예: 하루 1회 요약) 두 시점에만 발생시켜 알림 피로를 피한다 — `STAFF_TASK_QUEUE`의 `META_TABLE_UPDATE` 배치 집계와 동일한 절제 원칙.

---

## 7. 대상 해석(`_resolvePersonalAcTarget`) — 신규 함수 스펙

`SP_DELEGATION_REGISTRY`처럼 고정 목록이 아니라, `requestWorkDomainPdvCore`의 대상 검증 패턴(1632~1659행)을 재사용한다:

```js
async function _resolvePersonalAcTarget(env, targetGuid) {
  const profile = await _l1FindProfileByGuid(env, targetGuid).catch(() => null);
  if (!profile) return { ok: false, reason: 'TARGET_NOT_FOUND' };
  // 개인 AC 존재 자체는 프로필 존재로 충분 — 별도 "개인 AC 등록" 절차 불필요
  // (모든 검증된 시민 프로필은 곧 개인 AC를 가진 것으로 취급, AGENCY-AC-COMMON
  // 0-4의 "모든 개인은 자신만의 개인 AC를 보유한다" 전제와 정합)
  return { ok: true, profile };
}
```

---

## 8. KNOWN_LIMITATIONS (v1.0)

1. **"자동응답 정책"(§4의 `auto_policy`) UI가 아직 없다** — 시민이 "이 scope는 항상 자동 승인"을 사전 등록할 화면이 webapp.html에 없다. 이게 없으면 트랙1/2의 상당수(전입신고 확인처럼 낮은 민감도 항목)도 매번 사람 개입이 필요해져, v1.0/v1.1이 기대한 "즉시 처리" 효과가 줄어든다.
2. **TTL 기본값(3600초)의 트랙별 차등화 미정** — 재난지원금처럼 시급한 건과 인허가 갱신처럼 여유 있는 건이 같은 TTL을 쓰는 게 맞는지는 정책 판단이 선행돼야 한다(이전 사고실험에서 언급한 "②(도달)~③(인지) 간격을 언제 인지실패로 볼지"와 같은 성격의 미결 사항).
3. **공무원 쪽 고지(§6-2)는 이 문서에서 처음 설계됐고 실제 배선(worker.js에 `[AGY_NOTICE]` 트리거 연결)은 아직 없다** — AGENCY-AC-COMMON이 정의한 태그 문법을 재사용하겠다는 설계 결정까지만 이 문서의 책임 범위다.
4. **scope 불일치 문제(사고실험 발견②)가 선행 해결되지 않으면 이 프로토콜도 실제로는 동작하지 않는다** — `PERSONAL_AC_CALL`의 `scope` 필드가 여전히 실재하지 않는 세분화 scope를 담으면 `handlePdvQuery`의 `SCOPE_INVALID` 검증에서 그대로 막힌다.
5. **긴급 유형 목록(`emergency=true` 발화 자격)이 아직 확정되지 않았다** — `EMERGENCY_ELIGIBLE_ROLES`(worker.js)에 자리표시자 값만 등록돼 있다. 목록 확정과 각 SP의 실제 발화 조건 검증(오남용 방지)은 후속 작업.
6. **구현 현황(2026-07-15)** — `POST /personal-ac/call`(`handlePersonalAcCall`)은 구현·라우팅 완료. 다만 다음은 아직 안 됐다:
   - §5 수신확인 3단계(sent→delivered→acknowledged) — `/pdv/consent-receipt` 엔드포인트와 `sw.js`의 `push`/`notificationclick` 훅 둘 다 미구현. 지금은 push 발송(sent) 성공 여부만 확인 가능하고, 실제 도달·인지는 알 수 없다.
   - §6-1 대기함(인박스) 폴백 — push 실패 시 시민이 나중에라도 확인할 수 있는 화면 없음.
   - 공무원 AC 쪽 실제 호출부(각 SP가 `[PERSONAL_AC_CALL]`을 실제로 발화해 이 엔드포인트를 호출하는 연동) — 엔드포인트만 있고 아직 아무 SP도 호출하지 않는다.

---

*v1.0 (2026-07-15) — 최초 작성. SP-INTERCALL-PROTOCOL §7의 한계(개인정보·PDV 조회 위임 불가)를 메우는 신규 프로토콜. 기존 handlePdvQuery 동의 검증 인프라·`_sendPushToGuid`·AGENCY-AC-COMMON NOTICE 관례를 재사용하고, 새 동의 메커니즘은 만들지 않음. 2026-07-15 같은 날 `handlePersonalAcCall` 구현 완료 — 긴급 처리는 설계 원안(동의 생략)에서 알림 긴급도 조정으로 축소해 구현(§ 긴급 예외 정정 참조).*
