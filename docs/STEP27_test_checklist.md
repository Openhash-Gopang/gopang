# STEP 27 — 전체 시나리오 통합 테스트 체크리스트
**기준** Gopang 통합 연동 설계 명세서 v4.0 + gopang_impl_steps_v2.md  
**환경** Oracle Cloud VM 168.110.123.175 / Supabase / Cloudflare Worker v4.9  
**작성** AI City Inc. 팀 주피터 | 2026-06

---

## 사전 준비 — 환경 확인

```powershell
# 1) L1 노드 Health 확인
curl https://l1-hanlim.hondi.net/health

# 2) Worker 확인
curl https://gopang-proxy.tensor-city.workers.dev/health

# 3) PocketBase blocks 컬렉션 초기 상태 확인 (SSH 터널 후)
ssh -i gopang-l1.key -L 9091:127.0.0.1:8091 ubuntu@168.110.123.175
# → 브라우저: http://127.0.0.1:9091/_/ → blocks 컬렉션 행 수 메모

# 4) Supabase fs_ledger 초기 행 수 메모
# SQL Editor: SELECT COUNT(*) FROM fs_ledger;

# 5) 테스트용 구매자·판매자 계정 준비
# 구매자: hondi.net 접속 → 지갑 생성 확인 (window.gopangWallet 확인)
# 판매자: @보영반점#BOY1 — extra.menu SQL 실행 완료 확인
```

---

## 테스트 01 — 발화·라우팅·컨텍스트 인출

**목적** 고팡이 PDV에서 컨텍스트를 인출하여 kcommerce로 정확히 라우팅하는지 확인

### 실행 절차
```
1. hondi.net 접속 → 채팅창에 "짜장면 두 그릇 주문해줘" 입력
2. 브라우저 개발자 도구 → Network 탭 → /pdv/query 요청 확인
3. AI 응답에 [GWP:kcommerce] 태그 포함 확인
4. market.hondi.net 새 탭 자동 오픈 확인
5. GWP 토큰(gwp=1) URL 파라미터 확인
6. 고팡 채팅창에 "K-Market을 연결합니다" 문구 확인
```

### 체크리스트
- [ ] AI 응답에 `[GWP:kcommerce]` 포함
- [ ] market 탭이 `?gwp=1&token=...&ctx=...` 형식으로 열림
- [ ] market 탭 콘솔에 `[SP] K-Market SP 로드 완료` 로그
- [ ] market AI가 인사 없이 바로 한림읍 중식당 검색 시작

### 기대 결과
market 탭에 한림읍 근처 중식당 목록 (보영반점 포함) 표시

---

## 테스트 02 — 검색 결과 primary_guid 포함

**목적** search_entities() 반환값에 primary_guid가 있고, [TRADE] 블록에 seller_guid 포함 확인

### 실행 절차
```
1. market 탭 콘솔에서 직접 실행:
   const res = await fetch('https://ebbecjfrwaswbdybbgiu.supabase.co/rest/v1/rpc/search_entities', {
     method: 'POST',
     headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
     body: JSON.stringify({ p_keyword: '짜장면', p_occupation: '중식' })
   });
   const data = await res.json();
   console.log(data[0]);  // primary_guid 필드 확인

2. market AI에 "보영반점으로 짜장면 2그릇" 입력
3. AI 응답 텍스트에서 [TRADE] 블록 파싱 확인
4. _parseTrade() 콘솔 로그 확인
```

### 체크리스트
- [ ] `data[0].primary_guid` 값 존재 (`pguid-BOYOUNG` 또는 실제 GUID)
- [ ] AI [TRADE] 블록에 `seller_guid:` 필드 포함
- [ ] `seller_guid` 값이 `primary_guid`와 일치
- [ ] 콘솔: `[Market] 거래 PDV 기록 완료: {txId} | seller: pguid-BOYOUNG`
- [ ] `fs_account_buyer: pl-purchase` (구버전 "purchase" 아님)

### 기대 결과
`seller_guid = 'pguid-BOYOUNG'` (또는 실제 등록된 primary_guid)

---

## 테스트 03 — GWP_SIGN_REQUEST 서명 흐름

**목적** 음식점 profile.html에서 구매자 서명 요청이 고팡 탭으로 전달되고 서명 UI가 표시되는지 확인

### 실행 절차
```
1. hondi.net 탭 열어둔 상태에서
   users.hondi.net/@보영반점#BOY1 접속 (새 탭)
2. 메뉴 섹션 표시 확인 (짜장면·짬뽕·볶음밥·탕수육)
3. 짜장면 +2, 짬뽕 +1 선택 → 하단 주문 바 "₮ 37,000" 표시 확인
4. [🛒 주문하기] 클릭
5. 고팡 탭 자동 포커스 확인
6. 고팡 탭에 서명 확인 UI 표시 확인 (인라인 카드)
```

### 체크리스트
- [ ] 메뉴 섹션 표시 (extra.menu SQL 실행 전제)
- [ ] 수량 조절 (+/−) 정상 동작
- [ ] 하단 주문 바 합계 정확: 짜장면₮24,000 + 짬뽕₮13,000 = ₮37,000
- [ ] 고팡 탭에 서명 확인 카드 렌더링:
  - [ ] 품목별 금액 표시
  - [ ] 합계 ₮37,000
  - [ ] 현재 잔액 표시
  - [ ] 결제 후 잔액 표시 (잔액 충분 시 초록, 부족 시 빨강)
  - [ ] [🔏 서명하여 결제] 버튼 활성
  - [ ] [취소] 버튼 존재
- [ ] 고팡 탭 콘솔: `[GWP_SIGN] 서명 확인 UI 표시 | session_id: ...`
- [ ] 판매자 서명 요청 단계 없음 (직접 판매자에게 요청 없음)

### 기대 결과
구매자 1회 서명으로 거래 완결 가능한 UI 표시

---

## 테스트 04 — L1 4단계 검증

**목적** L1이 서명·공개키·prev_settle_hash·잔액 검증을 모두 수행하고 블록을 생성하는지 확인

### 실행 절차
```
1. 테스트 03에 이어 [서명하여 결제] 클릭
2. 고팡 탭 콘솔에서 서명 로그 확인:
   [GWP_SIGN] 서명 완료 → market 탭 전송 | session_id: ...
3. Worker 로그 확인 (Cloudflare Dashboard → gopang-proxy → Logs)
   → POST /biz/order 요청 확인
   → L1 /api/tx 위임 로그 확인
4. PocketBase Admin (http://127.0.0.1:9091/_/)
   → blocks 컬렉션 신규 행 확인
```

### 체크리스트
- [ ] 고팡 콘솔: `[GWP_SIGN] 서명 완료`
- [ ] gopang-wallet.js 콘솔: `[Wallet] redeemClaim` 또는 서명 로그
- [ ] Worker 로그: `POST /biz/order → L1 /api/tx`
- [ ] PocketBase blocks 컬렉션 신규 행:
  - [ ] `block_type = 'tx_2party'`
  - [ ] `buyer_guid` 값 있음
  - [ ] `seller_guid` 값 있음
  - [ ] `buyer_sig` 값 있음
  - [ ] `content_hash` 값 있음
  - [ ] `prev_block_hash` 값 있음 (2번째 블록부터)

### 오류 시나리오 확인 (별도 테스트)
```javascript
// 서명 위조 테스트 — L1 콘솔에서 직접
const fakeTx = { ...validTx, buyer_sig: 'AAAA' };
const res = await fetch('https://l1-hanlim.hondi.net/api/tx', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(fakeTx)
});
const data = await res.json();
// 기대: { error: 'INVALID_SIGNATURE' }
```
- [ ] 서명 위조 → `INVALID_SIGNATURE` 반환
- [ ] 오래된 prev_settle_hash → `STALE_STATE` 반환
- [ ] 잔액 초과 → `INSUFFICIENT_BALANCE` 반환

### 기대 결과
4단계 검증 모두 통과, `block_hash` 생성

---

## 테스트 05 — 동기 앵커링 및 fs_ledger 기록

**목적** Worker가 L1 응답 수신 후 즉시 pdv_log와 fs_ledger를 기록하는지 확인

### 실행 절차
```sql
-- Supabase SQL Editor에서 테스트 04 직후 실행

-- 1) fs_ledger 3행 확인
SELECT tx_id, guid, direction, amount, fs_account, source, seller_guid, buyer_guid, block_hash, prev_settle_hash
FROM fs_ledger
ORDER BY id DESC
LIMIT 5;

-- 2) pdv_log 앵커링 확인
SELECT id, svc, openhash_anchored, openhash_anchored_at, block_hash, reporter_svc, session_id
FROM pdv_log
ORDER BY created_at DESC
LIMIT 3;
```

### 체크리스트
- [ ] `fs_ledger`에 동일 `tx_id`로 3행 존재 (구매자 / 판매자 / 플랫폼)
- [ ] 3행 모두 `block_hash` 값 있음 (NULL 아님)
- [ ] 3행 모두 `prev_settle_hash` 값 있음 (NULL 아님)
- [ ] 3행 모두 `source = 'market'`
- [ ] 구매자 행: `fs_account = 'pl-purchase'`, `direction = 'debit'`
- [ ] 판매자 행: `fs_account = 'pl-revenue'`, `direction = 'credit'`
- [ ] 플랫폼 행: `fs_account = 'pl-platform_fee'`, `direction = 'debit'`
- [ ] `pdv_log` 행: `openhash_anchored = true`
- [ ] `pdv_log` 행: `openhash_anchored_at` NOT NULL (즉시 기록)
- [ ] `pdv_log` 행: `reporter_svc = 'kmarket'`
- [ ] `pdv_log` 행: `via_worker = true`

### 기대 결과
응답 수신과 동시에 모든 기록 완료. 비동기 대기 없음.

---

## 테스트 06 — 구매자 Hash Chain 갱신

**목적** gopang-wallet.js가 블록 응답을 받아 IndexedDB에 Hash Chain을 기록하는지 확인

### 실행 절차
```
1. 테스트 04 완료 후 hondi.net 탭에서
2. 브라우저 개발자 도구 → Application → Storage → IndexedDB
   → gopang-wallet → hash_chain store 확인
3. 콘솔에서 직접 확인:
   const chain = await window.gopangWallet.getHashChain();
   console.log(chain[chain.length - 1]);  // 최신 레코드

4. Hash Chain 검증:
   const result = await window.gopangWallet.verifyChain();
   console.log(result);  // { valid: true, broken_at: null }
```

### 체크리스트
- [ ] `hash_chain` store에 신규 레코드 존재
- [ ] 레코드 필드 확인:
  - [ ] `height` 값 있음 (0부터 시작)
  - [ ] `local_hash` 값 있음 (64자 hex)
  - [ ] `prev_local_hash` 값 있음
  - [ ] `prev_settle_hash` 값 있음
  - [ ] `new_settle_hash` 값 있음
  - [ ] `block_hash` 값 있음 (L1 block_hash와 일치)
  - [ ] `recorded_at` 값 있음
- [ ] `verifyChain()` → `{ valid: true, broken_at: null }`
- [ ] Hash Chain 수학적 검증:
  ```javascript
  // 콘솔에서 직접 계산
  const last = chain[chain.length - 1];
  const prev = chain[chain.length - 2];
  const input = prev.local_hash + last.tx_hash + last.block_hash + String(last.height);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const computed = Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  console.log(computed === last.local_hash);  // true여야 함
  ```
- [ ] 위 계산 결과 `true`

### 기대 결과
Hash Chain이 수학적으로 정확히 구성됨

---

## 테스트 07 — 재무제표 갱신 확인

**목적** 구매자 잔액 감소, 판매자 잔액 증가, settled_by 감사 추적 확인

### 실행 절차
```sql
-- 1) gdc_settle_ledger RPC 호출 (구매자)
SELECT * FROM gdc_settle_ledger('구매자_primary_guid');

-- 2) gdc_settle_ledger RPC 호출 (판매자)
SELECT * FROM gdc_settle_ledger('pguid-BOYOUNG');

-- 3) user_profiles에서 갱신 확인
SELECT primary_guid, extra->'fs' AS fs, extra->'fs'->'settled_by' AS settled_by
FROM user_profiles
WHERE primary_guid IN ('구매자_guid', 'pguid-BOYOUNG');
```

```javascript
// 콘솔에서 클라이언트 측 잔액 확인
const balance = await window.gopangWallet.getBalance();
console.log('bs-cash:', balance);

const fs = await window.gopangWallet.getFinancialState();
console.log('재무제표:', fs);
```

### 체크리스트
- [ ] 구매자 `bs-cash` 감소 (거래 전 - ₮37,000 = 거래 후)
- [ ] 판매자 `bs-cash` 증가 (수수료 3% 제외한 순수입)
- [ ] `user_profiles.extra.fs.settled_by = 'gdc_settle_ledger'`
- [ ] `user_profiles.extra.fs.settle_at` 값 있음
- [ ] IndexedDB `bs-cash` = 서버 `bs-cash` (서버·클라이언트 일치)
- [ ] `pl-purchase` 누적 증가 (구매자)
- [ ] `pl-revenue` 누적 증가 (판매자)

### 기대 결과
서버와 클라이언트 모두 동일한 잔액

---

## 테스트 08 — 판매자 오프라인 청구권 처리

**목적** 판매자 기기 오프라인 시 청구권이 gdc_claims에 보관되고, 접속 시 자기갱신 동작 확인

### 실행 절차
```sql
-- 1) gdc_claims 청구권 존재 확인
SELECT claim_id, claimant, direction, amount, fs_account,
       block_hash, expires_at, redeemed
FROM gdc_claims
WHERE claimant = 'pguid-BOYOUNG'
ORDER BY issued_at DESC
LIMIT 5;
```

```javascript
// 2) 판매자 기기에서 미수신 청구권 처리 시뮬레이션
// (판매자 hondi.net 접속 후 콘솔에서)
const claims = await fetch('https://ebbecjfrwaswbdybbgiu.supabase.co/rest/v1/gdc_claims'
  + '?claimant=eq.pguid-BOYOUNG&redeemed=eq.false', {
  headers: { apikey: SUPABASE_KEY }
}).then(r => r.json());

await window.gopangWallet.redeemClaim({
  block_hash: claims[0].block_hash,
  block_id:   claims[0].block_id,
  claims:     claims,
});
console.log('청구권 처리 완료');
```

```sql
-- 3) 처리 후 redeemed 확인
SELECT redeemed, redeemed_at FROM gdc_claims
WHERE claimant = 'pguid-BOYOUNG'
ORDER BY issued_at DESC LIMIT 3;
```

### 체크리스트
- [ ] `gdc_claims`에 `pguid-BOYOUNG` 청구권 존재
- [ ] `expires_at` = 발행 시각 + 72시간
- [ ] `redeemed = false` (처리 전)
- [ ] `redeemClaim()` 호출 후 판매자 IndexedDB `bs-cash` 증가
- [ ] `gdc_claims.redeemed = true` (처리 후)
- [ ] `redeemed_at` NOT NULL

### 기대 결과
판매자 기기 상태와 무관하게 청구권이 보존되고 나중에 처리됨

---

## 테스트 09 — GWP_DONE 중복 PDV 방지

**목적** market이 PDV를 기록한 세션에서 gopang이 중복으로 기록하지 않는지 확인

### 실행 절차
```
1. 테스트 03~04 완료 후
2. hondi.net 탭 콘솔에서 확인:
   GWP_DONE 수신 로그 확인
   → [GWP_DONE] PDV 중복 방지 — reporter_svc: kmarket | session_id: ...
   → _recordPDV() 호출 없음 확인 (로그 없음)
```

```sql
-- 해당 session_id로 pdv_log 중복 확인
SELECT COUNT(*), session_id, reporter_svc
FROM pdv_log
WHERE session_id = '테스트에서_사용된_session_id'
GROUP BY session_id, reporter_svc;
```

### 체크리스트
- [ ] 고팡 탭 콘솔: `[GWP_DONE] PDV 중복 방지 — reporter_svc: kmarket`
- [ ] 고팡 탭 콘솔: `[PDV] 기록 완료` 로그 **없음** (중복 방지)
- [ ] `pdv_log`에서 동일 `session_id`로 **1건만** 존재
- [ ] 해당 1건의 `reporter_svc = 'kmarket'`
- [ ] `via_worker = true`

### 기대 결과
PDV 1건, 중복 없음

---

## 테스트 10 — 원칙 P1~P6 최종 체크리스트

**목적** 6개 설계 원칙이 모두 준수되는지 확인

### 실행 절차
```sql
-- 감사 쿼리 일괄 실행

-- 1) P2: 모든 PDV via_worker 확인
SELECT COUNT(*) AS total,
       SUM(CASE WHEN via_worker = true THEN 1 ELSE 0 END) AS via_worker_true
FROM pdv_log
WHERE source IN ('market', 'gdc')
   OR reporter_svc IN ('kmarket', 'kgdc');
-- 기대: total = via_worker_true

-- 2) P4: 앵커링 주체 확인 (Worker가 단독)
SELECT DISTINCT anchored_by FROM pdv_log WHERE openhash_anchored = true;
-- 기대: 'gopang-proxy' 또는 Worker 식별자만

-- 3) P5: 중복 PDV 확인
SELECT session_id, COUNT(*) AS cnt
FROM pdv_log
WHERE session_id IS NOT NULL
GROUP BY session_id
HAVING COUNT(*) > 1;
-- 기대: 0건

-- 4) 미앵커링 확인
SELECT COUNT(*) FROM pdv_log
WHERE openhash_anchored = false AND via_worker = true;
-- 목표: 0건

-- 5) 직접 INSERT 확인 (Worker 미경유)
SELECT COUNT(*) FROM pdv_log
WHERE via_worker = false
  AND source IN ('market', 'gdc');
-- 목표: 0건
```

### 체크리스트

| 원칙 | 확인 항목 | 결과 |
|------|----------|------|
| P1 | market↔L1: Worker 경유 확인 (직접 교신 없음) | [ ] |
| P1 | gdc↔L1: Worker 경유 확인 | [ ] |
| P2 | `via_worker = true` 전 건 | [ ] |
| P3 | `pdv_log` 행에 who/when/where/what/how/why 모두 있음 | [ ] |
| P4 | 앵커링 주체 = gopang-proxy 단독 | [ ] |
| P5 | 동일 session_id로 pdv_log 1건 | [ ] |
| P6 | IndexedDB `bs-cash` 갱신 확인 (구매자) | [ ] |
| P6 | `gdc_claims.redeemed = true` 확인 (판매자) | [ ] |

### Hash Chain 연속성 최종 확인
```javascript
// 콘솔에서 실행
const result = await window.gopangWallet.verifyChain();
console.log('Hash Chain 검증:', result);
// 기대: { valid: true, broken_at: null }

const chain = await window.gopangWallet.getHashChain();
console.log('Chain 길이:', chain.length, '| 최신 height:', chain[chain.length-1]?.height);
```
- [ ] `verifyChain()` → `{ valid: true, broken_at: null }`

---

## 테스트 완료 기준

아래 모두 충족 시 STEP 27 통과:

| 항목 | 기준 |
|------|------|
| 테스트 01~10 | 전체 체크리스트 ✅ |
| 미앵커링 PDV | 0건 |
| 중복 PDV (session_id) | 0건 |
| Hash Chain | `valid: true` |
| 직접 INSERT (via_worker=false) | 0건 |

---

## Phase 2 이전 조건 (참고)

STEP 27 통과 후 추가로 아래 충족 시 Phase 2 시작:

- 제주도 내 실제 L1 노드 5개 이상 안정 운영
- 48시간 동안 미앵커링 PDV 0건 유지
- gopang-wallet.js Hash Chain 무결성 검증 완료
- Phase 2 우선 목표: Worker A1~A4 제거, Supabase L1 역할 종료, 완전 자기갱신

---

*작성: AI City Inc. 팀 주피터 | 2026-06*  
*기반: gopang_impl_steps_v2.md STEP 27 + 설계 원칙 P1~P6*
