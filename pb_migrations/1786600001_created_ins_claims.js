/// <reference path="../pb_data/types.d.ts" />
// ── 2026-07-18 신설 — K-Insurance 청구 접수(handleInsClaimCreate/List).
// HONDI_GAP_REMEDIATION_DIRECTIVE v1.0 §2.1 참고. insurance/js/ins-core.js 등
// 죽은 코드 클러스터(Supabase placeholder 의존, 자동 심사/사기탐지/자동지급)는
// 완전히 폐기하고 "접수 → 사람이 확인 → 수동 상태 변경"만 담는다.
// listRule/updateRule은 다른 L1 컬렉션(ai_sessions, gdc_deposits 등)과
// 동일하게 null(서버 관리자 토큰 경유만 허용) — 사용자별 필터링은
// worker.js의 handleInsClaimsList가 서명 인증 후 직접 수행한다.
migrate((db) => {
  const collection = new Collection({
    "id": "etgfp37c8xjtflm",
    "created": "2026-07-18 07:37:47.000Z",
    "updated": "2026-07-18 07:37:47.000Z",
    "name": "ins_claims",
    "type": "base",
    "system": false,
    "schema": [
        { "system": false, "id": "oghaz2tk7qpeog4", "name": "claim_id",       "type": "text",   "required": true,  "presentable": true,  "unique": true,  "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "he8y128g29ts4jg", "name": "user_guid",      "type": "text",   "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "ym3e21owl0350ny", "name": "insurance_type", "type": "text",   "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "7egop1f59r4y7fq", "name": "amount",         "type": "number", "required": true,  "presentable": true,  "unique": false, "options": { "min": 0, "max": null, "noDecimal": false } },
        { "system": false, "id": "cxj0krz5zuj0ea8", "name": "note",           "type": "text",   "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "gvq8qc1vlugxbjw", "name": "status",         "type": "select", "required": true,  "presentable": true,  "unique": false, "options": { "maxSelect": 1, "values": ["접수", "심사중", "승인", "거부", "지급완료"] } }
    ],
    "indexes": [
        "CREATE UNIQUE INDEX idx_ins_claims_claim_id ON ins_claims (claim_id)",
        "CREATE INDEX idx_ins_claims_user_guid ON ins_claims (user_guid)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
});
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("etgfp37c8xjtflm");
  return dao.deleteCollection(collection);
})
