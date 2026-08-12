/// <reference path="../pb_data/types.d.ts" />
// 2026-08-12 신설 — desktop.html·benchmark.html 사이드바의 "K-Law 사용 이력" 패널이
// 쓰던 Supabase klaw_sessions 테이블(사용자가 이미 받아본 버전을 추적해 중복 알림
// 방지) 이전. klaw_cases/klaw_benchmark 점검 중 세 번째로 발견됨 — desktop.html과
// benchmark.html에 동일한 _loadKlawHistory/recordKlawUsage 함수가 중복 구현돼 있다.
migrate((db) => {
  const collection = new Collection({
    "id": "kls0000session",
    "created": "2026-08-12 00:00:00.000Z",
    "updated": "2026-08-12 00:00:00.000Z",
    "name": "klaw_sessions",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false, "id": "kls00000001", "name": "user_id", "type": "text",
        "required": true, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" },
        "description": "사용자 ipv6(익명) — 원 Supabase와 동일하게 user_id로 명명 (klaw_cases의 reporter와 다른 이름이니 혼동 주의)"
      },
      {
        "system": false, "id": "kls00000002", "name": "klaw_version", "type": "text",
        "required": true, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "kls00000003", "name": "llm_model", "type": "text",
        "required": false, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "kls00000004", "name": "case_type", "type": "text",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "kls00000005", "name": "case_level", "type": "text",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "kls00000006", "name": "case_summary", "type": "text",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": 500, "pattern": "" }
      },
      {
        "system": false, "id": "kls00000007", "name": "verdict", "type": "text",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": 80, "pattern": "" }
      },
      {
        "system": false, "id": "kls00000008", "name": "confidence", "type": "text",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "kls00000009", "name": "case_input", "type": "text",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": 2000, "pattern": "" }
      }
    ],
    "indexes": [
      "CREATE INDEX idx_klaw_sessions_user_id ON klaw_sessions (user_id)",
      "CREATE INDEX idx_klaw_sessions_created ON klaw_sessions (created)"
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
  const collection = dao.findCollectionByNameOrId("kls0000session");

  return dao.deleteCollection(collection);
})
