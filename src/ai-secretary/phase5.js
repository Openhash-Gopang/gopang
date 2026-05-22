/**
 * @file phase5.js
 * @description AI 비서 Phase 5 — S0~S3 위험 등급 판정 + 처리 지시
 * @version 1.0.0
 * @author AI City Inc.
 *
 * 근거: KL-M-02 Phase 5.1
 *   - S0 (0.00~0.29): 안전 — 정상 전송
 *   - S1 (0.30~0.59): 주의 — 소프트 알림 후 전송
 *   - S2 (0.60~0.84): 경고 — 전송 보류 + 사용자 명시적 확인 요구
 *   - S3 (0.85~1.00): 긴급 차단 — 차단 + 관련 기관 연결 안내
 *   - 목표 응답 시간: 단문 0.81ms (KL-S-01 §5.2 실측)
 */

import { RISK } from '../core/constants.js'

export const RISK_LEVEL = Object.freeze({
  S0: 'S0', S1: 'S1', S2: 'S2', S3: 'S3',
})

export const ACTION = Object.freeze({
  PASS:             'PASS',              // S0: 정상 전송
  SOFT_WARN:        'SOFT_WARN',         // S1: 소프트 경고 후 전송
  HOLD_FOR_CONFIRM: 'HOLD_FOR_CONFIRM',  // S2: 보류 + 확인 요구
  BLOCK_AND_ALERT:  'BLOCK_AND_ALERT',   // S3: 차단 + 기관 안내
})

// S3 관련 기관 안내 목록
const S3_RESOURCES = Object.freeze([
  { name: '금융감독원 보이스피싱 신고', tel: '1332' },
  { name: '경찰청 사이버범죄 신고', url: 'https://ecrm.police.go.kr' },
  { name: '한국소비자원', tel: '1372' },
])

/**
 * Phase 5: 위험 등급 판정
 *
 * @param {number}      finalScore    - Phase 4 최종 점수 (0~1)
 * @param {boolean}     immediateS3   - Phase 0 즉시 S3 여부
 * @param {string|null} immediateReason
 * @param {Object}      domainResults - Phase 2 도메인별 플래그
 * @returns {{
 *   level:     string,
 *   action:    string,
 *   score:     number,
 *   legalFlags: string[],
 *   message:   string,
 *   resources: Array|null
 * }}
 */
export function classifyRisk(finalScore, immediateS3 = false, immediateReason = null, domainResults = {}) {
  // Phase 0에서 즉시 S3 조건
  if (immediateS3) {
    return _buildResult('S3', finalScore, domainResults, immediateReason)
  }

  if (finalScore >= RISK.S2_MAX) return _buildResult('S3', finalScore, domainResults)
  if (finalScore >= RISK.S1_MAX) return _buildResult('S2', finalScore, domainResults)
  if (finalScore >= RISK.S0_MAX) return _buildResult('S1', finalScore, domainResults)
  return _buildResult('S0', finalScore, domainResults)
}

// ── Private ───────────────────────────────────────────────────────────────

function _buildResult(level, score, domainResults, reason = null) {
  const legalFlags = _collectFlags(domainResults)

  const messages = {
    S0: '안전한 메시지입니다.',
    S1: '일부 주의가 필요한 표현이 감지되었습니다. 확인 후 전송하세요.',
    S2: '위법 가능성이 있는 내용이 감지되었습니다. 전송 전 검토가 필요합니다.',
    S3: reason === 'ENCRYPTION_ABNORMAL' ? '암호화 이상이 감지되어 전송이 차단되었습니다.'
      : reason === 'AGENT_IDENTITY_FAILED' ? '기관 AI 신원 검증 실패로 차단되었습니다.'
      : '고위험 내용이 감지되어 전송이 차단되었습니다. 관련 기관에 신고하세요.',
  }

  return {
    level,
    action:    ACTION[{ S0:'PASS', S1:'SOFT_WARN', S2:'HOLD_FOR_CONFIRM', S3:'BLOCK_AND_ALERT' }[level]],
    score:     parseFloat(score.toFixed(4)),
    legalFlags,
    message:   messages[level],
    resources: level === 'S3' ? S3_RESOURCES : null,
    reason,
  }
}

function _collectFlags(domainResults) {
  const flags = []
  for (const result of Object.values(domainResults)) {
    if (Array.isArray(result?.flags)) flags.push(...result.flags)
  }
  return [...new Set(flags)]
}
