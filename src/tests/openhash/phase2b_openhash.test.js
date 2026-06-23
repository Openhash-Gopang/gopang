/**
 * @file phase2b_openhash.test.js
 * @description Phase 2B OpenHash 단위 테스트
 * @테스트항목 O-01 ~ O-14
 */

import { selectLayer, simulateDistribution } from '../../openhash/plsm.js'
import { anchor, buildMerkleRoot, buildMerkleProof, verifyMerkleProof,
         verifyChainIntegrity, _resetChain } from '../../openhash/hashChain.js'
import { verify as bivmVerify, createTxPair,
         verifySetInvariant, verifyBMI } from '../../openhash/bivm.js'
import { downwardAudit, upwardMonitor, crossLayerVerify } from '../../openhash/ilmv.js'
import { LPBFT, STATE, DEACTIVATION_CONDITIONS } from '../../openhash/lpbft.js'
import { calculateImportanceScore, selectMode, MODE } from '../../openhash/importanceVerifier.js'
import { processTx, addToBlacklist, _resetPipeline } from '../../openhash/transactionPipeline.js'
import { generateKeyPair, signMessage } from '../../pdv/keyManager.js'

let passed = 0, failed = 0

async function test(id, desc, fn) {
  try {
    await fn()
    console.log(`  ✅ ${id}: ${desc}`)
    passed++
  } catch (err) {
    console.error(`  ❌ ${id}: ${desc}\n     └─ ${err.message}`)
    failed++
  }
}

function assert(c, m) { if (!c) throw new Error(m || '단언 실패') }

console.log('\n=== Phase 2B OpenHash 테스트 ===\n')

// O-01: PLSM 분포 검증 (χ² 검정)
await test('O-01', 'PLSM 10만 회 분포 χ² 검정', async () => {
  const { ratios, chiSquare, passed: ok } = await simulateDistribution(100_000)
  console.log(`     분포: L1=${ratios.L1}% L2=${ratios.L2}% L3=${ratios.L3}% L4=${ratios.L4}% L5=${ratios.L5}%`)
  console.log(`     χ²=${chiSquare} (임계: 9.488)`)
  assert(ok, `χ²=${chiSquare} — 균일 분포 기대`)
})

// O-02: Hash Chain 연속 앵커링 + prevHash 체인 연결
await test('O-02', 'Hash Chain 앵커링 + prevHash 체인 연결', async () => {
  _resetChain()
  const e1 = await anchor('메시지1', 'sig1', 'msg-001')
  const e2 = await anchor('메시지2', 'sig2', 'msg-002')
  const e3 = await anchor('메시지3', 'sig3', 'msg-003')

  assert(e2.prevHash === e1.entryHash, `e2.prevHash = e1.entryHash`)
  assert(e3.prevHash === e2.entryHash, `e3.prevHash = e2.entryHash`)
  assert(e1.entryHash.length === 64, 'entryHash 길이 64')
})

// O-03: Merkle Root 생성·Proof 검증
await test('O-03', 'Merkle Root 생성 + Proof 검증', async () => {
  const hashes = ['aaa', 'bbb', 'ccc', 'ddd']
  const root   = await buildMerkleRoot(hashes)
  assert(root.length === 64, `Merkle Root 길이 64: ${root.length}`)

  const proof  = await buildMerkleProof(hashes, 1)  // 'bbb'의 Proof
  const valid  = await verifyMerkleProof(hashes[1], proof, root)
  assert(valid === true, 'Merkle Proof 검증 성공')

  // 위변조된 해시로 검증
  const invalid = await verifyMerkleProof('zzz', proof, root)
  assert(invalid === false, '위변조 해시 Proof 실패')
})

// O-04: BIVM Σδ≠0 → SET_VIOLATION
await test('O-04', 'BIVM Σδ≠0 → BIVM_SET_VIOLATION', async () => {
  const txs = [
    { id: 't1', delta: -100, balanceBefore: 500, balanceAfter: 400, amount: 100, from:'A', to:'B' },
    { id: 't2', delta:  80,  balanceBefore: 100, balanceAfter: 180, amount: 80,  from:'A', to:'B' },
    // Σδ = -100 + 80 = -20 ≠ 0
  ]
  let threw = false
  try { verifySetInvariant(txs) } catch (e) {
    threw = true
    assert(e.message.includes('BIVM_SET_VIOLATION'), `오류 메시지: ${e.message}`)
  }
  assert(threw, 'BIVM_SET_VIOLATION 오류 기대')
})

// O-05: BIVM BMI 위변조 3/3 탐지
await test('O-05', 'BIVM BMI 위변조 3/3 탐지', async () => {
  let count = 0
  const cases = [
    // 케이스 1: balanceBefore + delta ≠ balanceAfter
    [{ id:'t1', delta:-100, balanceBefore:500, balanceAfter:450, amount:100, from:'A', to:'B' }],
    // 케이스 2: balanceAfter 음수
    [{ id:'t2', delta:-600, balanceBefore:500, balanceAfter:-100, amount:600, from:'A', to:'B' }],
    // 케이스 3: amount 0 이하
    [{ id:'t3', delta:0, balanceBefore:500, balanceAfter:500, amount:0, from:'A', to:'B' }],
  ]
  for (const txs of cases) {
    try { verifyBMI(txs) } catch (_) { count++ }
  }
  assert(count === 3, `BMI 위변조 탐지 3/3: 실제=${count}`)
})

// O-06: BIVM 정상 거래 쌍 검증
await test('O-06', 'BIVM 정상 거래 쌍 검증', async () => {
  const txs = createTxPair('tx-001', 'Alice', 'Bob', 100, 500, 200)
  const result = bivmVerify(txs)
  assert(result.valid === true, `BIVM 정상 결과: ${JSON.stringify(result)}`)
})

// O-07: LPBFT 비상 조건 발동
await test('O-07', 'LPBFT 비상 조건 발동', async () => {
  LPBFT._reset()
  assert(LPBFT.state === STATE.NORMAL, '초기 상태 NORMAL')

  const result = await LPBFT.trigger('HASH_CHAIN_BREAK', 'L1')
  assert(result.triggered === true, '발동 성공')
  assert(typeof result.duration === 'number', `duration: ${result.duration}ms`)
  assert(LPBFT.state === STATE.RECOVERY, `상태: ${LPBFT.state}`)
})

// O-08: LPBFT 비활성화 4조건 충족 → NORMAL 복귀
await test('O-08', 'LPBFT 비활성화 4조건 → NORMAL 복귀', async () => {
  LPBFT._reset()
  await LPBFT.trigger('BIVM_VIOLATION', 'L1')

  for (const cond of DEACTIVATION_CONDITIONS) {
    LPBFT.reportDeactivation(cond)
  }
  assert(LPBFT.state === STATE.NORMAL, `복귀 상태: ${LPBFT.state}`)
})

// O-09: 중요도 점수 → 모드 선택 (Phase 3: 논문 §4.1 임계값 25/60)
await test('O-09', '중요도 점수 → 모드 선택', async () => {
  assert(selectMode(0)    === MODE.LIGHTWEIGHT, '0 → 경량')
  assert(selectMode(24)   === MODE.LIGHTWEIGHT, '24 → 경량')
  assert(selectMode(24.9) === MODE.LIGHTWEIGHT, '24.9 → 경량')
  assert(selectMode(25)   === MODE.STANDARD,    '25 → 표준 (임계값 경계)')
  assert(selectMode(25.1) === MODE.STANDARD,    '25.1 → 표준')
  assert(selectMode(59)   === MODE.STANDARD,    '59 → 표준')
  assert(selectMode(60)   === MODE.ENHANCED,    '60 → 강화 (임계값 경계)')
  assert(selectMode(100)  === MODE.ENHANCED,    '100 → 강화')
})

// O-10: 거래 파이프라인 Stage 1~5 정상 흐름
await test('O-10', '거래 파이프라인 Stage 1~5 정상 흐름', async () => {
  _resetPipeline()
  const { publicKey, privateKey, publicKeyB64 } = await generateKeyPair()
  const tx = {
    id: 'tx-pipeline-001', from: 'alice', to: 'bob',
    amount: 100, fromBalance: 1000, toBalance: 200,
    assetType: 'stable', contractType: 'instant',   // Phase 3: 논문 공식 입력
    senderPubKeyB64: publicKeyB64,
    signature: await signMessage('tx-pipeline-001|alice|bob|100', privateKey),
  }
  const result = await processTx(tx)
  assert(result.success === true, `Stage 파이프라인 성공: ${JSON.stringify(result)}`)
  assert(result.stage  === 5,    `최종 Stage 5: ${result.stage}`)
})

// O-11: Stage 1 잔액 부족 차단
await test('O-11', 'Stage 1 잔액 부족 차단', async () => {
  _resetPipeline()
  const { privateKey, publicKeyB64 } = await generateKeyPair()
  const tx = {
    id: 'tx-fail-001', from: 'alice', to: 'bob',
    amount: 9999, fromBalance: 100, toBalance: 200,
    assetType: 'stable', contractType: 'instant',
    senderPubKeyB64: publicKeyB64,
    signature: await signMessage('tx-fail-001|alice|bob|9999', privateKey),
  }
  const result = await processTx(tx)
  assert(result.success === false, '잔액 부족 실패')
  assert(result.stage   === 1,    `Stage 1에서 차단: ${result.stage}`)
})

// O-12: Stage 5 블랙리스트 차단
await test('O-12', 'Stage 5 블랙리스트 차단', async () => {
  _resetPipeline()
  addToBlacklist('hacker')
  const { privateKey, publicKeyB64 } = await generateKeyPair()
  const tx = {
    id: 'tx-bl-001', from: 'hacker', to: 'bob',
    amount: 1, fromBalance: 100, toBalance: 0,
    assetType: 'stable', contractType: 'instant',
    senderPubKeyB64: publicKeyB64,
    signature: await signMessage('tx-bl-001|hacker|bob|1', privateKey),
  }
  const result = await processTx(tx)
  assert(result.success === false, '블랙리스트 차단')
  assert(result.stage   === 5,    `Stage 5에서 차단: ${result.stage}`)
})

// O-13: 체인 무결성 검증
await test('O-13', '체인 무결성 검증', async () => {
  _resetChain()
  await anchor('msg-A', 'sigA', 'id-A')
  await anchor('msg-B', 'sigB', 'id-B')
  const { valid } = await verifyChainIntegrity()
  assert(valid === true, '체인 무결성 통과')
})

// O-14: 논문 §4.1 공식 수치 검증 (importanceVerifier v2.0.0)
// score = w1·f_amount + w2·f_type + w3·f_contract
//   w1=0.5, w2=0.3, w3=0.2  |  V_REF=100,000
await test('O-14', '논문 §4.1 공식 수치 정합성 검증', async () => {
  // 케이스A: amount=100,000, stable(1.0), instant(0.5)
  //   f_amount=100 → score = 0.5*100 + 0.3*1.0 + 0.2*0.5 = 50.4
  const sA = calculateImportanceScore({ amount: 100_000, assetType: 'stable', contractType: 'instant' })
  assert(Math.abs(sA - 50.4) < 1e-9, `A score=${sA} (기대: 50.4)`)
  assert(selectMode(sA) === MODE.STANDARD, `A → STANDARD`)

  // 케이스B: amount=100,000, stable(1.0), escrow(1.0)
  //   score = 0.5*100 + 0.3*1.0 + 0.2*1.0 = 50.5
  const sB = calculateImportanceScore({ amount: 100_000, assetType: 'stable', contractType: 'escrow' })
  assert(Math.abs(sB - 50.5) < 1e-9, `B score=${sB} (기대: 50.5)`)

  // 케이스C: amount=0, stable, instant → score=0+0.3+0.1=0.4 → LIGHTWEIGHT
  const sC = calculateImportanceScore({ amount: 0, assetType: 'stable', contractType: 'instant' })
  assert(Math.abs(sC - 0.4) < 1e-9, `C score=${sC} (기대: 0.4)`)
  assert(selectMode(sC) === MODE.LIGHTWEIGHT, `C → LIGHTWEIGHT`)

  // 케이스D: amount=50,000, stable, instant → f_amount=50, score=25.4 → STANDARD 경계
  const sD = calculateImportanceScore({ amount: 50_000, assetType: 'stable', contractType: 'instant' })
  assert(Math.abs(sD - 25.4) < 1e-9, `D score=${sD} (기대: 25.4)`)
  assert(selectMode(sD) === MODE.STANDARD, `D 경계값 → STANDARD`)

  // 케이스E: 기본값 폴백(필드 없음) = 케이스A와 동일
  const sE = calculateImportanceScore({ amount: 100_000 })
  assert(Math.abs(sE - sA) < 1e-9, `E 폴백 score=${sE.toFixed(4)} == A=${sA.toFixed(4)}`)
})

// ── 결과 출력 ────────────────────────────────────────────────────────────
console.log(`\n결과: ${passed} 통과 / ${failed} 실패 / 총 ${passed + failed}\n`)
if (failed > 0) process.exit(1); else process.exit(0)
