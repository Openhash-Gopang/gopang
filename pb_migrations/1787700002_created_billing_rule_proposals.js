/// <reference path="../pb_data/types.d.ts" />
// 2026-08-13 신설 — 혼디 자율 과금 제안 시스템 §2: 제안·활성화·사후승인.
//
// billing_signal_events 표본이 임계치(BILLING_PROPOSAL_MIN_SAMPLE)를
// 넘으면 혼디가 이 컬렉션에 제안을 스스로 써넣고 **즉시 활성화**한다
// (status: 'active_pending_review') — 승인을 기다리지 않고 그 순간부터
// 새 배율이 적용된다. 관리자는 사후에 배치로 검토해 confirmed(영구화)
// 또는 rejected(그 규칙으로 청구된 모든 건 소급 환불 대상)로 바꾼다.
// price_multiplier는 항상 기존 K-서비스 가격 구조에서 보간되며, 상한
// (BILLING_PROPOSAL_MAX_MULTIPLIER)을 코드로 강제해 폭주를 막는다.
migrate((db) => {
  const collection = new Collection({
    "id": "blgprop001rul",
    "created": "2026-08-13 00:00:00.000Z",
    "updated": "2026-08-13 00:00:00.000Z",
    "name": "billing_rule_proposals",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false, "id": "blgprop00001", "name": "task_key", "type": "text",
        "required": true, "presentable": true, "unique": true,
        "options": { "min": null, "max": null, "pattern": "" },
        "description": "task_key당 활성 규칙은 하나뿐 — unique로 강제"
      },
      {
        "system": false, "id": "blgprop00002", "name": "status", "type": "select",
        "required": true, "presentable": true, "unique": false,
        "options": { "maxSelect": 1, "values": ["active_pending_review", "confirmed", "rejected"] }
      },
      {
        "system": false, "id": "blgprop00003", "name": "price_multiplier", "type": "number",
        "required": true, "presentable": true, "unique": false,
        "options": { "min": 0, "max": null, "noDecimal": false },
        "description": "기존 토큰과금(×BILLING_MULTIPLIER_DEFAULT) 위에 추가로 곱해지는 배율. 1.0=변경없음"
      },
      {
        "system": false, "id": "blgprop00004", "name": "based_on_service", "type": "text",
        "required": false, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" },
        "description": "이 배율을 보간해온 기존 K-서비스(예: klaw-flash, klaw-pro, default)"
      },
      {
        "system": false, "id": "blgprop00005", "name": "sample_size", "type": "number",
        "required": true, "presentable": true, "unique": false,
        "options": { "min": 0, "max": null, "noDecimal": true }
      },
      {
        "system": false, "id": "blgprop00006", "name": "reasoning", "type": "text",
        "required": false, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" },
        "description": "자동 생성된 짧은 판단 근거 — 관리자 사후검토용"
      },
      {
        "system": false, "id": "blgprop00007", "name": "reviewed_at", "type": "date",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false, "id": "blgprop00008", "name": "reviewed_by", "type": "text",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_billing_rule_proposals_task_key ON billing_rule_proposals (task_key)"
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
  const collection = dao.findCollectionByNameOrId("blgprop001rul");

  return dao.deleteCollection(collection);
})
