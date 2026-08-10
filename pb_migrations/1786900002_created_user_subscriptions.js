/// <reference path="../pb_data/types.d.ts" />
// 2026-08-11 신설 — 구독 티어·월정기 결제 스케줄러의 공통 선결과제
// (지난 조사에서 확인: profiles 스키마에 tier/subscription 필드가
// 전혀 없었고, "이번 달 결제됐는지" 판정·GDC 잔액 정기 차감 로직도
// 없었음). seller_products/seller_reviews와 동일 컨벤션의 별도 컬렉션으로
// 분리 — profiles 자체를 건드리지 않아 기존 프로필 로직에 영향 없음.
migrate((db) => {
  const collection = new Collection({
    "id": "us9bt3wq5koplan",
    "created": "2026-08-11 00:00:00.000Z",
    "updated": "2026-08-11 00:00:00.000Z",
    "name": "user_subscriptions",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false, "id": "us1guid", "name": "user_guid", "type": "text",
        "required": true, "presentable": false, "unique": true,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "us2tier", "name": "tier", "type": "select",
        "required": true, "presentable": false, "unique": false,
        "options": { "maxSelect": 1, "values": ["citizen", "business", "student", "professional"] }
      },
      {
        "system": false, "id": "us3status", "name": "status", "type": "select",
        "required": true, "presentable": false, "unique": false,
        "options": { "maxSelect": 1, "values": ["active", "grace", "suspended", "cancelled"] }
      },
      {
        "system": false, "id": "us4amount", "name": "billing_amount_krw", "type": "number",
        "required": true, "presentable": false, "unique": false,
        "options": { "min": 0, "max": null, "noDecimal": true }
      },
      {
        "system": false, "id": "us5next", "name": "next_billing_at", "type": "date",
        "required": true, "presentable": false, "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false, "id": "us6last", "name": "last_billed_at", "type": "date",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false, "id": "us7result", "name": "last_billing_result", "type": "select",
        "required": false, "presentable": false, "unique": false,
        "options": { "maxSelect": 1, "values": ["success", "insufficient_balance", "error"] }
      },
      {
        "system": false, "id": "us8graceat", "name": "grace_started_at", "type": "date",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false, "id": "us9createdat", "name": "created_at", "type": "date",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": "", "max": "" }
      }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX `idx_user_subscriptions_guid` ON `user_subscriptions` (`user_guid`)",
      "CREATE INDEX `idx_user_subscriptions_next_billing` ON `user_subscriptions` (`next_billing_at`)"
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
  const collection = dao.findCollectionByNameOrId("us9bt3wq5koplan");

  return dao.deleteCollection(collection);
})
