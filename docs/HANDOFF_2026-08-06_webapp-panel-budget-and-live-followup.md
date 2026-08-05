# HANDOFF_2026-08-06_webapp-panel-budget-and-live-followup.md
## §4-1/§4-2 라이브 재검증 중 발견한 새 버그 + 오늘 세션 전체 정리 — 인수인계

작성일: 2026-08-06 | 선행 문서: `docs/HANDOFF_2026-08-05_live-smoketest-latency-and-empty-content.md`
(오늘 세션이 그 문서 §4-1/§4-2를 실제로 병합·라이브 검증한 후속) |
이번 세션 성격: 어제 인수인계받은 3→1→2 작업 순서 중 1(모델 분리)·3(진행상황
의무화)까지 코드 병합 완료 → 라이브 재검증 중 **완전히 새로운, 별개의 버그**를
발견·확정·수정

## 이 문서를 받았다면

주피터님이 이 문서를 새 대화창에 올리고 "이어서 진행하십시오"라고 하면,
**§5(다음 작업)**부터 진행하면 됩니다. §1~§4는 이번 세션에 실제로 무엇을
했고 무엇을 발견했는지 순서대로 기록해뒀습니다 — 특히 §3(빈 말풍선 진단
과정)은 "왜 이 결론에 도달했는지" 증거 기반 추론 과정이 그대로 남아있어서,
비슷한 증상이 재발했을 때 진단 절차를 반복하지 않아도 되게 하는 게
목적입니다.

---

## 0. 작업 방식 (변경 없음, 이전 세션들과 동일)

1. `git fetch origin` → `git checkout -b <브랜치> origin/main`로 항상 최신
   기준 새 브랜치.
2. 커밋 후 `git format-patch origin/main..HEAD` → **별도 클론에 `git am`으로
   미리 검증** → `node --test src/tests/*.mjs`로 회귀 확인 → patch 전달.
3. 사용자는 Windows PowerShell. `Copy-Item "$HOME\Downloads\<파일>"
   -Destination "C:\Users\주피터\Downloads\gopang\"`로 다운로드 폴더에서
   저장소 폴더로 옮긴 뒤 `git am`.
4. `git push origin HEAD:main` — 브랜치 보호 규칙이 있지만 주피터님 권한으로
   즉시 반영됨(PR 경유 불필요, 이번 세션에서도 재확인).
5. **이번 세션에도 재확인된 특이사항**: 여러 세션이 동시 병행 작업 중이다.
   오늘 하루만도 patch 준비 도중 origin/main이 예고 없이 여러 차례 앞서
   있었다(EXPERT 페르소나 배치 작업 등 무관한 변경들). patch 생성 직전
   `git fetch`는 예외 없이 실행할 것.
6. **웹 브라우저 라이브 디버깅 시 주의(신규)**: DevTools Console에 붙여넣은
   스크립트(예: fetch 가로채기)는 페이지가 새로고침되는 순간 전부 날아간다
   — 재현에 새로고침이 필요한 진단은 Console 스크립트 대신 **Network 탭 +
   "Preserve log" 체크박스**를 쓸 것(§3 참고).

---

## 1. 이번 세션에 병합·검증 완료된 것 (origin/main 반영 완료)

선행 문서(§4-1/§4-2/§4-4는 아직 라이브 미검증으로 남겨져 있었음)를 이어받아
아래 순서로 처리:

| 순서 | 커밋 | 내용 |
|---|---|---|
| 1 | `8f61ab58` | SP-22(K-Execute) STEP 1의 `[ORCHESTRATION_PROGRESS]` — "2단계 이상만 의무" 조건부 예외 제거, 단계 수 무관 예외 없는 의무 규칙으로 대체 |
| 2 | `7639c79b` | `token-policy.js`에 `resolveOrchestrationModel(tagType)` 신설 — "결과 재주입" 성격 홉(PROCEDURE_MAP_LOOKUP/UPDATE/DRAFT 결과 등 11종)을 hondi-flash로, 그 외는 hondi-pro 유지. `call-ai.js`의 `callAI`/`_callAIInner`/`_buildCallCandidates`에 4번째 인자 `modelTier` 배선 |
| 3 | `89adce79` | 사전 존재 테스트 인프라 버그 3건(worker.js JSON import attribute, sp-intercall.test.mjs ESM 로드 순서, sp-tag-dispatch.test.mjs 플래그 문서화) + mock 카탈로그 staleness 다수 수정 — `100-scenario-thought-experiment.mjs`가 전멸(0/103, 전부 예외)에서 94/99 통과로 회복 |
| 4 | (이 문서와 함께 전달) | **§4 신규 발견 — `webapp.html` AI 패널 예산 버그 수정** |

**의도적으로 손 안 댄 것(범위 밖, 별도 세션 권장)**:
- `gov-router.js` 도메인 분류 버그 5~7건("소상공인 정책자금 대출"→SP-DO-ECON
  기대했으나 SP-ORG-JEDA/SP-POLICY-LAZY로, "어린이집 보육료"→SP-DO-WELFARE
  기대했으나 SP-AGY-LIBRARY로 등) — 두 테스트 파일(`gov-router.test.mjs`,
  `100-scenario-thought-experiment.mjs`)에 동일 패턴으로 나타나는 걸로 봐서
  키워드 우선순위 로직 자체의 진짜 버그로 보이나, 방대한 매칭 시스템을
  추측으로 고치면 회귀 위험이 커서 원인 위치만 특정하고 멈춤.
- `sp-intercall.test.mjs` 남은 8건 — `worker.js`의 `/gov/relay` 오케스트레이션
  실제 LLM 호출 횟수가 테스트 기대치보다 체계적으로 1회씩 적음. 실제 개선
  결과인지 회귀인지 라이브 확인 없이 판단 불가.
- §4-3(기계적 분기는 LLM 호출 자체를 없애기) — 선행 문서가 이미 "이번 세션
  범위 밖, ROI 재평가 후 시작 권장"으로 명시. 그대로 유지.

---

## 2. §4-4(구 `4ecdb1c` STEP 1 draft 처리) 검증 — 이번에도 미확정

원래 목적이었던 "STEP 1의 `status:draft` 갈래가 실제로 잘 동작하는지"는
이번 세션도 확정하지 못했다. 이유: §3에서 발견한 예산 버그가 라이브 검증
경로 자체를 계속 방해했다(응답이 비거나 지연되는 상태에서는 STEP 1이
어느 갈래로 갔는지조차 안정적으로 관찰할 수 없었음). **§4 수정이 실제
배포된 뒤, "안심상속" 시나리오를 다시 라이브로 돌려 STEP 1-B 진입 여부를
재확인할 것** — 이게 이 문서의 §5-1이다.

---

## 3. ★★★ 새로 발견한 버그 — `webapp.html` AI 패널이 pro 모델에 일반 예산을 씀 ★★★

### 3-1. 증상

`hondi.net/webapp.html`에서 최초 인사 직후, 그리고 실제 사용자 발화
("안심상속 확인해 줘")에 대한 응답이 **빈 말풍선으로 멈추는 현상**을
라이브에서 반복 관찰. 콘솔에는 에러가 전혀 안 뜬다.

### 3-2. 진단 과정에서 겪은 함정(§0-6과 연결)

1. Console에 fetch 가로채기 스크립트를 붙여넣었는데, 하드 리프레시로
   재현을 시도하자 스크립트 자체가 날아가 아무것도 못 봄 — Network 탭
   + Preserve log 방식으로 전환.
2. Network 탭에 `deepseek` 요청이 여러 개(최대 6개까지) 잡혀서 "오케스트레이션
   체인이 6홉이나 도나?" 하고 잠깐 오인 — 실제로는 **Preserve log가 여러 번의
   새로고침(=여러 번의 개별 요청) 기록을 전부 누적해서 보여준 것**이었다.
   진짜 요청 횟수는 "몇 번 새로고침했는가"와 정확히 일치했다(1회 새로고침 =
   deepseek 요청 1건). §HANDOFF_2026-08-05 §3의 "SSE 청크 수를 호출 횟수로
   착각하지 마라"와 같은 계열의, 이번엔 "여러 세션의 로그 vs 한 세션의 로그"
   버전 착시.
3. Response 스트림의 앞부분만 보고 "reasoning이 길게 도는 게 버그"라고
   섣불리 결론 내릴 뻔했다 — 스트림 끝(`[DONE]` 직전)까지 확인해야 진짜
   실패인지(`finish_reason:"length"`) 아니면 결국 content가 채워지는
   정상 지연인지(`finish_reason:"stop"`) 구분된다.

### 3-3. 확정 증거

스트림 마지막 청크:

```
"delta":{"content":"","reasoning_content":null},"finish_reason":"length"
"usage":{"completion_tokens":800,"reasoning_tokens":800}
```

`reasoning_tokens`가 `completion_tokens`와 정확히 같다 — reasoning이 예산
800을 전부 소진하고 `finish_reason:"length"`로 강제 종료됐다. 이건
`HANDOFF_2026-08-05_live-smoketest-latency-and-empty-content.md` §2-2에서
이미 발견했던 것과 **같은 실패 패턴**(hondi-pro thinking 모드가 reasoning에
먼저 토큰을 쓰고, 예산이 부족하면 content가 빈 채로 끝남)이 이번엔 최초
인사뿐 아니라 **실제 사용자 발화**에서도 재현된 것이다.

그런데 이번엔 결정적으로 다른 단서가 있었다: 응답의 `model`은
`"deepseek-v4-pro"`인데, `max_tokens`(예산)는 800(`CHAT_REPLY`, 일반)이지
4000(`CHAT_REPLY_PRO`, pro 전용)이 아니었다. **pro 모델을 쓰면서 pro용
예산을 못 받은 것** — 이게 원인 규명의 결정적 실마리였다.

### 3-4. 원인

`webapp.html`의 `_callPanelAI`(3661행, 코드 내 주석상 "AI 패널 — 실제로
쓰이는 주 경로" — 이름과 달리 최초 인사·일반 채팅 전부 이 함수 하나를
거친다)가 `call-ai.js`의 `_callAIInner`와 **완전히 별도로 구현된** 후보
생성·요청 로직을 갖고 있다.

2026-07-28 Pro/Flash 재설계 때 이 파일도 모델 티어는 `hondi-pro`로
고정하도록 이미 수정됐다(코드 내 주석: "call-ai.js의
`_buildCallCandidates()`는 hondi-pro로 고정했는데, 이 패널은... 그 수정이
반영이 안 되고 있었다"). 그런데 **정작 같은 재설계로 신설된
`CHAT_REPLY_PRO`(hondi-pro 전용 4000토큰 예산, #180 결함 대응)는 이 파일에
반영되지 않았다** — 두 요청 분기(직행 경로·BYOK용 `/llm/relay` 경로) 모두
`max_tokens: TOKEN_BUDGET.CHAT_REPLY`(800 고정)로 남아 있었다.

`call-ai.js`는 `resolveChatBudget(c.model)`로 모델이 `hondi-pro`인지 보고
예산을 그때그때 골랐는데, `webapp.html`은 이 헬퍼를 아예 쓰지 않고 고정값을
썼다 — **같은 판단 기준을 갖고 있는 헬퍼 함수가 이미 있는데도, 별도로
중복 구현된 코드에는 그 수정이 반영되지 않은 전형적인 케이스.**

### 3-5. 수정 (이번 세션에 완료, patch로 전달)

두 요청 분기 모두 `max_tokens: TOKEN_BUDGET.CHAT_REPLY` →
`max_tokens: resolveChatBudget(c.model)`로 교체. 더 이상 안 쓰는
`TOKEN_BUDGET` import 제거. `node --test src/tests/*.mjs`는 이 파일을
대상으로 하지 않으므로(브라우저 HTML) 결과 불변(201/204, 변경 전과 동일) —
**라이브 재검증이 반드시 필요**(§5-1).

### 3-6. 왜 §4-2(모델 분리) 패치가 이 버그를 못 잡았는가

§4-2는 `call-ai.js`의 `_handleOrchestrationTags`/`_handleSPAuthorTags` 내
"재주입" 홉만 다뤘다. `webapp.html`의 `_callPanelAI`는 그 함수들을 아예
호출하지 않는 별도 구현이라 애초에 대상이 아니었다 — 오늘 라이브
재검증이 아니었으면 이 버그는 계속 남아있었을 것이다. **이 사실 자체가
중요한 교훈이다**: `call-ai.js` 안의 헬퍼 함수를 고쳤다고 해서 같은 로직을
따로 구현한 다른 파일(`webapp.html`)까지 자동으로 고쳐지지 않는다 —
비슷한 중복이 더 있는지 별도로 감사할 가치가 있다(§5-3).

---

## 4. 참고 — `deepseek-v4-pro`/`hondi-flash` 역할 분담 관련 기존 문서

이번 세션 중 "pro가 800으로 실패하니 예산을 늘리되, 매 턴 4000을 다 쓸
필요는 없지 않나(예: 첫 턴만 넉넉하게, 이후는 절약)"는 논의가 있었다.
**결론: 턴 번호 기반 예산 조절은 채택하지 않음** — 이유는 §3-3의 실측
증거 자체가 "여러 턴째"에 실패했고, reasoning 길이는 "몇 번째 턴인가"가
아니라 "이번 턴의 라우팅 판단이 얼마나 애매한가"에 좌우되기 때문(대화가
길어질수록 오히려 고려할 맥락이 늘어 reasoning이 더 길어질 수도 있음).
대신 §3처럼 **"pro 모델을 쓰면 예외 없이 pro 예산을 준다"는 지금 원칙을
모든 호출 경로에 빠짐없이 적용하는 것**이 맞는 방향이라고 판단했다.

관련 기존 설계 문서(오늘 새로 만든 게 아니라 기존 자료를 확인한 것):

- **`prompts/AC-PRO-CORE_v1_1.txt` §DELEGATE** — 2026-07-28 "Pro/Flash
  재설계"의 원 설계. hondi-pro가 기본 판단 주체이고, `[DELEGATE_TO_FLASH:
  task=..., context=...]` 태그로 **pro 자신이 선택적으로** 판단이 끝난
  단순 실행만 flash에 위임한다("위임은 선택이지 의무가 아니다"). 이건
  §4-2(코드가 강제로 재주입 홉을 flash로 내리는 것)와는 다른, LLM 스스로
  결정하는 별도 메커니즘 — 서로 배타적이지 않지만 겹치는 지점(pro가 위임
  안 하기로 판단했는데 코드가 강제로 내리는 경우 등)이 있는지는 미확인.
- **`prompts/AC-FLASH-EXECUTOR_v1_0.txt`** — flash가 위임받았을 때 쓰는
  전용 프롬프트. "판단은 이미 끝났고 실행만 한다"는 전제, 판단이 필요하면
  `[ESCALATE_TO_PRO: ...]`로 되돌림.
- **`docs/SESSION_LESSONS_LIVE_SMOKETEST_LATENCY_v1_0.html`** — 어제 세션의
  디버깅 함정 5가지를 매뉴얼 형태로 정리한 문서. 오늘 §3-3에서 확정한
  "pro인데 800토큰만 받음" 케이스는 이 문서에 아직 없는 새 사례 — 다음
  갱신 때 추가 고려.

---

## 5. 다음 작업 지시

### 5-1. (최우선) §4 수정 병합 후 라이브 재검증

`webapp.html` 패치가 배포되면, "안심상속" 시나리오를 다시 라이브로 돌려서:
- 빈 말풍선/`finish_reason:"length"`가 재발하지 않는지(Network 탭에서
  `usage.reasoning_tokens < usage.completion_tokens`이고 `finish_reason:
  "stop"`인지 확인)
- §4-4(구 `4ecdb1c` STEP 1 draft 처리)가 이제 안정적으로 관찰 가능해졌으니,
  STEP 1-B 진입 여부 재확인
- §4-1(ORCHESTRATION_PROGRESS 의무화)이 실제로 화면에 진행 표시를 띄우는지
- §4-2(재주입 홉 hondi-flash 분리)가 응답 시간을 실제로 줄였는지

### 5-2. `gov-router.js` 도메인 분류 버그 (§1 "손 안 댄 것" 참고)

경제·창업 관련 질의가 도청 자체 부서(SP-DO-ECON, SP-DO-INNOV)가 아니라
외부기관/정책DB 조회 경로(SP-ORG-JEDA, SP-POLICY-LAZY)로 새는 패턴. 원인
후보 위치 특정까지만 하고 멈췄음 — 다음 세션에서 `gov-router.js`의 도메인
매칭 우선순위 로직부터 확인 시작.

### 5-3. (신규 권고) `call-ai.js`와 `webapp.html`의 중복 구현 감사

§3-6에서 드러난 대로, `webapp.html`이 `call-ai.js`의 핵심 헬퍼(특히
`resolveChatBudget`, 그리고 잠재적으로 다른 token-policy.js 함수들)를
직접 쓰지 않고 자체 구현을 갖고 있어 한쪽만 고쳐지는 문제가 재발할 수
있다. 시간 될 때 `webapp.html`의 `_callPanelAI`가 `call-ai.js`의 어떤
함수들과 로직이 겹치는지, 겹치는 부분을 공유 모듈로 뽑아낼 수 있는지
검토 권장(이번 세션 범위 밖, 큰 리팩토링이라 별도 세션 필요).

### 5-4. `sp-intercall.test.mjs` 남은 8건

`worker.js`의 `/gov/relay` 오케스트레이션 실제 LLM 호출 횟수가 테스트
기대치보다 체계적으로 적게 나옴. 라이브에서 실제 `/gov/relay` 경로를
관찰할 기회가 있으면(§5-1과 별개로), 실제 호출 횟수를 실측해서 테스트가
낙후된 것인지 진짜 회귀인지 판정.

---

## 6. 관련 파일 목록

- `webapp.html` — `_callPanelAI`(§3661행 근처), 이번 세션 §4 수정 대상
- `src/gopang/core/token-policy.js` — `TOKEN_BUDGET`, `resolveChatBudget()`,
  `resolveOrchestrationModel()`
- `src/gopang/ai/call-ai.js` — `_callAIInner`, `_buildCallCandidates`,
  `_handleOrchestrationTags`, `_handleSPAuthorTags`
- `prompts/SP-22_kexecute_v1.5.txt` — §4-1 대상(STEP 1)
- `prompts/AC-PRO-CORE_v1_1.txt` §DELEGATE, `prompts/AC-FLASH-EXECUTOR_v1_0.txt`
  — pro/flash 역할 분담 원 설계(§4 참고)
- `src/tests/100-scenario-thought-experiment.mjs`,
  `src/tests/gov-router.test.mjs` — §5-2(도메인 분류 버그) 재현 위치
- `src/tests/sp-intercall.test.mjs` — §5-4 대상
- `docs/HANDOFF_2026-08-05_live-smoketest-latency-and-empty-content.md` —
  선행 인수인계 문서(§2-2가 오늘 §3의 원 발견)
- `docs/SESSION_LESSONS_LIVE_SMOKETEST_LATENCY_v1_0.html` — 디버깅 함정 매뉴얼
