/// <reference path="../pb_data/types.d.ts" />
// 2026-08-11 신설 — 사업자 티어 신규 항목(공급망관리). seller_products와
// 동일 컨벤션. 재고관리(JIT) 재주문 제안이 이 컬렉션의 lead_time_days를
// 참고한다(엄격한 외래키 아님 — product_category 문자열 매칭).
migrate((db) => {
  const collection = new Collection({
    "id": "bs1sp5pw9nq0xyz",
    "created": "2026-08-11 00:00:00.000Z",
    "updated": "2026-08-11 00:00:00.000Z",
    "name": "biz_suppliers",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "bs01guid", "name": "seller_guid", "type": "text", "required": true, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "bs02name", "name": "name", "type": "text", "required": true, "presentable": false, "unique": false, "options": { "min": null, "max": 100, "pattern": "" } },
      { "system": false, "id": "bs03category", "name": "product_category", "type": "text", "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "bs04contact", "name": "contact", "type": "text", "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "bs05lead", "name": "lead_time_days", "type": "number", "required": false, "presentable": false, "unique": false, "options": { "min": 0, "max": null, "noDecimal": true } },
      { "system": false, "id": "bs06notes", "name": "notes", "type": "text", "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": 1000, "pattern": "" } },
      { "system": false, "id": "bs07createdat", "name": "created_at", "type": "date", "required": false, "presentable": false, "unique": false, "options": { "min": "", "max": "" } }
    ],
    "indexes": ["CREATE INDEX `idx_biz_suppliers_guid` ON `biz_suppliers` (`seller_guid`)"],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("bs1sp5pw9nq0xyz");
  return dao.deleteCollection(collection);
})
