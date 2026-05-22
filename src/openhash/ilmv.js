/**
 * @file ilmv.js
 * @description ILMV — 양방향 상호 계층 검증 (Inter-Layer Mutual Verification)
 * @version 1.0.0
 * @author AI City Inc.
 *
 * 근거: OpenHash SCI 논문 §4.3 (C3 기여)
 *   - 하향 감사 6항목 (L5→L1): L2→L1 100% 스트리밍
 *   - 상향 모니터링 6임계값 (L1→L5): 임계값 초과 시 상위 계층 알림
 *   - 비인접 계층 교차 검증
 */

import { EventBus, EVENTS } from '../core/event-bus.js'

// ── 임계값 설정 ───────────────────────────────────────────────────────────
const THRESHOLDS = Object.freeze({
  TPS_MAX:          5000,    // 초당 처리량 상한
  ERROR_RATE_MAX:   0.01,    // 오류율 1% 이상
  LATENCY_MAX_MS:   100,     // 레이턴시 100ms 이상
  QUEUE_DEPTH_MAX:  1000,    // 큐 깊이 1000 이상
  HASH_MISMATCH_MAX: 0,      // 해시 불일치 허용 0
  BYZANTINE_NODE_MAX: 0,     // 비잔틴 노드 허용 0
})

// ── 하향 감사 (L5 → L1) ─────────────────────────────────────────────────

/**
 * 하향 감사 — 상위 계층이 하위 계층의 무결성을 검사
 * 6개 항목 검사
 *
 * @param {string} upperLayer  - 'L5'|'L4'|'L3'|'L2'
 * @param {string} lowerLayer  - 'L4'|'L3'|'L2'|'L1'
 * @param {Object} lowerMetrics - 하위 계층 메트릭
 * @returns {{ passed: boolean, issues: string[] }}
 */
export function downwardAudit(upperLayer, lowerLayer, lowerMetrics) {
  const issues = []

  // 항목 1: 해시 체인 연속성
  if (lowerMetrics.hashChainBreak === true) {
    issues.push(`[ILMV] ${lowerLayer} 해시 체인 단절 감지`)
  }

  // 항목 2: 잔액 불변성
  if (lowerMetrics.bivmViolation === true) {
    issues.push(`[ILMV] ${lowerLayer} BIVM 위반 감지`)
  }

  // 항목 3: 해시 불일치 수
  if ((lowerMetrics.hashMismatchCount ?? 0) > THRESHOLDS.HASH_MISMATCH_MAX) {
    issues.push(`[ILMV] ${lowerLayer} 해시 불일치: ${lowerMetrics.hashMismatchCount}건`)
  }

  // 항목 4: 비잔틴 노드 수
  if ((lowerMetrics.byzantineNodeCount ?? 0) > THRESHOLDS.BYZANTINE_NODE_MAX) {
    issues.push(`[ILMV] ${lowerLayer} 비잔틴 노드 감지: ${lowerMetrics.byzantineNodeCount}개`)
  }

  // 항목 5: 오류율
  if ((lowerMetrics.errorRate ?? 0) > THRESHOLDS.ERROR_RATE_MAX) {
    issues.push(`[ILMV] ${lowerLayer} 오류율 초과: ${(lowerMetrics.errorRate * 100).toFixed(2)}%`)
  }

  // 항목 6: 서명 검증 실패
  if (lowerMetrics.signatureFailure === true) {
    issues.push(`[ILMV] ${lowerLayer} 서명 검증 실패 감지`)
  }

  const passed = issues.length === 0
  if (!passed) {
    console.warn(`[ILMV] 하향 감사 실패 (${upperLayer}→${lowerLayer}):`, issues)
  }

  return { passed, issues, upperLayer, lowerLayer }
}

// ── 상향 모니터링 (L1 → L5) ──────────────────────────────────────────────

/**
 * 상향 모니터링 — 하위 계층이 이상을 상위로 보고
 * 6개 임계값 초과 시 상위 계층에 알림
 *
 * @param {string} layer    - 보고 계층 ('L1'~'L4')
 * @param {Object} metrics  - 현재 계층 메트릭
 * @returns {{ alerts: string[], escalate: boolean }}
 */
export function upwardMonitor(layer, metrics) {
  const alerts = []

  // 임계값 1: TPS 초과
  if ((metrics.tps ?? 0) > THRESHOLDS.TPS_MAX) {
    alerts.push(`TPS 초과: ${metrics.tps} (임계: ${THRESHOLDS.TPS_MAX})`)
  }

  // 임계값 2: 오류율 초과
  if ((metrics.errorRate ?? 0) > THRESHOLDS.ERROR_RATE_MAX) {
    alerts.push(`오류율 초과: ${(metrics.errorRate * 100).toFixed(2)}%`)
  }

  // 임계값 3: 레이턴시 초과
  if ((metrics.latencyMs ?? 0) > THRESHOLDS.LATENCY_MAX_MS) {
    alerts.push(`레이턴시 초과: ${metrics.latencyMs}ms`)
  }

  // 임계값 4: 큐 깊이 초과
  if ((metrics.queueDepth ?? 0) > THRESHOLDS.QUEUE_DEPTH_MAX) {
    alerts.push(`큐 깊이 초과: ${metrics.queueDepth}`)
  }

  // 임계값 5: 해시 불일치
  if ((metrics.hashMismatchCount ?? 0) > THRESHOLDS.HASH_MISMATCH_MAX) {
    alerts.push(`해시 불일치: ${metrics.hashMismatchCount}건`)
  }

  // 임계값 6: 비잔틴 노드
  if ((metrics.byzantineNodeCount ?? 0) > THRESHOLDS.BYZANTINE_NODE_MAX) {
    alerts.push(`비잔틴 노드: ${metrics.byzantineNodeCount}개`)
  }

  const escalate = alerts.length > 0

  if (escalate) {
    console.warn(`[ILMV] ${layer} 상향 알림:`, alerts)
    EventBus.emit(EVENTS.PLUGIN_ERROR, {
      pluginName: `openhash-${layer}`,
      event:      'ilmv:threshold-exceeded',
      err:        { alerts, layer },
    }, 'ilmv')
  }

  return { alerts, escalate, layer }
}

// ── 비인접 계층 교차 검증 ────────────────────────────────────────────────

/**
 * 비인접 계층 간 교차 검증 (예: L1 ↔ L3)
 * @param {string} layerA
 * @param {Object} metricsA
 * @param {string} layerB
 * @param {Object} metricsB
 * @returns {{ consistent: boolean, discrepancies: string[] }}
 */
export function crossLayerVerify(layerA, metricsA, layerB, metricsB) {
  const discrepancies = []

  // 총 처리량 일관성 (±5% 허용)
  if (metricsA.totalTx !== undefined && metricsB.totalTx !== undefined) {
    const diff = Math.abs(metricsA.totalTx - metricsB.totalTx)
    const tolerance = Math.max(metricsA.totalTx, metricsB.totalTx) * 0.05
    if (diff > tolerance) {
      discrepancies.push(
        `총 TX 수 불일치: ${layerA}=${metricsA.totalTx}, ${layerB}=${metricsB.totalTx}`
      )
    }
  }

  // 최신 해시 루트 일관성
  if (metricsA.latestMerkleRoot && metricsB.latestMerkleRoot &&
      metricsA.latestMerkleRoot !== metricsB.latestMerkleRoot) {
    discrepancies.push(
      `Merkle Root 불일치: ${layerA}=${metricsA.latestMerkleRoot?.slice(0,8)}..., ` +
      `${layerB}=${metricsB.latestMerkleRoot?.slice(0,8)}...`
    )
  }

  return {
    consistent:    discrepancies.length === 0,
    discrepancies,
    layerA,
    layerB,
  }
}
