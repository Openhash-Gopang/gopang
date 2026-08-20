/// <reference path="../pb_data/types.d.ts" />
// 2026-08-20 신설 — school_sessions/school_progress/school_assessments가
// 참조하는 부모 컬렉션. report.js의 fetchSubjects(status=active 필터)와
// 필드명을 그대로 맞췄다(Supabase→PocketBase 전환, 신규 설계 아님).
migrate((db) => {
  const collection = new Collection({
    "id": "ssb0001subjc",
    "created": "2026-08-20 00:00:00.000Z",
    "updated": "2026-08-20 00:00:00.000Z",
    "name": "school_subjects",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "ssb001guid", "name": "user_guid", "type": "text", "required": true, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "ssb002sid", "name": "subject_id", "type": "text", "required": true, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" }, "description": "표시용 과목 코드 (예: math, korean) — ISCED-F 대분류 참고" },
      { "system": false, "id": "ssb003name", "name": "subject_name_ko", "type": "text", "required": true, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "ssb004type", "name": "subject_type", "type": "text", "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "ssb005oer", "name": "oer_primary", "type": "text", "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" }, "description": "주 사용 OER(공개교육자료) 출처" },
      { "system": false, "id": "ssb006status", "name": "status", "type": "select", "required": false, "presentable": true, "unique": false, "options": { "maxSelect": 1, "values": ["active", "paused", "completed"] } }
    ],
    "indexes": [
      "CREATE INDEX idx_ssb_user_guid ON school_subjects (user_guid)",
      "CREATE INDEX idx_ssb_status ON school_subjects (status)"
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
  const collection = dao.findCollectionByNameOrId("ssb0001subjc");

  return dao.deleteCollection(collection);
})
