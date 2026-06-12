# hash_synchronization.md
**GWP_DONE block_hash 동기화 — 사고 실험 및 근본 해결 분석**  
AI City Inc. 팀 주피터 | 2026-06-11

---

## 1. 문제 정의

### 1.1 증상

짜장면 첫 번째 주문은 L1 검증을 통과한다. 두 번째 주문부터 항상 **409 STALE_STATE**로 실패한다.

### 1.2 불변 조건

거래 N이 성공한 후 거래 N+1이 성공하려면 반드시 아래 조건이 성립해야 한다.

```
wallet IndexedDB financial_state.block_hash
    === L1 blocks 컬렉션 최신 블록의 content_hash
```

이 조건이 깨지는 순간 L1 3단계 검증이 거부한다.

### 1.3 핵심 질문

거래가 완료된 후, L1이 발급한 `content_hash`(= `block_hash`)가 wallet IndexedDB에 자동으로 갱신되는가?

---

## 2. 시스템 구성 및 hash 흐름

### 2.1 모듈별 hash 저장 위치

| 모듈 | 저장 위치 | 값 | 역할 |
|---|---|---|---|
| L1 PocketBase | `blocks.content_hash` | sha256(tx_hash + buyer_sig + prevBlockHash) | 블록체인 연속성의 기준값 |
| gopang-wallet.js | IndexedDB `financial_state.block_hash` | 직전 거래의 L1 content_hash | 다음 거래의 prev_settle_hash 원천 |
| gopang-wallet.js | IndexedDB `hash_chain` | prevSettleHash, newSettleHash, txHash | 로컬 해시체인 이력 |
| Supabase | `fs_ledger.block_hash` | L1 content_hash | DB 레코드와 L1 블록 연결 |

**profile.html은 hash를 저장하지 않는다.** `/biz/order` POST 결과를 Worker로부터 받아 GWP_DONE으로 전달하는 중계 역할만 수행한다.

### 2.2 정상 흐름 (설계 의도)

```
거래 완료
    → L1 block_hash 발급
    → profile.html GWP_DONE (block_hash 포함)
    → market/webapp.html 포워딩 (block_hash 보존)
    → gopang-app.js GWP_DONE 핸들러
    → wallet.redeemClaim({ block_hash, claims })
    → IndexedDB financial_state.block_hash 갱신
    → 다음 거래 prev_settle_hash === L1 최신 content_hash ✅
```

---

## 3. 사고 실험 — 수정 전

### 3.1 초기 상태

```
L1 최신 블록:
    content_hash = "4a676070..."   (height = 1, 테스트 거래 기준)

wallet IndexedDB:
    financial_state.block_hash = "4a676070..."   ← 수동 동기화로 일치시킨 상태
    bs-cash = 1,000,000
```

### 3.2 Step 1 — /biz/order POST 성공

Worker가 L1 응답을 가공하여 반환한다.

```javascript
result = {
  ok:          true,
  block_hash:  "NEW_HASH_abcd1234",   // L1이 새로 발급한 content_hash
  tx_hash:     "txhash_xyz...",
  buyer_claim: {
    direction:  'debit',
    fs_account: 'bs-cash',
    amount:     6000,
    expires_at: '2026-06-12T...',
  }
}
```

L1에는 height=2 블록이 생성되었다. `content_hash = "NEW_HASH_abcd1234"`.

### 3.3 Step 2 — profile.html GWP_DONE 전송 (수정 전)

```javascript
window.opener.postMessage({
  type:    'GWP_DONE',
  summary: '금능반점 주문 완료 — ₩6,000',
  pdvData: { ... },
}, OPENER_ORIGIN);
// block_hash  → 누락
// tx_hash     → 누락
// buyer_claim → 누락
```

market은 `{ type, summary, pdvData }` 만 수신한다.

### 3.4 Step 3 — market/webapp.html GWP_DONE 수신 (수정 전)

`gwpHandler`가 발동한다.

```javascript
const summary = e.data.summary;   // '금능반점 주문 완료 — ₩6,000'
appendMsg('ai', '✅ ' + summary + '\n\n재무제표가 갱신되었습니다.');
recordPDV({ ... });
// gopang으로 포워딩하는 코드 없음 → 핸들러 종료
```

gopang-app.js는 이 GWP_DONE을 **수신하지 못한다.**

### 3.5 Step 4 — gopang-app.js GWP_DONE 핸들러 (수정 전)

market이 포워딩하지 않았으므로 `case 'GWP_DONE'` 블록 자체가 실행되지 않는다.

```
wallet.redeemClaim()  →  호출 안 됨
financial_state.block_hash  →  "4a676070..."  그대로 (갱신 없음)
```

### 3.6 Step 5 — 두 번째 주문 시도

`buildPrevSettleHash()`가 실행된다.

```javascript
financial_state.block_hash = "4a676070..."    // 갱신되지 않은 구버전
prev_settle_hash = "4a676070..."

// L1 3단계 검증:
prev_settle_hash  ("4a676070...")
    !== latestBlock.content_hash ("NEW_HASH_abcd1234")

→ 409 STALE_STATE
```

### 3.7 구멍 3개의 직렬 구조

```
구멍 A: profile.html  →  block_hash, buyer_claim 미포함
         ↓ (이미 여기서 끊김)
구멍 B: market/webapp.html  →  gopang으로 포워딩 없음
         ↓ (gopang이 수신 자체를 못함)
구멍 C: gopang-app.js  →  buyer_claim → claims[] 변환 없음
         ↓ (redeemClaim이 호출돼도 claims=[]이므로 잔액 차감 안 됨)
         ↓ (단, block_hash는 갱신됨 — 부분 동작)

결론: 구멍 A, B, C가 직렬로 연결되어 있다.
      하나라도 막히면 redeemClaim()이 의미없다.
      A → B → C 순서로 모두 닫아야 한다.
```

---

## 4. 사고 실험 — 수정 후

### 4.1 Step 2' — profile.html GWP_DONE 전송 (수정 후)

```javascript
window.opener.postMessage({
  type:        'GWP_DONE',
  summary:     '금능반점 주문 완료 — ₩6,000',
  block_hash:  result.block_hash  || null,   // "NEW_HASH_abcd1234"
  tx_hash:     result.tx_hash     || null,   // "txhash_xyz..."
  buyer_claim: result.buyer_claim || null,   // { direction:'debit', amount:6000, ... }
  pdvData:     { ... },
}, OPENER_ORIGIN);
```

market은 이제 3개 필드를 수신한다.

### 4.2 Step 3' — market/webapp.html GWP_DONE 수신 (수정 후)

```javascript
const summary = e.data.summary;
appendMsg('ai', '✅ ' + summary + '\n\n재무제표가 갱신되었습니다.');

// 추가된 1줄 — e.data 그대로 전달하므로 모든 필드 보존
if (window.opener && !window.opener.closed) {
  window.opener.postMessage(e.data, 'https://gopang.net');
}

recordPDV({ ... });
```

gopang-app.js가 이제 GWP_DONE을 수신한다.

### 4.3 Step 4' — gopang-app.js GWP_DONE 핸들러 (수정 후)

```javascript
// case 'GWP_DONE' 실행됨
msg = {
  type:        'GWP_DONE',
  block_hash:  "NEW_HASH_abcd1234",
  tx_hash:     "txhash_xyz...",
  buyer_claim: { direction:'debit', fs_account:'bs-cash', amount:6000, expires_at:'...' },
  claims:      undefined,
}

// 변환 로직 (수정 후)
const claims = msg.claims?.length
  ? msg.claims
  : (msg.buyer_claim ? [msg.buyer_claim] : []);
// → claims = [{ direction:'debit', fs_account:'bs-cash', amount:6000 }]

window.gopangWallet.redeemClaim({
  block_hash: "NEW_HASH_abcd1234",
  tx_hash:    "txhash_xyz...",
  claims:     [{ direction:'debit', fs_account:'bs-cash', amount:6000 }],
})
```

### 4.4 Step 4'' — wallet.redeemClaim() 내부

```javascript
// 청구권 적용
fs['bs-cash'] = 1,000,000 - 6,000 = 994,000

// IndexedDB 저장
financial_state = {
  state:      { 'bs-cash': 994,000, 'pl-purchase': 0, 'pl-revenue': 0 },
  block_hash: "NEW_HASH_abcd1234",   // ← 갱신됨
  updatedAt:  "2026-06-11T...",
}

// Hash Chain 기록
hash_chain[height=2] = {
  prevSettleHash: "구_settle_hash...",
  newSettleHash:  "신_settle_hash...",
  txHash:         "txhash_xyz...",
  blockHash:      "NEW_HASH_abcd1234",
}

// 콘솔 출력
[GWP_DONE] redeemClaim 완료 — block_hash: NEW_HASH | applied: 1 | bs-cash: 994000
```

### 4.5 Step 5' — 두 번째 주문 시도

```javascript
buildPrevSettleHash()
    → financial_state.block_hash = "NEW_HASH_abcd1234"   // 갱신된 값
    → prev_settle_hash = "NEW_HASH_abcd1234"

// L1 3단계 검증:
prev_settle_hash  ("NEW_HASH_abcd1234")
    === latestBlock.content_hash ("NEW_HASH_abcd1234")

→ ✅ 통과 — STALE_STATE 없음
```

---

## 5. 수정 내역

### 5.1 수정 파일 및 위치

| 파일 | 행 | 수정 내용 |
|---|---|---|
| `users/profile.html` | 796~798 | GWP_DONE postMessage에 `block_hash`, `tx_hash`, `buyer_claim` 추가 |
| `market/webapp.html` | 1614 | OPEN_PROFILE 경로 gwpDoneHandler에 gopang 포워딩 1줄 추가 |
| `market/webapp.html` | 1784 | _parseTrade 경로 gwpHandler에 gopang 포워딩 1줄 추가 |
| `gopang/gopang-app.js` | 3610~3622 | `buyer_claim → claims[]` 변환, `tx_hash` 전달, `.then()` 성공 로그 추가 |

### 5.2 수정 후 구멍 폐쇄 상태

```
구멍 A: profile.html  →  ✅ block_hash, tx_hash, buyer_claim 포함
구멍 B: market/webapp.html  →  ✅ e.data 그대로 gopang에 포워딩 (2경로)
구멍 C: gopang-app.js  →  ✅ buyer_claim → claims[] 변환 후 redeemClaim() 호출
```

---

## 6. OpenHash 철학과의 관계

### 6.1 자기연속성(Self-Continuity) 원칙

OpenHash의 핵심 요구사항:

> 거래가 완료되면 그 증거(block_hash)가 자동으로 다음 거래의 출발점이 되어야 한다.
> 사용자가 개입할 필요 없이, 시스템이 스스로 상태를 갱신해야 한다.

이번 수정 전 시스템은 이 원칙을 위반하고 있었다. 거래가 완료되어도 wallet이 갱신되지 않아 매번 수동으로 IndexedDB를 동기화해야 했다.

### 6.2 수정 후 달성되는 것

```
거래 완료 → L1 block_hash 발급
    → GWP_DONE 자동 전파 (profile → market → gopang)
    → redeemClaim() 자동 호출
    → wallet 자동 갱신
    → 다음 거래 준비 완료
```

사용자 개입 없이 시스템이 스스로 상태를 갱신한다. 자기연속성 원칙 충족.

---

## 7. 검증 방법

### 7.1 T04 통과 기준

```
1차 주문 완료 후 gopang.net 콘솔:
[GWP_DONE] redeemClaim 완료 — block_hash: <8자리> | applied: 1 | bs-cash: 994000

2차 주문 시도:
→ STALE_STATE 없이 L1 통과 → T04 근본 해결 완료
```

### 7.2 콘솔 검증 스크립트

```javascript
// 1차 거래 완료 후 gopang.net 콘솔에서 실행
const req = indexedDB.open('gopang-wallet');
req.onsuccess = e => {
  const db = e.target.result;
  db.transaction('keys').objectStore('keys')
    .get('financial_state').onsuccess = ev => {
      const fs = ev.target.result;
      console.log('block_hash:', fs.block_hash);   // L1 최신 content_hash와 일치해야 함
      console.log('bs-cash:', fs.state['bs-cash']); // 1,000,000 - 6,000 = 994,000
    };
};
```

---

## 8. 교훈

1. **직렬 구멍**: 3개의 구멍이 직렬로 연결되어 있었다. 어느 하나만 보고 수정하면 나머지가 여전히 차단한다. 전체 경로를 추적해야 한다.

2. **수신과 포워딩의 구분**: market이 GWP_DONE을 "수신"하는 것과 gopang으로 "포워딩"하는 것은 별개다. 수신 로그가 보인다고 gopang이 받는 것이 아니다.

3. **e.data 그대로 포워딩**: 포워딩 시 필드를 선택적으로 재구성하면 미래의 필드 추가 시 또 누락된다. `e.data` 전체를 넘기는 것이 안전하다.

4. **임시 방편의 수명**: 수동 IndexedDB 동기화는 첫 번째 거래의 테스트 통과에는 유효하지만, 두 번째 거래부터 즉시 무력화된다. 근본 해결 없이는 T05 이후 진행이 불가능하다.

---

*hash_synchronization.md*  
*AI City Inc. 팀 주피터 | 2026-06-11*
