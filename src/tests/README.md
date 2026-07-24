# 테스트 실행 방법

## 두 가지 실행 스타일이 섞여 있습니다

이 저장소의 테스트 파일은 두 스타일로 나뉩니다 — 파일을 열어 어느
스타일인지 먼저 확인하세요.

### A) `node:test`의 `describe`/`it`/`test`를 쓰는 파일
```
node --test <파일 경로>
```
여러 파일을 한 번에 돌리려면 glob으로:
```
node --test src/tests/network/*.test.js
```
(디렉토리를 직접 넘기는 `node --test src/tests/network/`는 Node의 자체
디렉토리 탐색 관례와 안 맞아 실패할 수 있음 — 항상 glob이나 개별 파일
경로를 쓸 것.)

### B) 자체 `check()`/카운터 패턴을 쓰는 구식 파일
`describe`/`it` 없이 파일 최상단에서 바로 실행되는 스타일(예:
`sp-intercall.test.mjs`, `phase2c_evidence.test.js`)은 `node --test`가
아니라 **일반 스크립트로 그냥 실행**합니다:
```
node <파일 경로>
```

## `mock.module`을 쓰는 파일은 플래그가 필수입니다

Node 22 기준, `node:test`의 `mock.module()`은 아직 실험적 기능이라
**`--experimental-test-module-mocks` 플래그 없이 돌리면
"`mock.module is not a function`"으로 실패**합니다 — 이건 테스트나
코드의 버그가 아니라 Node 실행 방식 문제입니다(2026-07-24 확인).

현재 이 기능을 쓰는 파일:
- `src/tests/sp-tag-dispatch.test.mjs`
- `src/tests/ai-secretary/expert-session-switch.test.mjs`
- `src/tests/pdv/phase2c_evidence.test.js`
- `src/tests/pdv/phase2c_evidence_e2e.test.mjs`

실행 예:
```
node --experimental-test-module-mocks src/tests/sp-tag-dispatch.test.mjs
node --experimental-test-module-mocks src/tests/ai-secretary/expert-session-switch.test.mjs
node --experimental-test-module-mocks src/tests/pdv/phase2c_evidence.test.js
node --experimental-test-module-mocks src/tests/pdv/phase2c_evidence_e2e.test.mjs
```
(이 플래그는 `mock.module`을 안 쓰는 파일에 같이 줘도 무해합니다 — 헷갈리면
그냥 항상 붙여도 됩니다.)

## 알려진 기존 실패 — 제 작업과 무관 (재조사 불필요)

**`src/tests/sp-intercall.test.mjs`**: `mock.module`을 쓰지 않는데도
LLM 호출 횟수 불일치(예: "실제 0회"/"실제 2회")로 다수 체크가 실패합니다.
2026-07-23 확인 결과 **제가 그날 만든 변경들과 무관하게 그 이전부터 이미
깨져 있던 상태**였습니다(`git stash`로 되돌려서 재현 확인함). 위임
(delegation) 오케스트레이션 관련 실사용 코드와 테스트 픽스처가 어딘가
어긋난 것으로 보이나, 원인은 아직 조사 전입니다 — 별도 작업으로
남겨둡니다.
