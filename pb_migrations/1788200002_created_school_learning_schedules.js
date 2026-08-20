/// <reference path="../pb_data/types.d.ts" />
// 2026-08-20 신설 — 지금까지 school 저장소엔 학습 일정표라는 개념 자체가
// 없었다(curriculum_rules.json이 명시적으로 "사전에 세션을 작성하지
// 않는다"는 실시간 생성 철학이었음). 학습자 온보딩 직후 하루/주/월 단위로
// 미리 계획을 세우고, 이후 컨텐츠 생성·일일 학습 지휘가 이 스케줄을
// 참조하도록 하기 위한 신규 컬렉션.
migrate((db) => {
  const collection = new Collection({
    "id": "sls0001sched",
    "created": "2026-08-20 00:00:00.000Z",
    "updated": "2026-08-20 00:00:00.000Z",
    "name": "school_learning_schedules",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "sls001guid", "name": "user_guid", "type": "text", "required": true, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "sls002type", "name": "period_type", "type": "select", "required": true, "presentable": true, "unique": false, "options": { "maxSelect": 1, "values": ["daily", "weekly", "monthly"] } },
      { "system": false, "id": "sls003start", "name": "period_start", "type": "date", "required": true, "presentable": true, "unique": false, "options": {} },
      { "system": false, "id": "sls004end", "name": "period_end", "type": "date", "required": true, "presentable": true, "unique": false, "options": {} },
      { "system": false, "id": "sls005items", "name": "plan_items", "type": "json", "required": true, "presentable": false, "unique": false, "options": { "maxSize": 20000 }, "description": "[{subject_id, topic, target_minutes, bloom_target, content_ref}] — content_ref는 school_content_catalog 레코드 id" },
      { "system": false, "id": "sls006status", "name": "status", "type": "select", "required": false, "presentable": true, "unique": false, "options": { "maxSelect": 1, "values": ["planned", "in_progress", "completed", "revised"] } },
      { "system": false, "id": "sls007gen", "name": "generated_by", "type": "select", "required": false, "presentable": false, "unique": false, "options": { "maxSelect": 1, "values": ["kschool_orchestrator", "manual", "teacher_override"] } }
    ],
    "indexes": [
      "CREATE INDEX idx_sls_user_guid ON school_learning_schedules (user_guid)",
      "CREATE INDEX idx_sls_period ON school_learning_schedules (period_type, period_start)"
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
  const collection = dao.findCollectionByNameOrId("sls0001sched");

  return dao.deleteCollection(collection);
})
