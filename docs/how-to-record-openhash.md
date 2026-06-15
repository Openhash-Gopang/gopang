# How to Record OpenHash
> 작성일: 2026-06-15 (v2.0 — 사고 실험 반영)
> 저장소: Openhash-Gopang/gopang

---

## 1. 설계 원칙

### 1.1 데이터 단위

| 이벤트 | 앵커링 시점 | 데이터 단위 |
|---|---|---|
| 가입 | 가입 완료 즉시 | 가입 원본 JSON |
| 대화 | 세션 종료 시 (visibilitychange / pagehide) | 세션 전체 (대화 + 거래) |
| 거래 | 거래 완료 즉시 | 거래 원본 JSON |

거래는 재무제표(`extra.fs`)가 변경되는 시점에 즉시 앵커링합니다. 세션 종료를 기다리지 않습니다.

### 1.2 원본과 해시의 분리

```
원본 데이터 → 보관 주체: 사용자
  대화 원본 → vault.js IndexedDB (AES-256-GCM, 기기 내)
  거래 원본 → OpenHash L1 노드 (Supabase 임시 대체)

OpenHash Network → hash만 기록
  contentHash = SHA-256(원본)
  entryHash   = SHA-256(prevHash + contentHash + signatures + blockHeight)
```

검증 시:
```
vault / L1 노드에서 원본 꺼냄
  → SHA-256(원본) 재계산
  → OpenHash entryHash와 대조
```

### 1.3 위변조 방지 — 두 가지 레이어

```
레이어 1: prevHash 체인 (위변조 방지 핵심)
  entryHash_i = SHA-256(prevHash_{i-1} + ...)
  → 과거 기록을 바꾸려면 이후 모든 엔트리를 재계산해야 함
  → OpenHash 전체 노드가 원본 entryHash 보유 → 재계산 불가능

레이어 2: Ed25519 서명 (신원 증명)
  → "누가 이 데이터를 승인했는가"
  → 금액 변조 시 서명 검증 실패 → 즉시 탐지
  → contentHash가 달라지면 서명 불일치
```

### 1.4 wallet = 재무제표 현금 계정

```
user_profiles.extra.fs = {
  'bs-cash':          100,          ← wallet 잔액 (현금 계정)
  'pl-purchase':      0,            ← 지출 누적
  'pl-revenue':       90,           ← 수입 누적
  'last_tx_id':       'TX-abc123',  ← 마지막 거래 식별자
  'last_block_hash':  'e862f1...',  ← OpenHash 앵커
  'last_tx_record':   '{"tx_id"...}', ← 거래 원본 (buyer+seller 서명 포함)
  'last_updated_at':  '2026-06-15T...',
}
```

`last_tx_id` → `fs_ledger` 조회 → 거래 원본 확인  
`last_block_hash` → OpenHash L1 노드에서 앵커 검증

---

## 2. anchor() 인터페이스

```javascript
// src/openhash/hashChain.js
anchor(contentHash, signatures, msgId)

// contentHash: SHA-256(원본 데이터) — 64자 hex
// signatures:  Ed25519 서명 배열 (Base64)
//   가입/대화: [userSig]
//   거래:      [buyerSig, sellerSig]
// msgId:       이벤트 식별자

// entryHash = SHA-256(prevHash + contentHash + signatures.join('|') + blockHeight + timestamp)
```

---

## 3. 이벤트별 구현

### 3.1 가입 (user_register)

```javascript
// src/gopang/core/auth.js — _recordRegisterPdv()

// ① 원본 구성
const regPayload = JSON.stringify({
  type:'user_register', guid, handle, nickname, e164, country_code, ts
});

// ② contentHash = SHA-256(원본)
const contentHash = await sha256(regPayload);

// ③ 사용자 서명 — "나는 이 가입 데이터가 정확함을 서명한다"
const userSig = await gopangWallet.sign(contentHash);

// ④ OpenHash 앵커링
const result = await anchor(contentHash, [userSig], sessionId);
// entryHash = SHA-256(0×64 + contentHash + userSig + blockHeight)
//                      ↑ genesis (첫 번째 이벤트)

// ⑤ extra.fs 초기화
extra.fs = {
  'bs-cash':0, 'pl-purchase':0, 'pl-revenue':0,
  'last_tx_id':null, 'last_block_hash':null, 'last_updated_at':now
}
```

### 3.2 대화 세션 (session_end)

```javascript
// src/gopang/core/session.js — _saveSessionOnce()

// ① 세션 원본 구성 (대화 + 거래 전체)
const sessionData = { sessionId, guid, startedAt, endedAt, domain, turns, messages[] };
const sessionRaw  = JSON.stringify(sessionData);

// ② vault.js — 원본 저장 (IndexedDB AES-256-GCM)
await storeMessage({ msgId:sessionId, content:sessionRaw, ... });

// ③ contentHash = SHA-256(sessionRaw)
const contentHash = await sha256(sessionRaw);

// ④ 사용자 서명
const userSig = await gopangWallet.sign(contentHash);

// ⑤ OpenHash 앵커링
const result = await anchor(contentHash, [userSig], sessionId);
// entryHash = SHA-256(prevHash + contentHash + userSig + blockHeight)
//                      ↑ 이전 이벤트 entryHash (체인 연결)
```

### 3.3 거래 (market_purchase)

```javascript
// worker.js — /biz/order 처리

// ① 거래 원본 구성 (buyer + seller 합의 내용)
const txRecord = JSON.stringify({
  tx_id, buyer_guid, seller_guid, item_name,
  total, fee, seller_net, block_hash, timestamp,
  buyer_sig,    // Ed25519 buyer 서명 (즉시)
  seller_sig,   // Ed25519 seller 사전 서명 (상품 등록 시)
});

// ② L1 노드 기록 → block_hash 반환 (Supabase 임시)
// ③ fs_ledger INSERT (market_purchase RPC)
//    BIVM 검증: Σdebit = Σcredit
//    buyer  debit  total
//    seller credit total - fee(3%)
//    platform credit fee(3%)

// ④ extra.fs 갱신 (양측 모두)
extra.fs = {
  ...,
  'last_tx_id':      tx_id,
  'last_block_hash': block_hash,    // OpenHash 앵커
  'last_tx_record':  txRecord,      // 거래 원본 (buyer+seller 서명 포함)
  'last_updated_at': now,
}
```

---

## 4. 변조 탐지 원리

```
공격자가 금액 12,000 → 1,200으로 변조 시도:

원본:   SHA-256({...total:12000...}) = contentHash_A
변조:   SHA-256({...total:1200...})  = contentHash_B  (다름)

buyer 서명은 contentHash_A에 대한 서명
  verifySignature(contentHash_B, buyerSig) → false ✗

entryHash_A = SHA-256(prevHash + contentHash_A + buyerSig + sellerSig + ...)
변조 재현:   SHA-256(prevHash + contentHash_B + ???   + ???      + ...) → 다른 hash

→ entryHash 재현 불가 → OpenHash 노드의 원본과 불일치 → 변조 탐지
```

---

## 5. Hash Chain 알고리즘

### 5.1 엔트리 해시 공식

```
h_i = SHA-256(h_{i-1} ∥ contentHash ∥ signatures.join('|') ∥ blockHeight ∥ timestamp)

h_{i-1}      = 이전 엔트리 해시 (최초: 0×64)
contentHash  = SHA-256(원본 데이터)
signatures   = Ed25519 서명 배열 (신원 증명)
blockHeight  = Math.floor(Date.now() / 1000)
timestamp    = ISO 8601
```

### 5.2 서명 구조

| 이벤트 | 서명 주체 | 서명 대상 |
|---|---|---|
| 가입 | 사용자 (1명) | contentHash(가입 원본) |
| 대화 | 사용자 (1명) | contentHash(세션 전체) |
| 거래 | buyer + seller (2명) | contentHash(거래 원본) |

seller는 **상품 등록 시 사전 서명**합니다. 거래 시 실시간 서명 불필요.

### 5.3 계층 선택 (PLSM)

```
bucket = doubleSHA256(msgId) mod 1000
L1: 0~599   (60%)  ← 가장 빈번
L2: 600~799 (20%)
L3: 800~899 (10%)
L4: 900~959  (6%)
L5: 960~999  (4%)  ← 글로벌
```

### 5.4 Merkle 배치

```
1시간마다:
  대기 엔트리 해시 수집
  → Merkle Root = buildMerkleRoot(hashes)
  → 메인넷 블록 1개에 Root만 기록
  → Root 하나로 배치 내 모든 엔트리 포함 증명 가능
```

---

## 6. 구현 파일

| 파일 | 역할 |
|---|---|
| `src/openhash/hashChain.js` | `anchor(contentHash, signatures[], msgId)` |
| `src/openhash/plsm.js` | 확률적 계층 선택 |
| `src/openhash/bivm.js` | 거래 Σδ=0 검증 |
| `src/pdv/keyManager.js` | Ed25519 서명/검증, SHA-256 |
| `src/pdv/vault.js` | 대화 원본 IndexedDB 저장 |
| `src/gopang/core/auth.js` | 가입 앵커링 (`_recordRegisterPdv`) |
| `src/gopang/core/session.js` | 대화 앵커링 (`_saveSessionOnce`) |
| `worker.js` | 거래 앵커링 + extra.fs 추적 갱신 |
| `src/tests/phase_anchor_integration.test.js` | 통합 테스트 A-01~A-12 |

---

## 7. 테스트 실행

```powershell
node --experimental-vm-modules src/tests/phase_anchor_integration.test.js
```

| ID | 검증 내용 |
|---|---|
| A-01 | 가입 — contentHash + userSig → entryHash 64자 |
| A-02 | 가입 — 최초 prevHash = 0×64 (genesis) |
| A-03 | signatures=[] → 오류 발생 |
| A-04 | 대화 세션 — contentHash + userSig → entryHash |
| A-05 | 대화 2세션 — prevHash 체인 연결 |
| A-06 | 대화 원본 재현 — SHA-256(원본) == contentHash |
| A-07 | 거래 — buyer + seller 양방 서명 → entryHash |
| A-08 | 거래 변조 탐지 — 금액 변조 시 서명 검증 실패 |
| A-09 | BIVM Σδ=0 — 거래 금액 보전 |
| A-10 | extra.fs last_tx_id → 거래 원본 재현 |
| A-11 | 가입→대화→거래 3단계 prevHash 체인 연결 |
| A-12 | Merkle Root + 체인 무결성 전체 통과 |

---

## 8. 전체 흐름

```
[가입]
  regPayload → SHA-256 → contentHash
  gopangWallet.sign(contentHash) → userSig
  anchor(contentHash, [userSig]) → entryHash_1
  extra.fs 초기화 { bs-cash:0, last_tx_id:null, ... }

[대화 세션]
  sessionData(대화+거래 원문) → vault.js(IndexedDB 암호화 저장)
  SHA-256(sessionData) → contentHash
  gopangWallet.sign(contentHash) → userSig
  anchor(contentHash, [userSig]) → entryHash_2
    prevHash = entryHash_1

[거래]
  txRecord(buyer_sig+seller_sig 포함) → L1 노드 저장
  SHA-256(txRecord) = contentHash (worker.js의 block_hash가 역할 수행)
  fs_ledger INSERT (BIVM 검증: Σdebit=Σcredit)
  extra.fs 갱신 { bs-cash:new, last_tx_id, last_block_hash, last_tx_record }

[Merkle 배치, 1시간]
  buildMerkleRoot([entryHash_1, entryHash_2, ...]) → Root
  메인넷 블록 기록
```
