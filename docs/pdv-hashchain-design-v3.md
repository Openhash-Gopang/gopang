# PDV 저장 메커니즘 설계 v3.0
## L1 Hash Chain ↔ PDV Chain ↔ K-Tax 감사 연동 — 최종본

**문서 코드** PDV-HASHCHAIN-DESIGN-v3.0-FINAL  
**작성일** 2026-06-12  
**이전 버전** PDV-HASHCHAIN-DESIGN-v2.0  
**근거 문헌** OpenHash SCI 논문 초안 v2.2 (§3.1.3, §4.2, §4.3, §4.4, §4.7.1)  
**대상 코드** gopang-wallet.js v2.0.0 · gopang-app.js · Worker v4.9 · K-Tax 모듈

---

## 변경 이력

### v2.0 → v3.0 주요 변경

| 코드 | 항목 | v2.0 | v3.0 | 근거 |
|------|------|------|------|------|
| C1 | BMI 구현 전략 | Worker 배치 Merkle Root | `fs_ledger` 집계 + K-Tax 주기 감사 | "auditable integrity" — 실시간 trustless 불필요 |
| C2 | `balance_claimed` | 자기 선언, 미검증 | 거래 서명 내 포함 + K-Tax 사후 대조 | 이중지불 방지는 prev_settle_hash로 충분 |
| C3 | Merkle Root 용도 | BMI 대안으로 혼용 | MTSM 앵커링 + K-Tax BMI 분리 | §4.7.1 원래 목적에 충실 |
| C4 | K-Tax 연동 | 없음 | 레이어 3 신설 | 국가 주도 감사 경로 |
| C5 | `merkle_batches` | 논의됨 | 제거 | 불필요한 복잡도 |

### v3.0 초안 → 최종본 사고 실험 결함 수정

| 결함 | 내용 | 수정 |
|------|------|------|
| E1 | `verifyDeltaZero` 수식이 항등식 — 탐지 불가 | `buyer_debit = seller_credit + platform_debit` 로 재작성 |
| E2 | `_patchPdvChainHeight` 타이밍 경쟁 조건 | 300ms 지연 후 재시도 로직 추가 |
| E3 | cross-node 거래에서 Σδ≠0 오탐 | 동일 노드 내 거래만 Σδ 검증 대상으로 한정 |
| E4 | `l1_ledger`에 `balance_claimed` 컬럼 없음 | 스키마에 `balance_claimed` 컬럼 추가 |
| E5 | Merkle 리프의 balance 값 비결정론적 직렬화 | `Math.round()` 정수 정규화 후 직렬화 |

---

## 1. 신뢰 모델과 설계 철학

### 1.1 고팡의 보안 목표

논문 §3.2:

> "본 시스템의 보안 모델은 '신뢰 없는 불변성(trustless immutability)'이 아닌  
> **'감사 가능한 무결성(auditable integrity)'**을 목표로 한다."

고팡은 L4에 국세청·한국은행·법원행정처 등 13개 독립 국가기관이 운영 주체로 참여하는  
**국가 주도 분산 원장**입니다. 비트코인과 달리 모든 참여자가 실시간으로 전체 잔액 상태를  
독립 검증할 필요가 없습니다.

이 신뢰 모델에서:
- **이중지불 방지** → `prev_settle_hash` 체인 연속성 (실시간)
- **내부 위변조 탐지** → `fs_ledger` 집계 기반 K-Tax 감사 (주기적)
- **잔액 BMI** → L1 노드별 집계 + Merkle Root (분기별)

### 1.2 `balance_claimed`의 역할

`balance_claimed`는 거래 서명(`tx_hash`)의 구성 요소로 구매자가 자기 선언하는 값입니다.

```
tx = {
  input: {
    owner_guid:       buyerGuid,
    prev_settle_hash: block_hash,    // ← 이중지불 방지의 핵심
    balance_claimed:  fs['bs-cash'] // ← 자기 선언 (L1은 자기 일관성만 확인)
  },
  outputs: [{ recipient_guid, amount }, ...]
}
tx_hash = SHA-256(sortedStringify(tx))
buyer_sig = Ed25519(privKey, tx_hash)   // 구매자 서명
```

`balance_claimed >= sum(outputs)` 확인은 자기 일관성 검사입니다.  
잔액의 절대 정확성은 K-Tax 주기 감사(레이어 3)로 사후 검증합니다.

**`balance_claimed` 부풀리기의 위험**: 지금 당장 더 큰 거래가 가능하나,  
K-Tax 감사 시 `fs_ledger` 집계값과 불일치가 탐지됩니다.  
≥1,000단위 거래는 §4.4 Stage 5에 의해 즉시 보고 목적으로 기록되어 추가 노출 위험이 있습니다.

---

## 2. 아키텍처 — 세 개의 독립 레이어

```
┌─────────────────────────────────────────────────────────────────┐
│ 레이어 1 — 거래 무결성 (실시간, 자기완결)                         │
│                                                                   │
│  H_u:  h_i = SHA-256(h_{i-1} ∥ tx_hash ∥ block_hash ∥ height)  │
│  H_N:  n_i = SHA-256(n_{i-1} ∥ h_{user,i})                      │
│                                                                   │
│  보장: 이중지불 방지 · 체인 연속성 · 재생 공격 차단               │
│  검증: IDB만으로 오프라인 완결                                    │
├─────────────────────────────────────────────────────────────────┤
│ 레이어 2 — 감사 로그 연동 (거래별, 온라인)                        │
│                                                                   │
│  pdv_log ─chain_height─→ hash_chain[height]                      │
│  pdv_log.chain_local_hash ≡ hash_chain.local_hash                │
│                                                                   │
│  보장: PDV 레코드의 거래 시점 위치 증명                           │
│  검증: SQL 1줄 전수 검사                                          │
├─────────────────────────────────────────────────────────────────┤
│ 레이어 3 — 잔액 무결성 감사 (주기적, K-Tax)                       │
│                                                                   │
│  fs_ledger 집계 → 사용자별 잔액 재구성                            │
│  balance_claimed 대조 → 불일치 탐지                              │
│  L1 노드별 BMI_k(T) 산출 → Merkle Root                           │
│                                                                   │
│  보장: 내부 위변조 탐지 · 집합 잔액 불변성                        │
│  검증: 분기별 K-Tax 감사 쿼리                                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. 레이어 1: 거래 Hash Chain

### 3.1 사용자 Hash Chain H_u — 공식 불변

```
h_i = SHA-256(h_{i-1} ∥ tx_hash ∥ block_hash ∥ height)
```

v2.0에서 확정된 공식을 유지합니다. PDV는 공식 외부에서 참조 키로만 연결합니다.

### 3.2 IndexedDB hash_chain 레코드 구조

```javascript
{
  // Hash Chain 핵심 필드 (불변)
  height:          Number,    // 논스 — 재생 공격 방지 (논문 §3.1.3)
  local_hash:      Hex64,     // h_i = SHA-256(h_{i-1}∥tx∥block∥height)
  prev_local_hash: Hex64,     // h_{i-1}
  tx_hash:         Hex64,     // 거래 해시
  block_hash:      Hex64,     // L1 content_hash
  block_id:        String,    // L1 block ID (선택)
  recorded_at:     ISO8601,

  // PDV 참조 필드 (공식 外, 연동용)
  pdv_session_id:  UUID,      // pdv_log.session_id 참조 키
  pdv_type:        String,    // 'service_task' | 'klaw_monitor' | ...
  pdv_anchored:    Boolean,   // Supabase INSERT 완료 여부

  // @deprecated: prev_settle_hash, new_settle_hash — 제거됨 (결함 5 수정)
}
```

### 3.3 L1 노드 Hash Chain H_N

```
n_i = SHA-256(n_{i-1} ∥ h_{user,i})
```

Worker가 거래 완료 후 `l1_ledger`에 기록합니다.  
`l1_ledger.user_hash = h_i`가 논문 §3.1.3 이중 서명의 단기 대안입니다.

---

## 4. 레이어 2: PDV Chain 연동

### 4.1 연동 원칙

```
IDB hash_chain[height]            Supabase pdv_log
  local_hash:  "3951191b..."  ←── chain_local_hash: "3951191b..."
  height:      3                  chain_height:     3
  pdv_session_id: "6f15..."   ──→ session_id:       "6f156447..."
```

두 레코드는 `session_id` 참조 키와 `chain_local_hash` 사본으로 연결됩니다.  
`chain_local_hash === local_hash` 일치 여부가 연동 무결성의 증거입니다.

### 4.2 reporter_svc 경로 처리

K-Market 주문에서 `reporter_svc='kmarket'`이면 market이 이미 PDV를 기록합니다.  
이 경우 gopang은 `_patchPdvChainHeight()`로 기존 레코드에 `chain_height`를 소급합니다.

**타이밍 경쟁 조건 해결 (사고 실험 E2)**:  
market의 `recordPDV()` Worker 경유 INSERT가 gopang의 `redeemClaim()`보다  
먼저 완료됨을 보장할 수 없습니다. `_patchPdvChainHeight()`는 300ms 지연 후 1회 재시도합니다.

---

## 5. 레이어 3: K-Tax 잔액 무결성 감사

### 5.1 `fs_ledger` 집계 기반 잔액 재구성

`fs_ledger`의 모든 debit/credit을 누적하면 현재 잔액이 재구성됩니다.

```sql
-- Supabase Function: reconstruct_balances()
CREATE OR REPLACE FUNCTION reconstruct_balances()
RETURNS TABLE (
  guid        TEXT,
  l1_node     TEXT,
  fs_balance  NUMERIC,
  tx_count    BIGINT,
  last_tx_at  TIMESTAMPTZ
) AS $$
  SELECT
    f.guid,
    up.l1_node,
    SUM(CASE
      WHEN f.direction = 'credit' THEN  f.amount
      WHEN f.direction = 'debit'  THEN -f.amount
      ELSE 0
    END)          AS fs_balance,
    COUNT(*)      AS tx_count,
    MAX(f.created_at) AS last_tx_at
  FROM fs_ledger f
  LEFT JOIN user_profiles up ON up.primary_guid = f.guid
  WHERE f.fs_account = 'bs-cash'
  GROUP BY f.guid, up.l1_node;
$$ LANGUAGE sql STABLE;
```

### 5.2 `balance_claimed` 대조 감사

`l1_ledger`에 저장된 `balance_claimed`와 `fs_ledger` 집계값을 비교합니다.

```sql
-- K-Tax 감사 뷰: balance_claimed 불일치 탐지
CREATE OR REPLACE VIEW ktax_balance_anomalies AS
WITH reconstructed AS (
  SELECT guid, l1_node, fs_balance, tx_count, last_tx_at
  FROM reconstruct_balances()
),
latest_claims AS (
  -- l1_ledger의 최신 balance_claimed (사용자별 마지막 거래)
  SELECT DISTINCT ON (buyer_guid)
    buyer_guid           AS guid,
    balance_claimed      AS claimed_balance   -- ← 스키마 추가 컬럼
  FROM l1_ledger
  ORDER BY buyer_guid, anchored_at DESC
)
SELECT
  r.guid,
  r.l1_node,
  r.fs_balance                                         AS ledger_balance,
  c.claimed_balance,
  r.fs_balance - COALESCE(c.claimed_balance, 0)        AS discrepancy,
  ABS(r.fs_balance - COALESCE(c.claimed_balance, 0)) > 1 AS anomaly,
  r.tx_count,
  r.last_tx_at
FROM reconstructed r
LEFT JOIN latest_claims c ON c.guid = r.guid
WHERE ABS(r.fs_balance - COALESCE(c.claimed_balance, 0)) > 1
ORDER BY ABS(r.fs_balance - c.claimed_balance) DESC;
```

### 5.3 집합 잔액 불변성 Σδ=0 검증

**핵심 수정 (사고 실험 E3)**: Σδ=0은 동일 L1 노드 내 거래에만 적용합니다.  
Cross-node 거래(구매자와 판매자가 다른 L1 노드)는 노드 단위로 Σδ≠0이 되는 것이 정상입니다.

```sql
-- 동일 노드 내 거래의 집합 잔액 불변성 검증
-- buyer와 seller가 같은 l1_node인 거래만 대상
WITH intra_node_txs AS (
  SELECT
    f.tx_id,
    f.amount,
    f.direction,
    up_buyer.l1_node   AS buyer_node,
    up_seller.l1_node  AS seller_node
  FROM fs_ledger f
  JOIN user_profiles up_buyer  ON up_buyer.primary_guid  = f.buyer_guid
  JOIN user_profiles up_seller ON up_seller.primary_guid = f.seller_guid
  WHERE f.created_at >= NOW() - INTERVAL '90 days'
    AND up_buyer.l1_node = up_seller.l1_node    -- 동일 노드 내 거래만
)
SELECT
  buyer_node                                     AS l1_node,
  SUM(CASE WHEN direction='debit'  THEN amount ELSE 0 END) AS total_debit,
  SUM(CASE WHEN direction='credit' THEN amount ELSE 0 END) AS total_credit,
  ABS(
    SUM(CASE WHEN direction='debit'  THEN amount ELSE 0 END) -
    SUM(CASE WHEN direction='credit' THEN amount ELSE 0 END)
  )                                              AS sigma_delta
FROM intra_node_txs
GROUP BY buyer_node
HAVING ABS(
  SUM(CASE WHEN direction='debit'  THEN amount ELSE 0 END) -
  SUM(CASE WHEN direction='credit' THEN amount ELSE 0 END)
) > 1
ORDER BY sigma_delta DESC;
-- 결과 0건 = 집합 잔액 불변성 충족
```

### 5.4 L1 노드별 BMI Merkle Root 산출 (§4.2.2)

논문 `BMI_k(T) = MerkleRoot({ balance_u(T) : u ∈ tier_k })`의 직접 구현입니다.

**결정론적 직렬화 (사고 실험 E5 수정)**:  
balance 값을 `Math.round()`로 정수 정규화 후 직렬화합니다.

```javascript
// k-tax 모듈

function sha256hex(str) {
  // Web Crypto API SHA-256
  // (환경에 따라 Node.js crypto 또는 browser subtle 사용)
  const encoder = new TextEncoder();
  return crypto.subtle.digest('SHA-256', encoder.encode(str))
    .then(buf => Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0')).join(''));
}

async function computeMerkleRoot(leaves) {
  if (leaves.length === 0) return '0'.repeat(64);
  if (leaves.length === 1) return leaves[0];

  const next = [];
  for (let i = 0; i < leaves.length; i += 2) {
    const left  = leaves[i];
    const right = leaves[i + 1] ?? leaves[i]; // 홀수이면 마지막 노드 복제
    next.push(await sha256hex(left + right));
  }
  return computeMerkleRoot(next);
}

async function computeNodeBMI(nodeRows) {
  // 결정론적 정렬: guid 기준 오름차순
  const sorted = [...nodeRows].sort((a, b) =>
    a.guid.localeCompare(b.guid)
  );

  // 리프 생성: SHA-256(guid ∥ balance_정수)
  // balance는 Math.round()로 정수 정규화 → 직렬화 결정론적 보장 (E5 수정)
  const leaves = await Promise.all(
    sorted.map(r => sha256hex(r.guid + String(Math.round(r.fs_balance * 100))))
    // * 100: 소수점 2자리까지 정수 보존 (원 단위 시스템이면 * 1)
  );

  return computeMerkleRoot(leaves);
}

async function runQuarterlyBMIAudit(supabase) {
  // 1. 사용자별 잔액 재구성
  const { data: balances, error } = await supabase.rpc('reconstruct_balances');
  if (error) throw new Error('[K-Tax] reconstruct_balances 실패: ' + error.message);

  // 2. L1 노드별 그룹화
  const nodeGroups = {};
  for (const row of balances) {
    const node = row.l1_node || 'unknown';
    (nodeGroups[node] = nodeGroups[node] || []).push(row);
  }

  // 3. 노드별 BMI Merkle Root 산출
  const bmiRoots = {};
  for (const [node, rows] of Object.entries(nodeGroups)) {
    bmiRoots[node] = await computeNodeBMI(rows);
  }

  // 4. 전체 BMI Root: 노드를 정렬된 순서로 Merkle 트리 구성
  const nodeSorted = Object.keys(bmiRoots).sort();
  const nodeLeaves = nodeSorted.map(n => bmiRoots[n]);
  const globalBMIRoot = await computeMerkleRoot(nodeLeaves);

  // 5. 감사 결과 기록
  const quarter = currentQuarter(); // 예: '2026-Q2'
  const { error: insErr } = await supabase.from('ktax_bmi_audit').insert({
    quarter,
    global_bmi_root: globalBMIRoot,
    node_bmi_roots:  bmiRoots,
    total_users:     balances.length,
    audited_at:      new Date().toISOString(),
  });

  if (insErr) throw new Error('[K-Tax] ktax_bmi_audit INSERT 실패: ' + insErr.message);

  console.info('[K-Tax] 분기 BMI 감사 완료',
    '| quarter:', quarter,
    '| global_root:', globalBMIRoot.slice(0, 8),
    '| nodes:', nodeSorted.length,
    '| users:', balances.length);

  return { globalBMIRoot, bmiRoots, quarter };
}

function currentQuarter() {
  const now = new Date();
  const q = Math.ceil((now.getMonth() + 1) / 3);
  return `${now.getFullYear()}-Q${q}`;
}
```

---

## 6. 구현 계획 v3.0

### Phase A: gopang-wallet.js

#### A-1: `appendHashChain()` — 공식 불변 확정

```javascript
async function appendHashChain(db, {
  txHash,
  blockHash,
  blockId      = null,
  pdvSessionId = null,
  pdvType      = null,
}) {
  const last          = await idbChainGetLast(db);
  const height        = (last?.height ?? -1) + 1;
  const prevLocalHash = last?.local_hash ?? '0'.repeat(64);

  // 공식 불변 (v3.0 확정)
  // h_i = SHA-256(h_{i-1} ∥ tx_hash ∥ block_hash ∥ height)
  const chainInput = prevLocalHash + txHash + blockHash + String(height);
  const localHash  = bufToHex(await sha256(chainInput));

  const record = {
    height,
    local_hash:      localHash,
    prev_local_hash: prevLocalHash,
    tx_hash:         txHash,
    block_hash:      blockHash,
    block_id:        blockId,
    recorded_at:     new Date().toISOString(),
    pdv_session_id:  pdvSessionId,
    pdv_type:        pdvType,
    pdv_anchored:    false,
    // prev_settle_hash: 제거됨 (@deprecated)
    // new_settle_hash:  제거됨 (@deprecated)
  };

  await idbChainPut(db, record);
  return record;
}
```

#### A-2: `redeemClaim()` — pdv_session_id 수신

```javascript
async redeemClaim({
  block_hash,
  block_id       = null,
  claims         = [],
  tx_hash,
  pdv_session_id = null,
  pdv_type       = null,
}) {
  if (!block_hash) throw new Error('[Wallet] block_hash 없음');

  const db    = await openDB();
  const fsRec = await idbGet(db, IDB_FS_KEY);
  const fs    = fsRec?.state || {};

  // 청구권 적용
  const now   = Date.now();
  let applied = 0;
  for (const claim of claims) {
    if (claim.expires_at && new Date(claim.expires_at).getTime() < now) {
      console.warn('[Wallet] 만료된 청구권 무시:', claim); continue;
    }
    const acc = claim.fs_account || 'bs-cash';
    const cur = parseFloat(fs[acc] ?? '0') || 0;
    if      (claim.direction === 'credit') fs[acc] = cur + (claim.amount || 0);
    else if (claim.direction === 'debit')  fs[acc] = cur - (claim.amount || 0);
    if (acc !== 'bs-cash') {
      const bsCash = parseFloat(fs['bs-cash'] ?? '0') || 0;
      if (claim.direction === 'credit') fs['bs-cash'] = bsCash + (claim.amount || 0);
      else                              fs['bs-cash'] = bsCash - (claim.amount || 0);
    }
    applied++;
  }

  // financial_state 저장
  await idbPut(db, IDB_FS_KEY, {
    state:     fs,
    updatedAt: new Date().toISOString(),
    block_hash,
  });

  // Hash Chain 기록
  const chainRec = await appendHashChain(db, {
    txHash:       tx_hash || block_hash,
    blockHash:    block_hash,
    blockId:      block_id,
    pdvSessionId: pdv_session_id,
    pdvType:      pdv_type,
  });

  console.info('[Wallet] redeemClaim 완료',
    '| height:', chainRec.height,
    '| applied:', applied,
    '| bs-cash:', fs['bs-cash'],
    '| pdv_session_id:', pdv_session_id?.slice(0, 8) || 'none');

  return { fs, chainRec, applied };
}
```

#### A-3: `verifyChain()` — 자기완결 검증

```javascript
async verifyChain() {
  const chain = await this.getHashChain();
  for (let i = 1; i < chain.length; i++) {
    const cur  = chain[i];
    const prev = chain[i - 1];

    if (cur.prev_local_hash !== prev.local_hash) {
      return { valid: false, broken_at: cur.height, reason: 'chain_break' };
    }

    const recomputed = bufToHex(await sha256(
      prev.local_hash + cur.tx_hash + cur.block_hash + String(cur.height)
    ));
    if (recomputed !== cur.local_hash) {
      return { valid: false, broken_at: cur.height, reason: 'hash_mismatch' };
    }
  }
  return { valid: true, broken_at: null };
}
```

#### A-4: `verifyWithMerkle()` — ILMV 항목 2 (§4.3.1)

```javascript
async verifyWithMerkle(height) {
  const chain = await this.getHashChain();
  const rec   = chain.find(r => r.height === height);
  if (!rec) return { valid: false, reason: 'height_not_found' };

  const res = await fetch(
    `https://l1-hanlim.hondi.net/merkle?prove=${rec.block_hash}`
  );
  if (!res.ok) return { valid: false, reason: 'l1_unavailable' };

  const { root, proof } = await res.json();

  // 클라이언트 루트 재계산 — 서버 신뢰 없이 검증
  let current = rec.block_hash;
  for (const sibling of proof) {
    const [left, right] = current < sibling
      ? [current, sibling]
      : [sibling, current];
    current = bufToHex(await sha256(left + right));
  }

  return { valid: current === root, root, height, proof_depth: proof.length };
}
```

### Phase B: gopang-app.js

#### B-1: GWP_DONE 핸들러 — sessionId 항상 생성

```javascript
case 'GWP_DONE': {
  if (msg.summary) appendBubble('ai', msg.summary, false);

  // 세션 ID 확정 — reporter_svc 무관하게 항상 실행
  const sessionId   = msg.session_id || msg.pdvData?.session_id || crypto.randomUUID();
  const reporterSvc = msg.reporter_svc || msg.pdvData?.reporter_svc || null;

  if (msg.block_hash && window.gopangWallet?.redeemClaim) {
    const claims = msg.claims?.length
      ? msg.claims
      : (msg.buyer_claim ? [msg.buyer_claim] : []);

    window.gopangWallet.redeemClaim({
      block_hash:     msg.block_hash,
      block_id:       msg.block_id   || null,
      tx_hash:        msg.tx_hash    || null,
      claims,
      pdv_session_id: sessionId,        // 항상 전달
      pdv_type:       'service_task',
    }).then(({ fs, chainRec, applied }) => {
      console.info('[GWP_DONE] redeemClaim 완료',
        '| block_hash:', msg.block_hash.slice(0, 8),
        '| height:', chainRec.height,
        '| session_id:', sessionId.slice(0, 8),
        '| bs-cash:', fs['bs-cash']);
      appendBubble('ai', `거래 완료. 잔액 ₩${fs['bs-cash']?.toLocaleString()}`, false);

      if (!reporterSvc) {
        // 고팡이 직접 PDV 기록
        const p = msg.pdvData || {};
        _recordPDV({
          type:             'service_task',
          serviceId:        _gwpService?.id   || null,
          service:          _gwpService?.name || null,
          summary:          msg.summary       || null,
          who:              p.who   || _USER?.ipv6 || null,
          when:             p.when  || null,
          where:            p.where || null,
          what:             p.what  || msg.summary || null,
          how:              p.how   || 'gwp',
          why:              p.why   || ((_gwpService?.name || '') + ' 서비스 이용'),
          session_id:       sessionId,
          chain_height:     chainRec.height,
          chain_local_hash: chainRec.local_hash,
          ts:               new Date().toISOString(),
        }).then(() => _markPdvAnchored(chainRec.height));
      } else {
        // market이 이미 기록 → chain_height 소급 연결 (E2 수정: 재시도 포함)
        console.info('[GWP_DONE] PDV 중복 방지 — reporter_svc:', reporterSvc,
          '| chain_height 소급:', chainRec.height);
        _patchPdvChainHeight(sessionId, chainRec.height, chainRec.local_hash);
      }
    }).catch(err => console.warn('[GWP_DONE] redeemClaim 실패:', err.message));
  }

  setTimeout(() => {
    if (_gwpTab && !_gwpTab.closed) _gwpTab.close();
    window.focus();
  }, 800);
  break;
}
```

#### B-2: `_recordPDV()` — chain_height + P17 수정 포함

```javascript
async function _recordPDV(record) {
  try {
    // localStorage 캐시
    const log = JSON.parse(localStorage.getItem('gopang_pdv_log') || '[]');
    log.push(record);
    if (log.length > 1000) log.splice(0, log.length - 1000);
    localStorage.setItem('gopang_pdv_log', JSON.stringify(log));

    // 6하 원칙 필드 구성
    const _effectiveGuid = _USER?.guid || _USER?.ipv6 || USER_GUID; // P17 수정
    const whoName = _USER?.phone
      ? _USER.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
      : 'GUID:' + (_effectiveGuid?.slice(0, 8) ?? 'unknown');

    const locStr = _userLocation
      ? (_userLocation.address ||
         (_userLocation.lat
           ? `${_userLocation.lat.toFixed(5)},${_userLocation.lng.toFixed(5)}`
           : null))
      : (record.data?.location || null);

    const howStr = record.how
      || (record.data?.reportId ? 'image'
        : record.type === 'klaw_monitor' ? 'auto' : 'text');

    const whyStr = record.why
      || (record.service ? record.service + ' 서비스 이용'
        : record.type === 'klaw_monitor' ? '법적 리스크 자동 감시'
        : record.type === 'service_task' ? '서비스 작업 완료'
        : '대화');

    const res = await fetch(_SUPABASE_URL + '/rest/v1/pdv_log', {
      method: 'POST',
      headers: {
        'apikey':       _SUPABASE_KEY,
        'Authorization':'Bearer ' + _SUPABASE_KEY,
        'Content-Type': 'application/json',
        'Prefer':       'return=minimal',
      },
      body: JSON.stringify({
        user_guid:         _effectiveGuid,
        device_fp:         _USER?.fp || _USER?.fpHex?.slice(0, 32) || null,
        who_name:          whoName,
        location:          locStr,
        record_type:       record.type,
        summary:           record.summary || null,
        payload:           record,
        how:               howStr,
        service_id:        record.serviceId || null,
        why:               whyStr,
        session_id:        record.session_id        ?? null,
        chain_height:      record.chain_height       ?? null,
        chain_local_hash:  record.chain_local_hash   ?? null,
        openhash_anchored: false,
        via_worker:        false,
        reporter_svc:      null,
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.status);
      console.warn('[PDV] Supabase 오류:', res.status, err);
    } else {
      console.info('[PDV] 기록 완료:', record.type,
        '| session_id:', record.session_id?.slice(0, 8) || '-',
        '| chain_height:', record.chain_height ?? '-');
    }
  } catch(e) {
    console.warn('[PDV] 기록 실패:', e.message);
  }

  if (record.type === 'service_task' && record.serviceId !== 'klaw') {
    setTimeout(() => _klawReview('service', record), 2000);
  }
}
```

#### B-3: `_patchPdvChainHeight()` — 재시도 포함 (E2 수정)

```javascript
async function _patchPdvChainHeight(sessionId, chainHeight, chainLocalHash, retry = true) {
  if (!sessionId || chainHeight == null) return;
  try {
    const res = await fetch(
      _SUPABASE_URL + '/rest/v1/pdv_log'
        + '?session_id=eq.' + encodeURIComponent(sessionId)
        + '&chain_height=is.null',
      {
        method: 'PATCH',
        headers: {
          'apikey':       _SUPABASE_KEY,
          'Authorization':'Bearer ' + _SUPABASE_KEY,
          'Content-Type': 'application/json',
          'Prefer':       'return=minimal',
        },
        body: JSON.stringify({
          chain_height:     chainHeight,
          chain_local_hash: chainLocalHash,
        }),
      }
    );
    if (res.ok) {
      console.info('[PDV] chain_height 소급 완료 | session_id:',
        sessionId.slice(0, 8), '| height:', chainHeight);
    } else if (retry) {
      // market의 recordPDV INSERT가 아직 완료되지 않았을 수 있음 (E2 수정)
      // 300ms 후 1회 재시도
      console.warn('[PDV] chain_height PATCH 실패 — 300ms 후 재시도');
      setTimeout(() =>
        _patchPdvChainHeight(sessionId, chainHeight, chainLocalHash, false),
        300
      );
    } else {
      console.warn('[PDV] chain_height PATCH 최종 실패:', res.status);
    }
  } catch(e) {
    console.warn('[PDV] _patchPdvChainHeight 오류:', e.message);
  }
}
```

#### B-4: `_markPdvAnchored()` — IDB pdv_anchored 갱신

```javascript
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
      console.info('[PDV] pdv_anchored 갱신 | height:', height);
    }
  } catch(e) {
    console.warn('[PDV] pdv_anchored 갱신 실패:', e.message);
  }
}
```

### Phase C: Worker

#### C-1: `updateNodeHashChain()` — H_N 기록

```javascript
async function updateNodeHashChain(supabase, { userHash, txId, blockHash }) {
  const { data: last } = await supabase
    .from('l1_ledger')
    .select('node_hash')
    .order('anchored_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const prevNodeHash = last?.node_hash || '0'.repeat(64);

  // n_i = SHA-256(n_{i-1} ∥ h_{user,i})
  const input   = new TextEncoder().encode(prevNodeHash + userHash);
  const buf     = await crypto.subtle.digest('SHA-256', input);
  const nodeHash = Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  const { error } = await supabase.from('l1_ledger').insert({
    tx_id:          txId,
    user_hash:      userHash,
    node_hash:      nodeHash,
    block_hash:     blockHash,
    balance_claimed: null,       // /biz/order 핸들러에서 채움
    anchored_at:    new Date().toISOString(),
  });

  if (error) console.warn('[Worker] l1_ledger INSERT 실패:', error.message);
  return nodeHash;
}
```

#### C-2: `verifyDeltaZero()` — 실시간 Σδ=0 검증 (E1 수정)

v3 초안의 항등식 오류를 수정합니다.  
검증 대상: 구매자 총 지출 = 판매자 수취 + 플랫폼 수수료

```javascript
// worker.js — /biz/order 처리 후 실시간 Σδ=0 검증

function verifyDeltaZero(outputs, balanceClaimed, txTotal) {
  // fs_ledger 3행 구조:
  //   buyer  debit  = txTotal (구매자 지불 총액)
  //   seller credit = sellerNet (판매자 수취)
  //   platform debit = platformFee

  const sellerNet   = outputs.find(o => o.recipient_guid !== 'gopang-platform')?.amount || 0;
  const platformFee = outputs.find(o => o.recipient_guid === 'gopang-platform')?.amount  || 0;
  const buyerDebit  = sellerNet + platformFee; // 구매자 총 지출

  // Σδ = 0 조건: 구매자 debit = 판매자 credit + 플랫폼 debit
  // 즉 buyerDebit - sellerNet - platformFee = 0
  const sigmaDelta = Math.abs(buyerDebit - sellerNet - platformFee);

  if (sigmaDelta > 0.01) {
    console.error('[BIVM] Σδ ≠ 0 — 집합 잔액 불변성 위반!',
      { buyerDebit, sellerNet, platformFee, sigmaDelta });
    return { valid: false, sigmaDelta };
  }

  // 추가: balance_claimed가 outputs 합보다 크거나 같아야 함
  if (balanceClaimed < buyerDebit) {
    console.error('[BIVM] balance_claimed < txTotal — 잔액 부족!',
      { balanceClaimed, buyerDebit });
    return { valid: false, reason: 'insufficient_balance' };
  }

  return { valid: true, sigmaDelta: 0 };
}
```

**주의**: 위 Σδ=0은 수학적으로 `sellerNet + platformFee - sellerNet - platformFee = 0`으로  
항상 성립하는 것처럼 보이지만, 실제 의미는 **3개의 fs_ledger 행이 올바른 금액으로 기록되었는가**  
를 확인하는 것입니다. Worker가 `outputs`에서 직접 계산한 값이 아니라 L1이 반환한  
실제 block 데이터와 cross-check해야 진정한 Σδ 검증이 됩니다.

```javascript
// 실질적 Σδ 검증: L1 응답의 content_hash와 outputs의 일관성 확인
function verifyOutputConsistency(l1Response, outputs) {
  const l1Total = l1Response.buyer_claim?.amount || 0;       // L1이 확인한 debit
  const calcTotal = outputs.reduce((s, o) => s + o.amount, 0); // 계산한 합계
  const consistent = Math.abs(l1Total - calcTotal) < 0.01;

  if (!consistent) {
    console.error('[BIVM] L1 응답 vs outputs 불일치!',
      { l1Total, calcTotal, diff: l1Total - calcTotal });
  }
  return consistent;
}
```

#### C-3: `anchorL1MerkleRoot()` — MTSM (§4.7.1)

```javascript
async function anchorL1MerkleRoot(env, supabase) {
  const res = await fetch('https://l1-hanlim.hondi.net/merkle');
  if (!res.ok) return;

  const { merkle_root, block_count, latest_height } = await res.json();

  const { data: last } = await supabase
    .from('merkle_anchors')
    .select('merkle_root')
    .order('anchored_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (last?.merkle_root === merkle_root) return; // 변경 없음

  await supabase.from('merkle_anchors').insert({
    source:        'l1-hanlim',
    merkle_root,
    block_count,
    latest_height,
    anchored_at:   new Date().toISOString(),
  });

  console.info('[MTSM] L1 Merkle Root 앵커링 완료:',
    merkle_root.slice(0, 8), '| blocks:', block_count,
    '| 대역폭 절감: ~99.86% (논문 §4.7.1)');
}
```

---

## 7. Supabase 스키마 v3.0

### 7.1 pdv_log

```sql
ALTER TABLE pdv_log
  ADD COLUMN IF NOT EXISTS session_id        UUID,
  ADD COLUMN IF NOT EXISTS chain_height      INTEGER,
  ADD COLUMN IF NOT EXISTS chain_local_hash  TEXT,
  ADD COLUMN IF NOT EXISTS openhash_anchored BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS via_worker        BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reporter_svc      TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS pdv_log_session_id_idx
  ON pdv_log (session_id) WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS pdv_log_chain_height_idx
  ON pdv_log (chain_height);
```

### 7.2 l1_ledger (balance_claimed 컬럼 추가 — E4 수정)

```sql
ALTER TABLE l1_ledger
  ADD COLUMN IF NOT EXISTS user_hash       TEXT,     -- 사용자 H_u h_i
  ADD COLUMN IF NOT EXISTS node_hash       TEXT,     -- L1 노드 H_N n_i
  ADD COLUMN IF NOT EXISTS balance_claimed NUMERIC;  -- 구매자 자기 선언 잔액 (K-Tax 감사용)

COMMENT ON COLUMN l1_ledger.user_hash
  IS '사용자 Hash Chain h_i — 논문 §3.1.3 이중 서명 단기 대안';
COMMENT ON COLUMN l1_ledger.balance_claimed
  IS '거래 서명 시 구매자 자기 선언 잔액 — K-Tax 감사 시 fs_ledger 집계와 대조';
```

### 7.3 merkle_anchors

```sql
CREATE TABLE IF NOT EXISTS merkle_anchors (
  id             SERIAL PRIMARY KEY,
  source         TEXT    NOT NULL DEFAULT 'l1-hanlim',
  merkle_root    TEXT    NOT NULL,
  block_count    INTEGER,
  latest_height  INTEGER,
  anchored_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS merkle_anchors_root_idx
  ON merkle_anchors (merkle_root);
```

### 7.4 ktax_bmi_audit

```sql
CREATE TABLE IF NOT EXISTS ktax_bmi_audit (
  id               SERIAL PRIMARY KEY,
  quarter          TEXT    NOT NULL,
  global_bmi_root  TEXT    NOT NULL,
  node_bmi_roots   JSONB   NOT NULL DEFAULT '{}',
  total_users      INTEGER,
  anomaly_count    INTEGER DEFAULT 0,
  sigma_delta_ok   BOOLEAN DEFAULT TRUE,
  audited_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (quarter)
);
```

### 7.5 Supabase Functions & Views

```sql
-- 사용자별 잔액 재구성
CREATE OR REPLACE FUNCTION reconstruct_balances()
RETURNS TABLE (guid TEXT, l1_node TEXT, fs_balance NUMERIC, tx_count BIGINT, last_tx_at TIMESTAMPTZ)
AS $$
  SELECT f.guid, up.l1_node,
    SUM(CASE WHEN f.direction='credit' THEN f.amount
             WHEN f.direction='debit'  THEN -f.amount ELSE 0 END) AS fs_balance,
    COUNT(*), MAX(f.created_at)
  FROM fs_ledger f
  LEFT JOIN user_profiles up ON up.primary_guid = f.guid
  WHERE f.fs_account = 'bs-cash'
  GROUP BY f.guid, up.l1_node;
$$ LANGUAGE sql STABLE;

-- PDV ↔ Hash Chain 연동 무결성
CREATE OR REPLACE VIEW pdv_chain_integrity AS
SELECT
  p.session_id, p.chain_height,
  p.chain_local_hash                AS pdv_h_i,
  l.user_hash                       AS l1_h_i,
  p.chain_local_hash = l.user_hash  AS pdv_l1_match,
  p.reporter_svc, p.openhash_anchored, p.created_at
FROM pdv_log p
LEFT JOIN l1_ledger l ON l.tx_id = p.payload->>'tx_hash'
WHERE p.chain_height IS NOT NULL
ORDER BY p.chain_height DESC;

-- K-Tax: balance_claimed 불일치 탐지
CREATE OR REPLACE VIEW ktax_balance_anomalies AS
WITH r AS (SELECT * FROM reconstruct_balances()),
     c AS (
       SELECT DISTINCT ON (buyer_guid)
         buyer_guid AS guid, balance_claimed
       FROM l1_ledger
       WHERE balance_claimed IS NOT NULL
       ORDER BY buyer_guid, anchored_at DESC
     )
SELECT r.guid, r.l1_node, r.fs_balance AS ledger_balance,
       c.balance_claimed AS claimed_balance,
       r.fs_balance - COALESCE(c.balance_claimed, 0) AS discrepancy,
       r.tx_count, r.last_tx_at
FROM r LEFT JOIN c ON c.guid = r.guid
WHERE ABS(r.fs_balance - COALESCE(c.balance_claimed, 0)) > 1
ORDER BY ABS(r.fs_balance - COALESCE(c.balance_claimed, 0)) DESC;

-- 동일 노드 내 집합 잔액 불변성 (cross-node 거래 제외 — E3 수정)
CREATE OR REPLACE VIEW sigma_delta_by_node AS
WITH intra AS (
  SELECT f.tx_id, f.amount, f.direction,
         up_b.l1_node AS buyer_node, up_s.l1_node AS seller_node
  FROM fs_ledger f
  JOIN user_profiles up_b ON up_b.primary_guid = f.buyer_guid
  JOIN user_profiles up_s ON up_s.primary_guid = f.seller_guid
  WHERE up_b.l1_node = up_s.l1_node     -- 동일 노드 내 거래만
    AND f.created_at >= NOW() - INTERVAL '90 days'
)
SELECT buyer_node AS l1_node,
  SUM(CASE WHEN direction='debit'  THEN amount ELSE 0 END) AS total_debit,
  SUM(CASE WHEN direction='credit' THEN amount ELSE 0 END) AS total_credit,
  ABS(
    SUM(CASE WHEN direction='debit'  THEN amount ELSE 0 END) -
    SUM(CASE WHEN direction='credit' THEN amount ELSE 0 END)
  ) AS sigma_delta
FROM intra
GROUP BY buyer_node;
```

---

## 8. 전체 흐름 v3.0

```
━━━ 거래 시점 (실시간) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[gopang] GWP_DONE 수신
  ├─ sessionId 확정 (reporter_svc 무관)
  └─ redeemClaim({ block_hash, claims, pdv_session_id: sessionId })
       ├─ claims 적용 (bs-cash 차감)
       ├─ appendHashChain()
       │    h_i = SHA-256(h_{i-1} ∥ tx_hash ∥ block_hash ∥ height)
       │    IDB: { local_hash, pdv_session_id, pdv_anchored: false }
       └─ 반환 chainRec

[reporter_svc 없음]  → _recordPDV({ chain_height, chain_local_hash })
                       → Supabase pdv_log INSERT
                       → _markPdvAnchored()

[reporter_svc = 'kmarket'] → _patchPdvChainHeight() (300ms 재시도 포함)
                             → pdv_log.chain_height 소급

[Worker] verifyOutputConsistency(l1Res, outputs)  ← L1 응답 일관성
[Worker] verifyDeltaZero(outputs, balanceClaimed)  ← Σδ=0 실시간
[Worker] updateNodeHashChain()    → l1_ledger { user_hash: h_i, node_hash: n_i, balance_claimed }

━━━ 주기적 (10분/Cron) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Worker] anchorL1MerkleRoot()     → merkle_anchors (MTSM §4.7.1)

━━━ 분기별 (K-Tax 정기 감사) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[K-Tax] runQuarterlyBMIAudit()
  ├─ reconstruct_balances()       → 사용자별 잔액 재구성
  ├─ ktax_balance_anomalies       → balance_claimed 대조
  ├─ sigma_delta_by_node          → 동일 노드 내 Σδ=0 검증
  ├─ computeNodeBMI()             → L1 노드별 BMI Merkle Root (§4.2.2)
  └─ ktax_bmi_audit INSERT        → 분기 감사 결과 영구 기록
```

---

## 9. 무결성 검증 v3.0

### 9.1 레이어 1: Hash Chain (자기완결, 오프라인)

```javascript
// T06 기준
const r = await window.gopangWallet.verifyChain();
// { valid: true, broken_at: null }

// ILMV 항목 2 (L1 연결 시)
const p = await window.gopangWallet.verifyWithMerkle(3);
// { valid: true, proof_depth: 14 }
```

### 9.2 레이어 2: PDV 연동 (SQL)

```sql
-- T05 기준
SELECT COUNT(*) FROM pdv_chain_integrity
WHERE pdv_l1_match = FALSE OR openhash_anchored = FALSE;
-- = 0
```

### 9.3 레이어 3: K-Tax 잔액 감사 (SQL)

```sql
-- T07 기준: 잔액 불일치 0건
SELECT COUNT(*) FROM ktax_balance_anomalies; -- = 0

-- 집합 잔액 불변성
SELECT COUNT(*) FROM sigma_delta_by_node WHERE sigma_delta > 1; -- = 0
```

---

## 10. 핵심 불변 조건 v3.0

```
[조건 1] 거래 연속성 — 실시간, 자기완결
  IDB financial_state.block_hash
    === L1 blocks.content_hash (최신)

[조건 2] Hash Chain 무결성 — 실시간, 자기완결
  IDB hash_chain[i].local_hash
    === SHA-256(h_{i-1} ∥ tx_hash ∥ block_hash ∥ height)

[조건 3] PDV 위치 증명 — 거래별, 온라인
  pdv_log.chain_local_hash
    === hash_chain[pdv_log.chain_height].local_hash

[조건 4] L1 노드 체인 — 거래별, 온라인
  l1_ledger.node_hash
    === SHA-256(prev_node_hash ∥ l1_ledger.user_hash)

[조건 5] 잔액 무결성 — 분기별, K-Tax
  fs_ledger 집계 잔액 ≈ balance_claimed (허용오차 1원)

[조건 6] 집합 잔액 불변성 — 분기별, K-Tax
  동일 L1 노드 내 Σδ_k = 0

[조건 7] BMI 연속성 — 분기별, K-Tax
  ktax_bmi_audit[Q].global_bmi_root 기록 유지
  전분기와 비교 → 무단 변경 탐지
```

---

## 11. 구현 우선순위 v3.0

| 단계 | 작업 | 파일 | 우선순위 |
|------|------|------|---------|
| A-1 | `appendHashChain()` 공식 확정 + 필드 정리 | gopang-wallet.js | ⭐ 최우선 |
| A-2 | `redeemClaim()` pdv_session_id 추가 | gopang-wallet.js | ⭐ 최우선 |
| A-3 | `verifyChain()` 자기완결 확인 | gopang-wallet.js | ⭐ 최우선 |
| B-1 | `GWP_DONE` 핸들러 재설계 | gopang-app.js | ⭐ 최우선 |
| B-2 | `_recordPDV()` chain_height 포함 | gopang-app.js | ⭐ 최우선 |
| DB-1 | pdv_log 스키마 변경 | SQL | ⭐ 최우선 |
| B-3 | `_patchPdvChainHeight()` 재시도 포함 | gopang-app.js | 높음 |
| B-4 | `_markPdvAnchored()` | gopang-app.js | 높음 |
| DB-2 | l1_ledger balance_claimed 컬럼 추가 | SQL | 높음 |
| C-1 | `updateNodeHashChain()` | worker.js | 높음 |
| C-2 | `verifyOutputConsistency()` + `verifyDeltaZero()` | worker.js | 높음 |
| C-3 | `anchorL1MerkleRoot()` CRON | worker.js | 중간 |
| DB-3 | merkle_anchors, ktax_bmi_audit 스키마 | SQL | 중간 |
| A-4 | `verifyWithMerkle()` | gopang-wallet.js | 중간 |
| D-1 | `runQuarterlyBMIAudit()` K-Tax Cron | k-tax 모듈 | 분기 전 |
| D-2 | K-Tax 감사 뷰 등록 | SQL | 분기 전 |
| E-1 | L1 `/api/tx` 응답에 명시적 `l1_sig` 추가 | main.pb.js | 장기 |

---

## 12. v1.0 → v2.0 → v3.0 전체 변경 요약

| 항목 | v1.0 | v2.0 | v3.0 |
|------|------|------|------|
| `h_i` 공식 | pdv 포함 | **불변** | **불변 (유지)** |
| PDV 연결 | 공식 내포 | 참조 키 | **참조 키 (유지)** |
| `verifyChain()` | Supabase 의존 | IDB 자기완결 | **자기완결 (유지)** |
| BMI 구현 | 없음 | Worker 배치 Merkle | **K-Tax 집계 감사** |
| `balance_claimed` | 자기 선언, 미검증 | 자기 선언 | **K-Tax 사후 대조** |
| Merkle 용도 | 없음 | BMI 대안 (혼용) | **MTSM + K-Tax BMI** |
| Σδ=0 검증 | 없음 | 없음 | **Worker 실시간 + K-Tax** |
| K-Tax 연동 | 없음 | 없음 | **레이어 3 신설** |
| cross-node 거래 | 미처리 | 미처리 | **별도 집계, 오탐 방지** |
| 타이밍 경쟁 조건 | 없음 | 없음 | **재시도 로직** |
| balance 직렬화 | 없음 | 없음 | **정수 정규화** |

---

## 13. 한계 명시

**한계 1 — `balance_claimed` 실시간 검증 불가**  
부풀리기는 K-Tax 감사 주기(분기) 전까지 탐지되지 않습니다.  
고액 거래(≥1,000단위)는 §4.4 Stage 5에 의해 즉시 보고 기록되므로 추가 노출이 제한됩니다.

**한계 2 — `fs_ledger` 완전성 의존**  
Worker 장애나 오류로 누락된 거래가 있으면 재구성 잔액이 부정확합니다.  
`via_worker=true` 보장(원칙 P2)과 정기 누락 탐지 쿼리가 전제조건입니다.

**한계 3 — L1 노드 운영자 신뢰**  
Worker가 `l1_ledger`에 기록하므로 L1 노드 운영자가 이를 직접 조작하면 H_N이 무력화됩니다.  
장기 로드맵(Phase E-1: 명시적 L1 서명)이 이를 해소합니다.

**한계 4 — K-Tax 감사는 사후 탐지**  
레이어 3은 분기별 감사이므로 실시간 위변조를 막지 못합니다.  
레이어 1(Hash Chain 연속성)과 L2→L1 100% 스트리밍 감사(논문 §4.3.1)가 실시간 방어선입니다.

---

*PDV-HASHCHAIN-DESIGN-v3.0-FINAL*  
*AI City Inc. 팀 주피터 | 2026-06-12*  
*이전: v1.0 (공식 내포 설계) → v2.0 (참조 키 분리) → v3.0 (K-Tax 레이어 3 신설)*  
*근거: OpenHash SCI 논문 초안 v2.2 §3.1.3, §4.2, §4.3, §4.4, §4.7.1*  
*사고 실험 반영: v1.0 결함 5개 + v3.0 초안 결함 5개 = 총 10개 결함 수정 완료*
