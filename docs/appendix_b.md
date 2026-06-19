## 부록 B. 구현 중 발견된 운영 노하우 및 보안 결함 사례

> 본 부록은 2026년 6월 고팡 PC→휴대폰 LLM API Key 암호화 동기화 기능 개발 과정에서 실제 코드 분석과 디버깅을 통해 드러난 구조적 사실, 보안 결함, 아키텍처 의사결정의 경위를 정리한 것입니다. 설계 문서가 아니라 실전에서 확인된 사례 모음이며, 향후 유사한 기능을 구현하거나 외부 보안 감사를 받을 때 참고 자료로 삼기 위해 기록합니다.

---

### B-1. SPA 페이지 로더의 구조적 한계 I — innerHTML 삽입 시 script 비실행

`desktop.html`의 `loadPage()` 함수는 하위 페이지(예: `pages/ai-setup.html`)를 `fetch()`로 가져와 `content.innerHTML = doc.body.innerHTML`로 삽입하는 방식으로 SPA 라우팅을 구현한다. PC의 "AI 설정" 화면에서 핸들 검색 후 "확인" 버튼을 눌렀을 때 아무 반응이 없고 콘솔 에러도 발생하지 않는 현상이 신고됐다.

원인 분석 과정에서 HTML 명세의 핵심 조항이 확인됐다. `innerHTML`로 DOM에 삽입된 `<script>` 태그는 브라우저가 실행하지 않는다. 이 동작은 예외 없는 표준이다. `ai-setup.html`의 인라인 스크립트 블록 전체(`_checkHandle`, `addBtn.onclick` 등 모든 이벤트 바인딩)가 이 규칙의 적용을 받아, 버튼은 화면에 렌더링됐지만 `onclick` 핸들러가 단 한 번도 바인딩된 적 없는 상태였다. jsdom으로 직접 재현하여 "버튼이 렌더링되고 클릭 가능하지만 콘솔 에러가 전혀 없는" 증상이 정확히 재현됐음을 확인했다.

이 시점에 사용자가 실제 운용 중인 최신 `desktop.html`을 업로드했고, 분석에 사용 중이던 사본이 Pretendard 폰트 전환과 "AI 비서"/"혼디장" 메뉴 항목이 누락된 구버전이었음이 드러났다. 이후 모든 작업은 업로드된 실제 파일을 기준으로 진행했다.

수정은 `loadPage()` 내부에 script 재실행 루프를 추가하는 것이었다. `content.querySelectorAll('script')`로 삽입된 모든 script 태그를 찾아, 각각을 `document.createElement('script')`로 새 엘리먼트를 만들고 속성(`src` 포함)과 텍스트 콘텐츠를 그대로 복사한 뒤 `oldScript.replaceWith(newScript)`로 교체한다. 브라우저는 이렇게 프로그래밍적으로 생성된 script 엘리먼트는 정상 실행한다.

**교훈:** fetch 기반 SPA 라우팅에서 `innerHTML`을 쓰는 구조는 모든 script가 사실상 사문화된다. 이 패치는 필수적이지만, B-2에서 설명하는 또 다른 함정이 존재한다.

---

### B-2. SPA 페이지 로더의 구조적 한계 II — head 영역 통째 누락

B-1의 script 재실행 패치가 적용된 이후, "전송" 버튼 클릭 시 `GopangWallet is not defined` 오류가 발생했다. 오류가 발생한 시점은 페이지 로드 직후가 아니라 사용자가 실제로 버튼을 클릭한 시점이었다.

원인은 B-1과는 메커니즘이 다른 별개의 결함이었다. `ai-setup.html`은 `<head>` 안에 `<script src="/gopang-wallet.js"></script>`를 두고 있었다. `loadPage()`가 `doc.body.innerHTML`을 추출하는 순간, `<head>` 안의 모든 내용은 추출 대상에서 원천적으로 제외된다. 즉 B-1의 재실행 루프가 아무리 완벽해도, 이 script 태그는 그 루프가 순회하는 `content` 안에 애초에 존재하지 않는다. jsdom으로 `doc.body.innerHTML`을 직접 출력해 `gopang-wallet.js`가 전혀 포함되지 않는다는 사실을 재현으로 확인했다.

이 발견은 동시에 "B-1 패치가 `src` 속성을 가진 외부 스크립트의 로딩 순서를 보장하는가"라는 추가 질문을 야기했다. 실제 파일(`file://` 프로토콜)을 대상으로 jsdom 테스트를 진행한 결과, `async`/`defer` 속성이 없는 표준 `<script src>` 태그를 동적으로 생성해 삽입하면 브라우저는 해당 파일 로드 완료를 기다린 후에야 다음 script 태그를 실행함이 확인됐다. 즉 `body` 안에서의 순서만 보장되면 외부 스크립트의 로딩 순서도 보장된다.

이 버그는 최종적으로 더 큰 아키텍처 논의(B-9)로 이어졌고, 그 결과로 `ai-setup.html`에서 `gopang-wallet.js` 의존 자체를 제거하는 방향이 선택됐다. 하지만 근본 원인으로서 "`<head>`에 있는 모든 것은 SPA 로더에게 존재하지 않는다"는 사실은 독립적인 교훈으로 기록한다.

**교훈:** `fetch` 기반 SPA 라우터가 `doc.body.innerHTML`만 추출하는 구조에서, 하위 페이지가 `<head>`에 두는 `<link>`, `<script>`, `<style>` 등은 전부 로더에 의해 묵묵히 버려진다. 하위 페이지의 모든 의존성은 `<body>` 안에 있거나, 셸 페이지(`desktop.html`)에서 전역으로 로드해야 한다.

---

### B-3. LLM 모델 표시 버그 — 미등록 상태인데도 기본값이 표시되는 문제

PC의 AI 설정 화면 상단에 "등록된 LLM 모델"을 표시하는 영역이 있는데, 아직 모델을 등록하지 않은 상태에서도 `deepseek-v4-flash`가 표시되는 버그가 발견됐다.

원인은 `openAISettings()` 함수가 model과 system prompt를 표시할 때 `CFG.model`을 직접 참조하고 있었던 것이다. `CFG`는 초기화 시 `model: 'deepseek-v4-flash'`를 기본값으로 갖고 있어, `localStorage`에 실제 등록된 설정이 없어도 항상 이 값이 표시됐다.

수정은 `localStorage.getItem('gopang_cfg')` 존재 여부를 먼저 확인하는 것이었다. PC sync로 실제 등록이 완료되면 이 키가 설정되므로, 키가 없는 경우에는 "미등록" 상태로 표시하고, 키가 있는 경우에만 `CFG.model`을 화면에 반영하도록 변경했다.

**교훈:** UI의 "현재 상태 표시" 영역은 기본값이 아닌 실제 서버/로컬 상태를 반영해야 한다. 초기화 기본값을 그대로 표시하면 사용자가 등록이 완료된 것으로 오인할 수 있다.

---

### B-4. 워커 핸들러 전반의 에러 핸들링 부재 — 표면적 503의 숨은 원인

PC에서 `@11111112` 핸들을 검색할 때 503 오류가 반환됐다. 워커 로그를 확인하지 않아도 가설을 세울 수 있었다: Cloudflare Workers 런타임은 핸들러 함수에서 처리되지 않은 예외(unhandled exception)가 발생하면 자동으로 503을 반환한다. 즉 503은 "서버가 다운됐다"가 아니라 "핸들러 코드가 예외를 던지고 죽었다"는 신호일 수 있다.

"사고실험(deeper investigation)" 지시에 따라 전체 `worker.js`를 전수 조사한 결과, Supabase `fetch()`를 호출하는 핸들러 중 try/catch 없이 작성된 것이 총 14개 확인됐다. 이 중 PC-휴대폰 동기화 핵심 흐름에 해당하는 7개(`handleProfileGet`, `handleWalletX25519Get`, `handleWalletX25519Post`, `handleAiSetupSealPost`, `handleAiSetupSealGet`, `handleProfilePost`, `handleAiSetupPost`)를 우선 순위 대상으로 선정해 try/catch 보호를 추가하고, Supabase 연결 실패 시 502(`SUPABASE_UNREACHABLE`)를 명시적으로 반환하도록 수정했다. 나머지 7개 핸들러는 현재 기능 범위 밖으로 분류해 별도 추적 사항으로 남겼다.

**교훈:** 외부 서비스(Supabase, L1 등)를 호출하는 모든 워커 핸들러는 try/catch로 보호해야 한다. 503은 문제의 실제 위치와 원인을 드러내지 않는다. 명시적 오류 코드(502 SUPABASE_UNREACHABLE 등)를 반환하면 클라이언트와 로그 양쪽에서 진단이 훨씬 쉬워진다. 새 핸들러를 추가할 때마다 에러 핸들링을 기본 체크리스트에 포함해야 한다.

---

### B-5. 검색 정책 재정립 — L1 우선 조회, Supabase는 임시 폴백

`handleProfileGet`이 핸들로 사용자를 검색할 때 Supabase만 조회하고 L1 PocketBase는 전혀 거치지 않는다는 사실이 코드 분석으로 확인됐다. 이는 "OpenHash에서 검색은 L1이 기본, Supabase는 임시 보조"라는 시스템 설계 원칙과 정면으로 배치됐다.

원칙 재확인과 함께 `handleProfileGet`을 재설계했다. `_resolveGuidFromL1(handle)` 함수를 새로 추가해 L1 PocketBase(`l1-hanlim.gopang.net`)에 핸들로 먼저 조회하고, 성공하면 그 guid를 기반으로 Supabase에서 상세 프로필을 가져오는 구조로 변경했다. L1 조회가 실패하면 Supabase 핸들 직접 조회로 폴백한다. 응답에는 `identity_source: 'l1' | 'supabase-direct'`와 `detail_source: 'supabase-temporary'` 필드를 추가해, 현재 경로가 표준인지 임시 우회인지를 응답 자체에 명시했다.

**교훈:** 조회 경로가 설계 원칙과 다르게 구현되어도, 기능 자체는 동작하기 때문에 테스트만으로 발견하기 어렵다. 응답에 `identity_source` 같은 진단 필드를 포함하면 프로덕션 환경에서도 실제 경로를 추적할 수 있어 유용하다.

---

### B-6. OpenHash 표준 P2P 절차와 현재 임시 구현의 차이 명시

코드 분석 과정에서 현재 구현이 OpenHash 표준 P2P 절차를 완전히 따르지 않는다는 사실을 명시적으로 문서화했다. 표준 절차는 다음과 같다.

1. A가 L1에서 B의 존재를 guid 단위로 확인한다.
2. A가 B에게 직접 P2P 채널로 프로필 데이터를 요청한다.
3. B가 동의 응답과 함께 프로필 데이터를 A에게 직접 전송한다.
4. A가 수신한 데이터로 B의 페이지를 조합한다.

현재 구현은 1단계(L1에서 존재 확인)는 B-5에서 추가했지만, 2~3단계(P2P 직접 요청/응답)를 처리하는 채널이 아직 없어 Supabase 직접 조회로 대체하고 있다. WebRTC 시그널링 인프라(`/signal/send`, `/signal/poll`)는 이미 offer/answer/ice 교환까지 구현되어 있으나, `profile_request` 같은 새 메시지 타입이 추가되지 않아 표준 P2P 흐름의 2~3단계를 처리하지 못한다.

**교훈:** 임시 구현을 코드에 남길 때는 그 사실을 코드 주석과 응답 필드(`detail_source: 'supabase-temporary'`)에 명시해야 한다. 그래야 추후 개발자가 그것이 의도된 임시 처리임을 이해할 수 있고, 기술 부채 추적도 가능하다. 이 작업은 장기적으로 Cloudflare가 L1에 통합될 때 함께 처리할 방향으로 설계 방향이 잡혀 있다.

---

### B-7. 배포 검증의 함정 — GitHub raw URL CDN 캐싱

`npx wrangler deploy`가 성공했음에도 `raw.githubusercontent.com`으로 `worker.js`를 확인하면 이전 내용이 그대로 보이는 혼란이 발생했다. 사용자가 Cloudflare 대시보드에서 복사한 워커 코드를 공유했는데, 이 역시 직전 단계의 내용이었다. 어느 방법으로도 최신 배포를 즉시 확인하기 어려운 상황이 이어졌다.

원인은 GitHub raw URL의 CDN 캐싱이었다. `raw.githubusercontent.com`은 브랜치명(예: `main`)을 키로 캐싱하므로, 새 커밋을 푸시해도 캐시가 만료되기 전까지 이전 내용을 반환한다. 이것은 Cloudflare CDN과는 별개로 GitHub 측에서 동작하는 캐시다. 결국 특정 커밋 해시를 URL에 명시해 캐시를 우회하거나, `git log`로 최신 커밋을 확인한 뒤 그 해시로 직접 요청하는 방법으로 정확한 배포 내용을 검증했다.

**교훈:** 브랜치명 기반의 GitHub raw URL은 배포 검증 도구로 신뢰할 수 없다. 배포 직후 코드 검증은 커밋 해시를 명시한 URL로 하거나, Cloudflare 대시보드의 "Quick Edit" 등 실제 실행 환경에서 직접 확인해야 한다.

---

### B-8. Google AI Studio AQ. 접두사 키 — 외부 플랫폼 버그와 대응 전략

Gemini API Key 형식 검증 로직(`v.startsWith('AIza')`)이 정상 키를 거부하는 현상이 발생했다. 사용자가 Google AI Studio의 정식 "API key details" 화면에서 발급받은 키가 `AIzaSy...` 대신 `AQ.Ab8RN6...`으로 시작하는 형식이었다.

웹 검색으로 이것이 2026년 6월 현재 다수의 사용자가 경험 중인 Google 측 광범위한 이슈임을 확인했다. `AQ.`로 시작하는 값은 진짜 API 키가 아니라 Google OAuth 2.0 액세스 토큰 형식이며, `Authorization: Bearer`, `x-goog-api-key` 헤더, `?key=` 쿼리 파라미터 등 모든 전달 방식에서 `ACCESS_TOKEN_TYPE_UNSUPPORTED` 또는 `Expected OAuth 2 access token` 오류가 발생해 실제 API 호출이 불가능하다. Google 측에서 계정 수준에서 이 형식을 발급하는 동안에는 코드 수정으로 해결할 수 있는 문제가 아니다.

또한 이 과정에서 사용자가 실제 API 키(`AIzaSyA-c-...`)를 대화창에 직접 붙여넣는 상황이 발생했다. 대화 기록에 평문 비밀 키가 남게 되므로, Google AI Studio에서 해당 키를 즉시 폐기하고 재발급할 것을 권장했다.

**교훈:** 외부 플랫폼의 키 발급 정책은 사전 공지 없이 변경될 수 있다. 클라이언트의 형식 검증 로직은 "현재 알려진 형식만 허용"이 아니라 "명백히 잘못된 형식을 차단"하는 방향으로 작성해야 유지보수 비용이 낮아진다. API 키 등 민감한 시크릿은 어떤 이유로든 대화창, 이슈 트래커, 공개 슬랙 채널에 붙여넣어서는 안 된다.

---

### B-9. GopangWallet PC 탑재 여부 — 보안 아키텍처 결정 과정

`GopangWallet is not defined` 오류(B-2)의 수정 방향을 논의하는 과정에서, 근본적인 아키텍처 질문이 제기됐다: "PC가 하는 일이 공개키를 찾아서 전송하는 것뿐인데 왜 1,285줄 규모의 지갑 모듈 전체가 필요한가?" 이 질문은 세 가지 선택지를 낳았다.

1. `gopang-wallet.js` 전체를 `<body>`로 이동해 B-2 문제만 해결
2. `sealForRecipient`에 필요한 알고리즘만 `ai-setup.html` 안에 경량 인라인으로 구현
3. `gopang-wallet.js`에서 `GopangWallet.sealForRecipient()`를 그대로 호출

선택지 2가 최종 선택됐다. 이유는 다음과 같다. 첫째, `gopang-wallet.js`는 Ed25519 키 생성, IndexedDB 저장, 서명, 해시체인 기록 등 휴대폰 전용 기능을 포함한다. PC가 이를 로드하면 보안 표면이 넓어지고, 추후 실수로 PC 코드에서 이 기능을 호출해 "PC에서 지갑에 기록"하는 설계 원칙 위반이 생길 위험이 있다. 둘째, 이번 버그의 원인(외부 파일 의존)이 구조적으로 사라진다. 셋째, `sealForRecipient`에 필요한 코드는 헬퍼 함수 두 개 포함 총 35줄에 불과하다.

인라인 구현은 원본 `gopang-wallet.js`의 `sealForRecipient`와 diff로 대조해 알고리즘이 한 글자도 다르지 않음을 검증했다(함수명 앞 언더스코어 추가, 빈 줄 제거 외 동일). 휴대폰 쪽 복호화(`openSealed`)는 동일한 `ephemeralPubKey`/`iv`/`ciphertext` 필드명과 X25519 ECDH + AES-256-GCM 알고리즘을 그대로 기대하므로 완전 호환된다.

**교훈:** 공유 모듈을 "일단 로드"하는 것은 편리하지만, 그 모듈이 로드된 환경에서 하면 안 되는 동작까지 가능하게 만드는 부작용이 있다. 역할이 명확히 분리된 컴포넌트(PC vs 휴대폰)에서는 각 컴포넌트가 실제로 필요한 최소한의 코드만 포함하는 것이 보안과 유지보수 모두에 유리하다.

---

### B-10. PC 역할 한정 원칙 — 입력 미러, 지갑/PDV 기록 금지

아키텍처 논의 과정에서 PC의 역할에 대한 핵심 설계 원칙이 명시적으로 정립됐다.

> **PC는 LLM API Key 입력으로 그 역할을 한정한다. PC가 Wallet이나 PDV에 기록하면 스마트폰과의 동기화 문제가 발생한다. 열람은 가능해도 기록이나 수정은 불가.**

이 원칙의 배경은 다음과 같다. GDC Wallet의 권한은 휴대폰에 묶여 있다. PC는 "입력 미러"로서 사용자가 긴 API 키를 타이핑하기 편한 키보드가 있다는 물리적 이유에서만 존재한다. 만약 PC가 지갑이나 PDV에 기록하면, 그 시점부터 "진짜 상태"가 어느 기기에 있는지가 모호해져 동기화 충돌이 발생한다.

이 원칙은 B-9의 구현 결정(PC에서 `gopang-wallet.js` 전체를 제거하고 암호화 전용 최소 코드만 남긴 것)의 직접적인 근거가 됐다. 또한 향후 PC에 기능을 추가할 때 "이것이 읽기인가 쓰기인가"를 먼저 판단하는 기준이 된다.

**교훈:** "PC는 입력 미러"라는 역할 정의를 코드 레벨에서 강제하는 가장 확실한 방법은, 쓰기 기능 자체를 PC 코드에 두지 않는 것이다. 원칙이 아무리 명확해도 코드에 그 기능이 존재하면 우발적 호출의 위험이 남는다.

---

### B-11. ai_setup_seals 테이블의 Cloudflare KV 전환 — 저장소 선택 기준

`/ai-setup/seal` POST 요청에서 Supabase RLS 오류(`42501: new row violates row-level security policy`)가 발생했다. 근본 원인은 `_sbServiceHeaders(env)`의 환경변수 폴백 체인(`env.SUPABASE_SERVICE_KEY || env.SUPABASE_KEY || anonKey`)에서 `SUPABASE_SERVICE_KEY`가 미설정되어 anon key로 조용히 폴백된 것이었다.

수정 방향을 논의하는 중 "이 데이터가 정말 Supabase에 있어야 하는가"라는 근본 질문이 제기됐다. `ai_setup_seals` 테이블의 데이터 수명 주기를 분석하면, PC가 INSERT하고 휴대폰이 SELECT 후 즉시 DELETE하며 5분 TTL로 자동 폐기된다 — 전형적인 "단기 메시지 큐/우편함" 패턴이다. 이를 Cloudflare Workers KV로 이전하면 다음이 가능해진다.

- RLS 정책이 없으므로 42501 오류 자체가 구조적으로 불가능하다.
- `expirationTtl` 파라미터로 TTL을 네이티브 지원하므로 `expires_at` 컬럼 관리가 불필요하다.
- DELETE + INSERT 2회 호출이 `put()` 1회로 단순화된다(KV는 같은 키에 덮어쓰기 기본 동작).

KV 네임스페이스(`AI_SETUP_SEALS_KV`, id: `e1ae4dd08b344f9c9208ea4235e17d3e`)를 생성하고, `handleAiSetupSealPost`/`Get`을 KV 기반으로 재작성했다. 클라이언트(`settings.js`)가 기대하는 응답 필드 구조는 동일하게 유지했다.

이 과정에서 "P2P가 본질인 고팡에서 Cloudflare를 반드시 거쳐야 하는가"라는 질문도 제기됐다. WebRTC 직접 연결(시그널링 인프라는 이미 존재)로 이 구간을 대체하면 봉투 데이터가 서버를 전혀 경유하지 않게 된다. 다만 두 기기가 동시에 온라인이어야 한다는 제약이 생기고, 구현 공수가 상당하다. 현재는 KV 방식으로 먼저 기능 검증을 완료하고, 장기적으로 Cloudflare가 L1에 통합되는 시점에 WebRTC 직접 전송으로 전환하기로 방향을 잡았다.

**교훈:** 관계형 DB(Supabase)는 영구 데이터와 복잡한 쿼리에 최적화되어 있다. 수명이 수분에 불과한 임시 데이터는 TTL 네이티브 지원, 행 단위 권한 정책 부재, 단순 키-값 구조라는 이점을 가진 KV 스토어가 구조적으로 더 적합하다. 저장소 선택은 데이터의 수명 주기와 접근 패턴을 먼저 분석한 뒤 결정해야 한다.

---

### B-12. provider 화이트리스트의 구조적 문제 — 중복 정의에서 형식 검증으로

KV 전환 후 테스트를 재개하자 "허용: deepseek|anthropic|openai|custom"이라는 오류가 발생했다. `worker.js`의 `handleAiSetupPost`에 하드코딩된 `validProviders` 배열에 `'gemini'`가 누락되어 있었다.

이 단일 누락 사례를 진단하는 과정에서 더 큰 구조적 문제가 확인됐다. provider 목록이 세 곳에 독립적으로 존재한다.

1. `src/gopang/core/config.js`의 `PROVIDER_INFO` — 클라이언트, `baseUrl`/`keyField` 포함
2. `worker.js`의 `validProviders` 배열 — 서버, 단순 문자열 배열
3. `pages/ai-setup.html`의 `GUIDES` 객체 — PC, 발급 안내/검증 정규식 포함

새 provider를 추가할 때 세 파일을 동시에 정확히 맞춰야 하는데, 하나라도 빠뜨리면 오늘과 동일한 오류가 재발한다. 더 중요하게, 워커는 `provider` 값으로 직접 API를 호출하지 않는다 — 그 값은 단순히 `user_llm_keys` 테이블의 컬럼 값으로 저장될 뿐이다. 화이트리스트가 보안 경계 역할을 하지 않으며, 오타/이상값 유입을 방지하는 용도에 불과하다.

따라서 화이트리스트를 형식 검증으로 교체했다: `/^[a-z0-9-]{2,30}$/`. 기존 5개 provider와 미래의 `mistral`, `xai-grok` 등도 모두 통과하고, 1글자, 빈 값, 대문자, 한글 등 명백히 잘못된 값은 차단한다. 이로써 향후 클라이언트에 새 provider를 추가해도 워커 코드는 전혀 수정할 필요가 없어졌다.

**교훈:** 동일한 목록이 클라이언트와 서버에 중복 정의되면 동기화 부담이 생긴다. "목록을 갱신하는 자동화"보다 "갱신할 필요 자체를 없애는 설계"가 더 근본적인 해결이다. 서버가 직접 사용하지 않는 값을 검증할 때는, 내용 기반 화이트리스트 대신 형식 기반 검증이 유지보수 비용이 낮다.

---

### B-13. consume=1 소비 후 최종 등록 실패 시 복구 전략

휴대폰에서 "등록 중 오류"가 발생한 직후, "새로고침 / 로그아웃 / 기기 초기화 중 어느 것이 필요한가"라는 질문이 제기됐다.

상태를 단계별로 추적했다. 봉투는 GET 시 `consume=1` 파라미터로 즉시 KV에서 삭제된다. 그러나 그 시점에 복호화된 평문(`provider`, `model`, `apiKey`, `systemPrompt`)은 `_acceptPcSyncedSetting` 함수의 클로저 변수 `parsed`에 남아 있다. 오류를 발생시킨 것은 그 다음 단계인 `/ai-setup` POST 요청에 대한 워커의 400 거부였으며, `catch` 블록은 `alert`만 띄우고 화면의 "이 설정으로 등록하기" 버튼을 비활성화하거나 숨기지 않는다. 즉 `parsed`와 버튼 모두 그대로 유지된다.

결론: 새로고침, 로그아웃, 기기 초기화는 모두 불필요하다. 워커 수정을 배포한 뒤 같은 화면에서 버튼을 다시 누르면 동일한 데이터로 재시도가 가능하다. 이미 화면을 벗어난 경우에만 PC에서 전송을 한 번 더 시도해야 한다(봉투가 이미 소비됐으므로).

**교훈:** `consume=1` 소비 이후 최종 등록 실패는 "데이터 손실"이 아니다. 복호화된 평문은 메모리에 남아 있고, 재시도 경로가 열려 있다. 오류 복구 UX를 설계할 때 "어떤 데이터가 메모리에 남아 있는가"와 "어떤 UI 요소가 여전히 활성화되어 있는가"를 분석하면, 불필요한 재시작 절차를 요구하지 않는 더 부드러운 복구 경로를 설계할 수 있다.

---

### B-14. Cloudflare Worker 환경변수 미설정 — AES_ENCRYPTION_KEY 누락

`validProviders` 문제가 해결된 뒤 "AES 키 미설정" 오류(`ENCRYPTION_KEY_MISSING`)가 발생했다. 최종 등록 핸들러가 `api_key`를 `_aesEncrypt()`로 암호화해 `user_llm_keys` 테이블에 저장하는 과정에서, `env.AES_ENCRYPTION_KEY`가 Cloudflare Workers 환경에 등록되지 않았음이 확인됐다.

`_aesEncrypt()`는 `_hexToBytes(keyHex)`로 키를 변환하므로, `AES_ENCRYPTION_KEY`는 64자리 16진수 문자열(256비트 AES-GCM 키)이어야 한다. 대화창에 키 값을 붙여넣으면 대화 기록에 평문이 남으므로, PC의 PowerShell에서 직접 생성하도록 안내했다.

```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
```

생성된 값은 `npx wrangler secret put AES_ENCRYPTION_KEY`로 등록한다. `wrangler secret put`은 값이 화면에 표시되지 않고 Cloudflare에 암호화되어 직접 저장되므로, git 커밋이나 코드에 노출되지 않는다. secret 등록은 별도의 `wrangler deploy` 없이 즉시 적용된다.

**교훈:** 기능이 특정 환경변수에 의존한다면, 그 환경변수가 설정되지 않았을 때의 오류 메시지를 명확하게 만들어야 한다(`ENCRYPTION_KEY_MISSING`). 비밀 키는 대화창, 소스 코드, 환경 변수 파일이 아닌 `wrangler secret`처럼 비밀 관리 전용 도구를 통해 등록해야 한다. 초기 인프라 설정 체크리스트에 모든 필수 secret을 명시하면 이런 종류의 지연을 예방할 수 있다.

---

### B-15. UI 폴리시 — 전송 완료 안내를 모달로, 섹션 번호 재배치

PC AI 설정 화면에서 두 가지 UI 개선이 요청됐다.

첫째, "AI 비서 시스템 프롬프트 (선택)" 입력 영역이 "1. 추가할 LLM 모델 선택"과 "2. 발급받은 API Key 입력" 사이에 끼어 있었다. 사용자 입력 순서가 모델 → 프롬프트 → 키 순서가 되어 직관적이지 않다. 수정 후 순서는 1. 모델 선택 → 2. API Key 입력 → 3. AI 비서 시스템 프롬프트(선택)다. 가장 핵심적인 두 입력(모델과 키)을 연속으로 배치하고, 선택 사항인 프롬프트를 마지막으로 밀어내는 구조가 더 자연스럽다.

둘째, "전송" 버튼 클릭 후 표시되던 메시지가 페이지 상단 "등록 현황" 카드의 13px 텍스트로, 스크롤 위치에 따라 시야 밖에 있을 수 있고 시각적으로 눈에 잘 띄지 않았다. 이 메시지는 "지금 휴대폰으로 가서 확인하라"는 즉각적인 행동 유도가 목적이므로, 사용자가 반드시 인지해야 한다. 화면 중앙의 모달 팝업으로 대체했다: 어두운 반투명 배경 오버레이, 🔒 아이콘, 굵은 제목, 안내 본문, "확인" 버튼으로 구성했으며 배경 클릭으로도 닫힌다.

**교훈:** "전송 완료"처럼 사용자가 즉시 다른 행동(기기 전환)을 해야 하는 피드백은 화면 어딘가에 인라인으로 표시하는 것으로는 부족하다. 모달은 명시적 확인 행위를 요구하므로 놓칠 수 없다. UI 섹션의 순서는 "사용자가 자연스럽게 읽어 내려가는 흐름"과 "필수/선택 입력의 우선순위"를 함께 고려해 결정해야 한다.
