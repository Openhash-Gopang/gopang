# 고팡 제주 모듈 설계도 v1.0
**작성일**: 2026-06-12  
**작성자**: AI City Inc. 팀 주피터  
**기반 문서**: gopang_jeju_design_v1.3.md  
**목적**: 시스템 골격 정의 — 각 모듈의 책임, 인터페이스, 의존성, 테스트 기준  
**원칙**: 코드 제외, 구조·계약·검증 기준만 기술

---

## 목차

1. [모듈 전체 지도](#1-모듈-전체-지도)
2. [계층 구조](#2-계층-구조)
3. [M01 — 인증 모듈 (Auth)](#3-m01--인증-모듈-auth)
4. [M02 — 등록 모듈 (Register)](#4-m02--등록-모듈-register)
5. [M03 — 결제 모듈 (Payment)](#5-m03--결제-모듈-payment)
6. [M04 — 프로필 모듈 (Profile)](#6-m04--프로필-모듈-profile)
7. [M05 — AI 비서 모듈 (AI Assistant)](#7-m05--ai-비서-모듈-ai-assistant)
8. [M06 — 리뷰 모듈 (Review)](#8-m06--리뷰-모듈-review)
9. [M07 — 위치 모듈 (Location)](#9-m07--위치-모듈-location)
10. [M08 — 히트맵 모듈 (Heatmap)](#10-m08--히트맵-모듈-heatmap)
11. [M09 — 커뮤니티 모듈 (Community)](#11-m09--커뮤니티-모듈-community)
12. [M10 — GDC 결제 원장 모듈 (Ledger)](#12-m10--gdc-결제-원장-모듈-ledger)
13. [M11 — PDV Hash Chain 모듈 (Audit)](#13-m11--pdv-hash-chain-모듈-audit)
14. [M12 — 검색 모듈 (Search)](#14-m12--검색-모듈-search)
15. [M13 — 보안 모듈 (Security)](#15-m13--보안-모듈-security)
16. [M14 — 대량 등록 모듈 (Bulk Register)](#16-m14--대량-등록-모듈-bulk-register)
17. [공유 인프라 (Shared Infrastructure)](#17-공유-인프라-shared-infrastructure)
18. [모듈 간 의존성 매트릭스](#18-모듈-간-의존성-매트릭스)
19. [통합 테스트 시나리오](#19-통합-테스트-시나리오)
20. [구현 순서 로드맵](#20-구현-순서-로드맵)

---

## 1. 모듈 전체 지도

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Frontend (GitHub Pages)                       │
│                        users.gopang.net                              │
│                                                                      │
│  [M02]           [M03]      [M04]        [M05]    [M06]             │
│  register*.html  pay.html   profile.html ai-setup  (profile 내 탭)  │
│                                                                      │
│  [M07]           [M08]      [M09]        [M12]                      │
│  search.html     search.html community.html search.html              │
│  (위치카드)      (히트맵탭) (게시판)     (검색탭)                    │
└────────────────────────────┬────────────────────────────────────────┘
                             │ HTTPS / JWT
┌────────────────────────────▼────────────────────────────────────────┐
│                  Cloudflare Worker (gopang-proxy)                    │
│                                                                      │
│  [M01] Auth      [M02] Register    [M03] Payment                    │
│  /auth/*         /register*        /biz/order  /qr/*                │
│                                                                      │
│  [M04] Profile   [M05] AI          [M06] Review                     │
│  /biz/profile/*  /ai-chat          /review                          │
│  /interpret      /ai-setup                                           │
│                  /escalate                                           │
│                                                                      │
│  [M07] Location  [M08] Heatmap     [M09] Community                  │
│  /nearby         /heatmap          /community/*                     │
│  /location                                                           │
│  /directions                                                         │
│                                                                      │
│  [M10] Ledger    [M11] Audit       [M12] Search   [M13] Security    │
│  (내부 함수)     /merkle/verify    /search        (파이프라인)       │
└──────────┬──────────────────────────────────┬───────────────────────┘
           │                                  │
┌──────────▼──────────┐          ┌────────────▼────────────┐
│      Supabase        │          │     L1 PocketBase        │
│  [M01] gopang_sessions│          │  blocks                  │
│  [M02] user_profiles  │          │  gdc_keys                │
│  [M03] biz_orders     │          │  transactions            │
│        fs_ledger      │          │                          │
│  [M04] user_profiles  │          └──────────────────────────┘
│  [M05] ai_sessions    │
│        messages       │
│        user_llm_keys  │
│  [M06] profile_reviews│
│  [M07] location_log   │
│        user_profiles  │
│        (lat/lng)      │
│  [M08] location_log   │
│  [M09] community_*    │
│  [M10] fs_ledger      │
│        l1_ledger      │
│  [M11] pdv_log        │
│        merkle_anchors │
│  [M12] user_profiles  │
│  [M13] security_*     │
└─────────────────────-─┘
```

---

## 2. 계층 구조

모듈은 4개 계층으로 분류됩니다. 상위 계층은 하위 계층에 의존하고, 역방향 의존은 금지입니다.

```
L4 — 애플리케이션 계층   M02 M03 M04 M05 M06 M07 M08 M09 M12 M14
     (사용자 기능)

L3 — 도메인 계층         M10 M11
     (원장·감사)

L2 — 인프라 계층         M01 M13
     (인증·보안)

L1 — 공유 인프라         Supabase Client · Worker Router
     (런타임 기반)        · JWT Lib · Translate Helper
```

**계층 규칙**
- L4 모듈은 L1~L3 모두 호출 가능
- L3 모듈은 L1~L2만 호출 가능
- L2 모듈은 L1만 호출 가능
- 동일 계층 모듈 간 직접 호출 금지 — Worker 라우터를 통해서만 조합

---

## 3. M01 — 인증 모듈 (Auth)

### 3.1 책임
- gopang_token(JWT) 발급·갱신·검증
- GUID 결정성 생성 (uuidv5)
- 모든 인증 필요 엔드포인트의 게이트키퍼

### 3.2 인터페이스

| 방향 | 엔드포인트 / 함수 | 입력 | 출력 |
|------|-----------------|------|------|
| Worker IN | `POST /register-consumer` | phone, name, lang | JWT token |
| Worker IN | `POST /register` | entity data | JWT token |
| Worker IN | `POST /token-refresh` | Bearer JWT | 신규 JWT |
| 내부 함수 | `verifyJWT(token, key)` | JWT string | payload \| 401 |
| 내부 함수 | `makeGUID(phone_digits)` | string | uuidv5 string |

### 3.3 상태·저장
- `gopang_sessions` 테이블 — 발급된 토큰 감사 기록 (선택적)
- `user_profiles.guid` — GUID 원천

### 3.4 의존 모듈
- 없음 (최하위 인증 계층)

### 3.5 테스트 항목

| ID | 시나리오 | 입력 | 기대 결과 |
|----|---------|------|---------|
| A01 | 정상 등록 후 토큰 발급 | 유효한 phone + name | JWT 반환, 24시간 exp |
| A02 | 동일 전화번호 재등록 | 기존 phone | 동일 GUID, 새 JWT |
| A03 | 유효 토큰 갱신 | exp 1시간 이내 JWT | 새 JWT, 갱신된 exp |
| A04 | 만료 토큰 갱신 시도 | exp 초과 JWT | 401 Unauthorized |
| A05 | 서명 위조 토큰 | 임의 변조 JWT | 401 Unauthorized |
| A06 | 인증 필요 엔드포인트 무토큰 접근 | 헤더 없음 | 401 |
| A07 | 외국 번호(+86) GUID 결정성 | +86-138-0013-0000 (2회) | 동일 GUID |
| A08 | GOPANG_MASTER_KEY 미등록 시 | env 누락 | 500 + 명시적 오류 메시지 |

---

## 4. M02 — 등록 모듈 (Register)

### 4.1 책임
- 소비자 최소 등록 (전화번호 + 이름)
- 사업자/기관 3-step 등록
- handle 로마자 생성 및 중복 처리
- QR 이미지(SVG) 생성 및 반환

### 4.2 인터페이스

| 방향 | 엔드포인트 | 입력 | 출력 |
|------|-----------|------|------|
| Worker IN | `POST /register-consumer` | phone, name, lang | JWT, guid, handle |
| Worker IN | `POST /register` | entity_type + 상세 필드 | JWT, guid, handle |
| Worker IN | `GET /handle/check` | handle 후보 | available: bool |
| Worker IN | `GET /qr/:handle` | handle | SVG image |
| Frontend | register-consumer.html | — | 2-field 폼 |
| Frontend | register.html | — | 3-step 폼 |

### 4.3 상태·저장
- `user_profiles` — 모든 등록 엔티티
- `user_profiles.handle` — UNIQUE 제약

### 4.4 내부 처리 흐름
```
소비자 등록:
  phone 입력 → 숫자 추출 → uuidv5 → GUID
  → handle 자동 생성 (@{읍면동}_{이름_로마자})
  → handle UNIQUE 확인 → 충돌 시 suffix 4자리 채번
  → user_profiles INSERT (ON CONFLICT (guid) DO UPDATE)
  → JWT 발급 (M01 위임)
  → return_to 복귀 처리 (pending_pay_url)

사업자 등록:
  위와 동일 + entity_type='org' + extra JSONB 구성
  + AI 비서 ON 시 → user_llm_keys INSERT (M05 위임)
```

### 4.5 의존 모듈
- M01 (JWT 발급)
- M05 (AI 비서 키 저장 — 선택적)

### 4.6 테스트 항목

| ID | 시나리오 | 입력 | 기대 결과 |
|----|---------|------|---------|
| R01 | 소비자 최소 등록 | phone + name | user_profiles INSERT, JWT 반환 |
| R02 | handle 충돌 시 suffix | 동일 지역+이름 2명 | @hallim_kimmin vs @hallim_kimmin_0001 |
| R03 | 사업자 3-step 완료 | org 전체 필드 | entity_type=org, extra 구성 정확 |
| R04 | 기관 등록 | institution 필드 | entity_type=institution |
| R05 | QR SVG 반환 | GET /qr/@handle | image/svg+xml, 300×300 |
| R06 | QR Cloudflare 캐시 | 동일 handle 2회 요청 | 2번째는 캐시 HIT |
| R07 | return_to 복귀 | pay.html → 등록 → 복귀 | pending_pay_url 정확히 복귀 |
| R08 | ON CONFLICT 재등록 | 기존 GUID로 재등록 | name 갱신, GUID 불변 |
| R09 | 외국 번호 국가코드 | +86 prefix 포함 입력 | 숫자만 추출 후 GUID 생성 |

---

## 5. M03 — 결제 모듈 (Payment)

### 5.1 책임
- QR 결제 파이프라인 (GWP_SIGN_REQUEST → L1 → GWP_DONE)
- pay.html 금액 지정 즉시 결제
- QR 만료 검증 (created_at + expires)
- buyer_claim 생성 및 클라이언트 전달
- fs_ledger 3행 원자 INSERT

### 5.2 인터페이스

| 방향 | 엔드포인트 | 입력 | 출력 |
|------|-----------|------|------|
| Worker IN | `POST /biz/order` | signed_tx, to, amount, items, created_at, expires | ok, buyer_claim, block_hash |
| Frontend | pay.html | QR URL 파라미터 | 결제 UI |
| Frontend | profile.html | 메뉴 선택 | GWP_SIGN_REQUEST 트리거 |
| L1 OUT | `POST /api/tx` | tx payload | block_id, block_hash, height |

### 5.3 상태·저장
- `biz_orders` — 주문 레코드
- `fs_ledger` — 3행 (buyer debit / seller credit / platform credit)
- `l1_ledger` — L1 블록 미러

### 5.4 내부 처리 흐름
```
POST /biz/order 수신
  → QR 만료 검증: now() - created_at > expires → 409 QR_EXPIRED
  → ED25519 서명 검증 (user_profiles.public_key)
  → L1 POST /api/tx
  → L1 응답: block_id, block_hash
  → buyer_claim 생성 (expires_at: 7일, direction: debit)
  → seller_claim 생성 (direction: credit)
  → market_purchase() RPC → fs_ledger 3행 원자 INSERT
  → biz_orders INSERT
  → GWP_DONE payload 구성 → 클라이언트 반환

pay.html 만료 처리:
  진입 시: now() - created_at > expires → "결제 시간 만료" 표시
  복귀 시: localStorage pending_pay_url → 잔여 시간 재계산
```

### 5.5 계정 과목 규칙 (T07 확정)
```
bs-cash    : Σcredit - Σdebit (순변동분)
pl-purchase: Σdebit (양수 누적 — cur + amount)
pl-revenue : Σcredit (양수 누적)
fs_ledger.source: 'market' 고정 ('kmarket' 사용 금지)
```

### 5.6 의존 모듈
- M01 (JWT 검증)
- M10 (Ledger — fs_ledger 원자 INSERT)
- M11 (PDV 기록 — 결제 완료 후)

### 5.7 테스트 항목

| ID | 시나리오 | 입력 | 기대 결과 |
|----|---------|------|---------|
| P01 | 정상 결제 | 유효 QR + 잔액 충분 | biz_orders, fs_ledger 3행, buyer_claim |
| P02 | QR 만료 결제 | expires=300, created_at 301초 전 | 409 QR_EXPIRED |
| P03 | 잔액 부족 | GDC < amount | 402 INSUFFICIENT_BALANCE |
| P04 | 서명 위조 | 잘못된 ED25519 서명 | 403 INVALID_SIGNATURE |
| P05 | fs_ledger source 검증 | source='kmarket' | 400 CHECK_VIOLATION |
| P06 | pl-purchase 양수 누적 | 3회 연속 결제 | pl-purchase 항상 양수 |
| P07 | buyer_claim expires_at | 결제 완료 | expires_at = now + 7일 |
| P08 | 초방문자 pay.html 진입 | 토큰 없음 | register-consumer 리다이렉트 + return_to 저장 |
| P09 | L1 타임아웃 | L1 무응답 5초 | 504 + 롤백 |
| P10 | 중복 결제 방지 | 동일 tx_id 2회 | biz_orders UNIQUE 위반 → 409 |

---

## 6. M04 — 프로필 모듈 (Profile)

### 6.1 책임
- 업체·기관 프로필 조회 및 다국어 번역
- 탭 구성 (메뉴/정보/리뷰/AI비서) 동적 제어
- 위치 카드 표시 (현재 위치 → 업체 거리)
- OG meta 태그 동적 생성 (SNS 공유용)

### 6.2 인터페이스

| 방향 | 엔드포인트 | 입력 | 출력 |
|------|-----------|------|------|
| Worker IN | `GET /biz/profile/:handle` | handle, viewer_lang | profile JSON + review_summary |
| Worker IN | `GET /interpret` | text, from_lang, to_lang | translated text |
| Frontend | profile.html | ?handle=, ?viewer_lang= | 다국어 프로필 UI |

### 6.3 /biz/profile 응답 구조
```
{
  guid, handle, name, entity_type, address,
  native_lang, is_public, lat, lng,
  extra: { menu[], business_hours, ai_active, ... },
  ai_active: bool,           -- user_llm_keys 기준 (M01 §6.1)
  review_summary: {          -- M06에서 조합
    overall: { count, avg },
    by_lang: [...],
    viewer_highlight: { lang, avg, count }
  },
  distance_m: number | null  -- viewer 위치 제공 시
}
```

### 6.4 ai_active 판정 규칙
```
1. user_llm_keys WHERE guid = profile.guid 조회
2. 레코드 없음 → ai_active = false
3. 레코드 있고 ai_active = false → false
4. 레코드 있고 ai_active = true → true
```

### 6.5 의존 모듈
- M01 (선택적 JWT — 미인증 시 read-only)
- M06 (review_summary 조합)
- M07 (distance_m 계산)

### 6.6 테스트 항목

| ID | 시나리오 | 입력 | 기대 결과 |
|----|---------|------|---------|
| PR01 | 한국어 프로필 조회 | ?handle=@hallim_x, lang=ko | 원문 반환 |
| PR02 | 중국어 자동 번역 | ?handle=@hallim_x, lang=zh | name/address 번역본 |
| PR03 | ai_active 탭 표시 | user_llm_keys 있고 true | [AI비서] 탭 표시 |
| PR04 | ai_active 탭 미표시 | user_llm_keys 없음 | [AI비서] 탭 없음 |
| PR05 | is_public=false | 비공개 업체 | 404 NOT_FOUND |
| PR06 | review_summary 정합성 | 리뷰 10건 | by_lang 합계 = overall.count |
| PR07 | viewer_highlight | viewer_lang=zh, zh 리뷰 있음 | zh 항목 highlight 포함 |
| PR08 | OG meta 생성 | profile.html?handle= | og:title, og:description, og:image |

---

## 7. M05 — AI 비서 모듈 (AI Assistant)

### 7.1 책임
- 소비자↔업체 다국어 실시간 통역
- 업체 LLM으로 AI 응답 생성
- 에스컬레이션 (3회 실패 / "사람 연결" 감지)
- LLM API 키 AES-256-GCM 암호화 저장·복호화
- 위치 컨텍스트 주입 (관광지 추천, 영업시간 판단)
- STT/TTS는 브라우저 담당 (Web Speech API)

### 7.2 인터페이스

| 방향 | 엔드포인트 | 입력 | 출력 |
|------|-----------|------|------|
| Worker IN | `POST /ai-chat` | session_id, message, caller_lang, target_guid | response, mode |
| Worker IN | `POST /ai-setup` | guid, provider, api_key, model, custom_prompt | ok |
| Worker IN | `POST /escalate` | session_id | ok, mode=escalated |
| Worker IN | `POST /interpret` | text, from_lang, to_lang | translated |
| Frontend | profile.html AI탭 | STT 텍스트 | TTS 재생 |
| Frontend | ai-setup.html | LLM 설정 폼 | 저장 완료 |

### 7.3 /ai-chat 처리 흐름
```
수신: { session_id, message, caller_lang, target_guid }
  → JWT 서명 검증 (M01)
  → ai_sessions 조회 (mode, messages, fail_count)
  → 에스컬레이션 조건 확인:
      messages 내 최근 10분 fail 이벤트 ≥ 3 → escalate
      message 내 에스컬레이션 키워드 감지 → escalate
  → translate(message, caller_lang → 'ko')  [DeepSeek 기본]
  → user_llm_keys 조회 (target_guid)
  → ai_active=true:
      시스템 프롬프트 구성:
        extra.menu 전체 + business_hours + 위치 컨텍스트
        "메뉴 외 정보는 모른다고 답하라" 강제 규칙
      업체 LLM으로 응답 생성
      translate(response, 'ko' → caller_lang)
      ai_sessions.messages 갱신
      반환
  → ai_active=false:
      messages INSERT (번역문 포함)
      Supabase Realtime → 업체 기기 푸시
      반환 { mode: 'human' }
```

### 7.4 에스컬레이션 상태 머신
```
상태: ai → human → escalated
전이:
  ai → escalated: 실패 ≥ 3 또는 키워드
  human → escalated: 30초 무응답
  escalated: mode UPDATE, Realtime 브로드캐스트
복구: 수동 전용 (관리자 또는 업체가 mode 재설정)
```

### 7.5 의존 모듈
- M01 (JWT 검증)
- M07 (위치 컨텍스트 — 선택적)

### 7.6 테스트 항목

| ID | 시나리오 | 입력 | 기대 결과 |
|----|---------|------|---------|
| AI01 | 정상 AI 응답 | 중국어 질문, ai_active=true | 중국어 번역 응답 |
| AI02 | AI 비활성 업체 | ai_active=false | messages INSERT, mode=human |
| AI03 | 3회 연속 실패 | fail 이벤트 3회 | mode=escalated, Realtime 푸시 |
| AI04 | 에스컬레이션 키워드 | "사람 연결해줘" | mode=escalated |
| AI05 | 할루시네이션 방지 | "근처 편의점 어디?" | 메뉴 외 정보 거절 응답 |
| AI06 | LLM 키 암호화 저장 | POST /ai-setup | DB에 암호화 저장, 평문 없음 |
| AI07 | AES 복호화 정합성 | 저장 후 조회 | 원본 키와 동일 |
| AI08 | AES_ENCRYPTION_KEY 미등록 | env 누락 | 500 + 명시적 오류 |
| AI09 | 위치 컨텍스트 주입 | "여기서 얼마나 걸려?" | distance_m 포함 응답 |
| AI10 | 6개 언어 번역 | ko/zh/en/ja/vi/th | 각 언어로 정상 번역 |

---

## 8. M06 — 리뷰 모듈 (Review)

### 8.1 책임
- 구매 검증 후 리뷰 작성 (tx_id 기반)
- 다국어 리뷰 저장 (원문 + 한국어 번역본)
- reviewer_lang 자동 주입 (JWT.lang)
- 국적별 평점 집계 (profile_review_stats View)
- 평점 편향 감지 및 중립 문구 표시

### 8.2 인터페이스

| 방향 | 엔드포인트 | 입력 | 출력 |
|------|-----------|------|------|
| Worker IN | `POST /review` | target_guid, tx_id, rating, body | ok, review_id |
| Worker IN | `GET /biz/profile/:handle` | handle, viewer_lang | review_summary 포함 |
| Frontend | profile.html 리뷰탭 | 국적 필터 칩 | 필터된 리뷰 목록 |

### 8.3 리뷰 저장 흐름
```
POST /review 수신
  → JWT 검증 → reviewer_guid, reviewer_lang 추출
  → tx_id 유효성 검증:
      biz_orders WHERE tx_id=? AND buyer_guid=reviewer_guid → 존재해야 함
  → UNIQUE 검증: (target_guid, reviewer_guid, tx_id) 중복 시 409
  → body → /interpret → body_translated (한국어) 생성
  → profile_reviews INSERT (reviewer_lang 자동 주입)
```

### 8.4 국적별 필터 UI 규칙
```
평점 요약 카드:
  viewer_lang 일치 항목 → 상단 크게 표시
  전체 평점 → 하단 작게 병기

편향 감지:
  |viewer_lang_avg - overall_avg| ≥ 1.0
  → "국적별 평점에 차이가 있습니다. 다양한 시각을 함께 참고해 주세요." 표시
```

### 8.5 의존 모듈
- M01 (JWT 검증, reviewer_lang 추출)
- M03 (tx_id 유효성 — biz_orders 조회)

### 8.6 테스트 항목

| ID | 시나리오 | 입력 | 기대 결과 |
|----|---------|------|---------|
| RV01 | 정상 리뷰 작성 | 유효 tx_id + rating | profile_reviews INSERT |
| RV02 | 미구매자 리뷰 시도 | 없는 tx_id | 403 NO_VALID_PURCHASE |
| RV03 | 중복 리뷰 | 동일 (target, reviewer, tx) | 409 ALREADY_REVIEWED |
| RV04 | reviewer_lang 자동 주입 | JWT.lang=zh | reviewer_lang='zh' 저장 |
| RV05 | 번역본 자동 생성 | 중국어 리뷰 작성 | body_translated 한국어 저장 |
| RV06 | 국적별 평점 집계 | zh 리뷰 5건 | profile_review_stats zh 행 정확 |
| RV07 | viewer_highlight | viewer_lang=zh | zh 항목 별도 추출 |
| RV08 | 편향 감지 문구 | zh_avg=5.0, overall_avg=3.0 | 편향 안내 문구 표시 |

---

## 9. M07 — 위치 모듈 (Location)

### 9.1 책임
- 반경 내 엔티티 검색 (/nearby)
- 소비자/사업자 위치 기록 (/location, consent 필수)
- 경로 안내 중계 (/directions)
- 영업시간 기반 is_open 판단
- 길찾기 딥링크 생성 (iOS/Android 분기)

### 9.2 인터페이스

| 방향 | 엔드포인트 | 입력 | 출력 |
|------|-----------|------|------|
| Worker IN | `GET /nearby` | lat, lng, radius, type, lang | 엔티티 배열 + is_open |
| Worker IN | `POST /location` | guid, lat, lng, accuracy, consent | ok |
| Worker IN | `GET /directions` | from_lat, from_lng, to_handle, mode | distance_m, duration_sec \| fallback |
| Frontend | search.html 지도탭 | — | Kakao Maps + 마커 |
| Frontend | profile.html 정보탭 | — | 위치 카드 |

### 9.3 /nearby 쿼리 규칙
```
변수명 충돌 방지 (BUG-C3):
  파라미터: userLat, userLng (컬럼명 lat, lng과 구분)
  반경 변환: R = radius / 111320 (미터 → 위도도)
  Supabase 쿼리: lat BETWEEN userLat-R AND userLat+R

is_open 판단:
  org → extra.business_hours 파싱 ("11:00–20:00")
  institution → extra.public_hours 폴백
  KST(UTC+9) 기준 현재 시각 비교
  파싱 실패 → is_open = null
```

### 9.4 /location 저장 규칙
```
consent=false 또는 미전달 → INSERT 거부, 400 반환
저장 컬럼: guid, lat, lng, accuracy, consent=true, recorded_at
JWT 검증 필수 — 익명 위치 기록 금지
```

### 9.5 /directions 분기
```
KAKAO_MOBILITY_KEY 등록됨:
  → Kakao Mobility Directions API 호출
  → { distance_m, duration_sec, steps[] } 반환

KAKAO_MOBILITY_KEY 미등록:
  → { fallback: true, lat: toLat, lng: toLng } 반환
  → 클라이언트에서 kakaomap:// 딥링크 직접 생성
```

### 9.6 길찾기 딥링크 폴백 패턴 (BUG-C4)
```
visibilitychange 이벤트로 앱 전환 감지
appOpened = false 초기값
document.hidden 시 appOpened = true
1500ms 후: appOpened=false 이면 폴백 URL 실행
```

### 9.7 의존 모듈
- M01 (JWT 검증 — /location)

### 9.8 테스트 항목

| ID | 시나리오 | 입력 | 기대 결과 |
|----|---------|------|---------|
| L01 | 반경 내 엔티티 | lat=33.39, radius=500 | 500m 이내 엔티티 목록 |
| L02 | 전체 테이블 반환 방지 | 쿼리 파라미터 userLat 사용 | BETWEEN 조건 정상 동작 |
| L03 | is_open 판단 영업 중 | business_hours='10:00-20:00', 현재 14:00 | is_open=true |
| L04 | is_open 판단 영업 외 | business_hours='10:00-20:00', 현재 22:00 | is_open=false |
| L05 | is_open 정보 없음 | institution, public_hours 없음 | is_open=null |
| L06 | consent 없이 위치 기록 | consent=false | 400 CONSENT_REQUIRED |
| L07 | consent 정상 기록 | consent=true | location_log INSERT |
| L08 | 길찾기 폴백 | KAKAO_MOBILITY_KEY 없음 | fallback:true + lat/lng |
| L09 | lang 번역 | lang=zh | name/address 중국어 번역 |

---

## 10. M08 — 히트맵 모듈 (Heatmap)

### 10.1 책임
- 국적별 관광객 밀집도 격자 집계
- k-익명성 보장 (count < 5 미표시)
- search.html 히트맵 탭 데이터 제공

### 10.2 인터페이스

| 방향 | 엔드포인트 | 입력 | 출력 |
|------|-----------|------|------|
| Worker IN | `GET /heatmap` | lang, period, zoom | cells 배열 |
| Supabase RPC | `heatmap_by_lang(p_lang, p_days)` | — | grid_lat, grid_lng, visit_count |
| Frontend | search.html 히트맵탭 | 국적 칩 + 기간 슬라이더 | Kakao Maps 오버레이 |

### 10.3 프라이버시 규칙
```
집계 단위: 위도·경도 소수점 2자리 반올림 (약 1km²)
k-익명성: count < 5인 격자 → HAVING 절로 제외
consent 필터: location_log.consent = true 만
캐시: Cloudflare max-age=300 (5분)
고지 문구: 모든 히트맵 표시 시 "집계 통계 데이터" 안내 필수
```

### 10.4 색상 농도 매핑
```
count  1~10  : teal 50  (#E1F5EE)
count 11~30  : teal 100 (#9FE1CB)
count 31~100 : teal 200 (#5DCAA5)
count 101~300: teal 400 (#1D9E75)
count 300+   : teal 600 (#0F6E56)
```

### 10.5 활성화 조건
```
v1.0: 탭 표시, 데이터 없으면 "참여자가 더 늘면 표시됩니다" 안내
v1.1: 사용자 1,000명+ 이후 자동 활성화
```

### 10.6 의존 모듈
- M07 (location_log 데이터 소스)

### 10.7 테스트 항목

| ID | 시나리오 | 입력 | 기대 결과 |
|----|---------|------|---------|
| H01 | 정상 집계 | lang=zh, period=7 | 격자별 count 배열 |
| H02 | k-익명성 필터 | count=3인 격자 | 결과 배열에서 제외 |
| H03 | consent=false 제외 | 비동의 레코드 | 집계 제외 |
| H04 | lang=all | 전체 언어 | 모든 native_lang 포함 |
| H05 | 빈 데이터 | 신규 파일럿 초기 | 빈 cells 배열 + 안내 문구 |
| H06 | Cloudflare 캐시 | 동일 요청 2회 | 2번째 캐시 HIT |
| H07 | period 경계 | period=1, 25시간 전 레코드 | 집계 제외 |

---

## 11. M09 — 커뮤니티 모듈 (Community)

### 11.1 책임
- 언어별 여행자 게시판 CRUD
- 긴급 카테고리 Realtime 알림
- 댓글 자동 번역 (이중 언어 커뮤니케이션)
- 한국인 봉사자 GDC ₮500 인센티브
- K-Security 연동 콘텐츠 스코어링

### 11.2 인터페이스

| 방향 | 엔드포인트 | 입력 | 출력 |
|------|-----------|------|------|
| Worker IN | `GET /community` | lang, category, limit, offset, near_lat, near_lng | posts 배열 |
| Worker IN | `POST /community` | lang, category, title, body, lat?, lng? | post_id |
| Worker IN | `GET /community/:id` | id | post + replies |
| Worker IN | `POST /community/:id/reply` | body | reply_id |
| Worker IN | `POST /community/:id/resolve` | — | ok, is_resolved=true |
| Frontend | community.html | — | 게시판 UI |
| Supabase RT | community:{lang}:emergency | — | 실시간 알림 |

### 11.3 게시물 작성 흐름
```
POST /community 수신
  → JWT 검증 (M01) → author_guid, lang 추출
  → K-Security 스코어링 (M13):
      anomaly_score ≥ 0.6 → security_event INSERT
      is_visible=false로 대기 상태 저장
  → body → /interpret → body_translated (한국어) 생성
  → community_posts INSERT
  → emergency 카테고리:
      Supabase Realtime 브로드캐스트
      채널: community:{lang}:emergency
      반경 10km 사용자 대상
```

### 11.4 댓글 작성 흐름
```
POST /community/:id/reply 수신
  → JWT 검증 → author_guid, author_lang 추출
  → 게시물 lang 조회 (post.lang)
  → body → /interpret(author_lang → post.lang) → body_translated
    (한국인 댓글 → 중국어로 번역하여 중국어 게시물에 표시)
  → community_replies INSERT
  → community_posts.reply_count += 1
  → 게시물 작성자에게 Realtime 알림
```

### 11.5 봉사자 인센티브 흐름
```
POST /community/:id/resolve 수신
  → 작성자 본인 확인 (JWT.guid = post.author_guid)
  → is_resolved=true UPDATE
  → 마지막 is_helpful=true 댓글 작성자 조회
  → M10 위임: fs_ledger INSERT (credit ₮500, source='manual')
  → user_profiles.extra.fs UPDATE
```

### 11.6 카테고리별 활성화 시점
```
v1.0 오픈: help, emergency, lost_found
v1.1 오픈: info, general (사용자 100명+)
v1.5 오픈: companion (사용자 500명+)
```

### 11.7 의존 모듈
- M01 (JWT 검증)
- M10 (봉사자 GDC 지급)
- M13 (K-Security 스코어링)

### 11.8 테스트 항목

| ID | 시나리오 | 입력 | 기대 결과 |
|----|---------|------|---------|
| C01 | 게시물 작성 | lang=zh, category=help | community_posts INSERT |
| C02 | 번역본 자동 생성 | 중국어 body | body_translated 한국어 저장 |
| C03 | 긴급 Realtime | category=emergency | Supabase Realtime 브로드캐스트 |
| C04 | 한국어 댓글 → 중국어 번역 | zh 게시물에 ko 댓글 | body_translated zh 저장 |
| C05 | 해결 완료 | 작성자가 /resolve | is_resolved=true |
| C06 | 타인 해결 시도 | 비작성자 /resolve | 403 FORBIDDEN |
| C07 | 봉사자 GDC 지급 | is_helpful=true → resolve | fs_ledger ₮500 credit |
| C08 | K-Security 필터 | 스팸 내용 | anomaly_score ≥ 0.6 → 대기 |
| C09 | 반경 근접 정렬 | near_lat, near_lng | 가까운 게시물 상단 |
| C10 | 미인증 쓰기 시도 | 토큰 없음 POST | 401 Unauthorized |
| C11 | 읽기는 비인증 허용 | 토큰 없음 GET | 게시물 목록 정상 반환 |

---

## 12. M10 — GDC 결제 원장 모듈 (Ledger)

### 12.1 책임
- fs_ledger 3행 원자 INSERT (market_purchase RPC)
- l1_ledger 기록 (L1 블록 미러)
- gdc_settle_ledger() — user_profiles.extra.fs 갱신
- 잔액 재구성 (reconstruct_balances)
- 이중 기입 원칙 준수 (BIVM Σδ=0)

### 12.2 계정 과목 규칙
```
bs-cash    = Σcredit - Σdebit (순변동분, 절대잔액 아님)
pl-purchase = Σdebit  (양수 누적, cur + amount)
pl-revenue  = Σcredit (양수 누적)

fs_ledger 1건 거래 = 3행:
  행1: buyer  debit  bs-cash + pl-purchase
  행2: seller credit bs-cash + pl-revenue
  행3: platform credit bs-cash + pl-revenue (수수료)

Σdebit = Σcredit per block_hash (BIVM §4.2.1)
```

### 12.3 인터페이스

| 방향 | 함수 / 엔드포인트 | 입력 | 출력 |
|------|----------------|------|------|
| 내부 함수 | `market_purchase(RPC)` | tx 파라미터 | fs_ledger 3행 |
| 내부 함수 | `gdc_settle_ledger()` | guid | extra.fs 갱신 |
| 내부 함수 | `reconstruct_balances(guid)` | guid | bs-cash, pl-purchase, pl-revenue |
| Supabase View | `ktax_balance_anomalies` | — | 잔액 불일치 탐지 |
| Supabase View | `sigma_delta_by_node` | — | Σδ=0 검증 |

### 12.4 의존 모듈
- 없음 (L3 도메인 계층 — L2 이하만 의존)

### 12.5 테스트 항목 (T07~T08 기반)

| ID | 시나리오 | 입력 | 기대 결과 |
|----|---------|------|---------|
| LD01 | fs_ledger 3행 원자성 | 정상 결제 | 3행 동시 INSERT |
| LD02 | pl-purchase 양수 누적 | 3회 결제 | pl-purchase 항상 양수 |
| LD03 | bs-cash 순변동분 | 결제 후 | bs-cash = Σcredit - Σdebit |
| LD04 | BIVM Σδ=0 | 결제 후 | sigma_delta_by_node count=0 |
| LD05 | 잔액 불일치 탐지 | extra.fs 불일치 | ktax_balance_anomalies count>0 |
| LD06 | source 제약 | source='kmarket' | 23514 CHECK_VIOLATION |
| LD07 | amount > 0 제약 | amount=0 | CHECK_VIOLATION |
| LD08 | gdc_settle_ledger 공식 | 집계 후 | extra.fs = reconstruct 결과 일치 |

---

## 13. M11 — PDV Hash Chain 모듈 (Audit)

### 13.1 책임
- pdv_log INSERT (resolution=ignore-duplicates 필수)
- 머클 트리 앵커링 (10분 Cron)
- P1~P6 감사 View 관리
- /merkle/verify 무결성 검증

### 13.2 감사 원칙 (P1~P6)
```
P1: 모든 l1_ledger 거래에 pdv_log 존재
P2: pdv_log chain_height 연속성 (gap ≠ 1 탐지)
P3: l1_ledger user_hash 미교정 건 없음
P4: pdv_log.chain_local_hash = l1_ledger.user_hash
P5: fs_ledger Σδ=0 위반 없음
P6: user_profiles.extra.fs 잔액 불일치 없음

합격 기준: 모든 View의 fail_count = 0
```

### 13.3 인터페이스

| 방향 | 엔드포인트 / 함수 | 입력 | 출력 |
|------|----------------|------|------|
| Worker IN | `GET /merkle/verify` | pdv_id | valid: bool, merkle_root |
| Cron | `anchorL1MerkleRoot()` | — | merkle_anchors INSERT |
| Supabase View | `p1_tx_has_pdv` ~ `p6_balance_anomalies` | — | fail_count |

### 13.4 pdv_log INSERT 규칙
```
Prefer 헤더: resolution=ignore-duplicates 필수
session_id UNIQUE 인덱스로 중복 자동 방지 (T09)
via_worker 조건 없이 전체 미앵커링 대상 집계
```

### 13.5 의존 모듈
- M10 (Ledger — P5, P6 View 공유)

### 13.6 테스트 항목 (T09~T10 기반)

| ID | 시나리오 | 입력 | 기대 결과 |
|----|---------|------|---------|
| AU01 | 중복 pdv_log INSERT | 동일 session_id 2회 | 1건만 저장 (ignore-duplicates) |
| AU02 | P1~P6 전체 통과 | 정상 거래 후 | 모든 View fail_count=0 |
| AU03 | 머클 앵커링 | Cron 실행 | merkle_anchors INSERT, status=confirmed |
| AU04 | 머클 검증 | GET /merkle/verify?pdv_id=xxx | valid=true, root 일치 |
| AU05 | chain_height 연속성 | 순차 거래 3건 | P2 View count=0 |
| AU06 | user_hash 교정 | _patchL1LedgerUserHash | P3, P4 View count=0 |

---

## 14. M12 — 검색 모듈 (Search)

### 14.1 책임
- 다국어 키워드 검색 (자국어 → 한국어 변환 → search_entities)
- 음성 검색 (STT → 텍스트 → 검색)
- 엔티티 타입 필터 (org / institution / 관광지)

### 14.2 인터페이스

| 방향 | 엔드포인트 | 입력 | 출력 |
|------|-----------|------|------|
| Worker IN | `GET /search` | q, lang, type, limit | 엔티티 배열 |
| Frontend | search.html 검색탭 | 텍스트 또는 STT | 검색 결과 목록 |

### 14.3 다국어 검색 흐름
```
GET /search?q=黑猪&lang=zh&type=org
  → /interpret(q, 'zh' → 'ko') → "흑돼지"
  → search_entities(p_keyword='흑돼지', p_type='org')
  → 결과 각 엔티티 name/address → /interpret('ko' → 'zh')
  → 다국어 결과 반환
```

### 14.4 의존 모듈
- M07 (위치 기반 정렬 — 선택적)

### 14.5 테스트 항목

| ID | 시나리오 | 입력 | 기대 결과 |
|----|---------|------|---------|
| SR01 | 한국어 검색 | q=흑돼지, lang=ko | 관련 업체 목록 |
| SR02 | 중국어 검색 | q=黑猪, lang=zh | 번역 후 동일 결과 |
| SR03 | 결과 다국어 표시 | lang=zh | name/address 중국어 |
| SR04 | 빈 결과 | q=없는단어 | 빈 배열 (오류 아님) |
| SR05 | 타입 필터 | type=institution | 기관만 반환 |

---

## 15. M13 — 보안 모듈 (Security)

### 15.1 책임
- 서비스 상태 모니터링 (security_log)
- 이상 콘텐츠 스코어링 (DeepSeek V3 → Claude Opus)
- 보안 이벤트 분류 (S1/S2/S3)
- K-Security 두 단계 LLM 파이프라인

### 15.2 스코어링 파이프라인
```
콘텐츠 수신 (community 게시물, 리뷰 등)
  → 1단계: DeepSeek V3 anomaly_score (0~1)
  → score < 0.6: 정상 처리
  → score ≥ 0.6: 2단계 Claude Opus 정밀 분석
  → 분류: S1(정보) / S2(경고) / S3(차단)
  → security_event INSERT
  → S3: is_visible=false 자동 처리
```

### 15.3 인터페이스

| 방향 | 함수 | 입력 | 출력 |
|------|------|------|------|
| 내부 함수 | `scoreContent(text)` | 텍스트 | anomaly_score, severity |
| Supabase View | `security_open_events` | — | 미해결 이벤트 |
| Supabase View | `security_status` | — | 서비스별 최신 상태 |

### 15.4 의존 모듈
- 없음 (L2 인프라 계층)

### 15.5 테스트 항목

| ID | 시나리오 | 입력 | 기대 결과 |
|----|---------|------|---------|
| SC01 | 정상 콘텐츠 | 일반 게시물 | score < 0.6, 정상 처리 |
| SC02 | 스팸 감지 | 반복 광고 텍스트 | score ≥ 0.6 → S2 이벤트 |
| SC03 | 혐오 차단 | 혐오 발언 | score ≥ 0.6 → S3, is_visible=false |
| SC04 | 2단계 파이프라인 | score 0.6~0.8 경계 | Claude Opus 정밀 분석 실행 |

---

## 16. M14 — 대량 등록 모듈 (Bulk Register)

### 16.1 책임
- CSV 기반 10만 건 일괄 등록
- 100건 배치 / 10 스레드 병렬 처리
- ON CONFLICT (guid) 충돌 처리
- QR PDF 일괄 생성

### 16.2 인터페이스

| 방향 | 도구 | 입력 | 출력 |
|------|------|------|------|
| 로컬 실행 | `bulk_register.py` | CSV 파일 | Supabase INSERT 결과 |
| 로컬 실행 | `qr_pdf_generator.py` | handle 목록 | PDF 파일 |

### 16.3 ON CONFLICT 규칙
```
ON CONFLICT (guid) DO UPDATE SET
  name = EXCLUDED.name,
  updated_at = now()

handle 충돌 (UNIQUE):
  suffix 4자리 순번 재시도
  @{region_en}_{name_roman}_{0001}
```

### 16.4 테스트 항목

| ID | 시나리오 | 입력 | 기대 결과 |
|----|---------|------|---------|
| BK01 | 정상 100건 배치 | 100행 CSV | 100건 INSERT |
| BK02 | GUID 충돌 재등록 | 기존 GUID 포함 | ON CONFLICT UPDATE |
| BK03 | handle 충돌 suffix | 동명이인 같은 지역 | suffix 자동 부여 |
| BK04 | 전화번호 유효성 | 빈 전화번호 행 | 해당 행 스킵 + 로그 |
| BK05 | 10만 건 속도 | 100,000행 CSV | 30분 이내 완료 |
| BK06 | QR PDF 생성 | handle 100개 | 100페이지 PDF |

---

## 17. 공유 인프라 (Shared Infrastructure)

### 17.1 Worker 라우터
- 모든 Worker 엔드포인트 진입점
- CORS 헤더 전역 적용
- 인증 필요 엔드포인트 자동 JWT 검증 (M01 위임)
- 오류 응답 형식 통일: `{ error: 'CODE', message: '...' }`

### 17.2 Supabase Client
- 모든 모듈이 공유하는 Supabase JS 클라이언트
- `SUPABASE_KEY` (anon) / `SUPABASE_SERVICE_KEY` (service role) 분리 사용
- service role: 관리자 전용 작업, RPC 호출
- anon key: 일반 CRUD (RLS 적용)

### 17.3 Translate Helper
- `/interpret` 엔드포인트의 내부 구현체
- DeepSeek V3 기본, 실패 시 ANTHROPIC_API_KEY 폴백
- 결과 캐시: Cloudflare KV (추후 V2-03)
- 입력: { text, from_lang, to_lang }
- 출력: { translated, model_used }

### 17.4 JWT Library
- HMAC-SHA256 서명/검증 (Web Crypto API)
- `GOPANG_MASTER_KEY` 환경변수 필수
- payload 구조: `{ guid, name, lang, type, iat, exp }`

### 17.5 환경변수 관리
```
필수 (미등록 시 500 반환):
  GOPANG_MASTER_KEY, SUPABASE_KEY, SUPABASE_SERVICE_KEY,
  AES_ENCRYPTION_KEY, DEEPSEEK_API_KEY

선택 (기능 제한):
  ANTHROPIC_API_KEY  — AI 폴백 없음
  KAKAO_REST_KEY     — 위치 기능 없음
  KAKAO_MOBILITY_KEY — Directions fallback 모드
  OPENAI_API_KEY     — OpenAI 제공자 선택 불가

Worker 시작 시 필수 환경변수 존재 여부 체크 → 누락 시 명시적 오류 로그
```

---

## 18. 모듈 간 의존성 매트릭스

의존 방향: 행(M) → 열(M) 호출

|       | M01 | M03 | M04 | M05 | M06 | M07 | M08 | M09 | M10 | M11 | M12 | M13 |
|-------|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|
| **M02** Register | ✓   |     |     | ○   |     |     |     |     |     |     |     |     |
| **M03** Payment  | ✓   |     |     |     |     |     |     |     | ✓   | ✓   |     |     |
| **M04** Profile  | ○   |     |     |     | ✓   | ○   |     |     |     |     |     |     |
| **M05** AI       | ✓   |     |     |     |     | ○   |     |     |     |     |     |     |
| **M06** Review   | ✓   | ✓   |     |     |     |     |     |     |     |     |     |     |
| **M07** Location | ✓   |     |     |     |     |     |     |     |     |     |     |     |
| **M08** Heatmap  |     |     |     |     |     | ✓   |     |     |     |     |     |     |
| **M09** Community| ✓   |     |     |     |     |     |     |     | ✓   |     |     | ✓   |
| **M10** Ledger   |     |     |     |     |     |     |     |     |     |     |     |     |
| **M11** Audit    |     |     |     |     |     |     |     |     | ✓   |     |     |     |
| **M12** Search   |     |     |     |     |     | ○   |     |     |     |     |     |     |

✓ 필수 의존  ○ 선택적 의존  빈칸 의존 없음

---

## 19. 통합 테스트 시나리오

전체 시스템을 관통하는 E2E 시나리오입니다. 각 시나리오는 여러 모듈을 순서대로 통과합니다.

### IT01 — 외국인 관광객 첫 방문 결제
```
흐름: M02(등록) → M01(JWT) → M03(pay.html 복귀) → M03(결제)
      → M10(Ledger) → M11(PDV)

검증 항목:
  1. 등록 완료 후 JWT 발급 확인
  2. pending_pay_url 복귀 정확
  3. QR 만료 시간 서버 검증
  4. fs_ledger 3행 정합성
  5. ktax_balance_anomalies count=0
  6. pdv_log 중복 없음
```

### IT02 — AI 비서 통역 → 에스컬레이션 → 채팅
```
흐름: M05(ai-chat) × 3 fail → M05(escalate) → M09(chat.html)

검증 항목:
  1. 3회 실패 카운터 ai_sessions.messages 정확
  2. mode = escalated Realtime 브로드캐스트
  3. 30초 무응답 → "연결 어렵습니다" 자동 안내
```

### IT03 — 다국어 리뷰 → 국적별 필터 표시
```
흐름: M06(review POST) → M04(profile.html) → M06(review_summary)

검증 항목:
  1. reviewer_lang 자동 주입 정확
  2. body_translated 한국어 생성
  3. profile_review_stats View 집계 정확
  4. viewer_highlight 국적 일치
  5. 편향 감지 문구 조건 (격차 ≥ 1.0)
```

### IT04 — 커뮤니티 긴급 → 봉사자 답변 → GDC 지급
```
흐름: M09(POST emergency) → Realtime → M09(reply)
      → M09(resolve) → M10(GDC ₮500)

검증 항목:
  1. emergency Realtime 브로드캐스트 수신
  2. 한국어 댓글 → 중국어 자동 번역
  3. resolve 권한 (작성자 본인만)
  4. fs_ledger ₮500 credit 정확
```

### IT05 — P1~P6 감사 전체 통과
```
흐름: IT01 실행 후 → M11(P1~P6 View 조회)

검증 항목:
  모든 View fail_count = 0
  merkle_anchors status = confirmed
  /merkle/verify → valid: true
```

---

## 20. 구현 순서 로드맵

모듈 간 의존성 기반 최적 구현 순서입니다.

### Phase 0 — 인프라 준비 (구현 전 필수)
```
[ ] Cloudflare Worker 환경변수 9개 전체 등록 (§2.1)
[ ] Supabase 신규 테이블 생성:
    ai_sessions, messages, user_llm_keys
    profile_reviews (reviewer_lang 포함)
    community_posts, community_replies
[ ] location_log.consent 컬럼 추가
[ ] user_profiles lat/lng/geo_updated_at 컬럼 추가
[ ] profile_review_stats View 생성
[ ] heatmap_by_lang() RPC 생성
[ ] P1~P6 감사 View 확인 (T10 기준 이미 존재)
```

### Phase 1 — 인증·등록 (Sprint 1)
```
[ ] M01 Auth — JWT 발급·검증·갱신
[ ] M02 Register — 소비자 등록, handle 생성, QR SVG
```

### Phase 2 — 결제·원장 (Sprint 2)
```
[ ] M10 Ledger — fs_ledger RPC, settle
[ ] M03 Payment — /biz/order, pay.html, 만료 검증
[ ] M11 Audit — pdv_log, merkle Cron, P1~P6 확인
```

### Phase 3 — 프로필·AI·리뷰 (Sprint 3)
```
[ ] M04 Profile — /biz/profile, 다국어 번역
[ ] M05 AI — /ai-chat, /ai-setup, 에스컬레이션
[ ] M06 Review — /review, reviewer_lang, 국적별 집계
```

### Phase 4 — 위치·검색 (Sprint 4)
```
[ ] M07 Location — /nearby, /location, /directions
[ ] M12 Search — /search, 다국어 키워드
```

### Phase 5 — 히트맵·커뮤니티·보안 (Sprint 5)
```
[ ] M13 Security — K-Security 스코어링
[ ] M08 Heatmap — /heatmap, k-익명성
[ ] M09 Community — /community, Realtime, 봉사자 GDC
```

### Phase 6 — 대량 등록 (Sprint 6)
```
[ ] M14 Bulk Register — bulk_register.py, QR PDF
```

### 각 Sprint 완료 기준
```
기능 구현 완료
모듈별 테스트 항목 전체 통과
통합 테스트 시나리오 해당 부분 통과
ktax_balance_anomalies count=0 유지
P1~P6 View fail_count=0 유지
```

---

*고팡 제주 모듈 설계도 v1.0*  
*AI City Inc. 팀 주피터 | 2026-06-12*  
*기반: gopang_jeju_design_v1.3.md*  
*모듈 14개 · 테스트 항목 95개 · 통합 시나리오 5개*
