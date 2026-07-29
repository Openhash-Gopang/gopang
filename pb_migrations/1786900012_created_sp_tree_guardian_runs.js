/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const collection = new Collection({
    "id": "c8f1a2b3d4e501",
    "created": "2026-07-29 00:00:00.000Z",
    "updated": "2026-07-29 00:00:00.000Z",
    "name": "sp_tree_guardian_runs",
    "type": "base",
    "system": false,
    "schema": [
        {
            "system": false,
            "id": "d9a1000000001",
            "name": "head_sha",
            "type": "text",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "이번 감사 시점 main HEAD sha — 다음 실행의 base로 재사용"
        },
        {
            "system": false,
            "id": "d9a1000000002",
            "name": "base_sha",
            "type": "text",
            "required": false,
            "presentable": true,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "이번에 비교한 시작점 sha(지난 run의 head_sha 또는 7일 lookback)"
        },
        {
            "system": false,
            "id": "d9a1000000003",
            "name": "findings_count",
            "type": "number",
            "required": false,
            "presentable": true,
            "unique": false,
            "options": { "min": 0, "max": null }
        }
    ],
    "indexes": [
        "CREATE INDEX idx_sp_tree_guardian_runs_created ON sp_tree_guardian_runs (created)"
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
  const collection = dao.findCollectionByNameOrId("c8f1a2b3d4e501");

  return dao.deleteCollection(collection);
})
