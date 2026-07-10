/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const collection = new Collection({
    "id": "b2e0a3c8d5f927",
    "created": "2026-07-11 00:00:00.000Z",
    "updated": "2026-07-11 00:00:00.000Z",
    "name": "escalations",
    "type": "base",
    "system": false,
    "schema": [
        {
            "system": false,
            "id": "f2b2000000001",
            "name": "to",
            "type": "text",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "예: @owner — AGENT-COMMON [ESCALATE: to=...] 태그의 값 그대로"
        },
        {
            "system": false,
            "id": "f2b2000000002",
            "name": "reason",
            "type": "select",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": {
                "maxSelect": 1,
                "values": [
                    "sp_draft_request",
                    "sp_refresh_drift",
                    "identity_verification_failed",
                    "emergency",
                    "other"
                ]
            }
        },
        {
            "system": false,
            "id": "f2b2000000003",
            "name": "ref_collection",
            "type": "text",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "관련 레코드가 있는 컬렉션명(예: sp_draft_requests)"
        },
        {
            "system": false,
            "id": "f2b2000000004",
            "name": "ref_id",
            "type": "text",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" }
        },
        {
            "system": false,
            "id": "f2b2000000005",
            "name": "summary",
            "type": "text",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": { "min": null, "max": 2000, "pattern": "" }
        },
        {
            "system": false,
            "id": "f2b2000000006",
            "name": "read",
            "type": "bool",
            "required": false,
            "presentable": true,
            "unique": false,
            "options": {}
        }
    ],
    "indexes": [
        "CREATE INDEX idx_escalations_read ON escalations (read)",
        "CREATE INDEX idx_escalations_reason ON escalations (reason)"
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
  const collection = dao.findCollectionByNameOrId("b2e0a3c8d5f927");

  return dao.deleteCollection(collection);
})
