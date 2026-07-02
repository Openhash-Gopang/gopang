# 고팡 시스템 백서
## Chapter 7. PDV · OpenHash 통합 앵커링 설계
### 2026-06-15 구현 세션 반영

> **버전**: v1.0 · 2026-06-15  
> **저자**: AI City Inc.  
> **관련 파일**: `src/openhash/hashChain.js`, `src/gopang/core/auth.js`, `src/gopang/core/session.js`, `src/gopang/ui/p2p-chat.js`, `gopang-wallet.js`, `worker.js`, `src/gopang/ui/settings.js`

---

## 목차

- 7.1 설계 원칙 — 저장소 역할 분리
- 7.2 Hash Chain 통합 — 단일 앵커 체인
- 7.3 anchor() 인터페이스 — Ed25519 서명 구조
- 7.4 이벤트별 앵커링 흐름
- 7.5 변조 탐지 원리
- 7.6 GDUDA P2P 대화 — 연결부터 앵커링까지
- 7.7 사용자 인터페이스 — 설정 패널 내 기록 조회
- 7.8 재무제표 — extra.fs 추적 구조
- 7.9 구현 현황 및 로드맵

---

## 7.1 설계 원칙 — 저장소 역할 분리

고팡 플랫폼의 데이터 저장은 세 계층으로 명확히 분리됩니다.

```
┌─────────────────────────────────────────────────────┐
│  사용자 기기 (IndexedDB / vault.js)                  │
│  원본 데이터 보관 주체 = 사용자 본인                  │
│    · 대화 원문 (AES-256-GCM 암호화)                  │
│    · 거래 원문 (buyer + seller 서명 포함)            │
│    · 가입 원문                                       │
│    · Hash Chain (anchor_chain store)                 │
└──────────────────────┬──────────────────────────────┘
                       │ SHA-256(원문) = contentHash
                       │ Ed25519 서명
                       ↓
┌─────────────────────────────────────────────────────┐
│  OpenHash L1 PocketBase (l1-hanlim.hondi.net)      │
│  Hash 기록 주체 = OpenHash Network                   │
│    · entryHash (체인 앵커)                           │
│    · block_hash                                      │
│    · merkle_root (1시간 배치)                        │
└──────────────────────┬──────────────────────────────┘
                       │ 백업
                       ↓
┌─────────────────────────────────────────────────────┐
│  Supabase (백업 / 검색 인덱스)                       │
│    · user_profiles (공개 정보 + extra.fs)            │
│    · global_profiles (GDUDA 닉네임 검색)             │
│    · pdv_log (entryHash 사본, 원문 없음)             │
│    · webrtc_signals (P2P 시그널링, 휘발성)           │
└─────────────────────────────────────────────────────┘
```

**핵심 원칙**: OpenHash Network에는 **해시만** 기록합니다. 원문은 사용자 기기에만 보관되며, 검증 시 원문에서 SHA-256을 재계산하여 체인의 entryHash와 대조합니다.

---

## 7.2 Hash Chain 통합 — 단일 앵커 체인

### 7.2.1 통합 전 문제

이번 세션 이전에는 두 개의 독립적인 Hash Chain이 존재했습니다.

| | GDC Wallet Chain | OpenHash Anchor Chain |
|---|---|---|
| 파일 | `gopang-wallet.js` | `hashChain.js` |
| DB | `gopang-wallet` | `gopang-openhash` (별도) |
| keyPath | `height` (거래 횟수) | `entryHash` |
| 해시 공식 | SHA-256(prev ∥ tx_hash ∥ block_hash ∥ height) | SHA-256(prevHash ∥ contentHash ∥ sigs ∥ blockHeight) |
| 기록 이벤트 | 거래만 | 가입/대화/거래 |

**문제점**: 두 체인이 서로 다른 역사를 기록 → 어느 쪽이 진실인지 판별 기준 없음. 거래와 대화의 인과관계를 체인으로 증명 불가.

### 7.2.2 통합 설계

```
단일 체인 원칙:
  모든 이벤트(가입 → 대화 → 거래 → 대화)가
  하나의 체인에 시간 순으로 기록됨

  → "이 거래 전에 어떤 대화가 있었는가?" 증명 가능
  → 하나를 변조하면 이후 모든 prevHash가 깨짐
  → 단일 진실 원천 (Single Source of Truth)
```

**통합 결과**:

```
DB:    gopang-wallet (IDB v3)
Store: anchor_chain (keyPath: 'entryHash')

gopang-wallet.js appendHashChain()
  → hashChain.js anchor() 호출
  → 동일 store에 기록

이벤트 순서 예시:
  #0 Genesis  [👤 가입]  entryHash: 640427e2... prevHash: 0000...
  #1          [💬 P2P]   entryHash: efd942eb... prevHash: 640427e2...
  #2          [💰 거래]  entryHash: 07ad6089... prevHash: efd942eb...
  #3          [🤖 AI]    entryHash: 95b390e8... prevHash: 07ad6089...
```

### 7.2.3 IDB 버전 관리

```javascript
// gopang-wallet.js / hashChain.js 공통
const IDB_VER = 3;  // v3: anchor_chain 통합

onupgradeneeded:
  oldVer < 1: keys store 생성
  oldVer < 2: hash_chain store 생성 (구버전 — 거래 전용)
  oldVer < 3: hash_chain 삭제
              anchor_chain 생성 (keyPath: 'entryHash')
```

---

## 7.3 anchor() 인터페이스 — Ed25519 서명 구조

### 7.3.1 함수 시그니처

```javascript
// src/openhash/hashChain.js
anchor(contentHash, signatures, msgId)

// contentHash: SHA-256(원본 데이터) — 64자 hex
//              원본은 vault.js(IndexedDB)에 보관
// signatures:  Ed25519 서명 배열 (Base64)
//   가입/대화: [userSig]             — 사용자 단방향 서명
//   거래:      [buyerSig, sellerSig] — 양방 서명
// msgId:       이벤트 식별자

// 반환:
// entryHash = SHA-256(prevHash ∥ contentHash ∥ signatures.join('|') ∥ blockHeight ∥ timestamp)
```

### 7.3.2 위변조 방지 2중 레이어

```
레이어 1: prevHash 체인 (위변조 방지 핵심)
  entryHash_i = SHA-256(prevHash_{i-1} + ...)
  → 과거 기록 변조 시 이후 모든 entryHash 재계산 필요
  → L1 노드 전체가 원본 entryHash 보유 → 불가능

레이어 2: Ed25519 서명 (신원 증명)
  → "누가 이 데이터를 승인했는가"
  → 금액 변조 시 contentHash 변경 → 서명 불일치 탐지
```

### 7.3.3 서명 구조

| 이벤트 | 서명 주체 | 서명 대상 | 특이사항 |
|---|---|---|---|
| 가입 | 사용자 1명 | SHA-256(가입 원문) | wallet.setIdentity() 후 서명 |
| 대화 세션 | 사용자 1명 | SHA-256(세션 전체) | 세션 종료 시 1회 |
| 거래 | buyer + seller 2명 | SHA-256(거래 원문) | seller는 상품 등록 시 사전 서명 |

---

## 7.4 이벤트별 앵커링 흐름

### 7.4.1 가입 (user_register)

```
① 가입 원문 구성
   { type:'user_register', guid, handle, nickname, e164, country_code, ts }

② vault.js — IndexedDB에 원문 저장 (AES-256-GCM)

③ contentHash = SHA-256(원문)

④ gopangWallet.setIdentity({ guid, handle })  ← guid 주입 필수
   userSig = gopangWallet.sign(contentHash)

⑤ anchor(contentHash, [userSig], sessionId)
   → entryHash (체인 첫 기록, prevHash = 0×64)

⑥ POST /pdv/report { block_hash: entryHash }
   → pdv_log INSERT, openhash_anchored: true

⑦ extra.fs 초기화
   { 'bs-cash':0, 'pl-purchase':0, 'pl-revenue':0,
     'last_tx_id':null, 'last_block_hash':null }
```

**구현 주의사항**: `gopang-wallet.js`는 모듈 로드 시 1회만 `localStorage`에서 guid를 읽습니다. 신규 등록 직후에는 wallet의 guid가 `null`이므로, `_recordRegisterPdv()` 호출 전 반드시 `window.gopangWallet.setIdentity({ guid, handle })`를 직접 호출해야 합니다.

### 7.4.2 대화 세션 (session_end)

```
[앱 진입] → 대화 진행 → [앱 종료: visibilitychange / pagehide]
                                    ↓
① sessionData 구성
   { sessionId, guid, startedAt, endedAt, domain, turns, messages[] }
   모든 대화 원문 포함

② vault.js — IndexedDB에 원문 저장

③ contentHash = SHA-256(sessionRaw)

④ userSig = gopangWallet.sign(contentHash)

⑤ anchor(contentHash, [userSig], sessionId) → entryHash
   prevHash = 이전 이벤트 entryHash (체인 연결)

⑥ localStorage 저장 (entryHash 포함)
   { ts, domain, turns, sessionId, entryHash, layer }
   ← 앵커링 완료 후 저장 (entryHash 확보 후)

⑦ POST /pdv/report { block_hash: entryHash }
```

**설계 원칙**: localStorage 저장은 반드시 `anchor()` 완료 후 실행합니다. 이로써 Hash Chain 보기에서 AI 대화 세션도 `entryHash`와 함께 표시됩니다.

### 7.4.3 P2P 대화 (p2p_session)

```
[P2P 연결] → 대화 → [나가기 버튼 클릭]
                          ↓
_closeP2P()
  → DataChannel.send({ type:'bye' })  ← 상대방에게 종료 신호
  → _saveP2PSession()

_saveP2PSession():
① sessionData = { myGuid, peerGuid, peerHandle, messages[], ... }
② vault.js (IndexedDB, gopang_pdv_dev / messages store)
③ contentHash = SHA-256(sessionRaw)
④ userSig = gopangWallet.sign(contentHash)
⑤ anchor(contentHash, [userSig], sessionId) → entryHash
⑥ localStorage 백업 { peerHandle, entryHash, turns, ... }
⑦ POST /pdv/report

상대방 (bye 수신):
  "🔴 상대방이 대화를 종료했습니다."
  → 1.5초 후 _closeP2P() 실행 → 동일 흐름으로 PDV 저장
```

### 7.4.4 거래 (market_purchase)

거래는 세션 종료를 기다리지 않고 **즉시** 앵커링합니다. 재무제표(`extra.fs`)가 변경되는 시점과 앵커링 시점이 일치해야 위변조 탐지가 가능하기 때문입니다.

```
거래 발생 → POST /biz/order → Cloudflare Worker
  ① L1 PocketBase → block_hash 반환
  ② fs_ledger INSERT (BIVM 검증: Σdebit = Σcredit)
  ③ extra.fs 기존 값 조회 후 병합
     newFs = { ...prevFs, ...fsPatch }
     fsPatch = {
       'last_tx_id':      tx_hash,
       'last_block_hash': block_hash,
       'last_tx_record':  txRecord,  ← buyer+seller 서명 포함
       'last_updated_at': now,
     }
  ④ user_profiles PATCH (buyer + seller 각각)
```

**extra.fs 병합 이유**: PATCH 시 기존 `bs-cash`, `pl-purchase`, `pl-revenue` 값을 보존해야 합니다. 덮어쓰기 방식은 잔액이 초기화됩니다.

---

## 7.5 변조 탐지 원리

```
공격자가 금액 12,000 → 1,200으로 변조 시도:

원본:   SHA-256({...total:12000...}) = contentHash_A
변조:   SHA-256({...total:1200...})  = contentHash_B  ← 다름

buyer 서명 = sign(contentHash_A)
  verifySignature(contentHash_B, buyerSig) → false  ← 탐지

entryHash_A = SHA-256(prevHash + contentHash_A + buyerSig + ...)
변조 재현:   SHA-256(prevHash + contentHash_B + ???) → 다른 해시

L1 PocketBase 원본 entryHash_A와 불일치 → 변조 확인
```

### 7.5.1 재무제표 잔액 추적

```
extra.fs['bs-cash'] = 100   ← 잔액이 왜 100인가?
  last_tx_id = 'TX-abc123'  ← 마지막 거래 식별자
    ↓
  fs_ledger WHERE tx_id = 'TX-abc123'
    ↓
  last_block_hash = 'e862f1...'  ← L1 앵커
    ↓
  L1 PocketBase에서 검증
```

---

## 7.6 GDUDA P2P 대화 — 연결부터 앵커링까지

### 7.6.1 사용자 검색 구조

```
P2P 검색 흐름:
  주피터 (Chrome, KR 한림읍)
    → POST /p2p/register { guid, handle, nickname, country_code, region }
    → Supabase global_profiles INSERT

  james (Edge, US New York)
    → POST /p2p/register
    → Supabase global_profiles INSERT

  주피터 → GET /p2p/search?q=james
    → global_profiles 닉네임 검색
    → James 프로필 반환
```

### 7.6.2 WebRTC P2P 연결

```
시그널링 서버 (Cloudflare Worker):
  SDP/ICE만 경유 — 60초 TTL 후 자동 삭제
  메시지 본문 절대 서버에 저장 안 함

연결 흐름:
  주피터 → offer 전송 (PROXY /signal/send)
  James  ← offer 수신 (PROXY /signal/poll)
  James  → answer 전송
  주피터 ← answer 수신
  양측   → ICE candidate 교환
  DataChannel 개설 → 암호화 P2P 통신
```

### 7.6.3 닉네임 로그인

전화번호 이외에 닉네임으로도 로그인할 수 있습니다.

```javascript
// 입력값 판별: 숫자가 아니면 닉네임으로 처리
const isNickname = val.length > 0 && !/^\d+$/.test(val);

// 닉네임 3단계 폴백 (대소문자 처리)
for (const nick of [val, val.toLowerCase(), val[0].toUpperCase() + val.slice(1).toLowerCase()]) {
  const res = await fetch(`${L1_URL}?filter=nickname='${nick}'&perPage=1`);
  const found = (await res.json()).items?.[0];
  if (found) { login(found); break; }
}
```

---

## 7.7 사용자 인터페이스 — 설정 패널 내 기록 조회

### 7.7.1 설정 패널 구조

```
설정
  계정
    @96627170 (등록됨)

  내 기록
    💬 이전 대화 기록   →  목록 → 클릭 → 원문 조회
    ⛓️  Hash Chain      →  anchor_chain store 표시
    💰 Gopang Wallet   →  extra.fs 잔액 + 거래 상세
    📊 재무제표         →  4탭 (대차대조표/손익/현금흐름/재무분석)

  AI 설정
  권한 설정
  로그아웃
  앱 캐시 초기화
```

### 7.7.2 이전 대화 기록 조회 흐름

```
openChatHistory()
  → localStorage 'gopang_history_*' 조회
  → P2P 세션 (domain='P2P' 또는 peerHandle 있는 것) 필터
  → 목록 표시 (peerHandle, 날짜시각, 턴 수)

항목 클릭 → _openChatDetail(idx)
  → indexedDB.open('gopang_pdv_dev')
  → messages store.get(sessionId)
  → JSON.parse(content).messages 원문 표시
  → 닫기 → 목록 복귀
```

### 7.7.3 Hash Chain 조회

```
openHashChain()
  → indexedDB.open('gopang-wallet', 3)
  → anchor_chain store.getAll()
  → recorded_at 오름차순 정렬
  → 표시: 순서 / 이벤트 유형 / 시각 / layer / entryHash / prevHash
```

### 7.7.4 재무제표 — 4탭 구조

```
대차대조표 (Balance Sheet)
  자산 · 현금 (bs-cash): ₮N
  자산 합계: ₮N

손익계산서 (P&L)
  수입 (pl-revenue): +₮N
  지출 (pl-purchase): -₮N
  순이익: ±₮N

현금흐름표 (Cash Flow)
  영업 활동: ₮N (netIncome으로 근사)
  투자 활동: ₮0
  재무 활동: ₮0
  순 현금 증감: ±₮N
  기말 현금: ₮N

재무분석 (Financial Analysis)
  수익률 / 유동비율 / 부채비율 / 총거래 횟수
  총 수입 / 총 지출 / 평균 거래금액 / 순자산
```

---

## 7.8 재무제표 — extra.fs 추적 구조

### 7.8.1 필드 구조

```javascript
user_profiles.extra.public.finance.fs = {
  'bs-cash':          100,           // wallet 잔액 (현금 계정)
  'pl-purchase':      0,             // 지출 누적
  'pl-revenue':       90,            // 수입 누적
  'last_tx_id':       'TX-abc123',   // 마지막 거래 식별자
  'last_block_hash':  'e862f1...',   // L1 PocketBase 앵커
  'last_tx_record':   '{"tx_id"...}',// 거래 원문 (buyer+seller 서명)
  'last_updated_at':  '2026-06-15T...',
}
```

### 7.8.2 BIVM 검증

모든 거래는 잔액 불변성 검증(BIVM)을 통과해야 합니다.

```
Σdebit = Σcredit

예: 짜장면 12,000원 구매
  buyer  debit  12,000   (지출)
  seller credit 11,640   (수입, 수수료 3% 제외)
  플랫폼 credit    360   (수수료 3%)
  ──────────────────────
  Σdebit 12,000 = Σcredit 12,000  ✓
```

---

## 7.9 구현 현황 및 로드맵

### 7.9.1 2026-06-15 구현 완료

| 항목 | 파일 | 내용 |
|---|---|---|
| Hash Chain 통합 | `gopang-wallet.js`, `hashChain.js` | GDC 거래 체인 + OpenHash 앵커 체인 → `anchor_chain` 단일화 |
| anchor() 서명 구조 | `hashChain.js` | `anchor(contentHash, signatures[], msgId)` |
| 가입 앵커링 | `auth.js` | Ed25519 서명 + wallet.setIdentity() 직접 주입 |
| AI 대화 앵커링 | `session.js` | 세션 종료 시 전체 → entryHash를 localStorage에 포함 |
| P2P 대화 앵커링 | `p2p-chat.js` | 나가기 버튼 → bye 신호 → 양측 PDV 저장 |
| 거래 extra.fs 병합 | `worker.js` | 기존 fs 조회 후 병합 (덮어쓰기 방지) |
| 닉네임 로그인 | `auth.js` | 3단계 대소문자 폴백 정확 일치 |
| IDB 버전 통합 | `hashChain.js`, `gopang-wallet.js` | v3: `anchor_chain` (keyPath: `entryHash`) |
| 설정 패널 | `webapp.html`, `settings.js`, `gopang-app.js` | 이전 대화 / Hash Chain / Wallet / 재무제표 4탭 |
| P2P 검색 | Supabase `global_profiles` | 주피터↔James 검색 및 연결 실증 |

### 7.9.2 실증 테스트 결과 (2026-06-15)

```
테스트 환경:
  Chrome (시크릿)  → 주피터 (@96627170, KR 한림읍)
  Edge (시크릿)    → James  (@US-1234567890, US New York)

앵커링 기록 (Supabase pdv_log):
  09:19:08 entryHash: cccae213... layer:L1  openhash_anchored:true
  09:21:17 entryHash: 7e17976a... layer:L4
  09:26:59 entryHash: 95b390e8... layer:L1
  09:34:48 entryHash: efd942eb... layer:L2
  09:36:49 entryHash: 07ad6089... layer:L1

원문 저장 (IndexedDB gopang_pdv_dev / messages):
  P2P-2601db80c342-1781515620336 | turns:2
    { role:'me',   content:'안녕' }
    { role:'peer', content:'니아호' }
  P2P-2601db80c342-1781516088838 | turns:2
  P2P-2601db80c342-1781516209100 | turns:2
```

### 7.9.3 미해결 이슈

| 항목 | 원인 | 예정 |
|---|---|---|
| pdv_log session_id = null | `/pdv/report` 전송 시 필드 누락 | 다음 세션 |
| James(Edge) PDV 미확인 | Edge SW 캐시로 신버전 미적용 | SW 버전 갱신 후 재테스트 |
| anchor_chain 통합 미배포 | `gopang-wallet.js` 변경 미검증 | 배포 후 확인 필요 |

### 7.9.4 다음 단계

```
Phase 2 (단기):
  · Supabase → L1 PocketBase 검색 전환 (GDUDA 본 구현)
  · seller 사전 서명 (상품 등록 시) 구현
  · anchor_chain 통합 배포 후 실증

Phase 3 (중기):
  · OpenHash L2~L5 노드 구성
  · Merkle 배치 → 메인넷 블록 연동
  · vault.js 암호화 원문 복호화 검증 UI
```

---

## 부록 — 핵심 알고리즘

### A. 엔트리 해시 공식

```
h_i = SHA-256(h_{i-1} ∥ contentHash ∥ signatures.join('|') ∥ blockHeight ∥ timestamp)

h_{i-1}      = 이전 entryHash (최초: 0×64)
contentHash  = SHA-256(원본 데이터)
signatures   = Ed25519 서명 배열
blockHeight  = Math.floor(Date.now() / 1000)
timestamp    = ISO 8601
```

### B. 계층 선택 (PLSM)

```
bucket = doubleSHA256(msgId) mod 1000

L1: 0~599   (60%)  ← l1-hanlim.hondi.net (현재 운영)
L2: 600~799 (20%)  ← 준비 중
L3: 800~899 (10%)  ← 준비 중
L4: 900~959  (6%)  ← 준비 중
L5: 960~999  (4%)  ← 준비 중 (글로벌)
```

### C. 용어 정의

| 용어 | 정의 |
|---|---|
| PDV | Private Data Vault — 사용자 기기 로컬 암호화 저장소 |
| anchor_chain | gopang-wallet IDB의 통합 앵커 체인 (keyPath: entryHash) |
| contentHash | SHA-256(원본 데이터) — OpenHash에 기록되는 해시 |
| entryHash | SHA-256(prevHash ∥ contentHash ∥ sigs ∥ ...) — 체인 노드 |
| extra.fs | user_profiles.extra.public.finance.fs — 재무 상태 필드 |
| BIVM | Balance Invariant Verification Module — 잔액 불변성 검증 |
| GDUDA | Gopang Distributed User Discovery Algorithm |
| PLSM | Probabilistic Layer Selection Module — 계층 선택 모듈 |
