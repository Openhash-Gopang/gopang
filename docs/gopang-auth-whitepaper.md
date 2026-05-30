# 고팡 사용자 인증 백서
**Gopang User Authentication Whitepaper**
버전 1.0 · 2026년 5월 · AI City Inc.

---

## 목차

1. 개요
2. 설계 철학
3. 사용자 정체성 — IPv6 기반 분산 신원
4. 인증 수단
5. 인증 레벨 체계 (L0~L3)
6. 거래 위험도 자동 판단
7. 기기 변경 및 복원
8. 보안 분석
9. 개인정보 보호
10. 기술 구현 현황
11. 로드맵
12. **하위 서비스 인증 구현 가이드** ← 신규

부록 A — 인증 API 레퍼런스
부록 B — 하위 서비스 통합 체크리스트 ← 신규
부록 C — 용어 정의

---

## 1. 개요

고팡(Gopang)은 현실 세계의 모든 기관·사물·전문직의 AI 쌍둥이로 구축한 AI 평행 세계 플랫폼입니다. 사용자는 단일 정체성(IPv6 주소)으로 수백 개의 하위 시스템(K-Law, K-Market, K-Tax, K-Health 등)에 접근합니다.

본 백서는 고팡의 사용자 인증 시스템 설계 원칙, 기술 구현, 보안 분석을 기술합니다.

---

## 2. 설계 철학

### 2.1 핵심 원칙

```
원칙 1: 서버에 개인정보 저장 없음
  생체정보(지문·얼굴)는 사용자 기기 밖으로 절대 전송되지 않습니다.
  서버에는 공개키와 IPv6 주소만 저장됩니다.

원칙 2: Private Key 보관 불필요
  Private Key를 저장하거나 기억할 필요가 없습니다.
  생체정보와 4단어 시드로 매번 재생성합니다.

원칙 3: 단일 정체성으로 모든 하위 시스템 접근
  한 번 인증으로 K-Law, K-Market, K-Tax 등
  모든 하위 시스템을 이용합니다. (SSO)

원칙 4: 거래 중요도에 비례한 인증 강도
  일상 조회는 기기 인증만, 고액 거래는 다중 인증으로
  보안과 편의성을 균형 있게 유지합니다.

원칙 5: 탈중앙 분산 신뢰
  중앙 서버 없이 OpenHash 분산 원장이 정체성을 보증합니다.
```

### 2.2 기존 인증 방식과의 비교

| 항목 | 기존 방식 | 고팡 방식 |
|------|-----------|-----------|
| 신원 증명 | ID + 비밀번호 | IPv6 + 생체 |
| 서버 저장 | 개인정보 전체 | 공개키만 |
| 생체 저장 위치 | 서버 DB | 기기 Secure Enclave |
| 해킹 피해 | 전체 사용자 노출 | 개인키 추출 불가 |
| 통합 인증 | 시스템마다 별도 로그인 | IPv6 하나로 통합 |
| 기기 변경 | 비밀번호 입력 | 4단어 시드 + 생체 |

---

## 3. 사용자 정체성 — IPv6 기반 분산 신원

### 3.1 IPv6를 정체성으로 선택한 이유

고팡은 사용자 정체성으로 **IPv6 주소** 형식을 사용합니다.

```
DID 방식:  did:gopang:a3f8c2...  → "신원을 증명하는 문서"
IPv6 방식: 2601:db80:a3f8:c291:  → "신원 그 자체이자 통신 주소"
```

IPv6 주소 공간(2¹²⁸ ≈ 3.4×10³⁸)은 지구의 모든 인류, 사물, AI 쌍둥이에게 고유 주소를 부여하기에 충분합니다. 정체성과 통신 주소가 하나로 통합되어 고팡의 AI 평행 세계 철학과 완벽하게 일치합니다.

### 3.2 IPv6 정체성 생성

```
기기 핑거프린트 수집:
  UserAgent + 언어 + 화면해상도 + 시간대
  + CPU코어 수 + 메모리 + 픽셀 깊이
        │
        ▼
  SHA-256 해시 (256비트 = 64 hex)
        │
        ▼
  IPv6 형식 변환 (8그룹 × 16비트)
  앞 2그룹 고팡 전용 prefix 고정:
  2601:db80:xxxx:xxxx:xxxx:xxxx:xxxx:xxxx
```

### 3.3 정체성 저장 위치

```
┌─────────────────────────────────────────────────┐
│  OpenHash 분산 원장 (공개, 불변)                 │
│  · IPv6 주소                                     │
│  · 공개키 (WebAuthn)                             │
│  · 등록 타임스탬프                               │
│  · 기기 변경 이력 (해시만)                       │
└─────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────┐
│  PDV — Private Data Vault (기기 로컬)            │
│  · 얼굴 벡터 128차원 (암호화)                    │
│  · 시드 해시 (PBKDF2, 원문 아님)                │
│  · 기기 핑거프린트 해시                          │
│  · WebAuthn credential ID                       │
│  · 인증 레벨                                     │
└─────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────┐
│  기기 Secure Enclave (하드웨어 보안)             │
│  · 지문 원본 (절대 외부 유출 없음)               │
│  · WebAuthn 개인키                               │
└─────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────┐
│  사용자 오프라인 보관                            │
│  · 4단어 시드 (종이 기록 권장)                   │
└─────────────────────────────────────────────────┘
```

---

## 4. 인증 수단

### 4.1 기기 핑거프린트 (L0)

기기의 하드웨어·소프트웨어 특성을 결합한 SHA-256 해시입니다.

```javascript
const raw = [
  navigator.userAgent,
  navigator.language,
  screen.width + 'x' + screen.height,
  screen.colorDepth,
  Intl.DateTimeFormat().resolvedOptions().timeZone,
  navigator.hardwareConcurrency,
  navigator.deviceMemory,
  screen.pixelDepth,
].join('|');
// → SHA-256 → 64 hex 문자
```

**특성:** 자동(무의식), 빠름(0초), 기기 종속, 브라우저 업데이트 시 변경 가능

### 4.2 얼굴 인증 (L1) — MediaPipe 온디바이스

Google MediaPipe FaceLandmarker를 사용한 완전 온디바이스 얼굴 인식입니다.

```
카메라 (전면, facingMode: 'user')
        │
        ▼
MediaPipe FaceLandmarker
  468개 3D 랜드마크 추출
        │
        ▼
정규화 (코 끝 원점, 눈 간격 스케일)
        │
        ▼
128차원 특징 벡터
        │
        ▼
PDV 저장 벡터와 코사인 유사도 비교
  임계값: 90% 이상 → 인증 성공
```

**특성:**
- 얼굴 이미지: 기기 외부 전송 없음
- 처리 속도: 0.1~0.3초
- 조명·각도 허용 범위: ±30도, 퍼지 추출기 적용
- Safari iOS 포함 모든 주요 브라우저 지원

### 4.3 지문 인증 (L2) — WebAuthn/FIDO2

W3C 표준 WebAuthn을 통한 기기 생체 인증입니다.

```
navigator.credentials.create() [등록]
        │
        ▼
기기 Secure Enclave에서 키 쌍 생성
  개인키 → Secure Enclave (외부 유출 불가)
  공개키 → Supabase + OpenHash 등록
        │
navigator.credentials.get() [인증]
        │
        ▼
챌린지 서명 (Secure Enclave 내부)
        │
        ▼
Worker에서 공개키로 서명 검증
```

**지원 기기:**
- iPhone/iPad: Face ID / Touch ID (LocalAuthentication)
- Galaxy 등 Android: 지문 센서 (BiometricPrompt)
- 데스크탑: Windows Hello, Touch ID

**특성:** 지문 원본 외부 전송 없음, 재사용 공격 방지(카운터), 피싱 불가(도메인 바인딩)

### 4.4 4단어 시드 (L3 + 복원용)

BIP-39에서 영감을 받은 사용자 정의 4단어 복원 시드입니다.

```
사용자 입력: "제주 파란 파도 2018"
        │
        ▼
PBKDF2 (SHA-256, 100,000 iterations, 고팡 전용 salt)
        │
        ▼
256비트 시드 바이트
        │
        ▼
PDV에 해시값만 저장 (원문 절대 미저장)
```

**용도:**
1. 기기 변경 시 정체성 복원
2. L3 고위험 거래 추가 인증
3. 생체 인증 불가 시(손 부상 등) 비상 복원

---

## 5. 인증 레벨 체계 (L0~L3)

### 5.1 레벨 정의

```
L0 — 기기 인증 (자동, 0초)
─────────────────────────────────────────
인증 수단: 기기 핑거프린트 (SHA-256)
적용 상황: 일상 접속, 조회, 검색, 대화
전환 조건: 앱 실행 시 자동

L1 — + 얼굴 인증 (1~2초)
─────────────────────────────────────────
인증 수단: L0 + MediaPipe 얼굴 (90% 이상)
적용 상황: 개인정보 열람, 10만원 미만 결제,
           중요 메시지 발송
전환 조건: AI 비서 [AUTH:L1] 판단 또는 하위 시스템 강제

L2 — + 지문 (2~3초)
─────────────────────────────────────────
인증 수단: L0 + WebAuthn 지문/Face ID
적용 상황: 10만원 이상 금융 거래, 계약 서명,
           소송 제기, 개인정보 변경
전환 조건: AI 비서 [AUTH:L2] 판단 또는 하위 시스템 강제

L3 — + 얼굴 + 지문 + 4단어 (5~10초)
─────────────────────────────────────────
인증 수단: L0 + L1 + L2 + 4단어 시드
적용 상황: 1,000만원 이상 거래, 부동산 계약,
           되돌릴 수 없는 법적 행위, 정체성 변경
전환 조건: AI 비서 [AUTH:L3] 판단 또는 하위 시스템 강제
```

### 5.2 하위 시스템별 최소 인증 레벨

| 하위 시스템 | 기본 | 중요 기능 |
|-------------|------|-----------|
| K-Law | L0 (조회) | L2 (소송 제기), L3 (화해·취하) |
| K-Market | L0 (탐색) | L1 (10만원↓), L2 (10만원↑) |
| K-Tax | L1 (조회) | L2 (신고 제출) |
| GDC 화폐 | L1 (잔액) | L2 (100만원↓), L3 (100만원↑) |
| K-Health | L1 (기록 조회) | L2 (처방·진단) |
| PDV 접근 | L1 (요약) | L2 (전체 열람) |

---

## 6. 거래 위험도 자동 판단

### 6.1 판단 주체와 역할

```
AI 비서 (1차 판단)
  사용자 지시 문맥 분석
  금액·행위 유형·되돌림 가능성 평가
  [AUTH:Lx] 태그로 인증 레벨 결정
        ↓
하위 시스템 (2차 강제)
  코드 레벨에서 최소 인증 레벨 강제
  AI 판단보다 낮으면 무조건 상향
        ↓
사용자 (최종 승인)
  AI가 결정한 레벨 확인
  인증 실행 또는 거래 취소
```

### 6.2 AI 판단 기준

| 조건 | 인증 레벨 |
|------|-----------|
| 정보 조회·계산·대화 | L0 |
| PDV 개인정보 열람, 10만원↓ 결제 | L1 |
| 10만원↑ 금융 거래, 계약 서명, 소송 | L2 |
| 1,000만원↑, 부동산, 되돌릴 수 없는 행위 | L3 |

### 6.3 판단 흐름

```
사용자: "A 계좌로 500만원 보내줘"
        │
        ▼
AI 비서 내부 판단 [THINK]:
  · 금융 거래 (ECO 영역)
  · 금액 500만원 > 10만원 → L2
  · 타인 계좌 송금 → L2 확정
  · 되돌릴 수 있음 → L3 아님
        │
        ▼
응답: "[AUTH:L2] 500만원 송금은 지문 인증이 필요합니다.
       진행하시겠습니까?"
        │
        ▼
사용자: "진행해"
        │
        ▼
지문 인증 실행
        │
        ▼
[AUTH_CONFIRMED:L2] → 송금 실행
```

---

## 7. 기기 변경 및 복원

### 7.1 복원 시나리오

| 상황 | 복원 방법 | 소요 시간 |
|------|-----------|-----------|
| 앱 갱신 | L0 자동 (기기 동일) | 0초 |
| 브라우저 변경 | 4단어 입력 | 30초 |
| 폰 기기 변경 | 4단어 + 얼굴 or 지문 | 1~2분 |
| 폰 분실 + 지문 손상 | 4단어만으로 복원 | 2~3분 |
| 4단어 분실 | **복원 불가** (사용자 책임) | — |

### 7.2 복원 흐름

```
새 기기 접속
        │
        ▼
기기 핑거프린트 불일치 감지
        │
        ▼
4단어 시드 입력
        │
        ▼
PBKDF2(입력값) == PDV 저장 해시?
        │
     일치 ✅        불일치 ❌
        │                │
기기 핑거프린트 갱신   재입력 요청
IPv6 정체성 유지      3회 실패 → 잠금
        │
        ▼
얼굴 또는 지문 재등록 (선택)
```

---

## 8. 보안 분석

### 8.1 위협 모델

| 위협 | 대응 | 결과 |
|------|------|------|
| 서버 해킹 | 공개키만 저장 | 공개키는 쓸모없음 |
| 기기 도난 | 생체 인증 필수 | 타인 지문 인식 불가 |
| 4단어 도용 | 4단어만으론 L3 불가 (생체 병행) | 단독 사용 불가 |
| 중간자 공격 | WebAuthn 도메인 바인딩 | 피싱 사이트에서 서명 무효 |
| 재사용 공격 | WebAuthn 카운터 | 동일 서명 재사용 불가 |
| 얼굴 사진 공격 | 3D 랜드마크 + 라이브니스 | 사진으로 통과 불가 |
| 딥페이크 | 90% 유사도 + 랜드마크 깊이값 | 2D 영상으로 통과 어려움 |

### 8.2 고팡 인증의 한계 및 주의사항

```
1. 4단어 시드 분실 시 복원 불가
   → 안전한 오프라인 장소에 보관 필수

2. 브라우저 데이터 삭제 시 PDV 소실
   → 지문·얼굴 재등록 필요 (정체성 복원은 4단어로 가능)

3. 동일 기기 다른 브라우저
   → PDV는 브라우저 단위 격리
   → 4단어로 복원 후 재등록

4. iOS Safari WebAuthn 제한
   → Face ID는 지원, 지문 Touch ID는 부분 지원
```

---

## 9. 개인정보 보호

### 9.1 데이터 최소화 원칙

```
수집하지 않는 것:
  · 이름, 주민번호, 전화번호
  · 생체 이미지 (얼굴 사진, 지문 이미지)
  · 위치 원본 (좌표만 임시 사용)
  · 구매 이력, 행동 패턴

서버에 저장하는 것 (최소한):
  · IPv6 정체성 (공개 가능)
  · WebAuthn 공개키 (공개 가능)
  · 등록·접속 타임스탬프

기기에만 저장하는 것 (PDV):
  · 얼굴 벡터 128차원 (수치, 이미지 아님)
  · 시드 해시 (원문 아님)
  · 대화 이력
```

### 9.2 법적 준수

| 규정 | 준수 방법 |
|------|-----------|
| GDPR | 개인정보 서버 미저장, 처리 목적 명확 |
| 개인정보보호법 | 생체정보 서버 미전송 |
| FIDO2 표준 | WebAuthn W3C 표준 준수 |

---

## 10. 기술 구현 현황

### 10.1 구현 완료

| 기능 | 상태 | 비고 |
|------|------|------|
| IPv6 정체성 생성 | ✅ | SHA-256 기반 |
| 기기 핑거프린트 (L0) | ✅ | 자동 로그인 |
| 얼굴 인증 (L1) | ✅ | MediaPipe 온디바이스 |
| WebAuthn 지문 (L2) | ✅ | Supabase 공개키 저장 |
| 4단어 시드 (L3) | ✅ | PBKDF2 해시 |
| 기기 변경 복원 | ✅ | 4단어 + 생체 |
| SSO 토큰 | ✅ | HMAC-SHA256 + SameSite=None |
| 거래 위험도 AI 판단 | ✅ | system prompt § 8 |
| [AUTH:Lx] 자동 인증 | ✅ | AI 응답 태그 파싱 |
| 설정 화면 보안 섹션 | ✅ | 지문·얼굴 재등록 |

### 10.2 구현 예정

| 기능 | 예정 | 비고 |
|------|------|------|
| OpenHash 공개키 등록 | Phase 2 | 완전 탈중앙 |
| 얼굴 라이브니스 감지 | Phase 2 | 딥페이크 방어 |
| 다기기 지문 동기화 | Phase 2 | OpenHash 기반 |
| 퍼지 추출기 고도화 | Phase 3 | 센서 차이 보정 |

---

## 11. 로드맵

```
Phase 1 (현재) — 브라우저 기반 구현
  ✅ IPv6 정체성
  ✅ MediaPipe 얼굴 (온디바이스)
  ✅ WebAuthn 지문 (Supabase 공개키)
  ✅ 4단어 시드 (PBKDF2)
  ✅ 거래 위험도 AI 자동 판단

Phase 2 — OpenHash 연동
  OpenHash에 공개키 직접 등록
  서버 없이 하위 시스템이 공개키 조회
  다기기 지문 인증 동기화

Phase 3 — 고도화
  퍼지 추출기: 동일인 생체 변화 허용 범위 확장
  얼굴 라이브니스: 실시간 눈 깜박임 감지
  완전 오프라인 인증: 인터넷 없이도 L2까지 가능
  네이티브 앱 전환: 실제 IPv6 소켓 바인딩
```
---

## 12. 하위 서비스 인증 구현 가이드

본 장은 K-Law, K-Market, K-Tax, K-Security 등 고팡의 모든 하위 서비스 개발자가 고팡 인증을 통합할 때 반드시 따라야 할 구현 규격입니다.

---

### 12.1 핵심 원칙: 고팡이 유일한 인증 포털

하위 서비스는 **독자적인 인증 시스템을 구현하지 않습니다.**
모든 인증은 고팡(gopang.net)에 위임합니다.

```
[금지]
하위 서비스가 자체 로그인 화면 구현
하위 서비스가 지문·얼굴·시드를 독자 등록
하위 서비스가 gopang_user_v3를 직접 읽고 조작

[허용]
gopang-sso.js를 통한 토큰 요청
Cloudflare Worker /auth/verify로 토큰 검증
gopang_user_v3 읽기 전용 참조 (L0 기기 일치 확인만)
```

---

### 12.2 도메인 요건

#### 12.2.1 서브도메인 필수

하위 서비스는 반드시 `*.gopang.net` 서브도메인을 사용해야 합니다.

```
✅ 허용: klaw.gopang.net / market.gopang.net / security.gopang.net
❌ 금지: klaw.kr / gopang-market.com / ksecurity.net
```

**이유:**

1. **WebAuthn rp.id 공유** — `rp.id: 'gopang.net'`에 바인딩된 credential은 `*.gopang.net`에서만 사용 가능. 별도 도메인 사용 시 L2 지문 인증 완전 불가.
2. **Silent iframe SSO** — `*.gopang.net`이어야 Same-Site 쿠키가 자동 전송됨.
3. **SameSite=None 쿠키** — `Domain=.gopang.net` 설정이 모든 서브도메인에 자동 적용.

#### 12.2.2 HTTPS 필수

WebAuthn, SameSite=None 쿠키, Service Worker 모두 HTTPS 환경에서만 동작합니다. `http://` 서빙 시 L2 이상 인증 불가.

---

### 12.3 인증 라이브러리 통합

#### 12.3.1 gopang-sso.js 로드

```html
<script type="module">
  import { gopangAuth } from 'https://gopang.net/auth/gopang-sso.js';
  window._gopangAuth = gopangAuth;
</script>
```

또는 ES 모듈 방식:

```javascript
import { gopangAuth } from 'https://gopang.net/auth/gopang-sso.js';
```

#### 12.3.2 서비스 ID 자동 감지

`gopang-sso.js`가 `location.hostname`에서 서비스 ID를 자동 추출합니다. 별도 설정이 필요하지 않습니다.

```
klaw.gopang.net     → svc: 'klaw'
security.gopang.net → svc: 'security'
```

---

### 12.4 두 가지 접근 경로와 처리 방법

#### 경로 1: 고팡 앱이 하위 서비스를 호출 (GWP)

```
고팡 앱(_gwpLaunch)
    │
    └─ URL: https://klaw.gopang.net
            ?gwp=1
            &gwp_token=eyJwYXlsb2Fk...   ← HMAC 서명 토큰 (1시간 유효)
            &origin=https://gopang.net
    │
    ▼
gopangAuth.require('L0') 내부에서 gwp_token 자동 감지·검증
    │
    ▼
✅ 즉시 인증 완료 (사용자 인지 없음)
```

#### 경로 2: 사용자가 하위 서비스에 직접 접속

```
사용자 → klaw.gopang.net 직접 입력
    │
    ├─ Case A: sessionStorage 유효 토큰 → 즉시 완료
    │
    ├─ Case B: Silent iframe 성공
    │          gopang.net/auth/silent-auth.html 호출
    │          gopang_user_v3 존재 + 기기 일치
    │          → postMessage 토큰 수신 → 완료 (페이지 이동 없음)
    │
    ├─ Case C: 미등록 또는 기기 불일치
    │          → gopang.net/auth/silent-auth.html 리다이렉트
    │          → 사용자 4단어 입력 또는 신규 등록
    │          → klaw.gopang.net?gopang_token=eyJ... 복귀
    │          → 토큰 검증 후 URL 자동 정리 → 완료
    │
    └─ Case D: 서드파티 쿠키 차단 환경 → 자동으로 C 방식 전환
```

---

### 12.5 인증 레벨별 구현 패턴

#### L0 — 기기 인증 (기본, 모든 서비스)

```javascript
const user = await gopangAuth.require('L0');
if (!user) return; // 리다이렉트 중 — 이하 실행 안 됨
initService(user);
```

#### L1 — 얼굴 인증

```javascript
async function openPersonalData() {
  const user = await gopangAuth.require('L1');
  if (!user) return;
  renderPersonalData();
}
```

#### L2 — 지문 인증

```javascript
async function submitContract(data) {
  const user = await gopangAuth.require('L2');
  if (!user) return;
  await signContract(user.ipv6, data);
}
```

#### L3 — 최고 보안

```javascript
async function transferLarge(amount, target) {
  const level = amount >= 10_000_000 ? 'L3' : 'L2';
  const user  = await gopangAuth.require(level);
  if (!user) return;
  await transfer(user.ipv6, amount, target);
}
```

---

### 12.6 GWP 토큰 보안 요건

#### 토큰 구조 (필수)

```javascript
// gwp_token 내용 (HMAC-SHA256 서명 + Base64url 인코딩)
{
  payload: {
    ver:   "1.0",
    ipv6:  "2601:db80:a3f8:c291:...",
    level: "L0",
    svc:   "klaw",
    iat:   1717000000,
    exp:   1717003600,   // 발급 후 1시간 만료
  },
  sig: "a3f8c2..."       // seedHex 기반 HMAC-SHA256
}
```

#### 절대 금지: 평문 IPv6 노출

```
❌ ?gwp=1&token=2601:db80:a3f8:...
   브라우저 히스토리·서버 로그 노출, 만료 없음, 위조 가능

✅ ?gwp_token=eyJwYXlsb2Fk...
   HMAC 서명 + 1시간 만료 포함
```

#### 서버 검증 (필수)

```javascript
// 중요 기능 실행 전 Worker에서 서버 검증
const res = await fetch(
  'https://gopang-proxy.tensor-city.workers.dev/auth/verify',
  { credentials: 'include' }
);
const { valid, ipv6, level } = await res.json();
if (!valid) return; // 접근 거부
```

---

### 12.7 서비스 등록 절차

```
1. AI City Inc.에 등록 신청
   서비스 ID · 서브도메인 · 최소 인증 레벨 · 설명

2. gopang_v2 GWP_REGISTRY 등록
   const GWP_REGISTRY = {
     'security': {
       id:       'security',
       name:     'K-Security',
       url:      'https://security.gopang.net',
       minLevel: 'L1',
       icon:     '🛡️',
     },
   };

3. Cloudflare Worker ALLOWED_ORIGINS에 도메인 추가

4. 테스트 완료 후 고팡 앱 에이전트 목록 표시
```

---

### 12.8 WebAuthn rp.id 공유

`*.gopang.net` 서브도메인은 `rp.id: 'gopang.net'`을 공유하므로 고팡에서 등록한 지문 credential을 하위 서비스에서 직접 사용할 수 있습니다.

```javascript
// 하위 서비스에서 직접 WebAuthn 호출 시 (비권장)
const assertion = await navigator.credentials.get({
  publicKey: {
    rpId: 'gopang.net',   // 반드시 'gopang.net' 고정
    challenge: ...,
    allowCredentials: [{ id: credId, type: 'public-key' }],
  },
});
// 권장: gopangAuth.require('L2') 사용
```

---

### 12.9 금지 사항

| 금지 | 이유 |
|------|------|
| 독자 로그인 폼 구현 | 인증 파편화, 보안 취약점 증가 |
| `gopang_user_v3` 직접 쓰기 | 고팡 인증 데이터 오염 |
| 평문 IPv6 URL 파라미터 | 정체성 노출·위조 가능 |
| 인증 레벨 클라이언트 단독 판단 | 클라이언트 조작 가능 |
| `exp` 만료 검증 생략 | 만료 토큰 영구 사용 가능 |
| `rp.id` 독자 설정 | 고팡 지문 credential 사용 불가 |

---

### 12.10 표준 초기화 코드

```html
<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><title>K-Security</title></head>
<body>
  <div id="app" style="display:none">
    <!-- 서비스 콘텐츠 -->
  </div>
  <div id="loading">고팡 인증 확인 중…</div>

  <script type="module">
    import { gopangAuth } from 'https://gopang.net/auth/gopang-sso.js';

    (async () => {
      // 1. 서비스 최소 인증 레벨 선언
      const user = await gopangAuth.require('L1'); // K-Security는 L1 기본

      // 2. null = 리다이렉트 중 (자동 처리됨)
      if (!user) return;

      // 3. 인증 성공 → 서비스 초기화
      document.getElementById('loading').style.display = 'none';
      document.getElementById('app').style.display     = 'block';

      // 4. 특정 기능에서 레벨 상향
      document.getElementById('btn-sensitive').onclick = async () => {
        const ok = await gopangAuth.require('L2');
        if (!ok) return;
        renderSensitiveData(user.ipv6);
      };
    })();
  </script>
  <button id="btn-sensitive">민감 데이터 열람</button>
</body>
</html>
```

---

### 12.11 서비스별 최소 인증 레벨 기준표

| 서비스 | 기본 | 조회 | 주요 기능 | 고위험 기능 |
|--------|------|------|-----------|-------------|
| K-Law | L0 | L0 | L2 (소송 제기) | L3 (화해·취하) |
| K-Market | L0 | L0 | L1 (10만원↓) | L2 (10만원↑) |
| K-Tax | L0 | L1 | L2 (신고) | L2 (수정신고) |
| K-Security | L1 | L1 | L2 | L3 |
| K-Health | L1 | L1 | L2 (처방) | L2 |
| K-Finance | L1 | L1 | L2 | L3 (1,000만원↑) |
| K-Gov | L0 | L0 | L1 (민원) | L2 (등기·계약) |
| GDC 화폐 | L1 | L1 | L2 (송금) | L3 (100만원↑) |

---

### 12.12 오류 처리

```javascript
const user = await gopangAuth.require('L1');

// null 반환 원인:
// 1. 리다이렉트 중        → 자동 처리, 별도 처리 불필요
// 2. 인증 취소            → 사용자 안내
// 3. 생체 인식 실패       → gopangAuth 내부 메시지 표시 후 null
// 4. 미등록 기기          → gopang.net 자동 리다이렉트

if (!user) {
  showNotice('인증이 필요합니다. 고팡 앱에서 먼저 등록해 주세요.');
  return;
}
```



---

## 부록 A — 인증 API 레퍼런스

```javascript
// 하위 시스템에서 고팡 SSO 사용
import { gopangAuth } from 'https://gopang.net/auth/gopang-sso.js';

// L0: 기기 인증만 (일반 접속)
const user = await gopangAuth.require('L0');

// L1: + 얼굴 (개인정보 열람)
const user = await gopangAuth.require('L1');

// L2: + 지문 (금융 거래)
const user = await gopangAuth.require('L2');

// L3: + 얼굴 + 지문 + 4단어 (고위험 거래)
const user = await gopangAuth.require('L3');

// 반환값
// user.ipv6  → "2601:db80:a3f8:..."
// user.level → "L0" | "L1" | "L2" | "L3"
// user.exp   → 토큰 만료 Unix 타임스탬프
// null       → 인증 실패 또는 리다이렉트 중
```

---

## 부록 B — 하위 서비스 통합 체크리스트

하위 서비스 개발 완료 전 다음 항목을 반드시 점검합니다.

### 도메인 및 환경

- [ ] 서비스가 `*.gopang.net` 서브도메인에서 서빙됨
- [ ] HTTPS 적용 완료
- [ ] Cloudflare Worker ALLOWED_ORIGINS에 도메인 등록 완료
- [ ] GWP_REGISTRY에 서비스 등록 완료

### 인증 라이브러리

- [ ] `gopang-sso.js` `import` 구문이 HTML/JS 최상단에 위치
- [ ] 진입점에서 `gopangAuth.require(MIN_LEVEL)` 호출
- [ ] `user === null` 처리 (리다이렉트 중 코드 중단)
- [ ] 독자 로그인 폼 없음 확인

### 보안

- [ ] URL 파라미터에 평문 IPv6 노출 없음
- [ ] `gopang_user_v3` 직접 쓰기 없음
- [ ] 중요 기능에 적절한 인증 레벨 적용 (12.11 기준표 참조)
- [ ] 서버 사이드 검증: Worker `/auth/verify` 호출 확인
- [ ] `exp` 만료 필드 검증 누락 없음

### WebAuthn

- [ ] `rp.id: 'gopang.net'` 고정 사용
- [ ] 서비스 독자 생체 등록 없음
- [ ] credential ID를 gopang_user_v3.webauthn에서 참조

### 테스트

- [ ] 경로 1 (GWP 호출) 테스트: 고팡 앱에서 서비스 실행 시 즉시 인증
- [ ] 경로 2-A (쿠키) 테스트: 유효 쿠키로 직접 접속 시 자동 인증
- [ ] 경로 2-B (Silent) 테스트: gopang.net 등록 기기에서 직접 접속
- [ ] 경로 2-C (리다이렉트) 테스트: 미등록 기기에서 직접 접속
- [ ] 인증 레벨 상향 테스트: L0 접속 후 L2 기능 클릭 시 지문 요청
- [ ] 인증 취소 테스트: 인증 도중 취소 시 서비스 정상 중단

---

*본 백서는 고팡 플랫폼의 기술 발전에 따라 지속적으로 갱신됩니다.*
*© 2026 AI City Inc. All rights reserved.*

---

## 부록 C — 용어 정의

| 용어 | 정의 |
|------|------|
| IPv6 정체성 | 사용자를 고유하게 식별하는 IPv6 형식 주소 |
| PDV | Private Data Vault. 기기 로컬 암호화 저장소 |
| Secure Enclave | 기기 내 하드웨어 보안 영역. 생체·키 저장 |
| WebAuthn | W3C 표준 웹 인증 프로토콜 (FIDO2) |
| MediaPipe | Google의 온디바이스 ML 프레임워크 |
| PBKDF2 | 비밀번호 기반 키 유도 함수 (반복 해시) |
| HMAC | 키 기반 메시지 인증 코드 |
| SSO | Single Sign-On. 단일 인증으로 다중 서비스 접근 |
| L0~L3 | 고팡 인증 레벨 0~3단계 |
| OpenHash | 고팡의 분산 원장 네트워크 |

---

*본 백서는 고팡 플랫폼의 기술 발전에 따라 지속적으로 갱신됩니다.*
*© 2026 AI City Inc. All rights reserved.*
