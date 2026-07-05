# SP-00-ROUTER — 폐기 (2026-07-05)

## 왜 여기 있나

`SP-00-ROUTER-v5_0/v5_1/v5_2.txt`와 `src/gopang/ai/router.js`(runRouter,
applyRouterResult, fast-path 정규식들)는 **실제 프로덕션 호출 경로에 단 한
번도 연결된 적이 없는 죽은 코드**였다.

## 근거 (실제 실행/grep으로 확인, 추정 아님)

- `sendMessage()`(src/gopang/ui/send-message.js) → `callAI()`만 직접 호출.
  `runRouter()` 호출부가 전체 코드베이스에 없음(grep 0건).
- `src/gopang/ai/call-ai.js`가 `router.js`를 import는 하고 있었지만
  (`import { runRouter, applyRouterResult } from './router.js'`) 실제
  호출부는 없었다 — import 자체가 죽은 코드.
- `gwp-registry.js`의 `matchService()`/`window.gwpMatch`와
  `src/gopang/gwp/engine.js`의 `_gwpMatch()`도 호출부 0건(동일하게 죽은 코드,
  같은 날 함께 정리).
- `src/gopang/ui/progress.js`가 `_loadRouterPrompt()`를 import 없이
  호출하고 있어(ReferenceError, try/catch로 조용히 삼켜짐) 이미 매 페이지
  로드마다 실패하고 있었다.
- 이 사실은 지난 세션이 만든 `pages/scenario-test.html`의 항목 E03에
  이미 "현재 미연결 확인됨"으로 기록돼 있었으나 문서·코드 정리가
  누락돼 있었다.

## 실제로 라우팅을 담당하는 것

`AGENT-COMMON`(prompts/AGENT-COMMON_v3_9.txt 이상) 자신이 단일 LLM 호출
안에서 `[GWP: {serviceId}]`/`[EXPERT: {personaId}]` 태그로 스스로
판단한다. `call-ai.js`의 `_buildEnhancedUserContent()`가 매 턴 위치·PDV
요약을 이미 주입하므로, 별도 분류 LLM 호출(SP-00-ROUTER가 하려던 방식)
없이 AGENT-COMMON 하나가 문맥 전체를 보고 판단한다.

이후 이 역할을 대체하는 문서는 `prompts/SP-CATALOG_v1_0.md`(SP 전체
목록·5단계 우선순위·상속 구조 정리)와 AGENT-COMMON 본문의 라우팅
섹션이다.

## 이 폴더의 파일을 다시 쓰려면

되살리지 말 것. 필요한 게 "발화 → 서비스 ID"라면 AGENT-COMMON의
라우팅 섹션을 고치는 게 맞다 — 정규식/별도 LLM 분류는 이미 한 번
검증 없이 방치되다 완전히 죽은 코드가 된 전례가 있다.
