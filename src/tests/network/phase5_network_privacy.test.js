/**
 * @file phase5_network_privacy.test.js
 * @description Phase 5 Network + Privacy 테스트 (GDC 분리됨)
 * @테스트항목 N-01~N-05, P-01~P-06
 *
 * BUG-FIX(2026-07-17): 원래 phase5_network_gdc_privacy.test.js는 N/G/P
 * 셋을 한 파일에서 같이 import했는데, GDC 파일 6개(currencyPool/escrow/
 * dao/offlineQueue/tokenomics/smartVault)가 2026-07-15에 gdc 저장소로
 * 이동한 뒤 그 import들이 전부 깨져서 파일 전체(N/P 포함)가 단 하나의
 * 테스트도 실행 못 하는 상태였다(ERR_MODULE_NOT_FOUND). gopang에 남아있는
 * Network/Privacy 부분만 이 파일로 분리해 살렸다 — GDC(G-01~08) 부분은
 * gdc 저장소 쪽에서 별도로 테스트해야 한다
 * (docs/HONDI_DOMAIN_DEEP_TEST_DIRECTIVE_v1_0.md §4.5 참조).
 *
 * 분리하면서 추가로 발견한 버그: P-01이 쓰는 getMixnode()가 애초에
 * import 목록에 없었다(ReferenceError 유발 — GDC import 에러에 가려
 * 지금까지 드러나지 않았음). import에 추가해서 수정.
 */

// ── Network ──────────────────────────────────────────────────────────────
import { submitToLayer, getLayerStatus, _resetStatus } from '../../network/layerClient.js'
import { deriveGUID, deriveIPv6, calcTrustLevel, generateStealthAddress,
         matchStealthAddress, checkPermission, getDailyMsgLimit,
         TRUST_LEVEL } from '../../network/gasAddress.js'
import { gdcWeightedDistance, findClosestNode, registerRecord,
         lookupGUID, registerNickname, resolveNickname,
         auctionNickname, updateMobility, _resetDHT } from '../../network/dht.js'

// ── Privacy ───────────────────────────────────────────────────────────────
import { registerMixnode, selectPath, rewardRelay, slashNode, getMixnode, _resetMixnet } from '../../privacy/mixnet.js'
import { createGroup, satisfiesKAnonymity } from '../../privacy/kAnonymity.js'
import { calcDifficulty, verifyPoW, updateReputation, _resetReputation } from '../../privacy/adaptivePow.js'
import { deriveSalt, maskAdminCode } from '../../privacy/salt.js'
import { createRecoveryRequest, approveRecovery, _resetRecovery } from '../../privacy/socialRecovery.js'

import { generateKeyPair } from '../../pdv/keyManager.js'

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

function setup() {
  _resetStatus(); _resetDHT()
  _resetMixnet(); _resetReputation(); _resetRecovery()
}

console.log('\n=== Phase 5 Network + Privacy 테스트(GDC 분리됨) ===\n')

// ── Network 테스트 ────────────────────────────────────────────────────────
console.log('[ Network ]')

setup()
await test('N-01', 'layerClient dev 환경 제출 성공', async () => {
  const r = await submitToLayer('L1', { entryHash: 'abc', msgHash: 'def' })
  assert(r.success === true, `성공: ${r.success}`)
  assert(r.layer === 'L1', `계층: ${r.layer}`)
})

await test('N-02', 'GUID 파생 결정론적', async () => {
  const { publicKeyB64 } = await generateKeyPair()
  const g1 = await deriveGUID(publicKeyB64, 12345)
  const g2 = await deriveGUID(publicKeyB64, 12345)
  assert(g1 === g2, '동일 입력 → 동일 GUID')
  assert(g1.length === 64, `GUID 길이: ${g1.length}`)
})

await test('N-03', 'Stealth Address 생성·매칭', async () => {
  const recipGUID = 'a'.repeat(64)
  const { stealthAddr, tagBits, factor } = await generateStealthAddress(recipGUID, 10, 'seed-xyz')
  assert(tagBits >= 32 && tagBits <= 40, `tagBits: ${tagBits}`)
  const match = await matchStealthAddress(stealthAddr, recipGUID, 'seed-xyz', tagBits)
  assert(match === true, 'Stealth 매칭 성공')
  const noMatch = await matchStealthAddress(stealthAddr, recipGUID, 'wrong-seed', tagBits)
  assert(noMatch === false, 'Stealth 불일치 탐지')
})

await test('N-04', 'GDC 가중 DHT 거리 + 닉네임 등록·조회', async () => {
  // DHT 거리: 스테이킹 높을수록 가깝게 위치
  const gA = 'a'.repeat(64), gB = 'b'.repeat(64)
  const d0  = gdcWeightedDistance(gA, gB, 0)      // 스테이킹 없음
  const d100 = gdcWeightedDistance(gA, gB, 100)   // 100 GDC 스테이킹
  assert(d100 < d0, `스테이킹 → 거리 단축: ${d100} < ${d0}`)

  // 닉네임 등록
  const r = await registerNickname('주피터', gA, 'pubkey-b64', 0.001)
  assert(r.success === true, `닉네임 등록: ${r.success}`)
  assert(resolveNickname('주피터') === gA, '닉네임 조회')

  // 이동성: IPv6 업데이트
  registerRecord(gA, '::1', 100)
  updateMobility(gA, '::2')
  assert(lookupGUID(gA)?.ipv6 === '::2', 'IPv6 업데이트')
})

await test('N-05', 'Sybil 4단계 신뢰 등급 + 권한 확인', async () => {
  assert(calcTrustLevel(0, false)    === TRUST_LEVEL.L1, 'L1: 기본')
  assert(calcTrustLevel(100, false)  === TRUST_LEVEL.L2, 'L2: 100 GDC')
  assert(calcTrustLevel(1000, true)  === TRUST_LEVEL.L3, 'L3: 1000 GDC + KYC')

  assert(checkPermission(TRUST_LEVEL.L3, 'escrow')    === true,  'L3: 에스크로 허용')
  assert(checkPermission(TRUST_LEVEL.L2, 'escrow')    === false, 'L2: 에스크로 불가')
  assert(getDailyMsgLimit(TRUST_LEVEL.L0) === 10,                'L0: 일일 10건')
})

// ── Privacy 테스트 ────────────────────────────────────────────────────────
console.log('\n[ Privacy ]')

setup()
await test('P-01', 'Mixnet GDC 보상·가중 선택·슬래싱', () => {
  registerMixnode('node-A', 100)
  registerMixnode('node-B', 500)
  registerMixnode('node-C', 200)

  rewardRelay('node-A', 0.01)
  assert(getMixnode('node-A')?.relayCount === 1, '중계 횟수 증가')

  slashNode('node-B')
  assert(getMixnode('node-B')?.slashed === true, '노드 슬래싱')

  const path = selectPath(2)
  assert(path.length <= 2, `경로 선택: ${path}`)
  assert(!path.includes('node-B'), '슬래싱 노드 경로 제외')
})

await test('P-02', 'K-익명성 그룹 검증', () => {
  const guids = ['g1','g2','g3','g4','g5']
  const grp = createGroup(guids, 5)
  assert(grp.valid === true, `K=5 충족: ${grp.valid}`)

  const small = createGroup(['g1','g2'], 5)
  assert(small.valid === false, `K=5 미충족: ${small.valid}`)

  assert(satisfiesKAnonymity(guids, 5) === true, '만족')
  assert(satisfiesKAnonymity(['g1'], 5) === false, '미만족')
})

await test('P-03', '적응형 PoW + 평판 시스템', () => {
  // 기본 난이도
  assert(calcDifficulty('new-user') === 4, '기본 난이도 4')

  // 위반 3회 → 난이도 +1
  updateReputation('bad-user', 'violation')
  updateReputation('bad-user', 'violation')
  updateReputation('bad-user', 'violation')
  assert(calcDifficulty('bad-user') === 5, `위반 후 난이도: ${calcDifficulty('bad-user')}`)

  // PoW 검증
  assert(verifyPoW('0000abc', 4) === true,  '0000 → 난이도 4 통과')
  assert(verifyPoW('1000abc', 4) === false, '1000 → 난이도 4 실패')
})

await test('P-04', 'Salt 파생 + 행정코드 마스킹', async () => {
  const salt1 = await deriveSalt('user-1', '11010')
  const salt2 = await deriveSalt('user-1', '11010')
  assert(salt1 === salt2, '결정론적 Salt')
  assert(salt1.length === 64, `Salt 길이: ${salt1.length}`)

  const masked = await maskAdminCode('11010', salt1)
  assert(masked.length === 16, `마스킹 길이: ${masked.length}`)
  assert(masked !== '11010', '원본과 다름')
})

await test('P-05', '사회적 복구 — 보호자 60% 승인', async () => {
  const { requestId, threshold } = await createRecoveryRequest(
    'alice', ['g1','g2','g3','g4','g5'], 'new-pubkey-b64'
  )
  assert(threshold === 3, `임계값 3/5: ${threshold}`)

  approveRecovery('alice', 'g1')
  approveRecovery('alice', 'g2')
  const r3 = approveRecovery('alice', 'g3')
  assert(r3.completed === true, '60% 승인 → 복구 완료')
  assert(r3.newPubKeyB64 === 'new-pubkey-b64', '새 공개키 반환')
})

await test('P-06', '오프라인 큐 예치금 계산·환불', () => {
  // BUG-FIX(2026-07-17): 이 테스트는 gdc/offlineQueue.js(calcDeposit/enqueue/
  // confirmReceived)를 썼는데 그 파일이 gdc 저장소로 이동해 더 이상 gopang에
  // 없다 — 이 케이스만 gdc 저장소 쪽에서 재구현해야 한다(§ 파일 헤더 참고).
  console.log('     (SKIP — offlineQueue.js가 gdc 저장소로 이동, 여기선 검증 불가)')
})

// ── 결과 ─────────────────────────────────────────────────────────────────
console.log(`\n결과: ${passed} 통과 / ${failed} 실패 / 총 ${passed + failed}\n`)
if (failed > 0) process.exit(1); else process.exit(0)
