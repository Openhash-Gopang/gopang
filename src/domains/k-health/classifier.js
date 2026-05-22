/**
 * @file classifier.js  (k-health)
 * @description K-Health 의료 법령 분류기
 * @version 1.0.0
 * @author AI City Inc.
 *
 * 근거: 의료법·약사법·의료분쟁조정법·개인정보보호법(의료)
 *   MED-01: 무허가 의료행위 (의료법 §27)
 *   MED-02: 처방전 위조·불법 의약품 거래 (약사법 §23, §44)
 *   MED-03: 의료 개인정보 침해 (개인정보보호법 §23 민감정보)
 *   MED-04: 의료 광고 위반 (의료법 §56)
 *   MED-05: 의료 분쟁·과잉진료 (의료분쟁조정법)
 */

export const MEDICAL_CATEGORIES = Object.freeze({
  'MED-01': { name: '무허가 의료행위',   law: '의료법 §27',              severity: 0.92 },
  'MED-02': { name: '처방전 위조·불법 의약품', law: '약사법 §23·§44',    severity: 0.90 },
  'MED-03': { name: '의료 개인정보 침해', law: '개인정보보호법 §23',      severity: 0.78 },
  'MED-04': { name: '의료 광고 위반',     law: '의료법 §56',              severity: 0.62 },
  'MED-05': { name: '의료 분쟁·과잉진료', law: '의료분쟁조정법 §2',      severity: 0.70 },
})

const CLASSIFICATION_RULES = [
  { id:'MED-01', patterns:[
    /무허가.*진료|의사.*자격.*없이.*진료|면허.*없이.*시술/,
    /불법.*의료|무면허.*의사|돌팔이.*의사/,
    /의료기관.*아닌.*곳.*시술|비공인.*의료/,
  ]},
  { id:'MED-02', patterns:[
    /처방전.*없이.*구매|처방전.*위조|불법.*의약품/,
    /마약.*불법.*구매|향정신성.*밀거래|처방.*없이.*항생제/,
    /의약품.*밀수|불법.*판매.*약/,
  ]},
  { id:'MED-03', patterns:[
    /진료기록.*무단.*유출|병원.*개인정보.*팔|환자.*정보.*동의없이/,
    /의료.*개인정보.*침해|진단.*결과.*무단.*공개/,
    /병명.*동의없이.*공개|치료.*내역.*유출/,
  ]},
  { id:'MED-04', patterns:[
    /과장.*의료.*광고|허위.*치료효과|검증.*안된.*치료법.*광고/,
    /의료.*광고.*위반|거짓.*의료.*정보.*홍보/,
    /완치.*보장.*광고|100%.*치료.*광고/,
  ]},
  { id:'MED-05', patterns:[
    /과잉진료|불필요한.*검사.*강요|의료.*사고.*은폐/,
    /의료.*분쟁|의료진.*과실|수술.*부작용.*은폐/,
    /진료비.*부당청구|의료.*과실.*책임/,
  ]},
]

export const classifier = {

  async classify(suList) {
    const text    = suList.map(su => su.text ?? '').join(' ')
    const flags   = []
    const scores  = {}
    const details = []

    for (const rule of CLASSIFICATION_RULES) {
      for (const pattern of rule.patterns) {
        if (pattern.test(text)) {
          if (!flags.includes(rule.id)) {
            flags.push(rule.id)
            const cat = MEDICAL_CATEGORIES[rule.id]
            scores[rule.id] = cat.severity
            details.push({
              flag:     rule.id,
              name:     cat.name,
              law:      cat.law,
              severity: cat.severity,
              matched:  text.match(pattern)?.[0]?.slice(0, 30),
            })
          }
          break
        }
      }
    }

    return { flags, scores, details }
  },

  getFastPathTriggers() {
    return [
      { id:'KH-FP01', pattern:/처방전.*없이.*구매|처방전.*없이.*주세요/, score:0.92, desc:'처방전 없는 의약품 요청 (MED-02)' },
      { id:'KH-FP02', pattern:/의사.*자격.*없이.*진료|무면허.*의사/, score:0.95, desc:'무허가 의료행위 (MED-01)' },
      { id:'KH-FP03', pattern:/진료기록.*팔|환자.*정보.*팔/, score:0.88, desc:'의료 개인정보 거래 (MED-03)' },
    ]
  },
}
