# How to Record OpenHash
> 작성일: 2026-06-15
> 저장소: Openhash-Gopang/gopang
> 관련 파일: `src/gopang/core/session.js`, `src/gopang/core/auth.js`

---

## 1. 설계 원칙

### 1.1 데이터 단위

OpenHash에 기록하는 단위는 **세션**입니다.

```
세션 = 앱 진입 ~ 앱 종료(visibilitychange / pagehide)
      안의 모든 대화 + 거래를 하나의 데이터 뭉치로 묶음
```

대화의 개별 발언(user/assistant), 거래의 개별 항목은 **별도로 해싱하지 않습니다.** 세션 전체를 하나의 JSON으로 직렬화한 뒤 SHA-256을 1회만 적용합니다.

### 1.2 원문과 해시의 분리

```
원문 → localStorage (기기 내 보존)
해시 → OpenHash Network (체인에 기록)
```

OpenHash에는 해시만 기록합니다. 원문은 사용자 기기의 localStorage에 보존하며, 필요 시 원문의 SHA-256을 재계산해 체인의 해시와 대조합니다.

### 1.3 wallet = 재무제표 현금 계정

```
user_profiles.extra.fs = {
  'bs-cash':     0,   ← wallet 잔액 (현금 계정)
  'pl-purchase': 0,   ← 지출 누적
  'pl-revenue':  0,   ← 수입 누적
}
```

별도 wallet 테이블 없이 재무제표의 `bs-cash`가 곧 wallet입니다. 모든 거래는 `fs_ledger`에 복식부기로 기록되고 `extra.fs`가 갱신됩니다.

---

## 2. 기록 시점 — 3가지

### 2.1 가입 시 (1회)

사용자가 전화번호를 입력하고 가입을 완료하는 즉시 실행됩니다.

```javascript
// src/gopang/core/auth.js — _showNicknameStep()._register() 완료 직후
_recordRegisterPdv({ ipv6, handle, nickname, e164, selectedCountry })
```

수행 내용:

```
① hashChain.anchor(가입 이벤트 JSON, guid, sessionId)
     → entryHash 생성 (체인 최초 기록)

② POST /pdv/report { block_hash: entryHash, type: 'user_register' }
     → pdv_log INSERT, openhash_anchored: true

③ user_profiles.extra.fs 초기화
     → { bs-cash:0, pl-purchase:0, pl-revenue:0 }
```

### 2.2 세션 종료 시 (매 세션)

앱이 닫히거나 화면이 전환될 때 실행됩니다.

```javascript
// gopang-app.js
window.addEventListener('pagehide', _saveOnce);
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') _saveOnce();
});
```

```javascript
// src/gopang/core/session.js — _saveSessionOnce()
const sessionData = {
  sessionId,
  guid,
  startedAt, endedAt,
  domain,           // 도메인 분류 (MKT, JUS, ECO ...)
  turns,
  messages[],       // 대화 + 거래 전체 원문
};

const sessionRaw  = JSON.stringify(sessionData);
const sessionHash = SHA-256(sessionRaw);          // 세션 전체를 1개 해시로
const result      = await anchor(sessionHash, guid, sessionId);
```

수행 내용:

```
① sessionData 구성 (대화 + 거래 전체 원문)
② SHA-256(sessionData JSON) = sessionHash
③ hashChain.anchor(sessionHash, guid, sessionId)
     → entryHash (이전 세션의 entryHash를 prevHash로 참조)
④ localStorage 저장 (원문 보존)
⑤ POST /pdv/report { block_hash: entryHash, type: 'session_end' }
```

### 2.3 거래 시 (K-Market)

거래는 세션에 포함되므로 별도 앵커링 없이 세션 종료 시 함께 기록됩니다. 단, 거래의 재무 기록은 즉시 처리됩니다.

```
거래 발생 → POST /biz/order → CF Worker
  └─ fs_ledger INSERT (market_purchase RPC)
       buyer  debit  amount
       seller credit amount - fee(3%)
       platform credit fee(3%)
  └─ user_profiles.extra.fs 갱신 (settleLedger)
  └─ pdv_log INSERT (openhash_anchored: true, block_hash 포함)
```

---

## 3. Hash Chain 알고리즘

### 3.1 엔트리 해시 공식

```
h_i = SHA-256(h_{i-1} ∥ msgHash ∥ senderSig ∥ blockHeight ∥ timestamp)

h_{i-1}     = 이전 엔트리 해시 (최초: 0×64)
msgHash     = SHA-256(content)
senderSig   = 사용자 GUID (가입) 또는 Ed25519 서명 (거래)
blockHeight = Math.floor(Date.now() / 1000)
timestamp   = ISO 8601
```

같은 원문이라도 실행 시각과 체인 상태가 다르면 반드시 다른 해시가 생성됩니다. 이것이 위변조 방지의 핵심입니다.

### 3.2 계층 선택 (PLSM)

```javascript
// src/openhash/plsm.js
bucket = BigInt('0x' + doubleSHA256(txData)) % 1000n

L1: 0~599   (60%) ← 가장 빈번
L2: 600~799 (20%)
L3: 800~899 (10%)
L4: 900~959  (6%)
L5: 960~999  (4%) ← 글로벌
```

계층은 txData의 해시로 결정됩니다. 합의 없이 확률적으로 부하를 분산합니다.

### 3.3 Merkle 배치

```
1시간마다 배치 실행
  └─ 대기 중인 엔트리 해시 수집
  └─ Merkle Root = buildMerkleRoot(hashes)
  └─ 메인넷 블록에 Root 1개만 기록
       → Root 하나로 배치 내 모든 엔트리 포함 증명 가능
```

---

## 4. PDV 저장 구조

### 4.1 2중 저장

```
클라이언트                          서버 (Supabase)
────────────────────                ──────────────────
localStorage                        pdv_log 테이블
  gopang_history_{guid}_{date}        guid, type
  └─ 세션 원문 (대화 + 거래)           summary_6w (6하원칙)
                                      block_hash
                                      openhash_anchored
                                      chain_height

                                    l1_ledger 테이블
                                      block_hash
                                      user_hash
                                      node_hash (Merkle 체인)
```

### 4.2 6하원칙 (PDV 표준)

모든 pdv_log 레코드는 6하원칙으로 기록됩니다.

| 항목 | 내용 |
|---|---|
| who | 사용자 GUID (ipv6) |
| when | ISO 8601 타임스탬프 |
| where | 서비스 URL |
| what | 이벤트 요약 |
| how | 수단 (전화번호 입력 / AI 대화 / Ed25519 서명) |
| why | 목적 (가입 / 대화 / 구매) |

---

## 5. 거래 검증 (BIVM)

모든 거래는 BIVM(Balance Invariant Verification Module)으로 검증합니다.

```
Σdebit = Σcredit  (복식부기 균형)

예: 짜장면 12,000원 구매
  buyer  debit  12,000   (지출)
  seller credit 11,640   (수입, fee 제외)
  platform credit  360   (수수료 3%)
  ──────────────────────
  Σdebit 12,000 = Σcredit 12,000  ✓
```

불균형 감지 시 거래가 거부됩니다.

---

## 6. 구현 파일 목록

| 파일 | 역할 |
|---|---|
| `src/gopang/core/auth.js` | 가입 시 PDV 초기화 + 앵커링 (`_recordRegisterPdv`) |
| `src/gopang/core/session.js` | 세션 종료 시 전체 앵커링 (`_saveSessionOnce`) |
| `src/gopang/ai/call-ai.js` | AI 대화 처리 (턴별 앵커링 없음 — 세션 단위로 통합) |
| `src/gopang/pdv/record.js` | PDV 기록 공통 함수 (`recordPDV`, `_recordPDV`) |
| `src/openhash/hashChain.js` | 해시 체인 앵커링 + Merkle 배치 |
| `src/openhash/plsm.js` | 확률적 계층 선택 |
| `src/openhash/bivm.js` | 잔액 불변성 검증 |
| `src/openhash/ilmv.js` | 계층 간 교차 검증 |
| `src/openhash/transactionPipeline.js` | 거래 처리 파이프라인 (Stage 1~5) |
| `src/openhash/importanceVerifier.js` | 중요도 기반 적응형 검증 |
| `worker.js` | CF Worker — PDV 수신, fs_ledger, L1 앵커링 |

---

## 7. 테스트

```powershell
# 통합 테스트 실행
node --experimental-vm-modules src/tests/phase_anchor_integration.test.js
```

### 테스트 항목 (A-01 ~ A-12)

| ID | 검증 내용 |
|---|---|
| A-01 | 가입 앵커링 — entryHash 64자, layer 반환 |
| A-02 | 가입 앵커링 — msgId로 체인 내 조회 |
| A-03 | 최초 prevHash = `0×64` (genesis) |
| A-04 | 대화 앵커링 — entryHash + layer |
| A-05 | 대화 2턴 — prevHash 체인 연결 |
| A-06 | userHash ≠ asstHash (원문 분리 해싱) |
| A-07 | 거래 앵커링 — entryHash 반환 |
| A-08 | 동일 txHash 2회 → entryHash 상이 |
| A-09 | BIVM Σδ=0 검증 |
| A-10 | 가입→대화→거래 3단계 prevHash 연결 |
| A-11 | Merkle Root + Proof 검증 |
| A-12 | verifyChainIntegrity 전체 통과 |

---

## 8. 전체 흐름 요약

```
사용자 가입
  └─ _recordRegisterPdv()
       ├─ hashChain.anchor() → entryHash [체인 시작]
       ├─ pdv_log INSERT (openhash_anchored: true)
       └─ extra.fs 초기화 { bs-cash:0, ... }

앱 사용 (대화 + 거래)
  └─ history[] 메모리 누적
  └─ fs_ledger INSERT (거래 시 즉시)

앱 종료 (visibilitychange / pagehide)
  └─ _saveSessionOnce()
       ├─ sessionData = { 모든 대화 + 거래 원문 }
       ├─ sessionHash = SHA-256(sessionData)
       ├─ hashChain.anchor(sessionHash) → entryHash
       │     prevHash = 이전 세션 entryHash [체인 연결]
       ├─ localStorage 저장 (원문)
       └─ pdv_log INSERT (openhash_anchored: true)

1시간마다
  └─ buildMerkleRoot(엔트리 해시들)
  └─ 메인넷 블록 기록
```
