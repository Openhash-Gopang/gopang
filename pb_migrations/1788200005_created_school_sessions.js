/// <reference path="../pb_data/types.d.ts" />
// 2026-08-20 신설 — report.js fetchSessionsInPeriod가 참조하던 Supabase
// school_sessions 테이블의 PocketBase 이전. subject_id는 원래 Supabase에서
// subjects.id(PK)를 참조하는 FK였던 걸 그대로 PocketBase relation으로
// 옮겼다 — relation 필드 값은 대상 레코드의 PocketBase id 문자열이라
// report.js의 `sessions.filter(s => s.subject_id === sub.id)` 비교 로직이
// 별도 수정 없이 그대로 성립한다.
migrate((db) => {
  const collection = new Collection({
    "id": "sse0001sessn",
    "created": "2026-08-20 00:00:00.000Z",
    "updated": "2026-08-20 00:00:00.000Z",
    "name": "school_sessions",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "sse001guid", "name": "user_guid", "type": "text", "required": true, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "sse002subj", "name": "subject_id", "type": "relation", "required": true, "presentable": true, "unique": false, "options": { "collectionId": "ssb0001subjc", "cascadeDelete": false, "minSelect": null, "maxSelect": 1, "displayFields": null } },
      { "system": false, "id": "sse003min", "name": "session_minutes", "type": "number", "required": false, "presentable": true, "unique": false, "options": { "min": 0, "max": 600 } },
      { "system": false, "id": "sse004comp", "name": "comprehension", "type": "number", "required": false, "presentable": true, "unique": false, "options": { "min": 0, "max": 100 } },
      { "system": false, "id": "sse005self", "name": "self_rating", "type": "number", "required": false, "presentable": false, "unique": false, "options": { "min": 0, "max": 10 } },
      { "system": false, "id": "sse006topic", "name": "topic_detail", "type": "text", "required": false, "presentable": true, "unique": false, "options": { "min": null, "max": 200, "pattern": "" } },
      { "system": false, "id": "sse007sched", "name": "schedule_id", "type": "relation", "required": false, "presentable": false, "unique": false, "options": { "collectionId": "sls0001sched", "cascadeDelete": false, "minSelect": null, "maxSelect": 1, "displayFields": null }, "description": "이 세션이 어느 학습 일정표 항목을 수행한 결과인지 (school_learning_schedules 참조)" }
    ],
    "indexes": [
      "CREATE INDEX idx_sse_user_guid ON school_sessions (user_guid)",
      "CREATE INDEX idx_sse_created ON school_sessions (created)",
      "CREATE INDEX idx_sse_subject ON school_sessions (subject_id)"
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
  const collection = dao.findCollectionByNameOrId("sse0001sessn");

  return dao.deleteCollection(collection);
})
