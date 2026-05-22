/**
 * @file phase2.js
 * @description AI 비서 Phase 2 — 플러그인 법령 분류기 동적 로딩
 * @version 1.0.0
 * @author AI City Inc.
 *
 * 근거: KL-M-02 Phase 2 / v3.1 계획서
 *   - 플러그인 레지스트리에서 분류기 동적 로딩
 *   - 오류 격리: 한 플러그인 실패가 다른 도메인에 영향 없음
 *   - P1_score < 0.3 → Phase 2 생략 (Phase 3으로 직행)
 */

import { registry } from '../core/plugin-registry.js'
import { EventBus, EVENTS } from '../core/event-bus.js'

/**
 * Phase 2: 플러그인 법령 분류기 동적 실행
 *
 * @param {Array}  suList      - Phase 1 SU 목록
 * @param {number} p1Score     - Phase 1 점수
 * @returns {Promise<{
 *   results: Object,   // { 'k-law': {flags,scores}, 'k-health': {...} }
 *   p2Score: number,   // 전체 도메인 최대 점수
 *   skipped: boolean
 * }>}
 */
export async function classifyPhase2(suList, p1Score) {
  // P1 점수가 낮으면 Phase 2 생략
  if (p1Score < 0.3) {
    return { results: {}, p2Score: 0, skipped: true }
  }

  const activeDomains = registry.list().map(m => m.name)
  const results = {}

  for (const name of activeDomains) {
    const plugin = registry.get(name)
    if (!plugin) continue

    try {
      results[name] = await plugin.legalClassifier.classify(suList)
    } catch (err) {
      // 오류 격리: 이 플러그인 실패가 다른 도메인에 전파되지 않음
      console.error(`[Phase2] ${name} 분류기 오류:`, err.message)
      results[name] = { flags: [], scores: {}, error: err.message }
      EventBus.emit(EVENTS.PLUGIN_ERROR, { pluginName: name, phase: 2, err }, 'phase2')
    }
  }

  // 전체 도메인 최대 점수
  const p2Score = Object.values(results)
    .flatMap(r => Object.values(r.scores ?? {}))
    .reduce((max, s) => Math.max(max, s), 0)

  return { results, p2Score: parseFloat(p2Score.toFixed(4)), skipped: false }
}
