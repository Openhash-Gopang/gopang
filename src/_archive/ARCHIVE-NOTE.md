# src/_archive — 죽은 코드 아카이브 (2026-07-05)

## routing-engine.js, industry-router.js

router.js(구 SP-00-ROUTER, prompts/archive/SP-00-ROUTER-DEPRECATED.md 참조)
보다도 더 오래된, **완전히 별개의 세 번째 세대 라우팅 시도**였다. 둘 다
실제 앱 번들(`gopang-app.js`) 어디에서도 import되지 않는다(grep 0건,
`from '.*routing-engine'`/`from '.*industry-router'` 전체 검색 재확인).

증거:
- `routing-engine.js`가 의존하는 `_callLLM`(call-ai.js)은 한때 export조차
  없어서, 이 파일을 실제로 부르는 순간 무조건 깨지는 상태로 방치돼 있었다
  (call-ai.js 793행 주석에 이미 자체 기록됨: "이전엔 routing-engine.js가 이
  함수를 import하고 있었지만 정작 call-ai.js에 export가 없어서 호출하는
  즉시 깨졌습니다").
- `industry-router.js`의 `INDUSTRY_REGISTRY`/`_matchCandidates()`도 어떤
  onboarding 플로우에서도 호출되지 않는다.

## GWP_REGISTRY.triggers — 지금은 아무도 안 읽는다

`gwp-registry.js`의 각 서비스 `triggers` 배열은 한때 `matchService()`
(2026-07-05 제거, SP-00-ROUTER-DEPRECATED.md 참조)와 이 두 파일이
읽었지만, 셋 다 죽은 뒤로는 **프로그램적으로 이 필드를 읽는 코드가
전혀 없다**. 실제 라우팅은 AGENT-COMMON 자신의 의미 이해가 한다.

그래도 `triggers` 배열 자체는 지우지 않고 유지한다 — 각 서비스의 실제
기능을 문서화하는 유일한 구조화된 자료이고, 향후 누군가(사람이든 다음
세션이든) 키워드 매칭을 다시 만들고 싶어질 걸 대비해 최소한 정확하게는
유지해둔다(같은 이유로 2026-07-05에 khealth의 bare '열', ktax의 bare
'신고'는 실제 동음이의어 충돌이 확인돼 정리했고, kpolice의 '강도'는
recall 유지를 위해 남기되 주석으로 위험을 명시했다).
