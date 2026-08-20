/// <reference path="../pb_data/types.d.ts" />
// 2026-08-20 신설 — report.js fetchProgressAll이 참조하던 Supabase
// school_progress 테이블의 PocketBase 이전.
migrate((db) => {
  const collection = new Collection({
    "id": "spr0001progr",
    "created": "2026-08-20 00:00:00.000Z",
    "updated": "2026-08-20 00:00:00.000Z",
    "name": "school_progress",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "spr001guid", "name": "user_guid", "type": "text", "required": true, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "spr002subj", "name": "subject_id", "type": "relation", "required": true, "presentable": true, "unique": false, "options": { "collectionId": "ssb0001subjc", "cascadeDelete": false, "minSelect": null, "maxSelect": 1, "displayFields": null } },
      { "system": false, "id": "spr003pct", "name": "progress_pct", "type": "number", "required": false, "presentable": true, "unique": false, "options": { "min": 0, "max": 100 } },
      { "system": false, "id": "spr004bloom", "name": "bloom_achieved", "type": "number", "required": false, "presentable": true, "unique": false, "options": { "min": 1, "max": 6 } },
      { "system": false, "id": "spr005pace", "name": "pace_label", "type": "select", "required": false, "presentable": true, "unique": false, "options": { "maxSelect": 1, "values": ["fast", "normal", "slow", "very_slow"] } },
      { "system": false, "id": "spr006block", "name": "current_block", "type": "text", "required": false, "presentable": true, "unique": false, "options": { "min": null, "max": 200, "pattern": "" } }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_spr_user_subject ON school_progress (user_guid, subject_id)"
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
  const collection = dao.findCollectionByNameOrId("spr0001progr");

  return dao.deleteCollection(collection);
})
