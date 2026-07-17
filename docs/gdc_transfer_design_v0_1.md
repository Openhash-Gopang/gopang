# GDC P2P 이체 기능 — 설계 문서 v0.1 (초안)

작성일: 2026-07-18 | 대상: 혼디 앱 프로필 페이지 → 임의 상대에게 GDC 즉시 이체
전제: 혼디 숫자 코드 스캔 → 프로필 연결까지는 이미 동작(확인됨). 계좌번호 복사
방식 송금도 이미 동작(확인됨). 이 문서는 그 옆에 추가할 **"GDC 보내기"** 버튼과
그 뒤에서 실제로 잔액을 이동시키는 백엔드를 다룬다.

---

## 0. 기존 코드 재조사 결과 — 생각보다 인프라가 많이 있다

설계에 들어가기 전에 코드를 다시 훑어보니, 원래 예상했던 것보다 재사용 가능한
부분이 많았다. 이 발견이 설계 전체의 방향을 바꾼다.

**발견 1 — `worker.js`의 `handleBizOrder`(`/biz/order`)가 이미 P2P 케이스를
전제하고 있다.**
```js
// items가 비어 있으면(= P2P 송금 등 카탈로그와 무관한 거래) 이 검증은
// 건너뛴다 — 애초에 대조할 카탈로그가 없는 케이스이기 때문이다.
```
카탈로그 가격 검증도, 3% 플랫폼 수수료 강제 검증(`FEE_SPLIT_MISMATCH`)도 전부
`if (txItems.length)` 블록 안에 있다. 즉 **`items: []`로 호출하면 클라이언트가
보낸 `fee`/`seller_net`를 그대로 신뢰하고 통과시킨다** — 다시 말해 지금 코드
상태로도 `items: [], fee: 0, seller_net: 이체액`으로 `/biz/order`를 호출하면
수수료 없는 P2P 이체가 "이미" 가능하다. 다만 이건 우연히 뚫려있는 우회 경로에
가깝고, 의미상 "주문"과 "송금"을 같은 엔드포인트로 섞는 건 유지보수 리스크가
크다 → §2에서 별도 엔드포인트 신설을 제안하는 이유.

**발견 2 — L1의 `/api/tx`는 이미 범용 UTXO 원장이다.**
`buildTxWithPrevHash()`가 만드는 tx 구조(`input: {owner_guid, prev_settle_hash,
balance_claimed}`, `outputs: [{recipient_guid, amount}, ...]`)는 BIZ_ORDER
전용이 아니라 L1이 받는 범용 형식이다. L1은 `balance_claimed`를 신뢰하지 않고
**자기 블록 원장을 재생(computeBalance)해서 직접 잔액을 검증**한다
(`STALE_STATE`/`INSUFFICIENT_BALANCE`/`INVALID_SIGNATURE`/`UNREGISTERED_KEY`
네 가지 실패 사유가 이미 정의돼 있음). BIVM(Σδ=0) 검증도 L1 쪽에서 output 합이
input 잔액을 넘지 않는지 보는 방식으로 이미 동작 중이라고 추정된다(L1 실제
구현은 별도 저장소라 이 저장소에서 직접 확인은 못 했다 — §7 참조).

**발견 3 — 크로스-L1 브릿지도 이미 있다.**
`_resolveHomeL1Node()` + `isCrossL1` 분기 + `bridge-in`/`bridge-out` 릴레이가
BIZ_ORDER에 이미 구현돼 있다. 수신자가 다른 L1 소속이어도 이 로직을 그대로
가져다 쓸 수 있다.

**발견 4 — `gopang-wallet.js`에 `GDC_TRANSFER`라는 TX 타입 상수가 이미
정의돼 있다.** (지난 대화에서 확인한 대로) 실제로 쓰이는 곳은 없지만, 처음
설계할 때부터 이 기능을 염두에 뒀다는 뜻이다 — 이름을 그대로 살려서 쓴다.

**결론**: 완전히 새로 만들어야 하는 건 (a) 별도 엔드포인트 하나, (b) 클라이언트
wallet 함수 하나, (c) profile.html의 버튼/모달 UI, (d) 수신자 쪽 PDV·잔액 반영
경로 정도다. 원장·서명·잔액검증·브릿지는 재사용.

---

## 1. 전체 흐름

```
[스캐너] 혼디 코드 스캔 → lookupDigitProfile() → 상대 GUID/닉네임 확보
   ↓
[profile.html] "송금 계좌" 카드 옆 "💰 GDC 보내기" 버튼
   ↓
[모달] 상대 닉네임/handle 표시(확인용) + 금액 입력 + 잔액 표시
   ↓ (확인 클릭)
[gopang-wallet.js] sendGdc({toGuid, amount, memo}) 호출
   - 로컬 IndexedDB 재무상태(fs['bs-cash'])로 잔액 사전 확인(UX용, 최종 검증 아님)
   - prev_settle_hash 계산 → buildTxWithPrevHash() 재사용(outputs 1개, fee 없음)
   - WebAuthn PRF 또는 저장된 개인키로 서명
   ↓
[POST /wallet/gdc-transfer] (신규 엔드포인트, worker.js)
   - 필수 필드 검증(from_guid, to_guid, amount, 서명 등 — BIZ_ORDER와 동일 패턴)
   - from_guid === to_guid 거부(자기 자신 송금 방지)
   - amount 범위 검증(최소/최대 — §4)
   - 수신자 home L1 조회 → cross-L1이면 bridge 플래그 세팅(BIZ_ORDER 패턴 재사용)
   - L1 /api/tx로 위임(outputs: [{recipient_guid: to_guid, amount}], fee 없음)
   ↓
[L1] 서명 검증 → 원장 재생 잔액 검증(BIVM) → 블록 기록 → block_hash 반환
   ↓
[worker.js] 응답을 그대로 클라이언트에 반환(block_id, block_hash, height,
   sender_claim, receiver_claim)
   ↓
[gopang-wallet.js] redeemClaim()으로 로컬 재무상태 갱신(송신자 측, 기존 함수
   그대로 재사용 — claim.direction='debit')
   ↓
[PDV] 송신자 측 6하원칙 기록(_recordPDV) — "who: 나, what: OO에게 ₮N 이체"
   ↓
[수신자] 다음 로그인/프로필 진입 시 reconcile()이 서버 원장과 로컬을 맞추며
   잔액 반영(기존 "재대사" 함수 재사용) — 실시간 알림은 Phase 2(§6)
```

---

## 2. 신규 엔드포인트 — `/wallet/gdc-transfer`

`/biz/order`를 재사용하지 않고 **별도 엔드포인트를 신설**하는 걸 제안한다.
이유: "주문"과 "송금"은 의미가 다르고, 나중에 `/biz/order`가 카탈로그 구매
전용으로 정리되면서 `items: []` 우회가 막히거나 의미가 바뀌면 P2P 송금이
예고 없이 깨질 수 있다. 별도 엔드포인트면 그런 리스크가 없다.

```
POST /wallet/gdc-transfer
Body: {
  tx, tx_hash, sender_sig, sender_public_key,
  from_guid, to_guid, amount,
  memo,               // 선택 — 이체 메모(예: "점심값")
  prev_settle_hash, balance_claimed,
  l1_node,            // 송신자 소속 L1(기존 buyerNodeId 자리)
}
```

**검증 순서** (BIZ_ORDER 패턴 그대로 재사용, 카탈로그/수수료 검증만 제거):
1. 필수 필드 확인 (`tx_hash`, `sender_sig`, `sender_public_key`, `from_guid`,
   `to_guid`, `amount`)
2. `from_guid === to_guid` → 400 `SELF_TRANSFER_NOT_ALLOWED`
3. `amount` 범위 확인 → 400 `AMOUNT_OUT_OF_RANGE` (§4)
4. 수신자 home L1 조회(`_resolveHomeL1Node`) → cross-L1이면 `bridgeBody` 세팅
5. L1 `/api/tx`로 위임 — `outputs: [{recipient_guid: to_guid, amount}]`
   (수수료 output 없음 — BIZ_ORDER와 다른 부분)
6. L1 에러를 기존 `statusMap`(STALE_STATE/INSUFFICIENT_BALANCE/
   INVALID_SIGNATURE/UNREGISTERED_KEY)으로 그대로 매핑
7. 성공 시 `{ ok: true, block_id, block_hash, height, sender_claim,
   receiver_claim }` 반환

BIZ_ORDER 핸들러 함수 본체를 복붙하지 말고, 카탈로그 검증·수수료 분할 부분만
제외한 공통 서브함수(`_l1SubmitTx(env, {..})`)로 뽑아내서 `handleBizOrder`와
`handleGdcTransfer`가 같이 쓰는 구조를 권장한다 — 지금처럼 로직이 두 곳에
복붙되면 다음에 또 어긋난다(과거 fee split 버그가 이런 식으로 났었다).

---

## 3. 클라이언트 — `gopang-wallet.js`

```js
/**
 * P2P GDC 이체
 * @param {Object} opts
 *   opts.toGuid   — 수신자 GUID (스캔된 프로필에서 확보)
 *   opts.amount   — 이체 금액(₮)
 *   opts.memo     — 선택, 이체 메모
 */
async sendGdc({ toGuid, amount, memo = '' }) {
  if (!toGuid) throw new Error('[Wallet] 수신자 GUID 없음');
  if (toGuid === this.guid) throw new Error('[Wallet] 본인에게는 이체할 수 없습니다');
  if (!(amount > 0)) throw new Error('[Wallet] 이체 금액이 올바르지 않습니다');

  // 1) 로컬 잔액 사전 확인(UX용 — 최종 검증은 L1이 함)
  const fsRec = await idbGet(db, IDB_FS_KEY);
  const localBalance = parseFloat(fsRec?.state?.['bs-cash'] ?? '0') || 0;
  if (localBalance < amount) throw new Error('[Wallet] 잔액이 부족합니다(로컬 확인)');

  // 2) prev_settle_hash 계산 (기존 computePrevSettleHash 재사용)
  const prevSettleHash = await computePrevSettleHash(fsRec?.state);

  // 3) UTXO tx 빌드(fee output 없음 — buildTxWithPrevHash 변형)
  const { tx } = await buildTxWithPrevHash({
    buyerGuid: this.guid, sellerGuid: toGuid,
    total: amount, sellerNet: amount, platformFee: 0,
    financialState: fsRec?.state, items: [], prevSettleHash,
  });

  // 4) 서명 (기존 sign() 재사용, WebAuthn PRF 경로 포함)
  const tx_hash = await sha256(sortedStringify(tx));
  const sig = await this._signTx(tx_hash);   // 기존 서명 헬퍼 재사용

  // 5) 서버 호출
  const res = await fetch(`${CFG.endpoint}/wallet/gdc-transfer`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tx, tx_hash, sender_sig: sig, sender_public_key: this.pubKeyB64u,
      from_guid: this.guid, to_guid: toGuid, amount, memo,
      prev_settle_hash: prevSettleHash, balance_claimed: localBalance,
    }),
  });
  const result = await res.json();
  if (!result.ok) throw new Error(`[Wallet] 이체 실패: ${result.error} — ${result.detail || ''}`);

  // 6) redeemClaim 재사용 — 로컬 재무상태 갱신
  await this.redeemClaim({
    block_hash: result.block_hash, block_id: result.block_id,
    claims: [{ claimant: this.guid, fs_account: 'bs-cash',
               direction: 'debit', amount }],
    tx_hash: result.tx_hash || tx_hash,
  });

  return result;
}
```

`buildTxWithPrevHash`는 지금 `platformFee`를 항상 두 번째 output으로 넣는
구조라, `platformFee: 0`을 넘기면 `{recipient_guid: 'gopang-platform',
amount: 0}`이라는 금액 0짜리 output이 하나 더 붙는다. 이건 L1이 허용은
하겠지만 원장이 지저분해진다 — `buildTxWithPrevHash`에 `outputs`를 직접
지정할 수 있는 옵션을 추가하거나(`fee`가 0이면 두 번째 output을 아예
생략), 별도의 단일-output 빌더(`buildSingleOutputTx`)를 만드는 게 낫다.

---

## 4. 정책 오픈 이슈 — 기본값 제안

바로 구현에 들어갈 수 있도록 기본값을 제안하되, 실제 값은 피터가 확정해야
한다.

| 항목 | 제안 기본값 | 비고 |
|---|---|---|
| 플랫폼 수수료 | **0%** | P2P는 "거래"가 아니라 "이체"이므로 수수료 없음이 자연스럽다. 나중에 필요하면 추가하되, 지금은 0으로 시작 |
| 최소 이체액 | **1₮** | 0원/음수 이체 방지 |
| 최대 이체액(1건) | **미정 — 1차엔 한도 없음** | 큰 금액 사고 방지가 필요하면 예: 1회 100,000₮ 제한을 추가할 수 있음. 결정 필요 |
| 일일 누적 한도 | **미정 — 1차엔 미구현** | Sybil/자금세탁 리스크 관리 항목. 서버 DB 조회가 추가로 필요해서 Phase 2 후보 |
| 자기 자신에게 송금 | **차단** | `from_guid === to_guid` 거부 |
| 되돌리기 | **불가** | 온체인 특성상 원천적으로 불가 — UI에서 "되돌릴 수 없습니다" 경고 필수 |
| 상대 신원 확인 UX | **송금 확인 모달에 닉네임/handle 노출** | 스캔한 코드가 의도한 사람인 걸 눈으로 확인 후 최종 확정 — 잘못된 코드 스캔/피싱 방지 |
| 오프라인 상대 | **허용** — 원장(L1)에는 즉시 반영, 상대 로컬 지갑(IndexedDB)은 다음 접속 시 `reconcile()`로 동기화 | 실시간 알림 없음(Phase 2) |

---

## 5. PDV 기록

`_recordPDV()` 기존 구조(6하원칙) 그대로 사용. 송신 직후 클라이언트에서
바로 기록:

```js
await _recordPDV({
  type: 'gdc_transfer', serviceId: 'wallet',
  summary: `${toNickname || toGuid}에게 GDC ₮${amount} 이체`,
  who: _USER?.nickname, when: new Date().toISOString(),
  where: '혼디 프로필 페이지', what: `GDC ₮${amount} 송금`,
  how: 'gdc_transfer_p2p', why: memo || '',
  ts: new Date().toISOString(),
});
```

**수신자 측 PDV는 누가 기록하나?** 송신자가 대신 기록해줄 수 없다(PDV는
로컬 암호화 저장이라 상대 기기에 쓸 방법이 없음). 두 가지 선택지:
- (A) 수신자가 다음 로그인 시 `handleTxHistory`(`/biz/tx-history`, 이미
  존재)로 자기 앞으로 온 입금 내역을 조회해서 그때 로컬 PDV에 기록
- (B) 그림자 AI(AGENT-COMMON)가 로그인 직후 잔액 변동을 감지하면 자동으로
  "OO님으로부터 ₮N 입금됨" 안내 버블 + PDV 기록

(B)가 사용자 경험상 낫지만 그림자 AI 초기화 로직에 손을 대야 한다. 1차는
(A)로 가고, 2차에 (B)로 개선하는 걸 제안한다.

---

## 6. 단계별 구현 로드맵

**Phase 1 (MVP, 같은 L1 내 이체만)**
- `worker.js`: `/wallet/gdc-transfer` 엔드포인트, `_l1SubmitTx` 공통 서브함수 분리
- `gopang-wallet.js`: `sendGdc()`, `buildTxWithPrevHash`에 fee-optional 옵션 추가
- `profile.html`: "GDC 보내기" 버튼 + 확인 모달(상대 닉네임 노출 + 금액 입력 + 잔액 표시 + "되돌릴 수 없음" 경고)
- 수신자 PDV는 §5-(A) 방식(다음 로그인 시 tx-history 조회)

**Phase 2**
- Cross-L1 브릿지 연동 확인(BIZ_ORDER 패턴 재사용이지만 실제 테스트 필요)
- 일일 누적 한도 등 리스크 관리
- 수신자 실시간 알림(§5-(B))

**Phase 3**
- `pages/scenario-test.html`에 GDC 이체 검증 항목 추가(스캔→이체→잔액 반영
  전 구간 E2E) — 기존 A-섹션 패턴 참고

---

## 7. 확인이 필요한 부분(제가 이 저장소에서 직접 볼 수 없었던 것)

- **L1 `/api/tx`의 실제 구현**(PocketBase 훅, 별도 저장소로 추정 — 아마
  l1-hanlim 계열)에서 BIVM(Σδ=0) 검증과 `computeBalance` 재생 로직이 정확히
  어떻게 짜여 있는지 — 특히 output이 1개뿐인 tx(수수료 output 없음)를
  기존에 실제로 받아본 적이 있는지, 아니면 항상 2-output(seller+platform)을
  가정하고 있는지는 그 저장소를 봐야 확실합니다. 이 부분은 L1 저장소에
  접근 권한/경로를 알려주시면 같이 확인하겠습니다.

---

## 다음 단계

이 설계에 동의하시면, §4의 정책값(특히 최대 이체액 한도 여부)만 확정해
주시면 Phase 1부터 순서대로 fix.py 패치로 구현을 시작하겠습니다.
