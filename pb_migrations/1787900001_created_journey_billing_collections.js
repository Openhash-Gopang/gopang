/// <reference path="../pb_data/types.d.ts" />
// 2026-08-13 신설 — 혼디 "실행대행(여러 기관을 조율하는 하나의 여정)"
// 정액과금을 위한 컬렉션 2개.
//
// 정책 결정(주피터, 2026-08-13):
//   - 여정 단위 1회성 정액(개별 기관 호출을 따로 과금하지 않음)
//   - 수행 전 승인 → 수행 후(완료 시) 차감(선승인·후불제)
//   - 완료 전 중단 시 완전 무과금
//   - 복잡도는 2단계 판정: journey_type_key로 캐시 조회 → 미스 시 LLM
//     4축 평가(관여 백엔드 연동 수·소요기간·법적절차·서류유형 가변축은
//     접수 확정 시 재확인) 후 캐시 저장, 완료 시마다 추정-실측 편차를
//     누적해 드리프트 감지
migrate((db) => {
  const dao = new Dao(db);

  const journeyCharges = new Collection({
    id: 'jny0000charges0',
    created: '2026-08-13 00:00:00.000Z', updated: '2026-08-13 00:00:00.000Z',
    name: 'journey_charges', type: 'base', system: false,
    schema: [
      { system: false, id: 'jnyc0000001', name: 'guid', type: 'text',
        required: true, presentable: true, unique: false, options: {} },
      { system: false, id: 'jnyc0000002', name: 'journey_id', type: 'text',
        required: true, presentable: true, unique: false, options: {},
        description: '클라이언트 발급 여정 식별자(K-Law case_id와 동일 관례)' },
      { system: false, id: 'jnyc0000003', name: 'journey_type_key', type: 'text',
        required: true, presentable: true, unique: false, options: {},
        description: '정규화된 여정 유형 키(예: 개인파산_면책) — 캐시 조회 기준' },
      { system: false, id: 'jnyc0000004', name: 'quoted_tier', type: 'text',
        required: false, presentable: true, unique: false, options: {} },
      { system: false, id: 'jnyc0000005', name: 'quoted_fee_krw', type: 'number',
        required: false, presentable: true, unique: false, options: { min: 0 } },
      { system: false, id: 'jnyc0000006', name: 'status', type: 'select',
        required: true, presentable: true, unique: false,
        options: { maxSelect: 1, values: ['quoted', 'approved', 'completed'] },
        description: '완료 전 중단은 별도 상태 없음(무과금 정책상 quoted/approved에 영구 정지되어도 문제 없음)' },
      { system: false, id: 'jnyc0000007', name: 'approved_at', type: 'date',
        required: false, presentable: true, unique: false, options: { min: '', max: '' } },
      { system: false, id: 'jnyc0000008', name: 'actual_tier', type: 'text',
        required: false, presentable: true, unique: false, options: {} },
      { system: false, id: 'jnyc0000009', name: 'actual_fee_krw', type: 'number',
        required: false, presentable: true, unique: false, options: { min: 0 } },
      { system: false, id: 'jnyc0000010', name: 'charged_at', type: 'date',
        required: false, presentable: true, unique: false, options: { min: '', max: '' },
        description: '실제 GDC 차감(_chargeGdcForAiUsage) 시각 — completed_at과 동시에 기록' },
      { system: false, id: 'jnyc0000011', name: 'completed_at', type: 'date',
        required: false, presentable: true, unique: false, options: { min: '', max: '' } },
      { system: false, id: 'jnyc0000012', name: 'mint_content_hash', type: 'text',
        required: false, presentable: false, unique: false, options: {} },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_journey_charges_guid_journey ON journey_charges (guid, journey_id)',
      'CREATE INDEX idx_journey_charges_type_key ON journey_charges (journey_type_key)',
      'CREATE INDEX idx_journey_charges_created ON journey_charges (created)',
    ],
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    options: {},
  });
  dao.saveCollection(journeyCharges);

  const complexityCache = new Collection({
    id: 'jny0000cplxcache',
    created: '2026-08-13 00:00:00.000Z', updated: '2026-08-13 00:00:00.000Z',
    name: 'journey_complexity_cache', type: 'base', system: false,
    schema: [
      { system: false, id: 'jnycc000001', name: 'journey_type_key', type: 'text',
        required: true, presentable: true, unique: true, options: {} },
      { system: false, id: 'jnycc000002', name: 'axis_agencies', type: 'number',
        required: false, presentable: true, unique: false, options: { min: 0, max: 3 },
        description: '혼디 백엔드 연동 호출 수 기준(사용자 체감 기관 수 아님)' },
      { system: false, id: 'jnycc000003', name: 'axis_duration', type: 'number',
        required: false, presentable: true, unique: false, options: { min: 0, max: 3 } },
      { system: false, id: 'jnycc000004', name: 'axis_legal_process', type: 'number',
        required: false, presentable: true, unique: false, options: { min: 0, max: 2 } },
      { system: false, id: 'jnycc000005', name: 'axis_doc_types', type: 'number',
        required: false, presentable: true, unique: false, options: { min: 0, max: 2 },
        description: '가변축 — 캐시값은 기본 후보일 뿐, 접수 확정 시 재확인해 ±1티어 조정 가능' },
      { system: false, id: 'jnycc000006', name: 'complexity_score', type: 'number',
        required: true, presentable: true, unique: false, options: { min: 0, max: 10 } },
      { system: false, id: 'jnycc000007', name: 'tier', type: 'text',
        required: true, presentable: true, unique: false, options: {} },
      { system: false, id: 'jnycc000008', name: 'scope_boundary', type: 'text',
        required: false, presentable: true, unique: false, options: {},
        description: '혼디 대행 범위의 명시적 종료 조건(예: "신청서 접수 확인까지") — 비어있으면 캐시 등록 보류 대상' },
      { system: false, id: 'jnycc000009', name: 'sample_count', type: 'number',
        required: false, presentable: true, unique: false, options: { min: 0 } },
      { system: false, id: 'jnycc000010', name: 'drift_accum', type: 'number',
        required: false, presentable: false, unique: false, options: {},
        description: '추정-실측 편차 누적치 — 임계값 초과 시 캐시 무효화(재평가 트리거)' },
      { system: false, id: 'jnycc000011', name: 'last_verified_at', type: 'date',
        required: false, presentable: true, unique: false, options: { min: '', max: '' } },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_journey_cplx_type_key ON journey_complexity_cache (journey_type_key)',
    ],
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    options: {},
  });
  dao.saveCollection(complexityCache);
}, (db) => {
  const dao = new Dao(db);
  for (const name of ['journey_charges', 'journey_complexity_cache']) {
    try { dao.deleteCollection(dao.findCollectionByNameOrId(name)); } catch (e) {}
  }
})
