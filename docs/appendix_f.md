## 부록 F. 나만의 AI 비서 — Profile 온보딩, Market Agent, 판매자 AI 비서 연동 설계

> 본 부록은 2026년 6월 혼디(Hondi) 플랫폼에 "나만의 AI 비서(Personal Assistant)" 기능을 도입하면서 설계·구현하고 사고 실험으로 검증한 내용을 정리한 것이다. 신규 이용자의 Profile 자동 작성 온보딩, K-Market Agent를 통한 소비자↔판매자 AI 비서 중개, 양측 PDV 기록이라는 세 주제를 다루며, 구현 과정에서 발견된 구조적 결함과 수정 내용을 함께 기록한다.

---

### F-1. 전체 아키텍처 개관 — 사람-사람 소통에서 AI비서-AI비서 소통으로

혼디 도입 이전의 소통 구조는 "사람 A ↔ 사람 B"였다. 소비자가 판매자에게 직접 전화하거나 메시지를 보내 가격을 묻고, 재고를 확인하고, 주문을 체결했다. 이 구조의 한계는 세 가지다. 첫째, 판매자가 자리를 비우면 소통이 끊긴다. 둘째, 소비자는 여러 판매자를 직접 비교해야 한다. 셋째, 거래 기록이 분산되어 나중에 증거로 쓰기 어렵다.

혼디의 새 구조는 이 세 한계를 동시에 해결한다.

```
[기존]  소비자 A ──────────────────────── 판매자 B

[신규]  소비자 A
          └─ A의 AI 비서 (personal-assistant-v1.0)
               └─ K-Market Agent (SP-KMARKET-v3_0)
                    └─ B의 AI 비서 (SP-SELLER-I56-v1_0)
                         └─ 판매자 B
```

핵심 원칙은 두 가지다. 첫째, 모든 AI 비서는 자신의 주인의 이익을 최우선으로 한다. 소비자 AI 비서는 소비자의 이익을, 판매자 AI 비서는 판매자의 이익을 위해 행동한다. K-Market Agent는 어느 쪽 편도 아닌 순수한 중개자다. 둘째, 사람은 지시만 하면 된다. "고기국수 두 그릇 주문해 줘" 한 마디면, 검색·비교·협상·결제·기록이 모두 자동으로 이루어진다.

---

### F-2. 나만의 AI 비서 구동 구조

나만의 AI 비서의 System Prompt(`personal-assistant-v1.0.txt`)는 GitHub raw URL에서 동적으로 로드되어 `gopang_cfg.system`에 저장된다. 이 방식은 클라이언트를 배포하지 않고도 SP를 갱신할 수 있다는 운영상 이점이 있다.

구동 코드는 세 파일에 걸쳐 있다.

**`src/gopang/core/config.js`** — `loadPersonalAssistantSP()`가 세션 최초 1회 GitHub raw에서 SP를 fetch해 `CFG.system`에 적용한다. 사용자가 설정창에서 직접 입력한 system이 있으면 그것을 우선한다(`gopang_cfg.system` 길이가 100자 이상이면 사용자 설정으로 간주).

**`src/gopang/ui/welcome.js`** — `_showWelcomeMessage()`가 호출되면 `hondi_profile_done` localStorage 키를 확인한다. 없으면 600ms 딜레이 후 `callAI()`에 `[SYSTEM] PHASE 1 온보딩을 시작해 주세요.`를 주입해, 사용자가 아무 말도 하지 않아도 AI 비서가 먼저 질문을 시작한다. `handleProfileSubmit()`은 AI 응답에서 `PROFILE_SUBMIT {...}` 블록을 파싱해 Worker `POST /profile`을 호출하고, 성공하면 `hondi-pdv` IndexedDB를 초기화한다.

**`src/gopang/ai/call-ai.js`** — 스트리밍 완료 후 응답에 `PROFILE_SUBMIT`이 있으면 `handleProfileSubmit`을 import해 호출한다. `[N/7단계]` 패턴이 있으면 `hondi_profile_step`을 갱신해 다음 세션에서 중단 단계를 재개할 수 있게 한다.

---

### F-3. Profile 온보딩 7단계 흐름

신규 이용자가 AI 비서를 처음 켜면 아래 흐름이 자동으로 시작된다.

```
STEP 1  이름·호칭
STEP 2  이용자 유형 (개인 / 사업자 / 기관)
STEP 3A 개인: 거주지 + 연락처
STEP 3B 사업자: 상호명 → 상품·가격 입력 → AI가 업종 자동 판별
STEP 4  업종별 추가 필드
        ├ 음식점 (I56): 주소·영업시간·배달 여부·사업자번호
        ├ 농·축·수산 (G47): 위치·배송방법·원산지
        └ 기타: 주소·영업시간
STEP 5  GDC 결제 수락 여부
STEP 6  공개/비공개
STEP 7  확인 → PROFILE_SUBMIT 출력 → Worker POST → PDV 초기화
```

각 단계에서 AI 비서는 `[N/7단계]` 표시를 포함해 응답하며, `call-ai.js`가 이 패턴을 감지해 `hondi_profile_step`을 갱신한다. 브라우저를 닫고 재접속하면 `hondi_profile_step` 값을 읽어 해당 단계부터 재개한다.

`PROFILE_SUBMIT` 블록은 Supabase `user_profiles` 테이블에 저장된다. 사업자의 경우 `extra.public.ai_assistant.system_prompt` 필드에 SP-SELLER-I56-v1_0을 해당 사업자 데이터로 인스턴스화한 버전이 내장되어, `gopang.net/profile/@handle`에서 판매자 AI 비서로 즉시 구동된다.

---

### F-4. K-Market Agent의 중개 역할 (SP-KMARKET-v3_0)

K-Market Agent는 v2.4까지 "소비자를 대신해 판매자와 직접 거래 조건을 결정"하는 구조였다. v3.0에서 이 역할을 근본적으로 재정의했다. K-Market Agent는 소비자 AI 비서와 판매자 AI 비서를 연결하는 중개자다. 두 AI 비서가 서로의 주소와 채널을 알지 못하기 때문에 K-Market이 그 연결을 담당한다.

중개 흐름은 5단계다.

```
1단계  소비자 AI 비서로부터 구매 의뢰 수신 (GWP ctx)
2단계  [SEARCH] 태그 → search_entities() RPC → 판매자 목록 + seller_ai_endpoint 확인
3단계  [OPEN_SELLER_AI] 태그 → 판매자 profile 팝업 (buyer_request 파라미터 포함)
4단계  판매자 AI 비서로부터 [SELLER_RESPONSE] 수신 → GWP_SELLER_RESPONSE로 포워딩
5단계  조건 합의 → [TRADE] 블록 자동 생성 → GWP_SIGN_REQUEST → 결제 완료
```

v2.4의 `[OPEN_PROFILE]` 태그를 `[OPEN_SELLER_AI]` 태그로 교체한 것이 핵심 변화다. 새 태그에는 `seller_ai_endpoint`와 `buyer_request` 필드가 포함되어, 판매자 profile 페이지가 열리자마자 판매자 AI 비서에게 구매 요청이 자동 주입된다.

판매자에게 AI 비서가 없는 경우(`seller_ai_endpoint` 부재) `[SELLER_AI_MISSING]` 안내를 출력하고 세 가지 선택지를 제시한다: ① 다른 AI 비서 보유 판매자 탐색, ② 기존 profile 직접 방문, ③ 판매자에게 AI 비서 도입 안내.

---

### F-5. 판매자 AI 비서의 역할 (SP-SELLER-I56-v1_0)

판매자 AI 비서는 `profile.html`의 채팅창을 통해 구동된다. `extra.public.ai_assistant.system_prompt`에 저장된 SP가 `profile.html` 렌더링 시 로드되어, 해당 사업자의 메뉴·가격·영업시간·배달 조건을 기반으로 응대한다.

K-Market Agent로부터 `[BUYER_REQUEST]`를 수신하면 아래 순서로 처리한다.

```
① 메뉴 존재 여부 확인
② 재고 확인 (in / low / out)
③ 영업 시간 내 여부 확인
④ 가격 협상 (원가+15% 미만 할인은 거절)
⑤ [SELLER_RESPONSE] 태그 출력
```

`[SELLER_RESPONSE]`는 `profile.html`의 `_callSellerAI()`가 감지해 `window.opener.postMessage(GWP_SELLER_RESPONSE)`로 Market Agent 팝업에 전달한다. 거래 완결 시 `[SELLER_PDV]` 태그를 출력하고, 판매자 측 `hondi-pdv` IndexedDB에 판매 기록이 기록된다.

KSIC 분류 기준으로 SP-SELLER-I56-v1_0은 중분류 56(음식점 및 주점업)에 특화된 버전이며, 식품위생법 고지·알레르기 안내·최소 주문금액·영업시간 외 응대 등 I56 업종 특유의 규칙을 포함한다.

---

### F-6. 구체적 거래 시나리오 — 이제주와 한림국수

전체 흐름을 하나의 시나리오로 추적한다.

이제주가 혼디 대화창에 "고기국수 두 그릇 주문해 줘"를 입력하면, 이제주의 AI 비서가 `시장·물가·거래 → K-Market` 라우팅 판단을 내려 `[GWP:kcommerce]` 태그를 출력한다. 화면이 `market.gopang.net/webapp.html`로 전환되며, Market Agent가 이제주의 현재 위치(한림읍)를 기반으로 고기국수 판매 음식점을 검색한다.

검색 결과에서 이제주가 한림국수를 선택하면, Market Agent가 `[OPEN_SELLER_AI]` 태그를 출력한다. `gopang.net/profile/@hallim_guksu` 팝업이 열리고, URL 파라미터로 전달된 `buyer_request`(고기국수 2그릇, 포장)가 한림국수 AI 비서에게 자동 주입된다.

한림국수 AI 비서는 재고를 확인하고 포장 5% 할인을 적용한 최종 가격 ₮17,100을 제시한다. 이제주가 확정하면 `[SELLER_RESPONSE]`가 Market Agent에 전달되고, `[TRADE]` 블록이 자동 생성된다. 이제주의 `gopang-wallet.js`가 서명하면 Worker `POST /biz/order`를 거쳐 L1 PocketBase에 블록이 기록되고 `block_hash`가 발급된다.

거래 완결 후 두 PDV에 각자의 관점에서 기록이 남는다.

```
이제주 PDV (구매자):  pl-purchase ₮17,100, 한림국수, block_hash: e862f1...
한림국수 PDV (판매자): pl-revenue ₮17,100, 이제주, block_hash: e862f1...
```

같은 `block_hash`가 양측 PDV에 기록되어, 분쟁 발생 시 OpenHash L1의 불변 기록과 대조할 수 있다.

---

### F-7. 구현 과정에서 발견된 결함 3건

사고 실험을 통해 코드가 배포된 후에도 동작하지 않을 세 가지 결함이 사전에 식별되어 수정됐다.

#### 결함 F-7-1. `profile.html`이 `buyer_request` 파라미터를 인식하지 못함

**증상:** K-Market Agent가 `[OPEN_SELLER_AI]` 태그를 통해 `buyer_request` 파라미터를 URL에 포함해 `profile.html`을 열어도, `profile.html`의 `_handle` 파싱 로직이 `handle` 파라미터만 읽고 `buyer_request`는 무시했다. 판매자 AI 비서 채팅창이 열려도 구매 요청이 전달되지 않아, 이용자가 다시 처음부터 "고기국수 두 그릇 주문하려고요"를 수동으로 입력해야 했다.

**원인:** `profile.html`은 원래 단순 프로필 조회 목적으로 설계되어 `?handle=@...`만 파싱하도록 구현되어 있었다. `buyer_request`, `buyer_guid`, `opener_origin` 파라미터 처리 코드가 없었다.

**수정:** `_buyerRequest`, `_buyerGuid`, `_gwpMode`, `_openerOrigin` 네 개의 상수를 URLSearchParams로 추가했다. `render()` 함수의 AI 비서 초기화 분기에서 `_buyerRequest`가 있으면 채팅창을 자동으로 열고, `[BUYER_REQUEST] ...` 형식의 메시지를 `_aiHistory`에 직접 삽입한 뒤 `_callSellerAI('')`를 600ms 딜레이로 호출해 판매자 AI 비서가 먼저 응대를 시작하게 했다.

**교훈:** 단순 조회용으로 설계된 페이지에 "자동 실행" 기능을 추가할 때는, 기존 파라미터 파싱 로직이 새 파라미터를 묵묵히 버리는지 확인해야 한다. 새 진입 경로(K-Market Agent에서의 팝업)가 기존 진입 경로(직접 방문)와 완전히 다른 초기화 흐름을 필요로 한다는 사실을 사전에 명시하지 않으면, 구현자는 기존 로직만 수정하고 새 진입 경로는 처리되지 않은 상태로 배포하게 된다.

#### 결함 F-7-2. 판매자 PDV 기록 파서가 없음

**증상:** 판매자 AI 비서가 `[SELLER_PDV:{...}]` 태그를 포함한 응답을 출력해도, `profile.html`의 `sendAIMsg()`가 이를 단순 텍스트로 렌더링했다. 판매자 측 `hondi-pdv` IndexedDB에 판매 기록이 남지 않아, 이제주는 자기 PDV에 구매 기록이 있어도 한림국수 PDV에는 판매 기록이 없는 불대칭이 발생했다.

**원인:** `profile.html`의 `sendAIMsg()`는 단순 LLM 응답 렌더링만 구현되어 있었다. 응답에서 구조화된 태그를 파싱해 후처리하는 로직이 전혀 없었다.

**수정:** `sendAIMsg()`를 `_callSellerAI()` 내부 함수로 분리하고, 응답 처리 로직을 확장했다. `[SELLER_RESPONSE:...]` 감지 시 `window.opener.postMessage(GWP_SELLER_RESPONSE, ...)`로 Market Agent에 포워딩하고, `[SELLER_PDV:...]` 감지 시 `_writeSellerPDV()`를 호출해 판매자 `hondi-pdv` IndexedDB에 기록한다. `_writeSellerPDV()`는 DB가 없으면 생성하고, `records` 스토어에 판매 레코드를 삽입한다.

**교훈:** LLM이 출력하는 구조화 태그(`[TRADE]`, `[SELLER_RESPONSE]`, `[SELLER_PDV]`)는 코드가 파싱해야만 효과가 있다. 태그 형식이 System Prompt에 정의되어 있어도, 실제로 그 태그를 처리하는 파서가 없으면 아무 효과도 없이 텍스트로 출력될 뿐이다. 새 태그를 System Prompt에 추가할 때마다, 클라이언트 코드에 그 태그를 처리하는 핸들러도 동시에 추가해야 한다는 원칙을 체크리스트에 명시해야 한다.

#### 결함 F-7-3. Market Agent(`webapp.html`)와 `profile.html` 간 `GWP_SELLER_RESPONSE` 수신 채널 부재

**증상:** 판매자 AI 비서가 `[SELLER_RESPONSE]`를 출력해 Market Agent에 `GWP_SELLER_RESPONSE`를 postMessage로 전달해도, Market Agent(`webapp.html`)가 그 메시지를 처리하는 `message` 이벤트 리스너가 없었다. Market Agent는 팝업을 열고 아무것도 기다리지 않은 채 대기 상태에 빠졌다. `[TRADE]` 블록이 자동 생성되지 않아 결제 흐름이 진행되지 않았다.

**원인:** `webapp.html`에는 `GWP_SIGN_REQUEST`를 포워딩하는 리스너는 구현되어 있었지만, `GWP_SELLER_RESPONSE`를 처리하는 리스너가 없었다. 기존 `OPEN_PROFILE` 경로에서는 `profile.html`이 주문을 처리하고 `GWP_DONE`만 돌려보내는 단방향 구조였으나, v3.0의 `OPEN_SELLER_AI` 경로에서는 `profile.html`이 협상 중간값(`SELLER_RESPONSE`)을 중간에 한 번 더 보내는 양방향 구조로 바뀌었다. 이 새 흐름에 대응하는 수신 코드가 없었다.

**수정:** `OPEN_SELLER_AI` 처리 블록 내에 `sellerResponseHandler`를 추가했다. `GWP_SELLER_RESPONSE` 수신 시 `seller_response.accept` 값을 확인하고, 수락이면 `[TRADE]` 블록을 자동으로 조립해 `_parseTrade()`를 호출한다. 거절이면 사유를 출력하고 대안 판매자 탐색을 제안한다. 기존 `gwpDoneHandler`는 그대로 유지하되, 거래 완결 시 두 핸들러 모두 `removeEventListener`로 해제해 메모리 누수를 방지했다. 또한 기존 `OPEN_PROFILE` 처리 코드와 새 `OPEN_SELLER_AI` 처리 코드를 단일 블록으로 통합해, 두 태그가 다른 부분을 중복 처리하던 코드 중복을 제거했다.

**교훈:** "A가 B에게 메시지를 보낸다"는 설계는 "B가 그 메시지를 받아 처리한다"는 코드가 반드시 짝으로 존재해야 한다. postMessage 방식은 보내는 쪽에서 실패 여부를 알 수 없고, 받는 쪽 리스너가 없어도 에러가 발생하지 않는다(부록 E-3 경쟁 상태와 같은 특성). 새 메시지 유형을 설계할 때는 "이 메시지를 처리하는 리스너가 어느 파일의 어느 함수에 있는가"를 수신 측부터 먼저 확인하는 것이 안전하다.

---

### F-8. 수정된 파일 목록

| 파일 | 변경 내용 |
|---|---|
| `prompts/personal-assistant/personal-assistant-v1.0.txt` | 신규. PHASE 0~3 포함 나만의 AI 비서 SP |
| `src/gopang/core/config.js` | `CFG.system` personal-assistant SP로 교체 + `loadPersonalAssistantSP()` 추가 |
| `src/gopang/ui/welcome.js` | Profile 온보딩 트리거 + `handleProfileSubmit()` + PDV IndexedDB 초기화 |
| `src/gopang/ai/call-ai.js` | `PROFILE_SUBMIT` 감지 훅 + `hondi_profile_step` 갱신 |
| `src/gopang/core/free-model-pool.js` | 16K+ 컨텍스트 모델 우선 정렬 (COMMON-01 v4.0 704 tokens 대응) |
| `gopang.net/profile.html` | `buyer_request` 파라미터 파싱 + `_callSellerAI()` 분리 + `SELLER_RESPONSE`/`SELLER_PDV` 파서 |
| `market.gopang.net/webapp.html` | `OPEN_SELLER_AI` 태그 처리 + `GWP_SELLER_RESPONSE` 수신 리스너 + `OPEN_PROFILE` 통합 |
