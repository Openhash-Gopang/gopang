/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const collection = new Collection({
    "id": "858946b3c4700a",
    "created": "2026-07-09 00:00:00.000Z",
    "updated": "2026-07-09 00:00:00.000Z",
    "name": "procedure_maps",
    "type": "base",
    "system": false,
    "schema": [
        {
            "system": false,
            "id": "417a2a764d9806",
            "name": "goal",
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
            "id": "06abe14a3015a1",
            "name": "domain",
            "type": "text",
            "required": false,
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
            "id": "7612cc18fc5b93",
            "name": "status",
            "type": "select",
            "required": true,
            "presentable": false,
            "unique": false,
            "options": {
                "maxSelect": 1,
                "values": [
                    "draft",
                    "pending_review",
                    "active",
                    "deprecated"
                ]
            }
        },
        {
            "system": false,
            "id": "398027c99c00be",
            "name": "steps",
            "type": "json",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": {
                "maxSize": 2000000
            }
        },
        {
            "system": false,
            "id": "09e095a3b95c4f",
            "name": "eligibility_gate",
            "type": "json",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": {
                "maxSize": 2000000
            }
        },
        {
            "system": false,
            "id": "c98c1ee2307d0e",
            "name": "free_alternative",
            "type": "json",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": {
                "maxSize": 2000000
            }
        },
        {
            "system": false,
            "id": "acfe268b9fac90",
            "name": "as_of_date",
            "type": "date",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": {
                "min": "",
                "max": ""
            }
        },
        {
            "system": false,
            "id": "cfdb5dbc9b8e32",
            "name": "orchestrator",
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
    "indexes": [
        "CREATE UNIQUE INDEX idx_procedure_maps_goal ON procedure_maps (goal)"
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
  const collection = dao.findCollectionByNameOrId("858946b3c4700a");

  return dao.deleteCollection(collection);
})
