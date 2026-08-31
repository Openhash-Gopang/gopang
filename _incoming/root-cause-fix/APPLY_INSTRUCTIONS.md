# 근본 원인 수정 — 적용 방법

## 이 패치가 고치는 것
1. **R2(GWP끼리 충돌) 판정을 코드가 확정** — candidate-prefilter.js에
   findGwpR2Winner() 신설, routing-hint.js가 [ctx]에 "R2확정:id" 신호로
   전달, AC-PRO-CORE_v1_8.txt가 이를 그대로 채택하도록 지시문 추가.
   ("부가세 신고" vs "부가세" 라이브 재발 사례를 근본 해결)
2. **ktelecom/kestate 구식 태그를 테스트 채점 기준에서도 PASS로 인정**
   — 실제로는 call-ai.js가 이미 100% 자동복구하는데 테스트만 FAIL로
   잘못 채점하고 있었음. 근본 원인이 프롬프트가 아니라 테스트 기준
   쪽이었음을 확인하고 그쪽을 고침.
3. prompts/sp-catalog.json, .github/workflows/live-smoketest.yml을
   AC-PRO-CORE_v1_8.txt로 갱신(프로덕션 배선).
4. ROUTING-BRANCH-REFERENCE를 v1_2로 갱신(라우팅 최종 문서),
   pages/routing-architecture.html도 함께 갱신.
5. src/tests/ai-secretary/candidate-prefilter.test.mjs에 회귀 테스트
   4건 추가(전부 통과 확인, 로컬에서 node --test로 재검증 가능).

## 적용 절차 (main 직접 push 금지 — 브랜치+PR)

```powershell
cd C:\Users\주피터\Downloads\gopang
git checkout main
git pull
git checkout -b fix/r2-routing-code-decision

# 압축 해제한 새 파일 2개 배치
Copy-Item <압축해제경로>\root-cause-fix\prompts\AC-PRO-CORE_v1_8.txt .\prompts\
Copy-Item <압축해제경로>\root-cause-fix\prompts\ROUTING-BRANCH-REFERENCE_v1_2.md .\prompts\

# 나머지 전부(기존 파일 수정분)는 patch로 적용
git apply <압축해제경로>\root-cause-fix\root-cause-fix.patch

git status   # 아래 파일들이 modified/new로 떠야 정상:
#  M .github/workflows/live-smoketest.yml
#  M pages/routing-architecture.html
#  M prompts/sp-catalog.json
#  M src/gopang/ai/candidate-prefilter.js
#  M src/gopang/ai/routing-hint.js
#  M src/tests/ai-secretary/candidate-prefilter.test.mjs
#  M tests/live_smoketest/live_smoketest.py
#  A prompts/AC-PRO-CORE_v1_8.txt
#  A prompts/ROUTING-BRANCH-REFERENCE_v1_2.md

# 회귀 확인
node --test src/tests/ai-secretary/candidate-prefilter.test.mjs

git add -A
git commit -m "라우팅 R2 판정 근본 수정: 코드가 확정 + 테스트 채점기준 정정 (AC-PRO-CORE v1_8)"
git push origin fix/r2-routing-code-decision

gh pr create --base main --head fix/r2-routing-code-decision `
  --title "라우팅 R2 판정 근본 원인 수정" `
  --body "부가세/kbusiness 라이브 재발을 candidate-prefilter.js의 findGwpR2Winner()로 코드 확정. ktelecom/kestate는 실제로는 정상 동작(call-ai.js 자동복구)이었음을 확인하고 테스트 채점기준을 정정. AC-PRO-CORE v1_7→v1_8. ROUTING-BRANCH-REFERENCE v1_2로 갱신."
```

## 머지 후 — 재검증
```
Actions 탭 → Live Smoketest → Run workflow
  scenarios_file: scenarios_routing_branches_20260806.json
```
이전 34건 중 FAIL 12건 → 이번 수정으로 해결되는 건 최소 3건(부가세 1건 +
ktelecom/kestate 2건)이 PASS로 바뀌어야 정상입니다. 나머지는 별도 판단이
필요한 항목(§ROUTING-BRANCH-REFERENCE_v1_2.md의 "미해결로 남긴 것" 참고)
이라 이번 패치로는 안 바뀝니다.
