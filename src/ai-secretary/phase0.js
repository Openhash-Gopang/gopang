/**
 * @file phase0.js
 * @description AI 비서 Phase 0 — 소통 객체 식별 (Q0.1~Q0.8)
 * @version 1.0.0
 * @author AI City Inc.
 *
 * 근거: KL-M-02 Phase 0
 *   - Q0.1~Q0.8 전체 누락 시 오류 반환
 *   - Q0.6 암호화 이상 → 즉시 S3
 *   - Q0.7 AI 신원 검증 실패 → 즉시 S3
 *   - Q0.8 30일 내 S2 이상 이력 → 가중치 1.3
 *   - 소통 주체: 사람↔사람, 사람↔기관AI, 사람↔사물(IoT)
 */

import { RISK, HISTORY } from '../core/constants.js'

// ── 소통 유형 ────────────────────────────────────────────────────────────
export const MSG_TYPE = Object.freeze({
  TEXT_SHORT:  'text_short',    // 단문 (1~3문장)
  TEXT_LONG:   'text_long',     // 장문 (4문장 이상)
  DOCUMENT:    'document',      // PDF·이미지·첨부 파일
  VOICE:       'voice',         // 음성 (STT 후 처리)
  MIXED:       'mixed',         // 텍스트+파일 혼합
})

export const SENDER_TYPE = Object.freeze({
  PERSON:    'person',          // 개인 사용자
  AGENT_AI:  'agent_ai',       // 기관 AI 에이전트
  EXTERNAL:  'external',       // 외부 서비스
  SYSTEM:    'system',         // 시스템 자동 메시지
})

export const CONTEXT_TYPE = Object.freeze({
  NEW:        'new',            // 신규 대화
  CONTINUING: 'continuing',    // 기존 대화 연속
  CONTRACT:   'contract',      // 계약·거래 협의
  COMPLAINT:  'complaint',     // 민원·행정 처리
  PERSONAL:   'personal',      // 개인정보 교환
  FINANCIAL:  'financial',     // 금전·이체 관련
  LEGAL:      'legal',         // 의료·법률 상담
  OTHER:      'other',
})

/**
 * Phase 0: 소통 객체 식별
 *
 * @param {Object} message
 * @param {string} message.content       - 메시지 내용
 * @param {string} message.senderId      - 발신자 ID
 * @param {string} message.receiverId    - 수신자 ID
 * @param {boolean} message.encrypted   - 암호화 상태
 * @param {Object} [message.attachment]  - 첨부 파일
 * @param {Object} context
 * @param {string} context.senderType   - SENDER_TYPE 중 하나
 * @param {string} context.receiverType
 * @param {string} context.contextType  - CONTEXT_TYPE 중 하나
 * @param {Array}  context.riskHistory  - 이전 위험 이력 [{level, date}]
 * @param {boolean} context.aiVerified  - AI 신원 검증 여부 (기관 AI 시)
 * @returns {{
 *   Q0: Object,
 *   historyWeight: number,
 *   immediateS3: boolean,
 *   msgType: string,
 *   hasAttachment: boolean
 * }}
 */
export function identifyCommObject(message, context) {
  _validateInputs(message, context)

  // Q0.1 소통 유형
  const Q0_1 = _detectMsgType(message)

  // Q0.2 발신자 유형
  const Q0_2 = context.senderType ?? SENDER_TYPE.PERSON

  // Q0.3 수신자 유형
  const Q0_3 = context.receiverType ?? SENDER_TYPE.PERSON

  // Q0.4 소통 맥락
  const Q0_4 = context.contextType ?? CONTEXT_TYPE.NEW

  // Q0.5 첨부 파일 여부
  const Q0_5 = !!(message.attachment)

  // Q0.6 암호화 상태 — 이상 시 즉시 S3
  const Q0_6 = message.encrypted !== false   // undefined도 정상으로 처리
  const encryptionAlert = !Q0_6

  // Q0.7 AI 신원 검증 (기관 AI 소통 시)
  const isAgentComm = Q0_2 === SENDER_TYPE.AGENT_AI || Q0_3 === SENDER_TYPE.AGENT_AI
  const Q0_7 = isAgentComm ? (context.aiVerified === true) : true
  const agentAlert = isAgentComm && !Q0_7

  // Q0.8 30일 내 S2 이상 이력 → 가중치 1.3
  const Q0_8 = _hasRecentHighRisk(context.riskHistory ?? [])
  const historyWeight = Q0_8 ? RISK.HISTORY_WEIGHT : 1.0

  // 즉시 S3 조건
  const immediateS3 = encryptionAlert || agentAlert

  return {
    Q0: { Q0_1, Q0_2, Q0_3, Q0_4, Q0_5, Q0_6, Q0_7, Q0_8 },
    historyWeight,
    immediateS3,
    immediateS3Reason: encryptionAlert ? 'ENCRYPTION_ABNORMAL'
                     : agentAlert      ? 'AGENT_IDENTITY_FAILED'
                     : null,
    msgType:       Q0_1,
    hasAttachment: Q0_5,
    isAgentComm,
  }
}

// ── Private ───────────────────────────────────────────────────────────────

function _validateInputs(message, context) {
  if (!message?.content && message?.content !== '') {
    throw new Error('[Phase0] message.content 필수')
  }
  if (!message.senderId) {
    throw new Error('[Phase0] message.senderId 필수')
  }
}

function _detectMsgType(message) {
  if (message.attachment && message.content) return MSG_TYPE.MIXED
  if (message.attachment) return MSG_TYPE.DOCUMENT
  if (message.voiceData)  return MSG_TYPE.VOICE

  const sentences = (message.content || '').split(/[.!?。]\s*/).filter(Boolean)
  return sentences.length <= 3 ? MSG_TYPE.TEXT_SHORT : MSG_TYPE.TEXT_LONG
}

function _hasRecentHighRisk(history) {
  const cutoff = Date.now() - HISTORY.RISK_LOOKBACK_DAYS * 86400 * 1000
  return history.some(h => {
    const d = new Date(h.date).getTime()
    return d >= cutoff && (h.level === 'S2' || h.level === 'S3')
  })
}
