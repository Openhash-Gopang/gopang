/**
 * @file schema.js  (k-health)
 * @description K-Health 전용 데이터 스키마
 */
export const dataSchema = {
  messageRecord: {
    medFlags:       { type:'string[]', default:[] },
    medicalRef:     { type:'string',   default:null },
    patientConsent: { type:'boolean',  default:null },
  },
  reportRecord: {
    medViolation: { type:'string' },
    severity:     { type:'number' },
    legalBasis:   { type:'string[]' },
  },
}
