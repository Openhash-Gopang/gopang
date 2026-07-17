# 혼디(Hondi)/Gopang 전체 시스템 기능별 테스트 마스터플랜 v1.0

**작성** Team Jupiter | 2026-07-17
**목적** 혼디 생태계(gopang 메인 허브 + K서비스 18개 저장소 + jeju 저장소)의 기능 하나하나를
빠짐없이 나열하고, 각 기능마다 테스트 목적·절차·기대결과·우선순위·환경(정적/유닛/통합/라이브)·
기존 커버리지 여부를 명시한다. "무엇을 검증했다"가 아니라 "무엇을 검증해야 하는가"의 전체
지도를 그리는 문서다.

---

# 0. 이 문서의 위치 — 기존 계획서와의 관계

혼디에는 이미 두 계열의 테스트 자산이 존재한다. 이 문서는 그것들을 대체하지 않고,
**빠진 부분을 채우고 전체를 하나의 지도로 통합**한다.

1. **`docs/gopang_implementation_plan_v3.1.md`(완성본)** — Phase 1~8로 구성된 최초 구현
   계획서. Phase 1(코어)~Phase 8(통합)까지 다루며, `src/tests/{core,pdv,openhash,
   ai-secretary,domains,network}/`의 phase1~10 테스트가 여기 대응한다. 이 문서가
   작성된 시점(추정 초기)엔 K서비스가 klaw·khealth 2개뿐이었고, GWP_REGISTRY·
   전문가 페르소나 시스템·profile2.0·숫자코드·jeju 연동·qna/users 저장소는 아직 없었다.
2. **`src/tests/integration/phase11~24`** — v3.1 완성 이후 기능이 늘어날 때마다 그때그때
   추가된 통합 테스트. 체계적 계획 없이 "그 주에 고친 것"을 검증하는 방식이라, 번호가
   이가 빠진 듯 하고(phase21 없음) 커버리지에 사각지대가 있다.
3. **`src/tests/profile2.0/m01~m13`** — 별도 계열. 회원가입·결제·프로필·AI비서·리뷰·
   위치·히트맵·커뮤니티·원장·감사·검색·보안까지 신원 생명주기를 다루는데, v3.1이나
   phase11~24 어느 쪽 목록에도 언급되지 않는 독립 트랙이다.

이 세 트랙 다 훌륭하지만 서로를 참조하지 않아, "혼디 전체에서 무엇이 검증되어 있고
무엇이 비어 있는가"를 한눈에 보여주는 문서가 없었다. 아래 PART A~I가 그 역할을 한다.
각 항목에 **[기존]**(이미 테스트 존재, 파일명 명시) 또는 **[신규]**(테스트가 없어 이번에
새로 설계) 태그를 붙인다.

---

# 1. 테스트 대상 시스템 지도 (전체 인벤토리)

## 1.1 저장소 목록 (19개, Openhash-Gopang 조직)

| 저장소 | 역할 | 규모(파일 수) | GWP_REGISTRY id |
|---|---|---|---|
| gopang | 메인 허브 — 코어·인증·PDV·Openhash·AI비서·라우터·매니페스트·프로필2.0 | 2,251 | (허브 자체) |
| klaw | K-Law 법률 AI | 17(+gopang 내 klaw/ 사본) | klaw |
| 911 | K-Emergency 긴급 구조 | 8 | kemergency |
| police | K-Police 치안 | 23 | kpolice |
| security | K-Security 보안(방금 PDV 클라이언트 신규 배치) | 14 | ksecurity |
| health | K-Health 보건의료 | 11 | khealth |
| school | K-Edu 교육 | 25 | kedu |
| gdc | K-GDC(방금 PDV 클라이언트 신규 배치) | 44 | kgdc |
| stock | K-Finance 금융/증권 | 17 | kfinance |
| insurance | K-Insurance 보험 | 31 | kinsurance |
| market | K-Commerce/K-Market 상거래(3개 registry entry 공유: kcommerce/kcommerce_seller/kbusiness) | 27 | kcommerce 등 |
| tax | K-Tax 세무 | 14 | ktax |
| traffic | K-Transport 교통 | 18 | ktransport |
| logistics | K-Logistics 물류 | 17 | klogistics |
| jeju | 제주도청 AI(자체 SP 트리, 매니페스트 비의존) | 8 | jeju |
| public | K-Gov 정부24 연계 | 10 | kgov |
| democracy | K-Democracy 국민청원/여론 | 15 | kdemocracy |
| qna | Gopang QnA(2026-07-17 신규 등록, 테스트 0건) | 51 | kqna |
| users | Gopang Users 엔티티 검색(2026-07-17 신규 등록, 테스트 0건) | 16 | kusers |
| gopang-test | 빈 저장소(LICENSE만) | 1 | — (검증 대상 제외) |

gopang 내부 서브서비스(별도 저장소 아님): `services/fiil-kcleaner`(K-Cleaner, id: fiil-kcleaner),
`kbank`/`ktelecom`/`kestate`(type:'switch' — 같은 스레드 SP 교체 방식, 별도 저장소 불필요),
`profile-assistant`(가입 튜토리얼), `tool-calculator`/`tool-web-search`(function-calling 도구),
`ksearch`(검색).

## 1.2 gopang 내부 계층 구조

```
gopang/
├── auth/            인증(SSO, QR로그인, silent-sign/auth/pref)
├── src/gopang/
│   ├── ai/          AI 파이프라인(call-ai, expert-registry/session, hondi-code, manifest-loader, vision, weather)
│   ├── core/         가입·인증 코어(auth.js), state.js
│   ├── gwp/          GWP(GovWebPostMessage) 인프라
│   ├── p2p/          P2P 채팅(WebRTC)
│   ├── pdv/          PDV(개인데이터금고) — keyManager 등
│   ├── profile2.0/    프로필 2.0 (M01~M13 모듈 대응 실 구현체)
│   ├── services/      서비스 연동 헬퍼
│   └── ui/            UI 컴포넌트
├── src/openhash/      분산원장 — bivm/hashChain/ilmv/importanceVerifier/lpbft/plsm/transactionPipeline
├── src/worker/        Cloudflare Worker 핸들러(ai-chat-handler, order-queue-handler, delivery-handler 등)
├── src/tests/         39개 테스트 파일(phase 체계 + profile2.0 m01~13)
├── pb_hooks/, pb_migrations/   PocketBase 훅·스키마 마이그레이션
├── prompts/           243개 SP(System Prompt) 파일 + sp-catalog.json 매니페스트
├── gwp-registry.js    GWP_REGISTRY(28 서비스 라우팅 테이블)
├── worker.js          메인 Cloudflare Worker(7,900줄+)
├── tools/             build_manifest.py, check_stale_refs.py, extract_gwp_registry.mjs 등
└── docs/              설계 문서 다수(계획서, 프로토콜, HANDOFF 등)
```

## 1.3 기능 대분류 (11개 PART)

| PART | 영역 | 비고 |
|---|---|---|
| A | 코어 인프라(플랫폼 코어·PDV 기반·Openhash·PDV+Openhash 통합) | Phase 1~2C 대응 |
| B | AI/오케스트레이션(AI비서·GWP라우터·전문가 페르소나·매니페스트) | Phase 3, 11, 22, 23 + 신규 |
| C | 신원/가입/프로필 생명주기(M01~M13) | profile2.0 계열 |
| D | 혼디 시각 코드(숫자코드 활성, 색상코드 폐기) | 이번 세션 12/13 검증 완료분 확장 |
| E | K서비스 개별 기능(18개) | 표준 5체크 + 도메인별 심화 |
| F | 네트워크/푸시/보안/GDC/프라이버시 | Phase 5, 9, 10 |
| G | 정부 연계 특수 기능(공유타겟·서류인계·복지자격·SP저자동화·웹서치) | Phase 17~20, 22, 24 |
| H | 부트스트랩/Shell UI | Phase 7 |
| I | 횡단 관심사(SSOT 드리프트·참조무결성·보안회귀·환경매트릭스) | 신규 — 이번 세션에서 필요성 확인 |

---

# 2. 테스트 분류체계 및 우선순위 기준

## 2.1 환경 구분

| 구분 | 정의 | 이 환경에서 가능? |
|---|---|---|
| **정적(Static)** | 코드/문서 정합성, 참조 무결성, 스키마 대조 | 가능 |
| **유닛(Unit)** | DOM/네트워크 의존 없는 순수 함수를 Node로 직접 실행 | 가능 |
| **격리통합(Isolated Integration)** | `vm` 모듈 등으로 window/fetch/storage를 스텁 처리해 브라우저 전역 스크립트를 실행 | 가능(이번 세션 pdv-history-client.js에 적용) |
| **워커통합(Worker Integration)** | `worker.js`를 그대로 import해서 `handleXxx` 함수를 호출(실제 PocketBase/외부 API는 호출별로 mock) | 대부분 가능(기존 phase11~24가 이 방식) |
| **라이브 E2E(Live)** | 실제 배포된 Oracle Cloud VM·Cloudflare Worker·PocketBase·Supabase·브라우저 세션 | **이 샌드박스에서 불가 — 사용자 환경에서 수동 실행 필요** |

## 2.2 우선순위

- **P0** — 가입·인증·PDV·Openhash·라우팅 등 실패 시 시스템 전체가 멎는 항목
- **P1** — 개별 K서비스 기능, 실패해도 해당 서비스만 영향
- **P2** — 성능·부가기능·UI 디테일

## 2.3 커버리지 태그

- **[기존]** — 이미 테스트 파일 존재. 파일명과 최근 실행 여부 명시
- **[신규]** — 테스트가 없어 이 문서에서 처음 설계
- **[불가]** — 라이브 인프라 필요, 이 샌드박스에서는 설계만 하고 실행은 사용자 환경 몫

---

# PART A — 코어 인프라

## A-1. 플랫폼 코어 [기존: `src/tests/core/phase1_core.test.js`, C-01~C-08]

| ID | 대상 | 목적 | 우선순위 | 커버리지 |
|---|---|---|---|---|
| A1-1 | `src/gopang/core/state.js` | 전역 상태(PROXY 등)가 여러 모듈에서 동일 인스턴스로 공유되는지 | P0 | ✅ **확인 완료** — 저장소 전체에 `state.js` 사본이 단 하나뿐이고(`src/gopang/core/state.js`), 24개 import 지점 전부 상대경로로 그 파일 하나에 귀결됨. ESM의 `export let` 라이브 바인딩 특성상 동일 모듈을 가리키는 이상 별도 런타임 테스트 없이도 공유가 보장됨(중복 파일이 없다는 것 자체가 검증 포인트) |
| A1-2 | 플랫폼 초기화 순서 | app.js 부트스트랩 시 core→pdv→openhash 순서 준수 | P1 | 별도 확인 안 함 — Phase 7(부트스트랩) 재실행 시 함께 확인 예정, R2 범위 밖으로 이월 |
| A1-3 | 의존성 방향 규칙 | `docs/gopang_implementation_plan_v3.1.md` §1의 "의존성 방향 규칙" 위반 여부(예: core가 K서비스를 import하는 역방향 의존) | P1 | ⚠️ **위반 확인됨(실측).** 문서 규칙은 `core → (없음)`이지만, 실제 `src/gopang/core/auth.js`가 `../ui/bubble.js`, `../services/push.js`, `../ai/hondi-code.js`, `../ai/hondi-digit-code.js` 4개를 import하고 있음(core→ui/services/ai 역방향). 다만 이 규칙 자체가 v3.1 계획서(K서비스 2개뿐이던 초기 시점 작성) 기준이라 지금도 유효한 제약인지는 불확실 — 리팩토링은 범위가 크고 위험해 이 세션에서 임의로 손대지 않음, 사용자 판단 필요 |

## A-2. PDV 기반 레이어 [기존: `src/tests/pdv/phase2a_pdv.test.js`, P-01~P-08]

| ID | 대상 | 목적 | 우선순위 | 커버리지 |
|---|---|---|---|---|
| A2-1 | `src/pdv/keyManager.js`의 `sha256`/`generateKeyPair`/`signMessage` | 암호 primitive 정확성(Web Crypto API 기반) | P0 | ✅ 재실행 완료(2026-07-17) — 9/9 통과, 회귀 없음 |
| A2-2 | `pdv-history-client.js` 태그 파싱·동의흐름 | ④ 항목, 이번 세션 완료 | P0 | [기존, 신규 테스트 추가] `pdv-history-client.test.mjs` 14/14 통과 (2026-07-17) |
| A2-3 | PDV 4대 유형(문서 §PDV-4대유형) vs `_parseTagParams`가 실제 인식하는 scope 종류 | 설계-구현 갭 확인 | P1 → 하향(§우측 참조) | ✅ **분석 완료 — "갭"이 아니라 애초에 서로 다른 두 축의 분류 체계였음이 확인됨.** `PDV-4대유형-해법_2026-07-14.md`의 "4대 유형"(①다수인 대상 집계 ②강제조사/수사 ③기관 내부 행정 ④정책용 익명통계)은 정부기관이 PDV를 소비하는 **쿼리 패턴(용도)** 분류다. 반면 `_parseTagParams`/`scope`(worker.js에 51개 이상 실존)는 **어느 서비스/기관 소관인지**(khealth/kpolice/ktax/jeju_xxx 등)를 나타내는 완전히 다른 축 — 코드 어디에도 요청이 4대 유형 중 무엇인지 구분하는 필드가 없다. 4대 유형 분류는 지금 설계 문서로만 존재. 실제 쿼리 파라미터로 넣을지는 별도 설계 판단 필요(P1 유지, 다만 "버그"는 아님) |
| A2-4 | `phase16_pdv_extract.test.mjs` | PDV 추출 로직("과거 상호작용 요약 → 고정 필드") | P0 | ✅ 재실행 완료(2026-07-17) — 12/12 통과, 회귀 없음 |

## A-3. OpenHash 레이어 [기존: `src/tests/openhash/phase2b_openhash.test.js`, O-01~O-14]

| ID | 대상 | 목적 | 우선순위 | 커버리지 |
|---|---|---|---|---|
| A3-1 | `plsm.js` selectLayer/simulateDistribution | 5계층 분포 χ² 검정 | P0 | **[기존, 완료]** 2026-07-17 실행, 통과 |
| A3-2 | `hashChain.js` anchor/verifyChainIntegrity | 체인 연결·무결성 | P0 | **[기존, 완료]** 2026-07-17 버그 수정 후 통과(원인: 테스트 코드 계약 위반) |
| A3-3 | `bivm.js` Σδ≠0 탐지, BMI 위변조 탐지 | 이중불변량검증(BIVM) | P0 | **[기존, 완료]** |
| A3-4 | `lpbft.js` 비상합의/복귀 | 계층별 비상 컨센서스 | P0 | **[기존, 완료]** |
| A3-5 | `importanceVerifier.js` 점수식 | 논문 §4.1 공식 수치 정합성 | P1 | **[기존, 완료]** |
| A3-6 | `transactionPipeline.js` Stage1~5 | 파이프라인 정상/차단 경로 | P0 | **[기존, 완료]** |
| A3-7 | `phase_anchor_integration.test.js`(A-01~A-12) | 앵커링 통합 시나리오 v2.0 — phase2b와 별개 파일 | P0 | [기존] **이번 세션 미실행** — phase2b만 돌리고 이 파일은 놓침 |
| A3-8 | IndexedDB 영속성(`_idbOpen` 등) | 브라우저 환경에서만 실제 저장 확인 가능 | P1 | [불가] — Node vm으로 IndexedDB mock 구현 후 재시도 가능성 있음(신규 검토) |

## A-4. PDV+OpenHash 통합 [기존: `src/tests/pdv/phase2c_evidence.test.js`, E-01~E-06]

| ID | 대상 | 목적 | 우선순위 | 커버리지 |
|---|---|---|---|---|
| A4-1 | 증거 패키지 생성(PDV 조회 결과 + Openhash 앵커 결합) | 두 레이어가 실제로 맞물리는지 | P0 | ✅ **완료 — 실제 프로덕션 버그 발견·수정.** 최초 실행 시 7개 중 4개 실패, 원인 조사 결과 테스트가 아니라 `src/pdv/evidencePackage.js`(법원 제출용 증거 패키지 생성 모듈) 자체가 `hashChain.js`의 옛 `anchor()` API(content, sig, msgId)를 그대로 호출하고 있어 신 API(contentHash, signatures[], msgId)와 어긋나 매번 예외로 실패했음(스토킹/가정폭력 등 실사용 시나리오에서 증거 패키지 생성이 항상 죽는 상태였음). 프로덕션 코드 수정 + `generateEvidencePackage()`를 실제로 끝까지 호출하는 신규 종단 테스트(`phase2c_evidence_e2e.test.mjs`, vault.js를 mock.module로 대체) 추가. 결과: `phase2c_evidence.test.js` 7/7, `phase2c_evidence_e2e.test.mjs` 2/2 |

---

# PART B — AI/오케스트레이션 계층

## B-1. AI 비서 파이프라인 [기존: `src/tests/ai-secretary/phase3_ai_secretary.test.js`, A-01~A-11]

| ID | 대상 | 목적 | 우선순위 | 커버리지 |
|---|---|---|---|---|
| B1-1 | `call-ai.js`(3,905줄) 전체 | AI 호출 파이프라인 — 이번 세션에서 파일 크기만 확인, 내용 미검증 | P0 | ✅ **phase3_ai_secretary.test.js 재실행 — 실제 프로덕션 버그 발견·수정.** 최초 13개 중 3개 실패(A-11~A-13), 원인은 `src/ai-secretary/phase6.js`가 `evidencePackage.js`와 동일한 `anchor()` API 드리프트(구 API로 호출)를 갖고 있어 AI 비서의 모든 Phase 6(대화 기록+OpenHash 앵커링)가 항상 예외로 실패하던 것 — 수정 후 13/13 통과 |
| B1-2 | `phase13_ai_chat_handler.test.mjs` | "짜장면 주문 사고실험" — `src/worker/ai-chat-handler.js` | P0 | ✅ **실행 결과 9/31 실패 → 전면 원인 규명·수정, 31/31 통과.** 2026-07-15 `ai-chat-handler.js`가 세션/LLM키 조회를 Supabase(sbFetch)→L1 PocketBase(`_l1AdminToken`+원문 fetch)로 이관했는데 테스트 목이 갱신 안 됨(`_l1AdminToken is not a function`) + AES 테스트 키가 hex 아니어서 유효하지 않은 키 길이 + 번역 테스트 env에 DEEPSEEK_API_KEY 누락, 3가지 복합 원인 |
| B1-3 | `phase14_order_queue_handler.test.mjs` | 주문 큐 처리 | P1 | ✅ 재실행 완료(2026-07-17) — 11/11 통과, 회귀 없음 |
| B1-4 | `phase15_delivery_handler.test.mjs` | 배송 처리 | P1 | ✅ 재실행 완료(2026-07-17) — 12/12 통과, 회귀 없음 |

## B-2. GWP 라우터 & 오케스트레이션

| ID | 대상 | 목적 | 우선순위 | 커버리지 |
|---|---|---|---|---|
| B2-1 | `router-category.test.mjs` | SP-00-ROUTER 실제 코드 라우팅 검증(재구현 아닌 실행 기반) | P0 | [기존] **이번 세션 미실행** |
| B2-2 | `sp-intercall.test.mjs` | `worker.js`의 `handleGovRelay` 실제 경로 | P0 | [기존] **이번 세션 미실행** |
| B2-3 | `phase11_orchestration_registry_and_ksearch.test.mjs` | 오케스트레이션 레지스트리 + K-Search | P0 | ✅ 재실행 완료(2026-07-17) — 23/23 통과, 회귀 없음 |
| B2-4 | `phase22_sp_author_automation.test.mjs` | SP-Author 자동화(신호 큐잉, ESCALATE) | P1 | ✅ 재실행 완료(2026-07-17) — 14/14 통과, 회귀 없음 |
| B2-5 | `phase23_gwp_registry_scaling.test.mjs` | **이번 세션에 gwp-registry.js를 직접 수정(qna/users 추가)했는데 이 스케일링 테스트를 안 돌림** | P0 | [기존] **회귀 확인 시급** — 다음 세션 최우선 |
| B2-6 | SP-00-ROUTER 매니페스트 동기화 | `check_stale_refs.py`가 "manifest에 SP-00-ROUTER 키 없음"으로 매번 이 검사를 건너뛰고 있음 — 근본 원인 파악 필요 | P0 | ✅ **근본 원인 확인 후 검사 제거로 해결.** SP-00-ROUTER는 2026-07-05(같은 날 나중 커밋 6766c60)에 죽은 코드로 완전 삭제됐고, 라우팅은 이제 AGENT-COMMON이 GWP_REGISTRY를 직접 참조해 판단하는 방식이라 "라우터 서비스 표"라는 두 번째 진실 공급원 자체가 더 이상 존재하지 않음 — 검사 대상이 원천적으로 사라진 것. `check_router_registry_sync()` 함수와 호출부를 제거(되살릴 게 아니라 없애는 게 맞음). 제거 후 64/64 참조 정상 확인 |
| B2-7 | GWP_REGISTRY 신규 2건(kqna/kusers) 트리거 정확도 | threshold 0.65, trigger 문구가 실제 발화에서 오탐/누락 없이 매칭되는지 | P0 | ✅ **재현 시도 — matchService() 자체가 존재하지 않음을 확인(2026-07-05 완전 삭제, 함수 자체가 없음).** 트리거 배열 직접 점검만 가능: kqna(질문있어/문의/궁금해/뭐예요/어떻게 해요/절차가/신청 방법/자격 요건/필요한 서류), kusers(이 사람 찾아줘/프로필 찾아줘/연락처 찾아줘/누구세요/가입자 조회/엔티티 검색) — 문구 자체는 합리적이나 실사용 오탐/누락 여부는 실제 LLM 판단 품질 문제라 이 샌드박스에서 검증 불가(라이브 환경 필요, R3로 이월) |

## B-3. 전문가 AI 페르소나 호출 시스템

| ID | 대상 | 목적 | 우선순위 | 커버리지 |
|---|---|---|---|---|
| B3-1 | `expert-registry.js` 27개 페르소나 개별 | 각 페르소나의 `key`가 실제 `sp-catalog.json`에 존재하는지 | P0 | [기존] check_stale_refs.py가 부분 커버(38→0건 확인) |
| B3-2 | `expert-session.js` 세션 교체(same-thread SP switch) | 실제로 시스템 프롬프트가 교체되는지, 이전 페르소나 잔존 여부 | P0 | ✅ **신규 테스트 작성·통과(6/6, `expert-session-switch.test.mjs`)** — CFG.system 교체·history[0] 동기화·history 유지(맥락 보존)·종료 발화 감지·system_base 복원·이전 페르소나 잔존 없음·PDV 기록까지 실행 검증 |
| B3-3 | 위기개입 상속(`needsMedicalSafety`) | 임상심리사·정신건강전문요원·전문상담교사 3개만 true인지 | P0 | [기존, 완료] 2026-07-17 grep 확인 |
| B3-4 | `UNIVERSAL-INTEGRITY` 자동 상속 | manifest-loader.js 주석에 "K-Intent/K-Compose 등 전부에 적용 안 되고 있었다"는 2026-07-12 발견 기록 — 그 이후 실제로 고쳐졌는지 재확인 | P0 | ✅ **회귀 없음, 실행 검증 완료.** `_loadSpByKey()`가 UNIVERSAL-INTEGRITY(+2026-07-17 TASK-DELEGATION-GUIDE)를 모든 SP 로드에 무조건 결합(자기 자신 로드 시만 예외). call-ai.js의 12개 로더 전부가 이 함수 하나만 거치는 단일 관문 구조라 개별 로더가 우회할 수 없음(구조 자체가 회귀를 막음). 실행 테스트로 확인 |
| B3-5 | `TASK-DELEGATION-GUIDE` 자동 상속(2026-07-17 신설, 주피터님 지시) | 방금 추가된 기능이라 테스트 자체가 없음 | P1 | [신규] |

## B-4. 매니페스트/SP 카탈로그 시스템

| ID | 대상 | 목적 | 우선순위 | 커버리지 |
|---|---|---|---|---|
| B4-1 | `tools/build_manifest.py` | prompts/ 스캔 → sp-catalog.json 재생성이 커밋된 버전과 일치하는지(수동 편집 흔적 검출) | P0 | ✅ **실행 완료 — 재생성 결과와 커밋된 파일이 완전히 동일(diff 0줄, 163항목).** 수동 편집 흔적 없음 |
| B4-2 | `tools/check_stale_refs.py` 자체의 정확성 | 스크립트가 놓치는 참조 패턴은 없는지(예: 동적으로 조합되는 파일명) | P1 | ✅ **실제 사각지대 발견·수정.** `src/gopang/ai/hondi-faq-router.js`의 `HONDI_FAQ_REGISTRY`(19개 파일 참조)가 `file: 'xxx.txt'` 형식(접두사 없는 파일명, 런타임에 별도 상수와 결합)이라 기존 4개 정규식 어디에도 안 걸렸고 스캔 대상 목록에도 없었음 — 지금 당장 깨진 참조는 없었지만(19개 전부 실존 확인) 향후 오타/삭제를 못 잡는 상태였음. 신규 검사 함수 추가 후 83건 검사로 확대, 의도적으로 파일명을 깨뜨려 실제로 MISSING을 잡아내는지(exit 1) 재검증 완료 |
| B4-3 | `tools/extract_gwp_registry.mjs` | vm 기반 추출이 실제 브라우저 실행 결과와 100% 동일한지(fetch 스텁이 실제 동작과 다를 가능성) | P1 | ✅ **교차검증 완료(브라우저는 아니지만 독립된 두 번째 실행 경로와 비교).** vm 샌드박스 추출 결과와 ESM import+전역 스텁 방식(이 세션에서 계속 써온 방법)의 결과가 바이트 단위로 완전히 동일함을 diff로 확인. 100% 브라우저 재현은 이 샌드박스에서 불가하나, 서로 다른 두 실행 메커니즘이 일치한다는 것으로 신뢰도 보강 |

---

# PART C — 신원/가입/프로필 생명주기 (Profile 2.0, M01~M13)

**전체가 [기존] 테스트 파일은 있으나, 이번 세션에서 단 하나도 실행하지 않았다.** 아래는
각 모듈이 다루는 범위 추정(파일명 기반)과, ①(가입) 검증에서 이번 세션이 다루지 못한
부분을 표시한다.

| ID | 모듈 | 실측 결과(2026-07-17) | 우선순위 |
|---|---|---|---|
| C-01 | `m01_auth.test.mjs` | ✅ 9/9 통과. **단, 실제 `src/profile2.0/*.js`를 import하지 않고 "테스트 대상 함수 인라인" 방식(주석에 명시)** — node:crypto만 외부 의존, 나머지 로직은 테스트 파일 안에 재구현됨. 내적 정합성은 검증되지만 실제 프로덕션 코드와의 드리프트는 이 테스트로 보장 안 됨 | P0 |
| C-02 | `m02_register.test.mjs` | ✅ 11/11 통과(C-01과 동일한 인라인 재구현 방식) | P0 |
| C-03 | `m03_payment.test.mjs` | ✅ 13/13 통과(동일 방식) | P0 |
| C-04 | `m04_profile.test.mjs` | ✅ 11/11 통과(동일 방식) | P0 |
| C-05 | `m05_ai_assistant.test.mjs` | ✅ 12/12 통과(동일 방식) | P1 |
| C-06 | `m06_review.test.mjs` | ✅ 12/12 통과(동일 방식) | P1 |
| C-07 | `m07_location.test.mjs` | ✅ 12/12 통과(동일 방식) | P1 |
| C-08 | `m08_heatmap.test.mjs` | ✅ **버그 수정 후 19/19 통과** — `/home/claude/heatmap.js`(이전 세션의 하드코딩된 샌드박스 절대경로)를 `../../profile2.0/heatmap.js`로 수정, 실제 `src/profile2.0/heatmap.js`(getColor/handleHeatmap) 대상으로 실행 확인 | P2 |
| C-09 | `m09_community.test.mjs` | ✅ **버그 수정 후 12/12 통과** — 동일한 절대경로 버그, `community.js` 실제 모듈 대상 확인 | P1 |
| C-10 | `m10_ledger.test.mjs` | ✅ **완료 — `src/profile2.0/ledger.js` 신규 구현 후 19/19 통과.** 테스트 사양(7개 함수)대로 K-Market 구매 1건을 구매자 차변/판매자 대변(97%)/플랫폼 대변(3%) 3행 복식부기로 분해, Σ차변=Σ대변 불변식(verifyBIVM) 검증, 원장→사용자 잔액 역산(reconstructBalances/computeSettledFs), 프로필 캐시(extra.fs) 대조(detectBalanceAnomalies), Supabase RPC 기록(marketPurchaseRPC, SQLSTATE 23514→CHECK_VIOLATION 변환)까지 구현. `verifyBIVM`은 A-3(OpenHash BIVM)과 개념만 공유하고 구현은 완전히 별개(파일도 다름) | 완료 |
| C-11 | `m11_audit.test.mjs` | ✅ **버그 수정 후 22/22 통과** — 동일한 절대경로 버그, `audit.js`(sha256hex/computeMerkleRoot/buildPdvLogInsert/anchorL1MerkleRoot/handleMerkleVerify) 실제 모듈 대상 확인. A-3(OpenHash phase_anchor_integration)와는 별개 계층(이쪽은 PDV 로그 Merkle 감사, A-3은 가입/대화/거래 3단 앵커링)으로 겹치지 않음 확인 | P0 |
| C-12 | `m12_m13.test.mjs` | ✅ **버그 수정 후 19/19 통과** — 동일한 절대경로 버그, `search.js`(handleSearch)+`security.js`(localAnomalyScore/classifySeverity/scoreContent) 실제 모듈 대상 확인. ksearch(GWP_REGISTRY id)와는 별개(이쪽은 profile2.0 내부 프로필 검색) | P0 |
| (보너스) | `test_m14_bulk_register.py` | ✅ **버그 수정 후 10/10 통과** — `sys.path.insert(0, '/home/claude')` 하드코딩을 저장소 상대경로로 수정, `tools/bulk_register.py` 실제 모듈 대상 확인 | — |

**PART C 종합 소견(갱신)**: M08/M09/M11/M12/M14 5개 파일이 전부 동일한 패턴의 버그(이전 세션이 남긴
샌드박스 전용 절대경로 `/home/claude/*`)로 실행 자체가 불가능했다 — 경로만 고치면 실제 프로덕션
모듈을 정확히 검증하는 잘 작성된 테스트였음(19/19, 12/12, 22/22, 19/19, 10/10 전부 통과). M10은
프로덕션 모듈(`ledger.js`) 자체가 없어서 테스트 사양대로 신규 구현 후 19/19 통과 확인. 반면 M01~M07은
실행은 늘 가능했지만 애초에 프로덕션 코드를 import하지 않는 방식이라 "통과"의 의미가 다르다 —
프로덕션 모듈과의 드리프트 여부는 별도 확인이 필요하다. **PART C(M01~M14) 전 항목 완료.**

---

# PART D — 혼디 시각 코드 시스템

## D-1. 숫자 코드(활성) [기존+신규, 이번 세션 상당 부분 완료]

| ID | 대상 | 목적 | 우선순위 | 커버리지 |
|---|---|---|---|---|
| D1-1 | `idToDigits`/`digitsToId` 왕복 | 1000건 랜덤 + 경계값 | P0 | **[신규, 완료]** `hondi-digit-code.roundtrip.test.mjs` 13/13 |
| D1-2 | `phoneToDigits`/`digitsToPhone` 왕복 | 휴대폰+전 지역번호(17개) | P0 | **[신규, 완료]** |
| D1-3 | `digitsToPhone` 입력 엄격성 | 배열/문자열 비대칭 해소 확인(2026-07-17 수정) | P0 | **[신규, 완료]** |
| D1-4 | `generateDigitCodeCanvas`/`generateDigitCodeDataURL` | 실제 이미지 렌더링(Canvas API 의존) | P1 | [불가] — Node에 canvas 네이티브 빌드 필요, 이번 세션 시도 안 함. jsdom+node-canvas 조합으로 재시도 검토 |
| D1-5 | `hondi-digit-scanner.js` — `digit_code_id`로 profiles 조회 | 스캐너가 실제로 올바른 프로필을 찾는지(라이브 PocketBase 필요) | P0 | [불가] — 로직 자체(쿼리 문자열 조합)는 정적 확인 가능, 실제 조회 결과는 라이브 필요 |
| D1-6 | 등록 파이프라인 연동(`_completeRegistration` → `digit_code_id` 저장 → 스캐너 조회) | **엔드투엔드 경로 전체**가 실제로 이어지는지 | P0 | [신규] — 이번 세션은 코드 존재만 확인, 실행 연결은 미검증 |
| D1-7 | `test-hondi-digit-code.html` | 저장소에 이미 있는 수동 테스트 페이지 — 이번 세션에서 존재만 확인하고 열어보지 않음 | P1 | [기존, 미실행] |
| D1-8 | 7세그먼트 패턴 정확성(`SEGMENT_PATTERNS`) | 육안 확인 — 이번 세션 소스 대조로 0~9 전부 표준 세그먼트와 일치 확인함(코드 리뷰 수준) | P2 | [신규, 완료 — 코드리뷰만] |
| D1-9 | `digit_code_id` 유니크 제약(`1784100001_updated_profiles_digit_code_unique.js`) | 동일 코드 중복 가입 시 실제로 거부되는지 | P0 | [불가] — 라이브 DB 필요 |

## D-2. 색상 코드(폐기 예정) — 회귀 방지 관점만

| ID | 대상 | 목적 | 우선순위 | 커버리지 |
|---|---|---|---|---|
| D2-1 | `hondi-code.js` 참조 제거 확인 | 폐기 결정 후에도 `_completeRegistration`이 여전히 `guidToShortId`/`generateHondiCodeDataURL`을 호출 중(이번 세션에서 확인) — 제거 작업 자체는 아직 안 함 | P1 | [신규] — 제거 여부는 사용자 결정 대기 |
| D2-2 | "9색/9진법(주석) vs 6색/6진법(실구현)" 불일치 | 폐기와 함께 자연 소멸 예정이나, 제거 전까지는 여전히 살아있는 버그 | P2 | [기존 발견, 미조치] |

---

*(다음 섹션에서 계속: PART E — K서비스 개별 기능 테스트 18개)*

# PART E — K서비스 개별 기능 테스트 (18개)

## 표준 템플릿 (모든 서비스 공통 적용)

각 서비스마다 아래 5개 표준 체크(이번 세션 ③에서 이미 실행한 매트릭스)를 **최신 상태로
재확인**하고, 서비스 고유 도메인 로직에 대한 심화 테스트를 추가한다.

- **S1** 엔트리포인트 존재(`index.html`/`webapp.html`/`desktop.html`)
- **S2** PDV 클라이언트 존재 + SSOT(`gopang/pdv-history-client.js`) 대비 `diff` 일치
- **S3** GWP_REGISTRY 등록 여부 + `type`(tab/inline/switch) 적절성
- **S4** 트리거(triggers) 배열의 오탐/누락 — 실제 발화 샘플로 재현
- **S5** `gopang-wallet.js` 사본이 있다면(대부분의 서비스가 지참) SSOT 대비 드리프트 확인 — **이번 세션에서 한 번도 확인 안 한 새 축**

## E-1. K-Emergency (911) — id: kemergency

| 체크 | 상태(2026-07-17 기준) | 심화 테스트 필요 항목 | 우선순위 |
|---|---|---|---|
| S1~S3 | 정상(등록·PDV·엔트리 전부 확인됨) | — | — |
| S4 | 미실시 | "살려줘", "심정지" 등 긴급 트리거가 threshold 0.6(전체 중 가장 낮음=가장 민감)로 오탐(단순 감탄사에도 반응) 없는지 | **P0** — 긴급 오탐은 사용자 신뢰에 치명적 |
| S5 | 미실시 | `dashboard.html` 관제 화면이 실제 911 출동 연계 API와 어떻게 통신하는지 문서 대조 | P0 |
| 도메인 | 미실시 | 119/112 연계가 실제 라이브 엔드포인트인지, 목업인지 확인 — 라이브 테스트 항목 | [불가] |

## E-2. K-Law (klaw) — id: klaw [기존: `src/tests/domains/phase4_klaw.test.js`, K-01~K-10]

| 체크 | 상태 | 심화 테스트 | 우선순위 |
|---|---|---|---|
| S2 | **2026-07-17 PDV 클라이언트 신규 배치 완료** | 배치 직후이므로 실제 태그 처리 재확인 필요 | P0 |
| S4 | 미실시 | "판결", "소송" 등 법률 트리거와 K-Police의 "고소"류 트리거가 겹치는지(priority klaw=1, kpolice=1 — 동순위 충돌 가능) | **P0 — 우선순위 동률 충돌 케이스, R3로 이월** |
| 도메인 | ✅ **재실행 완료(11/11 통과)** — K-10이 core 파일의 JSDoc 예시 주석("예: 'k-law'")까지 실제 코드 결합으로 오탐하던 걸 수정 | AI 가상 판결문 로직(K-Law v20.0) 정확성 — classifier.js 자체(K-01~09)는 정상 | 완료 |
| gopang 내 사본 | 미실시 | `gopang/klaw/` 서브디렉토리와 독립 klaw 저장소 간 `diff -rq` | P0, R3로 이월 |
| **🔴 아키텍처 갭(2026-07-17 발견 → 해결)** | `src/tests/domains/phase6_khealth.test.js`의 H-08에서 실제 파이프라인 실행 중 발견 | ✅ **(A)(B) 모두 완료.** (A) 근본 원인은 두 겹이었음: ① `phase2.js`의 p1Score<0.3 게이트가 Phase 2(도메인 분류기 호출) 자체를 생략 — 이 경로가 순수 정규식이라 비용이 사실상 0인데도 협박·사기 어휘 없는 순수 민사분쟁을 걸러내고 있었음(게이트 제거). ② 제거 후에도 `phase4.js`의 WS 공식(P1×0.50+P2×0.35+P3×0.15)이 P2 단독 고신뢰도 감지(CV-2 severity 0.72)를 P1=0일 때 0.252로 희석 — 여전히 S0. Fast-Path가 이미 쓰는 "고신뢰도 단일신호는 안 희석" 원칙을 P2에 최소 적용(severity≥0.5면 최소 S1 문턱 보장, S2/S3는 여전히 P1 뒷받침 필요 — 패턴 매칭 하나로 차단 안 함). (B) "개별 위법 탐지"(1단계, 규칙기반, 비용 0)와 "전반적 위법 가능성 판단"(2단계) 경쟁이 아니라 이어지는 구조로 설계·구현 — 신규 `phase7.js`(LLM 기반, S0면 호출 자체 안 함 → 잡담엔 토큰 0, llmCaller 주입식이라 운영 미설정 시 안전하게 skip, riskResult.level을 직접 안 바꿈). **알려진 v1 범위 제한**: Phase 7은 현재 단일 메시지 단위로 호출됨(멀티턴 대화 전체를 종합하려면 `runPipeline`에 history 스레딩이 추가로 필요 — R3 이후 과제로 남김) | ✅ 완료 — phase7 9/9, phase6_khealth 10/10, phase4_klaw 11/11, phase3_ai_secretary 13/13 |

## E-3. K-Police (police) — id: kpolice

| 체크 | 상태 | 심화 | 우선순위 |
|---|---|---|---|
| S1~S3 | 정상 | — | — |
| S4 | 미실시 | "112 신고" 발화 시 kemergency(119/112 통합)와 kpolice 중 어디로 갈지 — 두 서비스 모두 112 관련 트리거 보유, priority kemergency=0 > kpolice=1이라 emergency 우선일 것으로 추정되나 미검증 | **P0 — 라우팅 충돌** |
| 도메인 | 미실시 | `ops.html`(경찰 운영 화면) 접근 권한 체계 | P1 |

## E-4. K-Security (security) — id: ksecurity

| 체크 | 상태 | 심화 | 우선순위 |
|---|---|---|---|
| S2 | **2026-07-17 PDV 클라이언트 신규 배치 완료** | 배치 직후 재확인 필요 | P0 |
| 도메인 | 미실시 | `security-agent.js` — 해킹/피싱 대응 로직, `security_whitepaper.html` 내용과 실제 코드 기능 일치 여부 | P1 |

## E-5. K-Health (health) — id: khealth [기존: `phase6_khealth.test.js`, H-01~H-10]

| 체크 | 상태 | 심화 | 우선순위 |
|---|---|---|---|
| S1~S3 | 정상 | — | — |
| 도메인 | ✅ **재실행 완료 — 9/10 통과.** H-08(K-Law+K-Health 동시 활성화) 1건 실패 — K-Health 자체 결함 아님, K-Law 쪽 파이프라인 연결 갭이 원인(§E-2 K-Law 아키텍처 갭 참조). K-Health 고유 로직(H-01~07, H-09~10, MED-01~05 분류)은 전부 정상 | 의료 정보 민감도 — needsMedicalSafety 상속 체계(B-3)와의 연동 여부는 별도 확인(B-3에서 이미 임상심리사 등 3개 상속 확인됨) — **완료** |
| 별도 파일 | 미실시 | `health`에만 `pdv.js`가 별도로 있음(다른 서비스는 `pdv-history-client.js`만) — 이 파일의 역할과 중복/충돌 여부 확인 필요 | P1, R3로 이월 |

## E-6. K-Edu (school) — id: kedu

| 체크 | 상태 | 심화 | 우선순위 |
|---|---|---|---|
| S2 | 이전 세션에 "누락"으로 오탐했다가 `js/pdv-history-client.js` 경로에서 재확인(SSOT 일치) | 재확인 완료, 갱신 시 경로 유지 확인 필요 | P1 |
| 도메인 | 미실시 | 전문상담교사 페르소나(B-3)와 K-Edu 서비스 자체의 역할 분담(개인 상담 vs 학교행정) 경계 테스트 | P1 |

## E-7. K-GDC (gdc) — id: kgdc

| 체크 | 상태 | 심화 | 우선순위 |
|---|---|---|---|
| S2 | **2026-07-17 PDV 클라이언트 신규 배치 완료** | 재확인 필요 | P0 |
| 도메인 | 미실시 | `charge-admin.html`, `nation-dashboard.html` — "결제/송금/환전" 트리거(threshold 0.75, 전체 중 가장 높은 축에 속함=가장 신중) 실제 오탐률 | **P0 — 금융 관련, 신중해야 함** |

## E-8. K-Finance/Stock (stock) — id: kfinance

| 체크 | 상태 | 심화 | 우선순위 |
|---|---|---|---|
| S1~S3 | 정상 | — | — |
| 도메인 | 미실시 | "주식/ETF/포트폴리오" — 실시간 시세 연동이 라이브인지 확인 | [불가 부분 포함] |

## E-9. K-Insurance (insurance) — id: kinsurance

| 체크 | 상태 | 심화 | 우선순위 |
|---|---|---|---|
| S1~S3 | 정상 | — | — |
| 도메인 | 미실시 | `my_insurance.html` — 개인 보험 정보 조회 시 PDV scope 권한 체계와 실제 연동 | P0 |

## E-10. K-Commerce/K-Market (market) — id: kcommerce / kcommerce_seller / kbusiness (1저장소 3등록)

| 체크 | 상태 | 심화 | 우선순위 |
|---|---|---|---|
| S3 | 3개 GWP 엔트리가 같은 저장소를 가리킴 — 서로 다른 threshold/trigger로 하나의 코드베이스 내 다른 진입점을 라우팅하는 구조 | 3개 엔트리 각각이 실제로 `gopang-order-flow.html`/`kmarket_admin_dashboard.html`/`gopang-seller-catalog.js` 중 올바른 대상으로 연결되는지 | **P0 — 다중 등록 자체가 오배선 위험** |
| 도메인 | 미실시 | `gopang-wallet.js`(지갑) — STEP27_test_checklist.md의 실제 QA 시나리오(짜장면 주문)와 연동 재현 | P0 |
| SSOT | 미실시 | market의 `gopang-wallet.js`가 다른 12개 서비스의 사본과 버전 일치하는지(`diff` 미실시 — 이번 세션은 pdv-history-client.js만 SSOT 비교했고 gopang-wallet.js는 비교 안 함) | **P0 — 신규 발견 과제** |

## E-11. K-Tax (tax) — id: ktax

| 체크 | 상태 | 심화 | 우선순위 |
|---|---|---|---|
| S1~S3 | 정상(이번 세션 T-01 태그 파싱 테스트의 실제 시나리오 대상이 tax였음) | ④ PDV 태그 테스트가 tax.hondi.net 시나리오로 이미 검증됨 | 완료 |
| 도메인 | 미실시 | 세무사(expert-registry.js) 페르소나와 K-Tax 서비스의 역할 경계(개인 상담 vs 서비스 처리) | P1 |

## E-12. K-Transport/Traffic (traffic) — id: ktransport

| 체크 | 상태 | 심화 | 우선순위 |
|---|---|---|---|
| S1~S3 | 정상 | — | — |
| 도메인 | 미실시 | `national-dashboard.html` — 과태료/단속 정보의 실시간성 | [불가 부분 포함] |

## E-13. K-Logistics (logistics) — id: klogistics

| 체크 | 상태 | 심화 | 우선순위 |
|---|---|---|---|
| S1~S3 | 정상 | — | — |
| 도메인 | 미실시 | market의 배송 요청(`gopang-order-flow.html`)과의 실제 연동(주문→배송 핸드오프) — phase15_delivery_handler.test.mjs와 겹칠 가능성 | P0 |

## E-14. 제주도청 AI (jeju) — id: jeju

| 체크 | 상태 | 심화 | 우선순위 |
|---|---|---|---|
| S2, 참조무결성 | **2026-07-17 stale ref 2건 수정 완료(로컬), push 후 원격 재확인 필요** | push 여부 확인 안 됨(사용자 실행 로그에 push 성공 여부 미명시) | **P0 — 재확인 필요** |
| 도메인 | 미실시 | 자체 SP 트리(`Jejudo/01-do`~`09-national`) — 매니페스트 비의존 구조라 다른 서비스와 다른 별도 무결성 검사 필요 | P1 |
| 문서 | 존재 확인만 | `docs/business-plan/JEJU-FIELD-TEST-MASTER-PLAN_v1.0.md`, `jeju-l1-l3-field-test-plan-2026-07-07.md` — **이미 있는 현장 테스트 계획서, 이 문서와 통합 검토 필요** | P1 |

## E-15. K-Gov (public) — id: kgov

| 체크 | 상태 | 심화 | 우선순위 |
|---|---|---|---|
| S1~S3 | 정상 | — | — |
| 도메인 | 미실시 | `phase17_share_target.test.mjs`(정부24 앱 연동), `phase18_procedure_docs.test.mjs`(공유문서→서류 연결), `phase19_welfare_eligibility.test.mjs`(복지 자격) — **전부 이 서비스와 직결되는 기존 테스트인데 이번 세션 미실행** | **P0 — E-15가 사실상 PART G와 동일 대상** |

## E-16. K-Democracy (democracy) — id: kdemocracy

| 체크 | 상태 | 심화 | 우선순위 |
|---|---|---|---|
| S1~S3 | 정상 | — | — |
| 도메인 | 미실시 | `ai_democracy_sp.html`, `gopang_laws.html` — 청원/여론 집계 로직 | P1 |

## E-17. Gopang QnA (qna) — id: kqna **(2026-07-17 신규 등록, 테스트 이력 0건)**

| 체크 | 상태 | 심화 | 우선순위 |
|---|---|---|---|
| S1 | **완료(2026-07-17)** — index/webapp/desktop.html 전부 HTTP 200 확인 | — | — |
| S2 | **완료 — 실패(P0 발견)** — `pdv-history-client.js`가 저장소 어디에도 없음(루트·js/ 둘 다 404, 클론 후 루트 목록에서도 부재 확인). qna는 51개 파일 규모 신규 저장소인데 PDV 기록 자체가 안 됨 | 신규 저장소 배치 시 SSOT 체크리스트에 PDV 클라이언트가 빠졌을 가능성 — I1-1의 "12개 일치+3개 신규 배치"에 qna/users는 포함 안 됐던 것으로 보임 | **P0 — PDV 기록 불가 상태** |
| S3 | **완료** — gwp-registry.js에 등록됨(id: kqna, type: tab, status: active, priority 9, threshold 0.65) — sp-tag-dispatch.test.mjs SD-14/15로 구조 검증 통과 | — | — |
| S4 | 미실시(정적 검사로는 한계) | trigger("찾아줘" 계열은 없지만 "질문있어/문의/궁금해"가 다른 서비스의 일반 질문과 경계가 모호함 — 예: "보험 궁금해"가 kqna로 갈지 kinsurance로 갈지)는 라이브 LLM 판단 품질 문제라 이 샌드박스에서 재현 불가 | **P0** |
| 도메인 | 미실시 | `SP-CORE.txt` + 9개 도메인별 SP(BIZ/ECONOMY/EDU/GOV/INFRA/IP/LEGAL/LOGISTICS/SAFETY) 자체 라우팅 로직 — gwp-registry.js와는 별개로 qna 자체 내부에 2차 라우터가 있음, 이 내부 라우터 테스트 전무 | **P0 — 완전 미검증 영역** |

## E-18. Gopang Users (users) — id: kusers **(2026-07-17 신규 등록, 테스트 이력 0건)**

| 체크 | 상태 | 심화 | 우선순위 |
|---|---|---|---|
| S1 | **완료(2026-07-17)** — index/webapp/desktop.html 전부 HTTP 200 확인 | — | — |
| S2 | **완료 — 실패(P0 발견, qna와 동일 패턴)** — `pdv-history-client.js` 없음(루트·js/ 둘 다 404, 클론 확인) | E-17과 동일 원인으로 추정 | **P0 — PDV 기록 불가 상태** |
| S3 | **완료** — gwp-registry.js에 등록됨(id: kusers, type: tab, status: active, priority 9, threshold 0.65) — sp-tag-dispatch.test.mjs SD-14/15로 구조 검증 통과 | — | — |
| S4 | **재확인 완료 — 이전 판단(3중 충돌) 정정 필요.** 실제 kusers의 trigger는 "찾아줘" 단독이 아니라 "이 사람 찾아줘"/"프로필 찾아줘"/"연락처 찾아줘" 등 구체적 구문이다(gwp-registry.js 508행대 실측 확인) — `ksearch`/`tool-web-search`의 "찾아줘"는 kusers 문구의 부분 문자열이라 완전 동일 충돌은 아님. 다만 matchService()가 dead code라 실사용 라우팅에는 어차피 영향 없음(sp-tag-dispatch.test.mjs SD-16에 정보성으로 기록됨) | 이전 세션(E-18 최초 작성 시점)의 "3중 충돌" 판단 자체가 부정확했음 — 이번 세션에서 실측으로 정정 | P1(실사용 영향 없음으로 하향) |
| 도메인 | 미실시 | GAS(Gopang Address System) v1.6 기반 엔티티 검색 — `register-profile.html`/`profile.html`과의 데이터 연동(동일 저장소 내 register 관련 파일들) | P0 |


---

# PART F — 네트워크/푸시/보안/GDC/프라이버시 계층

[기존: `src/tests/network/phase5_network_gdc_privacy.test.js`(N-01~05, G-01~08, P-01~06),
`phase9_push_broadcast.test.js`(PB-01~04), `phase10_push_l1_priority.test.js`]

| ID | 대상 | 목적 | 우선순위 | 커버리지 |
|---|---|---|---|---|
| F-1 | Network 계층(N-01~05) | `src/network/` 통신 규약 | P0 | [기존] 이번 세션 미실행 |
| F-2 | GDC 계층(G-01~08) | `src/gdc/` — E-7(K-GDC 서비스)과는 별개로 코어에도 GDC 모듈이 존재, 역할 분담 확인 필요 | P0 | [기존] 미실행, **역할 중복 여부 신규 확인 필요** |
| F-3 | Privacy 계층(P-01~06) | `src/privacy/` | P0 | [기존] 미실행 |
| F-4 | Push 브로드캐스트(PB-01~04) | `worker.js`의 `POST /push/broadcast`, `sw.js` push 분기 | P1 | [기존] 미실행 |
| F-5 | Push L1 우선순위 | `node:test` 프레임워크 사용(다른 파일들과 다른 스타일 — Node 내장 test runner) | P1 | [기존] 미실행, **실행 명령어가 다를 수 있음**(`node --test` 필요 여부 확인) |

---

# PART G — 정부 연계 특수 기능

이 PART는 사실상 E-15(K-Gov)의 심화 항목과 동일 대상을 다루므로, 실행 시 E-15와
묶어서 진행 권장.

| ID | 대상 | 목적 | 우선순위 | 커버리지 |
|---|---|---|---|---|
| G-1 | `phase17_share_target.test.mjs` | 정부24 앱 ↔ 혼디 앱 대 앱 연동, Web Share Target API | P0 | [기존] 미실행 |
| G-2 | `phase18_procedure_docs.test.mjs` | "정부24 공유문서 → 개인파산 court-filing 서류 연결" | P0 | [기존] 미실행 |
| G-3 | `phase19_welfare_eligibility.test.mjs` | "기초수급자격 확인+신청" 사고실험 | P0 | [기존] 미실행 |
| G-4 | `phase20_document_handoff.test.mjs` | "이력서+등본 두 통을 기업에 전송" 사고실험 | P1 | [기존] 미실행 |
| G-5 | `phase22_sp_author_automation.test.mjs` | B-4와 중복 리스트 — SP 저작 자동화 | P1 | [기존] 미실행 |
| G-6 | `phase24_web_search.test.mjs` | `POST /web-search`(Serper.dev 프록시) | P1 | [기존] 미실행, 외부 API 키 필요 시 [불가]로 재분류 가능 |

---

# PART H — 부트스트랩 / Shell UI [기존: `phase7_bootstrap.test.js`, B-01~B-09]

| ID | 대상 | 목적 | 우선순위 | 커버리지 |
|---|---|---|---|---|
| H-1 | `src/app.js` 부트스트랩 순서 | v3.1 문서 §7 명시 순서(core→pdv→openhash→...) 준수 | P0 | [기존] 미실행, A-1-2와 교차 확인 |
| H-2 | `index.html` Shell UI | 최초 로딩 화면 구성요소 | P1 | [기존] 미실행 |

---

# PART I — 횡단 관심사 (Cross-cutting)

이번 세션에서 실제로 필요성이 드러난, 기존 Phase 체계 어디에도 속하지 않는 신규 영역이다.

## I-1. SSOT 드리프트 방지

| ID | 대상 | 목적 | 우선순위 | 커버리지 |
|---|---|---|---|---|
| I1-1 | `pdv-history-client.js` 전 저장소 `diff` | 이번 세션 완료(12개 일치 확인, 3개 신규 배치) | P0 | **[완료]** |
| I1-2 | `gopang-wallet.js` 전 저장소 `diff` | **완료(2026-07-17, 이 세션) — 3세대 드리프트 확인.** ① gopang(허브): v2.0.0/IDB_VER=3, anchor_chain(OpenHash 통합)+WebAuthn PRF+X25519 암호화 키페어까지 포함(1,510줄, 최신). ② `users`: v2.0.0/IDB_VER=2, `hash_chain` 스토어(OpenHash 통합 이전 세대, anchor_chain 개명·WebAuthn·X25519 전부 없음, 1,062줄) — 허브와 users 사이 중간 세대가 그대로 배포돼 있음. ③ klaw/911/police/health/school/stock/insurance/market/tax/traffic/logistics/jeju/public/democracy/qna(15개): v1.0.0, IDB 스토어 자체가 keys 하나뿐(hash_chain조차 없음, 567줄) — OpenHash 앵커링 기능이 이 15개 저장소의 지갑에는 전혀 없는 상태. ④ security/gdc: `gopang-wallet.js` 파일 자체가 없음(같은 두 저장소에 `pdv-history-client.js`는 최근 배치돼 있음 — I1-1이 말한 "3개 신규 배치"가 아마 이 두 곳 포함일 가능성, 근데 지갑 파일은 그때 안 딸려간 것으로 보임). **재배포는 각 저장소에 대한 push 권한이 필요해 이 세션 범위 밖 — 주피터님 확인 후 우선순위(허브 v2.0.0을 18개 전체에 동기화할지, 아니면 위성 저장소는 지갑 기능 자체가 불필요한지) 판단 필요.** | **P0 — 조사 완료, 배포는 사용자 조치 필요** |
| I1-3 | `desktop.html`/`webapp.html` 공통 셸 템플릿 | 서비스마다 다른 트리, 어디까지 공유되어야 하는지 기준 문서 부재 | P2 |

## I-2. 참조 무결성 확장

| ID | 대상 | 목적 | 우선순위 | 커버리지 |
|---|---|---|---| ---|
| I2-1 | `check_stale_refs.py`의 SP-00-ROUTER 검사 스킵 근본 원인 | B2-6과 동일 항목, 여기서도 재강조 | **P0** | [신규] |
| I2-2 | GWP_REGISTRY 트리거 충돌 전수 조사 | E-18에서 발견한 "찾아줘" 3중 충돌처럼, 28개 서비스 전체 trigger 배열을 교차 비교해 숨은 충돌 찾기 | **P0 — 이번 계획서 작성 중 실제로 1건 발견됨, 전수조사 시 더 있을 가능성 높음** | [신규] |
| I2-3 | `services/fiil-kcleaner`, `kbank`/`ktelecom`/`kestate`(switch형) — 별도 저장소 없는 서비스들의 코드 실체 확인 | 이번 세션에서 fiil-kcleaner는 gopang/services 하위에 있음만 확인, kbank 등 3개는 존재 자체를 확인 안 함(type:switch라 SP만 있고 코드가 없을 가능성) | P1 | [신규] |

## I-3. 보안 회귀

| ID | 대상 | 목적 | 우선순위 | 커버리지 |
|---|---|---|---|---|
| I3-1 | `handleProfilePost` 서명 검증 우회 시나리오 | 서명 없이/위조 서명으로 프로필 갱신 시도 시 실제 거부되는지 | P0 | [신규] |
| I3-2 | `phone_verify_token` 재사용 공격 | 한 번 쓴 토큰 재사용 시 거부되는지 | P0 | [신규] |
| I3-3 | PDV `request_id` 위조(T-05에서 이미 로직 확인, 라이브 재현 필요) | 크로스 사이트 재사용 방어 | P0 | [기존 로직 확인, 라이브 미확인] |

## I-4. 환경 매트릭스 (실행 가능성 요약)

| 계층 | 정적 | 유닛 | 격리통합 | 워커통합 | 라이브 필수 |
|---|---|---|---|---|---|
| PART A(코어) | ✓ | ✓(A-3 완료) | — | — | A3-8 IDB만 |
| PART B(AI/오케스트레이션) | ✓ | 부분 | — | ✓(router-category, sp-intercall) | — |
| PART C(프로필2.0) | — | 추정 다수 | — | 추정 다수 | M03 결제는 라이브 필수 가능성 |
| PART D(시각코드) | ✓ | ✓(D-1 대부분 완료) | — | — | D1-5, D1-9 |
| PART E(K서비스) | ✓ | — | — | — | 대부분의 "도메인" 항목 |
| PART F~H | 부분 | ✓ | — | 부분 | — |
| PART I | ✓ | ✓ | — | — | I3 일부 |

---

# 3. 실행 로드맵 및 우선순위

## Phase R1 — 즉시(다음 세션 최우선, 전부 이 샌드박스에서 실행 가능)

1. **B2-5** `phase23_gwp_registry_scaling.test.mjs` — ✅ 완료(11/11 통과, 회귀 없음) + DB 드리프트 마이그레이션(`1786500002_...`) 추가
2. **PART C 전체(M01~M13)** — ✅ 완료(+보너스 M14). M08/M09/M11/M12/M14 절대경로 버그 수정 후 전부 통과(19/19, 12/12, 22/22, 19/19, 10/10). **M10(ledger.js) 프로덕션 모듈 자체가 없음 확인 — 사용자 결정 필요**
3. **A3-7** `phase_anchor_integration.test.js` — ✅ 완료(12/12 통과) + hashChain.js 배치 타이머 unref() 누락 버그 수정(프로세스 행 현상 재현·해결)
4. **B2-1, B2-2** `router-category.test.mjs`, `sp-intercall.test.mjs` — ✅ 완료. B2-1은 죽은 `router.js` 참조로 실행 자체 불가 확인 후 `sp-tag-dispatch.test.mjs`(16/16)로 교체. B2-2는 최초 실행 시 26개 중 8개 실패 → JEJU-DO-SP 목 파일명 드리프트(v1.0→v1.5)가 원인으로 확인, 수정 후 26/26 통과
5. **I1-2** `gopang-wallet.js` 전 저장소 diff — ✅ 조사 완료(3세대 드리프트 + security/gdc 파일 누락 발견, §I-1 참조) — **재배포는 push 권한 필요해 사용자 판단/조치 대기**
6. **I2-2** 트리거 충돌 전수조사(kusers/ksearch/tool-web-search 3중 충돌 재현 포함) — ✅ 완료. 정확히 동일한 trigger 문자열 공유 7쌍 확인(정보성, matchService dead code라 실사용 무관) + kusers 3중 충돌 판단 자체가 부정확했음을 재확인·정정(§E-18 S4)
7. **E-17, E-18** qna/users 방금 등록한 신규 서비스 최초 검증 — ✅ S1~S3 완료. **P0 발견: 두 저장소 모두 `pdv-history-client.js`가 없어 PDV 기록이 아예 안 되는 상태**(§E-17/E-18 S2 참조, 사용자 조치 필요)

## Phase R2 — 단기(1주 내)

- PART A 나머지(A2-3, A2-4, A4-1)
- PART B 나머지(B1 전체, B3-2, B3-4)
- PART E 도메인 심화(E-1~E-16 도메인 행 전체)
- PART F 전체

## Phase R3 — 중기(라이브 환경 접근 확보 후)

- PART G 전체(정부24 연계 — 외부 API 의존)
- D1-4, D1-5, D1-9(숫자코드 실물 렌더링·스캔·DB 유니크 제약)
- PART I-3 보안 회귀(라이브 공격 시나리오)
- jeju 현장 테스트 계획서(E-14)와의 통합

## Phase R4 — 지속(CI화)

- B4-1(build_manifest.py 자동 재생성-대조), I2-1(SP-00-ROUTER 매니페스트 키 근본 수정)을
  GitHub Actions에 편입해 매 push마다 자동 실행

---

# 4. 부록 — 전체 테스트 파일 인벤토리 (39개, gopang 기준)

| 파일 | Phase/모듈 | 이번 세션 실행 여부 |
|---|---|---|
| core/phase1_core.test.js | Phase 1(C-01~08) | 미실행 |
| pdv/phase2a_pdv.test.js | Phase 2A(P-01~08) | 미실행 |
| openhash/phase2b_openhash.test.js | Phase 2B(O-01~14) | **실행, 2건 수정 후 14/14** |
| pdv/phase2c_evidence.test.js | Phase 2C(E-01~06) | 미실행 |
| ai-secretary/phase3_ai_secretary.test.js | Phase 3(A-01~11) | 미실행 |
| domains/phase4_klaw.test.js | Phase 4(K-01~10) | 미실행 |
| network/phase5_network_gdc_privacy.test.js | Phase 5(N/G/P) | 미실행 |
| domains/phase6_khealth.test.js | Phase 6(H-01~10) | 미실행 |
| phase7_bootstrap.test.js | Phase 7(B-01~09) | 미실행 |
| network/phase9_push_broadcast.test.js | Phase 9(PB-01~04) | 미실행 |
| network/phase10_push_l1_priority.test.js | Phase 10 | 미실행 |
| integration/phase11_orchestration_registry_and_ksearch.test.mjs | Phase 11 | 미실행 |
| integration/phase12_gov_importance_scoring.test.mjs | Phase 12 | 미실행 |
| integration/phase13_ai_chat_handler.test.mjs | Phase 13 | 미실행 |
| integration/phase14_order_queue_handler.test.mjs | Phase 14 | 미실행 |
| integration/phase15_delivery_handler.test.mjs | Phase 15 | 미실행 |
| integration/phase16_pdv_extract.test.mjs | Phase 16 | 미실행 |
| integration/phase17_share_target.test.mjs | Phase 17 | 미실행 |
| integration/phase18_procedure_docs.test.mjs | Phase 18 | 미실행 |
| integration/phase19_welfare_eligibility.test.mjs | Phase 19 | 미실행 |
| integration/phase20_document_handoff.test.mjs | Phase 20 | 미실행 |
| integration/phase22_sp_author_automation.test.mjs | Phase 22 | 미실행 |
| integration/phase23_gwp_registry_scaling.test.mjs | Phase 23 | **미실행 — 직접 수정한 파일 관련, R1 최우선** |
| integration/phase24_web_search.test.mjs | Phase 24 | 미실행 |
| phase_anchor_integration.test.js | 별도(A-01~12) | 미실행 |
| router-category.test.mjs | 라우터 하네스 | 미실행 |
| sp-intercall.test.mjs | 오케스트레이션 하네스 | 미실행 |
| profile2.0/m01_auth.test.mjs | M01 | 미실행 |
| profile2.0/m02_register.test.mjs | M02(①과 직결) | 미실행 |
| profile2.0/m03_payment.test.mjs | M03 | 미실행 |
| profile2.0/m04_profile.test.mjs | M04 | 미실행 |
| profile2.0/m05_ai_assistant.test.mjs | M05 | 미실행 |
| profile2.0/m06_review.test.mjs | M06 | 미실행 |
| profile2.0/m07_location.test.mjs | M07 | 미실행 |
| profile2.0/m08_heatmap.test.mjs | M08 | 미실행 |
| profile2.0/m09_community.test.mjs | M09 | 미실행 |
| profile2.0/m10_ledger.test.mjs | M10 | 미실행 |
| profile2.0/m11_audit.test.mjs | M11 | 미실행 |
| profile2.0/m12_m13.test.mjs | M12+M13 | 미실행 |
| hondi-digit-code.roundtrip.test.mjs | ⑥(신규, 2026-07-17) | **실행, 13/13** |
| pdv-history-client.test.mjs | ④(신규, 2026-07-17) | **실행, 14/14** |

**39개 중 실행 완료 3개(8%), 미실행 36개(92%)** — 이것이 "간단히 끝났나"라는 질문에 대한
정량적 답이다. 이번 세션은 이 39개 중 극히 일부와, 그 바깥에 있던 정적 검증 도구
2개(`check_stale_refs.py`, `extract_gwp_registry.mjs`)를 돌렸을 뿐이다.

---

*(문서 끝 — 다음 세션은 위 "Phase R1" 7개 항목부터 순서대로 진행 권장)*
