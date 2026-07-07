/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const collection = new Collection({
    "id": "03qb96bfnh99w1s",
    "created": "2026-06-30 06:51:06.507Z",
    "updated": "2026-06-30 06:51:06.507Z",
    "name": "agent_internal_sp",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false,
        "id": "xgcyfq3c",
        "name": "principal_guid",
        "type": "text",
        "required": true,
        "presentable": false,
        "unique": true,
        "options": {
          "min": null,
          "max": null,
          "pattern": ""
        }
      },
      {
        "system": false,
        "id": "8d1rrixw",
        "name": "system_prompt",
        "type": "editor",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": {
          "convertUrls": false
        }
      }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_agent_internal_sp_principal ON agent_internal_sp (principal_guid)"
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
  const collection = dao.findCollectionByNameOrId("03qb96bfnh99w1s");

  return dao.deleteCollection(collection);
})
