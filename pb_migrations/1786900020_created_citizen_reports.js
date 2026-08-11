/// <reference path="../pb_data/types.d.ts" />
// 2026-08-11 신설 — 시민 티어 미구현 항목(교통법규위반·바가지요금 등
// 안전신문고식 신고). Hondi는 실제 관공서 접수를 대행하지 않는다(법적
// 대리 소지) — 신고 내용을 구조화해 정리해줄 뿐, 실제 접수는 안전신문고
// 등 정식 채널로 안내한다(handleCitizenReportSubmit의 guidance 필드).
migrate((db) => {
  const collection = new Collection({
    "id": "cr20kq0tx4qv5mn",
    "created": "2026-08-11 00:00:00.000Z",
    "updated": "2026-08-11 00:00:00.000Z",
    "name": "citizen_reports",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "cr01guid", "name": "user_guid", "type": "text", "required": true, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "cr02category", "name": "category", "type": "select", "required": true, "presentable": false, "unique": false, "options": { "maxSelect": 1, "values": ["traffic_violation", "overcharging", "illegal_parking", "other"] } },
      { "system": false, "id": "cr03desc", "name": "description", "type": "text", "required": true, "presentable": false, "unique": false, "options": { "min": null, "max": 2000, "pattern": "" } },
      { "system": false, "id": "cr04loc", "name": "location_text", "type": "text", "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": 200, "pattern": "" } },
      { "system": false, "id": "cr05occurred", "name": "occurred_at", "type": "date", "required": false, "presentable": false, "unique": false, "options": { "min": "", "max": "" } },
      { "system": false, "id": "cr06createdat", "name": "created_at", "type": "date", "required": false, "presentable": false, "unique": false, "options": { "min": "", "max": "" } }
    ],
    "indexes": ["CREATE INDEX `idx_citizen_reports_guid` ON `citizen_reports` (`user_guid`)"],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("cr20kq0tx4qv5mn");
  return dao.deleteCollection(collection);
})
