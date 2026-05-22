/**
 * @file index.js  (k-health)
 * @description K-Health 의료 도메인 플러그인 — 2호 플러그인
 * @version 1.0.0
 * @author AI City Inc.
 *
 * 핵심 검증 목표:
 *   - 코어 파일 변경 0줄 — 플러그인 아키텍처 확장성 실증 (2호)
 *   - K-Law와 완전 독립 동작
 *   - K-Law + K-Health 동시 활성화 시 오류 전파 없음
 */

import { GopangDomainPlugin } from '../../core/plugin-interface.js'
import { EventBus, EVENTS } from '../../core/event-bus.js'
import { classifier }   from './classifier.js'
import { riskRules }    from './risk-rules.js'
import { uiComponents } from './ui.js'
import { apiEndpoints } from './api.js'
import { dataSchema }   from './schema.js'

export default class KHealthPlugin extends GopangDomainPlugin {

  metadata = {
    name:        'k-health',
    displayName: 'K-Health (의료)',
    version:     '1.0.0',
    description: '의료법·약사법·개인정보보호법(의료) 위법성 자동 감지',
    icon:        '🏥',
    author:      'AI City Inc.',
    legalDomains: ['의료법', '약사법', '의료분쟁조정법', '개인정보보호법(의료)'],
  }

  legalClassifier = classifier
  riskRules        = riskRules
  uiComponents     = uiComponents
  apiEndpoints     = apiEndpoints
  dataSchema       = dataSchema

  eventSubscriptions = [
    {
      // S2 이상 의료 위험 감지 → MEDICAL_ALERT 발행
      event: EVENTS.MSG_RISK_ASSESSED,
      handler: (data) => {
        if (!data?.riskResult) return
        const { level, legalFlags } = data.riskResult

        // 의료 관련 플래그 포함 여부 확인
        if (level === 'S2' || level === 'S3') {
          console.log(`[K-Health] 의료 위험 감지 (${level}) → MEDICAL_ALERT 발행`)
          EventBus.emit(EVENTS.MEDICAL_ALERT, {
            msgId:      data.msgId,
            level,
            legalFlags: legalFlags.filter(f => f.startsWith('MED-')),
          }, 'k-health')
        }
      },
    },
  ]

  async onLoad() {
    console.log('[K-Health] 🏥 플러그인 로드 — K-Health 의료 도메인 v1.0.0')
    for (const { event, handler } of this.eventSubscriptions) {
      EventBus.on(event, handler, this.metadata.name)
    }
  }

  async onUnload() {
    console.log('[K-Health] 플러그인 언로드')
    for (const { event, handler } of this.eventSubscriptions) {
      EventBus.off(event, handler)
    }
  }

  async onUpdate(prevVersion) {
    console.log(`[K-Health] ${prevVersion} → ${this.metadata.version} 업데이트`)
  }
}
