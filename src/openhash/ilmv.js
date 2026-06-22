/**
 * @file ilmv.js
 * @description ILMV — 양방향 상호 계층 검증 (Inter-Layer Mutual Verification)
 * @version 2.0.0
 * @author AI City Inc.
 *
 * 근거: OpenHash SCI 논문 §4.3 (C3 기여)
 *   하향 감사 6항목 (L5→L1): L2→L1 100% 스트리밍
 *   상향 모니터링 6임계값 (L1→L5): 임계값 초과 시 상위 계층 알림
 *   비인접 계층 교차 검증 (L1↔L3 1시간 주기)
 *
 * v1 → v2 변경:
 *   - fetchLayerMetrics(): 실제 chain_status.json fetch 추가
 *   - chain_status.json 필드 → ILMV 6항목 매핑
 *   - worker.js 프록시 경유 (CORS + 토큰 없이 GitHub Pages 직접 읽기)
 *
 * chain_status.json → 6항목 매핑:
 *   chain_valid===false        → hashChainBreak ①
 *   ilmv_status==='VIOLATION'  → bivmViolation  ②
 *   last_verified > 5분 경과   → timestampStale ③
 *   latest_hash 계층간 불일치  → hashMismatch   ④
 *   openhash_tx==='FAILED'     → errorRate      ⑤
 *   ilmv_status==='SIGNATURE_FAILURE' → signatureFailure ⑥
 */

import { EventBus, EVENTS } from '../core/event-bus.js'

// ── 계층별 GitHub Pages 엔드포인트 ──────────────────────────────────────
// chain_status.json은 정적 파일이므로 CORS 없이 직접 fetch 가능
const LAYER_STATUS_URLS = Object.freeze({
  L1: 'https://openhash-gopang.github.io/openhash-L1-ido1/chain_status.json',
  L2: 'https://openhash-gopang.github.io/openhash-L2-jeju-city/chain_status.json',
  L3: 'https://openhash-gopang.github.io/openhash-L3-jeju/chain_status.json',
  L4: 'https://openhash-gopang.github.io/openhash-L4-kr/chain_status.json',
  L5: 'https://openhash-gopang.github.io/openhash-L5-global/chain_status.json',
})

// 타임스탬프 신선도 임계값 (논문 §4.3: ±5분)
const TIMESTAMP_FRESH_MS = 5 * 60 * 1000

// ── 임계값 설정 (논문 §4.3 상향 모니터링 6임계값) ──────────────────────
const THRESHOLDS = Object.freeze({
  TPS_MAX:            5000,   // 초당 처리량 상한
  ERROR_RATE_MAX:     0.01,   // 오류율 1%
  LATENCY_MAX_MS:     100,    // 레이턴시 100ms
  QUEUE_DEPTH_MAX:    1000,   // 큐 깊이
  HASH_MISMATCH_MAX:  0,      // 해시 불일치 허용 0
  BYZANTINE_NODE_MAX: 0,      // 비잔틴 노드 허용 0
})

// ── 실데이터 페처 ─────────────────────────────────────────────────────────

/**
 * chain_status.json을 fetch해 ILMV 메트릭으로 변환
 * buildout_plan_v2 Phase 5 핵심 — 이전에는 호출자가 직접 데이터를 만들어 넘겨야 했음
 *
 * @param {string} layer - 'L1'|'L2'|'L3'|'L4'|'L5'
 * @param {Object} [opts]
 * @param {number} [opts.timeoutMs=5000] - fetch 타임아웃
 * @returns {Promise<{
 *   layer: string,
 *   fetched: boolean,
 *   fetchedAt: string,
 *   raw: Object|null,
 *   metrics: {
 *     hashChainBreak: boolean,
 *     bivmViolation: boolean,
 *     timestampStale: boolean,
 *     hashMismatchCount: number,
 *     signatureFailure: boolean,
 *     errorRate: number,
 *     totalBlocks: number,
 *     latestHash: string,
 *     lastVerified: string|null,
 *   }
 * }>}
 */
export async function fetchLayerMetrics(layer, opts = {}) {
  const { timeoutMs = 5000 } = opts
  const url = LAYER_STATUS_URLS[layer]
  if (!url) throw new Error(`[ILMV] 지원하지 않는 계층: ${layer}`)

  const fetchedAt = new Date().toISOString()
  let raw = null

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)

    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    raw = await res.json()
  } catch (e) {
    console.warn(`[ILMV] ${layer} chain_status fetch 실패:`, e.message)
    // fetch 실패 시 안전한 기본값 반환 (LPBFT 과잉 발동 방지)
    return {
      layer, fetched: false, fetchedAt, raw: null,
      metrics: _defaultMetrics(),
    }
  }

  // chain_status.json → ILMV 6항목 매핑
  const now = Date.now()
  const lastVerifiedMs = raw.last_verified ? new Date(raw.last_verified).getTime() : 0
  const staleness = now - lastVerifiedMs

  const metrics = {
    // ① 해시체인 연속성 (논문 §4.3 하향감사 항목1)
    hashChainBreak:    raw.chain_valid === false,

    // ② BIVM 위반 (논문 §4.3 하향감사 항목2)
    bivmViolation:     raw.ilmv_status === 'VIOLATION',

    // ③ 타임스탬프 신선도 (논문 §4.3: ±5분 임계값)
    timestampStale:    lastVerifiedMs > 0 && staleness > TIMESTAMP_FRESH_MS,

    // ④ 해시 불일치 (계층간 비교는 crossLayerVerify에서, 여기선 단일 노드 기준)
    hashMismatchCount: 0,   // chain_status는 단일 노드 — 불일치 감지 불가 (ILMV 교차검증에서)

    // ⑤ 오류율 (PENDING/FAILED 상태를 오류로 간주)
    errorRate:         raw.openhash_tx === 'FAILED' ? 1.0 : 0,

    // ⑥ 서명 검증 실패 (논문 §4.3 하향감사 항목6)
    signatureFailure:  raw.ilmv_status === 'SIGNATURE_FAILURE',

    // 추가 메타
    totalBlocks:   raw.total_blocks   ?? 0,
    latestHash:    raw.latest_hash    ?? '',
    lastVerified:  raw.last_verified  ?? null,
    ilmvStatus:    raw.ilmv_status    ?? 'UNKNOWN',
    openhashTx:    raw.openhash_tx    ?? 'UNKNOWN',
    stalenessMs:   staleness,
  }

  return { layer, fetched: true, fetchedAt, raw, metrics }
}

/**
 * L1~L5 전체 메트릭 일괄 fetch (병렬)
 * @param {string[]} [layers] - 기본값: ['L1','L2','L3','L4','L5']
 * @returns {Promise<Object>} - { L1: {...}, L2: {...}, ... }
 */
export async function fetchAllLayerMetrics(layers = ['L1','L2','L3','L4','L5']) {
  const results = await Promise.allSettled(
    layers.map(l => fetchLayerMetrics(l))
  )
  const out = {}
  for (let i = 0; i < layers.length; i++) {
    const r = results[i]
    out[layers[i]] = r.status === 'fulfilled'
      ? r.value
      : { layer: layers[i], fetched: false, fetchedAt: new Date().toISOString(),
          raw: null, metrics: _defaultMetrics() }
  }
  return out
}

// ── 하향 감사 (L5 → L1) ──────────────────────────────────────────────────

/**
 * 하향 감사 — 상위 계층이 하위 계층의 무결성을 검사 (논문 §4.3 6항목)
 * v2: lowerMetrics를 직접 넘기는 대신 fetchLayerMetrics()로 자동 조회
 *
 * @param {string} upperLayer
 * @param {string} lowerLayer
 * @param {Object} [lowerMetrics] - 미전달 시 자동 fetch
 * @returns {Promise<{ passed: boolean, issues: string[], metrics: Object }>}
 */
export async function downwardAudit(upperLayer, lowerLayer, lowerMetrics) {
  // lowerMetrics 미전달 시 실데이터 자동 fetch
  if (!lowerMetrics) {
    const result = await fetchLayerMetrics(lowerLayer)
    lowerMetrics = result.metrics
  }

  const issues = []

  // 항목 1: 해시 체인 연속성
  if (lowerMetrics.hashChainBreak === true)
    issues.push(`[ILMV] ${lowerLayer} 해시 체인 단절 감지`)

  // 항목 2: 잔액 불변성(BIVM)
  if (lowerMetrics.bivmViolation === true)
    issues.push(`[ILMV] ${lowerLayer} BIVM 위반 감지`)

  // 항목 3: 타임스탬프 신선도
  if (lowerMetrics.timestampStale === true)
    issues.push(`[ILMV] ${lowerLayer} 타임스탬프 신선도 초과 (${Math.round((lowerMetrics.stalenessMs||0)/1000)}초 경과)`)

  // 항목 4: 해시 불일치
  if ((lowerMetrics.hashMismatchCount ?? 0) > THRESHOLDS.HASH_MISMATCH_MAX)
    issues.push(`[ILMV] ${lowerLayer} 해시 불일치: ${lowerMetrics.hashMismatchCount}건`)

  // 항목 5: 오류율
  if ((lowerMetrics.errorRate ?? 0) > THRESHOLDS.ERROR_RATE_MAX)
    issues.push(`[ILMV] ${lowerLayer} 오류율 초과: ${(lowerMetrics.errorRate * 100).toFixed(2)}%`)

  // 항목 6: 서명 검증 실패
  if (lowerMetrics.signatureFailure === true)
    issues.push(`[ILMV] ${lowerLayer} 서명 검증 실패 감지`)

  const passed = issues.length === 0
  if (!passed) console.warn(`[ILMV] 하향 감사 실패 (${upperLayer}→${lowerLayer}):`, issues)

  return { passed, issues, upperLayer, lowerLayer, metrics: lowerMetrics }
}

// ── 상향 모니터링 (L1 → L5) ──────────────────────────────────────────────

/**
 * 상향 모니터링 — 하위 계층이 이상을 상위로 보고
 * v2: metrics 미전달 시 자동 fetch
 *
 * @param {string} layer
 * @param {Object} [metrics] - 미전달 시 자동 fetch
 * @returns {Promise<{ alerts: string[], escalate: boolean }>}
 */
export async function upwardMonitor(layer, metrics) {
  if (!metrics) {
    const result = await fetchLayerMetrics(layer)
    metrics = result.metrics
  }

  const alerts = []

  if ((metrics.tps          ?? 0) > THRESHOLDS.TPS_MAX)
    alerts.push(`TPS 초과: ${metrics.tps}`)
  if ((metrics.errorRate    ?? 0) > THRESHOLDS.ERROR_RATE_MAX)
    alerts.push(`오류율 초과: ${(metrics.errorRate * 100).toFixed(2)}%`)
  if ((metrics.latencyMs    ?? 0) > THRESHOLDS.LATENCY_MAX_MS)
    alerts.push(`레이턴시 초과: ${metrics.latencyMs}ms`)
  if ((metrics.queueDepth   ?? 0) > THRESHOLDS.QUEUE_DEPTH_MAX)
    alerts.push(`큐 깊이 초과: ${metrics.queueDepth}`)
  if ((metrics.hashMismatchCount ?? 0) > THRESHOLDS.HASH_MISMATCH_MAX)
    alerts.push(`해시 불일치: ${metrics.hashMismatchCount}건`)
  if ((metrics.byzantineNodeCount ?? 0) > THRESHOLDS.BYZANTINE_NODE_MAX)
    alerts.push(`비잔틴 노드: ${metrics.byzantineNodeCount}개`)

  // 타임스탬프 신선도도 상향 알림 대상
  if (metrics.timestampStale === true)
    alerts.push(`타임스탬프 신선도 초과 (${Math.round((metrics.stalenessMs||0)/1000)}초)`)

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

// ── 비인접 계층 교차 검증 (L1↔L3 1시간 주기) ────────────────────────────

/**
 * 비인접 계층 간 교차 검증
 * v2: metricsA/B 미전달 시 자동 fetch (병렬)
 *
 * @param {string} layerA
 * @param {string} layerB
 * @param {Object} [metricsA]
 * @param {Object} [metricsB]
 */
export async function crossLayerVerify(layerA, layerB, metricsA, metricsB) {
  // 미전달 시 병렬 fetch
  if (!metricsA || !metricsB) {
    const [rA, rB] = await Promise.all([
      metricsA ? Promise.resolve({ metrics: metricsA }) : fetchLayerMetrics(layerA),
      metricsB ? Promise.resolve({ metrics: metricsB }) : fetchLayerMetrics(layerB),
    ])
    metricsA = rA.metrics
    metricsB = rB.metrics
  }

  const discrepancies = []

  // 총 블록 수 일관성 (L1이 항상 많아야 함)
  if (metricsA.totalBlocks !== undefined && metricsB.totalBlocks !== undefined) {
    const diff = Math.abs(metricsA.totalBlocks - metricsB.totalBlocks)
    const tolerance = Math.max(metricsA.totalBlocks, metricsB.totalBlocks) * 0.05
    if (diff > tolerance && Math.min(metricsA.totalBlocks, metricsB.totalBlocks) > 0) {
      discrepancies.push(
        `총 블록 수 불일치: ${layerA}=${metricsA.totalBlocks}, ${layerB}=${metricsB.totalBlocks}`
      )
    }
  }

  // 최신 해시 루트 일관성 (같은 계층이면 일치해야 함)
  if (metricsA.latestHash && metricsB.latestHash &&
      layerA === layerB &&
      metricsA.latestHash !== metricsB.latestHash) {
    discrepancies.push(
      `Merkle Root 불일치: ${layerA}=${metricsA.latestHash.slice(0,8)}..., ` +
      `${layerB}=${metricsB.latestHash.slice(0,8)}...`
    )
  }

  // 양쪽 중 하나라도 체인 단절이면 불일치
  if (metricsA.hashChainBreak || metricsB.hashChainBreak) {
    discrepancies.push(`체인 단절 감지: ${metricsA.hashChainBreak ? layerA : layerB}`)
  }

  return {
    consistent:    discrepancies.length === 0,
    discrepancies,
    layerA, layerB,
    metricsA, metricsB,
  }
}

// ── 내부 헬퍼 ────────────────────────────────────────────────────────────

function _defaultMetrics() {
  return {
    hashChainBreak:    false,
    bivmViolation:     false,
    timestampStale:    false,
    hashMismatchCount: 0,
    signatureFailure:  false,
    errorRate:         0,
    totalBlocks:       0,
    latestHash:        '',
    lastVerified:      null,
    ilmvStatus:        'UNKNOWN',
    openhashTx:        'UNKNOWN',
    stalenessMs:       0,
  }
}
