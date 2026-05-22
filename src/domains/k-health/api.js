/**
 * @file api.js  (k-health)
 */
export const apiEndpoints = {
  async analyze({ message, senderType }) {
    return { analyzed: true, domain: 'k-health', senderType, ts: new Date().toISOString() }
  },
  async report(evidencePackage) {
    return { reported: true, domain: 'k-health', msgId: evidencePackage?.msgId }
  },
  async verify({ medFlag, legalRef }) {
    return { verified: true, medFlag, legalRef }
  },
}
