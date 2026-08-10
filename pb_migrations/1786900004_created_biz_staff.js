/// <reference path="../pb_data/types.d.ts" />
// 2026-08-11 신설 — 사업자 티어 신규 항목(인사관리+채용관리 통합).
// record_type으로 재직자/지원자를 한 컬렉션에서 관리 — 지원자가
// 채용되면 record_type만 candidate→employee로 바꾸면 되도록 설계
// (별도 테이블 간 데이터 이전 없이 이력 연속성 유지).
migrate((db) => {
  const collection = new Collection({
    "id": "bt2sf6qx0mr1abc",
    "created": "2026-08-11 00:00:00.000Z",
    "updated": "2026-08-11 00:00:00.000Z",
    "name": "biz_staff",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "bt01guid", "name": "seller_guid", "type": "text", "required": true, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "bt02type", "name": "record_type", "type": "select", "required": true, "presentable": false, "unique": false, "options": { "maxSelect": 1, "values": ["candidate", "employee"] } },
      { "system": false, "id": "bt03name", "name": "name", "type": "text", "required": true, "presentable": false, "unique": false, "options": { "min": null, "max": 60, "pattern": "" } },
      { "system": false, "id": "bt04contact", "name": "contact", "type": "text", "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "bt05role", "name": "role", "type": "text", "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": 60, "pattern": "" } },
      { "system": false, "id": "bt06status", "name": "status", "type": "select", "required": true, "presentable": false, "unique": false, "options": { "maxSelect": 1, "values": ["applied", "interview", "hired", "rejected", "active", "on_leave", "terminated"] } },
      { "system": false, "id": "bt07wage", "name": "hourly_wage_krw", "type": "number", "required": false, "presentable": false, "unique": false, "options": { "min": 0, "max": null, "noDecimal": true } },
      { "system": false, "id": "bt08notes", "name": "notes", "type": "text", "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": 1000, "pattern": "" } },
      { "system": false, "id": "bt09createdat", "name": "created_at", "type": "date", "required": false, "presentable": false, "unique": false, "options": { "min": "", "max": "" } }
    ],
    "indexes": ["CREATE INDEX `idx_biz_staff_guid` ON `biz_staff` (`seller_guid`)"],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("bt2sf6qx0mr1abc");
  return dao.deleteCollection(collection);
})
