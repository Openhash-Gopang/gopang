# SP-TREE 거버넌스 매뉴얼 v1.0

> **작성일**: 2026-07-29
> **메타 매뉴얼**: [`docs/MANUAL_INDEX.md`](./MANUAL_INDEX.md)
> **관련 정본**: [`prompts/SP-TREE-REGISTRY_v1_0.md`](../prompts/SP-TREE-REGISTRY_v1_0.md) · [`prompts/SP-TREE-GUARDIAN_v1_0.md`](../prompts/SP-TREE-GUARDIAN_v1_0.md)

이 문서는 198개 이상으로 늘어난 SP(시스템 프롬프트)들이 서로를 참조·상속하는 구조("SP Tree")를 **누가, 무엇으로, 어떻게** 지키고 있는지 다룹니다. 2026-07-29 하루 동안 발견된 실제 문제(16개 파일·33건의 버전 박제, 미등록 상속 관계를 막을 장치 부재)를 계기로 신설됐습니다 — 추정이 아니라 이날 실사·수정·CI 검증까지 마친 것만 기록합니다.

---

## 1. 문제 배경 — 왜 필요했는가

SP들은 헤더에 `# 상위 상속 : A → B → C` 같은 문구로 상속 관계를 선언합니다. 이 방식엔 두 가지 구조적 약점이 있었습니다:

1. **버전 박제**: 다른 SP를 가리킬 때 `SP_lawyer_v4_2`처럼 파일명+버전을 그대로 적어 넣으면, 그 SP가 개정돼도 참조하는 쪽은 조용히 구버전을 계속 가리킵니다. 2026-07-29 감사에서 16개 파일·33건이 이 상태로 방치돼 있었습니다.
2. **임의 계층 형성**: 새 SP를 작성하며 헤더에 임의의 부모를 선언하는 것 자체를 막을 장치가 없었습니다 — 문서(prose)로 "이렇게 하지 말자"고 적어봐야, 다음에 그 문서를 안 본 사람(사람이든 LLM이든)이 똑같은 실수를 반복합니다.

## 2. 2계층 구조 — 기계적 강제(CI) + 의미론적 감사(메타 SP)

| | 계층 A — CI 가드 | 계층 B — SP-TREE-GUARDIAN |
|---|---|---|
| 판정 방식 | 결정론적(정규식·그래프) | LLM 판단(확률적) |
| 실행 시점 | 매 push/PR | 주 1회 배치 |
| 병합 차단 | 가능 | **불가능** — findings만 쌓고 사람이 검토 |
| 잡는 것 | 문법으로 판별 가능한 위반 | CI가 못 잡는 의미론적 문제(개념적 중복, 애매한 계층 위치, 패밀리 경계 위반) |

이 구분은 의도적입니다 — LLM 판단을 하드 게이트로 쓰면 오탐이 정당한 PR을 막거나, 반대로 진짜 위반을 "괜찮다"고 오판할 위험이 있습니다. CI(결정론적)만 병합을 막고, 메타 SP(확률적)는 항상 보고 전용입니다.

## 3. `prompts/SP-TREE-REGISTRY_v1_0.md` — 단일 진실 공급원

다른 SP를 가리킬 때는 이름+버전 대신 `이름(SP-TREE-REGISTRY 참조)` 형태만 씁니다. 최신 버전 자체는 `prompts/sp-catalog.json`(이름→파일명 매핑)이 담당하고, 이 문서는 "누가 누구를 상속/참조하는가"라는 **관계** 정보만 담당합니다.

핵심은 `§F. 기계 판독용 엣지 목록` — 사람이 읽는 §A~E 산문과 별도로, CI가 그대로 파싱하는 고정 포맷 블록입니다:

```
CHILD_PATTERN -> PARENT_NAME   (글롭 허용, # 주석)
ALIAS: 짧은이름 = 정식이름
```

**새 상속 관계가 필요하면 반드시 이 블록에 먼저 줄을 추가해야** 아래 CI 가드가 통과합니다 — "관습"이 아니라 "기계 강제"로 만든 지점입니다.

**적용 범위의 정직한 한계**: `sp-catalog.json`에 등록된 최상위 SP(현재 9개 + 2개 공식 패밀리 글롭)만 strict입니다. `prompts/gov-tree/` 아래 도청·시청·부서 SP는 `# 상위 상속` 헤더가 893건 있지만 표기 형식이 제각각이라 지금 소급 강제하면 오탐이 정상 작업을 막습니다 — informational(경고만, CI 통과)로 남겨뒀습니다. gov-tree 헤더 형식을 정규화하는 게 strict 전환의 선행 조건입니다.

## 4. CI 가드 2종

### 4.1 `tools/check_no_hardcoded_sp_refs.py`
등록된 모든 SP를 스캔해 다른 SP를 `이름_v버전` 형태로 직접 언급하면 실패시킵니다. 변경이력 섹션(`## 변경 이력` 등)의 과거 기록은 예외입니다.

### 4.2 `tools/check_no_undeclared_inheritance.py`
**diff 기반**입니다 — 전체 재검사가 아니라, 이번 PR/커밋에서 **새로 추가·변경된** `# 상위 상속` 선언 줄만 검사합니다(기존 gov-tree 893건은 소급 검증하지 않음). 새로 선언된 (자식, 부모) 관계가 §F edges 블록에 없으면 실패 — 새 계층을 만들려면 같은 PR 안에서 레지스트리도 함께 고쳐야만 통과합니다. 부가로 edges 블록 자체의 순환 참조(A→B→A)도 검증합니다.

두 가드 모두 `.github/workflows/check-no-hardcoded-sp-refs.yml`에서 push/PR마다 실행됩니다.

## 5. `.github/CODEOWNERS` + Ruleset — 강제 장치 자체의 보호

CI 가드가 있어도 "레지스트리에 마음대로 줄 추가하고 병합"은 여전히 가능합니다. 그래서:

- **CODEOWNERS**: `prompts/SP-TREE-REGISTRY_v1_0.md`, 두 CI 스크립트, 이 워크플로 파일 자체를 `@nounweb` 소유로 지정 — 다른 협업자가 이 파일들을 건드리면 리뷰가 강제됩니다.
- **Repository Ruleset**(`main-protection`, 2026-07-29 신설): PR 필수 + Code Owner 리뷰 필수 + 삭제/강제푸시 방지. **알려진 한계**: CODEOWNERS 지정자가 PR 작성자 본인뿐이면 GitHub가 "리뷰해줄 다른 사람 없음"으로 요구조건을 스킵합니다 — 1인 개발 체제에서는 "타인이 못 건드리게"는 막지만 "본인 PR엔 무효"라는 현실적 한계가 있습니다.
- Required status checks는 **의도적으로 걸지 않았습니다** — 오늘 만든 체크들은 전부 `paths:` 필터가 있어서, 그 경로를 안 건드리는 PR은 체크가 영영 안 돌아 "대기 중"에 영원히 막히는 GitHub의 알려진 함정이 있기 때문입니다.

## 6. `prompts/SP-TREE-GUARDIAN_v1_0.md` — 주간 의미론적 감사

CI가 구조적으로 못 잡는 것(이름은 다른데 개념이 겹치는 SP, 계층상 위치가 애매한 신규 SP, 패밀리 경계 위반, §A~E 산문과 §F edges 블록의 불일치)을 찾습니다. §0에 명시된 절대 원칙: **findings는 `sp_tree_audit_findings`에 `pending_review`로만 쌓이고, 이 SP도 worker.js 구현체도 어떤 파일을 직접 수정하지 않습니다.**

### 실행 경로
```
.github/workflows/sp-tree-guardian.yml (매주 월요일 09:00 KST, cron)
  → tools/sp_tree_guardian_trigger.py (트리거만 함, 판단 없음)
    → POST /sp-tree-guardian/audit (worker.js)
      → _runSpTreeGuardianAudit()
        1. GitHub compare API로 지난 감사 이후 prompts/** diff만 수집
           (첫 실행이면 최근 7일 lookback)
        2. SP-TREE-GUARDIAN 프롬프트를 manifest 경유로 fetch(임베딩 아님)
        3. deepseek-v4-flash로 감사 — 산출물은 JSON 배열
           [{file, issue, proposed_change, confidence, needs_special_review}]
        4. sp_tree_guardian_runs(실행 기록, base/head sha)와
           sp_tree_audit_findings(개별 finding)에 저장
        5. findings 있으면 기존 escalations 큐에도 알림
```

### PocketBase 컬렉션 (`pb_migrations/1786900012·13_*.js`)
`escalations`와 동일한 관례(native relation 미사용, ref는 일반 text 필드)로 신설했습니다. `confidence`·`status`는 `select` 타입으로 화이트리스트 강제되며, `status`의 초기값은 항상 `pending_review`입니다 — 사람이 검토해서 바꾸기 전엔 자동으로 `accepted`가 될 수 없습니다.

### 확인 방법
```bash
GET /sp-tree-guardian/findings?status=pending_review
```
또는 hanlim 서버에서 직접:
```bash
sqlite3 /opt/gopang/pb/hanlim/data.db \
  "SELECT file, issue, confidence FROM sp_tree_audit_findings WHERE status='pending_review';"
```

## 7. 2026-07-29 감사에서 실제로 고친 것 (참고 기록)

- 하드코딩된 SP 상호참조 16개 파일·33건 → `이름(SP-TREE-REGISTRY 참조)`로 수정
- `check_expert_table_sync.py`/`check_service_table_sync.py`가 폐기된 `AGENT-COMMON` 키를 찾다 매번 실패하던 것을 `AC-PRO-CORE` 기준 v2로 전환(표 구조 파싱 대신 "텍스트 어디든 등장하는가"로 완화 — 향후 리라이트에도 안 깨짐)
- `ops/apply-pb-migrations.sh`가 서버에만 존재하고 저장소엔 한 번도 커밋되지 않았던 드리프트 발견·동기화, 헬스체크 타이밍 실패를 재시도 루프로 수정

## 8. 알려진 미해결 사항

- **`check_no_embedded_sp.py`(worker.js 부근)**: 검사 스크립트 자체의 백틱 짝짓기 정규식이 파일 반대편의 무관한 백틱과 잘못 짝지어져 거대한 가짜 리터럴을 만들어내는 버그로 진단됨. 근본 원인(어디서 백틱이 홀수로 어긋나는지) 추적은 이번 범위 밖 — 후속 세션 과제.
- **gov-tree 893건**: 헤더 형식 정규화가 §3(strict 전환)의 선행 조건.

---

## 변경 이력

- v1.0 (2026-07-29): 신설.
