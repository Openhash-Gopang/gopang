# SP 전수 커버리지 테스트 — 적용 방법

## 무엇이 들어있나
- tests/live_smoketest/scenarios_full_sp_coverage_20260831.json — 88개
  SP(GWP 26 + EXPERT 루트 62) 전체를 각 1건씩 커버하는 신규 통합 배치.
  기존 40여 개 시나리오 파일에서 SP별 최고 품질(검증 이력 PASS 우선,
  최신 파일 우선) 케이스를 취합, trigger 단어 과다의존 5건은 재작성.
- full-sp-coverage.patch — ROUTING-BRANCH-REFERENCE_v1_2.md에 이 새
  배치를 참고 문서로 등록하는 7줄짜리 패치.

## 적용 절차

```powershell
cd C:\Users\주피터\Downloads\gopang
git checkout main
git pull
git checkout -b test/full-sp-coverage-20260831

Copy-Item <압축해제경로>\full-sp-coverage\tests\live_smoketest\scenarios_full_sp_coverage_20260831.json .\tests\live_smoketest\
git apply <압축해제경로>\full-sp-coverage\full-sp-coverage.patch

git status   # 아래 2개가 떠야 정상:
#  M prompts/ROUTING-BRANCH-REFERENCE_v1_2.md
#  A tests/live_smoketest/scenarios_full_sp_coverage_20260831.json

git add -A
git commit -m "test: SP 전수 커버리지 통합 시나리오 88건 신설"
git push origin test/full-sp-coverage-20260831

gh pr create --base main --head test/full-sp-coverage-20260831 `
  --title "SP 전수 커버리지 라이브 테스트 신설" `
  --body "88개 SP(GWP 26 + EXPERT 62) 전체를 각 1건씩 커버하는 통합 배치. 기존 40여 개 파일에서 SP별 최고 품질 케이스를 취합."
gh pr merge --merge
```

## 실행 (머지 후)
Actions → Live Smoketest → Run workflow → scenarios_file:
```
scenarios_full_sp_coverage_20260831.json
```
88건, 예상 비용/시간 극히 적음(1분 내, 1달러 미만).
