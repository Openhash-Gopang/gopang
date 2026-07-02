## 부록 D. 각 파일의 역할과 주요 함수

> 본 부록은 고팡(Openhash-Gopang/gopang) 저장소의 파일을 디렉토리별로 정리한 참조 카탈로그다. 설명이 아니라 색인이 목적이므로 각 항목은 의도적으로 짧게 적었다. 함수명은 실제 코드에서 직접 추출한 것이며, 추정이나 설계 의도가 아니라 **지금 저장소에 실재하는 export/선언**만 실었다.
>
> **가장 먼저 알아야 할 사실** — 이 저장소에는 서로 무관하게 공존하는 **두 개의 아키텍처 트랙**이 있다. 하나는 `webapp.html`이 실제로 부팅하는 **운영 중 트랙**(`gopang-app.js` → `src/gopang/**`, 그리고 `src/pdv/vault.js`·`src/openhash/hashChain.js` 일부)이고, 다른 하나는 `src/app.js`를 진입점으로 하는 **이벤트버스/플러그인 기반 트랙**(`src/core/*`, `src/domains/*`, `src/ai-secretary/*`, `src/network/*`, `src/gdc/*`, `src/privacy/*`, `src/profile2.0/*`, `src/shell-ui.js`)인데, **이 트랙을 로드하는 HTML이 저장소 안에 하나도 없다.** 즉 두 번째 트랙은 코드는 존재하지만 지금 운영되는 고팡에는 연결되어 있지 않다. 아래 카탈로그에서는 각 절 제목에 `[운영 중]` 또는 `[미통합 트랙]` 표시를 달아 이 구분을 명확히 했다. 디버깅 시 "이 파일을 고쳤는데 왜 반영이 안 되지?"라는 의문이 들면 가장 먼저 이 표시를 확인할 것.

---

### D-1. 진입점 HTML

| 파일 | 역할 |
|---|---|
| `webapp.html` | **스마트폰 전용 실제 앱 화면.** `<head>` 최상단에서 `navigator.userAgent`로 PC를 차단(개발자 우회: `localStorage.gopang_dev_bypass`). `gopang-app.js`(module)·`gopang-wallet.js`·`gwp-registry.js`·`src/auth/gopang-auth.js`·`src/pwa/gopang-pwa.js`를 로드. |
| `desktop.html` / `desktop_.html` | PC용 랜딩/런처 페이지("혼디(Hondi) — AI 자율 시장 플랫폼"). 프로젝트 JS는 로드하지 않고 "웹앱 열기"·"AI 설정"·"Whitepaper" 버튼으로 다른 페이지에 링크한다. 거의 동일한 두 파일이 존재(`desktop_.html`은 작업용 임시본으로 추정). |
| `old_desktop_2432.html` | 이전 버전의 데스크톱 페이지. 비교용으로 남아있는 듀티/사장본. |
| `index.html` | 최상위 루트 페이지("고팡"). |
| `profile.html` | 사용자 프로필 표시 페이지. `gopang-wallet.js`만 로드. |
| `register-profile.html` | 신규 가입 시 프로필 등록 폼. |
| `feedback.html` | 사용자 제안/피드백 현황 페이지. |
| `404.html` | 표준 404 오류 페이지(GitHub Pages). |
| `auth/silent-auth.html` | 다른 고팡 하위 서비스(K-Law 등)가 iframe으로 띄워 인증 토큰을 조용히 발급받는 페이지. `auth/gopang-sso.js` 사용. |
| `pages/*.html` | 정적 소개 페이지 모음 — `ai-setup.html`(AI 비서 활성화 안내), `klaw.html`/`openhash.html`/`overview.html`(서비스 소개), `agents.html`, `metrics.html`, `ai-types.html`, `hondi-market.html`, `teasers.html`. |
| `docs/*.html` | 백서·설계 문서 모음(HTML로 작성된 정적 문서) — 사업계획서(`bizplan.html`), Supabase DB 매뉴얼, 제주 시스템/모듈 설계도, 기술 백서, 한림읍 마스터플랜, OFP 표준화 계획서, OpenHash 백서. |
| `tools/index_template.html` | K-Law 등 하위 서비스 배포 시 쓰는 `{{VERSION}}` 치환형 HTML 템플릿. |

---

### D-2. 루트 레벨 전역 스크립트 `[운영 중]`

이 파일들은 ES 모듈이 아니라 `<script>` 전역 스크립트(또는 일부만 module)로 로드되며, `window` 객체에 직접 기능을 노출한다.

**`gopang-app.js`** (520줄) — 앱 부트스트랩 진입점. `_boot()`가 6단계 부팅(코어 초기화 → PDV/OpenHash 준비 → 도메인 플러그인 등록 → AI 비서 파이프라인 준비 → Network/GDC/Privacy 준비 → Shell UI 렌더링)을 수행하고, 등록된 사용자라면 `startIncomingWatch()`(P2P 수신 대기)와 AI 설정 자동 동기화 루프(`_runSync`, 60초 간격 + 푸시 트리거)를 시작한다. 레거시 `_startSignalPoll()` 호출은 부록 C-5 결함으로 제거됨. 주요 함수: `_showWelcomePopup`, `_closeWelcome`, `_showRegisterGuide`.

**`gopang-wallet.js`** (1285줄) — `GopangWallet` 클래스(IIFE로 `global.GopangWallet`/`global.gopangWallet`에 노출). Ed25519 서명 키와 X25519 암호화 키를 IndexedDB(`gopang-wallet`, v3)에 저장. 핵심 메서드: `static load(passphrase)`(싱글턴 로드/생성), `signPayload(payload)`(단순 서명), `sign(rawTx)`(트랜잭션 빌드 서명 — 한때 `signPayload`와 이름이 같아 충돌했던 메서드, 부록 A-2 참고), `verify`, `openSealed`(X25519 복호화), `registerPublicKey`, `getFinancialState`/`getBalance`, `redeemClaim`.

**`gwp-registry.js`** (409줄) — GWP(Gopang Widget Protocol) 서비스 레지스트리. `window.GWP_REGISTRY`로 노출되는 서비스 목록과 `matchService(input)`(사용자 입력에서 어떤 하위 서비스를 호출할지 매칭), `getService(id)`, `getByCategory(category)`.

**`sw.js`** (229줄) — Service Worker. `install`(사전 캐시, `skipWaiting`)·`activate`(이전 캐시 정리)·`fetch`(네트워크 우선 + 5초 타임아웃 폴백)·`message`(`SKIP_WAITING` 수신)·`push`(알림 표시 + AI설정 동기화 시 `SYNC_AI_SETTING` postMessage)·`notificationclick`·`pushsubscriptionchange` 이벤트를 처리. `CACHE_NAME`은 `deploy.ps1`이 배포마다 자동 갱신(부록 C-9 참고).

**`worker.js`** (2506줄) — Cloudflare Worker. **외부 모듈을 import하지 않는 완전한 단일 파일**이며 31개 이상의 `/경로` 라우트를 직접 처리한다. 주요 라우트 그룹: 인증(`/auth/*`, `/svc/*`), 시그널링(`/signal/send`·`/signal/poll`·`/signal/delete`), TURN(`/turn/credential`), P2P 검색(`/p2p/register`·`/p2p/search`), 지갑(`/wallet/x25519`), AI(`/ai/chat`·`/chat/completions`·`/ai-setup*`), 비즈니스(`/biz/*`), PDV(`/pdv/*`), 푸시(`/push/*`), 검색(`/search*`), 피드백(`/feedback*`). 시그널 저장은 L1(PocketBase) 우선·Supabase 폴백 구조(`_l1SignalSend`/`_l1SignalPoll`/`_l1SignalDelete`, 부록 C-2·C-8 참고).

**`report/gopang-report.js`** — 고팡 하위 서비스(K-Law 등)가 `/pdv/report`로 보고서를 전송하는 독립 배포 라이브러리(`hondi.net/report/`에서 import해서 씀). `sendReportOnce`, `flushReportQueue`(오프라인 큐 재전송), `getReportStatus`, `buildReport`.

---

### D-3. `src/gopang/core/` — 상태·인증·설정 `[운영 중]`

- **`state.js`** — 앱 전역 상태(싱글턴). `_USER`, `_rtcConn`/`_rtcChannel`(P2P 연결, 부록 C에서 다룬 모듈 간 공유 지점), `_peer`, `history`, AI 활성 상태 등. `PROXY` 상수(`gopang-proxy.tensor-city.workers.dev`)와 `fetchRtcConfig(guid)`(TURN credential 조회, 부록 C-3)가 이 파일에 있음.
- **`auth.js`** (1300줄+) — 인증 핵심. `initAuthWithPhone(digits, countryKey)`(전화번호 마지막 8자리 → SHA-256 → IPv6 GUID), `_isRegistered`, `_registerToL1`, `_deviceFullReset`/`_deviceLocalReset`, `ensureX25519Synced(guid)`(PC↔폰 AI 키 동기화용 X25519 키 확인·서버 등록), `_injectAuthConfirmButton`. 기존 사용자가 새 기기로 로그인할 때 키 동기화 코드가 실행되지 않는 점이 부록 A-1과 연결됨.
- **`config.js`** — LLM 모델 설정. `PROVIDER_INFO`, `_providerOf(model)`(부록 A-7에서 다룬 provider/model 매칭 문제와 같은 패턴), `CFG`, `saveSettings`/`loadSettings`, `VISION_MODELS`.
- **`free-model-pool.js`** — OpenRouter 무료 모델 목록 관리. `buildLiveFreeModelPool()`.
- **`session.js`** — 채팅 세션 저장. `_saveOnce()`(PDV vault 저장 + OpenHash 앵커링, `pdv/vault.js`·`openhash/hashChain.js`를 동적 import).

### D-4. `src/gopang/ui/` — 화면 컴포넌트 `[운영 중]`

- **`p2p-chat.js`** (730줄+) — **P2P 채팅의 중심 모듈.** 부록 C 전체가 이 파일을 다룬다. `startP2PCall(targetUser)`(발신), `handleIncomingOffer(signal)`(수신, `confirm()` 다이얼로그 포함), `startIncomingWatch(myGuid)`(부팅 시 상시 가동되는 수신 대기). 비공개 헬퍼: `_watchAnswerRealtime`, `_setupConn`, `_setupChannel`, `_closeP2P`, `_startPoll`/`_stopPoll`, `_openChatUI`.
- **`p2p-search.js`** — 사용자 검색 오버레이. `openSearch()`(p2p-chat과 동명 함수가 `search.js`에도 있어 혼동 주의).
- **`search.js`** — 일반(AI 비서 대상이 아닌) 사용자/서비스 검색. `openSearch`, `closeSearch`, `runSearch`, `selectContact`/`openProfile`(둘 다 빈 스텁).
- **`settings.js`** (930줄+) — 설정 패널 전체. `openSettings`/`openAISettings`/`closeAISettings`, `_refreshFreeModelPool`, `_autoApplyPcSyncedSetting()`(AI 설정 자동 동기화의 실제 로직, `gopang-app.js`의 `_runSync`가 호출), `openChatHistory`, `openHashChain`, `openGopangWallet`, `openFinancialStatement`, `openMyProfile`.
- **`register-flow.js`** — 미가입 사용자가 P2P 통화를 시도할 때 가입 흐름을 먼저 띄우는 로직. `_showRegisterFlowThenPeer(pendingPeer)`(가입 완료 후 `setPeer()` 자동 호출).
- **`send-message.js`** — AI 챗 입력창 처리. `sendMessage`, `handleKey`, `autoResize`, `updateSendBtn`.
- **`bubble.js`** — 채팅 말풍선 렌더링. `appendBubble`, `showTyping`/`hideTyping`, `riskChip`(K-Law/K-Health 위험도 표시).
- **`file-attach.js`** — 이미지/파일 첨부. `triggerAttach`, `triggerCamera`, `handleFileSelect`.
- **`progress.js`** — AI 처리 중 진행 단계 표시 UI. `_progressStart`/`_progressNext`/`_progressSetStep`.
- **`welcome.js`** — 첫 진입 환영 메시지. `_showWelcomeMessage`.

### D-5. `src/gopang/p2p/` — WebRTC 시그널링 `[운영 중]`

- **`webrtc.js`** — `setPeer(peer)`(현재는 `p2p-chat.js`의 `startP2PCall`로 위임하는 진입점, 부록 C-1 참고), `_sendP2P`, `_closeRTC`, `_startSignalPoll()`(레거시 폴러 — 호출부는 제거됐으나 함수 자체는 코드에 남아있음, 부록 C-5).
- **`webrtc-realtime.js`** — Supabase Realtime 구독 보조 모듈. `startRealtimeSignal(myGuid, onSignal)`, `isRealtimeActive()`.

### D-6. `src/gopang/ai/`, `services/`, `gwp/`, `pdv/` `[운영 중]`

- **`ai/call-ai.js`** — `callAI(userText, imageFile)`: AI 비서 호출의 메인 진입점.
- **`ai/router.js`** — `runRouter`/`applyRouterResult`: 어떤 LLM·도메인 플러그인으로 라우팅할지 결정.
- **`ai/vision.js`** — Gemini Vision 이미지 분석. `_callGeminiVision`, `_callGeminiGeneral`, `_extractExif`.
- **`ai/weather.js`** — 위치 기반 날씨 조회(`_fetchWeather`, `_fetchMarineWeather` — 해양 날씨 포함, 제주 어업 사용자 대상).
- **`ai/mic.js`** / **`ai/toggle.js`** — 음성 입력, AI 패널 토글(`toggleAI`/`activateAI`/`closeAI`).
- **`services/push.js`** — `requestPushSubscription(guid)`: Web Push 구독 등록(현재 `vapid-public-key` 500 오류 미해결 상태, 부록 C-11).
- **`services/location.js`** — `_scheduleLocation`/`_initLocation`: 위치 권한·PDV 캐시된 위치 로드.
- **`services/klaw.js`** — `_klawReview(source, payload)`: K-Law 도메인 검토 요청.
- **`services/kcleaner.js`**, **`services/fiil.js`** — FIIL(환경 신고) 연동, Gemini 결과를 신고 보고서로 변환.
- **`gwp/engine.js`** — `_gwpLaunch`/`_gwpClose`: GWP 하위 서비스를 iframe 탭으로 열고 닫음.
- **`gwp/sign.js`** — `_handleGwpSignRequest`: 하위 서비스가 postMessage로 보낸 서명 요청을 GopangWallet으로 처리.
- **`pdv/record.js`** — `recordPDV`/`_recordPDV`: AI 응답을 PDV에 기록 + OpenHash 앵커링. `_patchL1LedgerUserHash`, `_patchPdvChainHeight`.

### D-7. `src/auth/`, `src/pwa/` `[운영 중]`

- **`src/auth/gopang-auth.js`** — 안면 인식 보조 로그인(MediaPipe 기반). `_extractFaceVector`, `_cosineSim`, `_captureFaceVector`, `_seedToGUID`/`_seedToBytes`(시드 문구 기반 GUID 복구).
- **`src/pwa/gopang-pwa.js`** — PWA 설치 배너 + Service Worker 자동 업데이트. `_showUpdateBanner`/`_applyUpdate`, `installPWA`/`dismissInstall`, `_isIOS`/`_isInStandaloneMode`. `_autoApplyUpdate`(부록 C-9 회로차단기 적용 위치)는 이 파일의 `window.addEventListener('load', ...)` 클로저 내부에 있어 grep으로 바로 잡히지 않는다.

---

### D-8. `src/pdv/`, `src/openhash/` — 부분적으로만 살아있는 라이브러리 `[부분 통합]`

이 두 디렉토리는 전부가 미통합 트랙(D-9)에 속하지 않는다. **개별 함수 단위로** 운영 트랙에 동적 import되어 실제로 쓰인다.

- **`src/pdv/vault.js`** — IndexedDB 기반 메시지 저장소. `storeMessage`가 `p2p-chat.js`(P2P 세션 저장)와 `core/session.js`(AI 챗 세션 저장)에서 동적 import로 호출됨. `getMessage`/`deleteMessage`/`getMessagesByRange`/`countMessages`/`storePublicKeys` 등은 export돼 있으나 현재 호출부 미확인(잠재적 미사용).
- **`src/pdv/keyManager.js`** — `sha256`만 `openhash/hashChain.js`에서 import되어 **간접적으로** 운영 중. `generateKeyPair`/`signMessage`/`encryptMessage`/`createTripleSignature` 등 나머지는 미통합 트랙(`ai-secretary`, `network`, `openhash/transactionPipeline` 등)에서만 참조됨.
- **`src/pdv/evidencePackage.js`** — `generateEvidencePackage`/`verifyEvidencePackage`/`generateCourtSummary`. 참조하는 곳이 전부 미통합 트랙이라 현재는 완전히 미사용.
- **`src/openhash/hashChain.js`** — **운영 중.** `anchor(contentHash, signatures, msgId)`가 `p2p-chat.js`·`core/auth.js`·`core/session.js`에서 호출되는 실제 OpenHash 앵커링 로직. `loadChainFromIDB`, `buildMerkleRoot`/`buildMerkleProof`/`verifyMerkleProof`, `verifyChainIntegrity`.
- **`src/openhash/bivm.js`/`ilmv.js`/`importanceVerifier.js`/`lpbft.js`/`plsm.js`/`transactionPipeline.js`** — OpenHash 합의·검증 알고리즘 구현체. 전부 미통합 트랙(`src/app.js` 계열)에서만 참조되며 운영 중인 `webapp.html`에는 연결되어 있지 않다.

---

### D-9. `src/app.js`와 그 하위 — 미통합 플러그인 아키텍처 `[미통합 트랙]`

**이 절 전체가 현재 어떤 HTML에서도 로드되지 않는다.** 별도의 부트스트랩(`bootstrap()`)을 가진, EventBus·PluginRegistry 기반의 도메인 플러그인 아키텍처로, GDUDA 5-Layer 설계의 한 구현체로 보인다. 코드 자체는 비교적 완성도 있게 작성돼 있으나, 운영 중인 `gopang-app.js` 트랙과는 완전히 분리되어 있다.

- **`src/app.js`** — `bootstrap()`: `event-bus`·`plugin-registry`·`domains/k-law`·`domains/k-health`·`ai-secretary/pipeline`·`shell-ui`를 초기화하는 별도 부팅 시퀀스. `getBootState`.
- **`src/core/event-bus.js`** — `EventBus`(GopangEventBus 싱글턴), `EVENTS` 상수.
- **`src/core/plugin-registry.js`** / **`plugin-interface.js`** / **`plugin-validator.js`** — `registry`(GopangPluginRegistry 싱글턴), `GopangDomainPlugin` 베이스 클래스, `PluginValidator`. `src/domains/k-law`·`k-health`의 `index.js`가 이 베이스 클래스를 상속.
- **`src/core/constants.js`** — PLSM/RISK/WS/STAKING/STEALTH/QUEUE/BIVM/LPBFT/IMPORTANCE/GDC_POLICY/ZKP 등 미통합 트랙 전반에서 쓰는 상수 모음.
- **`src/domains/k-law/`, `src/domains/k-health/`, `src/domains/_template/`** — 각각 `index.js`(플러그인 진입점, `GopangDomainPlugin` 상속) + `api.js`/`classifier.js`/`risk-rules.js`/`schema.js`/`ui.js` 5종 세트. `_template`은 새 도메인 추가 시 복사할 틀.
- **`src/ai-secretary/`** — AI 비서의 6단계 위험도 분석 파이프라인(phase0~6 + `pipeline.js`/`agentProtocol.js`). `runPipeline`, `analyzePhase1`~`recordAndAnchor`, `classifyRisk`, `bidirectionalVerify`. **주의:** 실제 AI 호출은 `src/gopang/ai/call-ai.js`(운영 중)가 별도로 수행하며, 이 6단계 파이프라인과는 무관하다 — 이름이 비슷해 혼동하기 쉽다.
- **`src/shell-ui.js`** — 미통합 트랙의 화면 렌더러. `ShellUI = { render, switchTab, sendMessage, attachDoc, downloadEvidence, getState }`.
- **`src/network/dht.js`** — `registerRecord`/`lookupGUID`/`registerNickname`/`resolveNickname`/`auctionNickname`: DHT 기반 닉네임 레지스트리 시뮬레이션.
- **`src/network/gasAddress.js`** — `deriveGUID`/`deriveIPv6`/`calcTrustLevel`/`generateStealthAddress`: 스텔스 주소·신뢰등급 계산.
- **`src/network/layerClient.js`** — `submitToLayer`/`getLayerStatus`/`getLayerTPS`: L1~L5 계층 제출 시뮬레이션.
- **`src/gdc/`** — GDC(고팡 디지털 화폐) 경제 모델 시뮬레이션. `currencyPool.js`(환전/풀), `dao.js`(투표), `escrow.js`(에스크로), `offlineQueue.js`(오프라인 메시지 큐 비용), `smartVault.js`(자산 보관 유형), `tokenomics.js`(인플레이션/소각).
- **`src/privacy/`** — `adaptivePow.js`(적응형 PoW 난이도), `kAnonymity.js`, `mixnet.js`(믹스넷 라우팅), `pir.js`(`isPIREnabled()`는 항상 `false` 반환 — 현재 기본은 k-익명성), `salt.js`(Shamir 비밀 분산), `socialRecovery.js`(소셜 복구).
- **`src/profile2.0/`** — Worker 스타일 핸들러 모음(`handleBizOrder`, `handleRegister`, `handleAiChat`, `handleSearch` 등). **`worker.js`의 동명 라우트와 이름이 같거나 비슷하지만 서로 다른 별도 구현이며 import 관계가 전혀 없다** — `worker.js`는 같은 이름의 함수를 자체 파일 안에 직접 재구현해 갖고 있다. 향후 `worker.js`를 모듈로 분리할 계획이 있다면 이 디렉토리가 그 초안일 가능성이 높지만, 현재로서는 죽은 코드다.
- **`src/tests/`** — Vitest/Jest 스타일 테스트 스위트(phase1~phase8 + 통합 테스트). `test-harness.js`가 `EventBus`/`PluginRegistry`/`Vault`/`OpenHash`의 목(mock)을 제공. 전부 미통합 트랙을 대상으로 하므로 운영 중인 `src/gopang/**` 코드에 대한 테스트 커버리지는 이 스위트로 확인할 수 없다.

**교훈:** 새 기능을 추가하기 전에, 그 기능과 이름이 비슷한 파일이 `src/app.js` 트리에 이미 존재하는지 먼저 확인할 것. 두 트랙에 같은 이름·비슷한 책임의 코드가 중복돼 있으면(`p2p-chat.js`/`search.js`의 `openSearch` 두 벌, `ai-secretary`와 `ai/call-ai.js`처럼) 잘못된 파일을 수정하고도 변화가 없어 디버깅 시간을 낭비하게 된다.

---

### D-10. 한눈에 보는 요약

| 트랙 | 진입점 | 디렉토리 |
|---|---|---|
| **운영 중** | `webapp.html` → `gopang-app.js` | `src/gopang/**`, `src/auth/gopang-auth.js`, `src/pwa/gopang-pwa.js`, `gopang-wallet.js`, `gwp-registry.js`, `sw.js`, `worker.js` |
| **부분 통합** | (동적 import) | `src/pdv/vault.js`, `src/pdv/keyManager.js`(일부), `src/openhash/hashChain.js` |
| **미통합 트랙** | `src/app.js`(아무도 호출 안 함) | `src/core/*`, `src/domains/*`, `src/ai-secretary/*`, `src/network/*`, `src/gdc/*`, `src/privacy/*`, `src/profile2.0/*`, `src/shell-ui.js`, `src/pdv/evidencePackage.js`, `src/openhash/bivm·ilmv·importanceVerifier·lpbft·plsm·transactionPipeline.js`, `src/tests/*` |
