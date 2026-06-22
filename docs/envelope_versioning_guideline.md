# 봉투(Envelope) 갱신 가이드라인 v1.0
**작성** Claude Sonnet 4.6 | 2026-06-22
**범위** Profile 봉투(`extra.public.*`) / PDV 봉투(6하원칙 `/pdv/report`) / `industry_fields` 슬롯에 적용되는 95개+ 업종·유형별 스키마 파일
**원칙** "봉투"와 "개별 95개 파일"은 영향 범위가 다르므로 다른 규칙을 적용한다.

---

## 1. 용어 정의

| 용어 | 의미 |
|---|---|
| 봉투(envelope) | Profile의 `identity/activity/contact/location/finance` 5섹션 + `industry_fields` 슬롯 자체. PDV의 `who/when/where/what/how/why` 6키 + `content_hash`/`block_hash` 메커니즘. |
| 업종·유형 스키마 | `industry_fields` 슬롯 **내부**의 구조 — `prompts/AGENT-SUPPLIER-XX_*.txt`(KSIC 코드) 또는 향후 institution/org/platform 전용 파일이 정의. |
| `envelope_version` | 각 업종·유형 스키마 파일이 "나는 이 버전의 봉투와 호환된다"고 선언하는 값. |
| `schema_version` | 그 업종·유형 스키마 **자체**의 버전(파일마다 독립적으로 올라감). |

---

## 2. 봉투 변경 규칙 — 영향 범위가 전체이므로 가장 신중함

**허용**: 새 섹션 추가, 기존 섹션에 새 하위 필드 추가, `industry_fields`처럼 새 확장 슬롯 추가.

**금지(영구)**:
- 기존 필드·섹션 삭제
- 기존 필드 이름 변경
- 기존 필드 타입 변경(예: `tags: string` → `tags: string[]`처럼 string이 이미 있었다면 array로 바꾸는 것도 금지 — 기존 소비자가 string을 기대하고 짠 코드가 깨짐)

**버전 번호**: `MAJOR.MINOR` 형식.
- `MINOR` 증가 = 추가만 있는 변경(항상 안전, 자유롭게 진행)
- `MAJOR` 증가 = 위 금지 항목을 어쩔 수 없이 어겨야 하는 경우(극히 예외적이어야 함) — 이 경우 **반드시** 다음 전부를 동시에 진행: `worker.js`(Profile/PDV 핸들러 양쪽) 검토, `register-profile.html` 검토, `personal-assistant-v1.0.txt` 검토, **95개 파일 전체**의 `envelope_version` 호환성 점검(§4). 한 사람이 혼자 결정하지 않고 영향받는 소비자를 전부 나열한 체크리스트를 먼저 만든다.

**현재 버전**: Profile 봉투 `1.0`(2026-06-22, `industry_fields` 슬롯 추가로 1.0 확정). PDV 봉투는 `gopang_pdv_rules.md` 기준 이미 운영 중이며 이번 작업에서 구조 변경 없음 — 별도로 `1.0`으로 명명해 추적 시작.

---

## 3. 95개 업종·유형 스키마 파일 변경 규칙 — 개별 파일은 자유롭게, 단 추적 가능하게

**허용**: 해당 파일의 `industry_fields` 스키마는 자유롭게 갱신(필드 추가·수정·삭제 전부 가능) — 영향 범위가 그 업종 하나뿐이기 때문.

**필수 — 매 갱신 시**:
1. `schema_version` 증가(SemVer 권장: 필드 추가=minor, 필드 삭제/타입변경=major)
2. `envelope_version`을 현재 호환되는 봉투 버전으로 명시(예: `"envelope_version": "1.0"`)
3. 필드를 삭제하지 말고 `deprecated: true, deprecated_since: "1.2"` 표시만 — **이미 발급된 Profile이 그 필드를 들고 있을 수 있고, PDV 요약 텍스트가 그 필드를 참조했을 수 있어 과거 데이터 해석이 깨지면 안 됨.**

**파일 헤더 표기(권장 형식)**:
```
[공급자형 AI Agent · I56 · 음식점 및 주점업]
## 스키마
schema_id: "56"
schema_version: "1.0"
envelope_version: "1.0"
status: active   // placeholder | draft | active | deprecated | under_review
```
`status: under_review`는 Tier 3(규제산업) 파일에 사용 — 사람 검토 전까지 AI 비서가 이 스키마를 인출하지 않도록 막는 표시.

---

## 4. 호환성 점검 절차

봉투 버전이 올라갈 때마다 실행:
```bash
grep -L 'envelope_version: "1\.' prompts/AGENT-SUPPLIER-*.txt prompts/AGENT-COMMON_v1.0.txt
```
→ 안 나온(아직 옛 버전 또는 헤더 자체가 없는) 파일 목록을 받아 우선순위대로 갱신. 95개를 한 번에 다 고치지 않아도 되지만, **목록 자체는 누락 없이 뽑혀야 한다** — 이게 이 가이드라인의 핵심 안전장치다.

---

## 5. 추가 권장사항 (이번 Phase 범위는 아니지만 발견한 것)

`pdv_log` 테이블을 확인해보니 **PDV 항목 자체엔 버전 스탬프 컬럼이 없다.** Profile의 `identity._schema_version`(현재 `'2.0'`, 하드코딩값)처럼 PDV도 언젠가 봉투가 바뀌면 "이 항목은 어느 버전 규칙으로 기록됐는지"를 알아야 과거 기록을 정확히 재해석할 수 있다. 지금은 봉투가 막 `1.0`으로 확정된 시점이라 시급하지 않지만, 다음 봉투 변경 전에 `pdv_log`에 `envelope_version` 컬럼을 추가(NULL 허용, 기존 행은 비워둠 = "1.0 이전"으로 해석)하는 걸 권고한다 — 추가만 하는 안전한 변경이라 §2 규칙과도 맞다.

---

## 6. 사고실험 — 이 가이드라인 자체 재검토

1. **"95개를 한 번에 다 맞춰야 한다"는 규칙을 안 만들었다.** 호환성 점검(§4)은 "누락 목록을 뽑는 것"까지만 강제하고, 실제 갱신은 Phase 3~6의 우선순위(Tier 1/2/3)를 따르게 했다 — 그렇지 않으면 1년의 여유를 둔 베타 취지와 맞지 않는다.
2. **MAJOR 버전(파괴적 변경)을 완전히 금지하지 않고 "체크리스트를 먼저 만드는" 절차로 남겨뒀다.** 영구 금지로 못박으면, 정말 불가피한 경우(예: 보안 결함 발견)에 손발이 묶인다 — 다만 그 절차 자체를 무겁게 만들어 함부로 안 쓰게 했다.
3. **PDV 버전 스탬프 부재는 이번 Phase의 작업물이 아니라 "권장사항"으로만 남겼다.** 지금 당장 고칠 필요가 없는 걸 끼워 넣으면 Phase 2의 범위(가이드라인 문서 작성)를 벗어나 또 다른 마이그레이션 작업이 돼버린다 — 발견은 기록하고 실행은 미룬다.
