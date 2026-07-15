/// <reference path="../pb_data/types.d.ts" />
// ── 2026-07-15 신설: AI 점원 채팅 세션(handleAiChat). Supabase ai_sessions → L1 이관.
migrate((db) => {
  const collection = new Collection({
    "id": "ajjbxo0uqxjd8cg",
    "created": "2026-07-15 00:00:00.000Z",
    "updated": "2026-07-15 00:00:00.000Z",
    "name": "ai_sessions",
    "type": "base",
    "system": false,
    "schema": [
        { "system": false, "id": "e3djba8qaxqw22q", "name": "session_id",   "type": "text",   "required": true,  "presentable": true,  "unique": true,  "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "tw4dqcf1a7wt8u8", "name": "caller_guid",  "type": "text",   "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "og79i70pc5mk3pt", "name": "caller_lang", "type": "text",   "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "v4sghsvs7um9igc", "name": "target_guid", "type": "text",   "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "k3ym5pmpvuweovw", "name": "mode",        "type": "text",   "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "dmibl2q8goc0po9", "name": "messages",    "type": "json",   "required": false, "presentable": false, "unique": false, "options": {} },
        { "system": false, "id": "ahr77wjatchqxb0", "name": "is_active",   "type": "bool",   "required": false, "presentable": true,  "unique": false, "options": {} },
        { "system": false, "id": "akq1c96mwb8g5jb", "name": "escalated_at","type": "date",   "required": false, "presentable": true,  "unique": false, "options": { "min": "", "max": "" } }
    ],
    "indexes": [ "CREATE UNIQUE INDEX idx_ai_sessions_session_id ON ai_sessions (session_id)" ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
});
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("ajjbxo0uqxjd8cg");
  return dao.deleteCollection(collection);
})
