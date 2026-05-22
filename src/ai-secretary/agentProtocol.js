/**
 * @file agentProtocol.js
 * @description AI 간 협업 7단계 프로토콜 + 삼중 서명
 * @version 1.0.0
 * @author AI City Inc.
 *
 * 근거: KL-S-01 §3.4
 *   1. 연결 요청 및 신원 검증
 *   2. 권한 범위 협약 (Capability Negotiation)
 *   3. 업무 요청 전달
 *   4. 위법성 검증 (AI 비서 Phase 0~5 적용)
 *   5. 요청 처리 및 응답
 *   6. 삼중 서명 완성 (사용자AI + 기관AI + OpenHash 노드)
 *   7. PDV 기록 + OpenHash 앵커링
 *
 *   에스컬레이션: 3회 연속 실패·신원 검증 실패·권한 초과 → 사용자 보고 대기
 */

import { signMessage, createTripleSignature } from '../pdv/keyManager.js'
import { EventBus, EVENTS } from '../core/event-bus.js'

// ── 에스컬레이션 임계값 ───────────────────────────────────────────────────
const MAX_RETRIES = 3

/**
 * 기관 AI와의 협업 실행 (7단계)
 *
 * @param {Object} params
 * @param {Object} params.task              - 업무 요청 내용
 * @param {Object} params.institutionAgent  - 기관 AI 인터페이스 { id, pubKeyB64, process }
 * @param {Object} params.userKeys          - 사용자 키쌍 { privateKey, publicKeyB64 }
 * @param {Function} params.legalCheck      - Phase 0~5 위법성 검증 함수
 * @param {Function} params.recordFn        - Phase 6 기록 함수
 * @returns {Promise<{
 *   success: boolean,
 *   response: any,
 *   tripleSignature: Object|null,
 *   escalated: boolean,
 *   log: string[]
 * }>}
 */
export async function collaborate(params) {
  const { task, institutionAgent, userKeys, legalCheck, recordFn } = params
  const log = []
  let retries = 0

  while (retries < MAX_RETRIES) {
    try {
      // Step 1: 신원 검증
      log.push('Step1: 기관 AI 신원 검증')
      const verified = await _verifyAgentIdentity(institutionAgent)
      if (!verified) {
        log.push('Step1 실패: 신원 검증 실패 → 에스컬레이션')
        return _escalate('IDENTITY_FAILED', log)
      }

      // Step 2: 권한 범위 협약
      log.push('Step2: 권한 범위 협약')
      const capability = await _negotiateCapability(task, institutionAgent)
      if (!capability.allowed) {
        log.push(`Step2 실패: 권한 초과 → 에스컬레이션 (${capability.reason})`)
        return _escalate('CAPABILITY_EXCEEDED', log)
      }

      // Step 3: 업무 요청 전달
      log.push('Step3: 업무 요청 전달')
      const request = { ...task, capability, requestedAt: new Date().toISOString() }

      // Step 4: 위법성 검증 (Phase 0~5)
      log.push('Step4: 위법성 검증')
      const legalResult = await legalCheck({
        content:  JSON.stringify(request),
        senderId: institutionAgent.id,
        encrypted: true,
      })
      if (legalResult.level === 'S3') {
        log.push(`Step4 실패: S3 위법 감지 → 에스컬레이션`)
        return _escalate('LEGAL_VIOLATION', log)
      }

      // Step 5: 기관 AI 처리
      log.push('Step5: 기관 AI 처리')
      const response = await institutionAgent.process(request)

      // Step 6: 삼중 서명 완성
      log.push('Step6: 삼중 서명 생성')
      const responseStr  = JSON.stringify(response)
      const userSig      = await signMessage(responseStr, userKeys.privateKey)
      const agentSig     = await signMessage(responseStr, institutionAgent.signingKey)
      const tripleSign   = createTripleSignature(userSig, agentSig, 'pending-anchor')

      // Step 7: PDV 기록 + OpenHash 앵커링
      log.push('Step7: PDV 기록 + OpenHash 앵커링')
      const recorded = await recordFn({
        content:    responseStr,
        senderId:   institutionAgent.id,
        signature:  userSig,
        tripleSign,
      }, legalResult)

      log.push(`완료: anchorHash=${recorded.anchorHash.slice(0, 8)}...`)
      EventBus.emit(EVENTS.MSG_ANCHORED, { msgId: recorded.msgId }, 'agentProtocol')

      return {
        success:         true,
        response,
        tripleSignature: tripleSign,
        escalated:       false,
        log,
        recorded,
      }

    } catch (err) {
      retries++
      log.push(`오류 (시도 ${retries}/${MAX_RETRIES}): ${err.message}`)
      if (retries >= MAX_RETRIES) {
        return _escalate('MAX_RETRIES_EXCEEDED', log)
      }
    }
  }
}

// ── Private ───────────────────────────────────────────────────────────────

async function _verifyAgentIdentity(agent) {
  // 실제: 기관 AI 공개키 검증 + 인증서 확인
  return !!(agent?.id && agent?.pubKeyB64)
}

async function _negotiateCapability(task, agent) {
  // 실제: 기관 AI가 허용하는 권한 범위 확인
  const allowed = !!(agent?.allowedTasks?.includes(task.type) ?? true)
  return { allowed, reason: allowed ? null : `${task.type} 미허용` }
}

function _escalate(reason, log) {
  log.push(`⚠️  에스컬레이션: ${reason} → 사용자 보고 대기`)
  EventBus.emit(EVENTS.PLUGIN_ERROR, { pluginName: 'agentProtocol', event: reason }, 'agentProtocol')
  return { success: false, response: null, tripleSignature: null, escalated: true, reason, log }
}
