# 혼디(Hondi) — 오픈해시 C1~C6 통합 설계 v3 + 갱신 실행계획

**이 문서는 v2를 대체합니다.** v2의 "결정 필요 항목"(7절) 중 사용자가 승인한 두 가지 —
① 세 병렬 구현체 통합, ② BIVM 통합 — 를 실제 설계로 확정하고, 실행 순서를 구체화합니다.

---

## 0. 통합 전 마지막 확인 — worker.js 내부에 실제 버그 발견

통합 작업을 시작하기 전에 반드시 알고 계셔야 할 사실입니다. worker.js가 이미 자체적으로
`verifyOutputConsistency`/`verifyDeltaZero`라는 **BIVM과 완전히 동일한 개념**(buyer_debit
= seller_credit + platform_fee, 즉 Σδ=0)을 인라인으로 구현해뒀는데, 허용오차가
`src/openhash/bivm.js`의 `EPSILON=1e-9`와 다르게 **`0.01`(1,000만 배 느슨함)** 로
박혀 있습니다. 또한 이 검증은 주석에 명시된 대로 **"감시 모드 — 불일치 시 로그만 기록,
거래 차단 안 함"** 상태입니다. 통합 시 이 지점을 반드시 함께 고쳐야 하며, 이번
문서에서 통합 대상에 포함시킵니다.

---

## 1. 통합 원칙

1. **계산 로직은 한 곳에만 존재한다.** 같은 검증을 여러 파일에서 각자 구현하지 않는다.
2. **worker.js의 "ES 모듈 import 불가"라는 배포 제약은 그대로 존중한다** — 이걸 우회하려고
   worker.js를 ES 모듈 구조로 통째로 바꾸는 건 이번 범위 밖의 훨씬 큰 리스크이므로 하지
   않는다. 대신 **"단일 정의 소스 + worker.js는 그 소스를 정확히 미러링한 인라인 사본을
   갖되, 두 값이 어긋나면 CI가 잡아낸다"**는 절충으로 통합한다(3절 참조).
3. **물리적 실행 환경이 다른 부분(브라우저 IndexedDB vs 서버 PocketBase)은 통합하지
   않는다** — `hashChain.js`(클라이언트)와 `fs_ledger.pb.js`(서버)는 저장소는 계속
   분리하되, **체인 포맷(`h_i = SHA-256(h_{i-1} ‖ data_i ‖ height_i)`)을 동일하게
   맞춰서, 하나의 검증기로 양쪽을 다 걸을 수 있게** 한다.
4. **계층(L1~L5) 정의는 물리 행정구역 기준(gopang-worker의 읍면동 단위)을 정본으로
   삼는다** — 이게 논문 §3.1.2 LCAT 정의(실제 물리적 계층 구조) 및 표1의 "대한민국
   실제 행정구역 계층(L1 7,000/L2 226/L3 17)" 수치와 정확히 일치하기 때문이다. A 계열
   (`computeLCAT`의 제주내부/국내/국제 3단계)은 **근사치였음을 인정하고 은퇴**시킨다.

---

## 2. 계층(Tier) 통합 설계

### 2.1 신규 단일 소스: `src/openhash/tiers.js`

```js
/**
 * @file tiers.js
 * @description 물리적 계층(L1~L5) 정의 — 단일 소스
 * @version 1.0.0
 *
 * 근거: OpenHash SCI 논문 §3.1.2(LCAT), 표1(대한민국 행정구역 기준)
 * 정본: gopang-worker의 l1-registry.js(읍면동 PocketBase 노드)를 물리 계층의
 *       실제 데이터로 삼는다. 기존 computeLCAT()의 3단계(A/B/C) 근사는 은퇴.
 */
import { resolveL1Node, listActiveL1Nodes } from '../../services/gopang-worker/src/lib/l1-registry.js'
// (실제 경로는 병합 시 확정 — 4절 참조)

/**
 * 두 guid의 실제 L1 노드(admin_region_keys: "시도|시군구|읍면동")를 비교해
 * 두 당사자가 공유하는 최소 공통 계층(LCAT)을 반환한다.
 * @returns {'L1'|'L2'|'L3'|'L4'|'L5'}
 */
export async function computeLCAT(env, guidA, guidB) {
  const [regionA, regionB] = await Promise.all([
    resolveL1RegionKey(env, guidA),
    resolveL1RegionKey(env, guidB),
  ])
  if (!regionA || !regionB) return 'L2' // 정보 없음 → 보수적 기본값(기존 로직 계승)

  const [doA, siA, dongA] = regionA.split('|')
  const [doB, siB, dongB] = regionB.split('|')

  if (doA === doB && siA === siB && dongA === dongB) return 'L1' // 같은 읍면동
  if (doA === doB && siA === siB)                    return 'L2' // 같은 시군구
  if (doA === doB)                                    return 'L3' // 같은 광역시도
  return 'L4' // 국내 타 광역 간 — 해외 거래는 별도 판정(추후 L5)
}
```

- `admin_region_keys`는 이미 `l1-registry.js`에 `"시도|시군구|읍면동"` 형식으로 존재하므로
  신규 데이터 작업 없이 바로 사용 가능.
- **`asymmetricMap`(표1)도 이 L1~L5 정의를 그대로 입력받도록 `plsm.js`를 수정** —
  `LCAT_MAP = { A:'L1', B:'L2', C:'L3' }` 상수는 삭제.

### 2.2 `PLSM_CONST.ASYMMETRIC`에 L4/L5 행 추가 (기존에 없던 간극 해소)

```js
// core/constants.js — 표1 L4/L5 행 추가
L4: {
  low:  { L1: 0, L2: 0, L3: 0, L4: 700, L5: 1000 },
  high: { L1: 0, L2: 0, L3: 0, L4: 400, L5: 1000 },
},
```
(논문 표1 그대로 이식 — 지금까지 L1~L3만 있어서 국가 단위 앵커링이 필요한 거래는
전부 폴백 분포로 빠지고 있었음)

### 2.3 worker.js 쪽 반영
`computeLCAT(buyerRegion, sellerRegion)`(지역 문자열 기반)를 **`computeLCAT(env, buyerGuid,
sellerGuid)`(guid 기반, L1 노드 조회)로 교체**. worker.js는 ES import가 안 되므로
`tiers.js`의 로직을 인라인 포팅하되, **주석에 "정본: tiers.js — 수정 시 반드시 함께
반영"이라고 명시**(worker.js가 이미 이 패턴을 쓰고 있으므로 팀 관례를 따름).

---

## 3. BIVM 통합 설계

### 3.1 `src/openhash/bivm.js`를 유일한 정본으로 확정, 두 함수 추가

```js
// bivm.js에 추가 (기존 verifySetInvariant/verifyBMI/verify/createTxPair는 그대로 유지)

/**
 * §4.2.2 BMI — 계층 내 전체 계정 잔액의 Merkle 루트 계산
 * (기존 verifyBMI는 "거래 1건의 산술"만 확인 — 이 함수가 논문이 말하는
 *  "계층 간 무단 재배분 위변조 탐지"의 실제 메커니즘)
 * @param {Array<{guid: string, balance: number}>} tierBalances - tier_k 소속 전체 계정
 * @returns {Promise<string>} Merkle 루트 해시(hex)
 */
export async function computeBmiRoot(tierBalances) {
  const leaves = await Promise.all(
    [...tierBalances].sort((a, b) => a.guid.localeCompare(b.guid))
      .map(async ({ guid, balance }) => sha256(`${guid}:${balance}`))
  )
  return merkleRoot(leaves) // 트리 구현은 기존 hashChain.js 배치 Merkle 로직 재사용
}

/**
 * 상위 계층이 보유한 이전 루트에 "합법적 거래만" 반영해 재계산한 값과
 * 하위 계층이 보고한 루트를 비교 — 불일치 시 무단 잔액 변경으로 판정
 */
export function verifyBmiRoot(reportedRoot, recomputedRoot) {
  return reportedRoot === recomputedRoot
}
```

- `merkleRoot()`/`sha256()`는 `hashChain.js`가 1시간 배치에서 이미 쓰는 Merkle 계산을
  그대로 가져다 쓴다(신규 암호 로직 없음 — 통합 원칙 1 그대로 적용).

### 3.2 gopang-worker의 3행 원장을 `bivm.js` 호출로 교체

현재 `gopang-worker`의 `escrow-signer.js`/`escrow.js releaseHold`는 buyer(debit)/
seller(credit)/platform(credit) 3행을 쓰기만 하고, 검증(Σδ=0)은 별도 크론
(`verifySetInvariance`, 제가 v1에서 제안했던 신규 함수)에서 했습니다. 통합 후에는:

```js
// escrow-signer.js — 3행 작성 직후, 커밋 전에 즉시 검증
import { verify as bivmVerify, createTxPair } from '../../../src/openhash/bivm.js'

const ledgerEntries = [ /* buyer/seller/platform 3행, 기존 그대로 */ ]

// [통합] 별도 lib/bivm.js를 새로 만드는 대신, 정본 bivm.js에 그대로 태운다
const txPairs = ledgerEntries.map(e => ({
  id: e.entry.tx_id, from: hold.buyer_guid, to: hold.seller_guid,
  amount: e.entry.amount,
  delta: e.entry.direction === 'debit' ? -e.entry.amount : e.entry.amount,
  balanceBefore: 0, balanceAfter: 0, // 서버는 잔액 재구성을 L1 tx가 전담하므로 0 고정
}))
const { valid, errors } = bivmVerify(txPairs)
if (!valid) {
  await flagOpsAlert(env, `bivm-violation:${hold.tx_id}`, { errors })
  // 논문 §4.2.1: 위반 시 즉시 차단이 원칙이나, 자금은 L1에서 이미 이동 완료된
  // 상태이므로(에스크로 특성상) 되돌리지 않고 최우선 순위 알림으로 처리
}
```

- 이렇게 하면 **v1에서 제가 별도로 설계했던 `lib/bivm.js`, `lib/bmi.js`는 만들지 않고
  삭제**, `src/openhash/bivm.js` 하나로 클라이언트(GDC 송금)와 서버(에스크로) 양쪽을
  전부 커버.
- `balanceBefore`/`balanceAfter`를 서버에서 의미 있게 채우려면 L1 PocketBase가 해당
  계정의 직전 잔액을 함께 반환해야 함 — **이건 gopang-worker의 `_loadHold`/L1 API
  응답에 필드 추가가 필요한 부분이라, 병합 시 별도 작업 항목으로 관리**(지금 0으로
  고정해도 Σδ=0 검증 자체는 정상 작동하므로 급하지 않음).

### 3.3 worker.js 인라인 사본 수정 — 버그 수정 + 정본 동기화

```js
// worker.js — 기존 verifyOutputConsistency/verifyDeltaZero의 허용오차를
// bivm.js의 BIVM_CONST.EPSILON(1e-9)과 일치시킨다.
// [수정 전] < 0.01
// [수정 후] < 1e-9  ← src/openhash/bivm.js와 반드시 동일하게 유지 (정본 동기화 규칙)
const _BIVM_EPSILON = 1e-9; // 정본: src/openhash/bivm.js BIVM_CONST.EPSILON — 수정 시 함께 반영
```
그리고 "감시 모드(로그만, 차단 안 함)"를 실제 차단 모드로 바꿀지는 **비즈니스 판단이
필요한 사안**이므로 이번 통합 작업에서는 **허용오차 버그만 고치고, 차단 여부는 별도
결정 사항으로 남겨둡니다**(주석에 이미 "T10까지"라는 임시 표현이 있어, 원래도 언젠가
강화할 계획이었던 것으로 보입니다 — 팀 확인 필요).

---

## 4. 물리적 배치 — gopang-worker를 저장소에 병합하는 구체적 위치

기존 저장소의 `services/` 디렉토리 관례(`services/klaw`, `services/fiil-kcleaner`)를
따라 다음 구조를 제안합니다:

```
services/gopang-worker/          ← 신규 (제가 만든 에스크로/원장/사기탐지 전체 이동)
  src/
    lib/  do/  routes/
  pb_hooks/
  migrations/
  wrangler.toml                  ← 별도 Cloudflare Worker로 독립 배포(루트 wrangler.toml과 무관, 충돌 없음)
  package.json
  README.md
```

- **루트 `wrangler.toml`은 절대 건드리지 않음** — `services/gopang-worker/`는 독립된
  `wrangler.toml`을 가진 별도 Worker이므로 애초에 병합·충돌 대상이 아님(이전에 확인한
  안전 원칙 그대로 유지).
- `src/openhash/bivm.js`·`src/openhash/tiers.js`는 저장소 루트 `src/openhash/`에 남고,
  `services/gopang-worker/`에서 **상대경로 `import`로 참조**(같은 저장소 내 다른
  디렉토리이므로 빌드 시 문제 없음 — Cloudflare Workers는 배포 시 번들링하므로 경로만
  정확하면 됨).

---

## 5. 구체적 갱신(마이그레이션) 실행계획

### 5-1. 준비 (파괴적 변경 없음)
1. `git pull` — 최신 상태 반영 (다른 작업자의 변경 확인)
2. `src/openhash/tiers.js` 신규 파일 추가만 (기존 파일 미변경)
3. `core/constants.js`의 `PLSM.ASYMMETRIC`에 L4 행 **추가만**(기존 L1~L3 행 변경 없음)

### 5-2. BIVM 확장 (기존 API 하위호환 유지)
4. `src/openhash/bivm.js`에 `computeBmiRoot`/`verifyBmiRoot` **추가**(기존 `verify`/
   `verifySetInvariant`/`verifyBMI`/`createTxPair`는 시그니처·동작 변경 없음 — 기존
   호출자인 `transactionPipeline.js` 등 영향 없음)

### 5-3. worker.js 버그 수정 (단독으로 즉시 배포 가능한 안전한 수정)
5. `_BIVM_EPSILON` 상수를 `0.01` → `1e-9`로 수정
   - **주의**: 이 수정만으로도 지금까지 "허용 오차 안"으로 통과되던 일부 거래가
     "불일치"로 로그에 잡히기 시작할 수 있음(현재 감시 모드라 차단은 안 되지만
     로그량 증가 예상) — 배포 전 스테이징에서 로그 볼륨 확인 권장.

### 5-4. 계층 정의 교체 (영향 범위가 가장 큰 단계 — 신중히)
6. `plsm.js`의 `LCAT_MAP`(A/B/C→L1/L2/L3) 사용처를 `tiers.js`의 `computeLCAT(env,
   guidA, guidB)`로 교체
7. worker.js의 `computeLCAT(buyerRegion, sellerRegion)` 호출부를 guid 기반으로 교체
   — **이 단계는 반드시 두 guid 모두 `l1-registry.js`에 등록되어 있어야 정상 동작**하므로,
   L1 노드 등록이 안 된(파일럿 노드 1개뿐인) 현재 상태에서는 대부분 "정보 없음 →
   보수적 기본값(L2)"로 빠질 것 — **L1 노드 확산이 어느 정도 진행된 뒤 이 단계를
   실행하는 게 안전**합니다. 지금 바로 교체하면 사실상 항상 L2로만 판정되어 PLSM
   분포가 왜곡될 수 있습니다.

### 5-5. gopang-worker 병합
8. `services/gopang-worker/`로 디렉토리 이동
9. `escrow-signer.js`/`escrow.js`가 자체 검증 대신 `src/openhash/bivm.js`를 import하도록 수정
10. 전체 재검증: `node --check` 구문 검사, import/export 대응관계 재확인(이전에 했던
    방식 그대로), `wrangler deploy --dry-run`으로 배포 가능 여부 확인

### 권장 순서 요약
**5-1 → 5-2 → 5-3 (즉시 가능, 리스크 낮음) → 5-5 (gopang-worker 병합, bivm.js 재사용) →
5-4 (계층 정의 교체, L1 노드 확산 이후로 미루는 것을 권장)**

---

## 6. 여전히 남는, 이번엔 손대지 않는 것

- `ilmv.js`의 상향 모니터링 6임계값 중 몇 개가 `chain_status.json`에 실제로 채워지는지
  — 배포 스크립트 담당자 확인 필요(v2에서 남긴 항목, 이번 통합 범위 밖)
- `lpbft.js`의 `_runMinimalPBFT()` 실네트워크화 — 이번 통합과 독립적인 별도 작업
- worker.js "감시 모드→차단 모드" 전환 여부 — 비즈니스 판단 필요

바로 5-1·5-2·5-3(리스크 낮은 부분)부터 실제 코드로 작성해드릴까요?
