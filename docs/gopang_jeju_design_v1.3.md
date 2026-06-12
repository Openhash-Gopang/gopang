# 고팡 제주 시스템 설계도 v1.3
**작성일**: 2026-06-12  
**작성자**: AI City Inc. 팀 주피터  
**상태**: v1.3 확정  
**대상 지역**: 제주특별자치도 (파일럿: 한림읍)  
**대상 엔티티**: 10만 명/기관 (개인 + 사업자 + 기관)

### 변경 이력
| 버전 | 날짜 | 주요 변경 |
|------|------|-----------|
| v1.0 | 2026-06-12 | 최초 작성 |
| v1.1 | 2026-06-12 | §9 GPS 위치 안내 시스템 추가 |
| v1.2 | 2026-06-12 | 사고 실험 버그 18건 수정 (BUG-C1~C5, H1~H7, M1~M6) |
| v1.3 | 2026-06-12 | §10 국적별 히트맵, §11 국적별 리뷰 필터, §12 자국민 커뮤니티 추가 |

---

## 목차
1. [시스템 개요](#1-시스템-개요)
2. [아키텍처](#2-아키텍처)
3. [데이터 모델](#3-데이터-모델)
4. [엔티티 등록 시스템](#4-엔티티-등록-시스템)
5. [QR 코드 결제](#5-qr-코드-결제)
6. [프로필 시스템](#6-프로필-시스템)
7. [AI 비서 + 다국어 통역](#7-ai-비서--다국어-통역)
8. [리뷰 시스템](#8-리뷰-시스템)
9. [GPS 기반 위치 안내 시스템](#9-gps-기반-위치-안내-시스템)
10. [국적별 히트맵](#10-국적별-히트맵)
11. [국적별 리뷰 필터](#11-국적별-리뷰-필터)
12. [자국민 커뮤니티 게시판](#12-자국민-커뮤니티-게시판)
13. [대량 등록 자동화](#13-대량-등록-자동화)
14. [v1.0 예상 문제점](#14-v10-예상-문제점)
15. [v2.0 계획](#15-v20-계획)

---

## 1. 시스템 개요

### 목적
제주도 소재 10만 개 개인·사업자·기관을 디지털 경제 네트워크에 연결.  
스마트폰 QR 스캔만으로 프로필 접속 → AI 비서 상담 → 결제까지 완결.

### 핵심 원칙
```
최소 등록   — 전화번호 + 이름만으로 소비자 등록 완료
최소 결제   — QR 스캔 + 서명 1회 = 결제 완료
최대 호환   — 국내/외국 번호, 6개 언어, 앱 설치 불필요
단방향 복원 — 동일 전화번호 → 항상 동일 GUID
```

### 대상 엔티티 3종
| 유형 | entity_type | 예시 |
|------|-------------|------|
| 개인 | individual | 관광객, 주민 |
| 사업자 | org | 식당, 숙박, 상점 |
| 기관 | institution | 병원, 학교, 관공서 |

---

## 2. 아키텍처

### 전체 구성
```
┌─────────────────────────────────────────────────────────────┐
│                   users.gopang.net                           │
│  register-consumer.html  — 소비자 최소 등록                  │
│  register.html           — 사업자/기관 등록 (3-step)         │
│  profile.html            — 프로필 + 주문 + AI 비서 + 리뷰    │
│  pay.html                — 금액 지정 즉시 결제               │
│  ai-setup.html           — LLM 키 등록 + AI 비서 설정        │
│  chat.html               — 에스컬레이션 채팅                 │
│  search.html             — 엔티티 검색                       │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTPS
┌──────────────────────▼──────────────────────────────────────┐
│              Cloudflare Worker (gopang-proxy)                │
│  /register-consumer   /register      /qr/:handle            │
│  /biz/profile/:handle /biz/order     /review                │
│  /ai-chat             /interpret     /ai-setup              │
│  /escalate            /token-refresh /handle/check          │
│  /nearby              /location      /directions             │
│  /heatmap             /search                                │
│  /community           /community/:id /community/:id/reply    │
│  /community/:id/resolve                                      │
│  /merkle/verify                                              │
└──────────────────────┬──────────────────────────────────────┘
                       │
          ┌────────────┴────────────┐
          │                         │
┌─────────▼──────────┐   ┌─────────▼──────────┐
│     Supabase        │   │   L1 PocketBase     │
│  user_profiles      │   │  168.110.123.175    │
│  reviews            │   │  blocks             │
│  ai_sessions        │   │  gdc_keys           │
│  messages           │   │  transactions       │
│  user_llm_keys      │   │                     │
│  fs_ledger          │   └─────────────────────┘
│  l1_ledger          │
│  pdv_log            │
└─────────────────────┘
```

### 기술 스택
| 구성요소 | 기술 | 비고 |
|----------|------|------|
| Frontend | GitHub Pages | users.gopang.net |
| Proxy | Cloudflare Worker v4.9+ | gopang-proxy |
| DB | Supabase (PostgreSQL) | ebbecjfrwaswbdybbgiu |
| L1 Node | PocketBase 0.22.14 | 한림읍 노드 |
| 서명 | ED25519 | 브라우저 내 keypair |
| 해시 | SHA-256 | PDV Hash Chain v3.0 |
| 음성 | Web Speech API | STT + TTS |
| 실시간 | Supabase Realtime | messages 푸시 |

---

## 2.1 Worker 환경변수 [v1.2 BUG-C5]

| 변수명 | 필수 | 설명 |
|--------|------|------|
| GOPANG_MASTER_KEY | ✅ | JWT HMAC-SHA256 서명 키 |
| SUPABASE_KEY | ✅ | Supabase anon key |
| SUPABASE_SERVICE_KEY | ✅ | Supabase service role key |
| AES_ENCRYPTION_KEY | ✅ | LLM API 키 암호화 (32bytes hex) |
| DEEPSEEK_API_KEY | ✅ | 기본 번역/AI 제공자 |
| ANTHROPIC_API_KEY | ○ | AI 폴백 (없으면 DeepSeek 전용) |
| KAKAO_REST_KEY | ○ | 위치 기능 (없으면 비활성) |
| KAKAO_MOBILITY_KEY | ○ | 길찾기 API (없으면 fallback 모드) |
| OPENAI_API_KEY | ○ | OpenAI 제공자 선택 시 필요 |

✅ 필수 — 미등록 시 Worker 500 반환  ○ 선택

## 2.2 JWT 명세 [v1.2 BUG-M5]

```
알고리즘: HMAC-SHA256
만료: 24시간 (exp = iat + 86400)
갱신 허용 구간: exp - 3600 ~ exp (만료 1시간 전)
payload: { guid, name, lang, type, iat, exp }
검증: Web Crypto API (timingSafeEqual 타이밍 어택 방지)
```


---

## 3. 데이터 모델

### 3.1 고정 레이어 (user_profiles)
```sql
user_profiles:
  guid          TEXT PK        -- uuidv5(phone_digits, NS)
  entity_type   TEXT           -- individual | org | institution
  name          TEXT           -- 검색 인덱스 대상
  address       TEXT           -- 검색 인덱스 대상
  handle        TEXT UNIQUE    -- @hallim_geumneung (QR URL)
  native_lang   TEXT           -- ko | zh | en | ja | vi | th
  is_public     BOOLEAN        -- 검색 노출 여부
  public_key    TEXT           -- ED25519 (결제 서명 검증)
  extra         JSONB          -- entity_type별 유동 데이터
  created_at    TIMESTAMPTZ
  updated_at    TIMESTAMPTZ
```

### 3.2 유동 레이어 (extra JSONB) — entity_type별 JSON Schema

**individual**
```json
{
  "phone":       "+82-10-1234-5678",
  "gender":      "M | F",
  "birthday":    "1985-03-15",
  "nationality": "KR | CN | US ...",
  "consumer":    true,
  "verified_at": "2026-06-12T..."
}
```

**org (사업자)**
```json
{
  "phone":          "064-796-0003",
  "biz_reg_no":     "123-45-67890",
  "ceo_name":       "김제주",
  "ksic_code":      "56111",
  "business_hours": "11:00–20:00",
  "closed_days":    "매주 화요일",
  "gdc_accepted":   true,
  "menu":           [{"id":"m001","name":"짜장면","price":7000}],
  "reservation":    false,
  "ai_active":      true,
  "fs": {
    "bs-cash":     0,
    "pl-purchase": 0,
    "pl-revenue":  0
  }
}
```

**institution (기관)**
```json
{
  "phone":        "064-000-0000",
  "org_type":     "hospital | school | government | ngo",
  "parent_org":   "제주특별자치도",
  "departments":  ["내과","외과"],
  "services":     ["진료","예약"],
  "public_hours": "09:00–18:00",
  "jurisdiction": "한림읍",
  "ai_active":    true
}
```

### 3.3 신규 테이블

**profile_reviews** [v1.2 BUG-H1: 기존 reviews 테이블과 충돌 방지]
```sql
CREATE TABLE profile_reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_guid   TEXT NOT NULL REFERENCES user_profiles(guid),
  reviewer_guid TEXT NOT NULL REFERENCES user_profiles(guid),
  tx_id         TEXT NOT NULL REFERENCES biz_orders(tx_id),
  rating        INTEGER CHECK (rating BETWEEN 1 AND 5),
  body          TEXT,
  body_translated TEXT,
  reviewer_lang TEXT DEFAULT 'ko',
  is_visible    BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(target_guid, reviewer_guid, tx_id)
);
```

**user_llm_keys**
```
guid(FK), provider, api_key_enc(AES-256-GCM),
model, custom_prompt, ai_active,
native_lang, escalate_to
```

**ai_sessions**
```
id, caller_guid, caller_lang,
target_guid, target_lang,
mode(ai|human|escalated), session_type,
messages(JSONB), is_active, escalated_at
```

**messages**
```
id, session_id(FK), sender_guid, receiver_guid,
content_original, content_translated,
lang_from, lang_to, content_type,
voice_url, is_read, created_at
```

---

## 4. 엔티티 등록 시스템

### 4.1 소비자 최소 등록 (register-consumer.html)
```
입력: 전화번호 + 이름 (2개 필드만)
언어: navigator.language 자동 감지
GUID: uuidv5(phone.replace(/\D/g,''), GOPANG_NS)

지원 언어 UI:
  ko: 고팡 시작하기
  zh: 开始使用高팡
  en: Get Started
  ja: ご利用開始
  vi: Bắt đầu

완료: gopang_token(JWT) 발급 → localStorage
      return_to URL로 자동 복귀

[v1.2 BUG-C1] uuidv5 CDN import:
  <script type="module">
    import { v5 as uuidv5 } from 'https://esm.sh/uuid@9';
    const GOPANG_NS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    const guid = uuidv5(phone.replace(/\D/g,''), GOPANG_NS);
  </script>
```

### 4.2 사업자/기관 등록 (register.html 3-step)
```
Step 0: 유형 선택 [개인 | 사업자 | 기관]

Step 1: 기본 정보
  공통: 이름, 전화번호, 주소(읍면동)
  org: + 업종(KSIC), 사업자번호, 대표자명, 영업시간
  institution: + 기관유형, 상위기관, 부서

Step 2: 핸들 + AI 비서
  핸들 자동 생성: @{읍면동}_{이름_로마자}
  중복 시: @{읍면동}_{이름_로마자}_{4자리}
  AI 비서: ON/OFF 선택
  ON 시: LLM 제공자, API 키, 모델, 소개글

Step 3: 확인 + QR 발급
  입력 요약 표시
  [등록 완료] → QR 이미지 즉시 표시
  다운로드 + 인쇄 버튼
```

### 4.3 GUID 결정성
```
전화번호 원문: "+86-138-0013-0000"
숫자 추출:     "8613800130000"
GUID:          uuidv5("8613800130000", GOPANG_NS)

효과:
  동일 번호 재등록 → 동일 GUID (거래 이력 연속)
  기기 변경 → 번호 재입력으로 복원
  서버에 번호 평문 저장 불필요
```

---

## 5. QR 코드 결제

### 5.1 QR URL 구조
```
단순 프로필 접속 (메뉴 선택 방식):
  https://users.gopang.net/profile.html?handle=@hallim_geumneung

금액 지정 즉시 결제 (계산대 방식):
  https://users.gopang.net/pay.html
    ?to=@hallim_geumneung
    &amount=22000
    &items=짜장면×2,짬뽕×1
    &expires=300
    &created_at=1749700000  [v1.2 BUG-C2/H4: 서버 측 만료 검증 기준]

pay.html → 미등록 소비자 처리 [v1.2 BUG-C2]:
  1. 토큰 없음 → register-consumer.html?return_to=<현재URL> 리다이렉트
  2. 등록 완료 후 pending_pay_url 복귀
  3. 복귀 시 잔여 expires 재계산 후 결제 진행
```

### 5.2 결제 단계 비교
```
Alipay (4단계): 앱실행 → QR스캔 → 확인 → 비밀번호
고팡 A  (2단계): QR스캔 → 서명버튼 1회
고팡 B  (2단계): QR스캔 → 서명버튼 1회
초방문  (3단계): QR스캔 → 번호+이름 입력 → 서명버튼
```

### 5.3 결제 파이프라인 (변경 없음)
```
서명버튼 클릭
  → gopangWallet.sign(tx)       브라우저 내 ED25519 서명
  → GWP_SIGN_REQUEST            gopang.net 전달
  → GWP_SIGN_RESPONSE           서명 완료
  → /biz/order POST             Worker → L1
  → GWP_DONE                    PDV 기록
  → fs_ledger + l1_ledger       잔액 동기화
```

### 5.4 pay.html 화면 구성
```
┌─────────────────────────────┐
│  🏪 금능반점                 │
│  ₮ 22,000                  │ (크게)
│  짜장면×2, 짬뽕×1           │
│  유효시간 04:32 ⏱           │
│  [서명하여 결제]             │ (버튼 1개)
│  취소                       │
└─────────────────────────────┘
```

### 5.5 Worker /qr/:handle
```
GET /qr/@hallim_geumneung
→ QR 이미지 SVG (300×300px) 즉시 반환  [v1.2 BUG-H3: Workers 환경 PNG 생성 불가]
→ 하단 업체명 + handle 텍스트 포함
→ Content-Type: image/svg+xml
→ 클라이언트에서 Canvas.toDataURL()로 PNG 변환 가능
→ Cloudflare 캐시 max-age=86400
```

---

## 6. 프로필 시스템

### 6.1 profile.html 탭 구성
```
[메뉴] [정보] [리뷰] [AI비서]
              ↑ ai_active=true 시만 표시
```

**ai_active 판정 기준** [v1.2 BUG-M2: 단일 소스로 통일]
```
1. user_llm_keys WHERE guid = profile.guid 조회
2. 레코드 없음 → ai_active = false
3. 레코드 있고 ai_active = false → false
4. 레코드 있고 ai_active = true → true
(extra.ai_active는 참조 불가 — user_llm_keys 단독 기준)
```

### 6.2 다국어 자동 전환
```
진입 시 navigator.language 감지
→ UI 전체 해당 언어로 렌더링
→ 업체 정보 실시간 번역 (Worker /interpret)
지원: ko | zh | en | ja | vi | th
```

### 6.3 리뷰 탭
```
표시: 별점 평균 + 건수
작성: 구매 완료 tx_id 있는 경우만 활성
다국어: 원문 + 번역문 함께 표시 (접기/펼치기)
```

---

## 7. AI 비서 + 다국어 통역

### 7.1 라우팅 로직
```
소비자 발화 (중국어)
  → STT (Web Speech API, zh-CN)
  → Worker /ai-chat
      → translate(zh→ko)
      → target.ai_active = true?
          YES: B의 LLM 키로 응답 생성
               주문 의도 탐지 → requestSign() 트리거
               응답 translate(ko→zh) → TTS(zh-CN)
          NO:  messages INSERT (번역문 포함)
               Supabase Realtime → B 기기 푸시
               B 답장 → translate(ko→zh) → TTS(zh-CN)
```

### 7.2 에스컬레이션 조건
```
AI 3회 연속 처리 실패  [v1.2 BUG-H5: 실패 카운터 저장 위치 명시]
  실패 카운터: ai_sessions.messages JSONB 배열에 {type:'fail', ts:...} 이벤트 기록
  10분 슬라이딩 윈도우 내 fail 이벤트 ≥ 3 → 에스컬레이션 트리거
또는 사용자 에스컬레이션 키워드 발화:
  ko: "사람 연결해줘" / zh: "转人工" / en: "human agent"
  ja: "人に繋いで" / vi: "kết nối nhân viên" / th: "ติดต่อเจ้าหน้าที่"
→ mode: 'escalated' UPDATE
→ B 기기 Realtime 알림 푸시 (채널: community:reply:{target_guid})
→ chat.html 전환 (사람 간 직접 채팅)
→ 30초 무응답 시 "현재 연결이 어렵습니다" 자동 안내
```

### 7.3 지원 언어
```
ko-KR 한국어, zh-CN 중국어, en-US 영어
ja-JP 일본어, vi-VN 베트남어, th-TH 태국어
```

### 7.4 음성 처리
```
STT: Web Speech API (브라우저 내장, 무료)
TTS: Web Speech Synthesis API (브라우저 내장, 무료)
번역: Worker 내 LLM 호출 (DeepSeek 기본)
      B의 LLM 키 없어도 번역은 항상 가능
```

### 7.5 ai-setup.html
```
AI 비서 ON/OFF
LLM 제공자 선택 (Anthropic | OpenAI | DeepSeek | 기타)
API 키 입력 (Worker에서 AES-256-GCM 암호화 저장)
모델 선택
비서 소개글 (손님에게 표시되는 문구)
에스컬레이션 설정
지원 언어 선택
```

---

## 8. 리뷰 시스템

### 8.1 작성 조건
```
해당 사업자/기관과의 거래 tx_id 필수
→ 구매하지 않은 사용자 리뷰 차단
→ 거래 1건 = 리뷰 1건 (UNIQUE 제약)
```

### 8.2 다국어 리뷰
```
작성: 소비자 모국어로 작성
저장: 원문(body) + 번역문(body_translated) + 언어코드(body_lang)
표시: 조회자 언어로 번역본 우선 표시, 원문 접기/펼치기
```

---

## 9. GPS 기반 위치 안내 시스템

### 9.1 개요
```
목적: QR 스캔 없이 현재 위치 기반으로 주변 엔티티를 탐색하고
      경로 안내 → 프로필 접속 → AI 비서 → 결제까지 연결
대상: 관광객(외국인), 신규 방문자, 도보/차량 이동 중 소비자
기술: Geolocation API + Kakao Maps SDK + Worker /nearby + location_log
```

### 9.2 아키텍처
```
┌─────────────────────────────────────────────┐
│           search.html / profile.html         │
│  Geolocation API → 현재 좌표 획득            │
│  Kakao Maps SDK → 지도 렌더링               │
│  마커 클릭 → profile.html?handle=...        │
└──────────────────┬──────────────────────────┘
                   │ HTTPS
┌──────────────────▼──────────────────────────┐
│         Cloudflare Worker                    │
│  GET /nearby  — 반경 내 엔티티 목록         │
│  POST /location — 위치 로그 기록            │
│  GET /directions — 경로 안내 (Kakao 중계)  │
└──────────┬───────────────────────┬──────────┘
           │                       │
┌──────────▼──────┐     ┌──────────▼──────────┐
│   Supabase       │     │   Kakao Maps API     │
│  user_profiles   │     │  좌표 → 주소 변환    │
│  location_log    │     │  경로 안내           │
│  (lat/lng 컬럼)  │     │  주변 POI 검색       │
└──────────────────┘     └─────────────────────┘
```

### 9.3 데이터 모델 확장

**user_profiles 좌표 컬럼 추가**
```sql
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS lat  NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS lng  NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS geo_updated_at TIMESTAMPTZ;

-- 반경 검색 인덱스
CREATE INDEX IF NOT EXISTS idx_user_profiles_geo
  ON user_profiles (lat, lng)
  WHERE lat IS NOT NULL AND lng IS NOT NULL AND is_public = true;
```

**location_log 확장 (기존 테이블 재활용)**
```
기존 컬럼: guid, lat, lng, accuracy, recorded_at
추가 용도: 엔티티 등록 시 사업장 좌표 기록
           소비자 동의 시 이동 경로 익명 통계
```

### 9.4 Worker 신규 엔드포인트

**GET /nearby**
```
쿼리: ?lat=33.3945&lng=126.2389&radius=500&type=org&lang=zh
처리:
  1. user_profiles WHERE is_public=true AND entity_type=type
     AND lat BETWEEN lat-Δ AND lat+Δ
     AND lng BETWEEN lng-Δ AND lng+Δ
  2. 하버사인 거리 계산 → radius 이내 필터
  3. 거리 오름차순 정렬
  4. lang 지정 시 name/address Worker /interpret 번역 (캐시 우선)
반환:
  [{ handle, name, address, distance_m, lat, lng,
     entity_type, native_lang, extra.business_hours,
     extra.ksic_code, ai_active }]
```

**POST /location**
```
바디: { guid, lat, lng, accuracy, consent: true }
처리: location_log INSERT (PDV 원칙 적용, 동의 여부 기록)
용도: 사업자 사업장 좌표 등록 / 소비자 익명 통계
```

**GET /directions**
```
쿼리: ?from_lat=...&from_lng=...&to_handle=@hallim_geumneung&mode=WALK
처리: user_profiles에서 to_handle 좌표 조회
      → Kakao Mobility API 경로 요청
      → Worker 중계 (KAKAO_REST_KEY 사용, 클라이언트 키 노출 방지)
반환: { distance_m, duration_sec, steps[] }
```

### 9.5 프론트엔드 연동

**search.html — 지도 탭 추가**
```
[목록] [지도]  ← 탭 전환
지도 탭:
  Kakao Maps 초기화
  getCurrentPosition() → /nearby 호출
  반환된 엔티티 마커 표시
    마커 색상: org=주황, institution=파랑, individual=회색
  마커 클릭 → 말풍선 (name + distance + [프로필 보기] 버튼)
  [현재 위치로] 버튼 — 지도 중심 재설정
```

**profile.html — 위치 정보 카드 추가**
```
[정보] 탭 내 위치 카드:
  ┌─────────────────────────────┐
  │  📍 한림읍 한림리 123        │
  │  현재 위치에서 230m          │
  │  [길찾기]  [지도에서 보기]   │
  └─────────────────────────────┘
[길찾기] → /directions → Kakao 지도 앱 딥링크
           (kakaomap://route?ep=...)
[지도에서 보기] → search.html?focus=@handle
```

**register.html Step 1 — 좌표 자동 수집**
```
사업자/기관 등록 시:
  [현재 위치를 사업장 위치로 등록] 버튼
  → getCurrentPosition()
  → /location POST (consent=true)
  → user_profiles lat/lng 갱신
  → 지도 미리보기 표시 (정확성 확인용)
```

### 9.6 다국어 위치 안내

**언어별 거리 표현**
```javascript
const DIST_LABEL = {
  ko: (m) => m < 1000 ? `${m}m` : `${(m/1000).toFixed(1)}km`,
  zh: (m) => m < 1000 ? `${m}米` : `${(m/1000).toFixed(1)}公里`,
  en: (m) => m < 1000 ? `${m}m` : `${(m/1000).toFixed(1)}km`,
  ja: (m) => m < 1000 ? `${m}m` : `${(m/1000).toFixed(1)}km`,
  vi: (m) => m < 1000 ? `${m}m` : `${(m/1000).toFixed(1)}km`,
  th: (m) => m < 1000 ? `${m}ม.` : `${(m/1000).toFixed(1)}กม.`,
};
```

**길찾기 딥링크 — 앱별 분기**
```javascript
function openDirections(toLat, toLng, toName) {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) {
    // iOS: Kakao맵 → Apple Maps 폴백
    window.location = `kakaomap://route?ep=${toLat},${toLng}&by=FOOT`;
    // visibilitychange 패턴으로 폴백 중복 실행 방지 [v1.2 BUG-C4]
    const timer = setTimeout(() => {
      window.location = `maps://maps.apple.com/?daddr=${toLat},${toLng}`;
    }, 1500);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) clearTimeout(timer);
    }, { once: true });
  } else {
    // Android/기타: Kakao맵 → Google Maps 폴백
    window.location = `kakaomap://route?ep=${toLat},${toLng}&by=FOOT`;
    const timer2 = setTimeout(() => {
      window.location = `https://maps.google.com/?daddr=${toLat},${toLng}`;
    }, 1500);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) clearTimeout(timer2);
    }, { once: true });
  }
}
```

### 9.7 AI 비서 위치 연동

**주문 의도 탐지 + 위치 안내 통합**
```
소비자 발화: "근처에 짜장면 먹을 데 있어?"
  → AI: /nearby?lat=...&radius=1000&type=org 호출
  → 결과 3건 → 번역 → TTS 안내
  → profile.html 링크 카드 표시 (클릭 → 프로필 + AI 비서)

소비자 발화: "여기서 얼마나 걸려?"
  → AI: /directions 호출 → duration_sec 파싱
  → "도보 약 5분 거리입니다" → TTS
```

**AI 비서 시스템 프롬프트 위치 컨텍스트 주입**
```
현재 소비자 위치: lat=33.3945, lng=126.2389 (한림읍)
현재 업체까지 거리: 230m (도보 약 3분)
업체 영업시간: 11:00–20:00 (현재 영업 중)
```

### 9.8 프라이버시 원칙

```
소비자 위치:
  - GPS 권한 요청 전 명시적 안내 표시
  - 동의(consent=true) 없이 location_log 기록 금지
  - 위치 정밀도: 100m 반올림 처리 (정확 좌표 미저장)
  - 이동 경로 추적 금지 (단회성 조회만 허용)

사업자 위치:
  - 등록 시 본인이 직접 좌표 제공 (동의 내포)
  - is_public=false 설정 시 /nearby 결과에서 제외
  - 사업자가 언제든 좌표 삭제 가능 (lat/lng NULL 처리)
```

### 9.9 구현 순위

| 순위 | 작업 | 파일 |
|------|------|------|
| 1 | user_profiles lat/lng 컬럼 추가 (SQL) | Supabase |
| 2 | Worker /nearby 엔드포인트 | worker.js |
| 3 | Worker /location, /directions 엔드포인트 | worker.js |
| 4 | search.html 지도 탭 | users |
| 5 | profile.html 위치 카드 + 길찾기 | users |
| 6 | register.html 좌표 자동 수집 | users |
| 7 | AI 비서 위치 컨텍스트 주입 | worker.js |

---


## 10. 국적별 히트맵 [v1.3 신규]

### 10.1 개요
외국인 관광객 국적별 밀집도를 지도 히트맵으로 시각화.  
사업자에게 "이 지역 중국인 관광객 월 200명" 데이터 제공 → AI 비서 도입 유인.

### 10.2 아키텍처
```
search.html 히트맵 탭
  → GET /heatmap?lang=zh&period=7
  → Worker → Supabase RPC heatmap_by_lang(p_lang, p_days)
  → location_log (consent=true만 집계)
  → k-익명성 적용 (count < 5 격자 제외)
  → Cloudflare max-age=300 캐시
  → Kakao Maps 오버레이 렌더링
```

### 10.3 데이터 모델
```sql
-- location_log에 consent 컬럼 추가 (ALTER TABLE)
ALTER TABLE location_log ADD COLUMN IF NOT EXISTS consent BOOLEAN DEFAULT false;

-- heatmap_by_lang RPC (Supabase Function)
CREATE OR REPLACE FUNCTION heatmap_by_lang(p_lang TEXT, p_days INT)
RETURNS TABLE(grid_lat FLOAT, grid_lng FLOAT, visit_count BIGINT) AS $$
  SELECT
    ROUND(lat::NUMERIC, 2)::FLOAT AS grid_lat,
    ROUND(lng::NUMERIC, 2)::FLOAT AS grid_lng,
    COUNT(*) AS visit_count
  FROM location_log l
  JOIN user_profiles u ON u.guid = l.user_guid
  WHERE l.consent = true
    AND (p_lang IS NULL OR u.native_lang = p_lang)
    AND l.created_at >= now() - (p_days || ' days')::INTERVAL
  GROUP BY 1, 2
  HAVING COUNT(*) >= 5   -- k-익명성: 5명 미만 격자 제외
$$ LANGUAGE sql STABLE;
```

### 10.4 색상 농도
| 방문 수 | 색상 | 코드 |
|---------|------|------|
| 1~10 | teal-50 | #E1F5EE |
| 11~30 | teal-100 | #9FE1CB |
| 31~100 | teal-200 | #5DCAA5 |
| 101~300 | teal-400 | #1D9E75 |
| 301+ | teal-600 | #0F6E56 |

### 10.5 활성화 조건
```
v1.0: 탭 표시, 데이터 없으면 "참여자가 더 늘면 표시됩니다" 안내
v1.1: 사용자 1,000명+ 이후 실 데이터 표시
```

---

## 11. 국적별 리뷰 필터 [v1.3 신규]

### 11.1 개요
외국인 관광객이 profile.html에서 자국민 리뷰만 필터링해 볼 수 있는 기능.  
"중국인 평점 4.7" 같은 신뢰 신호 → 다음 관광객 유입.

### 11.2 데이터 모델
```sql
-- profile_reviews.reviewer_lang 컬럼 (§3.3 이미 정의)
-- profile_review_stats View
CREATE OR REPLACE VIEW profile_review_stats AS
SELECT
  target_guid,
  reviewer_lang,
  COUNT(*) AS review_count,
  ROUND(AVG(rating)::NUMERIC, 1) AS avg_rating
FROM profile_reviews
WHERE is_visible = true
GROUP BY target_guid, reviewer_lang;
```

### 11.3 /biz/profile 응답 확장
```json
{
  "review_summary": {
    "overall": { "count": 42, "avg": 4.3 },
    "by_lang": [
      { "lang": "zh", "count": 18, "avg": 4.7 },
      { "lang": "ko", "count": 20, "avg": 4.1 }
    ],
    "viewer_highlight": { "lang": "zh", "avg": 4.7, "count": 18 }
  }
}
```

### 11.4 편향 감지
```
같은 업체의 두 국적 간 평점 격차 ≥ 1.0 → 경고 문구 표시
예: "국적별 평점 차이가 있을 수 있습니다"
목적: 특정 국가 관광객을 대하는 태도 차이 모니터링
```

---

## 12. 자국민 커뮤니티 게시판 [v1.3 신규]

### 12.1 개요
국적별 여행자 커뮤니티 게시판. 자국민에게 도움 요청, 긴급 상황 공유, 정보 교환.  
한국인 봉사자가 답변 → GDC ₮500 인센티브 지급.

### 12.2 카테고리 및 활성화 시점
| 카테고리 | 설명 | 활성화 |
|----------|------|--------|
| emergency | 긴급 도움 요청 | v1.0 |
| help | 일반 도움 요청 | v1.0 |
| lost_found | 분실물/습득물 | v1.0 |
| info | 제주 여행 정보 | v1.1 (사용자 100명+) |
| general | 자유 게시판 | v1.1 |
| companion | 동행 모집 | v1.5 (사용자 500명+) |

### 12.3 데이터 모델
```sql
CREATE TABLE community_posts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_guid   TEXT NOT NULL,
  lang          TEXT NOT NULL,
  category      TEXT NOT NULL CHECK (category IN ('emergency','help','lost_found','info','general','companion')),
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  body_translated TEXT,
  lat           FLOAT, lng FLOAT,
  is_visible    BOOLEAN DEFAULT true,
  is_resolved   BOOLEAN DEFAULT false,
  reply_count   INT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE community_replies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id         UUID NOT NULL REFERENCES community_posts(id),
  author_guid     TEXT NOT NULL,
  author_lang     TEXT NOT NULL,
  body            TEXT NOT NULL,
  body_translated TEXT,
  is_helpful      BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

### 12.4 핵심 흐름
```
게시물 작성 (POST /community):
  JWT 검증 → K-Security 스코어링
  → score ≥ 0.6: is_visible=false (검토 대기)
  → 번역 (원문 언어 → 한국어 body_translated)
  → INSERT
  → emergency: Supabase Realtime 브로드캐스트
    채널: community:{lang}:emergency

댓글 작성 (POST /community/:id/reply):
  JWT 검증 → 게시물 lang 조회
  → 번역 (댓글 언어 → 게시물 언어)
  → INSERT → reply_count += 1
  → 게시물 작성자에게 Realtime 알림

해결 완료 + GDC 지급 (POST /community/:id/resolve):
  작성자 본인만 가능 (JWT.guid 확인)
  → is_resolved=true
  → 마지막 is_helpful=true 댓글 작성자에게
    fs_ledger credit ₮500 (source='manual')
```

### 12.5 콜드 스타트 전략
```
1단계 (오픈 전): 관광 안내소·숙소 QR에 커뮤니티 URL 사전 홍보
2단계 (오픈 시): emergency + help + lost_found만 오픈
3단계 (v1.1): 한국인 봉사자 모집 (제주 주민, 현지 가이드)
               GDC 인센티브로 자발적 참여 유도
4단계 (v1.1): 사용자 100명 돌파 시 info + general 오픈
```

---

## 13. 대량 등록 자동화

### 13.1 bulk_register.py
```
입력: CSV (name, type, phone, address, occupation, region)
처리: 100건 배치 INSERT, 10 스레드 병렬
GUID: uuidv5(phone_digits, GOPANG_NS)
핸들: @{읍면동_en}_{이름_로마자}_{4자리}
충돌: ON CONFLICT DO UPDATE (name, updated_at 갱신)
속도: 예상 10만 건 / 30분 이내
```

### 13.2 QR PDF 일괄 생성
```
등록 완료 후 handle 목록 추출
→ qrcode 라이브러리로 PNG 생성
→ reportlab으로 PDF 합본
→ 1페이지 = 1기관 (QR + 업체명 + handle + 주소)
→ 인쇄소 전달 또는 자체 출력
```

---

## 14. v1.0 예상 문제점

### P01 — 전화번호 기반 GUID 충돌
```
문제: 번호 재활용(통신사 정책) 시 이전 사용자 GUID와 충돌
영향: 거래 이력 혼용, 잔액 오귀속
v1 대응: extra.verified_at 타임스탬프로 최신 등록자 구분
```

### P02 — Web Speech API 브라우저 호환성
```
문제: Safari iOS STT 불안정, 일부 Android 미지원
영향: AI 비서 음성 기능 동작 불가
v1 대응: 텍스트 입력 폴백 UI 항상 제공
```

### P03 — LLM API 키 보안
```
문제: Worker AES-256-GCM 암호화 키 관리
      Cloudflare 환경변수 유출 시 전체 키 노출
영향: 사용자 LLM API 키 탈취 가능성
v1 대응: 키 저장 시 경고 고지, 사용자 동의 획득
```

### P04 — 실시간 통역 레이턴시
```
문제: STT → 번역 → LLM → 번역 → TTS 파이프라인
      왕복 레이턴시 2~5초 예상
영향: 자연스러운 대화 흐름 방해
v1 대응: 처리 중 시각적 인디케이터 표시
```

### P05 — 오프라인 결제 불가
```
문제: 네트워크 단절 시 L1 접근 불가 → 결제 중단
영향: 제주도 산간/해안 음영 지역 서비스 불가
v1 대응: 오프라인 상태 명시적 안내
```

### P06 — GDC 잔액 초기값 문제
```
문제: 신규 소비자 IDB financial_state 잔액 = 0
      GDC 충전 수단 미정
영향: 등록 직후 결제 불가
v1 대응: 최초 등록 시 웰컴 보너스 지급 정책 필요
```

### P07 — handle 로마자 변환 품질
```
문제: 한글 → 로마자 변환 알고리즘 정확도
      '금능반점' → 'geumneungbanjum' (어색)
영향: QR URL 가독성 저하
v1 대응: 사업자가 handle 직접 수정 가능하도록 설정
```

### P08 — 리뷰 어뷰징
```
문제: 소액 거래 다수 생성 후 리뷰 도배 가능
영향: 리뷰 신뢰도 저하
v1 대응: tx당 1리뷰 UNIQUE 제약으로 1차 방어
```

### P09 — AI 비서 할루시네이션
```
문제: LLM이 존재하지 않는 메뉴/가격/영업시간 응답
영향: 소비자 신뢰 손상, 분쟁 발생
v1 대응: 시스템 프롬프트에 extra.menu 전체 주입
         "메뉴 외 정보는 모른다고 답하라" 명시
```

### P10 — 번역 품질 (전문용어/방언)
```
문제: 제주 방언, 의료/법률 전문용어 번역 오류
영향: 기관(병원, 관공서) 서비스 품질 저하
v1 대응: 일반 서비스(식당, 숙박) 우선 적용
         전문 기관은 수동 검토 후 활성화
```

### P11 — 에스컬레이션 알림 미수신
```
문제: 사업자가 알림을 못 보는 경우 소비자 대기
영향: 서비스 단절, 이탈
v1 대응: 에스컬레이션 후 30초 무응답 시
         "현재 연결이 어렵습니다" 자동 안내
```

### P12 — 대량 등록 데이터 품질
```
문제: CSV 원본 데이터 오기재 (주소, 전화번호 오류)
영향: 잘못된 프로필, QR → 엉뚱한 업체
v1 대응: bulk_register.py 유효성 검증 로직 포함
         등록 후 사업자 본인 확인 절차 권고
```

### P13 — Supabase Realtime 동시 접속 한계
```
문제: 10만 엔티티 동시 활성 시 Realtime 연결 수 초과
영향: 메시지 푸시 지연 또는 누락
v1 대응: 파일럿(한림읍) 규모에서 검증 후 확장
```

### P14 — gopang_token 만료 처리
```
문제: 24시간 만료 후 재등록 화면 진입 시
      소비자 혼란 (다시 등록해야 하나?)
영향: UX 이탈
v1 대응: 만료 1시간 전 자동 갱신
         갱신 실패 시 "다시 시작하기" 1버튼만 표시
```

### P15 — GPS 정확도 부족 (실내/지하)
```
문제: 식당 내부, 지하 시설에서 GPS 신호 약화
      accuracy > 50m 시 반경 검색 오류 발생 가능
영향: /nearby 결과 오정렬, 엉뚱한 업체 상단 노출
v1 대응: accuracy > 100m 시 "위치 정확도가 낮습니다" 경고 표시
         WiFi/셀 기반 위치(Geolocation fallback) 허용
         사용자가 지도에서 핀 직접 이동 가능
```

### P16 — Kakao Maps SDK 외국인 언어 지원 한계
```
문제: Kakao Maps UI 자체가 한국어 고정
      지도 라벨, 검색창 등 다국어 미지원
영향: 외국인 관광객 지도 UX 저하
v1 대응: 지도 위에 오버레이되는 UI(말풍선, 버튼)만 다국어 처리
         지도 라벨은 v2.0에서 Mapbox GL 전환 검토
```

### P17 — 히트맵 초기 데이터 부족 [v1.3 신규]
```
문제: 파일럿 초기 location_log 데이터 부족
      k-익명성 조건(count ≥ 5)으로 격자 대부분 제외
영향: 히트맵 탭이 비어 있어 UX 실망
v1 대응: "참여자가 더 늘면 표시됩니다" 안내 문구
         consent 동의 시 GDC ₮100 인센티브 (v1.1 검토)
```

### P18 — 국적별 평점 편향 [v1.3 신규]
```
문제: 특정 국적 리뷰 수가 적으면 평균이 왜곡됨
      예: 일본인 리뷰 1건이 5.0 → "일본인 평점 5.0" 오해
영향: 신뢰도 저하, 업체 불만
v1 대응: review_count < 3인 국적은 평점 미표시
         "리뷰 3건 이상 시 표시됩니다" 안내
```

### P19 — 커뮤니티 콜드 스타트 [v1.3 신규]
```
문제: 게시판 오픈 초기 게시글 수 부족
      외국인이 들어왔는데 아무것도 없으면 이탈
영향: 커뮤니티 활성화 지연
v1 대응: §12.5 단계별 오픈 전략 이행
         관광 안내소 직원이 초기 게시글 20건 사전 작성
         한국인 봉사자 5명 사전 확보 후 오픈
```

---

## 15. v2.0 계획

### V2-01 — 번호 재활용 문제 해결
```
방식: 전화번호 + 생년월일 조합으로 GUID 생성
      uuidv5(phone + birthday, NS)
      또는 번호 인증 시점 타임스탬프 결합
효과: 번호 재활용 충돌 원천 차단
```

### V2-02 — 네이티브 앱 (PWA → 앱 클립)
```
iOS:     App Clip (QR 스캔 시 앱 없이 네이티브 UI)
Android: Instant App
효과:    Web Speech API 불안정 해소
         오프라인 캐싱 (결제 대기열)
         푸시 알림 안정화
```

### V2-03 — 엣지 캐시 번역
```
자주 쓰이는 번역 쌍을 Cloudflare KV에 캐싱
예: "짜장면" → "炸酱面" (zh), "Jajangmyeon" (en)
효과: 번역 레이턴시 2~5초 → 0.1초 이하
```

### V2-04 — 오프라인 결제 대기열
```
구조: IDB에 서명된 tx 임시 저장
      네트워크 복구 시 자동 전송
      만료시간 내 미전송 시 자동 취소
효과: 음영 지역 결제 가능
```

### V2-05 — GDC 충전 수단
```
충전 방법:
  A. 신용카드 → GDC 전환 (PG 연동)
  B. 은행 계좌 → GDC 전환 (오픈뱅킹 API)
  C. 현금 → 읍면동 사무소 충전 키오스크
  D. 관광객 환전소 연동 (외화 → GDC)
v2 우선: B (오픈뱅킹) + C (키오스크)
```

### V2-06 — LLM 키 보안 강화
```
현재: Cloudflare 환경변수 기반 AES 암호화
v2:   사용자 기기 내 키 분산 (Shamir Secret Sharing)
      서버는 암호화된 조각만 보유
      복호화는 사용자 기기에서만 가능
```

### V2-07 — 실시간 음성 스트리밍 통역
```
현재: STT 완성 후 번역 (청크 방식, 레이턴시 큼)
v2:   WebSocket 스트리밍
      STT 중간 결과 실시간 번역
      응답 TTS와 병렬 처리
목표 레이턴시: 0.5초 이하
```

### V2-08 — 리뷰 어뷰징 방어
```
추가 조건:
  거래 금액 최소 기준 (₮1,000 이상)
  거래 후 24시간 이후 리뷰 가능 (숙려 기간)
  동일 IP 하루 3건 이상 리뷰 차단
  AI 어뷰징 탐지 (Isolation Forest 적용)
```

### V2-09 — OpenHash L2/L3 앵커링
```
현재: L1 (한림읍 노드) 단일
v2:   L2 (제주시 노드) 앵커링
      T10 openhash_anchored=true 완성
      머클 루트 Cron (10분 주기)
효과: 무결성 보증 범위 확대
```

### V2-10 — 프로필 분석 대시보드
```
사업자용:
  일별/월별 매출 (fs_ledger 집계)
  메뉴별 판매량
  리뷰 감성 분석 (LLM)
  방문자 국적 분포 (native_lang 통계)
  AI 비서 대화 통계

관공서용:
  읍면동별 거래량
  업종별 GDC 유통량
  관광객 소비 패턴
```

### V2-11 — 예약 시스템
```
현재: 주문(즉시 결제)만 구현
v2:   calendar 기반 예약
      숙박, 병원, 식당 테이블 예약
      예약금 선결제 (escrow)
      노쇼 패널티 자동 처리
```

### V2-12 — K-Market 통합 검색 + 위치 고도화
```
현재: search_entities() 단순 키워드 검색
      /nearby 하버사인 거리 계산 (평면 근사)
v2:   벡터 검색 (pgvector)
      "제주 흑돼지 맛집" → 의미 기반 검색
      사용자 언어로 검색 → 한국어 업체 매칭
      PostGIS GEOGRAPHY 타입으로 정밀 반경 검색
        ST_DWithin(geog, ST_MakePoint(lng,lat)::geography, radius)
      실시간 혼잡도 연동 (방문자 수 기반)
      Mapbox GL 다국어 지도 전환 (Kakao Maps 한국어 한계 해소)
```

### V2-13 — 정부 연동
```
사업자 등록번호 → 국세청 API 자동 검증
의료기관 → 건강보험심사평가원 연동
관광지 → 한국관광공사 API 연동
효과: 허위 기관 등록 차단, 공식 정보 자동 채움
```

---

## 버전 로드맵

| 버전 | 목표 | 기간 |
|------|------|------|
| v0.4 (현재) | K-Market T01~T10 완료 + Profile 2.0 M01~M14 구현 | 2026-06 |
| v1.0 | 제주 파일럿 (한림읍 300개 기관) + 커뮤니티 긴급/도움 오픈 | 2026-Q3 |
| v1.1 | 한림읍 전체 + 소비자 1,000명 + 히트맵 활성화 + 국적별 리뷰 | 2026-Q4 |
| v1.5 | 제주시 전체 확장 | 2027-Q1 |
| v2.0 | 10만 엔티티 + V2 기능 전체 + Mapbox GL 다국어 지도 | 2027-Q3 |

---

*고팡 제주 설계도 v1.3*  
*AI City Inc. | 2026-06-12*  
*Gopang v0.4.0-T10 기준 | Profile 2.0 M01~M14 구현 완료*
