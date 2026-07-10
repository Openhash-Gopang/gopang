/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const collection = new Collection({
    "id": "c3f1b4d9e6a038",
    "created": "2026-07-11 00:00:00.000Z",
    "updated": "2026-07-11 00:00:00.000Z",
    "name": "sp_refresh_schedule",
    "type": "base",
    "system": false,
    "schema": [
        {
            "system": false,
            "id": "f3c3000000001",
            "name": "sp_id",
            "type": "text",
            "required": true,
            "presentable": true,
            "unique": true,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "sp-catalog.json의 manifest 키(예: SP-DO-HOUSING, AGENT-COMMON)"
        },
        {
            "system": false,
            "id": "f3c3000000002",
            "name": "call_count_30d",
            "type": "number",
            "required": false,
            "presentable": true,
            "unique": false,
            "options": { "min": 0, "max": null }
        },
        {
            "system": false,
            "id": "f3c3000000003",
            "name": "tier",
            "type": "select",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": {
                "maxSelect": 1,
                "values": ["weekly", "monthly", "quarterly"]
            }
        },
        {
            "system": false,
            "id": "f3c3000000004",
            "name": "last_refreshed_at",
            "type": "date",
            "required": false,
            "presentable": true,
            "unique": false,
            "options": { "min": "", "max": "" }
        },
        {
            "system": false,
            "id": "f3c3000000005",
            "name": "next_due_at",
            "type": "date",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": { "min": "", "max": "" }
        },
        {
            "system": false,
            "id": "f3c3000000006",
            "name": "drift_flag",
            "type": "bool",
            "required": false,
            "presentable": true,
            "unique": false,
            "options": {}
        },
        {
            "system": false,
            "id": "f3c3000000007",
            "name": "drift_reason",
            "type": "text",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": null, "max": 1000, "pattern": "" }
        }
    ],
    "indexes": [
        "CREATE UNIQUE INDEX idx_sp_refresh_schedule_sp_id ON sp_refresh_schedule (sp_id)",
        "CREATE INDEX idx_sp_refresh_schedule_next_due_at ON sp_refresh_schedule (next_due_at)"
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
  const collection = dao.findCollectionByNameOrId("c3f1b4d9e6a038");

  return dao.deleteCollection(collection);
})
