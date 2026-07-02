# 고팡 사용자 인증 설계 문서
> 작성일: 2026-06-14  
> 버전: v1.1

---

## 1. 기본 원칙

고팡의 인증 체계는 **종래의 아이디/패스워드 로그인과 근본적으로 다릅니다.**

- 사용자는 아이디와 패스워드를 입력하여 로그인하지 않습니다.
- 인증의 기반은 **기기 핑거프린트(Device Fingerprint)** 입니다.
- **1기기 1사용자 원칙**: 하나의 기기는 하나의 사용자에게만 귀속됩니다.
- 사용자 식별자(GUID)는 기기 핑거프린트로부터 파생된 **IPv6 형식 주소**입니다.
- 등록 사용자는 반드시 **자신의 기기**로만 고팡에 접속해야 합니다.
- 새로운 기기로 접속할 경우, 해당 기기는 **이전에 다른 사용자의 고팡 기기로 등록된 적이 없어야** 합니다.

---

## 2. 사용자 단계

| 단계 | AI 비서 | P2P 채팅 | GDC 결제 | 설정 창 |
|------|---------|----------|----------|---------|
| Guest (미등록) | ❌ | ❌ | ❌ | 아이디 등록만 |
| 등록 사용자 | ✅ | ✅ | ❌ | 로그아웃 + AI 설정 버튼 |
| GDC 사용자 | ✅ | ✅ | ✅ | 로그아웃 + AI 설정 버튼 + GDC Wallet |

---

## 3. 인증 흐름

### 3-1. 첫 접속 (미등록 기기)

```
기기로 hondi.net 접속
  └─ initAuth() 실행
       ├─ 기기 핑거프린트 생성 (SHA-256)
       ├─ IPv6 형식 GUID 파생
       ├─ localStorage['gopang_user_v3'] 없음 → 신규 Guest
       ├─ guest 객체 저장 { ipv6, fpHex, isGuest: true }
       └─ 상단 바: "Guest" 표시
```

### 3-2. 재접속 (등록 사용자, 동일 기기)

```
동일 기기로 hondi.net 재접속
  └─ initAuth() 실행
       ├─ localStorage['gopang_user_v3'] 읽기
       ├─ stored.fpHex === 현재 fpHex ✅
       ├─ stored.handle 존재 ✅
       └─ 자동 로그인 → 상단 바: "@핸들명" 표시
```

### 3-3. 기기 교체 (본인, 새 기기)

```
새 기기로 hondi.net 접속
  └─ initAuth() 실행
       ├─ localStorage 없음 (새 기기) → Guest 상태
       └─ 설정 창: "기존 아이디 복구" 버튼 표시
            └─ 4단어 시드 입력 → 본인 확인 → 새 기기에 재등록
```

### 3-4. 타인 기기 접속 시도 (차단)

```
타인의 기기(등록된 상태)로 접속 시도
  └─ initAuth() 실행
       ├─ stored.fpHex ≠ 현재 fpHex
       ├─ stored.handle 존재 (타인 소유)
       └─ 접속 거부 ❌ → "이 기기는 다른 사용자에게 등록된 기기입니다" 안내
```

### 3-5. 로그아웃된 기기 접속

```
로그아웃된 기기로 접속
  └─ initAuth() 실행
       ├─ localStorage 없음 (로그아웃 시 삭제됨)
       └─ 신규 Guest로 시작 (첫 접속과 동일) ✅
```

---

## 4. 사용자 등록

- 설정 창에서 **표시될 이름** 입력 후 **아이디 등록** 버튼 클릭.
- 핸들 형식: `@이름#GUID끝4자리` (예: `@금능#0996`)
- L1 PocketBase(`l1-hanlim.hondi.net`)에 등록.
- 등록 완료 후 `localStorage['gopang_user_v3']`에 `ipv6`, `fpHex`, `handle`, `name` 전체 저장.
- **등록 즉시 자동 로그인** — 별도 로그인 절차 없음.

---

## 5. 로그아웃

로그아웃은 **이 기기의 고팡 데이터를 완전히 삭제**하는 행위입니다.

```
로그아웃 버튼 클릭
  └─ gopangLogout()
       ├─ localStorage.clear()       ← 사용자 데이터 삭제
       ├─ sessionStorage.clear()     ← 세션 데이터 삭제
       ├─ SW 캐시 삭제               ← 앱 캐시 삭제
       └─ location.reload()          → Guest 상태로 재시작
```

- 로그아웃 후 이 기기는 **처음 접속한 상태와 동일**합니다.
- 본인이든 타인이든 로그아웃된 기기로 접속하면 Guest 상태로 시작합니다.

---

## 6. 기기 완전 초기화

로그아웃보다 강력한 **기기 등록 해제** 기능입니다.  
**중고 기기 판매 전** 반드시 실행해야 합니다.

```
기기 완전 초기화 실행
  └─ _deviceFullReset()
       ├─ L1 PocketBase에서 해당 fpHex 기기 등록 해제
       ├─ localStorage.clear()
       ├─ sessionStorage.clear()
       ├─ SW 캐시 삭제
       ├─ IndexedDB 삭제 (P2P 채팅 기록 등)
       └─ location.reload() → Guest 상태로 재시작
```

---

## 7. 중고 기기 시나리오

### 7-1. 중고 판매 시 (전 소유자)

| 처리 방법 | 결과 |
|----------|------|
| **기기 완전 초기화** 후 판매 | L1에서도 기기 해제 → 구매자 정상 사용 ✅ |
| 로그아웃 후 판매 | localStorage 삭제 → 구매자 Guest로 시작 ✅ |
| 공장 초기화 후 판매 | localStorage 삭제 → 구매자 Guest로 시작 ✅ |
| 아무 처리 없이 판매 | 전 소유자 데이터 잔존 → **보안 위험** ❌ |

> ⚠️ **권장**: 판매 전 반드시 **기기 완전 초기화** 실행

### 7-2. 중고 구입 시 (신규 소유자)

| 전 소유자 처리 상태 | 신규 소유자 접속 결과 |
|-------------------|-------------------|
| 기기 완전 초기화 완료 | Guest로 정상 시작 ✅ |
| 로그아웃 완료 | Guest로 정상 시작 ✅ |
| 공장 초기화 완료 | Guest로 정상 시작 ✅ |
| 아무 처리 없음 | 전 소유자로 자동 로그인 위험 ❌ |

---

## 8. 설정 창 구성

### Guest 상태

| 항목 | 표시 |
|------|------|
| 스마트폰 권한 설정 안내 | ✅ |
| 아이디 등록 | ✅ |
| AI 설정 버튼 | ❌ |
| 로그아웃 버튼 | ❌ |
| GDC Wallet | ❌ |

### 등록 사용자

| 항목 | 표시 |
|------|------|
| 고팡 아이디 (등록됨) | ✅ |
| **AI 설정 버튼** | ✅ → 클릭 시 LLM 선택 + System Prompt 슬라이드 패널 |
| 로그아웃 버튼 | ✅ |
| GDC Wallet | ❌ |

### GDC 사용자

| 항목 | 표시 |
|------|------|
| 고팡 아이디 (등록됨) | ✅ |
| **AI 설정 버튼** | ✅ → 클릭 시 LLM 선택 + System Prompt 슬라이드 패널 |
| 로그아웃 버튼 | ✅ |
| **GDC Wallet** | ✅ |

---

## 9. AI 설정 패널

등록 사용자와 GDC 사용자 모두 접근 가능합니다.  
설정 창의 **AI 설정** 버튼 클릭 시 슬라이드 패널이 열립니다.

**패널 구성:**
- LLM 모델 선택
- API 엔드포인트 선택
- API Key 입력 (DeepSeek 직접 사용 시)
- Gemini API Key 입력 (이미지 분석용)
- System Prompt 수정
- 저장 버튼

---

## 10. fpHex와 handle 상세 설명

### 10-1. fpHex (기기 핑거프린트 해시)

**생성 방법:**

다음 8가지 브라우저/기기 속성을 `|`로 연결한 문자열을 SHA-256으로 해싱합니다.

```javascript
const raw = [
  navigator.userAgent,          // 브라우저 종류·버전
  navigator.language,           // 언어 설정
  screen.width + 'x' + screen.height,  // 화면 해상도
  screen.colorDepth,            // 색상 깊이
  Intl.DateTimeFormat().resolvedOptions().timeZone,  // 시간대
  navigator.hardwareConcurrency,  // CPU 코어 수
  navigator.deviceMemory,         // 메모리 용량
  screen.pixelDepth,              // 픽셀 깊이
].join('|');

fpHex = SHA-256(raw) → 64자리 hex 문자열
```

**역할:**

| 역할 | 설명 |
|------|------|
| 기기 식별 | 동일 기기에서 항상 동일한 값 생성 |
| 자동 로그인 | `stored.fpHex === 현재 fpHex` → 동일 기기 확인 후 자동 로그인 |
| 기기 변경 감지 | `stored.fpHex !== 현재 fpHex` → 다른 기기로 접속 감지 |
| 타인 기기 차단 | 등록된 `fpHex`와 불일치 시 접속 거부 |
| GUID 파생 | `fpHex` 앞 32자(16바이트)를 IPv6 형식으로 변환하여 GUID 생성 |

**GUID(IPv6) 파생 방법:**

```javascript
// fpHex 앞 32자 → 8그룹 × 4자리 hex → IPv6 형식
groups[0] = '2601'   // 고팡 전용 prefix
groups[1] = 'db80'   // 고팡 식별자
groups[2..7] = fpHex.slice(8, 32)  // 기기 고유값

// 결과 예시
"2601:db80:a1b2:c3d4:e5f6:7890:abcd:ef12"
```

**한계와 주의사항:**
- OS 재설치, 브라우저 재설치, 주요 하드웨어 교체 시 `fpHex`가 변경될 수 있습니다.
- `fpHex`가 변경되면 자동 로그인 불가 → 4단어 시드로 복구해야 합니다.
- 동일 기기에서도 브라우저가 다르면 `localStorage`가 분리됩니다. 단, `fpHex`는 하드웨어 기반이므로 **브라우저가 달라도 동일한 값**이 생성됩니다.

**브라우저 분리와 fpHex의 관계:**

| 상황 | fpHex | localStorage | 결과 |
|------|-------|-------------|------|
| 내 기기, 내 브라우저 (Chrome) | 동일 | 있음 | 자동 로그인 ✅ |
| 내 기기, 타 브라우저 (Edge) | 동일 | 없음 | L1 조회 → 기존 아이디 복원 ✅ |
| 타인 기기, 미등록 | 다름 | 없음 | Guest (등록 가능) ✅ |
| 타인 기기, 등록됨 | 다름 | 없음 | Guest (등록 불가) ❌ |

**타 브라우저 접속 시 L1 조회 흐름:**

```
내 기기에서 타 브라우저로 hondi.net 접속
  └─ initAuth() 실행
       ├─ fpHex 생성 (하드웨어 동일 → 기존과 동일한 fpHex)
       ├─ localStorage 없음
       └─ L1에서 fpHex 조회
            ├─ 결과 없음 → Guest로 시작
            └─ 결과 있음 → 기존 handle 발견
                 ├─ "이 기기의 고팡 아이디(@금능#0996)로
                 │   로그인하시겠습니까?" 확인 팝업
                 └─ 확인 → localStorage 복원 → 자동 로그인 ✅
```

**아이디 등록 시 fpHex 중복 검증:**

```
_registerToL1(name) 실행
  └─ L1 POST 전에 fpHex 중복 조회
       ├─ GET /profiles?filter=fpHex='xxx'
       ├─ 결과 없음 → 등록 허용 ✅
       └─ 결과 있음 (타인 등록된 기기)
            └─ 등록 거부 ❌
               "이 기기는 이미 다른 사용자에게 등록된 기기입니다.
                고팡 아이디는 기기당 1개만 등록할 수 있습니다."
```

> ℹ️ Guest 이용(단순 열람 등)은 어떤 기기, 어떤 브라우저에서도 가능합니다.  
> 아이디 등록만 **fpHex 단위로 기기당 1개**로 제한합니다.

---

### 10-2. handle (고팡 아이디)

**생성 방법:**

```javascript
handle = '@' + name + '#' + guid.slice(-4)

// 예시: 이름 "금능", GUID 끝 4자리 "0996"
handle = "@금능#0996"
```

**구성 요소:**

| 요소 | 설명 | 예시 |
|------|------|------|
| `@` | 고팡 아이디 접두사 | `@` |
| `name` | 사용자가 직접 입력한 표시 이름 | `금능` |
| `#` | 구분자 | `#` |
| `guid.slice(-4)` | GUID(IPv6) 끝 4자리 — 동명이인 구별 | `0996` |

**역할:**

| 역할 | 설명 |
|------|------|
| 사용자 식별 | P2P 채팅 상대방 검색 시 핸들로 찾기 |
| 주문자 표시 | K-Market 상품 주문 시 주문자 아이디 |
| 등록 여부 판별 | `handle` 존재 여부로 등록 사용자 확인 (`_isRegistered()`) |
| L1 등록 | L1 PocketBase `profiles` 컬렉션에 저장 |
| PDV 기록 | 모든 PDV 로그에 `user_guid`(IPv6)와 함께 기록 |

**L1 저장 구조:**

```json
{
  "guid": "2601:db80:a1b2:c3d4:e5f6:7890:abcd:ef12",
  "handle": "@금능#0996",
  "nickname_hash": "SHA-256('ko:금능')",
  "native_lang": "ko",
  "is_public": true
}
```

**nickname_hash 용도:**
- `name` 원문 대신 해시를 저장하여 서버에서 실명 노출 방지
- 동일 이름 사용자 검색 시 해시 비교로 확인

**handle의 고유성:**
- `name`이 같아도 `guid` 끝 4자리가 다르면 다른 핸들
- 완전한 고유성은 보장하지 않으나 (4자리 = 65,536 경우의 수), 실용적 수준에서 충분
- 완전 고유성이 필요한 경우 GUID 전체로 식별

---

### 10-3. fpHex와 handle의 관계

```
기기 (하드웨어/브라우저)
  └─ fpHex 생성 (기기 고유 지문)
       └─ IPv6 GUID 파생 (fpHex → 기기 주소)
            └─ handle 생성 (@이름#GUID끝4자리)
                 └─ L1 등록 (guid + handle 쌍으로 저장)
```

- `fpHex`는 **기기를 식별**합니다.
- `handle`은 **사용자를 식별**합니다.
- 고팡에서 기기와 사용자는 `fpHex ↔ handle` 쌍으로 **불가분하게 결합**됩니다.
- 이 결합이 **1기기 1사용자 원칙**의 기술적 구현입니다.

---

## 11. 저장소별 역할과 구조

고팡은 4개의 저장소를 계층적으로 사용합니다.

```
클라이언트 (브라우저)                    서버
┌─────────────────────────┐         ┌──────────────────────┐
│ localStorage            │         │ L1 PocketBase        │
│ (사용자 신원·설정)       │         │ (기기·사용자 등록)    │
├─────────────────────────┤         ├──────────────────────┤
│ IndexedDB               │         │ Supabase             │
│ (지갑·해시체인·P2P채팅) │         │ (PDV·거래·시그널링)   │
└─────────────────────────┘         └──────────────────────┘
```

---

### 11-1. localStorage

**위치:** 브라우저 로컬 (기기 내부)  
**특성:** 동기 읽기/쓰기, 브라우저별 분리, 로그아웃 시 완전 삭제

**저장 키 목록:**

| 키 | 내용 | 저장 시점 |
|----|------|-----------|
| `gopang_user_v3` | 사용자 신원 (ipv6, fpHex, handle, name) | 첫 접속, 아이디 등록, 설정 변경 |
| `gopang_pdv_log` | PDV 로컬 캐시 (최근 기록 백업) | PDV 기록 시 |
| `gopang_profile_address` | 사용자 주소 (위치 서비스 폴백) | 프로필 저장 시 |
| `gopang_settings_*` | AI 모델, 엔드포인트, System Prompt | 설정 저장 시 |

**`gopang_user_v3` 상세 구조:**

```javascript
// Guest
{ ipv6, fpHex, isTemp: true, isGuest: true, registeredAt }

// 등록 사용자
{ ipv6, fpHex, isTemp: false, isGuest: false, handle, name, registeredAt }

// GDC 사용자 (추가)
{ ...등록 사용자, gdcEnabled: true, walletPubKey: "ed25519_pubkey" }
```

**역할:**
- `initAuth()` 진입 시 가장 먼저 읽어 자동 로그인 여부 판단
- `_isRegistered()` / `_isGuestUser()` 의 판단 근거
- 로그아웃(`localStorage.clear()`) 시 전체 삭제 → Guest 상태로 초기화

---

### 11-2. IndexedDB

**위치:** 브라우저 로컬 (기기 내부)  
**특성:** 비동기 읽기/쓰기, 대용량 구조화 데이터, 로그아웃 시 별도 삭제 필요

**데이터베이스 목록:**

| DB 이름 | 스토어 | 내용 |
|---------|--------|------|
| `gopang-wallet` | `keys` | Ed25519 개인키, 재무상태(`financial_state`) |
| `gopang-wallet` | `hash_chain` | 로컬 해시체인 이력 (높이별 기록) |
| `gopang_pdv_chat` | `messages` | P2P 채팅 메시지 PDV 기록 |

**`gopang-wallet` 상세:**

```javascript
// keys 스토어
{
  'ed25519-main': {
    publicKey: Uint8Array,   // Ed25519 공개키
    privateKey: Uint8Array,  // Ed25519 개인키 (AES-GCM 암호화)
    iv: Uint8Array           // 암호화 IV
  },
  'financial_state': {
    balance: Number,         // GDC 잔액
    last_tx_id: String,      // 마지막 거래 ID
    updated_at: String       // 업데이트 시각
  }
}

// hash_chain 스토어 (keyPath: 'height')
{
  height: Number,            // 체인 높이 (0부터 순증)
  local_hash: String,        // 이 높이의 로컬 해시
  prev_hash: String,         // 이전 높이 해시
  tx_id: String,             // 연결된 거래 ID
  anchored_at: String        // 앵커 시각
}
```

**역할:**
- GDC Wallet의 Ed25519 개인키를 AES-GCM으로 암호화하여 안전하게 보관
- 로컬 해시체인으로 PDV 무결성 검증
- P2P 채팅 메시지를 로컬에 영구 보존 (서버 의존 없음)
- 기기 완전 초기화 시 반드시 별도 삭제 필요

---

### 11-3. L1 PocketBase

**위치:** `https://l1-hanlim.hondi.net`  
**컬렉션:** `profiles`  
**특성:** 경량 서버, 기기·사용자 등록 원장, 한림읍 로컬 노드

**저장 데이터:**

```json
{
  "guid": "2601:db80:xxxx:xxxx:xxxx:xxxx:xxxx:xxxx",
  "handle": "@금능#0996",
  "nickname_hash": "SHA-256('ko:금능')",
  "native_lang": "ko",
  "is_public": true
}
```

**호출 시점:**

| 시점 | 동작 |
|------|------|
| 아이디 등록 (`_registerToL1`) | POST → 신규 등록 |
| 중복 등록 시 | GET → PATCH (핸들 업데이트) |
| 사용자 검색 (`runSearch`) | GET + filter |
| 기기 완전 초기화 | DELETE (기기 해제) |

**역할:**
- **기기-사용자 결합의 공식 등록 원장** — 1기기 1사용자 원칙의 서버 측 구현
- `fpHex` 기반 GUID와 `handle`의 공식 쌍(pair) 보관
- 사용자 검색 시 handle로 GUID 조회 (P2P 연결의 출발점)
- `nickname_hash` 저장으로 서버에서 실명 노출 방지

---

### 11-4. Supabase

**위치:** `https://ebbecjfrwaswbdybbgiu.supabase.co`  
**접근 경로:** Cloudflare Worker (`gopang-proxy.tensor-city.workers.dev`) 경유  
**특성:** PostgreSQL 기반, 고팡의 메인 클라우드 데이터베이스

**테이블 목록:**

| 테이블 | 역할 |
|--------|------|
| `user_profiles` | 사용자 전체 프로필 (pubkey_ed25519, extra 등) |
| `pdv_log` | **PDV 기록 원장** — 모든 행동 데이터 |
| `pdv_consent_requests` | PDV 조회 동의 요청 |
| `l1_ledger` | L1 해시체인 앵커 기록 |
| `merkle_anchors` | Merkle 루트 앵커 |
| `webrtc_signals` | P2P WebRTC 시그널링 (offer/answer/ICE) |
| `biz_products` | K-Market 상품 목록 |
| `biz_reviews` | K-Market 리뷰 |
| `webauthn_credentials` | WebAuthn 인증 자격증명 |
| `svc_registry` | GWP 서비스 등록 |
| `user_llm_keys` | 사용자 LLM API 키 (암호화) |

**주요 테이블 상세:**

**`pdv_log`** — 고팡의 핵심 데이터 원장
```json
{
  "id": "PDV-2601db80...-1718300000000",
  "guid": "2601:db80:...",
  "source": "k-market",
  "type": "order",
  "report_id": "session_uuid",
  "summary": "짜장면 주문",
  "summary_6w": "{who, when, where, what, how, why}",
  "risk_level": "low",
  "chain_local_hash": "sha256_hex",
  "block_hash": "sha256_hex",
  "anchored": false,
  "created_at": "2026-06-14T00:00:00Z"
}
```

**`webrtc_signals`** — P2P 시그널링 임시 저장소
```json
{
  "id": "uuid",
  "from_guid": "2601:db80:...",
  "to_guid": "2601:db80:...",
  "type": "offer | answer | ice",
  "payload": "SDP or ICE candidate",
  "expires_at": "2026-06-14T00:01:00Z"
}
```

**`user_llm_keys`** — LLM API 키 서버 저장 (GDC 사용자)
```json
{
  "guid": "2601:db80:...",
  "provider": "deepseek",
  "model": "deepseek-v4-pro",
  "api_key_enc": "AES-GCM 암호화된 API 키",
  "ai_active": true,
  "custom_prompt": "시스템 프롬프트"
}
```

---

### 11-5. 저장소 간 데이터 흐름

**아이디 등록 시:**
```
사용자 입력 (이름)
  ├─ localStorage['gopang_user_v3'] ← handle, name 추가 저장
  └─ L1 PocketBase ← guid + handle 공식 등록
```

**PDV 기록 시:**
```
사용자 행동 발생
  ├─ localStorage['gopang_pdv_log'] ← 로컬 캐시 (즉시)
  ├─ Supabase/pdv_log ← 클라우드 원장 (비동기)
  ├─ IndexedDB/hash_chain ← 로컬 해시체인 (무결성)
  └─ Supabase/l1_ledger ← L1 앵커 (검증용)
```

**P2P 채팅 시:**
```
메시지 전송
  ├─ WebRTC DataChannel ← 실시간 전송 (서버 경유 없음)
  ├─ IndexedDB/gopang_pdv_chat ← 로컬 영구 보존
  └─ Supabase/webrtc_signals ← 시그널링만 경유 (연결 수립 후 삭제)
```

**로그아웃 시:**
```
gopangLogout()
  ├─ localStorage.clear() ← 사용자 신원·설정·PDV 캐시 전부 삭제
  ├─ sessionStorage.clear()
  └─ SW 캐시 삭제

기기 완전 초기화 (_deviceFullReset) 추가:
  ├─ IndexedDB 삭제 (gopang-wallet, gopang_pdv_chat)
  └─ L1 PocketBase ← 기기 등록 해제 (DELETE)
```

---

## 12. 핵심 저장소 구조

```javascript
// localStorage['gopang_user_v3']

// Guest 상태
{
  ipv6: "2601:db80:xxxx:xxxx:xxxx:xxxx:xxxx:xxxx",
  fpHex: "sha256_hex_string",
  isTemp: true,
  isGuest: true,
  registeredAt: "2026-06-14T00:00:00.000Z"
}

// 등록 사용자
{
  ipv6: "2601:db80:xxxx:xxxx:xxxx:xxxx:xxxx:xxxx",
  fpHex: "sha256_hex_string",
  isTemp: false,
  isGuest: false,
  handle: "@금능#0996",
  name: "금능",
  registeredAt: "2026-06-14T00:00:00.000Z"
}

// GDC 사용자 (추가 필드)
{
  // ...등록 사용자 필드 포함...
  gdcEnabled: true,
  walletPubKey: "ed25519_public_key"
}
```

---

## 13. 테스트 환경에서의 다중 사용자 시뮬레이션

1기기 1사용자 원칙으로 인해 단일 기기에서 다중 사용자 테스트가 제한됩니다.  
**임시 우회 방법**: `localStorage`는 브라우저별로 완전히 분리됩니다.

| 브라우저 | 사용자 |
|----------|--------|
| Chrome 일반 창 | 사용자 A |
| Edge 일반 창 | 사용자 B |
| Chrome 시크릿 창 | 사용자 C |
| Firefox 일반 창 | 사용자 D |
| Opera 일반 창 | 사용자 E |

> ⚠️ 테스트 완료 후 반드시 1기기 1사용자 원칙 코드로 복구할 것.

---

## 14. 관련 파일

| 파일 | 역할 |
|------|------|
| `src/gopang/core/auth.js` | `initAuth()`, `_isRegistered()`, `_registerToL1()` |
| `src/gopang/core/state.js` | `setUser()`, `_USER` 전역 상태 |
| `src/gopang/ui/settings.js` | `openSettings()`, `_updateLogoutBtn()`, `_settingsRegisterHandle()` |
| `webapp.html` | `gopangLogout()`, `_isGuestUser()`, `_updateLogoutBtn()` |
| `auth/subsystem-auth.js` | 하위 시스템용 SSO |
| `gopang-wallet.js` | GDC Wallet, Ed25519 서명 |
