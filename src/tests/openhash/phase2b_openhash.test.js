/**
 * @file phase2b_openhash.test.js
 * @description Phase 2B OpenHash 단위 테스트
 * @테스트항목 O-01 ~ O-11
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

// O-09: 중요도 점수 → 모드 선택
await test('O-09', '중요도 점수 → 모드 선택', async () => {
  assert(selectMode(10)  === MODE.LIGHTWEIGHT, '10 → 경량')
  assert(selectMode(29)  === MODE.LIGHTWEIGHT, '29 → 경량')
  assert(selectMode(30)  === MODE.STANDARD,    '30 → 표준')
  assert(selectMode(59)  === MODE.STANDARD,    '59 → 표준')
  assert(selectMode(60)  === MODE.ENHANCED,    '60 → 강화')
  assert(selectMode(100) === MODE.ENHANCED,    '100 → 강화')
})

// O-10: 거래 파이프라인 Stage 1~5 정상 흐름
await test('O-10', '거래 파이프라인 Stage 1~5 정상 흐름', async () => {
  _resetPipeline()
  const { publicKey, privateKey, publicKeyB64 } = await generateKeyPair()
  const tx = {
    id: 'tx-pipeline-001', from: 'alice', to: 'bob',
    amount: 100, fromBalance: 1000, toBalance: 200,
    type: 'financial', crossBorder: false,
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
    type: 'financial', crossBorder: false,
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
    type: 'financial', crossBorder: false,
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

// ── 결과 출력 ────────────────────────────────────────────────────────────
console.log(`\n결과: ${passed} 통과 / ${failed} 실패 / 총 ${passed + failed}\n`)
if (failed > 0) process.exit(1); else process.exit(0)
