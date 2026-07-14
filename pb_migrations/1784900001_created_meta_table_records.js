/// <reference path="../pb_data/types.d.ts" />
// 2026-07-14 신설 — AGENCY-AC-COMMON_v1.3.md §6(META_TABLING)이 "백엔드
// 배선 필요"로 표시해둔 것을 실제로 배선한다. [META_TABLE_UPDATE] 태그가
// 쓰는 스키마를 그대로 컬렉션 필드로 옮겼다 — 원본(기관 볼트, AGY_VAULT_
// STORE)과는 별개 저장소(이 컬렉션은 집계·검색 전용, §6 원문 그대로).
migrate((db) => {
  const collection = new Collection({
    "id": "mtbl7q2k9m3xh020",
    "name": "meta_table_records",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "mtf001agency_id", "name": "agency_id", "type": "text", "required": true, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "mtf002category", "name": "category", "type": "text", "required": true, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "mtf003task_type", "name": "task_type", "type": "text", "required": false, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "mtf004dept_chain", "name": "dept_chain", "type": "json", "required": false, "presentable": false, "unique": false, "options": { "maxSize": 20000 } },
      { "system": false, "id": "mtf005outcome", "name": "outcome", "type": "select", "required": true, "presentable": true, "unique": false, "options": { "maxSelect": 1, "values": ["completed", "pending", "referred"] } },
      { "system": false, "id": "mtf006received_ts", "name": "received_ts", "type": "date", "required": true, "presentable": true, "unique": false, "options": {} },
      { "system": false, "id": "mtf007processing_started_ts", "name": "processing_started_ts", "type": "date", "required": false, "presentable": false, "unique": false, "options": {} },
      { "system": false, "id": "mtf008completed_ts", "name": "completed_ts", "type": "date", "required": false, "presentable": false, "unique": false, "options": {} },
      { "system": false, "id": "mtf009duration_seconds", "name": "duration_seconds", "type": "number", "required": false, "presentable": true, "unique": false, "options": { "min": null, "max": null, "noDecimal": true } }
    ],
    "indexes": [
      "CREATE INDEX idx_meta_table_agency_category ON meta_table_records (agency_id, category)",
      "CREATE INDEX idx_meta_table_received ON meta_table_records (received_ts)"
    ],
    "listRule": null,
    "viewRule": null,
    "createRule": null,
    "updateRule": null,
    "deleteRule": null
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("meta_table_records");
  return dao.deleteCollection(collection);
});
