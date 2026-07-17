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
 * BUG-FIX(2026-07-17): 예전엔 p1Score < 0.3이면 이 함수 전체를 생략했다.
 * 원래 의도는 성능 최적화였을 것으로 보이나, 실측 결과 여기서 도는
 * plugin.legalClassifier.classify()는 (K-Law/K-Health 둘 다) 순수 정규식
 * 패턴 매칭이라 LLM 호출이 전혀 없다 — 비용이 사실상 0에 가까워서 애초에
 * "아낄 게" 없는 최적화였다. 반면 이 게이트 때문에 "보증금 반환을
 * 거부하고 있습니다"처럼 협박·사기 어휘가 없는 순수 민사분쟁(임대차 등)
 * 메시지는 Phase 1의 dangerTags(THREAT/DECEIVE/SOLICIT)에 안 걸려
 * p1Score가 0으로 나오고, 그래서 K-Law의 CV-2 패턴이 실제로는 매칭되는데도
 * (phase4_klaw.test.js K-03에서 직접 호출 시 확인됨) 이 함수 자체가
 * 생략되어 항상 무위험으로 처리되는 문제가 있었다(phase6_khealth.test.js
 * H-08에서 발견). 게이트를 제거하고 항상 실행한다 — 비용이 없으니
 * 재현율(recall)을 낮출 이유가 없다.
 *
 * @param {Array}  suList      - Phase 1 SU 목록
 * @param {number} p1Score     - Phase 1 점수(현재는 참고용으로만 파라미터 유지 — 호출부 호환성)
 * @returns {Promise<{
 *   results: Object,   // { 'k-law': {flags,scores}, 'k-health': {...} }
 *   p2Score: number,   // 전체 도메인 최대 점수
 *   skipped: boolean
 * }>}
 */
export async function classifyPhase2(suList, p1Score) {
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
