/**
 * @file phase3.js
 * @description AI 비서 Phase 3 — 문서·파일 위법성 분석 (DOC-1~4)
 * @version 1.0.0
 * @author AI City Inc.
 *
 * 근거: KL-M-02 Phase 3 (Q0.5 = 파일 첨부 시에만 적용)
 *   - DOC-1: 계약서·약관 — 불공정 조항·면책·자동갱신 함정
 *   - DOC-2: 금융 문서 — OCR 불일치·금액 위변조
 *   - DOC-3: 신분증·공문서 — 발급기관 진위·변조 흔적
 *   - DOC-4: 기타 첨부 — 악성코드·피싱 링크
 *   - 처리 시간: 텍스트 A4 1p = 15ms / 복합 = 100ms
 */

export const DOC_TYPE = Object.freeze({
  CONTRACT:  'DOC-1',   // 계약서·약관
  FINANCIAL: 'DOC-2',  // 금융 문서
  ID:        'DOC-3',  // 신분증·공문서
  OTHER:     'DOC-4',  // 기타
})

/**
 * Phase 3: 문서·파일 위법성 분석
 * Q0.5 = false이면 호출하지 않음 (pipeline.js에서 처리)
 *
 * @param {Object} attachment
 * @param {string} attachment.name     - 파일명
 * @param {string} attachment.type     - MIME 타입
 * @param {string} [attachment.text]   - 추출된 텍스트 (OCR 결과)
 * @param {Object} legalResults        - Phase 2 결과 (맥락 참조용)
 * @returns {Promise<{
 *   docType:  string,
 *   p3Score:  number,
 *   flags:    string[],
 *   details:  Object[]
 * }>}
 */
export async function analyzePhase3(attachment, legalResults = {}) {
  if (!attachment) return { docType: null, p3Score: 0, flags: [], details: [] }

  const docType = _detectDocType(attachment)
  let result = { docType, p3Score: 0, flags: [], details: [] }

  switch (docType) {
    case DOC_TYPE.CONTRACT:  result = await _analyzeContract(attachment, result);  break
    case DOC_TYPE.FINANCIAL: result = await _analyzeFinancial(attachment, result); break
    case DOC_TYPE.ID:        result = await _analyzeID(attachment, result);        break
    default:                 result = await _analyzeOther(attachment, result);     break
  }

  return result
}

// ── Private ───────────────────────────────────────────────────────────────

function _detectDocType(attachment) {
  const name = (attachment.name ?? '').toLowerCase()
  const text = (attachment.text ?? '').toLowerCase()

  if (/계약|약관|동의서|합의서/.test(name + text)) return DOC_TYPE.CONTRACT
  if (/이체|차용|영수증|거래명세|확인서/.test(name + text)) return DOC_TYPE.FINANCIAL
  if (/주민등록|여권|면허증|공문|증명/.test(name + text)) return DOC_TYPE.ID
  return DOC_TYPE.OTHER
}

async function _analyzeContract(att, result) {
  const text = att.text ?? ''
  const flags = []
  let score = 0

  if (/면책.*모든|일체.*책임.*없/i.test(text))   { flags.push('DOC1-면책조항'); score = Math.max(score, 0.65) }
  if (/자동.*갱신|묵시적.*연장/i.test(text))      { flags.push('DOC1-자동갱신'); score = Math.max(score, 0.55) }
  if (/불공정|일방적.*변경|동의.*간주/i.test(text)) { flags.push('DOC1-불공정조항'); score = Math.max(score, 0.70) }

  return { ...result, p3Score: score, flags, details: flags.map(f => ({ flag: f, docType: DOC_TYPE.CONTRACT })) }
}

async function _analyzeFinancial(att, result) {
  const text = att.text ?? ''
  const flags = []
  let score = 0

  // 금액 불일치 패턴 (숫자가 2개 이상 다르게 표시)
  const amounts = text.match(/\d[\d,]+원/g) ?? []
  if (amounts.length >= 2 && new Set(amounts).size > 1) {
    flags.push('DOC2-금액불일치')
    score = Math.max(score, 0.75)
  }
  if (/수정|변경|덮어쓰/i.test(text)) { flags.push('DOC2-수정흔적'); score = Math.max(score, 0.70) }

  return { ...result, p3Score: score, flags, details: flags.map(f => ({ flag: f, docType: DOC_TYPE.FINANCIAL })) }
}

async function _analyzeID(att, result) {
  const text = att.text ?? ''
  const flags = []
  let score = 0

  if (!/[0-9]{6}-[0-9]{7}/.test(text) && /주민/.test(att.name ?? '')) {
    flags.push('DOC3-주민번호형식이상'); score = Math.max(score, 0.60)
  }
  if (/복사|사본|copy/i.test(text)) { flags.push('DOC3-사본여부확인필요'); score = Math.max(score, 0.40) }

  return { ...result, p3Score: score, flags, details: flags.map(f => ({ flag: f, docType: DOC_TYPE.ID })) }
}

async function _analyzeOther(att, result) {
  const text = (att.text ?? '') + (att.name ?? '')
  const flags = []
  let score = 0

  if (/http[s]?:\/\/[a-z0-9\-\.]+\.(xyz|top|click|tk)/i.test(text)) {
    flags.push('DOC4-의심URL'); score = Math.max(score, 0.80)
  }
  if (/\.exe|\.bat|\.scr|\.vbs/i.test(att.name ?? '')) {
    flags.push('DOC4-실행파일'); score = Math.max(score, 0.90)
  }

  return { ...result, p3Score: score, flags, details: flags.map(f => ({ flag: f, docType: DOC_TYPE.OTHER })) }
}
