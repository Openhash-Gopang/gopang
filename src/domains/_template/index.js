/**
 * @file index.js  (_template)
 * @description 새 도메인 플러그인 템플릿
 * @version 1.0.0
 *
 * 새 도메인 추가 방법:
 *   1. src/domains/_template/ 전체 복사
 *   2. 폴더명을 도메인명으로 변경 (예: k-market)
 *   3. 아래 TODO 항목 수정
 *   4. src/app.js에 register() 한 줄 추가
 *   5. 테스트 실행: node src/tests/domains/k-market.test.js
 */

import { GopangDomainPlugin } from '../../core/plugin-interface.js'
import { EventBus, EVENTS } from '../../core/event-bus.js'
import { classifier } from './classifier.js'
import { riskRules } from './risk-rules.js'
import { uiComponents } from './ui.js'
import { apiEndpoints } from './api.js'
import { dataSchema } from './schema.js'

export default class TemplateDomainPlugin extends GopangDomainPlugin {

  // TODO: 아래 5개 항목 수정
  metadata = {
    name:         'k-template',          // ← 소문자·하이픈 (예: 'k-market')
    displayName:  'K-Template (설명)',   // ← UI 표시명
    version:      '1.0.0',
    description:  '도메인 설명을 입력하세요',
    icon:         '🏛️',                 // ← 이모지 변경
    author:       'AI City Inc.',
    legalDomains: ['법령1', '법령2'],    // ← 관할 법령 목록
  }

  legalClassifier = classifier
  riskRules        = riskRules
  uiComponents     = uiComponents
  apiEndpoints     = apiEndpoints
  dataSchema       = dataSchema

  // TODO: 필요한 이벤트 구독 추가
  eventSubscriptions = [
    // 예시:
    // {
    //   event:   EVENTS.MSG_RISK_ASSESSED,
    //   handler: (data) => { /* 처리 */ }
    // }
  ]

  async onLoad() {
    console.log(`[${this.metadata.name}] 플러그인 로드`)
    for (const { event, handler } of this.eventSubscriptions) {
      EventBus.on(event, handler, this.metadata.name)
    }
  }

  async onUnload() {
    console.log(`[${this.metadata.name}] 플러그인 언로드`)
  }

  async onUpdate(prevVersion) {
    console.log(`[${this.metadata.name}] ${prevVersion} → ${this.metadata.version} 업데이트`)
    // TODO: 버전 간 마이그레이션 로직 (필요 시)
  }
}
