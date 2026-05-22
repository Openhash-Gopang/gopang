/**
 * @file classifier.js  (k-law)
 * @description K-Law 법령 분류기
 * @version 1.0.0
 * @author AI City Inc.
 *
 * 근거: KL-M-02 Phase 2
 *   형사: CR-1(사기) CR-2(협박·공갈) CR-3(보이스피싱) CR-4(다단계) CR-5(명예훼손)
 *   민사: CV-1(불공정계약) CV-2(임대차) CV-3(금전) CV-4(개인정보)
 *   노동: LB-1(직장내괴롭힘) LB-2(성희롱)
 *   소비자: CC-1(허위광고) CC-2(거래강제)
 */

// ── 법령 카테고리 정의 ─────────────────────────────────────────────────────
export const LEGAL_CATEGORIES = Object.freeze({
  // 형사 (Criminal)
  'CR-1': { name: '사기',         law: '형법 §347',          severity: 0.85 },
  'CR-2': { name: '협박·공갈',    law: '형법 §283·350',      severity: 0.88 },
  'CR-3': { name: '보이스피싱',   law: '전기통신금융사기법',  severity: 0.95 },
  'CR-4': { name: '다단계·유사수신', law: '방문판매법·유사수신규제법', severity: 0.82 },
  'CR-5': { name: '명예훼손',     law: '형법 §307·309',      severity: 0.70 },

  // 민사 (Civil)
  'CV-1': { name: '불공정계약',   law: '약관규제법 §6',      severity: 0.65 },
  'CV-2': { name: '임대차 위법',  law: '주택임대차보호법',   severity: 0.72 },
  'CV-3': { name: '금전 위법',    law: '이자제한법·대부업법', severity: 0.68 },
  'CV-4': { name: '개인정보 침해', law: '개인정보보호법 §23', severity: 0.75 },

  // 노동 (Labor)
  'LB-1': { name: '직장내 괴롭힘', law: '근로기준법 §76조의2', severity: 0.78 },
  'LB-2': { name: '성희롱',       law: '남녀고용평등법 §12',  severity: 0.82 },

  // 소비자 (Consumer)
  'CC-1': { name: '허위·과장 광고', law: '표시광고법 §3',    severity: 0.60 },
  'CC-2': { name: '거래 강제',    law: '공정거래법 §23',     severity: 0.65 },
})

// ── 분류 패턴 ─────────────────────────────────────────────────────────────
const CLASSIFICATION_RULES = [
  // CR-1: 사기
  { id:'CR-1', patterns: [/편취|기망|속여서|거짓말로.*돈|사기.*쳐/, /원금보장.*투자|수익률.*보장/, /선입금.*환불|결제.*먹튀/] },

  // CR-2: 협박·공갈
  { id:'CR-2', patterns: [/협박|공갈|안\s*하면.*신고|폭로하겠|해코지/, /돈.*안\s*주면|빚.*독촉.*협박/] },

  // CR-3: 보이스피싱
  { id:'CR-3', patterns: [/금감원|검찰|경찰.*직원|수사관입니다/, /계좌.*이체.*긴급|자금.*묶여|범죄.*연루/, /보이스피싱|전화금융사기/] },

  // CR-4: 다단계·유사수신
  { id:'CR-4', patterns: [/다단계|피라미드|회원.*모집.*수당/, /유사수신|원금보장.*투자.*모집/, /MLM|네트워크마케팅.*수당/] },

  // CR-5: 명예훼손
  { id:'CR-5', patterns: [/허위사실.*유포|명예훼손|공개.*망신/, /SNS.*올리겠|인터넷.*퍼뜨리겠/] },

  // CV-1: 불공정계약
  { id:'CV-1', patterns: [/일방적.*변경|면책.*모든|불공정.*조항/, /동의.*간주|자동갱신.*고지없이/] },

  // CV-2: 임대차
  { id:'CV-2', patterns: [/보증금.*반환.*거부|전세.*사기|임대차.*위반/, /퇴거.*요구.*불법|임대인.*계약위반/, /전월세.*분쟁|보증금.*돌려/] },

  // CV-3: 금전
  { id:'CV-3', patterns: [/이자.*법정이율.*초과|불법대출|사채/, /변제.*거부|채무.*부인|돈.*안갚/, /법정이자.*초과|고금리.*불법/] },

  // CV-4: 개인정보
  { id:'CV-4', patterns: [/개인정보.*무단|주민번호.*요구|동의없이.*수집/, /개인정보.*팔|정보.*유출|무단.*제공/] },

  // LB-1: 직장내 괴롭힘
  { id:'LB-1', patterns: [/직장.*괴롭힘|갑질|상사.*폭언/, /업무.*과다.*강요|따돌림.*직장|모욕.*상사/] },

  // LB-2: 성희롱
  { id:'LB-2', patterns: [/성희롱|성적.*발언|성적.*농담/, /신체.*접촉.*불쾌|성적.*불쾌감/] },

  // CC-1: 허위광고
  { id:'CC-1', patterns: [/허위.*광고|과장.*광고|거짓.*홍보/, /효능.*과장|인증.*위조.*광고/] },

  // CC-2: 거래강제
  { id:'CC-2', patterns: [/끼워팔기|강제.*구매|거래.*강요/, /거절.*못하게|묶음.*판매.*강요/] },
]

// ── 분류기 ────────────────────────────────────────────────────────────────
export const classifier = {

  /**
   * SU 목록을 받아 K-Law 법령 플래그와 점수를 반환
   * @param {Array} suList - Phase 1 SU 목록
   * @returns {{ flags: string[], scores: Object, details: Object[] }}
   */
  async classify(suList) {
    const text   = suList.map(su => su.text ?? '').join(' ')
    const flags  = []
    const scores = {}
    const details = []

    for (const rule of CLASSIFICATION_RULES) {
      for (const pattern of rule.patterns) {
        if (pattern.test(text)) {
          if (!flags.includes(rule.id)) {
            flags.push(rule.id)
            const cat = LEGAL_CATEGORIES[rule.id]
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

  /**
   * K-Law Fast-Path 트리거 목록
   * KL-M-02 §1.2 기준
   */
  getFastPathTriggers() {
    return [
      { id:'KL-FP01', pattern:/금감원|검찰청|경찰청.*직원|수사관입니다/, score:0.95, desc:'기관 사칭 (CR-3)' },
      { id:'KL-FP02', pattern:/계좌번호.*지금당장|즉시.*이체.*요청/,    score:0.90, desc:'긴급 송금 유도 (CR-3)' },
      { id:'KL-FP03', pattern:/보이스피싱|전화금융사기/,                 score:0.88, desc:'보이스피싱 키워드 (CR-3)' },
      { id:'KL-FP04', pattern:/협박.*안\s*하면|폭로하겠.*돈/,           score:0.90, desc:'공갈협박 (CR-2)' },
      { id:'KL-FP05', pattern:/전세사기|보증금.*편취/,                   score:0.88, desc:'전세 사기 (CV-2·CR-1)' },
    ]
  },
}
