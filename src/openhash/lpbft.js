/**
 * @file lpbft.js
 * @description LPBFT — 긴급 경량 PBFT 합의
 * @version 1.0.0
 * @author AI City Inc.
 *
 * 근거: OpenHash SCI 논문 §4.4 (C4 기여)
 *   - 5개 비상 조건에서만 발동
 *   - 4개 비활성화 조건 충족 시 자동 복귀
 *   - L1 4노드 기준 평균 0.759ms (단일 머신 N=100 실측)
 *   - Split-brain → CAP CP 선택 (논문 v2.2 §4.5.1)
 *   - 슬래싱: Stake ≥ 100 × Gain (부록 C.4)
 *   - 상태 전이: 부록 B
 */

import { LPBFT as LPBFT_CONST } from '../core/constants.js'
import { EventBus, EVENTS } from '../core/event-bus.js'

// ── 상태 정의 ────────────────────────────────────────────────────────────
export const STATE = Object.freeze({
  NORMAL:    'NORMAL',     // 정상 운영 (합의 없음)
  EMERGENCY: 'EMERGENCY',  // 비상 합의 실행 중
  RECOVERY:  'RECOVERY',   // 합의 완료, 복귀 조건 확인 중
})

// ── 비활성화 조건 4개 ─────────────────────────────────────────────────────
const DEACTIVATION_CONDITIONS = Object.freeze([
  'CHAIN_RESTORED',       // 해시 체인 복원
  'BIVM_CLEARED',         // BIVM 위반 해소
  'NODES_VALIDATED',      // 노드 검증 완료
  'NETWORK_STABLE',       // 네트워크 안정화
])

// ── LPBFT 클래스 ─────────────────────────────────────────────────────────
class LPBFTConsensus {

  constructor() {
    this._state          = STATE.NORMAL
    this._activeCondition = null
    this._startTime      = null
    this._log            = []          // 상태 전이 로그
    this._metConditions  = new Set()   // 충족된 비활성화 조건
  }

  /** 현재 상태 반환 */
  get state() { return this._state }

  /**
   * 비상 조건 감지 → LPBFT 발동
   * @param {string} condition - LPBFT_CONST.EMERGENCY_CONDITIONS 중 하나
   * @param {string} affectedLayer
   * @returns {Promise<{ triggered: boolean, duration: number, condition: string }>}
   */
  async trigger(condition, affectedLayer = 'L1') {
    if (!LPBFT_CONST.EMERGENCY_CONDITIONS.includes(condition)) {
      return { triggered: false, duration: 0, condition }
    }

    if (this._state === STATE.EMERGENCY) {
      // 이미 합의 중 — 재진입 방지
      return { triggered: false, duration: 0, condition, reason: '이미 합의 실행 중' }
    }

    this._state           = STATE.EMERGENCY
    this._activeCondition = condition
    this._startTime       = Date.now()
    this._metConditions.clear()

    this._log.push({
      event:    'TRIGGERED',
      condition,
      layer:    affectedLayer,
      ts:       new Date().toISOString(),
    })

    console.warn(`[LPBFT] ⚡ 비상 합의 발동: ${condition} (계층: ${affectedLayer})`)

    // 최소 침습적 PBFT 수행
    const duration = await this._runMinimalPBFT(affectedLayer)

    this._state = STATE.RECOVERY
    this._log.push({
      event:    'CONSENSUS_DONE',
      duration,
      ts:       new Date().toISOString(),
    })

    return { triggered: true, duration, condition }
  }

  /**
   * 비활성화 조건 충족 보고
   * 4개 모두 충족 시 NORMAL 복귀
   * @param {string} condition - DEACTIVATION_CONDITIONS 중 하나
   */
  reportDeactivation(condition) {
    if (!DEACTIVATION_CONDITIONS.includes(condition)) return

    this._metConditions.add(condition)

    if (this._metConditions.size >= LPBFT_CONST.DEACTIVATION_COUNT) {
      this._state           = STATE.NORMAL
      this._activeCondition = null
      this._metConditions.clear()

      this._log.push({
        event: 'DEACTIVATED',
        ts:    new Date().toISOString(),
      })

      console.log('[LPBFT] ✅ 정상 상태 복귀')
    }
  }

  /**
   * 상태 전이 로그 반환 (디버깅·감사용)
   * @returns {Array}
   */
  getLog() {
    return [...this._log]
  }

  /**
   * 테스트용 상태 초기화
   */
  _reset() {
    this._state           = STATE.NORMAL
    this._activeCondition = null
    this._startTime       = null
    this._log             = []
    this._metConditions.clear()
  }

  // ── Private ─────────────────────────────────────────────────────────────

  /**
   * 최소 침습적 PBFT 수행
   * 실제 분산 환경: 노드 간 PRE-PREPARE → PREPARE → COMMIT 3단계
   * 현재: 로컬 시뮬레이션 (Phase 4 네트워크 연동 후 실제 구현)
   *
   * @param {string} layer
   * @returns {Promise<number>} 소요 시간 (ms)
   */
  async _runMinimalPBFT(layer) {
    const t0 = performance.now()

    // 단계 1: PRE-PREPARE (리더 제안)
    await _simulatePhase('PRE-PREPARE', 0.2)

    // 단계 2: PREPARE (노드 검증)
    await _simulatePhase('PREPARE', 0.3)

    // 단계 3: COMMIT (쿼럼 합의 완료)
    // L1 4노드, f=1, 쿼럼=3 (논문 §4.4)
    await _simulatePhase('COMMIT', 0.2)

    const duration = performance.now() - t0

    console.log(`[LPBFT] 합의 완료: ${duration.toFixed(3)}ms (목표: 0.759ms — 로컬 시뮬)`)

    return parseFloat(duration.toFixed(3))
  }
}

/** 단계 지연 시뮬레이션 */
async function _simulatePhase(name, delayMs) {
  return new Promise(resolve => setTimeout(resolve, delayMs))
}

// 싱글톤
export const LPBFT = new LPBFTConsensus()

// 상수 재내보내기
export { DEACTIVATION_CONDITIONS }
