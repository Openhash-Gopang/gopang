/// <reference path="../pb_data/types.d.ts" />
// 2026-08-15 신설 — GOV_TASK_SUBMIT_REQUEST 접수 확정(status:'accepted') 시
// gov-fee-lookup.js가 조회한 혼디 서비스 수수료를 추적한다. handleGovRelay의
// 기존 AI 사용량 과금(billGovCall, 매 메시지)과는 완전히 별개 채널이다 —
// 여기 청구되는 금액은 "정부 납부액"이 아니라 "혼디 서비스 수수료"(정부
// 기준액 × gdc_multiplier)다.
//
// status 흐름:
//   'charged'          — resolveGovFee 결과가 'OK'(확정 매칭)라 접수 즉시
//                         자동 청구됨.
//   'pending_approval'  — resolveGovFee 결과가 'NEEDS_APPROVAL'(BASELINE
//                         추정치 등). 사용자 명시 승인 전까지 청구 안 함.
//   'approved_charged'  — pending_approval 상태에서 사용자가 승인해
//                         POST /gov/task/fee-approve로 실제 청구까지 완료.
//   'charge_failed'     — 청구 시도했으나 GDC 잔액 부족 등으로 실패
//                         (행정 접수 자체는 이미 끝난 상태 — 별도 후속
//                         청구 재시도 여지를 남겨둔다).
// NOT_FOUND/null(요금 정보 없음/조회 자체 안 함)는 애초에 레코드를
//만들지 않는다 — 승인·청구할 대상 자체가 없으므로.
migrate((db) => {
  const collection = new Collection({
    "id": "gfc1charges01",
    "created": "2026-08-15 00:00:00.000Z",
    "updated": "2026-08-15 00:00:00.000Z",
    "name": "gov_fee_charges",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false, "id": "gfc1guid", "name": "user_guid", "type": "text",
        "required": true, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "gfc2agency", "name": "agency", "type": "text",
        "required": true, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "gfc3taskkey", "name": "task_key", "type": "text",
        "required": true, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "gfc4receipt", "name": "receipt_no", "type": "text",
        "required": true, "presentable": false, "unique": true,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "gfc5schedrec", "name": "gov_fee_schedule_id", "type": "text",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "gfc6govref", "name": "gov_reference_fee", "type": "number",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": 0, "max": null, "noDecimal": true }
      },
      {
        "system": false, "id": "gfc7hondifee", "name": "hondi_service_fee", "type": "number",
        "required": true, "presentable": false, "unique": false,
        "options": { "min": 0, "max": null, "noDecimal": true }
      },
      {
        "system": false, "id": "gfc8baseline", "name": "is_baseline_fallback", "type": "bool",
        "required": false, "presentable": false, "unique": false,
        "options": {}
      },
      {
        "system": false, "id": "gfc9status", "name": "status", "type": "select",
        "required": true, "presentable": false, "unique": false,
        "options": { "maxSelect": 1, "values": ["charged", "pending_approval", "approved_charged", "charge_failed"] }
      },
      {
        "system": false, "id": "gfc10createdat", "name": "created_at", "type": "date",
        "required": true, "presentable": false, "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false, "id": "gfc11chargedat", "name": "charged_at", "type": "date",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": "", "max": "" }
      }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX `idx_gov_fee_charges_receipt` ON `gov_fee_charges` (`receipt_no`)",
      "CREATE INDEX `idx_gov_fee_charges_guid_status` ON `gov_fee_charges` (`user_guid`, `status`)"
    ],
    "listRule": null,
    "viewRule": null,
    "createRule": null,
    "updateRule": null,
    "deleteRule": null,
    "options": {}
  });

  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("gfc1charges01");

  return dao.deleteCollection(collection);
})
