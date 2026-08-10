/// <reference path="../pb_data/types.d.ts" />
// 2026-08-11 신설 — 사업자 티어 신규 항목(직원 업무 및 일정관리).
// staff_id는 biz_staff 레코드 ID를 문자열로 저장(느슨한 참조 — 다른
// 신규 컬렉션들과 동일하게 엄격한 FK 제약을 걸지 않는 MVP 컨벤션).
migrate((db) => {
  const collection = new Collection({
    "id": "bk3tg7ry1ns2def",
    "created": "2026-08-11 00:00:00.000Z",
    "updated": "2026-08-11 00:00:00.000Z",
    "name": "biz_staff_tasks",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "bk01guid", "name": "seller_guid", "type": "text", "required": true, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "bk02staffid", "name": "staff_id", "type": "text", "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "bk03title", "name": "title", "type": "text", "required": true, "presentable": false, "unique": false, "options": { "min": null, "max": 120, "pattern": "" } },
      { "system": false, "id": "bk04desc", "name": "description", "type": "text", "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": 1000, "pattern": "" } },
      { "system": false, "id": "bk05due", "name": "due_at", "type": "date", "required": false, "presentable": false, "unique": false, "options": { "min": "", "max": "" } },
      { "system": false, "id": "bk06status", "name": "status", "type": "select", "required": true, "presentable": false, "unique": false, "options": { "maxSelect": 1, "values": ["todo", "in_progress", "done"] } },
      { "system": false, "id": "bk07createdat", "name": "created_at", "type": "date", "required": false, "presentable": false, "unique": false, "options": { "min": "", "max": "" } }
    ],
    "indexes": ["CREATE INDEX `idx_biz_staff_tasks_guid` ON `biz_staff_tasks` (`seller_guid`)"],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("bk3tg7ry1ns2def");
  return dao.deleteCollection(collection);
})
