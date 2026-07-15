/// <reference path="../pb_data/types.d.ts" />
// ── 2026-07-15 신설: AI→사람 핸드오프 시 전달되는 메시지. Supabase messages → L1 이관.
// (이름을 ai_messages로 함 — 범용적인 "messages"는 다른 시스템과 혼동
// 위험이 있어 명확히 구분.)
migrate((db) => {
  const collection = new Collection({
    "id": "asdhhksfuahqzj3",
    "created": "2026-07-15 00:00:00.000Z",
    "updated": "2026-07-15 00:00:00.000Z",
    "name": "ai_messages",
    "type": "base",
    "system": false,
    "schema": [
        { "system": false, "id": "hnpsu4lqlf58icp", "name": "session_id",         "type": "text", "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "aluxi3bmq56rmb3", "name": "sender_guid",        "type": "text", "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "ve8djkhae8yvfho", "name": "receiver_guid",      "type": "text", "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "ape8w4hgezp8uz5", "name": "content_original",   "type": "text", "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "efw84plsf7cl1xq", "name": "content_translated", "type": "text", "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "eyptkhikwo8q86v", "name": "lang_from",          "type": "text", "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "fnpjvur7gw856y8", "name": "lang_to",            "type": "text", "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "otjqj1souqjzwav", "name": "content_type",       "type": "text", "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } }
    ],
    "indexes": [ "CREATE INDEX idx_ai_messages_session_id ON ai_messages (session_id)" ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
});
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("asdhhksfuahqzj3");
  return dao.deleteCollection(collection);
})
