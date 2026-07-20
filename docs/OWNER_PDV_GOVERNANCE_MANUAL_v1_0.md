# K-서비스·전문가 페르소나 거버넌스 & 기관측 PDV(owner_pdv) 매뉴얼 v1.0

> **작성일**: 2026-07-20 · **대상**: 개발자(유지보수·확장)
> **메타 매뉴얼**: [`docs/MANUAL_INDEX.md`](./MANUAL_INDEX.md)
> **관련 코드**: `worker.js`(`/owner-pdv/report`) · `src/gopang/gwp/gwp-report-client.js`
> (`reportGwpSessionEnd`/`recordOwnerPDV`) · `pages/expert-chat.html` ·
> `src/gopang/ai/expert-registry.js`(`ownerAgency`) ·
> `prompts/SP_PDV_v1_2.md`(§7) · `prompts/SP_common_guardrails_v3_17.md`(C39-5·C45) ·
> `pb_migrations/1786800004~006_*owner_pdv*.js`

이 문서는 "K-서비스가 자신이 소유한 전문가 AI 페르소나를 총괄하고, 상담·산출물
이력을 스스로 기록한다"는 거버넌스 구조(이하 **기관측 PDV**, `owner_pdv`)를
다룹니다. 설계 과정에서 여러 번 방향이 수정됐고 실제 사고도 한 번 있었습니다 —
그 경위를 전부 기록해, 다음에 이 구조를 확장하거나 디버깅할 사람이 같은
시행착오를 반복하지 않도록 하는 것이 목적입니다.

---

## 1. 왜 이 구조가 필요한가

기존 PDV는 "사용자가 상대방과의 대화를 기록"하는 **사용자 단방향 구조**였습니다
(§7 이전의 `SP_PDV_v1_1.md`). 그런데 실제로는:

- K-서비스(K-Law 등)가 소유한 전문가 페르소나(변호사 등)가 **누구와 언제 어떤
  상담을 했는지**, K-서비스 자신도 알아야 합니다(만족도 파악, SP 개정 근거).
- K-Law처럼 **고유 산출물**(가상 판결문)을 만드는 K-서비스는, 사용자 상담과는
  별개로 자신이 만든 산출물 자체의 이력을 쌓아야 합니다.

그래서 사용자측 PDV(기기 로컬, 실명)와는 완전히 별개로, **K-서비스 서버 측에
기관측 PDV**를 신설했습니다. 두 PDV는 저장 위치도, 신원 정책도 다릅니다(§3 참조).

---

## 2. 아키텍처 개요

```
[사용자] ──상담──▶ [전문가 페르소나 (expert-chat.html)] ──종료 시──▶ recordOwnerPDV()
                                                                          │
[K-서비스 자신]  ──세션 종료──▶ reportGwpSessionEnd() ──내부에서 자동──▶ recordOwnerPDV()
                                                                          │
                                                                          ▼
                                                          worker.js /owner-pdv/report
                                                          (원문 guid → who_hash 계산,
                                                           원문은 폐기, 해시만 저장)
                                                                          │
                                                                          ▼
                                                     PocketBase owner_pdv 컬렉션
                                                (단일 공유 컬렉션, owner_agency로 파티션)
```

**핵심 설계 결정**: 처음엔 K-서비스마다 별도 PocketBase 컬렉션(`<agency>_pdv`)을
만들려 했으나, klaw/market 등 개별 K-서비스 저장소에 자체 PocketBase가 없고
전체 플랫폼이 gopang의 **단일 공유 PocketBase**를 쓴다는 걸 실사로 확인 →
`gwp_registry`와 동일한 패턴(단일 컬렉션 + `owner_agency` 필드 파티션)으로 정정.

---

## 3. 신원 정책 — 가명화 해시 (중요, 여러 번 수정된 부분)

`owner_pdv`의 `who_hash` 필드는 사용자를 다음처럼 식별합니다:

```
salt = SHA256(GOPANG_MASTER_KEY + ":owner-pdv-salt:" + ownerAgency)
who_hash = SHA256(userGuid + ":" + salt)
```

- **결정 경위**: 처음엔 실명 GUID를 그대로 저장하려 했으나(K-서비스가 상담
  이력을 소명할 수 있어야 한다는 이유), 사용자가 "K-서비스는 익명화, 사용자
  PDV에 실명"이 OpenHash 철학에 맞다고 정정 → 완전 익명(추적 불가)과 실명
  사이 절충으로 **가명화 해시**로 최종 확정.
- **해싱은 반드시 서버(Worker)에서 계산합니다.** 클라이언트에서 해시하면 salt가
  번들에 노출되고, GUID가 `uuidv5(phone_number)`로 결정론적이라 전화번호
  전수조사로 역산 가능해져 "역추적 불가" 원칙이 무력화됩니다.
- salt는 K-서비스별로 다르며, 에이전시 25개마다 시크릿을 따로 만들지 않고
  기존 `GOPANG_MASTER_KEY`(WebAuthn HMAC 서명 등에 이미 쓰이던 서버 비밀)에서
  결정론적으로 파생합니다 — 새 시크릿 프로비저닝 불필요.
- 효과: **같은 K-서비스 안에서 재상담 인식은 가능**(같은 `who_hash`), **역추적
  불가**(해시에서 GUID 복원 불가), **기관 간 교차 대조 불가**(salt가 달라 같은
  사용자라도 K-서비스마다 해시값이 다름).

---

## 4. 스키마 (`owner_pdv` 컬렉션)

| 필드 | 설명 |
|---|---|
| `record_type` | `consultation`(상담) \| `own_output`(K-서비스 고유 산출물) |
| `owner_agency` | 소유 K-서비스 id (예: `klaw`, `ktax`) — 정규화됨(§6 참조) |
| `persona_key` / `persona_version` | `consultation`일 때만, 어느 페르소나인지 |
| `who_hash` | §3의 가명화 해시. `own_output`이면서 특정 상대가 없으면 `null` |
| `when` / `where` / `what` / `why` | 6하원칙 스타일 |
| `how` | 경과 유형(§5 참조) |
| `detail` | `own_output` 전용 JSON — K-서비스마다 스키마가 다름(강제 안 함). 예: K-Law 판결문 `{case_no, klaw_version, score_total, grade, verified}` |
| `outcome_signals` | JSON — 문장/단어 판독이 아닌 **구조화된** 만족도 신호. 현재는 `{explicit_rating: 'up'\|'down'\|null}`(세션 종료 시 1탭 버튼)만 있음 |
| `source_ref` | 항상 `null` — 원문은 절대 기관측 PDV에 저장하지 않음 |

---

## 5. `how` 필드 — 경과 유형

| 값 | 의미 |
|---|---|
| `completed` | 상담 정상 종료 |
| `escalated_success` | 정상 절차 완주 후 인간 전문가 연결(설계된 흐름, 실패 아님) |
| `escalated_ai_limit` | AI 한계로 인한 조기 이관 |
| `early_exit` | 무응답 타임아웃 등으로 중도 종료 |

`escalated_success`/`escalated_ai_limit` 구분은 **C39-5**(`[CONNECT_HUMAN_EXPERT:
업종키워드 | reason=limit]`)로 페르소나 스스로 표시합니다 — 초기 구현에서는
이 구분이 없어 전부 `escalated_success`로 잡히는 알려진 한계가 있었고, 이후
보완했습니다.

---

## 6. 이름 불일치 — `AGENCY_ID` vs GWP_REGISTRY id (실제로 겪은 함정)

K-서비스마다 **로컬 `AGENCY_ID`**(예: `'tax'`, `'market'`, `'school'`)와
**GWP_REGISTRY의 표준 agency id**(예: `'ktax'`, `'kcommerce'`, `'kedu'`)가
서로 다른 명명 체계입니다. `klaw`는 두 체계에서 우연히 같은 문자열이라
처음엔 이 문제가 안 드러났고, `tax`를 마이그레이션하며 실제로 걸렸습니다.

이미 있던 `SVC_ALIAS`(`worker.js`, k표준형→로컬형)를 역으로 뒤집어
(`REVERSE_SVC_ALIAS`) `owner_agency` 값을 정규화합니다 — 새 매핑을 또 만들지
않고 기존 걸 재사용했습니다. **`market`은 아직 이 매핑에 안 걸립니다** —
`reporter_svc: 'kmarket'`이라는 제3의 표기를 쓰고, 결제완료 트리거 기반이라
구조 자체가 다릅니다(§8 참조).

---

## 7. 상담 종료 감지 — `[EXPERT_DONE]` (C45)

기존에는 사용자 발화에 대한 정규식(`/끝났|그만|종료|돌아가.../`)만으로 종료를
감지했는데, 상담 내용 자체에 "그만"이 등장하면(예: "약 먹는 거 그만뒀어요")
오탐지로 조기 종료되는 결함이 있었습니다. **C45**(`SP_common_guardrails`)로
페르소나 자신이 대화 맥락을 판단해 `[EXPERT_DONE]` 태그를 출력하도록 했습니다
— 정규식은 빠른 경로로 병행 유지, 대체 아님. 클라이언트는 이 태그를 사용자에게
노출하지 않고 감지·제거 후 종료 처리합니다.

---

## 8. SSOT(단일 소스) 마이그레이션 현황

`gwp-report-client.js`(공용 리포팅 모듈)를 안 쓰고 자체 사본을 복붙해 쓰던
K-서비스들을 공용 모듈 사용으로 전환해야, `reportGwpSessionEnd()` 내부에
연결된 `recordOwnerPDV()` 자동 호출의 혜택을 받습니다(개별 서비스가 owner_pdv
연동 코드를 따로 안 짜도 됨).

| 상태 | 서비스 |
|---|---|
| ✅ 이미 완료 | klaw, school, stock, gdc, security, jeju |
| ✅ 2026-07-20 마이그레이션 완료 | tax, police, public, health, traffic, logistics, democracy, insurance, 911 |
| ⚠️ 미해결 — 별도 조사 필요 | **market** — `reporter_svc: 'kmarket'`(화이트리스트 어디에도 없는 표기), 결제완료 트리거 기반이라 이번 패턴을 기계적으로 적용 불가 |

---

## 9. 알려진 한계 (미해결, 의도적으로 미구현)

1. **다운스트림 전환 신호(K-Market 실거래 연계) — 설계 폐기**: "이 상담이 실제
   거래로 이어졌는가"를 알고 싶었으나, `who_hash`(가명화)와 `ledger_entries`
   (실명 guid 기반)를 사후에 대조할 방법이 **구조적으로 없습니다**(애초에
   역추적 불가하도록 설계했으므로). 기록 시점(guid가 아직 살아있는 순간)에
   함께 조회해서 같이 기록하는 방법뿐인데, 이는 별도의 설계 변경이 필요해
   보류했습니다.
2. **`escalated_ai_limit` 판정 정확도**: C39-5로 페르소나 자기신고에 의존 —
   신뢰도 검증은 안 돼 있습니다.
3. **`market` SSOT 미마이그레이션** (§8 참조).
4. **`/owner-pdv/report` 인증 없음**: origin 기반 서비스 등록 검사(기존
   `_getSvcRegistration()`)가 아직 안 걸려 있습니다 — 스키마 검증만 합니다.

---

## 10. 사고 이력 — worker.js 대량 삭제 (중요, 재발 방지 참고)

이 작업 도중, 대화 초반에 한 번 클론한 뒤 갱신하지 않은 **낡은 로컬 사본**으로
`worker.js` 전체를 덮어써서, 그 사이 동료가 추가한 고액거래 WebAuthn 재인증
코드(519줄)를 삭제하는 사고가 있었습니다. 사용자가 직접 복구했고, 이후 이
사고가 **총 두 차례** 반복된 뒤에야(436e508, 890e434c) `.github/workflows/
check-worker-mass-deletion.yml`(신설)이 push 시점에 자동으로 대량 삭제를
막도록 CI 안전장치가 만들어졌습니다.

**교훈**: 공유·활발히 편집되는 파일(특히 `worker.js`)을 다시 건드릴 때는
**항상 최신 원격을 다시 pull한 뒤 그 위에 최소 diff만 적용**하고,
`git diff --stat`으로 변경량이 예상과 같은지 커밋 전에 반드시 확인합니다.

---

## 11. 배포·테스트 체크리스트 (이 매뉴얼 작성 시점 기준 미완료)

- [ ] `pb_migrations/1786800004~006` 적용(owner_pdv 컬렉션 + detail + outcome_signals 필드)
- [ ] `worker.js` 배포(`/owner-pdv/report`, salt 파생, 화이트리스트/별칭 정규화)
- [ ] 실제 로그인 사용자로 전문가 페르소나 상담 1건 → 종료 → `owner_pdv`에
      레코드 확인, `who_hash` 채워짐 확인, 재상담 시 동일 해시 확인
- [ ] 👍/👎 버튼 동작 및 `outcome_signals` 반영 확인
- [ ] `[EXPERT_DONE]` 태그가 실제 모델 응답에 나타나는지 확인(SP 지시만
      있고 실전 검증 안 됨)
- [ ] `market` 별도 처리 여부 결정
