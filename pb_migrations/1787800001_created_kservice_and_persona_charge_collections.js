/// <reference path="../pb_data/types.d.ts" />
// 2026-08-13 신설 — K-Law의 "건당 정액과금" 패턴(worker.js
// K_SERVICE_BILLING_REGISTRY)을 나머지 14개 K-서비스와 전문가 AI
// 페르소나(505개, 패밀리/카테고리 단위 11개 그룹으로 통합)로 확장.
//
// 정책 결정(주피터, 2026-08-13):
//   - K-Law의 klaw_case_charges는 그대로 유지(운영 데이터·필드명 보존).
//   - 나머지 K-서비스는 각자 전용 테이블.
//   - 505개 페르소나는 패밀리 단위(lawyer/physician/professor/accountant/
//     patent-attorney)로 5개, 나머지 표준화 안 된 core 항목은 기존
//     category 필드 기준으로 6개(core-law/core-fin/core-health/core-edu/
//     core-eng/core-misc)로 묶어 총 11개 그룹 테이블. 그룹 테이블은 여러
//     페르소나가 한 테이블을 공유하므로 persona_id 필드로 구분한다.
//
// 요금표(fee schedule)는 이 마이그레이션에서 정하지 않는다 — 스키마만
// 만들고, 실제 금액은 worker.js K_SERVICE_BILLING_REGISTRY에 각 서비스/
// 페르소나 담당자가 확정한 뒤 등록해야 한다(현재 전부 feeSchedule: null
// TODO 상태).
migrate((db) => {
  const dao = new Dao(db);

  // ── 공통 필드 셋 (klaw_case_charges와 동일 구조, 필드명만 범용화) ──
  function baseFields(idPrefix) {
    return [
      { system: false, id: `${idPrefix}01`, name: 'guid', type: 'text',
        required: true, presentable: true, unique: false,
        options: { min: null, max: null, pattern: '' } },
      { system: false, id: `${idPrefix}02`, name: 'unit_id', type: 'text',
        required: true, presentable: true, unique: false,
        options: { min: null, max: null, pattern: '' },
        description: '서비스별 처리 단위 식별자(K-Law의 case_id에 해당)' },
      { system: false, id: `${idPrefix}03`, name: 'unit_amount_krw', type: 'number',
        required: false, presentable: false, unique: false,
        options: { min: 0, max: null, noDecimal: false },
        description: 'K-Law의 claim_amount_krw에 해당 — 티어 산정 기준 금액(해당 없으면 미사용)' },
      { system: false, id: `${idPrefix}04`, name: 'fee_krw', type: 'number',
        required: false, presentable: true, unique: false,
        options: { min: 0, max: null, noDecimal: false } },
      { system: false, id: `${idPrefix}05`, name: 'fee_tier', type: 'text',
        required: false, presentable: true, unique: false,
        options: { min: null, max: null, pattern: '' } },
      { system: false, id: `${idPrefix}06`, name: 'regen_count', type: 'number',
        required: false, presentable: true, unique: false,
        options: { min: 1, max: null, noDecimal: true } },
      { system: false, id: `${idPrefix}07`, name: 'mint_content_hash', type: 'text',
        required: false, presentable: false, unique: false,
        options: { min: null, max: null, pattern: '' } },
      { system: false, id: `${idPrefix}08`, name: 'last_regen_at', type: 'date',
        required: false, presentable: false, unique: false, options: { min: '', max: '' } },
      { system: false, id: `${idPrefix}09`, name: 'completed_at', type: 'date',
        required: false, presentable: true, unique: false, options: { min: '', max: '' } },
      { system: false, id: `${idPrefix}10`, name: 'refunded_at', type: 'date',
        required: false, presentable: true, unique: false, options: { min: '', max: '' } },
    ];
  }

  function personaField(idPrefix) {
    return { system: false, id: `${idPrefix}11`, name: 'persona_id', type: 'text',
      required: true, presentable: true, unique: false,
      options: { min: null, max: null, pattern: '' },
      description: '이 그룹 테이블을 공유하는 개별 페르소나 키 (예: lawyer-criminal)' };
  }

  // ── 14개 K-서비스 (persona_id 없음, K-Law와 동일 구조) ──────────
  const kServices = [
    ['tax',        'tax_case_charges',        'ksv001'],
    ['health',     'health_case_charges',     'ksv002'],
    ['police',     'police_case_charges',     'ksv003'],
    ['emergency',  'e119_case_charges',       'ksv004'],
    ['democracy',  'democracy_case_charges',  'ksv005'],
    ['insurance',  'insurance_case_charges',  'ksv006'],
    ['traffic',    'traffic_case_charges',    'ksv007'],
    ['logistics',  'logistics_case_charges',  'ksv008'],
    ['public',     'public_case_charges',     'ksv009'],
    ['school',     'school_case_charges',     'ksv010'],
    ['market',     'market_case_charges',     'ksv011'],
    ['stock',      'stock_case_charges',      'ksv012'],
    ['cleaner',    'cleaner_case_charges',    'ksv013'],
    ['business',   'business_case_charges',   'ksv014'],
  ];

  // ── 11개 페르소나 그룹 (persona_id 있음) ──────────────────────
  const personaGroups = [
    ['lawyer',         'persona_lawyer_charges',         'psg001', 47],
    ['physician',      'persona_physician_charges',      'psg002', 24],
    ['professor',      'persona_professor_charges',      'psg003', 356],
    ['accountant',     'persona_accountant_charges',     'psg004', 10],
    ['patent-attorney','persona_patent_attorney_charges','psg005', 11],
    ['core-law',        'persona_core_law_charges',       'psg006', 5],
    ['core-fin',        'persona_core_fin_charges',       'psg007', 3],
    ['core-health',     'persona_core_health_charges',    'psg008', 19],
    ['core-edu',        'persona_core_edu_charges',       'psg009', 10],
    ['core-eng',        'persona_core_eng_charges',       'psg010', 13],
    ['core-misc',       'persona_core_misc_charges',      'psg011', 7],
  ];

  const created = [];

  for (const [, collName, idPrefix] of kServices) {
    const c = new Collection({
      id: `${idPrefix}chrg0000`, created: '2026-08-13 00:00:00.000Z', updated: '2026-08-13 00:00:00.000Z',
      name: collName, type: 'base', system: false,
      schema: baseFields(idPrefix),
      indexes: [
        `CREATE UNIQUE INDEX idx_${collName}_guid_unit ON ${collName} (guid, unit_id)`,
        `CREATE INDEX idx_${collName}_created ON ${collName} (created)`,
      ],
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      options: {},
    });
    dao.saveCollection(c);
    created.push(collName);
  }

  for (const [, collName, idPrefix] of personaGroups) {
    const fields = baseFields(idPrefix);
    fields.push(personaField(idPrefix));
    const c = new Collection({
      id: `${idPrefix}chrg0000`, created: '2026-08-13 00:00:00.000Z', updated: '2026-08-13 00:00:00.000Z',
      name: collName, type: 'base', system: false,
      schema: fields,
      indexes: [
        `CREATE UNIQUE INDEX idx_${collName}_guid_unit ON ${collName} (guid, unit_id)`,
        `CREATE INDEX idx_${collName}_persona ON ${collName} (persona_id)`,
        `CREATE INDEX idx_${collName}_created ON ${collName} (created)`,
      ],
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      options: {},
    });
    dao.saveCollection(c);
    created.push(collName);
  }

  console.log(`[migration] ${created.length}개 과금 컬렉션 생성 완료: ${created.join(', ')}`);
}, (db) => {
  const dao = new Dao(db);
  const names = [
    'tax_case_charges','health_case_charges','police_case_charges','e119_case_charges',
    'democracy_case_charges','insurance_case_charges','traffic_case_charges',
    'logistics_case_charges','public_case_charges','school_case_charges',
    'market_case_charges','stock_case_charges','cleaner_case_charges','business_case_charges',
    'persona_lawyer_charges','persona_physician_charges','persona_professor_charges',
    'persona_accountant_charges','persona_patent_attorney_charges','persona_core_law_charges',
    'persona_core_fin_charges','persona_core_health_charges','persona_core_edu_charges',
    'persona_core_eng_charges','persona_core_misc_charges',
  ];
  for (const name of names) {
    try {
      const c = dao.findCollectionByNameOrId(name);
      dao.deleteCollection(c);
    } catch (e) { /* 이미 없으면 무시 */ }
  }
})
