/**
 * @file phase6.js
 * @description AI 비서 Phase 6 — PDV 기록 + OpenHash 앵커링
 * @version 1.0.0
 * @author AI City Inc.
 *
 * 근거: KL-M-02 Phase 6
 *   - 모든 소통 및 판정 결과를 PDV에 기록
 *   - OpenHash 앵커링 수행
 *   - 기록 항목: 소통 기록·AI 비서 경고 이력·Fast-Path 결과·문서 분석·점수 상세
 */

import { sha256 } from '../pdv/keyManager.js'
import { anchor } from '../openhash/hashChain.js'

/**
 * Phase 6: PDV 기록 + OpenHash 앵커링
 *
 * @param {Object} message         - 원본 메시지
 * @param {Object} riskResult      - Phase 5 판정 결과
 * @param {Object} phaseScores     - { p1, p2, p3, ws, final }
 * @param {Object} [docAnalysis]   - Phase 3 결과
 * @param {Object|null} [fastPath] - Fast-Path 트리거 결과
 * @returns {Promise<{ msgId: string, anchorHash: string, record: Object }>}
 */
export async function recordAndAnchor(message, riskResult, phaseScores, docAnalysis = null, fastPath = null) {
  const timestamp = new Date().toISOString()

  // msgId 생성: SHA256(content + timestamp + senderId)
  const msgId = await sha256(
    (message.content ?? '') + timestamp + (message.senderId ?? 'unknown')
  )

  // AI 비서 경고 이력 구성
  const aiWarningLog = []
  if (riskResult.level !== 'S0') {
    aiWarningLog.push({
      phase:       riskResult.level === 'S3' && fastPath ? 'Phase1-FastPath' : 'Phase4-WS',
      level:       riskResult.level,
      score:       riskResult.score,
      legalFlags:  riskResult.legalFlags,
      message:     riskResult.message,
      ts:          timestamp,
    })
  }

  // PDV 레코드 구성 (KL-S-01 §3.3 전체 저장 항목)
  const record = {
    msgId,
    content:         message.content ?? '',
    senderId:        message.senderId ?? 'unknown',
    senderPubKeyB64: message.senderPubKeyB64 ?? '',
    signature:       message.signature ?? '',
    timestamp,
    openHashRef:     null,      // 앵커링 후 채움
    riskLevel:       riskResult.level,
    riskScore:       riskResult.score,
    legalFlags:      riskResult.legalFlags ?? [],
    phaseLog: {
      p1: phaseScores.p1 ?? 0,
      p2: phaseScores.p2 ?? 0,
      p3: phaseScores.p3 ?? 0,
      ws: phaseScores.ws ?? 0,
      final: phaseScores.final ?? 0,
      fastPathTriggered: !!fastPath,
      fastPathId:        fastPath?.id ?? null,
    },
    aiWarningLog,
    tripleSign:  message.tripleSign ?? null,
    docAnalysis: docAnalysis ?? null,
  }

  // OpenHash 앵커링
  // BUG-FIX(2026-07-17): anchor()가 (contentHash, signatures[], msgId)를
  // 받는 신 API로 바뀐 뒤 이 파일이 갱신되지 않아, message.content(원문)를
  // 해시 없이 그대로 넘겨 매번 "[HashChain] contentHash는 SHA-256
  // hex(64자)여야 합니다" 예외로 실패했다(실사로 재현·확인 — evidencePackage.js
  // 와 동일한 드리프트). Phase 6은 모든 flagged 대화마다 실행되는 경로라
  // 영향 범위가 더 크다.
  const contentHash = await sha256(message.content ?? '')
  const anchored = await anchor(
    contentHash,
    [message.signature ?? 'no-sig'],
    msgId
  )

  record.openHashRef = anchored.entryHash

  // 실제 환경: vault.storeMessage(record) 호출
  // Node 테스트 환경: IndexedDB 미지원이므로 반환만 수행
  // (브라우저 통합 시 pipeline.js에서 vault.storeMessage 호출)

  return {
    msgId,
    anchorHash: anchored.entryHash,
    layer:      anchored.layer,
    record,
  }
}
