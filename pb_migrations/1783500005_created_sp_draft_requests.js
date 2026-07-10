/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const collection = new Collection({
    "id": "a1d9f2b7c4e816",
    "created": "2026-07-11 00:00:00.000Z",
    "updated": "2026-07-11 00:00:00.000Z",
    "name": "sp_draft_requests",
    "type": "base",
    "system": false,
    "schema": [
        {
            "system": false,
            "id": "f1a1000000001",
            "name": "request_type",
            "type": "select",
            "required": true,
            "presentable": false,
            "unique": false,
            "options": {
                "maxSelect": 1,
                "values": ["create", "update"]
            }
        },
        {
            "system": false,
            "id": "f1a1000000002",
            "name": "signal_source",
            "type": "select",
            "required": true,
            "presentable": false,
            "unique": false,
            "options": {
                "maxSelect": 1,
                "values": [
                    "realtime_ac",
                    "kcompose_match_fail",
                    "search_miss_pattern",
                    "gov_data_monitor",
                    "user_feedback",
                    "admin_manual",
                    "refresh_schedule"
                ]
            }
        },
        {
            "system": false,
            "id": "f1a1000000003",
            "name": "institution",
            "type": "text",
            "required": false,
            "presentable": true,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" }
        },
        {
            "system": false,
            "id": "f1a1000000004",
            "name": "task",
            "type": "text",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" }
        },
        {
            "system": false,
            "id": "f1a1000000005",
            "name": "tier_hint",
            "type": "text",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" }
        },
        {
            "system": false,
            "id": "f1a1000000006",
            "name": "target_sp_id",
            "type": "text",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "request_type=update일 때 갱신 대상 SP의 manifest 키(예: SP-DO-HOUSING)"
        },
        {
            "system": false,
            "id": "f1a1000000007",
            "name": "source_conversation",
            "type": "text",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": null, "max": 4000, "pattern": "" }
        },
        {
            "system": false,
            "id": "f1a1000000008",
            "name": "priority",
            "type": "select",
            "required": true,
            "presentable": false,
            "unique": false,
            "options": {
                "maxSelect": 1,
                "values": ["low", "normal", "high", "urgent"]
            }
        },
        {
            "system": false,
            "id": "f1a1000000009",
            "name": "status",
            "type": "select",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": {
                "maxSelect": 1,
                "values": ["queued", "assigned", "drafted", "pending_review", "approved", "rejected", "duplicate"]
            }
        },
        {
            "system": false,
            "id": "f1a1000000010",
            "name": "duplicate_of",
            "type": "text",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "status=duplicate일 때 원본 요청 레코드 id — 중복 신호 병합용"
        },
        {
            "system": false,
            "id": "f1a1000000011",
            "name": "escalated_at",
            "type": "date",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": "", "max": "" }
        },
        {
            "system": false,
            "id": "f1a1000000012",
            "name": "resolved_at",
            "type": "date",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": "", "max": "" }
        }
    ],
    "indexes": [
        "CREATE INDEX idx_sp_draft_requests_status ON sp_draft_requests (status)",
        "CREATE INDEX idx_sp_draft_requests_signal_source ON sp_draft_requests (signal_source)"
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
  const collection = dao.findCollectionByNameOrId("a1d9f2b7c4e816");

  return dao.deleteCollection(collection);
})
