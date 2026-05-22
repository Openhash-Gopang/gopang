/**
 * @file phase4.js
 * @description AI 비서 Phase 4 — WS 공식 통합 점수 산출 + 쌍방향 검증
 * @version 1.0.0
 * @author AI City Inc.
 *
 * 근거: KL-M-02 Phase 4
 *   - WS = P1×0.50 + P2×0.35 + P3×0.15
 *   - Fast-Path 트리거 시 해당 점수 우선 처리
 *   - 쌍방향 검증: 발신·수신 각각 독립 산출 → maxScore 적용
 */

import { WS } from '../core/constants.js'

/**
 * Phase 4: 통합 위험 점수 산출
 *
 * @param {number}  p1Score        - Phase 1 점수
 * @param {number}  p2Score        - Phase 2 점수
 * @param {number}  p3Score        - Phase 3 점수 (첨부 없으면 0)
 * @param {number}  historyWeight  - Phase 0 Q0.8 가중치 (1.0 or 1.3)
 * @param {Object|null} fastPathResult - Fast-Path 트리거 결과
 * @returns {{ finalScore: number, wsScore: number, breakdown: Object }}
 */
export function calculateScore(p1Score, p2Score, p3Score, historyWeight, fastPathResult) {
  let wsScore

  if (fastPathResult) {
    // Fast-Path 트리거 시 해당 점수 우선 적용
    wsScore = fastPathResult.score
  } else {
    // WS 공식: P1×0.50 + P2×0.35 + P3×0.15
    wsScore = p1Score * WS.P1 + p2Score * WS.P2 + p3Score * WS.P3
  }

  const finalScore = Math.min(wsScore * historyWeight, 1.0)

  return {
    finalScore:    parseFloat(finalScore.toFixed(4)),
    wsScore:       parseFloat(wsScore.toFixed(4)),
    breakdown: {
      p1: p1Score, p2: p2Score, p3: p3Score,
      weights: WS,
      historyWeight,
      fastPathApplied: !!fastPathResult,
    },
  }
}

/**
 * 쌍방향 검증: 발신·수신 각각 독립 산출
 * 근거: KL-M-02 §4.2 — 내가 위법을 저지를 가능성 + 상대방이 저지를 가능성 동시 차단
 *
 * @param {Object} outgoing - 발신 메시지 점수 파라미터
 * @param {Object} incoming - 수신 메시지 점수 파라미터 (없으면 null)
 * @returns {{ outScore: number, inScore: number, maxScore: number }}
 */
export function bidirectionalVerify(outgoing, incoming = null) {
  const outResult = calculateScore(
    outgoing.p1Score, outgoing.p2Score, outgoing.p3Score,
    outgoing.historyWeight, outgoing.fastPathResult
  )

  const inResult = incoming
    ? calculateScore(
        incoming.p1Score, incoming.p2Score, incoming.p3Score,
        incoming.historyWeight, incoming.fastPathResult
      )
    : { finalScore: 0 }

  const maxScore = Math.max(outResult.finalScore, inResult.finalScore)

  return {
    outScore:  outResult.finalScore,
    inScore:   inResult.finalScore,
    maxScore:  parseFloat(maxScore.toFixed(4)),
    outDetail: outResult,
    inDetail:  inResult,
  }
}
