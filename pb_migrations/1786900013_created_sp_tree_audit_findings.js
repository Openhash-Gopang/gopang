/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const collection = new Collection({
    "id": "e2b3c4d5f6a712",
    "created": "2026-07-29 00:00:00.000Z",
    "updated": "2026-07-29 00:00:00.000Z",
    "name": "sp_tree_audit_findings",
    "type": "base",
    "system": false,
    "schema": [
        {
            "system": false,
            "id": "f0b2000000001",
            "name": "run_id",
            "type": "text",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "sp_tree_guardian_runs 레코드 id — escalations의 ref_id와 동일 관례로 일반 text 참조(native relation 미사용)"
        },
        {
            "system": false,
            "id": "f0b2000000002",
            "name": "file",
            "type": "text",
            "required": false,
            "presentable": true,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" }
        },
        {
            "system": false,
            "id": "f0b2000000003",
            "name": "issue",
            "type": "text",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": { "min": null, "max": 4000, "pattern": "" }
        },
        {
            "system": false,
            "id": "f0b2000000004",
            "name": "proposed_change",
            "type": "text",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": null, "max": 4000, "pattern": "" },
            "description": "SP-TREE-REGISTRY §F edges 블록에 그대로 붙여넣을 수 있는 문법으로 제안됨(SP-TREE-GUARDIAN §3) — 사람이 검토 후 직접 반영해야 함, 자동 반영 없음"
        },
        {
            "system": false,
            "id": "f0b2000000005",
            "name": "confidence",
            "type": "select",
            "required": false,
            "presentable": true,
            "unique": false,
            "options": {
                "maxSelect": 1,
                "values": ["high", "medium", "low"]
            }
        },
        {
            "system": false,
            "id": "f0b2000000006",
            "name": "needs_special_review",
            "type": "bool",
            "required": false,
            "presentable": true,
            "unique": false,
            "options": {}
        },
        {
            "system": false,
            "id": "f0b2000000007",
            "name": "status",
            "type": "select",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": {
                "maxSelect": 1,
                "values": ["pending_review", "accepted", "rejected"]
            }
        }
    ],
    "indexes": [
        "CREATE INDEX idx_sp_tree_audit_findings_status ON sp_tree_audit_findings (status)",
        "CREATE INDEX idx_sp_tree_audit_findings_run_id ON sp_tree_audit_findings (run_id)"
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
  const collection = dao.findCollectionByNameOrId("e2b3c4d5f6a712");

  return dao.deleteCollection(collection);
})
