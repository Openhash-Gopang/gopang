# SP 간 호출(위임) 프로토콜 v1.0
## 중앙 행정기관 SP ↔ 지방정부(제주) SP 상호 호출 + 순환 방지

> **문서 코드:** PROTO-SP-INTERCALL
> **버전:** v1.0
> **작성일:** 2026-07-05
> **작성자:** AI City Inc. (팀 주피터)
> **관련 문서:** `UNIVERSAL-common_v1_1.md`(U9), `PDV_QUERY_PROTOCOL_v1_0.md`,
>   `Jejudo/09-national/JEJU-NATIONAL-SP_v1.0.md`(§0 배타적 분기 설계)
> **구현 위치:** `worker.js` — `SP_DELEGATION_REGISTRY`, `handleGovRelay()`

---

## 1. 왜 필요한가 — 기존 설계의 한계

`JEJU-NATIONAL-SP_v1.0.md` §0는 "도청 트리와 국가기관 트리를 동시에 체인하지
않는다"고 명시한다. 라우터가 둘 중 하나만 배타적으로 골라 삽입하는 방식으로,
SP 간 호출이라는 어려운 문제(무한 루프, 비용 폭주, 프롬프트 조립 복잡도)를
**애초에 회피**해온 것이다.

하지만 이 방식으로는 답할 수 없는 질의가 실제로 존재한다.

```
"국세랑 지방세 체납액 합쳐서 얼마인지 알려줘."
  → 국세(SP-NAT-TAX, 국가기관 트리)와 지방세(SP-DO-PLAN, 도청 트리)
    양쪽 정보가 모두 필요 — 하나의 트리만 선택해서는 완결된 답이 안 나온다.
```

이 문서는 이런 경우를 위해 **SP가 다른 SP를 실제로 호출**하고, 그 결과를
합성해 사용자에게 하나의 답을 줄 수 있게 하는 메커니즘을 정의한다. 단,
"SP 간 호출"은 곧바로 "무한 위임 위험"을 동반하므로, 프롬프트 차원과 서버
차원의 **이중 방어선**을 필수로 둔다.

---

## 2. 설계 원칙

```
원칙 1: 안내로 충분하면 위임하지 않는다
  "그건 OO에 문의하세요"로 끝날 수 있으면 위임(SP_CALL)을 쓰지 않는다.
  위임은 두 관할의 정보를 실제로 결합해야만 할 때의 최후 수단이다.

원칙 2: 위임은 한 턴에 최대 1회 — 재위임 금지
  위임받은 SP는 또 다른 SP에게 위임할 수 없다. 예외 없음.

원칙 3: 순환·홉 한도는 서버가 최종 강제한다
  프롬프트(U9-3)는 1차 방어선일 뿐이다. 서버(worker.js)가 call_chain
  순환 검사 + MAX_SP_HOPS + MAX_LLM_CALLS_PER_TURN으로 최종 강제한다.
  프롬프트 지시를 SP가 어겨도(모델 오류·탈옥 시도 등) 구조적으로 뚫리지
  않아야 한다.

원칙 4: 위임 대상은 사전 등록된 식별자만 허용한다
  SP가 target을 지어낼 수 없다 — SP_DELEGATION_REGISTRY에 없으면
  무조건 거부.

원칙 5: 개인정보는 위임 시에도 최소 전달한다
  대화 이력 전체가 아니라 query 한 줄만 전달한다(PDV scope 최소화
  원칙과 동일한 사상).

원칙 6: 출처를 투명하게 밝힌다
  위임으로 얻은 정보는 최종 답변에 "어느 기관을 통해 확인했는지" 밝힌다.
```

---

## 3. 프로토콜 흐름

```
사용자: "국세랑 지방세 체납액 합쳐서 얼마인지 알려줘."
        │
        ▼
/gov/relay (agency=public, 도청 SP-DO-PLAN 계열이 agencyPrompt로 로드됨)
        │
        │ ① 1차 LLM 호출 — 도청 SP가 "국세 정보는 내 소관 밖"이라 판단
        │    → 순수 JSON만 출력:
        │    {"sp_call":{"target":"jeju_national","purpose":"국세 체납액 확인",
        │               "query":"국세 체납액이 얼마인지 확인해줘"}}
        ▼
worker.js — call_chain=["public"]
        │
        │ ② 검증: target(jeju_national) 등록됨? 순환 아님? 홉 한도(2) 이내?
        │    → 통과
        ▼
_callDelegationTarget(jeju_national, "국세 체납액이 얼마인지...")
        │
        │ ③ 2차 LLM 호출 — JEJU-NATIONAL-SP(국가기관 총괄) 단독 호출
        │    (대화 이력 없이 query만 전달, 재위임 금지 안내 포함)
        ▼
sub.content = "국세 체납 조회는 홈택스 연동이 필요하며 현재 Hondi와
               직접 연동되어 있지 않습니다. 홈택스에서 확인하십시오..."
        │
        ▼
worker.js — 원 SP(public)에게 위임 결과 전달
        │
        │ ④ 3차 LLM 호출(최종 합성) — 도청 SP가 지방세 정보 + 위임받은
        │    국세 안내를 결합해 최종 답변 작성. 출처 명시(U9-5).
        ▼
사용자에게 최종 답변 반환 (LLM 호출 총 3회로 종료 — MAX_LLM_CALLS_PER_TURN)
```

---

## 4. 순환·무한 위임 방지 — 이중 방어선

### 4-1. 프롬프트 차원 (`UNIVERSAL-common` U9-3)

모든 SP는 "위임받은 입장이라면 재위임할 수 없다"는 규칙을 시스템 프롬프트로
직접 받는다. 정상적인 모델 동작에서는 이것만으로도 대부분 막힌다.

### 4-2. 서버 차원 (`worker.js`) — 실제 강제 지점

프롬프트 지시는 모델이 어길 수 있다는 전제로 설계했다. 실제 차단은 서버가 한다.

| 방어 기제 | 값 | 설명 |
|---|---|---|
| `call_chain` 순환 검사 | — | 이번 요청에서 이미 관여한 agency 목록. target이 이미 chain에 있으면 즉시 거부. **클라이언트가 조작할 수 없다** — 매 최상위 요청마다 서버가 `[agency]`로 새로 시작한다. |
| `MAX_SP_HOPS` | `2` | 이 턴에 관여할 수 있는 SP(에이전시) 총수. 최초 SP 포함 2 — 즉 위임은 최대 1회. |
| `MAX_LLM_CALLS_PER_TURN` | `3` | 홉 계산과 무관한 2차 방어선. 정상 경로 최대 3회(판단→위임대상 답변→최종 합성)를 넘기면 무조건 종료. |
| 위임 대상 서브 호출의 구조적 무시 | — | `_callDelegationTarget()`은 서브 호출 결과가 또 `sp_call` JSON이어도 **그 여부 자체를 확인하지 않고** raw content로 반환한다 — 재위임이 시도돼도 물리적으로 실행되지 않는다. |
| 최종 합성 결과 안전망 | — | 최종 합성 호출(3번째)이 그럼에도 `sp_call` JSON을 내놓으면, 재귀하지 않고 정형화된 안내 문구로 치환한다. |

**A→B→A 순환**은 §4-2의 call_chain 검사로 차단된다(2번째 홉에서 target이
이미 chain=[A]에 있으면 거부). **A→B→C→...** 처럼 순환은 아니지만 계속
길어지는 체인은 `MAX_SP_HOPS=2`가 원천 차단한다(애초에 2단계까지만 존재
가능).

---

## 5. 위임 시작 가능 목록(v1.0 파일럿) — `SP_DELEGATION_ORIGINATORS`

```
public, jeju_do, jeju_national
```

위임을 "받는" 대상은 `SP_DELEGATION_REGISTRY`에 등록된 모두가 가능하지만,
위임을 "시작"할 수 있는 agency는 파일럿 단계에서 위 3개로 제한한다.

이유: 위임 가능 agency는 `stream:true`를 요청해도 서버가 강제로
non-stream 처리한다 — 위임 여부를 판단하려면 응답 전체를 먼저 받아야
하기 때문이다(이미 클라이언트로 흘려보낸 SSE 청크는 취소 불가). 영향
범위를 파일럿 단계에서 최소화하기 위해 시작 가능 목록을 좁게 유지한다.

---

## 6. 레지스트리 확장 방법 — `SP_DELEGATION_REGISTRY`

```js
{
  대상_식별자: {
    via: 'manifest' | 'url',
    key: 'manifest.json의 키',   // via:'manifest'일 때
    url: '...',                  // via:'url'일 때
    identity: 'professional' | 'kpublic' | null,
    pdvScope: 'kxxx' | null,
  }
}
```

- **`via:'manifest'`**: `prompts/manifest.json`에 이미 안정적인 "총괄" SP
  키가 등록된 agency만 쓸 수 있다. **`tax`는 현재 manifest에 `SP-XX_ktax`
  키가 없어 위임 대상에서 제외했다** — 넣으면 fetch가 항상 실패해 위임이
  조용히 죽는 사고가 난다(과거 v5.1 manifest 갱신 누락 사고와 같은 유형의
  실수를 미리 차단하기 위해 의도적으로 뺐다). tax를 위임 대상으로 열려면
  먼저 manifest.json에 안정 키를 등록해야 한다.
- **`via:'url'`**: Jeju 트리(`jeju_do`, `jeju_national`)처럼 manifest
  밖에서 raw URL로 직접 관리되는 문서.

---

## 7. PDV/개인정보 관련 알려진 한계 (v1.0)

- 위임 서브 호출(`_callDelegationTarget`)은 **단발성 호출**이며, 그 안에서
  `/pdv/query`의 동의 팝업 왕복(202 CONSENT_REQUIRED → 동의 → 재호출)을
  수행하지 않는다. 따라서 **위임 질의(`query`)는 사용자의 개인 식별 정보나
  PDV 조회가 필요한 내용을 담아서는 안 된다** — 일반적·공적 정보 확인
  용도로만 위임을 쓴다(원칙 5).
- 향후 버전에서 위임 대상이 PDV 조회가 꼭 필요하다고 판단하면, 지금은
  "위임 대상 SP가 PDV_REQUEST 태그를 응답에 포함 → 원 SP가 그 안내를
  사용자에게 그대로 전달 → 사용자가 별도 턴에서 다시 요청"하는 우회
  경로로만 처리된다. 진짜 중첩 동의 흐름은 v1.0 범위 밖이다.

---

## 8. 비용·과금

서브 호출들은 모두 **같은 `guid`·같은 원 `agency`의 일일 한도**
(`GOV_USER_DAILY_KRW_LIMIT`, `GOV_GLOBAL_DAILY_KRW_LIMIT`)에 합산 과금된다
— 위임을 통해 한도를 우회할 수 없다. 각 호출은 `via` 태그(예:
`public→jeju_national`, `public←jeju_national(synth)`)로 로그에 남아
감사(audit) 가능하다.

---

## 9. 현재 커버 범위 / TODO

| 항목 | 상태 |
|---|---|
| `public`, `jeju_do`, `jeju_national` → 상호 위임 | ✅ v1.0 구현 |
| `health/police/911/democracy/insurance/traffic/logistics` → 위임 **대상**(받는 쪽)으로 등록 | ✅ 레지스트리 등록 완료 |
| 위 7개 agency → 위임 **시작**(originator) | ⏳ 파일럿 이후 확대 검토 |
| `tax` 위임 대상 등록 | ⏳ manifest.json에 안정 키 선등록 필요 |
| Jeju 위임 대상의 세부 부서(도청 13개 실국·43개 읍면동) 단위 위임 | ⏳ v1.0은 L1 총괄(JEJU-DO-SP/JEJU-NATIONAL-SP) 단위까지만 — 세부 라우팅은 jeju-router.js가 클라이언트에서 처리하는 영역이라 서버 위임 경로에는 아직 연결 안 됨 |
| 위임 서브 호출 내 PDV 동의 왕복 | ⏳ v1.0 범위 밖(§7) |
| 스트리밍 지원(위임 가능 agency) | ⏳ v1.0은 강제 non-stream(§5) |

---

*AI City Inc. · team-jupeter · 2026-07-05*
