# LLM 토큰 절약 지침

이 문서는 "왜"를 설명합니다. 실제로 지켜지는지는 코드가 강제합니다(아래 §시행 참조) —
문서만 읽고 "알겠다"로 끝나면 안 되고, 새 호출부를 추가할 때 반드시
`src/gopang/core/token-policy.js`를 import해서 써야 합니다.

## 발견된 사례 — 왜 이 문서가 필요했는가

`src/gopang/services/klaw.js`의 백그라운드 법률 감시 기능은 모든 대화·PDV 기록마다
LLM을 호출하도록 설계됐는데, 이때 분류 작업인데도 `model: CFG.model`(사용자가
설정 화면에서 고른, Claude·GPT 등 비쌀 수 있는 메인 대화 모델)을 그대로 썼습니다.
30초 쿨다운이 있었지만 활발한 대화 중에는 충분한 방어가 못 됐고, 결국
"토큰 과다 소모"가 확인되어 **기능 전체가 꺼졌습니다**(`KLAW_BACKGROUND_ENABLED = false`,
2026-06-27). 반면 같은 시스템의 `router.js`(SP-00 라우터)는 처음부터 고정 저가
모델(`deepseek-v4-flash`)을 썼고, 같은 문제를 겪지 않았습니다.

같은 시스템 안에 정답(router.js)과 오답(klaw.js)이 공존했다는 것 — 이게 정확히
"문서만 있고 강제가 없으면 생기는 일"입니다.

## 원칙

### 1. 호출부에 max_tokens 숫자를 직접 적지 않는다

`src/gopang/core/token-policy.js`의 `TOKEN_BUDGET` 중 용도에 맞는 키를 가져다 쓴다.

| 용도 | 키 | 예 |
|---|---|---|
| 후보 중 하나만 골라 ID 반환 | `TRIVIAL_PICK` (30) | 유사 SP 선택 |
| 분류 결과를 JSON으로만 반환 | `ROUTE_CLASSIFY` (256) | SP-00 라우터 |
| 짧은 구조화 요약 | `SUMMARY_SHORT` (240) | 6하원칙 요약 |
| 분류 + 근거 + 권고 | `MONITOR_REVIEW` (512) | K-Law 백그라운드 감시 |
| 메인 대화 한 턴 응답 | `CHAT_REPLY` (800) | PA·AGENT-COMMON·AI 패널 — 표면이 달라도 같은 종류면 같은 예산 |
| GWP inline Agent 응답 | `AGENT_INLINE` (1200) | 전문 SP 주입 후 응답 |
| SP 실시간 자동생성 | `SP_GENERATE` (1200) | 800자 분량 텍스트 + 여유 |

새 용도가 필요하면 숫자를 바로 쓰지 말고 `TOKEN_BUDGET`에 키를 추가한다 — 그래야
나중에 정책을 한 번에 바꿀 수 있다.

### 2. "사용자가 직접 읽지 않는" 작업은 고정 저가 모델을 쓴다

분류·요약·백그라운드 감시처럼 결과물의 글솜씨가 중요하지 않은 작업은
`token-policy.js`의 `FAST_MODEL`(`deepseek-v4-flash`)을 쓴다. `CFG.model`(사용자가
ai-setup-mobile.html에서 고른 모델)은 사용자가 실제로 읽는 대화 응답에만 쓴다.

**주의**: `FAST_MODEL`은 DeepSeek 전용 모델 ID라서, 사용자가 등록한 여러 provider
(Claude/Gemini/OpenAI 등)를 순회하는 페일오버 루프(`_buildCallCandidates()`) 안에서
모델 이름만 바꿔 끼우면 안 된다(다른 provider 엔드포인트에 deepseek 모델명을
보내면 그냥 실패한다). `router.js`/`klaw.js`처럼 **provider 페일오버를 거치지
않는 고정 엔드포인트**(`CFG.endpoint` 직접 호출)로 호출해야 안전하다. 이 차이를
헷갈려서 한 번 잘못 구현했다가(`_callLLM`에 `forceModel` 옵션을 넣었다가)
되돌렸다 — 다음에 같은 실수를 반복하지 않도록 여기 적어둔다.

### 3. 새 백그라운드/자동 작업을 추가하기 전 세 가지를 확인한다

- [ ] 쿨다운이 있는가? (같은 트리거가 짧은 간격으로 반복 호출되지 않는가)
- [ ] 호출 빈도 상한이 있는가? (예: 메시지당 최대 시도 횟수)
- [ ] 고정 저가 모델(`FAST_MODEL`)을 쓰는가, 아니면 `CFG.model`을 그대로 따라가는가?

klaw.js는 이 셋 중 세 번째를 놓쳐서 기능 전체가 꺼졌다. 첫 번째·두 번째만
있어도 세 번째가 없으면 여전히 위험하다(사용자가 비싼 모델을 메인으로 설정한
순간 모든 백그라운드 호출이 그 모델을 따라간다).

### 4. 시스템 프롬프트는 정적으로 유지한다 (이미 잘 지켜지고 있음)

`_buildEnhancedUserContent()`의 기존 설계 원칙 — system 메시지는 절대 매 턴
바뀌지 않고, 동적 정보(GUID·위치·PDV 요약·온보딩 컨텍스트)는 user 메시지 앞에
붙인다. 이게 DeepSeek Auto Prompt Caching의 캐시 적중률을 95%+로 유지하는
핵심이다. 새 호출부를 추가할 때 이 원칙을 깨지 않는다(예: 매 턴 system을
다시 만들어 보내면 캐시가 매번 무효화된다).

## §시행 — 문서가 아니라 코드로 강제한 것

1. **`src/gopang/core/token-policy.js` 신설** — `TOKEN_BUDGET`(용도별 max_tokens)과
   `FAST_MODEL`(고정 저가 모델)을 한 곳에 모았다.
2. **기존 호출부 전부 교체** — `call-ai.js`(메인 채팅 + `_callLLM`), `routing-engine.js`
   (유사도 선택·SP 생성·inline Agent·6하원칙 요약 4곳), `router.js`(SP-00 분류),
   `klaw.js`(백그라운드 감시), `webapp.html`(AI 패널) — 전부 하드코딩 숫자를
   지우고 `TOKEN_BUDGET`/`FAST_MODEL`을 import해서 쓰도록 바꿨다.
3. **klaw.js의 `model: CFG.model` → `FAST_MODEL`로 교정** — 기능을 통째로 꺼야 했던
   근본 원인을 고쳤다(단, `KLAW_BACKGROUND_ENABLED`는 여전히 `false`로 둔다 —
   비용 문제는 고쳤지만 다시 켜는 건 별도 제품 판단이 필요해서 임의로 켜지 않았다).
4. **메인 채팅(800) vs AI 패널(1500)의 우연한 불일치 제거** — 둘 다 `CHAT_REPLY`로
   통일.

이렇게 해두면, 누군가 새 파일에서 또 `max_tokens: 1234`를 직접 적으려고 하면
review 단계에서 "왜 token-policy.js를 안 쓰셨나요?"라고 물을 근거가 생긴다 —
문서가 아니라 "다들 그렇게 안 한다"는 코드 관행 자체가 강제 장치다.

## 아직 다루지 않은 것 (범위 밖)

- `worker.js`(서버사이드 Cloudflare Worker)의 자체 `max_tokens` 기본값들 — 배포
  리스크가 다른 별도 영역이라 이번엔 손대지 않았다.
- `src/profile2.0/`(13개 파일, `gopang/` 없는 경로) — 전수조사 결과 **아무 곳에서도
  import되지 않는 죽은 디렉터리**였다. 여기 있는 max_tokens 값들은 실행되지
  않으므로 토큰 낭비와 무관하지만, 디렉터리 자체는 별도로 정리 대상이다.
- `tools/index_template.html`, `profiles/*.html` — 채팅 흐름과 직접 연결되지
  않은 별도 도구/생성물로 보여 이번 범위에서 제외했다.
