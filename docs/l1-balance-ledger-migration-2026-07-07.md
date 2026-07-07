# GDC 잔액/원장 아키텍처 — Supabase → L1 PocketBase 이관 (2026-07-07)

## 배경

지금까지 GDC 잔액의 "진실"은 사실상 두 곳에 나뉘어 있었다:

1. **L1 PocketBase(`blocks` 컬렉션)** — 블록 체인 연속성(`prev_settle_hash`)과
   이중지불 방지만 검증. 정작 4단계(잔액 확인)는 클라이언트가 자체 신고한
   `balance_claimed`를 그대로 믿었다 — 진짜 UTXO 재구성이 아니었다.
2. **Supabase(`user_profiles.extra.public.finance.fs`)** — `market_purchase`
   RPC가 갱신하는 실질적 잔액 캐시. 이 RPC의 SQL 정의는 **리포 어디에도
   버전관리되지 않았다**(Supabase 콘솔에만 존재) — `sql/` 디렉터리를 다
   뒤져도 없다.

오픈해시는 분산원장(블록체인류) 철학의 구현체인데, 잔액의 진실이 별도
중앙 SQL DB(Supabase)에 있는 건 그 철학과 어긋난다. 이번 변경으로
Supabase 의존을 걷어내고, L1 자체가 유일한 진실이 되도록 재설계했다.

## 새 설계

**잔액 캐시 테이블을 두지 않는다.** 대신 `main.pb.js`의 `/api/tx` 핸들러
안에서, 요청마다 `blocks` 컬렉션 전체를 재생(replay)해서 그 자리에서
잔액을 계산한다(`computeBalance(guid)`, 콜백 내부 선언 — 아래 "PocketBase
Goja 제약" 참고).

```
balance(guid) = Σ(내가 outputs의 recipient_guid로 등장하는 모든 블록의 amount)
              − Σ(내가 buyer_guid인 모든 블록의 outputs 합계)
```

`balance_claimed`(클라이언트 자체 신고값)는 더 이상 신뢰하지 않는다 —
로그 비교용으로만 남기고, 실제 판단은 전부 `computeBalance()` 결과로 한다.

### `/api/mint` (개발 전용)

Supabase `sql/gdc_deposit.sql`(초기 GDC 발행)의 L1 대응물.
`block_type: "deposit"`, `buyer_guid: "gdc-mint"`(sentinel — 실제 유저 guid와
절대 겹치지 않음, 지불자 없는 블록임을 표시)로 블록을 만든다.
`computeBalance()`는 block_type을 가리지 않고 outputs만 보므로 별도 로직
추가 없이 자동으로 반영된다.

```bash
curl -X POST http://127.0.0.1:8091/api/mint \
  -H "Content-Type: application/json" \
  -d '{"guid":"<받을 사람 guid>","amount":100000,"secret":"hondi-dev-mint-2026","memo":"..."}'
```

⚠️ **`MINT_SECRET`은 실서비스 전환 전 반드시 제거하거나 진짜 관리자 인증
으로 교체해야 한다.** 지금은 사용자가 없는 개발 단계라 공유 비밀 문자열
하나로만 막혀 있다.

### PocketBase Goja 엔진 제약 (다시 한번 확인됨)

콜백(`routerAdd(...)`) 바깥의 최상위 함수/상수 선언이 실행 시점에
`ReferenceError: X is not defined`로 실패하는 걸 이번에 `computeBalance`와
`MINT_SECRET` 둘 다에서 직접 재현했다(기존 `sha256hex`가 콜백 내부에
있던 이유와 동일 — 문서 P13 `NODE_ID` 스코프 오류 이력과도 같은 계열).
**앞으로 main.pb.js에 뭘 추가하든, 함수든 상수든 반드시 각 `routerAdd`
콜백 안에 선언할 것.**

## Worker(worker.js) 쪽 변경

`handleBizOrder`에서 다음을 완전히 제거했다:
- `_fetchUserBalance`/`_bivmVerify` (Supabase 기반 사전검증 — 함수 정의까지 삭제)
- `market_purchase` RPC 호출
- `_patchFs`(buyer/seller `extra.fs` 메타데이터 병합)

대신 L1의 `/api/tx` 응답에 담긴 `buyer_claim`/`seller_claim`/`balance_after`를
그대로 클라이언트에 전달한다. `buyer_claim.fs_account`도 `"bs-cash"`에서
`"pl-purchase"`로 고쳤다 — `gopang-wallet.js`의 `redeemClaim()`이
`pl-purchase`일 때만 누적 지출(`pl-purchase`)과 실잔액(`bs-cash`) 둘 다
갱신하기 때문이다(이전엔 Worker가 L1의 claim을 무시하고 자체 생성했었어서
이 불일치가 가려져 있었다).

## 알려진 한계 (다음에 다룰 것)

- **재대사(reconcile) 없음**: 클라이언트 로컬 IndexedDB(`financial_state`)와
  L1의 실제 원장이 어긋나면(새 기기, 스토리지 초기화 등) 복구 경로가 없다.
  `prev_settle_hash`도 로컬 값을 그대로 쓰므로, 로컬이 틀리면 다음 거래가
  `STALE_STATE`로 막힌다.
- **성능**: `computeBalance()`는 매 요청마다 해당 노드의 `blocks` 전체를
  훑는다. 지금 규모(개발 단계)에서는 무리 없지만, 블록 수가 커지면
  스냅샷+증분 방식이 필요할 수 있다.
- **`/api/mint`는 개발 전용**이며 실서비스 전환 전 반드시 잠가야 한다.
