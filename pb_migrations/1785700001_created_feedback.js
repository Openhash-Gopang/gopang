/// <reference path="../pb_data/types.d.ts" />
// ── 2026-07-15 신설: 사용자 피드백(버그/기능제안) 저장소. Supabase feedback → L1 이관.
migrate((db) => {
  const collection = new Collection({
    "id": "j2ao8lt7zg5rjia",
    "created": "2026-07-15 00:00:00.000Z",
    "updated": "2026-07-15 00:00:00.000Z",
    "name": "feedback",
    "type": "base",
    "system": false,
    "schema": [
        { "system": false, "id": "lnk9iqu452twuyy", "name": "guid",       "type": "text", "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "r70kuncro9f711w", "name": "handle",     "type": "text", "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "fyv6h2txxy0obe9", "name": "content",    "type": "text", "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "agx9rok443tdkoa", "name": "category",  "type": "text", "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "gimjpcqyzonj2qc", "name": "status",    "type": "text", "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "b67mttz2bbroea9", "name": "admin_note","type": "text", "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" } }
    ],
    "indexes": [
        "CREATE INDEX idx_feedback_status ON feedback (status)",
        "CREATE INDEX idx_feedback_guid ON feedback (guid)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
});
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("j2ao8lt7zg5rjia");
  return dao.deleteCollection(collection);
})
