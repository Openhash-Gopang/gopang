/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const collection = new Collection({
    "id": "a1u5g3l0g0000n1",
    "created": "2026-07-14 00:00:00.000Z",
    "updated": "2026-07-14 00:00:00.000Z",
    "name": "ai_usage_log",
    "type": "base",
    "system": false,
    "schema": [
        {
            "system": false,
            "id": "aul0000000001",
            "name": "guid",
            "type": "text",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "가입자 GUID (IPv6) — /usage.html이 이 필드로 필터링해 본인 내역만 조회"
        },
        {
            "system": false,
            "id": "aul0000000002",
            "name": "service_id",
            "type": "text",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "hondi-chat | klaw | kbiz | kgov 등 — SP-GDC-BILLING v2.0 §2-2 참조"
        },
        {
            "system": false,
            "id": "aul0000000003",
            "name": "tier",
            "type": "text",
            "required": false,
            "presentable": true,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "hondi-flash | hondi-pro | klaw-flash | klaw-pro 등 논리 티어명"
        },
        {
            "system": false,
            "id": "aul0000000004",
            "name": "model",
            "type": "text",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "실제 호출된 벤더 모델명 (예: deepseek-v4-flash)"
        },
        {
            "system": false,
            "id": "aul0000000005",
            "name": "hit_tokens",
            "type": "number",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": 0, "max": null }
        },
        {
            "system": false,
            "id": "aul0000000006",
            "name": "miss_tokens",
            "type": "number",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": 0, "max": null }
        },
        {
            "system": false,
            "id": "aul0000000007",
            "name": "out_tokens",
            "type": "number",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": 0, "max": null }
        },
        {
            "system": false,
            "id": "aul0000000008",
            "name": "cost_krw",
            "type": "number",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": { "min": 0, "max": null },
            "description": "실제 DeepSeek API 원가 (원, BILLING_MULTIPLIER 적용 전)"
        },
        {
            "system": false,
            "id": "aul0000000009",
            "name": "billed_krw",
            "type": "number",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": { "min": 0, "max": null },
            "description": "실제 청구/차감액 (원, cost_krw × BILLING_MULTIPLIER)"
        }
    ],
    "indexes": [
        "CREATE INDEX idx_ai_usage_log_guid ON ai_usage_log (guid)",
        "CREATE INDEX idx_ai_usage_log_guid_created ON ai_usage_log (guid, created)"
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
  const collection = dao.findCollectionByNameOrId("a1u5g3l0g0000n1");

  return dao.deleteCollection(collection);
})
