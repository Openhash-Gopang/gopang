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
