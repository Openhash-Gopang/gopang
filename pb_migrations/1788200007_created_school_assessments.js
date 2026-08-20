/// <reference path="../pb_data/types.d.ts" />
// 2026-08-20 신설 — report.js fetchAssessmentsInPeriod가 참조하던 Supabase
// school_assessments 테이블의 PocketBase 이전. wrong_topics는 배열이라
// json 타입으로 옮기되 maxSize를 반드시 명시한다(2026-08-20
// account_risk_score의 maxSize 누락 사고 재발 방지 — 같은 날 발생했던
// 결함을 여기서 처음부터 피해간다).
migrate((db) => {
  const collection = new Collection({
    "id": "sas0001assmt",
    "created": "2026-08-20 00:00:00.000Z",
    "updated": "2026-08-20 00:00:00.000Z",
    "name": "school_assessments",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "sas001guid", "name": "user_guid", "type": "text", "required": true, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "sas002subj", "name": "subject_id", "type": "relation", "required": true, "presentable": true, "unique": false, "options": { "collectionId": "ssb0001subjc", "cascadeDelete": false, "minSelect": null, "maxSelect": 1, "displayFields": null } },
      { "system": false, "id": "sas003type", "name": "assessment_type", "type": "text", "required": false, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "sas004score", "name": "score", "type": "number", "required": false, "presentable": true, "unique": false, "options": { "min": 0, "max": 100 } },
      { "system": false, "id": "sas005date", "name": "assessed_at", "type": "date", "required": true, "presentable": true, "unique": false, "options": {} },
      { "system": false, "id": "sas006wrong", "name": "wrong_topics", "type": "json", "required": false, "presentable": false, "unique": false, "options": { "maxSize": 5000 } }
    ],
    "indexes": [
      "CREATE INDEX idx_sas_user_guid ON school_assessments (user_guid)",
      "CREATE INDEX idx_sas_assessed_at ON school_assessments (assessed_at)",
      "CREATE INDEX idx_sas_subject ON school_assessments (subject_id)"
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
  const collection = dao.findCollectionByNameOrId("sas0001assmt");

  return dao.deleteCollection(collection);
})
