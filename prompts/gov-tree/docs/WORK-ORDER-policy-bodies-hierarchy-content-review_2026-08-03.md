# 작업 지시서 — 중앙정부 policy-bodies SP 상하위 계층 점검 및 내용 검토

**작성일**: 2026-08-03 | **작성자**: Claude(직전 세션) | **대상**: 다음 세션(중앙정부 SP 담당)

## 0. 시작하기 전에 — 저장소 접근

```bash
git clone --depth 1 https://github.com/Openhash-Gopang/gopang.git
```

이 지시서는 매 작업 배치마다 **①실제 파일 직접 클론·확인 → ②작업 → ③검증 스크립트 → ④커밋 → ⑤git format-patch로 패치 전달 → ⑥사용자가 PowerShell로 적용**하는 기존 워크플로를 그대로 따른다는 전제로 작성됐다. 절대 파일 내용을 추측하지 말고 매번 직접 열어서 확인할 것 — 이번 세션에서 그렇게 하지 않아 두 번 이상 오류를 냈다(§6 참고).

**범위 경계**: 이 세션은 **중앙정부 부처·청·위원회(policy-bodies) 및 그 산하기관**만 다룬다. 제주 지역 공공기관 SP·배선은 별도 세션이 병행 중이므로 건드리지 않는다.

---

## 1. 지금까지 완료된 것 (전제 지식)

### 1.1 콘텐츠 — §LEGAL-BASIS 보강 (완료)
`prompts/gov-tree/09-national/policy-bodies/SP-NAT-POLICY-*.md` **70개 전량**에 `§LEGAL-BASIS` 섹션(설치 근거법령·관장사무 원문)을 신설했다. law.go.kr 원문 직접 접근이 안 되는 환경이라 2차 출처 교차검증 방식으로 진행했다.

### 1.2 배선 — K-Search 기반 엔티티 launch (완료, 실사 검증 일부 남음)
- 다른 세션(#195, jejuro 공동작업)이 `profiles` 컬렉션 + K-Search + `[GWP: {guid}]` 방식으로 라우팅을 구현(제가 처음 시도했던 `gwp_registry` 테이블 방식은 폐기됨 — 더 나은 설계가 이미 있었음).
- `gov-router.js`의 `assembleGovSystemPrompt(...)`에 `directCode`(형식: `"policy:{CODE}"`) 5번째 인자가 추가돼, K-Search가 기관을 특정하면 텍스트 추측 없이 바로 해당 SP를 로드한다.
- `tools/seed_gov_tree_registry.py --apply` 실행 완료 — **70/70 성공**, 전부 `unclaimed_` guid로 K-Search 프로필 등록됨(로그: `docs/GOV-TREE-REGISTRY-SEEDING-RUN_2026-08-03.md`).
- **미확인 남음**: 실제 브라우저에서 `[GWP: {guid}]` → 새 탭이 정말 열리는지, `/profile?guid=` 응답이 비소유자에게도 institution 정보를 정상 노출하는지 — `APPLY_INSTRUCTIONS_entity_launch_20260803.md` 참조.

### 1.3 참고 문서
- `prompts/gov-tree/docs/POLICY-BODIES-LEGAL-BASIS-STATUS_2026-08-02.md` — 조항번호 재검증 대기 24개, verbatim 미확인 7개, 명칭변경 대기 3개(여성가족부→성평등가족부 대기, 산업통상자원부→산업통상부 확정, 검찰청→공소청/중대범죄수사청 2026-10-02) 등 상세 목록.

---

## 2. 이번 작업 — 두 갈래

### 2.1 상하위 계층 구조 점검

**확인할 것**: 각 policy-bodies SP가 선언한 상속 체인이 실제로 맞는지.

모든 파일이 헤더에 다음과 같이 선언돼 있다:
```
# 상위 상속  : kgov(SP-10_kpublic)+UNIVERSAL-common > JEJU-NATIONAL-SP (필수 선행 삽입)
```

체크리스트:
- [ ] 70개 전부가 이 선언을 동일하게 갖고 있는가, 아니면 개별 사정으로 달라야 하는 곳이 있는가(예: 헌법기관 CONSTCOURT/SUPREMECOURT/ASSEMBLY/NEC/BAI/NIS처럼 행정부 소속이 아닌 곳도 정말 `kgov` 상속이 맞는가? — 사법부·입법부·독립기관이 "K-Public(행정부 공통 규칙)"을 그대로 상속하는 게 개념적으로 맞는지 검토 필요. `prompts/SP-TREE-REGISTRY_v1_0.md` §B의 "K-Public 정부기관 계열" 다이어그램은 이미 "사법부: 대법원 대변 AI·헌법재판소 대변 AI"를 K-Public과 별도 하위줄기로 그려뒀다 — 실제 파일들이 이 구조를 반영하는지 대조.)
- [ ] 실제 조립 시점(`_loadNationalSp()`, `gov-router.js`)에서 이 선언대로 정말 삽입되는가 — 선언은 문서 주석일 뿐 코드가 강제하는 게 아니므로 실제 동작과 어긋날 수 있다.
- [ ] `tools/check_sp_inheritance.py`의 `FAMILIES` 딕셔너리에 policy-bodies가 **등록돼 있지 않다** — 필요하면 새 family로 등록해 CI가 기계적으로 검증하게 만들 것(다른 두 예시인 `AGENT-SUPPLIER`, `SP-INDUSTRY-TRANSFORM` 항목의 형식을 참고).
- [ ] `prompts/SP-TREE-REGISTRY_v1_0.md`에 policy-bodies 70개 전체를 아우르는 항목이 없다 — §B 또는 §C에 한 줄 추가할지 검토(문서 자체가 "새 상속/참조 관계가 생기면 이 문서에 추가"라고 명시하고 있음).
- [ ] 6차 배치에서 만든 `agencies/templates/`(34개 지역사무소형)와 policy-bodies(70개, 본청)의 관계도 점검 대상 — 같은 기관이 두 계층에 동시에 존재하는 경우(예: 국세청/관세청/경찰청/병무청 등)의 상속 관계가 명확히 문서화돼 있는지 확인.

### 2.2 SP 내용 적절성 검토

**확인할 것**: 각 SP의 §1(정체성)·§CAPABILITIES·§INPUT/OUTPUT 등 본문 내용이 그 기관의 실제 역할과 일치하는지, 명백한 오류·과장·누락이 없는지.

이번 세션에서 실제로 발견했던 오류 유형(같은 패턴이 더 있을 가능성):
- **존재하지 않는 법률명 인용**: 해양경찰청 SP에 "해양경찰법"(실재하지 않음) 기재돼 있었음
- **설치 근거와 정책법의 혼동**: 재외동포청 SP가 「재외동포기본법」(정책 내용 규율법)을 설치 근거로 잘못 기재
- **구 부처명 잔존**: 국세청·관세청 SP가 "재정경제부"(2008년 폐지)를 소속으로 기재
- **§LEGAL-BASIS와 본문 텍스트의 불일치**: MOGEF·MOTIE에서, 실제로는 이미 신명칭(성평등가족부/산업통상부)을 쓰고 있었는데 §LEGAL-BASIS 작성 당시 "구명칭 유지 중"이라고 잘못 서술했던 사례 — **§LEGAL-BASIS를 새로 추가한 파일은 전부 본문과 실제로 일치하는지 재확인 권장**.

체크리스트(파일당):
- [ ] §1의 기관 설명이 §LEGAL-BASIS의 관장사무와 실제로 부합하는가
- [ ] §CAPABILITIES/§2(완결 처리 업무)에 나열된 업무가 그 기관의 실제 소관과 맞는가(다른 기관 업무를 잘못 끌어온 사례 없는지)
- [ ] 인용된 법률명·조항이 실재하는가(§LEGAL-BASIS 보강 때 확인 못 한 부분이 본문 다른 곳에 남아있을 수 있음)
- [ ] 대안 채널(§5) 링크·연락처가 살아있는 정보인지(도메인명 등 — 예: MOTIE SP에 "motir.go.kr — 도메인이 부처명 약칭과 다름 주의"라는 메모가 이미 있음, 이런 게 정확한지 재확인)
- [ ] `check_no_hardcoded_sp_refs.py`·`check_stale_refs.py`로 걸러지지 않는 종류의 오류(사실관계 오류)는 사람/LLM이 직접 읽어야만 잡힌다 — 자동검증 통과가 내용 정확성을 보장하지 않는다는 점 유의.

**우선순위 제안**: 70개를 한 번에 다 검토하기보다, §LEGAL-BASIS 재검증 대기 상태였던 것들(정부조직법 조항번호 불안정 24개, verbatim 미확인 7개 — §1.3의 문서 참조)부터 우선 검토하면 효율적이다. 이미 "불확실하다"고 표시해 둔 곳들이라 문제가 있을 확률이 상대적으로 높다.

---

## 3. 작업 방식 — 배치 규모 제안

이번 세션 경험상 **7~10개 파일 단위 배치**가 안전하고 효율적이었다(한 배치 리서치→수정→검증→커밋→패치 생성까지 한 흐름으로 처리 가능한 규모). 70개 전부를 한 번에 처리하려 하지 말 것.

## 4. 검증 순서 (매 배치 공통)

```bash
# 1. 헤딩 레벨 이상(#####+) 없는지
python3 -c "
import re, glob
for f in glob.glob('prompts/gov-tree/09-national/policy-bodies/SP-NAT-POLICY-*.md'):
    with open(f, encoding='utf-8') as fh:
        c = fh.read()
    bad = re.findall(r'^#{5,}.*', c, re.M)
    if bad: print(f, bad)
"

# 2. 저장소 자체 검증 스크립트
python3 tools/check_no_undeclared_inheritance.py
python3 tools/check_no_hardcoded_sp_refs.py
python3 tools/check_stale_refs.py

# 3. (2.1 작업 시) 상속 체크에 새 family 등록했다면
python3 tools/check_sp_inheritance.py

# 4. (내용 수정이 K-Search 시딩에 영향을 준다면) 시딩 게이트 재확인
python3 tools/seed_gov_tree_registry.py   # dry-run, active/pending_review 개수 확인
```

## 5. git 워크플로 (기존 관례)

```powershell
# 사용자 측 적용 순서 — Claude가 만든 패치를 받으면 매번:
cd C:\Users\주피터\Downloads\gopang
git checkout main
git pull origin main
git am "C:\Users\주피터\Downloads\{패치파일명}.patch"
git push origin main
```

- `git am` 실패("Stray .git/rebase-apply") 시 → `git am --abort` 후 재시도
- 항상 어느 브랜치에 있는지(`git status`) 먼저 확인 후 진행 — 이번 세션에서 다른 브랜치에 있는 줄 모르고 커밋해서 main에 안 올라간 사고가 여러 번 있었다
- push 후에는 **반드시 fresh clone으로 원격 main을 직접 재확인**할 것 — "성공했다고 보고됐지만 실제로는 다른 브랜치였다"는 패턴이 이번 세션에 반복됐다

## 6. 이번 세션에서 반복됐던 실수 (교훈)

1. **확인 없이 어설션하지 말 것** — MOGEF/MOTIE의 문서명을 확인 안 하고 "구명칭 유지 중"이라고 썼다가 나중에 이미 신명칭이었음을 발견. 항상 실제 파일을 먼저 열어볼 것.
2. **정규식/키워드 매칭에 의존하지 말고 의미(intent) 기반으로 설계할 것** — 초기에 gov-router.js에 정규식 기반 배선을 만들었다가 "사용자 의도 파악이 우선이지 단어 매칭이 우선이 아니다"라는 지적을 받고 전면 재설계했다. 새 기능을 설계할 때 이 원칙을 먼저 적용할 것.
3. **다른 세션과의 동시 작업 충돌 가능성을 항상 염두에 둘 것** — 이번 세션 도중 다른 세션이 같은 파일(`gov-router.js`, `call-ai.js`)을 건드려 제 작업 일부가 통째로 중복/폐기됐다. 큰 구조 변경 전에는 항상 `git log --oneline -10`으로 최근 커밋을 확인해 겹치는 작업이 없는지부터 볼 것.
4. **정부조직법 조항번호는 여전히 불안정하다** — 2025-10-01, 2026-01-02 두 차례 개편 이후에도 추가 개편(여성가족부→성평등가족부 시행령, 검찰청 폐지 2026-10-02 등)이 진행형이다. 조항번호를 다시 확정하려 하지 말고, 확실하지 않으면 "재검증 대기"로 정직하게 남겨둘 것.

---

*이 문서는 새 대화창에서 이어서 작업할 때 그대로 붙여넣어 컨텍스트로 사용할 수 있도록 작성됐다.*
