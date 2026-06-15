# GDUDA P2P 설계 결론
> 작성일: 2026-06-15 (v1.2 수정 — 전화번호 온보딩 반영)
> 저장소: Openhash-Gopang/gopang
> 관련 문서: gopang-id-auth-guide.md (GDUDA v1.0, GAS v1.6)

---

## 1. 문제 정의

@12345678(홍길동, KR/한림읍)이 제임스(US/New York)를 검색하고 P2P 연결하려 한다.

@12345678이 아는 정보:
- 닉네임: "James"
- 핸들: "@US-1234567890" (전세계 유일)

> **원칙: 검색은 닉네임(키워드)으로, 연결/인증은 handle(유일 식별자)로.**
> nickname은 동명이인 가능. handle은 전세계 유일 보장.

---

## 2. handle → GUID 로컬 계산

handle에서 E.164를 추출하면 GUID를 서버 없이 로컬 계산 가능.

```
handle: "@US-1234567890"
  └─ 파싱: country=US, digits=1234567890
  └─ E.164: +11234567890
  └─ GUID = SHA-256('gopang-phone:+11234567890') → IPv6
```

**단, GUID를 알아도 어느 L1 노드에 있는지는 알 수 없다.**

---

## 3. 핵심 설계: DHT 인덱스 노드 = HLR

이동통신의 HLR/VLR 구조를 적용한다.

| 이동통신 | OpenHash |
|----------|----------|
| HLR (Home Location Register) | DHT 인덱스 노드 |
| VLR (Visitor Location Register) | 현재 접속 중인 L1 노드 |
| 전화번호 | GUID |
| 기지국 | L1 노드 |

### DHT 인덱스 노드 저장 구조 (HLR 역할)

```javascript
{
  guid:          '2601:db80::xxxx',        // 불변 식별자
  handle:        '@US-1234567890',         // 전세계 유일 식별자
  nickname:      'James',                  // 검색용 평문
  nickname_hash: SHA-256('en:James'),      // DHT 라우팅 키
  current_l1:    'manhattan-01.gopang.net',// 현재 접속 L1 ← 단말 이동 시 갱신
  country_code:  'US',
  region:        'New York',
  updated_at:    timestamp
}
```

- `nickname_hash`가 DHT 라우팅 키 → 어느 인덱스 노드가 담당인지 수학적 결정
- `current_l1`은 단말 이동 시마다 갱신 (VLR 개념)
- 스마트폰이 어디로 이동해도 인덱스 노드가 현재 위치 추적

### 두 종류의 L1 혼동 주의

```
① DHT 인덱스 노드  = 114 안내 서버 (nickname_hash 기반, 검색용)
② 접속 중인 L1     = 실제 기지국 (단말 현재 위치, 연결용)
```

거주지 기반 L1은 고정 등록 의미 없음 (스마트폰은 이동). 인덱스 노드가 `current_l1`을 추적하는 것이 현실적.

---

## 4. 전체 흐름

### 가입 시 (전화번호 온보딩, gopang-id-auth-guide.md §4.2)

```
@US-1234567890 (James) 첫 접속
  ├─ 전화번호 입력: +11234567890
  ├─ GUID = SHA-256('gopang-phone:+11234567890') → IPv6 (로컬 계산)
  ├─ handle = '@US-1234567890'
  ├─ gopangWallet.create() → Ed25519 키페어 자동 생성
  ├─ localStorage['gopang_user_v4'] 저장
  ├─ POST /p2p/register → DHT 인덱스 노드(global_profiles) 등록
  │    { guid, handle: '@US-1234567890', nickname: 'James',
  │      nickname_hash, current_l1, region, country_code: 'US' }
  └─ 현재 접속 L1에 단말 등록
```

### 검색 흐름 (@12345678 → @US-1234567890)

```
[Step 1: 닉네임 검색]
@12345678 → SHA-256('en:James') → DHT 라우팅
  └─ 담당 인덱스 노드 조회
       └─ 결과: [
            { handle: '@US-1234567890', nickname: 'James',
              region: 'New York', country_code: 'US',
              current_l1: 'manhattan-01.gopang.net' },
            { handle: '@US-9876543210', nickname: 'James',
              region: 'Los Angeles', ... },
            ...  ← 동명이인 다수
          ]

[Step 2: handle 선택 (동명이인 필터)]
상세 필터: country=US, region=New York
  └─ '@US-1234567890' 선택 (전세계 유일)

[Step 3: GUID 로컬 계산]
handle '@US-1234567890' → E.164 → GUID (서버 불필요)

[Step 4: P2P 연결]
from: '@12345678'
to:   '@US-1234567890'
  └─ current_l1 'manhattan-01.gopang.net' → James 단말 연결
```

### 연결 요청 패킷

```javascript
{
  from_handle: '@12345678',           // 전세계 유일 — 발신자 신원
  from_guid:   '2601:db80::aaaa',
  to_handle:   '@US-1234567890',      // 전세계 유일 — 수신자 신원
  to_guid:     '2601:db80::xxxx',
  type:        'offer',
  payload:     { sdp: '...' }         // WebRTC SDP
}
```

### 단말 이동 시

```
@US-1234567890 (James) 스마트폰: 뉴욕 → 시카고 이동
  └─ 새 L1 접속
       └─ DHT 인덱스 노드 current_l1 갱신
            └─ @12345678이 검색하면 항상 최신 위치 획득
```

---

## 5. nickname_hash 설계 (GDUDA v2, §7.3)

언어코드 포함으로 검색 범위 최적화:

```
nickname_hash = SHA-256('언어코드:닉네임')

예)
  SHA-256('ko:홍길동')    → KR L4 노드 집중 탐색
  SHA-256('en:James')    → 영어권 L5 글로벌 탐색
  SHA-256('ja:ジェームズ') → JP L4 노드 집중 탐색
```

---

## 6. 동명이인 처리

```
"James" 검색 결과 다수 → 상세 필터
  ├─ 국가: USA
  ├─ 지역: New York
  └─ 그래도 다수 → handle 직접 입력 (@US-XXXXXXXXXX)
```

결과 카드 표시 (handle이 유일 식별자):
```
🇺🇸 James              @US-123456...  ← handle = 전세계 유일
     New York, USA
                       [연결 요청]
```

연결 요청 시 표시 이름이 아닌 **handle 기준으로 송수신** → 오인 방지.

---

## 7. 현재 임시 구현 계획

L2~L5 노드 미운영 상태이므로 임시 대체:

| OpenHash 계층 | 임시 구현 |
|--------------|----------|
| DHT 인덱스 노드 | Supabase `global_profiles` 테이블 |
| current_l1 갱신 | 앱 접속 시 `/p2p/register` upsert |
| DHT 라우팅 | Supabase `nickname_hash` 인덱스 조회 |

### global_profiles 스키마 (확정)

```sql
CREATE TABLE global_profiles (
  guid          TEXT PRIMARY KEY,
  handle        TEXT UNIQUE NOT NULL,  -- 전세계 유일 식별자
  nickname      TEXT,                  -- 평문 (검색용, 동명이인 가능)
  nickname_hash TEXT,                  -- SHA-256('언어코드:닉네임')
  country_code  TEXT,                  -- 'KR', 'US', ...
  region        TEXT,                  -- 'New York', '제주도', ...
  current_l1    TEXT,                  -- 현재 접속 L1 URL (HLR)
  l1_updated_at TIMESTAMPTZ,
  is_public     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ON global_profiles (nickname_hash);
CREATE INDEX ON global_profiles (nickname);
CREATE INDEX ON global_profiles (country_code);
```

---

## 8. 구현 완료 / 진행 중

| 단계 | 상태 | 내용 |
|------|------|------|
| Step 0 | ⏳ | gopang-app.js — 전화번호 온보딩 UI 구현 (기존 얼굴/시드 흐름 대체) |
| Step 1 | ✅ | Supabase `global_profiles` 테이블 생성 |
| Step 2-A | ✅ | CF Worker `/p2p/register` 엔드포인트 추가 |
| Step 2-B | 🔄 | auth.js — 가입 시 `/p2p/register` 호출 (전화번호 온보딩과 통합) |
| Step 3 | ⏳ | `search.js` — 닉네임 검색 UI + 상세 필터 |
| Step 4 | ⏳ | CF Worker — `/p2p/search` 엔드포인트 |
| Step 5 | ⏳ | `p2p.js` — 연결 요청/수락/채팅 |
| Step 6 | ⏳ | WebRTC 시그널링 (`webrtc_signals` 기존 구현 활용) |
| Step 7 | ⏳ | P2P 채팅 채널 개설 |
| Step 8 | ⏳ | 테스트 — 브라우저 2개, 사용자 2명 |

---

## 9. 용어 정리

| 용어 | 정의 |
|------|------|
| handle | `@12345678` (KR) / `@US-1234567890` (비KR) — **전세계 유일** 식별자 |
| nickname | '홍길동', 'James' — 표시 이름, 동명이인 가능, 검색 키워드 |
| DHT 인덱스 노드 | nickname_hash 기반 Kademlia 담당 노드 (검색용) |
| current_l1 | 단말이 현재 접속 중인 L1 노드 URL (연결용) |
| HLR | Home Location Register — 이동통신 가입자 위치 추적 DB |
| VLR | Visitor Location Register — 현재 접속 기지국 |
| nickname_hash | SHA-256('언어코드:닉네임') — DHT 라우팅 키 |
| GUID | handle로부터 로컬 계산 — 라우팅에 사용 |
| GDUDA | Gopang Distributed User Discovery Algorithm |
| GAS | Gopang Address System |

---

## 10. webrtc.js vs p2p-chat.js 비교

### 배경

고팡에는 두 개의 WebRTC 구현이 공존합니다.

| 항목 | `src/gopang/p2p/webrtc.js` | `src/gopang/ui/p2p-chat.js` |
|------|---------------------------|------------------------------|
| 도입 시기 | 기존 (v3.0 이전) | 신규 (GDUDA Phase 1) |
| 식별자 | `_peer` (프로필 객체) | handle (전세계 유일) |
| 발신자 확인 | `/profile?guid=` 조회 | `from_handle` (시그널 payload 포함) |
| 검색 연동 | 없음 (직접 setPeer) | `p2p-search.js` → 닉네임 검색 |
| 수신 처리 | `_handleSignal()` → `_handleOffer()` | `handleIncomingOffer()` |
| 폴링 시작 | `_startSignalPoll()` (gopang-app.js 4-8) | `startIncomingWatch()` (gopang-app.js 4-8) |
| 채팅 UI | 기존 채팅 UI (웹앱 내장) | `_openChatUI()` (풀스크린 오버레이) |

---

### 충돌 문제

두 모듈이 동시에 `/signal/poll`을 폴링하므로 동일한 offer를 중복 처리:

```
기존 webrtc.js._startSignalPoll
  └─ offer 수신 → /profile?guid= 조회 (404) → 실패

신규 p2p-chat.js.startIncomingWatch
  └─ offer 수신 → handleIncomingOffer() → 정상 처리
```

---

### 현재 구현 방식 (임시 해결)

기존 `webrtc.js`의 offer 처리를 비활성화하고 신규 `p2p-chat.js`가 전담:

```javascript
// webrtc.js — offer 처리 비활성화
if (false && sig.type === 'offer' && !_peer) { // p2p-chat.js로 이전
  ...
}
```

```
폴링 담당:
  webrtc.js._startSignalPoll  → answer/ice 처리 (기존 역할 유지)
  p2p-chat.js.startIncomingWatch → offer 처리 (신규)
```

---

### 향후 방향 (Phase 2)

기존 `webrtc.js`를 `p2p-chat.js`로 완전 통합하고 단일 폴링으로 일원화:

```
p2p-chat.js (통합)
  ├─ offer  → handleIncomingOffer()
  ├─ answer → conn.setRemoteDescription()
  └─ ice    → conn.addIceCandidate()
```

`webrtc.js`는 하위 호환성을 위해 유지하되 로직은 비활성화.
