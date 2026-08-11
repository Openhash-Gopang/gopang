/// <reference path="../pb_data/types.d.ts" />
// 2026-08-11 신설 — 시민 티어 미구현 항목(일정 관리/캘린더). 대응 서비스가
// 전혀 없던 완전 신규 영역 — biz_staff_tasks와 동일 컨벤션이지만
// seller_guid가 아니라 모든 가입자가 쓰는 user_guid 기준.
// (파일 번호 1786900018로 재배정 — 원래 1786900006이었으나 다른 세션이
// 같은 번호로 match_demands 컬렉션을 먼저 병합해 충돌 방지차 재번호.)
migrate((db) => {
  const collection = new Collection({
    "id": "cs18hn8rz2ot3gh",
    "created": "2026-08-11 00:00:00.000Z",
    "updated": "2026-08-11 00:00:00.000Z",
    "name": "citizen_schedule",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "cs01guid", "name": "user_guid", "type": "text", "required": true, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "cs02title", "name": "title", "type": "text", "required": true, "presentable": false, "unique": false, "options": { "min": null, "max": 120, "pattern": "" } },
      { "system": false, "id": "cs03desc", "name": "description", "type": "text", "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": 1000, "pattern": "" } },
      { "system": false, "id": "cs04sched", "name": "scheduled_at", "type": "date", "required": true, "presentable": false, "unique": false, "options": { "min": "", "max": "" } },
      { "system": false, "id": "cs05status", "name": "status", "type": "select", "required": true, "presentable": false, "unique": false, "options": { "maxSelect": 1, "values": ["upcoming", "done", "cancelled"] } },
      { "system": false, "id": "cs06createdat", "name": "created_at", "type": "date", "required": false, "presentable": false, "unique": false, "options": { "min": "", "max": "" } }
    ],
    "indexes": [
      "CREATE INDEX `idx_citizen_schedule_guid` ON `citizen_schedule` (`user_guid`)",
      "CREATE INDEX `idx_citizen_schedule_time` ON `citizen_schedule` (`scheduled_at`)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("cs18hn8rz2ot3gh");
  return dao.deleteCollection(collection);
})
