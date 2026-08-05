# HANDOFF_2026-08-05_orchestration-integration-followup.md
## 중앙+지방 오케스트레이션 통합 세션 — 후속 인수인계

작성일: 2026-08-05 | 선행 문서: HANDOFF_2026-08-05_orchestration-orgprofiles-govtree.md
(§4의 다음 작업 지시를 이어받아 진행) · docs/ORG_PROFILES_GOVTREE_
RECONCILIATION_v1_0.md

## 이 문서를 받았다면

주피터님이 이 문서를 새 대화창에 올리고 "이어서 진행하십시오"라고
하면, §3(남은 작업)부터 바로 진행하면 됩니다. 이 세션의 역할 구분은
"중앙정부 기능과 지방정부 기능의 통합(오케스트레이션 레이어)"이었습니다
— 순수 중앙부처 SP 작업이나 순수 제주/지방 gov-tree 실사는 다른
세션이 맡습니다(메모리 노트 2026-08-05 갱신분 참고).

---

## 1. 이번 세션에 한 일 (완료·커밋됨, 아직 push 전 — §2 참고)

브랜치: `fix/govtree-tbd-literal-fallback` (origin/main `794fb71` 기준
분기, 커밋 4개)

### 1-1. EMD team 콜센터번호 + 무인발급기위치 TBD 리터럴 폴백 버그 수정
(선행 핸드오프 §4-1 대상 + 추가 발견)

`_renderTeamTemplate()`/`_renderEmdTemplate()`의 `rec.field ||
'TBD — 재검증 필요'` 폴백이 falsy만 걸러내 리터럴 문자열 `"TBD"`(179/184
team 레코드)는 못 걸렀던 버그를 공용 헬퍼 `_fallbackIfTbd()`로 수정.
선행 핸드오프 §3-5 권고대로 다른 필드도 의심해 실측한 결과,
`emd-master-data.json`의 `무인발급기위치` 필드도 **42개 레코드 전부**
같은 버그였음을 추가 발견 — 함께 수정. gov-router.js 내 `|| 'TBD'`
폴백 패턴 8곳 전수 확인·통일. 회귀 테스트 3건 신설(애월읍 총무팀
사례로 검증). 커밋: `32af115`.

### 1-2. org_profiles↔gov-tree 재조정을 반복 가능한 루틴으로 신설
(선행 핸드오프 §4-4 대상)

`tools/reconcile_org_profiles_govtree.mjs` — 선행 세션이 손으로 한 번
돌렸던 28건 조정(§2-3 알고리즘: org_name을 도이름+시이름/도이름
단독으로 공백 제거 후 완전일치 대조, gov-tree 쪽 스텁 여부는
`행정구역구성_문구`의 "정식 확인 중" 마커로 판별)을 재사용 가능한
모듈+CLI로 재구현. `reconcile()`이 REAL/STUB/미매칭 3분류를 반환,
`--emit-migration`으로 검토용 pb_migration 초안을 생성한다(자동 적용
안 함 — 사람이 검토 후 배포).

**검증**: `pb_migrations/1786400001`(org_profiles 시딩 1/12, 376건)에
기존 28건이 전부 포함돼 있음을 직접 대조로 확인 — 이 스크립트가 그
376건을 입력으로 REAL 28 / STUB 184 / 미매칭 34를 정확히 재현하고,
28건의 `gov_tree_ref` 값이 `1786500002`와 1:1 일치함을 회귀 테스트로
확인(`src/tests/reconcile-org-profiles-govtree.test.mjs`). 커밋:
`19d075a`.

**PocketBase 라이브 접근 불가라는 반복된 제약**(선행 핸드오프 §4-2와
동일)으로, 이 스크립트는 PocketBase에 직접 붙지 않는다 — org_profiles
admin_local을 export한 JSON 파일을 `--input`으로 받는 구조다. 실제
export 방법(PocketBase Admin UI → Collections → org_profiles → Export)
은 스크립트 상단 주석에 적어뒀다.

### 1-3. AC-PRO-CORE §ORCHESTRATION에 정부서비스 처리 5단계 모델 명문화
(선행 핸드오프 §4-3 대상, `docs/ORG_PROFILES_GOVTREE_RECONCILIATION_
v1_0.md` §1에서 시작된 논의의 원래 목적)

주피터님이 제안한 5단계(① 정부서비스 판별 → ② 입법/사법/행정·중앙/
지방 조합 판단 → ③ 오케스트레이션 계획 수립·임무 할당 → ④ 각 기관
응답 취합·최종 결과 전달 → ⑤ PDV 기록)를 §ORCHESTRATION 절 서두에
명문화. 결론(선행 세션과 동일): **AC가 새로 판단할 게 늘지 않았다** —
①③④⑤는 이미 K-Intent/K-Compose/K-Execute/K-Deliver/K-Report에
구현돼 있었고, 유일한 진짜 공백이던 ②(입법/사법/행정 조합 판단)도
`org_profiles.branch` + `resolution_strategy=gov_tree_delegate`
스키마 확장(선행 세션이 이미 구현)만으로 새 SP 없이 메워져 있었다.
이번 커밋은 그 사실을 프롬프트에 명문화해 다음 세션들이 §CORE ②의
이분법(§CATALOG 표 안/밖)만으로 충분하다는 걸 오해 없이 알게 하는
문서 작업이다. 섹션 헤더 구조 무결성 확인 완료. 커밋: `b96feba`.

### 1-4. 설계 문서 갱신
`docs/ORG_PROFILES_GOVTREE_RECONCILIATION_v1_0.md` §7 "다음 세션
우선순위"에서 2번(184건 처리)·4번(§CORE 5단계 재구성) 항목을 완료로
표시하고 위 커밋들로 역참조. 커밋: `a709835`.

### 검증 상태
매 커밋마다 `node --test src/tests/*.mjs` 실행 — 203건 중 199 pass
(기존 4건 pre-existing 실패와 `git stash` 대조로 동일함을 최초 커밋
시점에 확인, 이후 커밋은 회귀 없이 같은 4건만 유지됨).

---

## 2. ★ 아직 안 한 것 — patch 전달·push

**이번 세션은 §0 작업 방식대로 커밋까지는 했지만, patch 생성·별도
클론 `git am` 검증·전달까지 아직 마치지 못했다.** 다음 세션(또는 이
문서를 받은 주피터님)이 이어서 할 것:

```bash
cd <이 세션의 gopang 클론>
git fetch origin
git log origin/main --oneline -3   # 이 세션 작업 중 origin/main이
                                     # 또 앞서 있었는지 먼저 확인
git format-patch origin/main..fix/govtree-tbd-literal-fallback -o /tmp/patches
# 별도 클론에 미리 git am 검증
git clone https://github.com/Openhash-Gopang/gopang.git /tmp/verify-clone
cd /tmp/verify-clone && git am /tmp/patches/*.patch && node --test src/tests/*.mjs
```

문제 없으면 주피터님께 patch 4개(커밋 4개 = patch 4개) 전달. 적용
안내는 조직 표준 절차 그대로:

```powershell
git pull origin main   # 또는 git fetch origin
$patches = Get-ChildItem "$HOME\Downloads\*.patch" | Sort-Object Name
git am $patches.FullName
git push origin HEAD:main
```

`git push` 거부되면 `git pull` 재실행 후 재시도(`--force` 금지).

---

## 3. 남은 작업 (우선순위 순)

### 3-1. §4-2 미검증 항목 실환경 확인 (여전히 미해결, 선행 핸드오프와 동일)
- 두 마이그레이션(`1786500001`/`1786500002`)의 실제 PocketBase 적용
- `worker.js`의 `gov-router.js` import가 Cloudflare Workers 배포에서
  정상 번들링되는지(로컬 `node --check` 문법 검사만 통과한 상태 —
  이번 세션에서도 재확인함, 변경 없음)
- `handleGovTreeStepExecute`의 실제 Anthropic API 호출 경로
이 세션도 라이브 접근이 없어 배포 후 사람이 직접 확인해야 함(누적
2회째 같은 제약).

### 3-2. 34건(미매칭) 처리 방침 결정
`tools/reconcile_org_profiles_govtree.mjs --verbose`로 목록 확인 가능.
gov-tree 확장 대상 후보로 쓸지, 다른 방침으로 갈지 주피터님 결정 필요.

### 3-3. 재조정 스크립트 자동 트리거화 검토
지금은 사람이 수동으로 `tools/reconcile_org_profiles_govtree.mjs`를
돌려야 한다. gov-tree 실사 완료 커밋마다 자동 재계산하는 CI 훅 등을
만들지는 아직 미결정(§7 문서에 "아직 안 만들었음"으로 명시해둠).

### 3-4. 선행 핸드오프 §4-5(확인 필요 항목) — 이번 세션은 손 못 댐
- `feat/gov-tree-pb-migration` 브랜치(주피터님 로컬에만 있는 것으로
  추정) — 여전히 확인 필요
- `docs/govtree-lessons-manual-v2` 브랜치의 `d542a10d` 커밋(HANDOFF_
  2026-08-04_gov-tree-busan-cityDept.md)이 여전히 main에 없는지 재확인
  필요(이번 세션은 origin/main을 다시 확인하지 않았음 — 다음 세션이
  `git show origin/main:docs/HANDOFF_2026-08-04_gov-tree-busan-
  cityDept.md`로 재확인할 것)
- `SP-COMMON-02 v3.20` 중복 커밋 원인 — 여전히 미확인. 참고로 이번
  세션 중 origin/main에 `v3.21`(dc054d4)이 이미 반영돼 있는 걸 확인함
  (jejuro 커밋) — v3.20 중복 자체가 그 이후 버전업으로 덮였을 가능성도
  있음, 그래도 원인 규명은 별개 과제로 남음.

---

## 4. 이번 세션이 지킨 것 / 확인한 것

- `git fetch origin` → 새 브랜치는 `794fb71`(jejuro의 professor/advisor
  커밋) 기준으로 분기 — 이번 세션 작업 중 origin/main이 그 뒤로 더
  앞서지는 않은 것으로 보임(마지막 fetch가 커밋 시점들보다 이르므로
  §2의 patch 생성 직전 재확인 필요).
- 매 커밋 전 `git status`로 untracked 파일 확인, `git config
  user.name/user.email` 최초 1회 설정(세션 초기화 직후 identity
  unknown 오류 발생 — 다음 세션도 같은 문제 겪을 수 있음, 첫 커밋
  전에 미리 설정해두면 좋음).
- 코드 변경 3건 전부 회귀 테스트 동반, 문서 변경 2건 전부 저장소
  관행(docs/*.md 갱신)을 따름.

---

## 5. 참고 파일 목록

- `src/gopang/gov/gov-router.js` — `_fallbackIfTbd()`(신설),
  `_renderTeamTemplate()`/`_renderEmdTemplate()`(수정)
- `src/tests/govtree-tbd-literal-fallback.test.mjs` — TBD 리터럴 회귀
  테스트 3건
- `tools/reconcile_org_profiles_govtree.mjs` — 재조정 반복 루틴(신설)
- `src/tests/reconcile-org-profiles-govtree.test.mjs` — 재조정 알고리즘
  회귀 테스트 3건
- `prompts/AC-PRO-CORE_v1_0.txt` — §ORCHESTRATION 5단계 모델 명문화
  (2026-08-05 신설 블록)
- `docs/ORG_PROFILES_GOVTREE_RECONCILIATION_v1_0.md` — §7 갱신(2·4번
  완료 표시)
- `pb_migrations/1786400001_seeded_benefit_catalog_orgs_full.js` — 재조정
  스크립트 회귀 테스트의 실데이터 fixture로 활용(org_profiles 시딩
  1/12, 376건)

---

## 6. 2026-08-05 추가 세션 — §3-2·§4-5 결정 사항 기록

### 6-1. `d542a10d`(HANDOFF_2026-08-04_gov-tree-busan-cityDept.md) 머지 여부 — 머지 안 함
`docs/govtree-lessons-manual-v2` 브랜치의 마지막 커밋(`d542a10d`, 다른
세션/작성자 Do Young Min)이 main에 없는 상태가 계속 지적돼왔는데, 내용을
직접 확인한 결과 **머지하지 않기로 결정**. 이유: 그 문서의 §4(다음 작업
지시)가 "부산 16개 구·군 중 해운대구 제외 15개 city-dept 미착수"라고
적었는데, 실제로는 이미 그 시점 이후 진행된 작업(`75af899` 등)으로
15/16개 구·군의 jachi 도메인이 채워져 있었다(기장군만 의도적 TBD 예외).
main에 이미 있는 `docs/GOV_TREE_ABSTRACTION_LAYER_STATUS_v1_0.md`가 이
정확한 최신 상태를 담고 있으므로, 낡은 스냅샷을 머지해 혼동을 더하기보다
그대로 브랜치에만 남겨두는 쪽을 택함. 브랜치 자체를 삭제할지는 원 작성자
또는 주피터 판단 필요(이번 세션은 손대지 않음).

### 6-2. 34건(미매칭) 처리 방침 — 결정·구현 완료
`docs/ORG_PROFILES_GOVTREE_RECONCILIATION_v1_0.md` §7-3에 상세 기록.
요약: 34건 = 강원도 관련 18건(gov-tree 확장 대상으로 유지) + 교육청 16건
(gov-tree 대상에서 제외, 별도 트랙 필요 — 방법은 미결정).
`tools/reconcile_org_profiles_govtree.mjs`가 이 두 카테고리를
`unmatched`/`unmatched_out_of_scope`로 분리 반환하도록 수정, 회귀
테스트 1건 추가.

### 6-3. 다음 세션 남은 것
- 교육청 16건의 실제 서비스 방법(§7-3 마지막 문단) — 미결정
- 강원도 18건의 gov-tree 실사 자체(도청·시군 조직도 확보) — 미착수
- `docs/govtree-lessons-manual-v2` 브랜치 정리 여부 — 미결정
