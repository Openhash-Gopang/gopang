/// <reference path="../pb_data/types.d.ts" />
// ── 2026-07-15 신설: 외부 서비스 등록부(svc_registry). Supabase → L1 이관.
migrate((db) => {
  const collection = new Collection({
    "id": "m9t2hen6pw37vz1",
    "created": "2026-07-15 00:00:00.000Z",
    "updated": "2026-07-15 00:00:00.000Z",
    "name": "svc_registry",
    "type": "base",
    "system": false,
    "schema": [
        { "system": false, "id": "u2fdo4vpvr3tvgl", "name": "svc_id",        "type": "text",   "required": true,  "presentable": true, "unique": true,  "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "aw98gtvlv8bzuxx", "name": "domain",       "type": "text",   "required": true,  "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "juwq3tgow8nwzcp", "name": "description",  "type": "text",   "required": false, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "akeh7iryvb0zahu", "name": "operator_ipv6","type": "text",   "required": true,  "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "byc3f3lju27y61s", "name": "min_auth",     "type": "text",   "required": false, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "a2d7wl2nv6br8hn", "name": "trust_level",  "type": "number", "required": false, "presentable": true, "unique": false, "options": { "min": 0, "max": null } },
        { "system": false, "id": "j8w1ch1zloixjrk", "name": "status",       "type": "text",   "required": true,  "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" } }
    ],
    "indexes": [ "CREATE UNIQUE INDEX idx_svc_registry_svc_id ON svc_registry (svc_id)" ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
});
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("m9t2hen6pw37vz1");
  return dao.deleteCollection(collection);
})
