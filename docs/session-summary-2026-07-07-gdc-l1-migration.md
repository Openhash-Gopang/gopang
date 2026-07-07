# 2026-07-07 세션 요약 — GDC 결제 파이프라인 감사 및 Supabase→L1 이관

## 출발점

"상품이 판매되면 구매자·판매자 모두 재무제표를 갱신해야 한다(결제 통화
GDC)"는 요청에서 시작해, 현재 구현된 메커니즘을 조사하다가 아래 순서로
범위가 커졌다:

1. `/biz/order`(구매 확정)를 실제로 트리거하는 클라이언트 코드가 어디에도
   없다는 걸 발견 (수신·중계 코드만 있었음)
2. 가격·수수료 분할이 서버에서 전혀 검증되지 않는다는 걸 발견
3. "오픈해시는 분산원장" 원칙을 다시 상기하면서, L1 PocketBase의 잔액
   검증 자체가 클라이언트 자체 신고값(`balance_claimed`)을 그대로
   믿고 있었다는 근본 문제를 발견
4. Supabase(`user_profiles.extra.fs`, `market_purchase` RPC)를 완전히
   걷어내고 L1을 유일한 진실로 재설계

## 완료된 작업 (순서대로)

| # | 내용 | 파일 |
|---|---|---|
| 0 | `profile.html`에 실제 구매 트리거(`GWP_SIGN_REQUEST` 송신) 신설 — 카탈로그(`/biz/catalog`) 기반 장바구니·결제 UI | `profile.html` |
| 1 | `/biz/order` 서버 측 카탈로그 가격 + 수수료 분할(`PLATFORM_FEE_RATE=0.03`) 검증 신설 | `worker.js` |
| 2 | `handleBizOrder`의 백그라운드 작업(fs 메타데이터, 해시체인 앵커링)에 `ctx.waitUntil` 적용 | `worker.js` |
| — | **L1 잔액 검증을 `balance_claimed` 신뢰에서 `blocks` 원장 재생(`computeBalance`)으로 전환** | `main.pb.js` |
| — | 초기 GDC 발행 엔드포인트(`/api/mint`, 개발 전용) 신설 | `main.pb.js` |
| — | Worker의 Supabase 의존 코드(`_fetchUserBalance`, `_bivmVerify`, `market_purchase` RPC, `_patchFs`) 전면 제거 — L1의 `buyer_claim`/`seller_claim`/`balance_after`를 그대로 신뢰 | `worker.js` |
| — | `buyer_claim.fs_account`를 `"bs-cash"` → `"pl-purchase"`로 수정 (지갑의 `redeemClaim()` 이중 갱신 로직과 맞춤) | `main.pb.js` |
| 3 | 죽은 코드 정리(`ledger.js`, `payment.js` — 실사용 코드와 다른 RPC 시그니처를 가진 미사용 초안), `market_purchase` RPC 폐기 주석, 이관 설계 문서화 | `src/profile2.0/`, `docs/` |
| 5 | 재대사(reconcile) — `GET /biz/balance`(Worker) → `GET /api/balance`(L1) → `wallet.hydrateFromServer()`, 백업키 복구 흐름에 배선 | `worker.js`, `main.pb.js`, `gopang-wallet.js`, `auth.js` |

4번(경쟁상태)은 별도 작업 없이 자연 해소됐다 — L1이 매 요청마다 원장을
재생하고 캐시에 write-back하지 않으므로, 예전 `_patchFs`류의
read-modify-write 경쟁상태 자체가 존재하지 않는다.

## E2E 검증 완료

실제 서버(L1 `l1-hanlim`, Worker `hondi-proxy`)에서 끝까지 확인:
- `balance_claimed:0`(거짓 신고)에도 `INSUFFICIENT_BALANCE` 없이 정상 처리 → 클라이언트 자체 신고값이 실제로 무시됨을 증명
- Worker 경유(`/biz/order`) E2E 성공, `balance_after` 정확히 일치(65,000 → 60,300)
- `GET /biz/balance`(Worker) ↔ `GET /api/balance`(L1) 응답 일치 확인

## 과정에서 만난 실수 (기록용)

- `main.pb.js` 최상위(콜백 바깥)에 `computeBalance`/`MINT_SECRET`을 선언했다가
  `ReferenceError: X is not defined`로 실패 — 이 PocketBase Goja 엔진은
  콜백 바깥 최상위 함수/상수 선언을 실행 시점에 못 찾는다(기존 `sha256hex`가
  콜백 내부에 있던 것과 같은 이유, 문서 P13 `NODE_ID` 스코프 이력과도 동일
  계열). **앞으로 main.pb.js를 고칠 땐 항상 각 `routerAdd` 콜백 안에
  선언할 것.**
- `blocks.buyer_guid`가 스키마상 `required:true`인데 발행(mint) 블록에
  빈 문자열을 넣어서 저장 실패 — sentinel 값(`"gdc-mint"`)으로 해결.

## 알려진 한계 (다음에 다룰 만한 것)

- `/api/mint`는 개발 전용 — 실서비스 전환 전 `MINT_SECRET` 공유비밀 방식을
  반드시 잠그거나 진짜 관리자 인증으로 교체해야 한다.
- `computeBalance()`는 매 요청마다 해당 노드의 `blocks` 전체를 훑는다 —
  지금 규모에선 무리 없지만 커지면 스냅샷+증분 최적화가 필요할 수 있다.
- 판매자 서명(`item_sig`) 미검증 — `/biz/order`가 구매자 서명만 요구하고
  판매자 동의를 암호학적으로 검증하지 않는 문제는 이번 세션에서 다루지
  않았다(이전 조사에서 발견, 여전히 미해결).
- `entity_type` 영문 리터럴이 PA SP에 명시된 적 없음(이전 조사에서 발견,
  실사용 로그 확인 필요, 여전히 미해결).

## 상세 설계 문서

`docs/l1-balance-ledger-migration-2026-07-07.md` — L1 잔액/원장 아키텍처
전체 설계, `/api/mint` 사용법, PocketBase Goja 제약 재확인 내용.

---

## 추가 세션 — 가입 시점 초기화 + 재무제표 갱신/일치검증 (같은 날 이어서)

"가입 시점 GDC wallet·재무제표 초기화, 매 거래 양측 재무제표 갱신, 매
거래 재무제표 변동 일치 검증"을 점검해 달라는 요청으로 이어졌다.

### 점검 결과 — 세 가지 다 실제로 비어 있거나 결함이 있었음

1. **가입 시점 초기화가 사실상 안 되고 있었음**: 지갑(Ed25519 키페어)은
   로컬에서 자동 생성됐지만, **그 공개키를 L1의 `gdc_keys`에 등록하는
   코드가 리포 전체에 단 한 줄도 없었다** — 신규 가입자의 첫 실거래가
   무조건 `UNREGISTERED_KEY(403)`로 막히는 상태였음. 재무제표도 "생성
   이벤트" 없이 그냥 비어있다가 암묵적으로 0 취급되는 식이었고, 지갑
   자동 초기화 코드가 **이미 폐기한 Supabase 테이블을 하드코딩된 anon
   key로 직접 조회**하고 있었다(지난 이관 작업 때 놓친 부분).
2. **거래마다 갱신 — 구매자 로직에 실제 이중 계상 버그**: `redeemClaim()`이
   `claim.claimant`를 확인하지 않고 배열의 모든 claim을 적용해서, 구매자의
   로컬 재무제표에 판매자 몫(seller_claim)까지 잘못 반영되고 있었다.
   판매자 쪽 기기는 거래에 참여하지 않으므로 애초에 갱신될 방법이 없었음.
3. **일치 검증 — 있지만 감시만 하고 기록을 안 남김, 그리고 판매자 쪽
   검증이 아예 없음**: `verifyOutputConsistency`가 구매자쪽(buyer_claim.amount
   vs outputs 합계)만 봤고, 결과가 로그에만 찍히고 사라졌다.

### 보완 내용

| 항목 | 파일 |
|---|---|
| `POST /gwp/register-key` 신설 — TOFU 서명 기반 L1 `gdc_keys` 등록(기존 키와 다른 값으로 덮어쓰기는 거부, 기기교체는 백업키 복구로 유도) | `worker.js` |
| `_registerToL1()` 직후 `_initGdcWalletAndFs()` 실행 — 키 등록 + 재무제표 명시적 0 초기화(IASB 매핑: bs-cash=자산, pl-purchase=비용, pl-revenue=수익, 부채 없어 자본=자산) + PDV `fs_genesis` 감사 기록 | `src/gopang/core/auth.js` |
| `redeemClaim()`에 `claim.claimant === this.guid` 필터 추가 — 이중 계상 버그 수정 | `gopang-wallet.js` |
| 지갑 자동초기화의 죽은 Supabase 동기화를 `hydrateFromServer()`로 교체 | `gopang-wallet.js` |
| `verifyOutputConsistency` — 판매자 쪽(seller_claim.amount vs 의도한 seller_net) 검증 추가, 결과를 PDV(`extra.consistency_check`)와 API 응답에 영속화 | `worker.js` |
| `verifyDeltaZero`의 `balance_claimed` 기반 오검증 제거 | `worker.js` |

### 실제 E2E로 잡은 버그들 (기록용)

1. 배포 직후 `consistency_check.delta_zero_valid`가 정상 거래인데도
   `false`로 뜸 — `verifyDeltaZero`가 여전히 신뢰 안 하기로 한
   `balance_claimed`를 기준으로 판정하고 있었다. 즉시 제거.
2. **재무제표 변동 일치검증까지 마친 뒤 다시 돌린 사고실험에서 발견**:
   가입 시점에 fs를 `{bs-cash:0,...}`로 명시 초기화하게 만든 결과,
   지갑 자동초기화 IIFE의 "fs가 비어있으면 hydrateFromServer() 호출"
   조건이 **가입 이후 평생 다시는 참이 되지 않는** 자기모순 상태가
   됐다 — 판매자처럼 거래에 실시간으로 참여하지 않는 기기가 로컬 상태를
   갱신할 사실상 유일한 경로였는데, 그게 막혀 있었다. "fs 비어있으면"
   조건을 없애고 **guid가 있으면 매 앱 실행마다 무조건 재대사**하도록
   수정.

### E2E 검증 완료 (신규 guid 전 과정)

1. 신규 Ed25519 키페어 생성(openssl) → `/gwp/register-key`로 TOFU 등록 성공
2. `/biz/balance` — 등록 직후 잔액 0 확인
3. `/api/mint`로 50,000 발행 → 잔액 50,000 확인
4. `/biz/order`(Worker 경유) 1차 구매(10,000) → `balance_after: 40,000` 확인
5. `/biz/order` 2차 구매(5,000, `prev_settle_hash` 체인 정상 연결) →
   `consistency_check: {output_consistent:true, delta_zero_valid:true, sigma_delta:0}`,
   `buyer_claim.balance_after:35,000`, `seller_claim.balance_after:14,550`
   (1차+2차 누적과 정확히 일치) 확인

### 알려진 한계 (다음에 다룰 만한 것, 새로 추가)

- **손익계산서(수익/비용) 재대사 불가**: `/api/balance`(→`computeBalance`)는
  순수 잔액(자산)만 반환하고 수익/비용을 분리 추적하지 않는다.
  `hydrateFromServer()`도 `bs-cash`만 덮어쓰고 `pl-purchase`/`pl-revenue`는
  로컬 값을 그대로 둔다 — 로컬 이력이 어떤 이유로든 틀어지면(과거
  이중계상 버그의 잔재 등) 그 계정들은 서버로 복구할 방법이 없다.
  L1 쪽에 수취/지불을 분리 집계하는 기능을 추가해야 완전히 해소된다.
- **개인키 완전 분실 시 복구 경로 없음**: `/gwp/register-key`가 기존
  키와 다른 값이면 무조건 거부(탈취 방지로 의도된 동작)라서, 백업 키를
  안 만들어둔 사용자가 기기를 잃으면 그 guid는 영구히 거래 불가능해진다.

