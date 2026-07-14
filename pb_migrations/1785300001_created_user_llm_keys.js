/// <reference path="../pb_data/types.d.ts" />
// ── 2026-07-14 신설: 사용자 BYOK(Bring Your Own Key) LLM 설정 저장소.
// Supabase user_llm_keys → L1 이관. PocketBase는 upsert(on_conflict)가
// 없어 "guid로 조회 후 있으면 PATCH, 없으면 CREATE" 패턴을 코드에서
// 직접 구현한다(register-key류와 동일 관례).
migrate((db) => {
  const collection = new Collection({
    "id": "ullk0000001",
    "created": "2026-07-14 00:00:00.000Z",
    "updated": "2026-07-14 00:00:00.000Z",
    "name": "user_llm_keys",
    "type": "base",
    "system": false,
    "schema": [
        { "system": false, "id": "ullk000000001", "name": "guid",          "type": "text",   "required": true,  "presentable": true,  "unique": true,  "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "ullk000000002", "name": "provider",      "type": "text",   "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "ullk000000003", "name": "model",         "type": "text",   "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "ullk000000004", "name": "api_key_enc",   "type": "text",   "required": true,  "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" }, "description": "AES 암호화된 API 키(worker.js _aesEncrypt) — 평문 저장 안 함" },
        { "system": false, "id": "ullk000000005", "name": "ai_active",     "type": "bool",   "required": false, "presentable": true,  "unique": false, "options": {} },
        { "system": false, "id": "ullk000000006", "name": "custom_prompt", "type": "text",   "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "ullk000000007", "name": "native_lang",   "type": "text",   "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "ullk000000008", "name": "endpoint",      "type": "text",   "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" } }
    ],
    "indexes": [ "CREATE UNIQUE INDEX idx_user_llm_keys_guid ON user_llm_keys (guid)" ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
});
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("ullk0000001");
  return dao.deleteCollection(collection);
})
