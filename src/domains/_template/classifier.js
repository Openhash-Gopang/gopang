/**
 * @file classifier.js (_template)
 * @description 도메인 법령 분류기 — TODO: 실제 법령 분류 규칙 작성
 */

export const classifier = {
  /**
   * SU 목록을 받아 법령 플래그와 점수를 반환
   * @param {Array} suList
   * @returns {{ flags: string[], scores: Object, details: Object[] }}
   */
  async classify(suList) {
    // TODO: 실제 분류 로직 구현
    // 예: suList에서 위험 패턴 탐지 후 flags 반환
    return { flags: [], scores: {}, details: [] }
  },

  /**
   * Phase 1.2 Fast-Path 트리거 목록
   * @returns {Array<{id:string, pattern:RegExp, score:number, desc:string}>}
   */
  getFastPathTriggers() {
    // TODO: 즉각 차단이 필요한 고위험 패턴 정의
    return [
      // 예: { id: 'DOMAIN-FP01', pattern: /위험패턴/, score: 0.90, desc: '설명' }
    ]
  },
}
