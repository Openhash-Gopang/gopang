/**
 * @file plsm.js
 * @description PLSM — 확률적 계층 선택 모듈 (Probabilistic Layer Selection Module)
 * @version 2.0.0
 * @author AI City Inc.
 *
 * 근거: OpenHash SCI 논문 §4.1 (C1 기여)
 *
 * v1 → v2 변경:
 *   - selectLayer(txData) → selectLayer(txData, lcat, score)
 *   - 고정 단일분포(60/20/10/6/4%) → 표1 LCAT×중요도 비대칭 분포
 *   - lcat/score 미전달 시 단일분포 폴백 (하위 호환)
 *
 * 표1 LCAT 매핑 (제주 파일럿):
 *   computeLCAT() 반환값 A→L1, B→L2, C→L3
 *   L1(로컬/제주내): 저중요도 L1=50%, 고중요도 L1=15%
 *   L2(국내):        저중요도 L2=55%, 고중요도 L2=20%
 *   L3(국제):        저중요도 L3=60%, 고중요도 L3=25%
 */

import { PLSM as PLSM_CONST, IMPORTANCE } from '../core/constants.js'
import { doubleSha256 } from '../pdv/keyManager.js'

// worker.js computeLCAT() A/B/C → 표1 LCAT 키(L1/L2/L3) 매핑
const LCAT_MAP = { A: 'L1', B: 'L2', C: 'L3' }

/**
 * 거래 데이터에서 기록 계층 결정 (논문 §4.1 표1 비대칭 분포)
 *
 * @param {string} txData - 거래 식별 문자열
 * @param {string} [lcat]  - 'A'|'B'|'C' 또는 'L1'|'L2'|'L3' (미전달 시 폴백)
 * @param {number} [score] - 중요도 점수 (미전달 시 폴백)
 * @returns {Promise<'L1'|'L2'|'L3'|'L4'|'L5'>}
 */
export async function selectLayer(txData, lcat, score) {
  const hash = await doubleSha256(txData)

  // mod 1000 버킷 (BigInt → 균일 분포 보장, BUG-002 수정)
  const bucket = Number(BigInt('0x' + hash) % 1000n)

  // lcat/score 없으면 단일분포 폴백 (하위 호환 — 메시지 앵커링 등 비금융 이벤트)
  if (lcat === undefined || lcat === null || score === undefined || score === null) {
    return _selectByFallback(bucket)
  }

  // LCAT 키 정규화 (A/B/C → L1/L2/L3)
  const lcatKey = LCAT_MAP[lcat] ?? lcat   // 이미 L1/L2/L3로 오면 그대로

  // 중요도 등급: score < LIGHTWEIGHT_MAX(25) → 'low', 이상 → 'high'
  const grade = score < IMPORTANCE.LIGHTWEIGHT_MAX ? 'low' : 'high'

  // 표1 분포 조회
  const dist = PLSM_CONST.ASYMMETRIC[lcatKey]?.[grade]
  if (!dist) {
    // 지원하지 않는 LCAT(L4/L5 등) → 폴백
    return _selectByFallback(bucket)
  }

  // 누적 상한값으로 계층 결정
  if (bucket < dist.L1) return 'L1'
  if (bucket < dist.L2) return 'L2'
  if (bucket < dist.L3) return 'L3'
  if (bucket < dist.L4) return 'L4'
  return 'L5'
}

/**
 * 단일 분포 폴백 (lcat/score 없는 비금융 이벤트용)
 * @param {number} bucket - 0~999
 */
function _selectByFallback(bucket) {
  if (bucket < PLSM_CONST.L1_UPPER) return 'L1'
  if (bucket < PLSM_CONST.L2_UPPER) return 'L2'
  if (bucket < PLSM_CONST.L3_UPPER) return 'L3'
  if (bucket < PLSM_CONST.L4_UPPER) return 'L4'
  return 'L5'
}

/**
 * N회 시뮬레이션으로 분포 통계 반환 (테스트·검증용)
 * @param {number} n
 * @param {string} [lcat]  - 특정 조합 검증 시 지정
 * @param {number} [score] - 특정 조합 검증 시 지정
 */
export async function simulateDistribution(n = 100_000, lcat, score) {
  const counts = { L1: 0, L2: 0, L3: 0, L4: 0, L5: 0 }

  for (let i = 0; i < n; i++) {
    const layer = await selectLayer(`sim-${i}-${Math.random()}`, lcat, score)
    counts[layer]++
  }

  const ratios = {}
  for (const [k, v] of Object.entries(counts)) {
    ratios[k] = parseFloat((v / n * 100).toFixed(2))
  }

  // 기대 분포 계산
  let expected
  if (lcat !== undefined && score !== undefined) {
    const lcatKey = LCAT_MAP[lcat] ?? lcat
    const grade   = score < IMPORTANCE.LIGHTWEIGHT_MAX ? 'low' : 'high'
    const dist    = PLSM_CONST.ASYMMETRIC[lcatKey]?.[grade]
    if (dist) {
      // 누적 상한 → 각 구간 비율로 변환
      const L1p = dist.L1
      const L2p = dist.L2 - dist.L1
      const L3p = dist.L3 - dist.L2
      const L4p = dist.L4 - dist.L3
      const L5p = 1000  - dist.L4
      expected = {
        L1: n * L1p / 1000, L2: n * L2p / 1000, L3: n * L3p / 1000,
        L4: n * L4p / 1000, L5: n * L5p / 1000,
      }
    }
  }
  if (!expected) {
    expected = { L1: n*0.60, L2: n*0.20, L3: n*0.10, L4: n*0.06, L5: n*0.04 }
  }

  // χ² 검정 (자유도 4, p=0.05 임계값 9.488)
  let chiSquare = 0
  for (const k of PLSM_CONST.LAYERS) {
    if (expected[k] > 0) {
      chiSquare += Math.pow(counts[k] - expected[k], 2) / expected[k]
    }
  }
  const passed = chiSquare < 9.488

  return { counts, ratios, chiSquare: parseFloat(chiSquare.toFixed(4)), passed, lcat, score, grade: score !== undefined ? (score < IMPORTANCE.LIGHTWEIGHT_MAX ? 'low' : 'high') : 'fallback' }
}
