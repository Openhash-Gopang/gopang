/**
 * @file risk-rules.js  (k-law)
 * @description K-Law 위험 판정 규칙 목록
 */
export const riskRules = [
  { id:'CR-1', pattern:/편취|기망|사기/, score:0.85, desc:'사기죄 의심', legalRef:'형법 §347' },
  { id:'CR-2', pattern:/협박|공갈/,      score:0.88, desc:'협박·공갈',   legalRef:'형법 §283' },
  { id:'CR-3', pattern:/금감원.*직원|수사관입니다/, score:0.95, desc:'보이스피싱', legalRef:'전기통신금융사기법' },
  { id:'CV-2', pattern:/보증금.*반환.*거부|전세.*사기/, score:0.72, desc:'임대차 위법', legalRef:'주택임대차보호법' },
  { id:'LB-1', pattern:/직장.*괴롭힘|갑질/, score:0.78, desc:'직장내 괴롭힘', legalRef:'근로기준법 §76조의2' },
]
