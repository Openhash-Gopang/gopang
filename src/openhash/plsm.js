/**
 * @file plsm.js
 * @description PLSM — 확률적 계층 선택 모듈 (Probabilistic Layer Selection Module)
 * @version 1.0.0
 * @author AI City Inc.
 *
 * 근거: OpenHash SCI 논문 §4.1 (C1 기여)
 *   - 이중 SHA-256 재해싱 → mod 1000 → 5계층 결정
 *   - 10,000,000회 χ² 검정 결과 p > 0.99 균일 분포 확인
 *   - 계층 분포: L1=60% L2=20% L3=10% L4=6% L5=4%
 */

import { PLSM as PLSM_CONST } from '../core/constants.js'
import { doubleSha256 } from '../pdv/keyManager.js'

/**
 * 거래 데이터에서 기록 계층 결정
 * 합의 없이 확률적으로 부하를 분산
 *
 * @param {string} txData - 거래 식별 문자열 (msgId + timestamp + content 조합 권장)
 * @returns {Promise<'L1'|'L2'|'L3'|'L4'|'L5'>}
 */
export async function selectLayer(txData) {
  const hash = await doubleSha256(txData)

  // 전체 hex → BigInt → mod 1000 (균일 분포 보장)
  // 마지막 3자리만 사용하면 hex 범위(0~4095) % 1000에서 편향 발생 → BUG-002 수정
  const bucket = Number(BigInt('0x' + hash) % 1000n)

  if (bucket < PLSM_CONST.L1_UPPER) return 'L1'   // 0~599  = 60%
  if (bucket < PLSM_CONST.L2_UPPER) return 'L2'   // 600~799 = 20%
  if (bucket < PLSM_CONST.L3_UPPER) return 'L3'   // 800~899 = 10%
  if (bucket < PLSM_CONST.L4_UPPER) return 'L4'   // 900~959 = 6%
  return 'L5'                                       // 960~999 = 4%
}

/**
 * N회 호출하여 계층별 분포 통계 반환 (테스트·검증용)
 * @param {number} n - 시뮬레이션 횟수
 * @returns {Promise<{ counts: Object, ratios: Object, chiSquare: number, passed: boolean }>}
 */
export async function simulateDistribution(n = 100_000) {
  const counts = { L1: 0, L2: 0, L3: 0, L4: 0, L5: 0 }

  for (let i = 0; i < n; i++) {
    const layer = await selectLayer(`sim-${i}-${Math.random()}`)
    counts[layer]++
  }

  const ratios = {}
  for (const [k, v] of Object.entries(counts)) {
    ratios[k] = parseFloat((v / n * 100).toFixed(2))
  }

  // χ² 검정 (기대값: L1=60% L2=20% L3=10% L4=6% L5=4%)
  const expected = { L1: n * 0.60, L2: n * 0.20, L3: n * 0.10, L4: n * 0.06, L5: n * 0.04 }
  let chiSquare = 0
  for (const k of PLSM_CONST.LAYERS) {
    chiSquare += Math.pow(counts[k] - expected[k], 2) / expected[k]
  }

  // 자유도 4, p=0.05 임계값 = 9.488 → 이하면 균일 분포
  const passed = chiSquare < 9.488

  return { counts, ratios, chiSquare: parseFloat(chiSquare.toFixed(4)), passed }
}
