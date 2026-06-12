# 고팡 (Gopang) 전체 저장소 디렉토리 구조
**작성일**: 2026-06-12  
**작성자**: AI City Inc. 팀 주피터  
**기반**: GitHub Openhash-Gopang org 실제 탐색 결과 + gopang_jeju_design_v1.3 + module_design_v1.0  
**저장소 수**: 확인된 10개 + 추정 포함 총 22개

---

## 조직 저장소 전체 지도

```
GitHub Organization: Openhash-Gopang (22개)
│
├── [인프라 코어]
│   ├── gopang          ← 메인 플랫폼 (gopang.net) + Worker (API 서버)
│   ├── GDC             ← Gopang Digital Currency (gdc.gopang.net)
│   └── OpenHash        ← L1 블록체인 노드 스냅샷 (l1-hanlim.gopang.net)
│
├── [사용자 서비스]
│   ├── users           ← 사용자 포털 (users.gopang.net) ← Profile 2.0 구축 대상
│   └── market          ← K-Market 프론트엔드 (market.gopang.net)
│
├── [K-시리즈 하위 시스템]
│   ├── traffic         ← K-Traffic (traffic.gopang.net)
│   ├── insurance       ← K-Insurance (insurance.gopang.net)
│   ├── democracy       ← K-Democracy (democracy.gopang.net)
│   ├── qna             ← Gopang QnA (qna.gopang.net)
│   └── [미발견 7개]    ← K-Law, K-Health, K-School, K-Security,
│                          K-Public, K-911, fiil 등 추정
│
└── [문서/인프라]
    └── [기타 9개]      ← 설계문서, SP 파일, 인프라 스크립트 추정
```

---

## 1. gopang — 메인 플랫폼 저장소

**URL**: `https://github.com/Openhash-Gopang/gopang`  
**배포**: `gopang.net` (GitHub Pages)  
**역할**: 플랫폼 진입점, Worker API 서버, 공유 라이브러리, 하위 시스템 통합 문서

```
gopang/                              ← C:\Users\주피터\Downloads\gopang\
│
├── [루트 — gopang.net 배포]
│   ├── index.html                   기기 감지 라우터 (모바일↔데스크톱)
│   ├── webapp.html                  모바일 PWA (AI 비서 + GWP 런처)
│   ├── desktop.html                 PC 랜딩 페이지 (마케팅)
│   ├── worker.js                    Cloudflare Worker v4.9 (API 서버) ★
│   ├── gopang-wallet.js             클라이언트 GDC 지갑 (IDB + redeemClaim)
│   ├── gopang-app.js                GWP_DONE 핸들러, PDV 연동
│   └── manifest.json                PWA 매니페스트
│
├── auth/                            ← gopang.net/auth/* (하위 시스템 공유)
│   ├── gopang-sso.js                SSO 라이브러리 (gopangAuth.require())
│   └── silent-auth.html             인증 엔드포인트 (리다이렉트·iframe)
│
├── report/                          ← gopang.net/report/*
│   └── gopang-report.js             PDV 보고서 전송 라이브러리
│
├── src/                             ← 빌드 소스 (gopang 앱 도메인별 플러그인)
│   ├── app.js                       부트스트랩
│   └── domains/
│       ├── k-law/
│       │   └── index.js             K-Law 플러그인 (SP 라우팅)
│       └── k-health/
│           └── index.js             K-Health 플러그인
│
├── docs/                            ← 플랫폼 문서
│   ├── gopang-auth-whitepaper.md    인증 백서 (L0~L3, §12 하위 시스템 가이드)
│   ├── gopang-report-manual.md      PDV 보고서 전송 매뉴얼
│   └── supabase_webauthn.sql        WebAuthn 테이블 SQL
│
├── tools/
│   └── build.py                     빌드 스크립트
│
└── [Profile 2.0 신규 — worker.js에 추가될 엔드포인트]
    worker.js 내 신규 핸들러:
      handleRegisterConsumer()       /register-consumer
      handleRegister()               /register
      handleQrCode()                 /qr/:handle
      handleCheckHandle()            /handle/check
      handleAiChat()                 /ai-chat
      handleInterpret()              /interpret
      handleAiSetup()                /ai-setup
      handleTokenRefresh()           /token-refresh   ← M01 auth.js 통합
      handleNearby()                 /nearby
      handleLocation()               /location
      handleDirections()             /directions
      handleHeatmap()                /heatmap
      handleCommunity()              /community
      handleCommunityReply()         /community/:id/reply
      handleCommunityResolve()       /community/:id/resolve
      handleSearch()                 /search (기존 확장)
```

**worker.js 내 모듈 통합 구조 (인라인)**
```
worker.js
  ├── [공유 인프라]    sbFetch(), _err(), corsHeaders
  ├── [M01 인라인]    makeGUID(), issueJWT(), verifyJWT(),
  │                  requireAuth(), handleTokenRefresh()
  ├── [M02 인라인]    handleRegisterConsumer(), handleRegister(),
  │                  handleCheckHandle(), handleQrCode()
  ├── [M03 인라인]    handleBizOrder() (기존 확장)
  ├── [M04 인라인]    handleBizProfile() (기존 확장)
  ├── [M05 인라인]    handleAiChat(), handleAiSetup(),
  │                  handleEscalate(), handleInterpret()
  ├── [M06 인라인]    handleBizReview() (기존 확장)
  ├── [M07 인라인]    handleNearby(), handleLocation(), handleDirections()
  ├── [M08 인라인]    handleHeatmap()
  ├── [M09 인라인]    handleCommunity(), handleCommunityReply(),
  │                  handleCommunityResolve()
  └── [기존 유지]     handleAuth*(), handlePdv*(), handleSvc*(),
                     handleGeocode(), handleMerkleVerify(), 기타
```

---

## 2. users — 사용자 포털 저장소

**URL**: `https://github.com/Openhash-Gopang/users`  
**배포**: `users.gopang.net` (GitHub Pages)  
**역할**: Profile 2.0 전체 프론트엔드  
**현재**: webapp.html, index.html, profile.html, register.html 존재

```
users/                               ← C:\Users\주피터\Downloads\users\
│
├── index.html                       기기 감지 라우터
├── webapp.html                      모바일 기본 (기존)
│
├── [M02 신규]
│   ├── register-consumer.html       소비자 최소 등록 (전화번호 + 이름)
│   └── register.html                사업자/기관 3-step 등록 (기존 확장)
│
├── [M03 신규]
│   └── pay.html                     금액 지정 즉시 결제 (QR 진입)
│
├── [M04 기존 확장]
│   └── profile.html                 프로필 + 메뉴 + AI비서 + 리뷰 탭
│
├── [M05 신규]
│   ├── ai-setup.html                LLM 키 등록 + AI 비서 설정
│   └── chat.html                    에스컬레이션 채팅 (사람 간 직접)
│
├── [M07+M08+M12 신규]
│   └── search.html                  검색(목록/지도/히트맵 탭) + 긴급도움
│
├── [M09 신규]
│   └── community.html               자국민 커뮤니티 게시판
│
└── assets/                          (공통 CSS, 아이콘 등)
```

---

## 3. market — K-Market 프론트엔드

**URL**: `https://github.com/Openhash-Gopang/market`  
**배포**: `market.gopang.net` (GitHub Pages)  
**역할**: K-Market 업체용 주문 관리, GWP 결제 게이트웨이  
**현재**: webapp.html, index.html 존재  
**태그**: v0.4.0-T10 (T01~T10 완료)

```
market/                              ← C:\Users\주피터\Downloads\market\
│
├── index.html                       기기 감지 라우터
└── webapp.html                      K-Market 업체 앱
                                       GWP_SIGN_REQUEST 수신
                                       GWP_DONE 포워딩
                                       주문 목록 관리
```

---

## 4. GDC — Gopang Digital Currency

**URL**: `https://github.com/Openhash-Gopang/GDC`  
**배포**: `gdc.gopang.net`  
**역할**: GDC 지갑, 충전/환불, 금융 대시보드

```
GDC/
│
├── index.html                       기기 감지 라우터
└── webapp.html                      GDC 지갑 앱
                                       잔액 조회
                                       충전 (Stripe 해외카드 — v1 예정)
                                       환불
                                       거래 내역
```

---

## 5. OpenHash — L1 블록체인 노드

**URL**: `https://github.com/Openhash-Gopang/OpenHash`  
**역할**: L1 한림읍 노드 일일 스냅샷, 감사 데이터  
**비고**: PocketBase 168.110.123.175:8091 미러

```
OpenHash/
│
├── README.md                        노드 상태 (자동 갱신)
└── snapshots/
    ├── 2026-06-11/
    │   └── snapshot.json
    ├── 2026-06-10/
    │   └── snapshot.json
    └── ...
```

---

## 6. K-시리즈 하위 시스템 공통 패턴

**발견된 저장소**: traffic, insurance, democracy, qna  
**패턴**: 모든 K-시리즈는 동일 구조를 따름

```
{subsystem}/                         예: traffic/, insurance/, democracy/
│
├── index.html                       기기 감지 라우터
├── webapp.html                      서비스 앱 (gopang-sso.js 통합)
│                                      subsystem-auth.js
│                                      window._onGopangAuth 콜백
│                                      gopang-report.js PDV 보고
└── README.md
```

**하위 시스템 통합 3원칙** (모든 K-시리즈 공통)
```
1. 인증: import { gopangAuth } from 'https://gopang.net/auth/gopang-sso.js'
2. PDV:  import { buildReport, sendReportOnce } from '...gopang-report.js'
3. 배포: {name}.gopang.net → Cloudflare Pages or GitHub Pages
```

---

## 7. Supabase 데이터베이스 (공유)

모든 저장소가 단일 Supabase 인스턴스를 공유합니다.

```
Supabase: ebbecjfrwaswbdybbgiu.supabase.co
│
├── [플랫폼 코어 — gopang]
│   ├── user_profiles         모든 엔티티 (개인/사업자/기관)
│   ├── fs_ledger             GDC 복식부기 원장
│   ├── l1_ledger             L1 블록 미러
│   ├── pdv_log               PDV Hash Chain
│   ├── merkle_anchors        머클 앵커링
│   ├── gopang_sessions       세션 감사
│   ├── nickname_cache        닉네임 캐시
│   ├── location_log          위치 기록 (+ consent 컬럼 — Phase 0)
│   └── reports               신고 내역
│
├── [GDC 금융]
│   ├── gdc_claims            GDC 청구권
│   └── gdc_deposits          GDC 예치금
│
├── [GDUDA 분산네트워크]
│   ├── gduda_nodes
│   ├── gduda_openid_blocks
│   ├── gduda_propagation_log
│   └── gduda_routing_table
│
├── [K-Market]
│   ├── biz_orders            주문
│   ├── biz_products          상품
│   ├── biz_reviews           업체 리뷰 (기존)
│   └── reviews               K-Market 리뷰 (tx 단위)
│
├── [K-Law]
│   ├── klaw_cases            사건 요약
│   ├── klaw_sessions         토큰 세션
│   └── klaw_benchmark        벤치마크
│
├── [K-School]
│   └── school_* (7개)
│
├── [K-Security]
│   ├── security_log
│   ├── security_event
│   └── security_command
│
├── [사용자 보조]
│   ├── users
│   ├── user_attributes
│   ├── user_nicknames
│   ├── user_trust_levels
│   ├── user_gdc_settings
│   └── gopang_sessions
│
├── [Profile 2.0 신규 — Phase 0 마이그레이션]
│   ├── user_llm_keys         LLM API 키 (AES-256-GCM)
│   ├── ai_sessions           AI 비서 세션
│   ├── messages              사람 간 채팅
│   ├── profile_reviews       업체 리뷰 (reviewer_lang 포함)
│   ├── community_posts       커뮤니티 게시판
│   └── community_replies     커뮤니티 댓글
│
└── [Views / Functions]
    ├── ktax_balance_anomalies     잔액 불일치 감사
    ├── sigma_delta_by_node        Σδ=0 검증
    ├── profile_review_stats       국적별 평점 집계
    ├── heatmap_by_lang()          히트맵 RPC
    └── reconstruct_balances()     잔액 재구성
```

---

## 8. Cloudflare Worker (단일 인스턴스)

```
배포 URL: gopang-proxy.tensor-city.workers.dev
소스:     gopang/worker.js (Cloudflare Edit Code 직접 배포)
버전:     v4.9 (현재) → v5.0 (Profile 2.0 추가 후)

환경변수 (Settings → Variables and secrets):
  ✅ DEEPSEEK_API_KEY
  ✅ KAKAO_REST_KEY
  ✅ OpenAI (→ OPENAI_API_KEY 통일 권장)
  ✅ SUPABASE_KEY
  ❌ SUPABASE_SERVICE_KEY   ← 등록 필요
  ❌ ANTHROPIC_API_KEY      ← 등록 필요
  ❌ GOPANG_MASTER_KEY      ← 등록 필요
  ❌ AES_ENCRYPTION_KEY     ← 등록 필요
  ❌ KAKAO_MOBILITY_KEY     ← 별도 신청 후 등록
```

---

## 9. 로컬 개발 환경 (Windows PowerShell)

```
C:\Users\주피터\Downloads\
│
├── gopang\          ← Openhash-Gopang/gopang 클론
├── market\          ← Openhash-Gopang/market 클론
├── users\           ← Openhash-Gopang/users 클론
│
└── [Profile 2.0 작업 파일 — 이번 세션 생성]
    ├── phase0_migration.sql     Supabase 실행용
    ├── auth.js                  M01 인증 모듈 (worker.js 통합용)
    └── test_m01_auth.mjs        M01 테스트 (node 실행)
```

---

## 10. Profile 2.0 파일 배치 계획

이번 세션에서 생성할 파일들의 최종 위치입니다.

```
[worker.js — gopang 저장소]
  gopang/worker.js                   M01~M09, M12 전체 핸들러 인라인 통합
                                     배포: Cloudflare Edit Code 직접 붙여넣기

[HTML — users 저장소]
  users/register-consumer.html       M02 소비자 등록
  users/register.html                M02 사업자/기관 등록 (기존 확장)
  users/pay.html                     M03 즉시 결제
  users/profile.html                 M04 프로필 (기존 확장)
  users/ai-setup.html                M05 AI 비서 설정
  users/chat.html                    M05 에스컬레이션 채팅
  users/search.html                  M07+M08+M12 검색+지도+히트맵
  users/community.html               M09 커뮤니티 게시판

[SQL — Supabase SQL Editor]
  phase0_migration.sql               Phase 0 테이블/컬럼 생성

[Python — 로컬 실행]
  tools/bulk_register.py             M14 대량 등록 (gopang/tools/ 또는 로컬)

[테스트 — 로컬 node 실행]
  test_m01_auth.mjs                  M01 ✅ 완료
  test_m02_register.mjs              M02 예정
  test_m03_payment.mjs               M03 예정
  ...
```

---

## 11. 배포 흐름

```
[코드 수정]
  PowerShell: fix.py 방식 (전체 재작성 금지)
  대상: C:\Users\주피터\Downloads\{repo}\{file}

  ↓

[저장소 반영]
  git add {file}
  git commit -m "feat: M0X 설명"
  git push
  → GitHub Pages 자동 배포 (HTML)

  ↓

[Worker 배포]
  git push ≠ 자동 배포
  → Cloudflare Dashboard → gopang-proxy → Edit Code
  → worker.js 전체 붙여넣기 → Deploy

  ↓

[Supabase 반영]
  → Supabase SQL Editor → 마이그레이션 SQL 실행
  → 테이블/View/Function 확인

  ↓

[태그]
  git tag v0.5.0-M01  (M01 완료 기준)
  git push origin --tags
```

---

## 12. 버전 태그 전략

```
v0.4.0-T10   현재 (T01~T10 완료)
v0.5.0-Ph0   Phase 0 마이그레이션 완료
v0.5.1-M01   M01 Auth 완료
v0.5.2-M02   M02 Register 완료
v0.5.3-M03   M03 Payment 완료
v0.5.4-M04   M04 Profile 완료
v0.5.5-M05   M05 AI 완료
v0.5.6-M06   M06 Review 완료
v0.5.7-M07   M07 Location 완료
v0.5.8-M08   M08 Heatmap 완료
v0.5.9-M09   M09 Community 완료
v0.6.0-M10   M10 Ledger 완료 (Phase 2)
v0.6.1-M11   M11 Audit 완료
v0.6.2-M12   M12 Search 완료
v0.6.3-M13   M13 Security 완료
v0.7.0-M14   M14 Bulk Register 완료
v1.0.0       Profile 2.0 전체 완료 — 한림읍 파일럿 준비
```

---

*고팡 저장소 디렉토리 구조 설계도 v1.0*  
*AI City Inc. 팀 주피터 | 2026-06-12*  
*실제 탐색 기반: gopang ✅ GDC ✅ OpenHash ✅ users ✅ market ✅*  
*traffic ✅ insurance ✅ democracy ✅ qna ✅ + 미확인 13개*
