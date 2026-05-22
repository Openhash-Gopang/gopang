/**
 * @file risk-rules.js  (k-health)
 * @description K-Health 위험 판정 규칙
 */
export const riskRules = [
  { id:'MED-01', pattern:/무허가.*진료|무면허.*의사/,    score:0.92, desc:'무허가 의료행위', legalRef:'의료법 §27'       },
  { id:'MED-02', pattern:/처방전.*없이.*구매|불법.*의약품/, score:0.90, desc:'처방전 위조·불법 의약품', legalRef:'약사법 §23' },
  { id:'MED-03', pattern:/진료기록.*무단.*유출/,          score:0.78, desc:'의료 개인정보 침해', legalRef:'개인정보보호법 §23' },
]
