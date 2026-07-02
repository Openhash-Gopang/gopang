# PDV 저장 메커니즘 설계 v2.0
## L1 Hash Chain ↔ PDV Chain 연동 알고리즘 — 사고 실험 갱신본

**문서 코드** PDV-HASHCHAIN-DESIGN-v2.0  
**작성일** 2026-06-12  
**이전 버전** PDV-HASHCHAIN-DESIGN-v1.0  
**근거 문헌** OpenHash SCI 논문 초안 v2.2 (§3.1.3, §4.2, §4.3, §4.4)  
**대상 코드** gopang-wallet.js v2.0.0 · gopang-app.js · Worker v4.9

---

## v1.0 → v2.0 변경 이력

사고 실험을 통해 v1.0에서 5개의 논리 결함을 발견하고 전면 재설계했습니다.

| 결함 | v1.0의 오류 | v2.0의 수정 |
|------|------------|------------|
| **결함 1** | `pdv_hash`를 `h_i` 공식에 내포 → 검증 시 Supabase 의존 | Hash Chain 공식 불변. PDV는 부가 참조 필드로만 저장 |
| **결함 2** | `reporter_svc='kmarket'`이면 `pdv_record` 미전달 → `pdv_anchored` 영구 false | PDV 기록과 무관하게 `pdv_hash` 계산은 항상 실행 |
| **결함 3** | PDV 없는 거래에서 `pdv_hash=0×64` 패딩 → 포함 효과 소멸 | 두 체인 역할 분리. 연결은 참조 키로 느슨하게 유지 |
| **결함 4** | 논문 §3.1.3의 이중 서명(L1 노드 서명) 누락 | `l1_ledger.user_hash`를 단기 묵시적 L1 서명으로 채택, 장기 명시적 서명 로드맵 수립 |
| **결함 5** | `prev/new_settle_hash` — 검증에 미사용하는 레거시 필드 유지 | Hash Chain 레코드에서 제거. `@deprecated` 명시 |

---

## 1. 논문 핵심 알고리즘 — v2.0 해석

### 1.1 두 개의 독립 Hash Chain (§3.1.3)

```
사용자 Hash Chain   H_u = (h_1, h_2, ..., h_t)
  h_i = SHA-256(h_{i-1} ∥ data_i ∥ height_i)

L1 노드 Hash Chain  H_N = (n_1, n_2, ..., n_t)
  n_i = SHA-256(n_{i-1} ∥ h_{user,i})
```

`height_i`는 논스(nonce)로 재생 공격을 차단합니다.  
`data_i`는 논문에서 명시적으로 정의되지 않으며, 현재 구현의 `tx_hash + block_hash`가 적합합니다.  
갱신은 **이중 서명(사용자 서명 + L1 노드 서명)**을 요구합니다.

### 1.2 PDV와 Hash Chain의 관계 — v2.0 해석

논문은 PDV(Personal Data Vault)를 Hash Chain과 **공식 내포** 방식으로 연결하도록 요구하지 않습니다. 논문의 감사 목표(§4.3.1 항목 6)는 "해시 체인 연결"의 감사이며, 이는 PDV 레코드가 어느 체인 높이에서 발생했는지 **위치 지정(anchoring)**을 의미합니다.

> **v2.0 핵심 원칙**  
> Hash Chain은 거래 원장입니다. 공식을 불변으로 유지합니다.  
> PDV Chain은 감사 로그입니다. Hash Chain과 참조 키로 느슨하게 연결합니다.  
> 연동 검증은 참조 키 일치와 `local_hash` 사본 비교로 수행합니다.

### 1.3 현재 구현 대조 — v2.0 평가

```javascript
// gopang-wallet.js:396 — 현재 구현
h_i = SHA-256(h_{i-1} ∥ tx_hash ∥ block_hash ∥ height)
```

| 필드 | 논문 §3.1.3 | 현재 구현 | 평가 |
|------|------------|----------|------|
| `h_{i-1}` | `prev_local_hash` | ✅ 일치 | 유지 |
| `data_i` | tx 내용 식별자 | `tx_hash + block_hash` | ✅ 적합 |
| `height_i` | 논스 | `height` | ✅ 일치 |
| `pdv_hash` | 논문 미정의 | — | 공식 외부에서 연결 |
| `prev/new_settle_hash` | 논문 미사용 | 레거시 필드 | ❌ 제거 |

---

## 2. 현재 구조의 공백 — v2.0 재정의

### 2.1 실제 문제

```
거래 완료 후:
  → appendHashChain() → IDB hash_chain[height]  ← 거래 원장 ✅
  → _recordPDV()      → Supabase pdv_log         ← 감사 로그 ✅
                                                  ← 그러나 두 기록이 서로를 모른다 ❌
```

### 2.2 공백 목록 (v2.0 재정의)

| 항목 | 현재 상태 | v2.0 목표 |
|------|-----------|-----------|
| PDV ↔ Hash Chain 연결 | ❌ 미연결 | 참조 키(`chain_height`) + `chain_local_hash` 사본으로 연결 |
| L1 노드 Hash Chain `H_N` | ❌ 미구현 | Worker → `l1_ledger.node_hash` 기록 |
| 이중 서명 | ❌ 단독 클라이언트 기록 | `l1_ledger.user_hash` 묵시적 L1 서명 (단기 대안) |
| `prev/new_settle_hash` | ⚠️ 레거시 혼란 필드 | Hash Chain 레코드에서 제거 |
| `reporter_svc='kmarket'` 경로 | ❌ `pdv_hash` 미계산 | reporter_svc 무관하게 항상 계산 |

---

## 3. 설계 v2.0 — 분리된 두 체인, 참조 키 연동

### 3.1 Hash Chain H_u — 공식 불변

```
h_i = SHA-256(h_{i-1} ∥ tx_hash ∥ block_hash ∥ height)
```

공식은 현재 구현과 동일합니다. PDV는 공식에 포함하지 않습니다.

### 3.2 PDV Chain — 독립 감사 로그

PDV 레코드는 거래 완료 시점의 `chain_height`와 `chain_local_hash`(= `h_i` 사본)를 함께 저장합니다.

```
pdv_log 레코드 = {
  ...6하 원칙 필드,
  session_id:        UUID,       // 중복 방지
  chain_height:      Integer,    // IDB hash_chain[height] 참조 키
  chain_local_hash:  Hex64,      // h_i 사본 — 오프라인 검증용
  openhash_anchored: Boolean,
  via_worker:        Boolean,
  reporter_svc:      Text,
}
```

### 3.3 연동 관계 다이어그램

```
IDB hash_chain[height=3]                  Supabase pdv_log
  local_hash:  "3951191b..."    ←──────   chain_local_hash: "3951191b..."
  tx_hash:     "txhash..."               chain_height:     3
  block_hash:  "content..."              session_id:       "6f156447..."
  height:      3                         user_guid:        "2601:db80..."
  recorded_at: "2026-06-12..."
  pdv_session_id: "6f156447..."  ──────→  session_id:       "6f156447..."
```

**검증 쿼리 (단 1줄)**:
```sql
SELECT chain_height, chain_local_hash = hash_chain_local_hash AS valid
FROM pdv_log_with_chain_view
WHERE session_id = '6f156447-...';
```

### 3.4 L1 노드 Hash Chain H_N — Worker 구현

```
n_i = SHA-256(n_{i-1} ∥ h_{user,i})

l1_ledger 레코드 = {
  tx_id:       tx_hash,          // 거래 식별
  user_hash:   h_i,              // 사용자의 local_hash
  node_hash:   n_i,              // = SHA-256(n_{i-1} ∥ h_i)
  block_hash:  content_hash,     // L1 블록 앵커
  anchored_at: timestamp,
}
```

`l1_ledger.user_hash`가 이중 서명의 단기 대안입니다.  
L1이 해당 `h_i`를 자신의 노드 체인(`H_N`)에 포함시키는 행위 자체가 "L1이 그 거래를 유효하다고 확인했다"는 묵시적 증거입니다.

### 3.5 이중 서명 장기 로드맵

```
단기 (현재): l1_ledger.user_hash = h_i 묵시적 포함
             → "L1이 이 h_i를 자신의 체인에 포함했다"는 감사 증거

장기 (Phase D): /api/tx 응답에 L1 서명 추가
  L1 응답 = {
    ok:         true,
    block_hash: content_hash,
    buyer_claim: { ... },
    l1_sig:     Sign_{privKey_L1}(h_i),  // ← L1 노드의 Ed25519 서명
  }
  → redeemClaim()에서 l1_sig 검증 후 Hash Chain 기록
  → 논문 §3.1.3 이중 서명 완전 충족
```

---

## 4. 구현 계획 v2.0

### 4.1 Phase A: gopang-wallet.js 수정

#### A-1: Hash Chain 레코드 구조 정리

`prev_settle_hash`, `new_settle_hash`를 제거하고 PDV 참조 필드를 추가합니다.

```javascript
// gopang-wallet.js appendHashChain() 수정

async function appendHashChain(db, {
  txHash,
  blockHash,
  blockId,
  pdvSessionId = null,   // 신규: pdv_log.session_id 참조 키
  pdvType      = null,   // 신규: 'service_task' | 'klaw_monitor' | ...
  // prevSettleHash, newSettleHash 제거 (결함 5 수정)
}) {
  const last          = await idbChainGetLast(db);
  const height        = (last?.height ?? -1) + 1;
  const prevLocalHash = last?.local_hash ?? '0'.repeat(64);

  // ── 공식 불변 (v2.0 확정) ────────────────────────────────
  // h_i = SHA-256(h_{i-1} ∥ tx_hash ∥ block_hash ∥ height)
  const chainInput = prevLocalHash + txHash + blockHash + String(height);
  const localHash  = bufToHex(await sha256(chainInput));

  const record = {
    // Hash Chain 핵심 필드 (불변)
    height,
    local_hash:      localHash,
    prev_local_hash: prevLocalHash,
    tx_hash:         txHash,
    block_hash:      blockHash,
    block_id:        blockId || null,
    recorded_at:     new Date().toISOString(),

    // PDV 참조 필드 (신규 — 공식 外)
    pdv_session_id:  pdvSessionId,   // pdv_log.session_id 참조 키
    pdv_type:        pdvType,        // 감사 추적용
    pdv_anchored:    false,          // Supabase INSERT 완료 후 true

    // @deprecated — 제거 (결함 5)
    // prev_settle_hash: 삭제
    // new_settle_hash:  삭제
  };

  await idbChainPut(db, record);
  return record;
}
```

#### A-2: redeemClaim() — PDV 세션 ID 수신

PDV 내용 해시는 계산하지 않습니다. 세션 ID만 받아서 참조 키로 저장합니다.

```javascript
// gopang-wallet.js redeemClaim() 수정

async redeemClaim({
  block_hash,
  block_id,
  claims    = [],
  tx_hash,
  pdv_session_id = null,   // 신규: pdv_log 참조 키 (reporter_svc 무관하게 전달)
  pdv_type       = null,   // 신규: 'service_task' | ...
}) {
  if (!block_hash) throw new Error('[Wallet] block_hash 없음');

  const db    = await openDB();
  const fsRec = await idbGet(db, IDB_FS_KEY);
  const fs    = fsRec?.state || {};

  // 청구권 적용 (기존 코드 유지)
  const now     = Date.now();
  let applied   = 0;
  for (const claim of claims) {
    if (claim.expires_at && new Date(claim.expires_at).getTime() < now) {
      console.warn('[Wallet] 만료된 청구권 무시:', claim);
      continue;
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
    state:      fs,
    updatedAt:  new Date().toISOString(),
    block_hash,
  });

  // Hash Chain 기록 — 공식 불변, PDV는 참조 키만
  const usedTxHash = tx_hash || block_hash;
  const chainRec   = await appendHashChain(db, {
    txHash:        usedTxHash,
    blockHash:     block_hash,
    blockId:       block_id    || null,
    pdvSessionId:  pdv_session_id,   // ← 참조 키 전달
    pdvType:       pdv_type,
  });

  console.info(
    '[Wallet] redeemClaim 완료 | height:', chainRec.height,
    '| applied:', applied,
    '| bs-cash:', fs['bs-cash'],
    '| pdv_session_id:', pdv_session_id?.slice(0, 8) || 'none'
  );
  return { fs, chainRec, applied };
}
```

#### A-3: verifyChain() — PDV 포함 없이 공식 검증

```javascript
// gopang-wallet.js verifyChain() — 공식 재계산

async verifyChain() {
  const chain = await this.getHashChain();
  for (let i = 1; i < chain.length; i++) {
    const cur  = chain[i];
    const prev = chain[i - 1];

    // 1. 체인 연속성
    if (cur.prev_local_hash !== prev.local_hash) {
      return { valid: false, broken_at: cur.height, reason: 'chain_break' };
    }

    // 2. h_i 재계산 검증 — 공식 불변이므로 외부 데이터 불필요
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

### 4.2 Phase B: gopang-app.js 수정

#### B-1: GWP_DONE 핸들러 — 전면 재설계

`pdv_session_id`를 먼저 확정하고 `redeemClaim()`에 전달합니다.  
`reporter_svc` 여부와 **무관하게** 세션 ID는 항상 생성합니다.

```javascript
// gopang-app.js — case 'GWP_DONE' 전면 재설계

case 'GWP_DONE': {
  if (msg.summary) appendBubble('ai', msg.summary, false);

  // 1. 세션 ID 확정 — reporter_svc 무관하게 항상 실행 (결함 2 수정)
  const sessionId   = msg.session_id || msg.pdvData?.session_id || crypto.randomUUID();
  const reporterSvc = msg.reporter_svc || msg.pdvData?.reporter_svc || null;

  // 2. redeemClaim 실행 — pdv_session_id를 참조 키로 전달
  if (msg.block_hash && window.gopangWallet?.redeemClaim) {
    const claims = msg.claims?.length
      ? msg.claims
      : (msg.buyer_claim ? [msg.buyer_claim] : []);

    window.gopangWallet.redeemClaim({
      block_hash:     msg.block_hash,
      block_id:       msg.block_id   || null,
      tx_hash:        msg.tx_hash    || null,
      claims,
      pdv_session_id: sessionId,         // ← 항상 전달 (결함 2 수정)
      pdv_type:       'service_task',
    }).then(({ fs, chainRec, applied }) => {
      console.info(
        '[GWP_DONE] redeemClaim 완료',
        '| block_hash:', msg.block_hash.slice(0, 8),
        '| height:', chainRec.height,
        '| pdv_session_id:', sessionId.slice(0, 8),
        '| bs-cash:', fs['bs-cash']
      );
      appendBubble('ai', `거래 완료. 잔액 ₩${fs['bs-cash']?.toLocaleString()}`, false);

      // 3. PDV Supabase 기록 — reporter_svc 없을 때만 (중복 방지 원칙 P5 유지)
      if (!reporterSvc) {
        const p = msg.pdvData || {};
        _recordPDV({
          type:             'service_task',
          serviceId:        _gwpService?.id   || null,
          service:          _gwpService?.name || null,
          summary:          msg.summary       || null,
          who:              p.who  || _USER?.ipv6 || null,
          when:             p.when || null,
          where:            p.where || null,
          what:             p.what  || msg.summary || null,
          how:              p.how   || 'gwp',
          why:              p.why   || ((_gwpService?.name || '') + ' 서비스 이용'),
          session_id:       sessionId,          // ← 참조 키와 동일한 값
          chain_height:     chainRec.height,    // ← Hash Chain 위치
          chain_local_hash: chainRec.local_hash,// ← h_i 사본
          ts:               new Date().toISOString(),
        }).then(() => {
          _markPdvAnchored(chainRec.height);
        });
      } else {
        // reporter_svc가 있으면 해당 시스템(market 등)이 이미 기록
        // → pdv_log에 chain_height를 업데이트해야 연결 완성
        // (Phase B-3에서 Worker /pdv/report 경로로 chain_height 전달)
        console.info(
          '[GWP_DONE] PDV 중복 방지 — reporter_svc:', reporterSvc,
          '| chain_height:', chainRec.height,
          '| 연결 키:', sessionId.slice(0, 8)
        );
        // market의 pdv_log 레코드에 chain_height를 소급 업데이트
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

#### B-2: _recordPDV() — chain_height 포함 (P17 수정 포함)

```javascript
// gopang-app.js _recordPDV() — v2.0 수정

async function _recordPDV(record) {
  try {
    // localStorage 캐시 (기존 유지)
    const log = JSON.parse(localStorage.getItem('gopang_pdv_log') || '[]');
    log.push(record);
    if (log.length > 1000) log.splice(0, log.length - 1000);
    localStorage.setItem('gopang_pdv_log', JSON.stringify(log));

    // 6하 원칙 필드 구성
    const _effectiveGuid = _USER?.guid || _USER?.ipv6 || USER_GUID;   // P17 수정
    const whoName = _USER?.phone
      ? _USER.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
      : 'GUID:' + (_effectiveGuid?.slice(0, 8) ?? 'unknown');

    const locStr = _userLocation
      ? (_userLocation.address ||
         (_userLocation.lat ? `${_userLocation.lat.toFixed(5)},${_userLocation.lng.toFixed(5)}` : null))
      : (record.data?.location || null);

    const howStr = record.how
      || (record.data?.reportId ? 'image' : record.type === 'klaw_monitor' ? 'auto' : 'text');

    const whyStr = record.why
      || (record.service ? record.service + ' 서비스 이용'
        : record.type === 'klaw_monitor' ? '법적 리스크 자동 감시'
        : record.type === 'service_task' ? '서비스 작업 완료'
        : '대화');

    // Supabase pdv_log INSERT
    const res = await fetch(_SUPABASE_URL + '/rest/v1/pdv_log', {
      method: 'POST',
      headers: {
        'apikey':       _SUPABASE_KEY,
        'Authorization':'Bearer ' + _SUPABASE_KEY,
        'Content-Type': 'application/json',
        'Prefer':       'return=minimal',
      },
      body: JSON.stringify({
        // 누가 (P17 수정)
        user_guid:  _effectiveGuid,
        device_fp:  _USER?.fp || _USER?.fpHex?.slice(0, 32) || null,
        who_name:   whoName,
        // 6하
        location:   locStr,
        record_type:record.type,
        summary:    record.summary || null,
        payload:    record,
        how:        howStr,
        service_id: record.serviceId || null,
        why:        whyStr,
        // 연동 필드 (v2.0 신규)
        session_id:        record.session_id        || null,
        chain_height:      record.chain_height       ?? null,
        chain_local_hash:  record.chain_local_hash   ?? null,
        openhash_anchored: false,
        via_worker:        false,
        reporter_svc:      null,   // 직접 INSERT이므로 null
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.status);
      console.warn('[PDV] Supabase 오류:', res.status, err);
    } else {
      console.info(
        '[PDV] 기록 완료:', record.type,
        '| session_id:', record.session_id?.slice(0, 8) || '-',
        '| chain_height:', record.chain_height ?? '-'
      );
    }
  } catch(e) {
    console.warn('[PDV] 기록 실패:', e.message);
  }

  if (record.type === 'service_task' && record.serviceId !== 'klaw') {
    setTimeout(() => _klawReview('service', record), 2000);
  }
}
```

#### B-3: _patchPdvChainHeight() — reporter_svc 경로 소급 연결 (신규)

`reporter_svc='kmarket'`인 경우 market이 기록한 `pdv_log`에 `chain_height`를 소급 업데이트합니다.

```javascript
// gopang-app.js 신규 함수

async function _patchPdvChainHeight(sessionId, chainHeight, chainLocalHash) {
  if (!sessionId || chainHeight == null) return;
  try {
    const res = await fetch(
      _SUPABASE_URL + '/rest/v1/pdv_log'
        + '?session_id=eq.' + encodeURIComponent(sessionId)
        + '&chain_height=is.null',   // 이미 연결된 경우 덮어쓰지 않음
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
      console.info('[PDV] chain_height 소급 연결 완료 | session_id:',
        sessionId.slice(0, 8), '| height:', chainHeight);
    } else {
      console.warn('[PDV] chain_height 소급 연결 실패:', res.status);
    }
  } catch(e) {
    console.warn('[PDV] _patchPdvChainHeight 오류:', e.message);
  }
}
```

#### B-4: _markPdvAnchored() — 기존 함수 유지

```javascript
// gopang-app.js (기존 v1.0 설계와 동일, 수정 없음)

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
      console.info('[PDV] pdv_anchored 갱신 완료 | height:', height);
    }
  } catch(e) {
    console.warn('[PDV] pdv_anchored 갱신 실패:', e.message);
  }
}
```

### 4.3 Phase C: Worker — L1 노드 Hash Chain 기록

```javascript
// worker.js /biz/order 처리 후 추가 (additive-only 원칙 준수)

async function updateNodeHashChain(supabase, { userHash, txId, blockHash }) {
  // n_{i-1} 조회
  const { data: last, error } = await supabase
    .from('l1_ledger')
    .select('node_hash')
    .order('anchored_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const prevNodeHash = last?.node_hash || '0'.repeat(64);

  // n_i = SHA-256(n_{i-1} ∥ h_{user,i})
  const nodeHashInput = new TextEncoder().encode(prevNodeHash + userHash);
  const buf           = await crypto.subtle.digest('SHA-256', nodeHashInput);
  const nodeHash      = Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  const { error: insErr } = await supabase.from('l1_ledger').insert({
    tx_id:       txId,
    user_hash:   userHash,    // 사용자 Hash Chain h_i
    node_hash:   nodeHash,    // L1 노드 Hash Chain n_i
    block_hash:  blockHash,
    anchored_at: new Date().toISOString(),
  });

  if (insErr) console.warn('[Worker] l1_ledger INSERT 실패:', insErr.message);
  else        console.info('[Worker] H_N 갱신 | node_hash:', nodeHash.slice(0, 8));

  return nodeHash;
}

// /biz/order 성공 응답 직후 호출 (기존 fs_ledger 기록 코드 이후)
// worker.js biz_order 핸들러 내:
//
//   const l1Res = await postToL1(tx);
//   if (l1Res.ok) {
//     await insertFsLedger(supabase, ...);         // 기존
//     await insertPdvLog(supabase, ...);           // 기존
//     await updateNodeHashChain(supabase, {        // 신규
//       userHash:  body.chain_local_hash || '',    // gopang이 전달한 h_i
//       txId:      body.tx_hash,
//       blockHash: l1Res.block_hash,
//     });
//   }
```

**`chain_local_hash` 전달 경로**: `profile.html`의 `/biz/order` POST body에 gopang이 서명 시 사용한 `h_i` (= `chainRec.local_hash`)를 포함합니다. 이를 위해 `GWP_SIGN_REQUEST` 메시지에 `chain_local_hash`를 포함하거나, Worker가 Supabase에서 `session_id`로 조회합니다.

---

## 5. Supabase 스키마 변경 v2.0

### 5.1 pdv_log 테이블

```sql
-- 신규 컬럼 추가
ALTER TABLE pdv_log
  ADD COLUMN IF NOT EXISTS session_id        UUID,
  ADD COLUMN IF NOT EXISTS chain_height      INTEGER,
  ADD COLUMN IF NOT EXISTS chain_local_hash  TEXT,
  ADD COLUMN IF NOT EXISTS openhash_anchored BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS via_worker        BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reporter_svc      TEXT;

-- 중복 방지 인덱스
CREATE UNIQUE INDEX IF NOT EXISTS pdv_log_session_id_idx
  ON pdv_log (session_id)
  WHERE session_id IS NOT NULL;

-- Hash Chain 조회 인덱스
CREATE INDEX IF NOT EXISTS pdv_log_chain_height_idx
  ON pdv_log (chain_height);
```

### 5.2 l1_ledger 테이블

```sql
-- 신규 컬럼 추가
ALTER TABLE l1_ledger
  ADD COLUMN IF NOT EXISTS user_hash   TEXT,   -- 사용자 Hash Chain h_i (묵시적 L1 서명)
  ADD COLUMN IF NOT EXISTS node_hash   TEXT;   -- L1 노드 Hash Chain n_i

-- 연동 검증 뷰 (선택)
CREATE OR REPLACE VIEW pdv_chain_integrity AS
SELECT
  p.session_id,
  p.chain_height,
  p.chain_local_hash                          AS pdv_h_i,
  l.user_hash                                 AS l1_h_i,
  p.chain_local_hash = l.user_hash            AS pdv_l1_match,
  p.reporter_svc,
  p.openhash_anchored,
  p.created_at
FROM pdv_log p
LEFT JOIN l1_ledger l
  ON l.tx_id = p.payload->>'tx_hash'          -- tx_hash로 JOIN
WHERE p.chain_height IS NOT NULL
ORDER BY p.chain_height DESC;
```

---

## 6. 전체 흐름 v2.0

```
거래 완료
  │
  ├─ [gopang] GWP_DONE 수신
  │    │
  │    ├─ sessionId 확정 (reporter_svc 무관)
  │    │
  │    └─ redeemClaim({ block_hash, claims, pdv_session_id: sessionId })
  │         │
  │         ├─ claims 적용 (bs-cash 차감)
  │         │
  │         ├─ appendHashChain()
  │         │    h_i = SHA-256(h_{i-1} ∥ tx_hash ∥ block_hash ∥ height)
  │         │    IDB hash_chain[height] = {
  │         │      local_hash,       ← h_i
  │         │      pdv_session_id,   ← pdv_log 참조 키
  │         │      pdv_anchored: false
  │         │    }
  │         │
  │         └─ 반환: { fs, chainRec }
  │
  ├─ [reporter_svc 없음] _recordPDV()
  │    └─ Supabase pdv_log INSERT
  │         { session_id, chain_height, chain_local_hash }
  │    → _markPdvAnchored(height) → IDB pdv_anchored = true
  │
  ├─ [reporter_svc = 'kmarket'] _patchPdvChainHeight()
  │    └─ Supabase pdv_log PATCH
  │         WHERE session_id = sessionId AND chain_height IS NULL
  │         SET chain_height, chain_local_hash
  │
  └─ [Worker] updateNodeHashChain()
       n_i = SHA-256(n_{i-1} ∥ h_i)
       Supabase l1_ledger INSERT { user_hash: h_i, node_hash: n_i }
```

---

## 7. 무결성 검증 v2.0

### 7.1 오프라인 Hash Chain 검증 (자기완결)

```javascript
// hondi.net 콘솔 — 외부 DB 없이 완전 검증 (결함 1 수정)
const result = await window.gopangWallet.verifyChain();
// { valid: true, broken_at: null }
//   ↑ Supabase 조회 없이 IDB만으로 검증 가능
```

### 7.2 PDV ↔ Hash Chain 연동 검증 (SQL)

```sql
-- 연동 일치 전수 검사
SELECT
  session_id,
  chain_height,
  pdv_l1_match,
  reporter_svc,
  openhash_anchored
FROM pdv_chain_integrity
WHERE pdv_l1_match = FALSE OR openhash_anchored = FALSE
ORDER BY chain_height DESC;
-- 결과 0건 = T05/T06 통과

-- 특정 세션 추적
SELECT *
FROM pdv_chain_integrity
WHERE session_id = '6f156447-3ea2-44ef-88d3-9404e4a202e3';
```

### 7.3 L1 노드 Hash Chain 검증 (SQL)

```sql
-- H_N 연속성 확인
WITH ordered AS (
  SELECT
    tx_id,
    user_hash,
    node_hash,
    LAG(node_hash) OVER (ORDER BY anchored_at) AS prev_node_hash,
    anchored_at
  FROM l1_ledger
  ORDER BY anchored_at
)
SELECT
  tx_id,
  anchored_at,
  -- n_i 재계산은 DB에서 불가 (SHA-256 함수 없음) → application 레이어에서 수행
  node_hash IS NOT NULL AS has_node_hash,
  user_hash IS NOT NULL AS has_user_hash
FROM ordered
WHERE node_hash IS NULL OR user_hash IS NULL
ORDER BY anchored_at DESC;
-- 결과 0건 = 모든 거래에 H_N 기록 완료
```

---

## 8. 구현 우선순위 v2.0

| 단계 | 작업 | 파일 | 우선순위 | 결함 |
|------|------|------|---------|------|
| A-1 | `appendHashChain()` 공식 불변 확정 + `prev/new_settle_hash` 제거 | gopang-wallet.js | ⭐ 최우선 | 결함 1, 5 |
| A-2 | `redeemClaim()` `pdv_session_id` 파라미터 추가 | gopang-wallet.js | ⭐ 최우선 | 결함 2 |
| A-3 | `verifyChain()` 공식 재계산 정합성 확인 | gopang-wallet.js | ⭐ 최우선 | 결함 1 |
| B-1 | `GWP_DONE` 핸들러 재설계 (sessionId 항상 생성) | gopang-app.js | ⭐ 최우선 | 결함 2 |
| B-2 | `_recordPDV()` `chain_height`, `chain_local_hash` 포함 | gopang-app.js | ⭐ 최우선 | - |
| B-3 | `_patchPdvChainHeight()` 신규 함수 | gopang-app.js | 높음 | 결함 2 |
| B-4 | `_markPdvAnchored()` 구현 | gopang-app.js | 높음 | - |
| DB-1 | `pdv_log` 스키마 변경 + 인덱스 | SQL | ⭐ 최우선 | - |
| DB-2 | `l1_ledger` 스키마 변경 + 뷰 | SQL | 높음 | - |
| C-1 | Worker `updateNodeHashChain()` | worker.js | 높음 | 결함 4 |
| D-1 | L1 `/api/tx` 응답에 명시적 `l1_sig` 추가 | main.pb.js | 장기 | 결함 4 |

---

## 9. 핵심 불변 조건 v2.0

```
거래 N 완료 후, 아래 3개 조건이 동시 성립해야 무결 상태:

[기존 — 유지]
  IndexedDB financial_state.block_hash
    === L1 blocks.content_hash (최신)

[Hash Chain 자기완결 — 신규]
  IDB hash_chain[height].local_hash
    === SHA-256(h_{i-1} ∥ tx_hash ∥ block_hash ∥ height)
  ← 오프라인에서도 검증 가능. Supabase 불필요.

[PDV 연동 — 신규]
  Supabase pdv_log.chain_local_hash
    === IDB hash_chain[pdv_log.chain_height].local_hash
  ← session_id로 두 레코드를 연결. SQL 1줄로 전수 검사 가능.

[L1 노드 체인 — Phase C]
  Supabase l1_ledger.node_hash
    === SHA-256(prev_node_hash ∥ l1_ledger.user_hash)
  ← H_N 연속성. 논문 §3.1.3 이중 서명의 단기 대안.
```

---

## 10. v1.0 대비 변경 요약

| 항목 | v1.0 | v2.0 |
|------|------|------|
| `h_i` 공식 | `SHA-256(h_{i-1}∥tx∥block∥pdv∥height)` | `SHA-256(h_{i-1}∥tx∥block∥height)` **불변** |
| PDV 연결 방식 | 공식 내포 | **참조 키** (`chain_height`, `chain_local_hash`) |
| `verifyChain()` | Supabase 의존 | **IDB만으로 자기완결** |
| `reporter_svc='kmarket'` | `pdv_hash` 미계산 | `pdv_session_id` **항상 생성** |
| `prev/new_settle_hash` | Hash Chain에 포함 | **제거** (`@deprecated`) |
| 이중 서명 | 누락 | `l1_ledger.user_hash` 묵시적 서명 + 장기 로드맵 |
| market 경로 연결 | 불가 | `_patchPdvChainHeight()` 소급 업데이트 |

---

*PDV-HASHCHAIN-DESIGN-v2.0*  
*AI City Inc. 팀 주피터 | 2026-06-12*  
*이전 버전: PDV-HASHCHAIN-DESIGN-v1.0*  
*근거: OpenHash SCI 논문 초안 v2.2 §3.1.3, §4.2, §4.3, §4.4*  
*사고 실험 결함 5개 (결함 1~5) 반영 완료*
