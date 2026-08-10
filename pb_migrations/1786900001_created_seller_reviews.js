/// <reference path="../pb_data/types.d.ts" />
// 2026-08-11 신설 — 고객 리뷰 대응 실기능(사업자 티어 미비기능 4/4).
// seller_products와 동일한 컨벤션(guid로 소유, 별도 인증 없는 공개 제출).
// reply_text/reply_at는 판매자가 대시보드에서 답글을 남기면 채워진다.
migrate((db) => {
  const collection = new Collection({
    "id": "sr8vw2kq7mplxyz",
    "created": "2026-08-11 00:00:00.000Z",
    "updated": "2026-08-11 00:00:00.000Z",
    "name": "seller_reviews",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false, "id": "sg1seller", "name": "seller_guid", "type": "text",
        "required": true, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "sg2product", "name": "product_id", "type": "text",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "sg3reviewer", "name": "reviewer_name", "type": "text",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": 40, "pattern": "" }
      },
      {
        "system": false, "id": "sg4rating", "name": "rating", "type": "number",
        "required": true, "presentable": false, "unique": false,
        "options": { "min": 1, "max": 5, "noDecimal": true }
      },
      {
        "system": false, "id": "sg5text", "name": "text", "type": "text",
        "required": true, "presentable": false, "unique": false,
        "options": { "min": 1, "max": 2000, "pattern": "" }
      },
      {
        "system": false, "id": "sg6reply", "name": "reply_text", "type": "text",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": 2000, "pattern": "" }
      },
      {
        "system": false, "id": "sg7replyat", "name": "reply_at", "type": "date",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false, "id": "sg8createdat", "name": "created_at", "type": "date",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": "", "max": "" }
      }
    ],
    "indexes": ["CREATE INDEX `idx_seller_reviews_guid` ON `seller_reviews` (`seller_guid`)"],
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
  const collection = dao.findCollectionByNameOrId("sr8vw2kq7mplxyz");

  return dao.deleteCollection(collection);
})
