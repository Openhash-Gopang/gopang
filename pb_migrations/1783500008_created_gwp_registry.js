/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const collection = new Collection({
    "id": "d4a2c5e0f7b149",
    "created": "2026-07-11 00:00:00.000Z",
    "updated": "2026-07-11 00:00:00.000Z",
    "name": "gwp_registry",
    "type": "base",
    "system": false,
    "schema": [
        {
            "system": false,
            "id": "f4d4000000001",
            "name": "gwp_id",
            "type": "text",
            "required": true,
            "presentable": true,
            "unique": true,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "예: klaw, khealth, SP-DO-HOUSING, SP-NAT-POLICY-NEC — sp-catalog.json 키 또는 gwp-registry.js id와 1:1 대응"
        },
        {
            "system": false,
            "id": "f4d4000000002",
            "name": "name",
            "type": "text",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" }
        },
        {
            "system": false,
            "id": "f4d4000000003",
            "name": "tier",
            "type": "select",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": {
                "maxSelect": 1,
                "values": ["core", "institutional", "business", "expert", "personal"]
            },
            "description": "core=gwp-registry.js에도 있는 상위~30개 K서비스. 나머지는 이 테이블만이 유일한 등록처(장기 목표는 core도 이 테이블에서 파생)."
        },
        {
            "system": false,
            "id": "f4d4000000004",
            "name": "category",
            "type": "text",
            "required": false,
            "presentable": true,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "GOV|JUS|MED|EDU|ECO|MKT|TRN|LEG|BIZ|ENV|UTL|TOOL 등 — gwp-registry.js 기존 category 값 재사용"
        },
        {
            "system": false,
            "id": "f4d4000000005",
            "name": "description",
            "type": "text",
            "required": false,
            "presentable": true,
            "unique": false,
            "options": { "min": null, "max": 1000, "pattern": "" }
        },
        {
            "system": false,
            "id": "f4d4000000006",
            "name": "keywords",
            "type": "text",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": null, "max": 2000, "pattern": "" },
            "description": "공백 구분 검색어(동의어·업무 키워드) — LIKE 검색 대상. 예: '건축허가 건축인허가 주택'"
        },
        {
            "system": false,
            "id": "f4d4000000007",
            "name": "jurisdiction",
            "type": "text",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "national|jeju|seoul 등 — 관할 범위(전국 확장 대비)"
        },
        {
            "system": false,
            "id": "f4d4000000008",
            "name": "file_ref",
            "type": "text",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "sp-catalog.json 키 또는 org_profiles.org_id — 실제 SP 파일/레코드 참조"
        },
        {
            "system": false,
            "id": "f4d4000000009",
            "name": "status",
            "type": "select",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": {
                "maxSelect": 1,
                "values": ["active", "pending_review", "deprecated"]
            }
        },
        {
            "system": false,
            "id": "f4d4000000010",
            "name": "call_count_30d",
            "type": "number",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": 0, "max": null }
        }
    ],
    "indexes": [
        "CREATE UNIQUE INDEX idx_gwp_registry_gwp_id ON gwp_registry (gwp_id)",
        "CREATE INDEX idx_gwp_registry_status ON gwp_registry (status)",
        "CREATE INDEX idx_gwp_registry_tier ON gwp_registry (tier)",
        "CREATE INDEX idx_gwp_registry_category ON gwp_registry (category)"
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
  const collection = dao.findCollectionByNameOrId("d4a2c5e0f7b149");

  return dao.deleteCollection(collection);
})
