# PDV 저장 메커니즘 설계
## L1 Hash Chain ↔ PDV Hash Chain 연동 알고리즘

**문서 코드** PDV-HASHCHAIN-DESIGN-v1.0  
**작성일** 2026-06-12  
**근거 문헌** OpenHash SCI 논문 초안 v2.2 (§3.1.3, §4.2, §4.3, §4.4)  
**대상 코드** gopang-wallet.js v2.0.0 · gopang-app.js · Worker v4.9

---

## 1. 논문에서 파악한 핵심 알고리즘

### 1.1 사용자 Hash Chain (§3.1.3)

논문은 **두 개의 독립된 Hash Chain**을 정의합니다.

```
사용자 Hash Chain   H_u = (h_1, h_2, ..., h_t)
  h_i = SHA-256(h_{i-1} ∥ data_i ∥ height_i)

노드 Hash Chain     H_N = (n_1, n_2, ..., n_t)
  n_i = SHA-256(n_{i-1} ∥ h_{user,i})
```

`height_i`는 논스(nonce) 역할로 **재생 공격을 원천 차단**합니다.  
갱신은 **이중 서명(사용자 서명 + L1 노드 서명)** 을 요구합니다.

### 1.2 잔액 매핑 무결성 BMI (§4.2.2)

```
BMI_k(T) = MerkleRoot({ balance_u(T) : u ∈ tier_k })
```

감사 시 상위 계층이 `BMI_k(T-1)`에 합법적 거래만 반영한 `BMI_k(T)_예상`과  
하위 계층이 전달한 `BMI_k(T)_실제`를 비교합니다.  
불일치 시 무단 잔액 변경으로 판정 → LPBFT 발동.

### 1.3 ILMV 하향 감사 항목 6 (§4.3.1)

```
항목 6: 해시 체인 연결
```

L2→L1은 **100% 스트리밍 감사**로 해시 체인 연결성을 실시간 검증합니다.

### 1.4 현재 gopang-wallet.js의 구현 (대조)

현재 코드의 `appendHashChain()`은 논문 §3.1.3의 사용자 Hash Chain에 해당합니다.

```javascript
// 현재 구현 (gopang-wallet.js:396)
h_i = SHA-256(h_{i-1} ∥ tx_hash ∥ block_hash ∥ height)
```

논문의 공식과 비교하면:
- `h_{i-1}` = `prev_local_hash` ✅
- `data_i`   = `tx_hash + block_hash` ✅ (tx 내용 + L1 앵커)
- `height_i` = `height` ✅ (논스, 재생 공격 방지)

**결론**: 사용자 Hash Chain은 논문과 일치합니다.  
**누락**: PDV 레코드가 사용자 Hash Chain에 포함되지 않습니다.  
**누락**: L1 Hash Chain(`H_N = SHA-256(n_{i-1} ∥ h_{user,i})`)이 미구현입니다.

---

## 2. 문제 정의 — 현재 구조의 공백

### 2.1 현재 PDV 흐름

```
거래 완료
  → GWP_DONE (block_hash, buyer_claim)
  → redeemClaim()
      → financial_state.block_hash 갱신     ← L1 앵커 연결 ✅
      → appendHashChain()                   ← 사용자 Hash Chain ✅
  → _recordPDV() 또는 recordPDV()
      → Supabase pdv_log INSERT              ← 독립 기록 (Hash Chain과 미연결) ❌
```

### 2.2 공백

| 항목 | 현재 상태 | 논문 요구 |
|------|-----------|-----------|
| PDV 레코드 → Hash Chain 연결 | ❌ 미연결 | `data_i`에 PDV 해시 포함 |
| PDV Hash Chain | ❌ 별도 없음 | `H_u`의 `data_i` = PDV 내용 해시 |
| L1 노드 Hash Chain | ❌ 미구현 | `n_i = SHA-256(n_{i-1} ∥ h_{user,i})` |
| BMI Merkle Root | ❌ 미구현 | `BMI_k(T) = MerkleRoot({balance_u})` |
| PDV block_hash | ⚠️ 일부 | `pdv_log.block_hash` 있으나 Hash Chain과 미연결 |

---

## 3. 설계 — PDV Hash Chain 연동 알고리즘

### 3.1 핵심 원칙

> **PDV 레코드는 거래 Hash Chain의 `data_i`에 포함되어야 한다.**

논문 §3.1.3의 `data_i`를 다음과 같이 확장합니다.

```
data_i = tx_hash ∥ block_hash ∥ pdv_hash_i

pdv_hash_i = SHA-256(
    pdv_type   ∥    // 레코드 유형 (service_task, klaw_monitor ...)
    who        ∥    // 6하 원칙: 누가
    what       ∥    // 6하 원칙: 무엇을
    session_id ∥    // 중복 방지 세션 ID
    timestamp       // ISO 8601
)
```

이로써 Hash Chain의 연속성이 `PDV 레코드 → L1 블록 → 다음 PDV 레코드`를  
**수학적으로 연결**합니다.

### 3.2 갱신된 Hash Chain 공식

```
h_i = SHA-256(h_{i-1} ∥ tx_hash ∥ block_hash ∥ pdv_hash_i ∥ height_i)
```

| 필드 | 역할 | 논문 근거 |
|------|------|-----------|
| `h_{i-1}` | 이전 체인 연결 | §3.1.3 `h_{i-1}` |
| `tx_hash` | 거래 식별 | §4.4 Stage 2 서명 검증 |
| `block_hash` | L1 앵커 | §4.3.1 항목 6 해시 체인 연결 |
| `pdv_hash_i` | PDV 내용 앵커 | §3.1.3 `data_i` 확장 |
| `height_i` | 논스, 재생 방지 | §3.1.3 height 논스 |

### 3.3 PDV Hash Chain 레코드 구조

```javascript
// IndexedDB hash_chain store 레코드 (갱신)
{
  // 기존 필드
  height:           Number,    // 논스 (재생 공격 방지)
  local_hash:       Hex64,     // h_i = SHA-256(h_{i-1}∥tx∥block∥pdv∥height)
  prev_local_hash:  Hex64,     // h_{i-1}
  prev_settle_hash: Hex64,     // 거래 전 재무 상태 해시
  new_settle_hash:  Hex64,     // 거래 후 재무 상태 해시
  tx_hash:          Hex64,     // 거래 해시
  block_hash:       Hex64,     // L1 content_hash
  block_id:         String,    // L1 block ID (선택)
  recorded_at:      ISO8601,

  // 신규 필드 (PDV 연동)
  pdv_hash:         Hex64,     // SHA-256(pdv 핵심 필드)
  pdv_session_id:   UUID,      // pdv_log.session_id (Supabase 연결 키)
  pdv_type:         String,    // 'service_task' | 'klaw_monitor' | ...
  pdv_anchored:     Boolean,   // Supabase pdv_log INSERT 성공 여부

  // BMI 연동 (선택적, 고중요도 거래)
  bmi_snapshot:     Hex64|null // MerkleRoot({balance_u}) 스냅샷 (강화 모드)
}
```

### 3.4 L1 노드 Hash Chain 연동 (§3.1.3 H_N)

논문은 L1 노드가 자체 Hash Chain을 유지하도록 요구합니다.

```
n_i = SHA-256(n_{i-1} ∥ h_{user,i})
```

고팡 구조에서 이는 **Worker → L1 PocketBase의 `l1_ledger` 컬렉션**으로 구현합니다.

```javascript
// Worker /biz/order 처리 후 L1 ledger 앵커링
l1_ledger 레코드 = {
  tx_id:        tx_hash,
  user_hash:    h_i,          // 사용자 Hash Chain의 최신 h_i
  node_hash:    n_i,          // n_i = SHA-256(n_{i-1} ∥ h_i)
  pdv_hash:     pdv_hash_i,   // PDV 내용 해시
  block_hash:   content_hash, // L1 블록의 content_hash
  anchored_at:  timestamp
}
```

---

## 4. 구현 계획 — 3단계

### 4.1 Phase A: PDV Hash 계산 (gopang-wallet.js 수정)

`redeemClaim()` 내부에서 PDV 해시를 계산하고 Hash Chain에 포함합니다.

```javascript
// gopang-wallet.js redeemClaim() 수정 위치: 청구권 적용 후, appendHashChain() 전

async redeemClaim({ block_hash, block_id, claims = [], tx_hash, pdv_record = null }) {

  // ... 기존 claims 적용 코드 ...

  // ── PDV 해시 계산 (신규) ──────────────────────────────────
  let pdvHash = null;
  let pdvSessionId = null;
  if (pdv_record) {
    const pdvStr = JSON.stringify({
      type:       pdv_record.type       || '',
      who:        pdv_record.who        || '',
      what:       pdv_record.what       || '',
      session_id: pdv_record.session_id || '',
      ts:         pdv_record.ts         || new Date().toISOString(),
    });
    const buf = await sha256(pdvStr);
    pdvHash = bufToHex(buf);
    pdvSessionId = pdv_record.session_id || null;
  }

  // ── Hash Chain 기록 (pdv_hash 포함) ──────────────────────
  const chainRec = await appendHashChain(db, {
    prevSettleHash,
    newSettleHash,
    txHash:    tx_hash || block_hash,
    blockHash: block_hash,
    blockId:   block_id || null,
    pdvHash,                          // ← 신규
    pdvSessionId,                     // ← 신규
    pdvType:   pdv_record?.type || null, // ← 신규
  });

  return { fs, chainRec, applied };
}
```

### 4.2 Phase A: appendHashChain() 공식 갱신

```javascript
// gopang-wallet.js appendHashChain() 수정
async function appendHashChain(db, {
  prevSettleHash, newSettleHash,
  txHash, blockHash, blockId,
  pdvHash = null,       // 신규
  pdvSessionId = null,  // 신규
  pdvType = null,       // 신규
}) {
  const last = await idbChainGetLast(db);
  const height = (last?.height ?? -1) + 1;
  const prevLocalHash = last?.local_hash ?? '0'.repeat(64);

  // ── 논문 §3.1.3 갱신 공식 ──────────────────────────────────
  // h_i = SHA-256(h_{i-1} ∥ tx_hash ∥ block_hash ∥ pdv_hash ∥ height)
  const chainInput = prevLocalHash
    + txHash
    + blockHash
    + (pdvHash || '0'.repeat(64))   // PDV 없는 거래는 0패딩
    + String(height);

  const localHash = bufToHex(await sha256(chainInput));

  const record = {
    height,
    local_hash:       localHash,
    prev_local_hash:  prevLocalHash,
    prev_settle_hash: prevSettleHash,
    new_settle_hash:  newSettleHash,
    tx_hash:          txHash,
    block_hash:        blockHash,
    block_id:          blockId || null,
    recorded_at:       new Date().toISOString(),
    // PDV 연동 필드 (신규)
    pdv_hash:          pdvHash,
    pdv_session_id:    pdvSessionId,
    pdv_type:          pdvType,
    pdv_anchored:      false,          // Supabase INSERT 완료 후 true로 갱신
  };

  await idbChainPut(db, record);
  return record;
}
```

### 4.3 Phase B: GWP_DONE 핸들러 — PDV와 redeemClaim 동기화

`gopang-app.js`의 `GWP_DONE` 핸들러에서 PDV 레코드를 먼저 구성하고  
`redeemClaim()`에 함께 전달합니다.

```javascript
// gopang-app.js GWP_DONE case 수정

case 'GWP_DONE': {

  // 1. PDV 레코드 구성 (기존 코드에서 추출)
  const sessionId = msg.session_id || msg.pdvData?.session_id
    || crypto.randomUUID();
  const pdvRecord = {
    type:       'service_task',
    serviceId:  _gwpService?.id   || null,
    service:    _gwpService?.name || null,
    summary:    msg.summary       || null,
    who:        msg.pdvData?.who  || _USER?.ipv6 || null,
    what:       msg.pdvData?.what || msg.summary || null,
    how:        msg.pdvData?.how  || 'gwp',
    why:        msg.pdvData?.why  || (_gwpService?.name + ' 서비스 이용'),
    session_id: sessionId,
    ts:         new Date().toISOString(),
  };

  // 2. redeemClaim에 PDV 레코드 함께 전달
  if (msg.block_hash && window.gopangWallet?.redeemClaim) {
    const claims = msg.claims?.length
      ? msg.claims
      : (msg.buyer_claim ? [msg.buyer_claim] : []);

    window.gopangWallet.redeemClaim({
      block_hash: msg.block_hash,
      block_id:   msg.block_id  || null,
      tx_hash:    msg.tx_hash   || null,
      claims,
      pdv_record: pdvRecord,      // ← 신규: PDV를 Hash Chain에 포함
    }).then(({ fs, chainRec, applied }) => {
      console.info('[GWP_DONE] redeemClaim 완료',
        '| block_hash:', msg.block_hash.slice(0, 8),
        '| pdv_hash:', chainRec.pdv_hash?.slice(0, 8) || 'none',
        '| height:', chainRec.height,
        '| bs-cash:', fs['bs-cash']);
      appendBubble('ai', `거래 완료. 잔액 ₩${fs['bs-cash']?.toLocaleString()}`, false);

      // 3. PDV Supabase 기록 (Hash Chain 기록 완료 후)
      const reporterSvc = msg.reporter_svc || msg.pdvData?.reporter_svc || null;
      if (!reporterSvc) {
        _recordPDV({
          ...pdvRecord,
          chain_height:    chainRec.height,    // ← 신규: Hash Chain 높이 기록
          chain_local_hash: chainRec.local_hash, // ← 신규: 검증용 해시
        }).then(() => {
          // Supabase INSERT 성공 → IndexedDB pdv_anchored 갱신
          _markPdvAnchored(chainRec.height);
        });
      }
    }).catch(err => console.warn('[GWP_DONE] redeemClaim 실패:', err.message));
  }
  break;
}
```

### 4.4 Phase B: _recordPDV() 수정 — chain_height 포함

```javascript
// gopang-app.js _recordPDV() 수정
async function _recordPDV(record) {
  try {
    const _effectiveGuid = _USER?.guid || _USER?.ipv6 || USER_GUID;

    // ... 기존 6하 원칙 필드 구성 ...

    await fetch(_SUPABASE_URL + '/rest/v1/pdv_log', {
      method: 'POST',
      headers: { /* ... */ },
      body: JSON.stringify({
        user_guid:   _effectiveGuid,           // P17 수정
        device_fp:   _USER?.fp || _USER?.fpHex?.slice(0, 32) || null,
        who_name:    whoName,
        location:    locStr,
        record_type: record.type,
        summary:     record.summary || null,
        payload:     record,
        how:         howStr,
        service_id:  record.serviceId || null,
        why:         whyStr,
        session_id:  record.session_id || null,   // ← 신규: 중복 방지
        // Hash Chain 연동 필드 (신규)
        chain_height:     record.chain_height     ?? null,
        chain_local_hash: record.chain_local_hash ?? null,
        openhash_anchored: false,  // Worker 경유 시 true로 설정
        via_worker:        false,  // 직접 INSERT이므로 false
      }),
    });

    console.info('[PDV] 기록 완료:', record.type, '| height:', record.chain_height);
  } catch(e) {
    console.warn('[PDV] 기록 실패:', e.message);
  }
}
```

### 4.5 Phase B: IndexedDB pdv_anchored 갱신 함수

```javascript
// gopang-app.js 신규 함수
async function _markPdvAnchored(height) {
  try {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('gopang-wallet');
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
    const tx    = db.transaction('hash_chain', 'readwrite');
    const store = tx.objectStore('hash_chain');
    const rec   = await new Promise((resolve, reject) => {
      const r = store.get(height);
      r.onsuccess = e => resolve(e.target.result);
      r.onerror   = e => reject(e.target.error);
    });
    if (rec) {
      rec.pdv_anchored = true;
      store.put(rec);
    }
    console.info('[PDV] pdv_anchored 갱신 완료 | height:', height);
  } catch(e) {
    console.warn('[PDV] pdv_anchored 갱신 실패:', e.message);
  }
}
```

### 4.6 Phase C: Worker — PDV Hash Chain 검증 (L1 노드 Hash Chain)

Worker의 `/biz/order` 처리 후 `l1_ledger`에 `node_hash`(`n_i`)를 기록합니다.

```javascript
// Worker worker.js /biz/order 처리 후 (신규 섹션)

// L1 노드 Hash Chain 갱신 (논문 §3.1.3 H_N)
async function updateNodeHashChain(env, { userHash, txId, blockHash, pdvHash }) {
  // 직전 n_{i-1} 조회
  const { data: lastLedger } = await supabase
    .from('l1_ledger')
    .select('node_hash')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  const prevNodeHash = lastLedger?.node_hash || '0'.repeat(64);

  // n_i = SHA-256(n_{i-1} ∥ h_{user,i})
  const nodeHashInput = prevNodeHash + userHash;
  const nodeHash = await sha256hex(nodeHashInput);

  // l1_ledger 저장
  await supabase.from('l1_ledger').insert({
    tx_id:      txId,
    user_hash:  userHash,    // 사용자의 local_hash (h_i)
    node_hash:  nodeHash,    // n_i = SHA-256(n_{i-1} ∥ h_i)
    pdv_hash:   pdvHash,     // PDV 내용 해시
    block_hash: blockHash,
    anchored_at: new Date().toISOString(),
  });

  return nodeHash;
}
```

---

## 5. Supabase 스키마 변경

### 5.1 pdv_log 테이블 컬럼 추가

```sql
-- 실행: Supabase SQL Editor
ALTER TABLE pdv_log
  ADD COLUMN IF NOT EXISTS session_id       UUID,
  ADD COLUMN IF NOT EXISTS chain_height     INTEGER,
  ADD COLUMN IF NOT EXISTS chain_local_hash TEXT,
  ADD COLUMN IF NOT EXISTS openhash_anchored BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS via_worker       BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reporter_svc     TEXT;

-- 중복 방지 인덱스
CREATE UNIQUE INDEX IF NOT EXISTS pdv_log_session_id_idx
  ON pdv_log (session_id)
  WHERE session_id IS NOT NULL;

-- Hash Chain 조회 인덱스
CREATE INDEX IF NOT EXISTS pdv_log_chain_height_idx
  ON pdv_log (chain_height);
```

### 5.2 l1_ledger 테이블 컬럼 추가 (Phase C)

```sql
ALTER TABLE l1_ledger
  ADD COLUMN IF NOT EXISTS user_hash  TEXT,   -- 사용자 Hash Chain h_i
  ADD COLUMN IF NOT EXISTS node_hash  TEXT,   -- 노드 Hash Chain n_i
  ADD COLUMN IF NOT EXISTS pdv_hash   TEXT;   -- PDV 내용 해시
```

---

## 6. Hash Chain 연동 완성 후 흐름

```
거래 완료
  │
  ├─ redeemClaim({ block_hash, claims, pdv_record })
  │    │
  │    ├─ 청구권 적용 (bs-cash 차감)
  │    │
  │    ├─ pdv_hash = SHA-256(type ∥ who ∥ what ∥ session_id ∥ ts)
  │    │
  │    └─ appendHashChain()
  │         h_i = SHA-256(h_{i-1} ∥ tx_hash ∥ block_hash ∥ pdv_hash ∥ height)
  │         IDB hash_chain[height] = { h_i, pdv_hash, pdv_session_id, pdv_anchored:false }
  │
  ├─ _recordPDV({ ...pdvRecord, chain_height, chain_local_hash })
  │    └─ Supabase pdv_log INSERT
  │         { session_id, chain_height, chain_local_hash, openhash_anchored:false }
  │
  ├─ _markPdvAnchored(height)
  │    └─ IDB hash_chain[height].pdv_anchored = true
  │
  └─ (Worker 경유 시) updateNodeHashChain()
       n_i = SHA-256(n_{i-1} ∥ h_i)
       Supabase l1_ledger INSERT { user_hash: h_i, node_hash: n_i, pdv_hash }
```

---

## 7. 무결성 검증 — T05/T06 테스트 확장

### 7.1 Hash Chain 연속성 검증 (논문 정리 1 적용)

```javascript
// gopang.net 콘솔 — Hash Chain + PDV 무결성 검증
async function verifyPdvChain() {
  const chain = await window.gopangWallet.getHashChain();

  for (let i = 1; i < chain.length; i++) {
    const cur  = chain[i];
    const prev = chain[i - 1];

    // 1. 체인 연속성
    if (cur.prev_local_hash !== prev.local_hash) {
      console.error('체인 단절 at height:', cur.height);
      return { valid: false, broken_at: cur.height, reason: 'chain_break' };
    }

    // 2. h_i 재계산 검증 (PDV 포함)
    const recomputed = await sha256hex(
      prev.local_hash
      + cur.tx_hash
      + cur.block_hash
      + (cur.pdv_hash || '0'.repeat(64))
      + String(cur.height)
    );
    if (recomputed !== cur.local_hash) {
      console.error('해시 불일치 at height:', cur.height);
      return { valid: false, broken_at: cur.height, reason: 'hash_mismatch' };
    }

    // 3. PDV 앵커링 확인
    if (cur.pdv_hash && !cur.pdv_anchored) {
      console.warn('PDV 미앵커링 at height:', cur.height,
        '| session_id:', cur.pdv_session_id);
    }
  }

  console.log('✅ PDV Hash Chain 검증 완료 | 총', chain.length, '건');
  return { valid: true, broken_at: null };
}
```

### 7.2 BMI 스냅샷 검증 (논문 §4.2.2 — 고중요도 거래)

```sql
-- Supabase SQL: BMI 일치 확인
-- 고중요도 거래의 chain_local_hash와 l1_ledger.user_hash 비교
SELECT
  p.session_id,
  p.chain_height,
  p.chain_local_hash AS pdv_hash,
  l.user_hash        AS l1_hash,
  p.chain_local_hash = l.user_hash AS hash_match
FROM pdv_log p
LEFT JOIN l1_ledger l ON p.chain_height = l.height
WHERE p.chain_height IS NOT NULL
ORDER BY p.chain_height DESC
LIMIT 20;
```

---

## 8. 구현 우선순위

| 단계 | 작업 | 파일 | 우선순위 |
|------|------|------|---------|
| Phase A-1 | `appendHashChain()` pdv_hash 포함 | gopang-wallet.js | ⭐ 최우선 |
| Phase A-2 | `redeemClaim()` pdv_record 파라미터 추가 | gopang-wallet.js | ⭐ 최우선 |
| Phase B-1 | `GWP_DONE` 핸들러 pdv_record 구성 | gopang-app.js | ⭐ 최우선 |
| Phase B-2 | `_recordPDV()` chain_height 포함 | gopang-app.js | ⭐ 최우선 |
| Phase B-3 | Supabase pdv_log 스키마 변경 | SQL | ⭐ 최우선 |
| Phase B-4 | `_markPdvAnchored()` 신규 함수 | gopang-app.js | 높음 |
| Phase C-1 | Worker `l1_ledger` node_hash 기록 | worker.js | 높음 |
| Phase C-2 | Supabase l1_ledger 스키마 변경 | SQL | 높음 |
| T05 확장 | `verifyPdvChain()` 검증 함수 | 콘솔 스크립트 | 중간 |
| T06 확장 | BMI 스냅샷 SQL 쿼리 | SQL | 중간 |

---

## 9. 핵심 불변 조건 (갱신)

```
거래 N 완료 후 거래 N+1이 성공하려면:

  [기존] IndexedDB financial_state.block_hash
             === L1 blocks 컬렉션 최신 content_hash

  [추가] IndexedDB hash_chain[height].local_hash
             === SHA-256(h_{i-1} ∥ tx_hash ∥ block_hash ∥ pdv_hash ∥ height)

  [추가] Supabase pdv_log.chain_local_hash
             === IndexedDB hash_chain[height].local_hash

  [추가 — Phase C] Supabase l1_ledger.node_hash
             === SHA-256(prev_node_hash ∥ user_local_hash)
```

이 3개 조건이 모두 성립할 때 **논문 §3.1.3의 이중 해시 체인(H_u + H_N)**이  
**PDV 레코드와 완전히 연동**된 상태입니다.

---

*PDV-HASHCHAIN-DESIGN-v1.0*  
*AI City Inc. 팀 주피터 | 2026-06-12*  
*근거: OpenHash SCI 논문 초안 v2.2 §3.1.3, §4.2, §4.3, §4.4*
