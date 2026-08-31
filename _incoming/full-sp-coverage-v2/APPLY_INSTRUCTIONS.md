# SP 전수 커버리지 테스트 (수정판) — 적용 방법

## 배경
이전 PR #732로 main에 병합된 scenarios_full_sp_coverage_20260831.json은
EXPERT 60건이 "~한테 직접 상담받고 싶어요"처럼 SP 명칭(직함)을 그대로
발화에 박아넣은 반칙 케이스였습니다(주피터님 지적). 이 패치는 그 파일을
**전체 교체**하고, EXPERT 60건 전부를 명칭 언급 없이(상황 서술 +
위임의도 표현만으로) 다시 씁니다. GWP 26건은 원래 문제없어 그대로.

또한 main에 실수로 누적된 세션 부산물(_incoming/, root-cause-fix.zip,
full-sp-coverage.zip, results/scenarios_*_20260806/ — 원래
results/live-smoketest 브랜치 전용)도 함께 정리합니다.

## 적용 절차

```powershell
cd C:\Users\주피터\Downloads\gopang
git checkout main
git pull
git checkout -b fix/sp-coverage-remove-name-leak

# 1) 시나리오 파일 전체 교체
Copy-Item <압축해제경로>\full-sp-coverage-v2\tests\live_smoketest\scenarios_full_sp_coverage_20260831.json .\tests\live_smoketest\ -Force

# 2) 문서 패치 적용
git apply <압축해제경로>\full-sp-coverage-v2\doc_addition_final.patch

# 3) 부산물 정리
git rm -r --cached _incoming root-cause-fix.zip full-sp-coverage.zip `
  results\scenarios_branch_coverage_20260806 results\scenarios_routing_branches_20260806
Remove-Item _incoming, root-cause-fix.zip, full-sp-coverage.zip -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item results\scenarios_branch_coverage_20260806, results\scenarios_routing_branches_20260806 -Recurse -Force -ErrorAction SilentlyContinue

git status
# 아래가 보여야 정상:
#  M prompts/ROUTING-BRANCH-REFERENCE_v1_2.md
#  M tests/live_smoketest/scenarios_full_sp_coverage_20260831.json
#  D  _incoming/... (여러 개)
#  D  full-sp-coverage.zip
#  D  root-cause-fix.zip
#  D  results/scenarios_branch_coverage_20260806/...
#  D  results/scenarios_routing_branches_20260806/...

git add -A
git commit -m "fix: SP 전수 커버리지 EXPERT 60건 명칭 언급 제거 + 세션 부산물 정리"
git push origin fix/sp-coverage-remove-name-leak

gh pr create --base main --head fix/sp-coverage-remove-name-leak `
  --title "SP 전수 커버리지 — 명칭 언급 반칙 수정" `
  --body "EXPERT 60건이 직함을 그대로 발화에 언급한 반칙 케이스였음을 확인, 상황 서술+위임의도 표현으로 전면 재작성. main에 잘못 누적된 세션 부산물도 함께 정리."
gh pr merge --merge
```

## 머지 후 재검증
Actions → Live Smoketest → Run workflow → scenarios_file:
```
scenarios_full_sp_coverage_20260831.json
```
