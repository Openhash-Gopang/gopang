# 고팡 분산 사용자 검색 알고리즘 (Gopang Distributed User Discovery)
# GDUDA v1.0
# 작성일: 2026-05-21 | AI City Inc. · 도영민
# 기반: OpenHash Network (5계층 계층적 분산 원장)

---

## 1. 설계 철학

고팡은 카카오톡과 달리 **중앙 DB가 없는 완전 분산형 메시징 시스템**입니다.
각 사용자는 자신의 PDV에 데이터를 저장하며, 사용자 간 직접 통신합니다.

### 참조 알고리즘

| 참조 시스템 | 차용 개념 | 고팡 적용 |
|---|---|---|
| DNS | 계층적 이름 해석 | OpenHash 5계층 → 사용자 ID 해석 |
| Kademlia DHT | XOR 거리 기반 라우팅 | PDV Hash 기반 노드 배정 |
| BGP | 자율 시스템 간 경로 공유 | L1 권역 노드 간 라우팅 테이블 |
| mDNS/Bonjour | 로컬 네트워크 자동 발견 | 동일 L1(읍면동) 내 즉시 발견 |
| STUN/TURN | P2P 연결 중계 | PDV-to-PDV 직접 연결 |

---

## 2. OpenHash 5계층과 사용자 배정

OpenHash 논문(§3.1.1)의 5계층 구조를 그대로 사용자 검색에 활용합니다.

```
L5: 글로벌     (19개 이상 독립 운영 주체)
 │
L4: 국가       (최소 13개 독립 기관)         예) 대한민국
 │
L3: 광역       (17개 광역시도 노드)           예) 제주특별자치도
 │
L2: 시군구     (226개 노드)                  예) 제주시
 │
L1: 읍면동     (~3,500개 × 이중화 = 7,000)   예) 이도1동
     │
     └── 사용자 PDV (개인 단말)
```

### 사용자 글로벌 식별자 (GUID)

```
GOPANG_GUID = SHA-256(고팡ID + 등록주소 + 공개키)[:32]

예) 도영민 (@체제수리공):
    GUID = SHA-256("체제수리공" + "제주시이도1동" + pubkey)
         = "3f7a9b2e..."

계층 주소 (계층 식별자 형식 — OpenHash §3.1.1):
    GLOBAL > KR > KR-JEJU > KR-JEJU-JEJU > KR-JEJU-JEJU-IDO1
```

---

## 3. 사용자 등록 (Registration) — 신규 사용자 Broadcasting

### 3.1 등록 절차 (4단계)

```
신규 사용자 (도영민, 제주시 이도1동)
     │
     │ Step 1. L1 노드 자동 배정
     ▼
┌─────────────────────────────────────────────────────┐
│ L1: 이도1동 노드 (KR-JEJU-JEJU-IDO1)               │
│                                                       │
│  사용자 등록 패킷:                                   │
│  REGISTER {                                           │
│    guid       : "3f7a9b2e...",                       │
│    gopang_id  : "체제수리공",                        │
│    public_key : "ECDSA 공개키",                      │
│    l1_address : "KR-JEJU-JEJU-IDO1",                 │
│    profile    : { name, job, hobby, ... },           │
│    timestamp  : "ISO 8601",                           │
│    signature  : "자기 서명"                          │
│  }                                                    │
└─────────────────────────────────────────────────────┘
     │
     │ Step 2. L1 → L2 → L3 순차 전파 (상향 Broadcasting)
     ▼
┌─────────────────┐   ┌─────────────────┐   ┌──────────────────┐
│ L2: 제주시 노드  │ → │ L3: 제주도 노드  │ → │ L4: 대한민국 노드 │
│ (KR-JEJU-JEJU)  │   │ (KR-JEJU)       │   │ (KR)             │
│                 │   │                 │   │                  │
│ 라우팅 테이블   │   │ 라우팅 테이블   │   │ 라우팅 테이블    │
│ 갱신            │   │ 갱신            │   │ 갱신             │
└─────────────────┘   └─────────────────┘   └──────────────────┘
     │
     │ Step 3. OpenHash 해시체인에 등록 확인 기록
     ▼
┌─────────────────────────────────────────────────────┐
│ OpenHash 블록:                                       │
│  { type: "USER_REGISTER",                           │
│    guid: "3f7a9b2e...",                             │
│    l1_node: "KR-JEJU-JEJU-IDO1",                   │
│    public_key_hash: SHA-256(pubkey),                │
│    timestamp: "...",                                 │
│    prev_hash: "이전 블록 해시" }                    │
└─────────────────────────────────────────────────────┘
     │
     │ Step 4. L1 이웃 노드에 mDNS 스타일 로컬 브로드캐스트
     ▼
    동일 L1 권역 기존 사용자들에게 "새 사용자 등장" 알림
```

### 3.2 Broadcasting 메시지 구조

```json
{
  "type"      : "GOPANG_ANNOUNCE",
  "version"   : "1.0",
  "guid"      : "3f7a9b2e...",
  "gopang_id" : "체제수리공",
  "display"   : "도영민",
  "l1_node"   : "KR-JEJU-JEJU-IDO1",
  "l2_node"   : "KR-JEJU-JEJU",
  "l3_node"   : "KR-JEJU",
  "public_key": "-----BEGIN PUBLIC KEY-----...",
  "profile_hash": "SHA-256(공개 프로필)",
  "ttl"       : 86400,
  "timestamp" : "2026-05-21T14:30:00Z",
  "signature" : "ECDSA(guid+timestamp, private_key)"
}
```

---

## 4. 사용자 검색 알고리즘 (GDUDA)

### 4.1 Kademlia + OpenHash 계층 결합 방식

사용자 검색은 **두 단계**로 이루어집니다:

```
Phase 1: 계층 내 라우팅 (DNS 방식)
  "체제수리공" 검색
       │
       ▼
   내 L1 노드에 질의
       │ 없음
       ▼
   L2 노드에 질의  →  라우팅 테이블에서 GUID 해시 대역 확인
       │ 없음
       ▼
   L3 노드에 질의  →  광역 라우팅 테이블 조회
       │ 없음
       ▼
   L4(국가) / L5(글로벌) 노드에 질의

Phase 2: P2P 직접 연결 (Kademlia 방식)
  목표 사용자의 L1 노드 주소 획득
       │
       ▼
  해당 L1 노드에서 PDV 엔드포인트 획득
       │
       ▼
  직접 P2P 연결 (PDV ↔ PDV)
```

### 4.2 라우팅 테이블 구조 (각 L1 노드)

```
ROUTING_TABLE_L1 {
  local_users: [               // 이 L1 권역 사용자 목록
    { guid, gopang_id, public_key, endpoint, last_seen },
    ...
  ],
  neighbor_l1: [               // 인접 L1 노드 (읍면동 이웃)
    { l1_id, endpoint, user_count },
    ...
  ],
  kbucket: [                   // Kademlia K-bucket (XOR 거리 기반)
    { distance_range, nodes: [...] },
    ...
  ]
}
```

### 4.3 GDUDA 검색 알고리즘 (의사코드)

```
function GDUDA_SEARCH(target_id, requester_l1):

  // Step 1: 로컬 캐시 확인
  if target_id in local_cache:
    return local_cache[target_id]

  // Step 2: 동일 L1 내 직접 검색 (mDNS 방식, ~1ms)
  result = query_l1(requester_l1, target_id)
  if result: return result

  // Step 3: L2 라우팅 테이블 조회 (BGP 방식, ~5ms)
  l2_node = get_parent_l2(requester_l1)
  routing_entry = query_routing_table(l2_node, target_id)

  if routing_entry.l1_node exists:
    // target의 L1 노드를 알고 있음 → 직접 질의
    result = query_l1(routing_entry.l1_node, target_id)
    if result: cache_and_return(result)

  // Step 4: L3 광역 라우팅 조회 (~15ms)
  l3_node = get_parent_l3(l2_node)
  result = kademlia_lookup(l3_node, SHA-256(target_id))
  if result: cache_and_return(result)

  // Step 5: L4/L5 글로벌 조회 (~50ms)
  result = global_lookup(SHA-256(target_id))
  if result: cache_and_return(result)

  return NOT_FOUND
```

---

## 5. 권역 DB 노드 (Regional Index Node)

일부 사용자 또는 기관이 **권역 DB**로 자발적으로 참여할 수 있습니다.
OpenHash 논문의 L1 노드 운영자(읍면동 수준)가 대표적 후보입니다.

### 5.1 권역 DB 역할

```
일반 사용자 PDV          권역 DB 노드 (자원봉사 또는 기관)
┌─────────────┐          ┌─────────────────────────────────┐
│ 자신의 데이터│          │ 해당 권역 사용자 인덱스          │
│만 저장       │          │ (GUID, gopang_id, L1 주소,      │
└─────────────┘          │  공개키, 마지막 접속 시각)       │
                         │                                  │
                         │ 검색 쿼리 처리                   │
                         │ 라우팅 테이블 관리               │
                         │ 신규 사용자 브로드캐스트 중계     │
                         └─────────────────────────────────┘
```

### 5.2 권역 DB 선출 기준 (OpenHash 신뢰 등급 활용)

```
권역 DB 선출 조건:
  1. OpenHash 스테이킹 100 토큰 이상 예치
  2. 연속 온라인 시간 99% 이상 (30일 기준)
  3. 지역 내 최소 50명 사용자 보증
  4. 기관 운영자 (읍면동사무소, 학교, 기업 등) 우선 선출

보상:
  - 검색 쿼리 처리 수수료 (마이크로 페이먼트)
  - OpenHash 네트워크 참여 보상
```

### 5.3 권역 DB 계층 구조

```
L5 글로벌 인덱스      ← 전 세계 사용자 GUID 루트 테이블
     │
L4 국가 인덱스        ← 국가별 사용자 집계
     │
L3 광역 인덱스        ← 광역시도별 (예: 제주도 전체)
     │
L2 시군구 인덱스      ← 시군구별 (예: 제주시 전체)
     │
L1 읍면동 인덱스 ← 권역 DB 노드 ← 실제 사용자 PDV
```

---

## 6. 신규 사용자 등장 시 전체 플로우

```
신규 사용자 "홍길동" (제주시 연동 거주) 가입
     │
     │ 1. 앱 설치 → 키 쌍 생성 (ECDSA)
     │    GUID = SHA-256("홍길동_ID" + "제주시연동" + pubkey)
     │
     ▼
     2. 가장 가까운 L1 노드 자동 탐색
        (GPS 또는 IP 기반 → KR-JEJU-JEJU-YEON)
     │
     ▼
     3. L1 노드에 REGISTER 패킷 전송 + 서명
        → L1 노드가 신원 검증 (서명 확인)
        → 라우팅 테이블에 추가
     │
     ▼
     4. L1 → L2 → L3 → L4 순차 전파
        (각 계층 라우팅 테이블 갱신)
     │
     ▼
     5. OpenHash 블록에 등록 기록
        (위변조 불가 영구 기록)
     │
     ▼
     6. 동일 L1 권역 사용자에게 로컬 브로드캐스트
        "새 사용자: 홍길동 (@길동이야) 가입"
     │
     ▼
     7. 기존 연락처(전화번호, 이름)로 고팡 ID 매핑 제안
        "주소록의 홍길동이 고팡에 가입했습니다."
     │
     ▼
     8. 완료 — PDV간 직접 통신 가능
```

---

## 7. P2P 직접 통신 프로토콜

사용자 검색 완료 후, PDV 간 직접 통신은 다음 방식으로 이루어집니다:

```
PDV-A (도영민)                         PDV-B (홍길동)
     │                                      │
     │ 1. GDUDA로 홍길동 L1 노드 탐색       │
     │ 2. 홍길동 공개키 획득                 │
     │ 3. 메시지 암호화 (공개키)             │
     │────── DIRECT_MESSAGE ──────────────→│
     │    { to: guid_B,                    │
     │      from: guid_A,                  │
     │      payload: 암호화된 메시지,       │
     │      signature: 서명 }              │
     │                                      │
     │                    4. 수신 + 복호화   │
     │                    5. 서명 검증       │
     │                    6. PDV 기록        │
     │←────── ACK + 수신 서명 ─────────────│
```

### 오프라인 사용자 메시지 큐

```
수신자가 오프라인인 경우:
  → 해당 L1 권역 DB 노드에 임시 큐잉
  → 수신자 온라인 시 즉시 전달
  → 72시간 후 미전달 시 자동 삭제 + 발신자 알림
```

---

## 8. 보안 및 프라이버시

### 8.1 프라이버시 보호

```
공개 정보 (L1~L5 라우팅 테이블에 저장):
  - GUID (해시값, 익명)
  - 고팡 ID
  - 공개키
  - L1 노드 주소 (읍면동 수준)

비공개 정보 (PDV에만 저장):
  - 실명, 주소, 전화번호
  - 대화 내용
  - 거래 내역
  - 위치 정보 (정밀)
```

### 8.2 Sybil 공격 방지

```
신규 등록 시 요구사항:
  1. ECDSA 서명 (키 생성 비용)
  2. L1 노드의 신원 검증 (최소 1개 기존 사용자 보증 또는 기관 확인)
  3. OpenHash 스테이킹 (최소 1 토큰 — 스팸 방지)
  4. 이중 등록 방지: GUID 유일성을 L4/L5에서 검증
```

### 8.3 Eclipse 공격 방지

```
- 복수 L1 노드에 동시 등록 (이중화)
- Kademlia K-bucket의 XOR 거리 다양성 유지
- OpenHash ILMV(양방향 계층 검증)로 라우팅 테이블 무결성 감사
```

---

## 9. 성능 추정

| 검색 유형 | 예상 지연 | 방식 |
|---|---|---|
| 동일 L1(읍면동) 내 | ~1ms | mDNS 직접 조회 |
| 동일 L2(시군구) 내 | ~5ms | 라우팅 테이블 직접 조회 |
| 동일 L3(광역) 내 | ~15ms | Kademlia 룩업 |
| 국내 전체 | ~50ms | L4 글로벌 인덱스 |
| 글로벌 | ~100ms | L5 + Kademlia |
| 오프라인 사용자 | 온라인 시 즉시 | L1 메시지 큐 |

---

## 10. OpenHash 네트워크와의 통합 포인트

| 이벤트 | OpenHash 블록 기록 |
|---|---|
| 신규 사용자 등록 | `USER_REGISTER` 블록 |
| 사용자 정보 변경 | `USER_UPDATE` 블록 |
| 탈퇴/비활성화 | `USER_DEACTIVATE` 블록 |
| 권역 DB 선출 | `REGIONAL_DB_ELECT` 블록 |
| 메시지 전달 확인 | `MSG_DELIVERED` 해시 |
| 결제 완료 | `PAYMENT_TX` 블록 |

모든 블록은 SHA-256 해시체인으로 연결되며,
ILMV(양방향 계층 검증)로 위변조를 실시간 감지합니다.

---

## 11. 카카오톡과의 비교

| 항목 | 카카오톡 | 고팡 (GDUDA) |
|---|---|---|
| 데이터 저장 | 중앙 DB (카카오 서버) | 개인 PDV (분산) |
| 사용자 검색 | 중앙 서버 직접 조회 | OpenHash 5계층 라우팅 |
| 브로드캐스트 | 서버 → 클라이언트 | L1→L2→L3 계층 전파 |
| 개인정보 | 카카오 보유 | 사용자 PDV에만 존재 |
| 서버 장애 | 전체 서비스 중단 | L1 이중화로 지속 운영 |
| 검열 | 서버 측 가능 | 원천적으로 불가 |
| 메시지 감청 | 이론상 가능 | E2E 암호화 (공개키) |
| 해시체인 | 없음 | OpenHash 무결성 보장 |
