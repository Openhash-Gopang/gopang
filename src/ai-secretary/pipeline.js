/**
 * @file pipeline.js
 * @description AI 비서 Phase 0~6 오케스트레이터
 * @version 1.0.0
 * @author AI City Inc.
 *
 * 근거: v3.1 계획서 Phase 3 / KL-S-01 §3.2
 *   - 플러그인 Fast-Path 트리거 통합 로딩
 *   - Phase 2: 플러그인 분류기 동적 주입
 *   - Phase 3: Q0.5=true 시에만 실행
 *   - Phase 4: WS 공식 + 쌍방향 검증
 *   - Phase 6: PDV 기록 + OpenHash 앵커링
 */

import { registry } from '../core/plugin-registry.js'
import { EventBus, EVENTS } from '../core/event-bus.js'
import { identifyCommObject } from './phase0.js'
import { analyzePhase1 } from './phase1.js'
import { classifyPhase2 } from './phase2.js'
import { analyzePhase3 } from './phase3.js'
import { calculateScore, bidirectionalVerify } from './phase4.js'
import { classifyRisk } from './phase5.js'
import { recordAndAnchor } from './phase6.js'

/**
 * AI 비서 전체 파이프라인 실행 (Phase 0~6)
 *
 * @param {Object} message   - 발신 메시지
 * @param {Object} context   - 소통 맥락
 * @param {Object} [incoming] - 수신 메시지 (쌍방향 검증용, 없으면 null)
 * @returns {Promise<{
 *   msgId:       string,
 *   anchorHash:  string,
 *   riskResult:  Object,
 *   phaseScores: Object,
 *   processingMs: number
 * }>}
 */
export async function runPipeline(message, context, incoming = null) {
  const t0 = performance.now()

  EventBus.emit(EVENTS.MSG_RECEIVED, { senderId: message.senderId }, 'pipeline')

  // ── Phase 0: 소통 객체 식별 ─────────────────────────────────────────
  const phase0 = identifyCommObject(message, context)

  // Phase 0에서 즉시 S3 조건 감지
  if (phase0.immediateS3) {
    const riskResult = classifyRisk(1.0, true, phase0.immediateS3Reason, {})
    const recorded   = await recordAndAnchor(message, riskResult,
      { p1:1.0, p2:1.0, p3:0, ws:1.0, final:1.0 })

    return _buildResult(recorded, riskResult, { p1:1.0, p2:1.0, p3:0, ws:1.0, final:1.0 },
      t0, phase0)
  }

  // ── Phase 1: SU 태깅 + Fast-Path ────────────────────────────────────
  const pluginTriggers = registry.getAllFastPathTriggers()
  const phase1 = analyzePhase1(message.content ?? '', phase0.msgType, pluginTriggers)

  // ── Phase 2: 플러그인 법령 분류 (Fast-Path 미트리거 시) ──────────────
  let phase2 = { results: {}, p2Score: 0, skipped: false }
  if (!phase1.fastPathResult) {
    phase2 = await classifyPhase2(phase1.suList, phase1.p1Score)
  }

  // ── Phase 3: 문서 분석 (첨부 파일 있을 때) ──────────────────────────
  let phase3 = { p3Score: 0, flags: [], details: [] }
  if (phase0.hasAttachment && message.attachment) {
    phase3 = await analyzePhase3(message.attachment, phase2.results)
  }

  // ── Phase 4: WS 공식 + 쌍방향 검증 ─────────────────────────────────
  const outgoing = {
    p1Score: phase1.p1Score, p2Score: phase2.p2Score, p3Score: phase3.p3Score,
    historyWeight: phase0.historyWeight, fastPathResult: phase1.fastPathResult,
  }

  const biDir = incoming
    ? bidirectionalVerify(outgoing, {
        p1Score: phase1.p1Score, p2Score: phase2.p2Score, p3Score: 0,
        historyWeight: 1.0, fastPathResult: null,
      })
    : bidirectionalVerify(outgoing, null)

  const wsScore    = calculateScore(phase1.p1Score, phase2.p2Score, phase3.p3Score,
    phase0.historyWeight, phase1.fastPathResult).wsScore
  const finalScore = biDir.maxScore

  // ── Phase 5: 위험 등급 판정 ─────────────────────────────────────────
  const riskResult = classifyRisk(finalScore, false, null, phase2.results)

  // 도메인 플래그 병합 (Phase 3 포함)
  if (phase3.flags?.length > 0) {
    riskResult.legalFlags = [...new Set([...riskResult.legalFlags, ...phase3.flags])]
  }

  // ── Phase 6: PDV 기록 + OpenHash 앵커링 ─────────────────────────────
  const phaseScores = {
    p1: phase1.p1Score, p2: phase2.p2Score, p3: phase3.p3Score,
    ws: wsScore, final: finalScore,
  }

  const recorded = await recordAndAnchor(
    message, riskResult, phaseScores,
    phase3.details?.length > 0 ? phase3 : null,
    phase1.fastPathResult
  )

  EventBus.emit(EVENTS.MSG_RISK_ASSESSED, {
    msgId: recorded.msgId, riskResult,
    activeDomains: registry.list().map(m => m.name),
  }, 'pipeline')

  if (riskResult.level === 'S3') {
    EventBus.emit(EVENTS.MSG_BLOCKED, { msgId: recorded.msgId, reason: riskResult.message }, 'pipeline')
  }

  return _buildResult(recorded, riskResult, phaseScores, t0, phase0)
}

function _buildResult(recorded, riskResult, phaseScores, t0, phase0) {
  const processingMs = parseFloat((performance.now() - t0).toFixed(3))
  return {
    msgId:        recorded.msgId,
    anchorHash:   recorded.anchorHash,
    layer:        recorded.layer,
    riskResult,
    phaseScores,
    processingMs,
    historyWeight: phase0?.historyWeight ?? 1.0,
  }
}
