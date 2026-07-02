# How to Record OpenHash
> 작성일: 2026-06-15 (v3.0 — 저장소 역할 명확화)
> 저장소: Openhash-Gopang/gopang

---

## 1. 저장소 역할 정의

```
┌─────────────────────────────────────────────────────────────────┐
│  사용자 기기 (IndexedDB / vault.js)                              │
│                                                                  │
│  원본 데이터 보관 주체 = 사용자 본인                              │
│    - 대화 원문 (AES-256-GCM 암호화)                              │
│    - 거래 원문 (buyer + seller 서명 포함)                        │
│    - 가입 원문                                                   │
│    - Hash Chain (entryHash 목록)                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │ SHA-256(원문) = contentHash
                           │ Ed25519 서명
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│  OpenHash L1 PocketBase (l1-hanlim.hondi.net)                  │
│                                                                  │
│  Hash 기록 주체 = OpenHash Network                               │
│    - entryHash (= SHA-256(prevHash + contentHash + sigs + ...))  │
│    - block_hash                                                  │
│    - merkle_root (1시간 배치)                                    │
│    - l1_ledger (거래 체인)                                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │ 백업
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│  Supabase (임시 백업 / 검색 인덱스)                              │
│                                                                  │
│  백업 및 검색 보조                                               │
│    - user_profiles   ← 사용자 공개 정보 + extra.fs               │
│    - global_profiles ← GDUDA 닉네임 검색 인덱스                  │
│    - pdv_log         ← entryHash 사본 (원문 없음)                │
│    - webrtc_signals  ← P2P 시그널링 (휘발성)                     │
│    - l1_ledger       ← 거래 block_hash 사본                      │
│    - merkle_anchors  ← Merkle Root 사본                          │
└─────────────────────────────────────────────────────────────────┘
```

### 핵심 원칙

| 항목 | 보관 위치 | 내용 |
|---|---|---|
| 원본 데이터 | 사용자 기기 IndexedDB | 대화/거래/가입 원문, AES-256-GCM 암호화 |
| Hash | OpenHash L1 PocketBase | entryHash, block_hash, merkle_root |
| 백업 | Supabase | Hash 사본, 검색 인덱스 |
| 원문은 서버에 없음 | — | OpenHash Network은 Hash만 기록 |

---

## 2. 설계 원칙

### 2.1 데이터 단위

| 이벤트 | 앵커링 시점 | 데이터 단위 |
|---|---|---|
| 가입 | 가입 완료 즉시 | 가입 원본 JSON |
| 대화 | 세션 종료 시 (visibilitychange / pagehide) | 세션 전체 (대화 내용) |
| 거래 | 거래 완료 즉시 | 거래 원본 JSON |

거래는 재무제표(`extra.fs`)가 변경되는 시점에 즉시 앵커링합니다.

### 2.2 위변조 방지 — 두 가지 레이어

```
레이어 1: prevHash 체인 (위변조 방지 핵심)
  entryHash_i = SHA-256(prevHash_{i-1} + contentHash + sigs + blockHeight)
  → 과거 기록 변조 시 이후 모든 entryHash 재계산 필요
  → L1 노드 전체가 원본 entryHash 보유 → 재계산 불가

레이어 2: Ed25519 서명 (신원 증명)
  → "누가 이 데이터를 승인했는가"
  → 금액 변조 시 contentHash 변경 → 서명 불일치 → 즉시 탐지
```

### 2.3 wallet = 재무제표 현금 계정

```javascript
// user_profiles.extra.fs (Supabase 백업)
// 원본은 사용자 기기 vault.js에 보관
{
  'bs-cash':          100,          // wallet 잔액 (현금 계정)
  'pl-purchase':      0,            // 지출 누적
  'pl-revenue':       90,           // 수입 누적
  'last_tx_id':       'TX-abc123',  // 마지막 거래 식별자
  'last_block_hash':  'e862f1...',  // L1 PocketBase 앵커
  'last_tx_record':   '{"tx_id"...}', // 거래 원본 (buyer+seller 서명)
  'last_updated_at':  '2026-06-15T...',
}
```

---

## 3. anchor() 인터페이스

```javascript
// src/openhash/hashChain.js
anchor(contentHash, signatures, msgId)

// contentHash: SHA-256(원본 데이터) — 64자 hex
//              원본은 vault.js(IndexedDB)에 보관
// signatures:  Ed25519 서명 배열 (Base64)
//   가입/대화: [userSig]             — 사용자 단방향 서명
//   거래:      [buyerSig, sellerSig] — 양방 서명
// msgId:       이벤트 식별자

// entryHash = SHA-256(prevHash + contentHash + signatures.join('|') + blockHeight + timestamp)
// → L1 PocketBase에 기록
// → Supabase pdv_log에 백업
```

---

## 4. 이벤트별 구현

### 4.1 가입 (user_register)

```javascript
// src/gopang/core/auth.js — _recordRegisterPdv()

// ① 원본 구성
const regPayload = JSON.stringify({
  type:'user_register', guid, handle, nickname, e164, country_code, ts
});

// ② vault.js — 원본 저장 (IndexedDB, 기기 내)
await storeMessage({ msgId:sessionId, content:regPayload, ... });

// ③ contentHash = SHA-256(원본)
const contentHash = SHA-256(regPayload);

// ④ Ed25519 서명
const userSig = await gopangWallet.sign(contentHash);

// ⑤ L1 PocketBase 앵커링
const result = await anchor(contentHash, [userSig], sessionId);
// entryHash → L1 PocketBase 기록
// entryHash → Supabase pdv_log 백업

// ⑥ extra.fs 초기화 (Supabase 백업)
extra.fs = { 'bs-cash':0, 'pl-purchase':0, 'pl-revenue':0,
             'last_tx_id':null, 'last_block_hash':null }
```

### 4.2 대화 세션 (session_end)

```javascript
// src/gopang/core/session.js — _saveSessionOnce()

// ① 세션 원본 구성 (대화 전체)
const sessionData = { sessionId, guid, startedAt, endedAt, domain, turns, messages[] };
const sessionRaw  = JSON.stringify(sessionData);

// ② vault.js — 원본 저장 (IndexedDB, 기기 내)  ← 원본 보관 주체
await storeMessage({ msgId:sessionId, content:sessionRaw, ... });

// ③ contentHash = SHA-256(sessionRaw)
const contentHash = SHA-256(sessionRaw);

// ④ Ed25519 서명
const userSig = await gopangWallet.sign(contentHash);

// ⑤ L1 PocketBase 앵커링
const result = await anchor(contentHash, [userSig], sessionId);
// entryHash → L1 PocketBase 기록
// entryHash → Supabase pdv_log 백업 (사본)

// 검증 시:
//   vault.js에서 원본 꺼냄 → SHA-256 재계산 → L1 entryHash 대조
```

### 4.3 거래 (market_purchase)

```javascript
// worker.js — /biz/order

// ① 거래 원본 (양측 합의 내용)
const txRecord = JSON.stringify({
  tx_id, buyer_guid, seller_guid, item_name,
  total, fee, seller_net, timestamp,
  buyer_sig,   // Ed25519 buyer 즉시 서명
  seller_sig,  // Ed25519 seller 사전 서명 (상품 등록 시)
});

// ② contentHash = SHA-256(txRecord)
// ③ L1 PocketBase → block_hash 반환
// ④ fs_ledger INSERT (BIVM 검증: Σdebit = Σcredit)
// ⑤ extra.fs 갱신 (Supabase 백업)
extra.fs = {
  'bs-cash':         newBalance,
  'last_tx_id':      tx_id,
  'last_block_hash': block_hash,    // L1 PocketBase 앵커
  'last_tx_record':  txRecord,      // 원본 (buyer+seller 서명 포함)
  'last_updated_at': now,
}
// 거래 원본은 buyer/seller 각자의 vault.js에도 저장
```

---

## 5. Hash Chain 알고리즘

### 5.1 엔트리 해시 공식

```
h_i = SHA-256(h_{i-1} ∥ contentHash ∥ signatures.join('|') ∥ blockHeight ∥ timestamp)

h_{i-1}      = 이전 엔트리 해시 (최초: 0×64)  ← L1 PocketBase에서 조회
contentHash  = SHA-256(원본)                   ← 원본은 vault.js 보관
signatures   = Ed25519 서명 배열              ← 신원 증명
blockHeight  = Math.floor(Date.now() / 1000)
timestamp    = ISO 8601
```

### 5.2 서명 구조

| 이벤트 | 서명 주체 | 서명 대상 |
|---|---|---|
| 가입 | 사용자 (1명) | SHA-256(가입 원본) |
| 대화 | 사용자 (1명) | SHA-256(세션 전체) |
| 거래 | buyer + seller (2명) | SHA-256(거래 원본) |

seller는 **상품 등록 시 사전 서명**. 거래 시 실시간 서명 불필요.

### 5.3 계층 선택 (PLSM)

```
bucket = doubleSHA256(msgId) mod 1000

L1: 0~599   (60%)  ← l1-hanlim.hondi.net (현재 운영 중)
L2: 600~799 (20%)  ← 추후 운영
L3: 800~899 (10%)  ← 추후 운영
L4: 900~959  (6%)  ← 추후 운영
L5: 960~999  (4%)  ← 추후 운영 (글로벌)
```

현재는 L1만 운영 중. L2~L5는 dev 환경에서 `entry.anchored = true` 즉시 처리.

### 5.4 Merkle 배치

```
1시간마다 L1 PocketBase cron:
  미앵커링 entryHash 수집
  → Merkle Root = buildMerkleRoot(hashes)
  → L1 PocketBase merkle_anchors 기록
  → Supabase merkle_anchors 백업
  → pdv_log openhash_anchored = true 갱신
```

---

## 6. 변조 탐지 원리

```
공격자가 금액 12,000 → 1,200으로 변조 시도:

원본:   SHA-256({...total:12000...}) = contentHash_A
변조:   SHA-256({...total:1200...})  = contentHash_B  (다름)

buyer 서명 = sign(contentHash_A)
  verifySignature(contentHash_B, buyerSig) → false ✗

entryHash_A = SHA-256(prevHash + contentHash_A + buyerSig + sellerSig + ...)
변조 재현:   SHA-256(prevHash + contentHash_B + ???) → 다른 hash

L1 PocketBase 원본 entryHash_A와 불일치 → 변조 탐지
```

---

## 7. 구현 파일

| 파일 | 역할 |
|---|---|
| `src/openhash/hashChain.js` | `anchor()` — entryHash 생성 + L1 제출 |
| `src/openhash/plsm.js` | 확률적 계층 선택 |
| `src/openhash/bivm.js` | 거래 Σδ=0 검증 |
| `src/pdv/keyManager.js` | Ed25519 서명/검증, SHA-256 |
| `src/pdv/vault.js` | **원본 보관** — IndexedDB AES-256-GCM |
| `src/gopang/core/auth.js` | 가입 앵커링 (`_recordRegisterPdv`) |
| `src/gopang/core/session.js` | 대화 앵커링 (`_saveSessionOnce`) |
| `worker.js` | 거래 앵커링 + extra.fs 추적 |
| `src/tests/phase_anchor_integration.test.js` | 통합 테스트 A-01~A-12 |

---

## 8. 테스트 실행

```powershell
node --experimental-vm-modules src/tests/phase_anchor_integration.test.js
```

---

## 9. 전체 흐름

```
[가입]
  원본 → vault.js (IndexedDB, 기기 내 보관)
  SHA-256(원본) + userSig
    → hashChain.anchor()
      → L1 PocketBase (entryHash 기록)
      → Supabase pdv_log (백업)
  extra.fs 초기화 { bs-cash:0 } → Supabase 백업

[대화 세션 종료]
  원본(대화 전체) → vault.js (IndexedDB, 기기 내 보관)
  SHA-256(원본) + userSig
    → hashChain.anchor()
      → L1 PocketBase (entryHash 기록, prevHash 연결)
      → Supabase pdv_log (백업)

[거래]
  원본(buyer+seller 서명 포함) → 각자의 vault.js
  → L1 PocketBase (block_hash 기록)
  → fs_ledger (BIVM 검증)
  → extra.fs 갱신 { last_tx_id, last_block_hash } → Supabase 백업

[Merkle 배치, 1시간]
  L1 PocketBase cron
    → buildMerkleRoot(entryHash들)
    → L1 merkle_anchors 기록
    → Supabase 백업

[검증]
  vault.js에서 원본 꺼냄
  → SHA-256(원본) 재계산
  → L1 PocketBase entryHash 대조
  → 일치하면 원본 무결성 증명
```

---

## 10. Supabase vs L1 PocketBase 역할 비교

| 항목 | L1 PocketBase | Supabase |
|---|---|---|
| 목적 | OpenHash 앵커 기록 (본질) | 백업 + 검색 인덱스 (보조) |
| 저장 내용 | entryHash, block_hash, merkle_root | Hash 사본, 공개 프로필 |
| 원문 저장 | ❌ (Hash만) | ❌ (Hash만) |
| 사용자 검색 | ❌ | ✅ (global_profiles) |
| P2P 시그널링 | ❌ | ✅ (webrtc_signals, 휘발성) |
| 운영 상태 | ✅ l1-hanlim.hondi.net | ✅ ebbecjfrwaswbdybbgiu.supabase.co |
| 장기 목표 | L1~L5 분산 노드 | 점진적 축소 |
