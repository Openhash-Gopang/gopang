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

import { WS, RISK } from '../core/constants.js'

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

    // BUG-FIX(2026-07-17): 법령/의료 분류기(P2)가 카테고리를 특정할 만큼
    // 확신했는데(등록된 severity는 전부 0.60~0.95라 0.5는 사실상 "분류기가
    // 뭔가 잡았다"와 동치) P1(협박·사기 어휘)이 0이면, 35% 가중치로는
    // S0_MAX(0.30)를 못 넘어 최종적으로 "안전"으로 처리되는 문제가 있었다
    // (예: "보증금 반환을 거부하고 있습니다" — CV-2가 severity 0.72로
    // 정확히 잡아도 wsScore=0.252로 S0). Fast-Path가 이미 "고신뢰도 단일
    // 신호는 블렌드로 희석시키지 않는다"는 원칙을 쓰고 있으므로, P2에도
    // 같은 원칙을 최소한으로 적용한다 — 단, S1(소프트 경고) 문턱만
    // 보장하고 S2/S3(보류·차단) 같은 강한 조치는 여전히 P1의 뒷받침이
    // 있어야 도달하게 한다(패턴 매칭 하나로 대화를 막지는 않음).
    if (p2Score >= 0.5) wsScore = Math.max(wsScore, RISK.S0_MAX + 0.01)
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
