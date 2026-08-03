# 적용 안내 — entity_launch_20260803 패치

## 2026-08-03 추가 — §1 제1원칙 코드 강제

주피터 지시("모든 사용자는 SP다")를 반영해 아래 2개 파일이 더 바뀌었습니다:

- `prompts/AC-PRO-CORE_v1_0.txt` — §0 바로 뒤에 **§1. 제1원칙** 신설.
  모든 개체(사람/기관/사물/개념)는 SP가 할당된 guid이고, 호출은 곧 그
  SP 호출이라는 원칙을 명문화.
- `gwp-registry.js`의 `_resolveEntityGwp()` — institution/org 엔티티는
  이제 **절대 null을 반환하지 않습니다**. 전용 SP(entity_subtype)가
  있으면 그걸로, 없으면 kgov(범용 창구, 이미 core 레지스트리에 존재)로
  자동 낙착시킵니다 — "전담 SP가 없어 호출 실패"가 코드 차원에서
  불가능해집니다. person/business/thing/concept은 아직 기본값 매핑이
  없어 정직하게 null(후속 과제로 남김) — 없는 매핑을 지어내지
  않았습니다.
- `prompts/SP-18_ksearch_v1.4.txt` — institution 엔티티는 이제 예외
  없이 `[GWP: {guid}]`로 launch(기존의 "전담 SP 없으면 OPEN_PROFILE"
  예외 조항 삭제).

## 무엇을 바꾸는가
1. `gwp-registry.js` — `getService()` 옆에 `_resolveEntityGwp(guid)` 신설.
   core 21개에 없는 id를 profiles 엔티티 guid로 보고 조회, institution/org
   이고 `entity_subtype`(예: `policy:ASSEMBLY`)이 있으면 launch 가능한
   svcDef를 즉석 생성.
2. `src/gopang/ai/call-ai.js` — `_parseAgentTags`의 "알 수 없는 서비스 ID"
   분기에 위 함수를 비동기로 호출하는 폴백 추가(기존 탭은 결과 나올 때까지
   유지, 실패 시에만 닫음).
3. `src/gopang/gov/gov-router.js` — `assembleGovSystemPrompt`/
   `_assembleGovSystemPromptRaw`에 5번째 인자 `directCode` 추가. `"policy:{CODE}"`
   형식이면 텍스트 추측을 건너뛰고 `resolvePolicyBodyLazy(code)`를 바로 호출.
   (다른 5개 티어는 이번엔 미연결 — 조용히 폴백, 회귀 없음)
4. `pages/regional-gov.html` — URL의 `gov_code` 파라미터를 첫 턴에만
   `assembleGovSystemPrompt`의 `directCode`로 전달.
5. `prompts/SP-18_ksearch_v1.4.txt` — K-Search가 institution 엔티티를
   찾았을 때 `[OPEN_PROFILE]` 대신 `[GWP: {guid}]`로 직접 새 탭 launch하도록
   안내 추가(§AGENT-COMMON 반영 제안 섹션).
6. `tools/seed_gov_tree_registry.py` — 정책기관 70개(`09-national/
   policy-bodies/SP-NAT-POLICY-*_v1.1.md` 실파일 기준)를 institution
   프로필로 등록하는 1회성 스크립트. dry-run 기본값.

## 적용 순서 (PowerShell)

```powershell
cd C:\Users\주피터\Downloads\gopang
git pull origin main --rebase

# 이 zip을 리포 루트에 압축 해제(같은 경로 파일은 덮어씀)
Expand-Archive "$HOME\Downloads\entity_launch_20260803.zip" -DestinationPath . -Force

git status
git add gwp-registry.js src/gopang/ai/call-ai.js src/gopang/gov/gov-router.js pages/regional-gov.html prompts/SP-18_ksearch_v1.4.txt prompts/AC-PRO-CORE_v1_0.txt tools/seed_gov_tree_registry.py
git commit -m "feat(entity-launch): 모든 사용자는 SP다(제1원칙) 코드 강제 + K-Search 발견 기관 [GWP: guid] 직접 launch (정책기관 70개 1차 연결)"

# gov-router.js/call-ai.js는 다른 기여자가 자주 건드리는 파일이라
# 브랜치+PR로 진행 권장(직접 main push 대신):
git checkout -b feat/entity-launch-gov-search
git push origin feat/entity-launch-gov-search
gh pr create --base main --fill
gh pr merge --auto --squash
git checkout main
git pull origin main --rebase
```

## 시딩 스크립트 실행 (선택 — 위 코드 패치가 배포된 뒤에)

```powershell
cd C:\Users\주피터\Downloads\gopang
python tools\seed_gov_tree_registry.py
# ↑ 먼저 dry-run으로 46 active / 24 pending_review 미리보기 확인
python tools\seed_gov_tree_registry.py --apply
# 결과 로그: docs\GOV-TREE-REGISTRY-SEEDING-RUN_2026-08-03.md
```

## 확인된 사실 / 남은 제약 (정직하게 표시)

- `profiles` 스키마 변경 없음 — 기존 `entity_subtype` 필드를
  `"{tier}:{code}"` 계약으로 재사용(worker.js 미수정).
- `GET /profile?guid=` 응답에서 `extra.public.identity`가 비소유자
  요청에도 그대로 노출되는지는 `_filterProfileByVisibility()` 전체
  본문을 이번 세션에서 끝까지 확인하지 못했다 — institution 프로필은
  공개 정보라 문제 없을 가능성이 높지만, 배포 후 실제 새 탭이 열리는지
  1건은 반드시 실사 확인 필요.
- directCode는 tier='policy'(70개)만 연결됨. do-dept/city-dept/
  do-agency/org/nat-agency 5개 티어는 각 lazy resolver가 추가 인자
  (province/city 등)를 요구해 이번 범위 밖 — 후속 패치 필요.
- 정책기관 70개 중 24개는 원본 SP `§LEGAL-BASIS`의 "관장사무" 서술이
  짧거나 없어 `pending_review`로 시딩(검색에 안 걸림, §GOV-TREE-
  REGISTRY-SEEDING_v1_0.md §3.3 게이트 원칙과 동일) — 46개만 즉시
  active.
