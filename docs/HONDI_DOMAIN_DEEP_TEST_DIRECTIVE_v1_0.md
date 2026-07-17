# HONDI 도메인별 심화 기능 테스트 지시서 v1.0

**작성일**: 2026-07-17
**작성 근거**: `HONDI_MASTER_TEST_PLAN_v1_0.md` PART E, 이번 세션에서 18개 저장소를 직접 clone하여
확인한 실제 파일 구조 기반. K-Law(klaw)/K-Health(health)는 gopang 저장소 안에 도메인 테스트
파일(`phase4_klaw.test.js`, `phase6_khealth.test.js`)이 이미 있어 이번 세션에서 실행·수정까지
완료했다 — 이 지시서는 **그 2개를 제외한 나머지 16개 저장소**를 대상으로 한다.

## 0. 이 지시서를 왜 별도로 받았는가

이 16개 저장소는 각자 독립된 GitHub 저장소이고, gopang 저장소 안에는 이들의 도메인 고유
비즈니스 로직을 검증하는 테스트 파일이 전혀 없다. gopang 쪽 세션에서는 "이 저장소가 gopang과
맞물리는 지점"(SSOT 일치, GWP_REGISTRY 등록, PDV 클라이언트 존재)까지만 확인 가능했고, **각
저장소 내부의 실제 기능 로직**(보험료 계산이 맞는지, GDC 이자 계산이 맞는지, 세금 신고 로직이
맞는지 등)은 그 저장소를 직접 열어서 봐야 한다 — 그래서 별도 작업자에게 넘긴다.

## 1. 공통 방법론 (16개 전부에 적용)

이번 gopang 세션에서 반복적으로 마주친 패턴을 먼저 공유한다 — 같은 함정에 다시 빠지지 않기 위함.

### 1.1 "읽고 판단"보다 "실행해서 확인"
이번 세션에서 발견한 실제 버그(`evidencePackage.js`, `ai-secretary/phase6.js`의 `anchor()` API
드리프트, `sp-intercall.test.mjs`의 파일명 드리프트 등)는 전부 **코드를 읽기만 해서는 안 보이고
실제로 실행해봐야 드러났다**. 각 저장소마다:
1. 먼저 코드를 읽고 "이 로직이 무엇을 해야 하는지" 파악
2. **Node.js로 직접 실행 가능한 부분은 실행**(DOM 의존 없는 계산 로직 — 예: 보험료 계산, GDC
   이자 계산, 세금 계산 등은 대부분 순수 함수라 브라우저 없이 테스트 가능)
3. 문서(README/백서)의 주장과 실제 코드 동작이 일치하는지 대조

### 1.2 목(mock)이 프로덕션보다 뒤처지는 패턴을 의심
이번 세션에서 최소 4건(`router-category.test.mjs`, `sp-intercall.test.mjs`, `phase12` N-20,
`phase13_ai_chat_handler.test.mjs`)이 "프로덕션 코드는 갱신됐는데 테스트/목이 안 갱신됨" 패턴이었다.
기존 테스트 파일이 있다면 그냥 돌려보고 실패하면 **어느 쪽이 낡았는지**(테스트가 낡았는지,
프로덕션 코드가 실제로 깨졌는지) 반드시 구분할 것 — 테스트를 프로덕션에 맞춰 억지로 통과시키지
말고, 실제 버그면 프로덕션을 고칠 것.

### 1.3 LLM 호출 지점과 순수 로직 지점을 구분
`Node.js --test`로 직접 돌릴 수 있는 건 순수 계산/검증 로직뿐이다. LLM 호출이 있는 부분(각
저장소의 `prompts/` 디렉토리가 있다면 그 SP가 실제 대화에서 호출되는 지점)은:
- LLM을 목(mock)으로 교체해서(`node:test`의 `mock.module`, 또는 `globalThis.fetch` 오버라이드)
  "LLM이 특정 응답을 냈다고 가정했을 때 그 다음이 정확히 동작하는가"만 결정론적으로 테스트
- "LLM이 애초에 올바른 응답을 내는가"는 라이브 환경 품질 문제라 이 방식의 테스트 범위 밖 —
  이번 세션에서도 이 한계를 반복적으로 명시했다(`sp-tag-dispatch.test.mjs` 등 참고)

### 1.4 크로스 서비스 정합성을 반드시 확인
아래 §3에 정리했듯 여러 저장소가 서로 데이터를 주고받는다(market→gdc→tax 파이프라인,
insurance의 자동 트리거가 traffic/market/911/gdc 이벤트를 구독 등). **한 저장소만 보고 "정상"
판정하지 말고, 상대편 저장소의 실제 스키마/필드명과 맞는지 대조할 것** — 이번 세션에서
`gopang`의 `ledger.js`를 새로 만들 때 이미 `market`의 `seller_products` 스키마를 전제로
설계했으니, market 쪽 작업자는 그 전제(§3.1)가 실제로 맞는지 검증해줄 것.

### 1.5 테스트 산출물 형식
- 가능하면 `node:test` 형식(`describe`/`test`, `node --test`로 실행)으로 작성 — gopang
  저장소의 기존 테스트들과 스타일을 맞추면 나중에 통합하기 쉽다.
- 발견한 버그는 "테스트 수정"과 "프로덕션 코드 수정"을 커밋 메시지에서 명확히 구분(이번 세션의
  커밋 메시지 스타일 참고 — 원인·근거·결과를 구체적으로 남길 것).
- 각 저장소 작업이 끝나면 이 문서의 해당 섹션에 결과를 업데이트(✅/❌ + 발견 사항)해서 gopang
  쪽 마스터 테스트플랜에 다시 합류시킬 수 있게 할 것.

---

## 2. 저장소별 우선순위 매트릭스

| 저장소 | 서비스 | 파일 규모 | 우선순위 | 핵심 리스크 |
|---|---|---|---|---|
| 911 | K-Emergency | 8(최소) | **P0** | 긴급출동 오탐/누락 — 생명 직결 |
| gdc | GDC(디지털화폐) | 46(최대) | **P0** | 이자·잔액 계산 오류 — 금전 직결 |
| insurance | K-Insurance | 31 | **P0** | 보험료·자동청구 오류 — 금전 직결 |
| market | K-Market | 27 | **P0** | 정산 파이프라인 — gopang ledger.js와 직결 |
| tax | K-Tax | 14 | **P0** | 세금 계산 오류 — 법적 책임 |
| police | K-Police | 23 | P1 | 신고 접수·관제 화면 권한 |
| security | K-Security | 16 | P1 | 보안대응 로직 vs 백서 일치 여부 |
| school | K-Edu | 25 | P1 | 학생 리포트 정확성·상담 경계 |
| stock | K-Finance | 17 | P1 | school과 동일 아키텍처 — 자산관리 리포트 |
| traffic | K-Traffic | 18 | P1 | 카카오맵 연동, 실시간 매칭 |
| logistics | K-Logistics | 17 | P1 | traffic과 동일 아키텍처 |
| democracy | K-Democracy | 15 | P1 | AI 입법 파이프라인(SP-01~08) 무결성 |
| public | K-Gov | 10 | P1 | 정부24 연계 실제 vs 목업 |
| jeju | 제주도청 AI | 9(+gopang 내 SP 트리) | P1 | jeju-router.js 자체 검증 |
| users | Gopang Users | 17 | P1 | GAS 엔티티 검색 정확도 |
| qna | Gopang QnA | 52(최대 문서량) | P2 | 내부 SP 라우터(9개 도메인) |

---

## 3. 크로스-저장소 정합성 이슈 (여러 저장소 작업자가 함께 봐야 함)

### 3.1 market → gdc → tax 정산 파이프라인 vs gopang `ledger.js`
gopang 세션에서 이번에 `src/profile2.0/ledger.js`를 신규 구현했다(구매자 차변/판매자
대변(97%)/플랫폼 대변(3% 수수료) 3행 복식부기). 이건 **market 저장소의 `seller_products`
스키마(`docs/seller_products_pocketbase_schema.md`)를 전제로 설계**했다. market/gdc/tax 작업자는:
- market의 실제 결제 흐름(`gopang-order-flow.html`)이 이 3행 분개(구매자/판매자/플랫폼) 모델과
  실제로 일치하는지
- market 백서(§8 "gdc·tax 연동 파이프라인")에 설명된 흐름이 gdc의 `escrow.js`/`tokenomics.js`,
  tax 쪽 세금 계산 로직과 실제로 필드명·금액 단위까지 맞물리는지
반드시 대조해서, 만약 다르면 gopang의 `ledger.js`를 그에 맞춰 다시 조정해야 한다는 것도
같이 보고해줄 것.

### 3.2 `pdv.js` vs `pdv-history-client.js` 중복
`health`, `traffic`, `logistics`, `public`, `democracy` 5개 저장소에 `pdv-history-client.js`
외에 **별도로 `pdv.js`(또는 동일 계열)가 존재**한다. gopang 세션에서는 이게 뭔지 정확히
확인하지 못했다 — 각 저장소 작업자가:
- `pdv.js`와 `pdv-history-client.js`가 서로 다른 역할인지(예: `pdv.js`는 그 저장소 고유의 PDV
  스키마 확장이고 `pdv-history-client.js`는 범용 SSOT 클라이언트인지), 아니면 하나가 죽은 코드로
  남은 중복인지 확인해 보고할 것.

### 3.3 school ↔ stock 코드 공유
stock의 `js/auth.js`/`js/report.js`에 "school/auth.js 구조 완전 동일"이라는 주석이 있다 — 즉
두 저장소가 사실상 같은 코드를 복붙해서 쓰고 있다. school 작업자가 버그를 하나 발견하면 stock도
같은 버그가 있을 가능성이 높으니 **school 작업 결과를 stock에도 반드시 교차 적용**할 것
(traffic/logistics도 README에 "동일 아키텍처"라고 명시돼 있어 같은 관계).

### 3.4 insurance의 자동 트리거 — 4개 타 서비스 이벤트 구독
insurance의 `js/ins-auto.js`(이벤트 트리거 자동 보험 적용)는 README상 K-Traffic(탑승),
K-Market(배달), K-119=911(응급출동), GDC(고액이체) 4개 서비스의 이벤트를 구독해서 자동으로
보험을 적용한다고 설명돼 있다. 이 4개 저장소 작업자들은 자기 쪽에서 **insurance가 구독할 만한
이벤트를 실제로 발행하고 있는지**(이벤트명, payload 형식) 함께 확인해줄 것 — insurance
작업자 혼자서는 상대편 4곳의 실제 이벤트 발행 여부를 알 수 없다.

---

## 4. 저장소별 상세 지시

### 4.1 911 (K-Emergency) — id: kemergency — **P0**
- 파일 8개뿐이라 로직이 단순할 가능성이 높음 — `dashboard.html`이 실제 119/112 출동 연계 API를
  호출하는지, 아니면 여전히 목업(mock) 상태인지 최우선 확인(라이브 엔드포인트면 절대 실제로
  호출 테스트하지 말 것 — 실제 신고가 접수될 위험).
- gopang 쪽 GWP_REGISTRY에서 kemergency의 threshold가 0.6(전체 중 가장 낮음=가장 민감)로
  설정돼 있다 — 이 저장소 자체에도 비슷한 민감도의 트리거 판단 로직이 있다면, 단순 감탄사·욕설에
  오탐하지 않는지 실행 기반으로 확인.
- PDV 기록 시 실제 출동 요청 내용이 정확히 남는지(사후 감사 대비).

### 4.2 police (K-Police) — id: kpolice — P1
- `HANDOVER_police_auth_pdv.md`가 SSO 인증+PDV 연동 패턴을 상세히 설명한다 — 이 문서에 나온
  대로 실제 구현이 됐는지(`webapp.html`/`desktop.html`/`ops.html` 세 파일 전부에 인증 스크립트가
  붙어있는지)부터 확인.
- `ops.html`(경찰 운영 화면)의 접근 권한 체계 — 일반 사용자가 이 화면에 접근 가능한지 확인
  필요(마스터플랜 E-3에 이미 P1로 플래그됨).
- `data/` 디렉토리 내용 확인 — 실제 신고 데이터 스키마가 있다면 개인정보 노출 여부 점검.

### 4.3 security (K-Security) — id: ksecurity — P1
- `security-agent.js`(해킹/피싱 대응 로직)가 `security_whitepaper.html`/`prompts/security_whitepaper.md`
  의 주장과 실제로 일치하는지 — 문서에 설명된 기능 목록을 하나씩 코드에서 찾아 대조.
- `auth/subsystem-auth.js` — police의 HANDOVER 문서에 나온 것과 같은 패턴인지, 이 저장소도
  동일하게 구현됐는지 확인.

### 4.4 school (K-Edu) — id: kedu — P1
- `js/report.js`(학생 리포트 생성)가 `data/curriculum_table.md`/`data/report_table.md` 스키마와
  실제로 맞물리는지 — 순수 로직이면 Node.js로 직접 실행 테스트 가능.
- `docs/K-School_WhitePaper_v1.0.md`와 실제 코드 기능 대조.
- gopang 쪽에 이미 "전문상담교사 페르소나(B-3, needsMedicalSafety 상속 3개 중 하나)"가 있다 —
  K-Edu 서비스 자체(학교 행정)와 전문상담교사(개인 상담)의 역할 경계가 실제로 사용자에게
  혼란 없이 구분되는지 UX/문구 레벨에서 확인.
- **작업 완료 후 stock 저장소에도 동일 버그 없는지 교차 확인**(§3.3).

### 4.5 gdc (GDC 디지털화폐) — id: kgdc — **P0**
- **이관된 테스트 스펙 존재**: gopang의 `src/tests/network/phase5_network_gdc_privacy.test.js`가
  원래 G-01~08(인플레이션율/신규발행량/소각 6경로/GEI/SmartVault 4바스켓/통화풀 입금환전/
  K-Law 에스크로/DAO 거버넌스)을 검증하던 파일이었는데, 2026-07-15에 GDC 파일 6개
  (`tokenomics.js`/`smartVault.js`/`currencyPool.js`/`escrow.js`/`dao.js`/`offlineQueue.js`)가
  이 저장소로 이동하면서 gopang 쪽에서는 실행 불가능해졌다(2026-07-17 세션에서 발견·gopang
  쪽은 Network+Privacy만 분리해 살림, `phase5_network_privacy.test.js`). **이 저장소
  작업자가 원래 G-01~08 테스트 케이스(아래)를 이 저장소의 실제 `src/gdc/*.js`를 대상으로
  포팅해서 실행해줄 것** — gopang 쪽엔 이제 이 로직이 전혀 없어 gopang에서는 검증 불가:
  - G-01: 인플레이션율 공식 (`calcInflationRate` — GDP/소각률/기준율 기반, 최대 2% 캡)
  - G-02: 신규 발행량 계산 + 최대 공급량 캡
  - G-03: 소각(burn) 6개 경로 + 잘못된 경로 시 예외
  - G-04: GEI(Gopang Economic Index) 계산
  - G-05: Smart Vault 4개 바스켓(안정형 변동성 <5% 등)
  - G-06: 통화 풀(FIAT POOL) 입금·환전
  - G-07: K-Law 연동 에스크로 생성·집행(`DELIVERY_CONFIRMED` 등)
  - G-08: DAO 거버넌스 — `OWNERSHIP_TRANSFER` 제안 시 "DAWN 비영리 원칙" 위반으로 차단되는지,
    최소 스테이킹 미달 시 투표 거부되는지
  옛 테스트 파일 전문은 gopang 저장소 git 히스토리(`git log --all -- 'src/tests/network/phase5_network_gdc_privacy.test.js'`)에서 확인 가능.
- `src/gdc/tokenomics.js`, `currencyPool.js`, `escrow.js`, `dao.js`, `offlineQueue.js`, `smartVault.js`
  — 위 G-01~08과 정확히 대응. **전부 순수 로직일 가능성 높음, Node.js 직접 실행 테스트 최우선 대상.**
- README §1 "예금 이자 현저히 높음, 대출 이자 현저히 낮음" 주장을 실제 이자율 상수/계산식에서
  확인 — "현저히"가 구체적으로 몇 %인지, 계산식에 오류(반올림, 복리/단리 혼동 등)가 없는지.
- `pb_migrations`(PocketBase 스키마) — 실제 DB 제약조건과 `dao.js`의 쿼리가 일치하는지.
- `js/gdc-credit.js`(신용/대출) — `user_profiles.extra.fs`(재무제표) 기반 신용평가라는데, 이
  필드가 gopang의 profile2.0 `ledger.js`가 만드는 `computeSettledFs()` 출력(`bs-cash`,
  `pl-purchase`, `pl-revenue`)과 실제로 같은 스키마를 기대하는지 확인 — **다르면 정산 체계 전체가
  어긋난다.**
- §3.1 정산 파이프라인 정합성 확인 필수.

### 4.6 stock (K-Finance) — id: kfinance — P1
- `js/report.js`/`js/auth.js`가 school과 "구조 완전 동일" — school 작업 결과를 여기 먼저
  적용해보고, K-Finance 고유 로직(포트폴리오 성과·리밸런싱 계산으로 추정)만 추가로 검증.
- 주석에 "세무사에게도 보고서 전송"이라고 되어 있음 — tax 저장소와의 연동 지점이 실제로
  동작하는지(§3 크로스 이슈에 추가해서 tax 작업자와 공유).

### 4.7 insurance (K-Insurance) — id: kinsurance — **P0**
- `js/ins-premium.js`(보험료 계산 — 재무제표·나이·이력 기반), `js/ins-claim.js`(청구 자동화),
  `js/ins-risk.js`(AI 언더라이팅) — 순수 계산 로직이면 최우선 직접 실행 테스트.
- README "무심사 마이크로 보험, 심사 기간 0"이 실제로 신청→지급까지 전 과정 자동인지, 아니면
  사람 개입 지점이 숨어있는지 코드에서 확인.
- `sql/02_ins_rls.sql`(RLS 정책) — 타인의 보험 계약/청구 내역을 조회할 수 없는지 스키마 레벨
  보안 검증.
- §3.4 자동 트리거 크로스 검증 — 4개 서비스와의 이벤트 연동은 이 저장소 혼자서 검증 불가하니
  911/traffic/market/gdc 작업자와 반드시 결과 공유.

### 4.8 market (K-Market) — id: kcommerce/kcommerce_seller/kbusiness — **P0**
- 백서(v1.1) §8 "gdc·tax 연동 파이프라인"이 이번 세션 핵심 관심사(§3.1) — `gopang-order-flow.html`
  실제 흐름을 정독하고 3행 분개(구매자/판매자/플랫폼) 모델과 맞는지, 수수료율이 실제로 3%인지
  (gopang `ledger.js`는 3%로 가정하고 구현했음 — 다르면 반드시 알려줄 것).
- `docs/seller_products_pocketbase_schema.md` — gopang의 `_l1ListSellerProducts()`가 기대하는
  필드(`product_id`, `name`, `price`, `is_public`)와 실제 스키마 필드명이 정확히 일치하는지
  1:1 대조(다르면 gopang의 `ai-chat-handler.js` N-25/N-30 테스트가 실제와 다른 가짜 그림을
  테스트하고 있는 셈이 됨).
- GWP_REGISTRY 3개 entry(kcommerce/kcommerce_seller/kbusiness)가 이 저장소의 어느 화면과
  대응되는지 확인(`index.html`=구매자, `kmarket_seller_template.html`=판매자 등록 추정 — 검증 필요).

### 4.9 tax (K-Tax) — id: ktax — **P0**
- `docs/HANDOVER_tax_auth_pdv_test.md`, `docs/K-Tax_Whitepaper_v1_0.md` 대조.
- 세금 계산 로직(부가세, 종합소득세 등으로 추정) — 실제 세율 상수가 최신 법령 기준인지, 계산식에
  오류가 없는지 최우선 직접 실행 테스트.
- market/stock과의 연동 지점(§3.1, §4.6) 정합성.

### 4.10 traffic (K-Traffic) — id: ktransport — P1
- `worker-kakao-patch.js`(Kakao Maps 연동) — 실제 API 키/엔드포인트가 라이브인지 확인(라이브면
  실제 호출 테스트 시 비용 발생 가능성 — 목으로 대체해서 테스트).
- `pdv.js` 역할 확인(§3.2).
- README "이미 이동 중인 차량 동선에 새 수요를 끼워넣는" 매칭 알고리즘 — `prompts/traffic.md`
  (DeepSeek 매칭 엔진 SP)가 실제로 이 로직을 설명하는지, 아니면 순수 코드 로직이 별도로 있는지 확인.
- **작업 완료 후 logistics에도 동일 패턴 교차 확인**(§3.3, "동일 아키텍처" 명시됨).

### 4.11 logistics (K-Logistics) — id: klogistics — P1
- traffic과 사실상 동일 아키텍처 — traffic 작업 결과를 먼저 적용해보고, 물류 고유 로직(1·2·3차
  산업 화물 특성 반영 부분)만 추가 검증.
- `national-dashboard.html`이 "7개 페이지"라고 README에 명시 — 각 페이지가 실제로 존재/동작하는지.

### 4.12 jeju (제주도청 AI) — id: jeju — P1
- `jeju-router.js` — gopang 세션에서 이미 이 파일이 요청하는 `JEJU-DO-SP_v1.5.md` 등의 파일명이
  gopang의 `prompts/Jejudo/` 트리와 실제로 일치하는지는 `sp-intercall.test.mjs`로 간접 검증했다
  (드리프트 1건 발견·수정함, v1.0→v1.5). **이 저장소 작업자는 `jeju-router.js` 자체를 gopang
  의존 없이 독립적으로(예: 이 파일만 Node.js로 로드해서 `_RAW`/`_RAW_ROOT` 상수가 가리키는 실제
  gopang raw URL들이 전부 살아있는지) 검증할 것** — gopang 쪽에서 파일명을 또 바꾸면 여기서도
  다시 깨질 수 있으므로 양쪽에서 서로 감시하는 구조가 이상적.
- `JEJU_CHAIN: SP-DO-000 > L2 > L3? > L4?` 문법(동적 SP 조합) — 실제 요청 패턴별로 조합이
  맞게 되는지 실행 테스트.

### 4.13 public (K-Gov) — id: kgov — P1
- "정부24 연계"가 실제 라이브 API인지 목업인지 최우선 확인(마스터플랜에 이미 "라이브 테스트
  항목 — 불가"로 플래그돼 있던 부분, 실제 코드 확인은 이번이 처음).
- `pdv.js` 역할 확인(§3.2).
- `prompts/public.md` — SP 내용과 실제 기능 대조.

### 4.14 democracy (K-Democracy) — id: kdemocracy — P1
- README의 AI 입법 파이프라인(제안→SP-01~SP-08→OpenHash 앵커링)이 실제로 구현돼 있는지 —
  8단계 SP가 전부 `prompts/`나 `ai_democracy_system_prompts.md`에 존재하는지 먼저 확인.
- **SP-04(찬성발의단) ‖ SP-05(반대심사단) "상호 차단"**이라는 표현이 흥미로움 — 실제로 두
  그룹이 서로의 판단에 영향을 못 주도록 격리돼 있는지(같은 세션/같은 컨텍스트를 공유하면
  담합·편향 위험) 코드 레벨에서 확인.
- SP-06(DeepSeek V4 Pro)/SP-07(Claude Opus) 교차검증 — 실제로 서로 다른 두 모델을 쓰는지, 아니면
  이름만 다르고 같은 호출인지 확인(중요 — "교차검증"의 신뢰성이 여기 달림).
- `gopang_laws.html`(원칙 17조/민사규칙 18조/형사규칙 30조) — 실제 규칙 수가 문서와 일치하는지.

### 4.15 qna (Gopang QnA) — id: kqna — P2
- gopang 세션에서 이미 S1~S3 확인 완료(엔트리포인트/GWP_REGISTRY 등록 정상, PDV 클라이언트는
  누락 발견 후 배치 완료함).
- `docs/index.json` + `docs/{strategy,pilot,subsystems,ops}/` 문서 인덱스 구조 — 실제 라우팅이
  이 인덱스와 일치하는지.
- **`SP-CORE.txt` + 9개 도메인별 SP(BIZ/ECONOMY/EDU/GOV/INFRA/IP/LEGAL/LOGISTICS/SAFETY) 자체
  내부 라우터**(gopang의 GWP_REGISTRY와는 완전 별개 — qna 저장소 자체 라우팅 로직) — 마스터
  플랜에 "완전 미검증 영역"으로 남아있던 부분, 이번에 처음 확인 필요.

### 4.16 users (Gopang Users) — id: kusers — P1
- gopang 세션에서 이미 S1~S3 확인 완료(PDV 클라이언트 누락 발견 후 배치 완료함).
- **GAS(Gopang Address System) v1.6** 기반 엔티티 검색 — `register.html`/`register-profile.html`/
  `profile.html`과의 데이터 연동, 검색 정확도(동명이인 처리, 부분 일치 등) 검증.
- `sp/` 디렉토리(`SP-USERS-v2_0.txt`, `SP-USERS-v2_1.txt`) — 최신 버전이 실제로 쓰이는지 버전
  드리프트 확인(이번 세션에서 여러 저장소에 걸쳐 이런 드리프트가 반복 발견됐다 — 습관적으로 확인).

---

## 5. 완료 후 보고 형식

각 저장소 작업이 끝나면 아래 형식으로 결과를 남겨서 gopang 세션에 다시 합류시킬 수 있게 할 것
(이번 세션의 `HONDI_MASTER_TEST_PLAN_v1_0.md` 갱신 스타일 참고):

```
## [저장소명] 작업 결과 (YYYY-MM-DD)
- 실행한 테스트: N개 (통과 X / 실패 Y)
- 발견한 버그: [프로덕션 코드 버그 목록 — 수정 완료 여부 포함]
- 발견한 테스트 드리프트: [테스트가 낡아서 실패했던 것들]
- 크로스-저장소 이슈: [§3 관련 발견사항]
- 미해결/사용자 판단 필요: [설계 트레이드오프가 있어 임의로 안 고친 것들]
```
