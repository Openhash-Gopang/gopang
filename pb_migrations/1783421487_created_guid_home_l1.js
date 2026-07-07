/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const collection = new Collection({
    "id": "kwoqotagpimqz1d",
    "created": "2026-07-07 10:51:27.753Z",
    "updated": "2026-07-07 10:51:27.753Z",
    "name": "guid_home_l1",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false,
        "id": "r13tiybk",
        "name": "guid",
        "type": "text",
        "required": true,
        "presentable": false,
        "unique": false,
        "options": {
          "min": null,
          "max": null,
          "pattern": ""
        }
      },
      {
        "system": false,
        "id": "ajdqzi1w",
        "name": "node_id",
        "type": "text",
        "required": true,
        "presentable": false,
        "unique": false,
        "options": {
          "min": null,
          "max": null,
          "pattern": ""
        }
      },
      {
        "system": false,
        "id": "d67dflsq",
        "name": "registered_at",
        "type": "text",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": {
          "min": null,
          "max": null,
          "pattern": ""
        }
      }
    ],
    "indexes": [],
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
  const collection = dao.findCollectionByNameOrId("kwoqotagpimqz1d");

  return dao.deleteCollection(collection);
})
