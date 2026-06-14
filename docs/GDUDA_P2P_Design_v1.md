# GDUDA P2P 설계 결론
> 작성일: 2026-06-15
> 저장소: Openhash-Gopang/gopang
> 관련 문서: gopang-id-auth-guide.md (GDUDA v1.0, GAS v1.6)

---

## 1. 문제 정의

홍길동(KR/한림읍)이 제임스(US/New York)를 검색하고 P2P 연결하려 한다.

홍길동이 아는 정보:
- 이름: "James"
- 핸들: "@US-1234567890"

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

### DHT 인덱스 노드 (HLR 역할)

```javascript
{
  guid:         '2601:db80::xxxx',   // 불변 식별자
  nickname_hash: SHA-256('en:James'), // DHT 라우팅 키
  current_l1:   'manhattan-01.gopang.net', // 현재 접속 L1 ← 갱신됨
  updated_at:   timestamp
}
```

- `nickname_hash`가 DHT 라우팅 키 → 어느 인덱스 노드가 담당인지 수학적 결정
- `current_l1`은 단말 이동 시마다 갱신 (VLR 개념)
- 스마트폰이 어디로 이동해도 인덱스 노드가 현재 위치 추적

### 두 종류의 L1 혼동 주의

```
① DHT 인덱스 노드  = 114 안내 서버 (nickname_hash 기반, 검색용)
② 거주지/접속 L1   = 실제 기지국 (단말 현재 위치, 연결용)
```

거주지 기반 L1은 고정 등록 의미 없음 (스마트폰은 이동). 인덱스 노드가 `current_l1`을 추적하는 것이 현실적.

---

## 4. 전체 흐름

### 가입 시

```
James 가입
  ├─ nickname_hash = SHA-256('en:James') → DHT 인덱스 노드 등록
  │    { guid, nickname_hash, current_l1, handle, region }
  └─ 현재 접속 L1에 단말 등록
```

### 검색 흐름 (홍길동 → 제임스)

```
[Step 1: 닉네임 검색]
홍길동 → SHA-256('en:James') → DHT 라우팅
  └─ 담당 인덱스 노드 조회
       └─ 결과: { guid, current_l1: 'manhattan-01.gopang.net', handle }

[Step 2: handle 검증]
handle '@US-1234567890' → 로컬 계산 → GUID
  └─ Step 1 결과 GUID와 대조 → 본인 확인

[Step 3: P2P 연결]
current_l1 'manhattan-01.gopang.net' → James 단말 연결
```

### 단말 이동 시

```
James 스마트폰: 뉴욕 → 시카고 이동
  └─ 새 L1 접속
       └─ DHT 인덱스 노드 current_l1 갱신
            └─ 홍길동이 검색하면 항상 최신 위치 획득
```

---

## 5. nickname_hash 설계 (GDUDA v2, §7.3)

언어코드 포함으로 검색 범위 최적화:

```
nickname_hash = SHA-256('언어코드:닉네임')

예)
  SHA-256('ko:홍길동')  → KR L4 노드 집중 탐색
  SHA-256('en:James')  → 영어권 L5 글로벌 탐색
  SHA-256('ja:ジェームズ') → JP L4 노드 집중 탐색
```

---

## 6. 동명이인 처리

검색 결과 다수일 경우 상세 필터:

```
"James" 검색
  └─ 다수 결과 → 상세 필터
       ├─ 국가: USA
       ├─ 지역: New York
       └─ 그래도 다수 → handle 직접 입력 (@US-XXXXXXXXXX)
```

결과 카드 표시:
```
🇺🇸 James          @US-123456...
     New York, USA
                   [연결 요청]
```

---

## 7. 현재 임시 구현 계획

L2~L5 노드 미운영 상태이므로 임시 대체:

| OpenHash 계층 | 임시 구현 |
|--------------|----------|
| DHT 인덱스 노드 | Supabase `global_profiles` 테이블 |
| current_l1 갱신 | 앱 접속 시 Supabase upsert |
| DHT 라우팅 | Supabase `nickname_hash` 인덱스 조회 |

### global_profiles 스키마 (확정)

```sql
CREATE TABLE global_profiles (
  guid          TEXT PRIMARY KEY,
  handle        TEXT UNIQUE NOT NULL,
  nickname      TEXT,                    -- 평문 (검색용)
  nickname_hash TEXT,                    -- SHA-256('언어코드:닉네임')
  country_code  TEXT,                    -- 'KR', 'US', ...
  region        TEXT,                    -- 'New York', '제주도', ...
  current_l1    TEXT,                    -- 현재 접속 L1 URL (HLR)
  l1_updated_at TIMESTAMPTZ,
  is_public     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ON global_profiles (nickname_hash);
CREATE INDEX ON global_profiles (nickname);
CREATE INDEX ON global_profiles (country_code);
```

---

## 8. 다음 구현 단계

1. Supabase `global_profiles` 테이블 생성
2. auth.js — 가입 시 `global_profiles` 자동 등록
3. `search.js` — 닉네임 검색 UI + 상세 필터
4. CF Worker — `/p2p_search`, `/p2p_connect` 엔드포인트
5. `p2p.js` — 연결 요청/수락/채팅

---

## 9. 용어 정리

| 용어 | 정의 |
|------|------|
| DHT 인덱스 노드 | nickname_hash 기반 Kademlia 담당 노드 (검색용) |
| current_l1 | 단말이 현재 접속 중인 L1 노드 URL (연결용) |
| HLR | Home Location Register — 이동통신 가입자 위치 추적 DB |
| VLR | Visitor Location Register — 현재 접속 기지국 |
| nickname_hash | SHA-256('언어코드:닉네임') — DHT 라우팅 키 |
| GDUDA | Gopang Distributed User Discovery Algorithm |
| GAS | Gopang Address System |
