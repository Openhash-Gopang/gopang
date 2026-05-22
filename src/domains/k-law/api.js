/**
 * @file api.js  (k-law)
 * @description K-Law Verification API 엔드포인트
 * 근거: GDC §14.5 법원 전용 Verification API
 *   POST /verify/signature      → 발신자 디지털 서명 검증
 *   GET  /evidence-report/{id}  → 증거 일관성 보고서
 *   GET  /openhash/verify/{hash} → OpenHash 해시 독립 검증
 *   POST /verify/ownership      → ZKP 소유권 검증 (0.01 GDC/회)
 */
import { verifySignature } from '../../pdv/keyManager.js'
import { verifyEvidencePackage, generateCourtSummary } from '../../pdv/evidencePackage.js'

export const apiEndpoints = {

  /** 발신자 서명 검증 */
  async analyze({ message, signature, pubKeyB64 }) {
    const valid = await verifySignature(message, signature, pubKeyB64)
    return { valid, endpoint: '/verify/signature', ts: new Date().toISOString() }
  },

  /** 증거 보고서 생성 */
  async report(evidencePackage) {
    const verified = await verifyEvidencePackage(evidencePackage)
    const summary  = generateCourtSummary(evidencePackage)
    return { verified, summary, endpoint: '/evidence-report' }
  },

  /** OpenHash 해시 독립 검증 */
  async verify({ hash, expectedMsgHash }) {
    // 실제: OpenHash 글로벌 체인 조회
    // 현재: 로컬 체인 스토어 조회
    const { getEntry } = await import('../../openhash/hashChain.js')
    const entry = getEntry(hash)
    return {
      found:    !!entry,
      layer:    entry?.layer ?? null,
      msgHash:  entry?.msgHash ?? null,
      matches:  entry?.msgHash === expectedMsgHash,
      endpoint: '/openhash/verify',
    }
  },
}
