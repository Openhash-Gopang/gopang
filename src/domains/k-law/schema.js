/**
 * @file schema.js  (k-law)
 * @description K-Law 전용 데이터 스키마
 */
export const dataSchema = {
  messageRecord: {
    klawFlags:    { type:'string[]', default:[] },  // CR-1~5, CV-1~4 등
    courtRef:     { type:'string',   default:null }, // 법원 사건 번호
    escrowId:     { type:'string',   default:null }, // GDC 에스크로 ID
    legalAdvice:  { type:'string',   default:null }, // AI 법률 조언 요약
  },
  reportRecord: {
    verdict:      { type:'string' },  // 판결 예측 요약
    confidence:   { type:'number' },  // 0~1
    legalBasis:   { type:'string[]' },
    courtUrl:     { type:'string' },
  },
}
