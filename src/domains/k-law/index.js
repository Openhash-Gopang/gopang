/**
 * @file index.js  (k-law)
 * @description K-Law 사법 도메인 플러그인 — 1호 플러그인
 * @version 1.0.0
 * @author AI City Inc.
 *
 * 근거:
 *   - KL-M-02: 법령 분류 CR-1~5, CV-1~4, LB-1~2, CC-1~2
 *   - KL-S-01: 임대차 위법성 탐지율 ≥93.3%, 보이스피싱 탐지율 ≥99.7%
 *   - GDC §1.2: K-Law 판결 결과 → GDC 에스크로 자동 집행
 */

import { GopangDomainPlugin } from '../../core/plugin-interface.js'
import { EventBus, EVENTS } from '../../core/event-bus.js'
import { classifier } from './classifier.js'
import { riskRules }  from './risk-rules.js'
import { uiComponents } from './ui.js'
import { apiEndpoints } from './api.js'
import { dataSchema }   from './schema.js'

export default class KLawPlugin extends GopangDomainPlugin {

  metadata = {
    name:        'k-law',
    displayName: 'K-Law (사법)',
    version:     '1.0.0',
    description: '예방법학 엔진 — 위법성 자동 감지·증거 체계·K-Law AI',
    icon:        '⚖️',
    author:      'AI City Inc.',
    legalDomains: [
      '형법', '민법', '주택임대차보호법', '근로기준법',
      '전기통신금융사기법', '개인정보보호법', '공정거래법',
    ],
  }

  legalClassifier = classifier
  riskRules        = riskRules
  uiComponents     = uiComponents
  apiEndpoints     = apiEndpoints
  dataSchema       = dataSchema

  // ── 이벤트 구독 ──────────────────────────────────────────────────────────
  eventSubscriptions = [
    {
      // S3 위험 감지 → LEGAL_DISPUTE 이벤트 발행
      event: EVENTS.MSG_RISK_ASSESSED,
      handler: (data) => {
        if (!data?.riskResult) return
        const klawResult = data.riskResult

        if (klawResult.level === 'S3') {
          console.log(`[K-Law] S3 감지 → LEGAL_DISPUTE 발행 (msgId: ${data.msgId?.slice(0,8)}...)`)
          EventBus.emit(EVENTS.LEGAL_DISPUTE, {
            msgId:      data.msgId,
            legalFlags: klawResult.legalFlags,
            score:      klawResult.score,
          }, 'k-law')

          // GDC 에스크로 생성 제안 (GDC §1.2)
          EventBus.emit(EVENTS.GDC_ESCROW_CREATED, {
            reason:     'S3_LEGAL_RISK',
            msgId:      data.msgId,
            legalFlags: klawResult.legalFlags,
          }, 'k-law')
        }
      },
    },
  ]

  async onLoad() {
    console.log('[K-Law] ⚖️  플러그인 로드 — K-Law 사법 도메인 v1.0.0')
    for (const { event, handler } of this.eventSubscriptions) {
      EventBus.on(event, handler, this.metadata.name)
    }
  }

  async onUnload() {
    console.log('[K-Law] 플러그인 언로드')
    for (const { event, handler } of this.eventSubscriptions) {
      EventBus.off(event, handler)
    }
  }

  async onUpdate(prevVersion) {
    console.log(`[K-Law] ${prevVersion} → ${this.metadata.version} 업데이트`)
  }
}
