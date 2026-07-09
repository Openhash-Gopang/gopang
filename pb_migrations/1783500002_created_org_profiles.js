/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const collection = new Collection({
    "id": "e0ba84be3f8c5d",
    "created": "2026-07-09 00:00:00.000Z",
    "updated": "2026-07-09 00:00:00.000Z",
    "name": "org_profiles",
    "type": "base",
    "system": false,
    "schema": [
        {
            "system": false,
            "id": "2e44d295d340d2",
            "name": "org_id",
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
            "id": "ce8343ae0e51b0",
            "name": "org_name",
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
            "id": "ede61e665f6dd9",
            "name": "branch",
            "type": "select",
            "required": true,
            "presentable": false,
            "unique": false,
            "options": {
                "maxSelect": 1,
                "values": [
                    "legislative",
                    "judicial",
                    "admin_central",
                    "admin_local",
                    "public_institution",
                    "private_registry"
                ]
            }
        },
        {
            "system": false,
            "id": "964aa833e64d5a",
            "name": "jurisdiction",
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
            "id": "de64b73eca8577",
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
            "id": "d4be3f5ff5725d",
            "name": "guid_model",
            "type": "select",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": {
                "maxSelect": 1,
                "values": [
                    "government_agency",
                    "judicial",
                    "private_registry",
                    "none"
                ]
            }
        },
        {
            "system": false,
            "id": "d205ca55849cd4",
            "name": "resolution_strategy",
            "type": "select",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": {
                "maxSelect": 1,
                "values": [
                    "fallback_hierarchy",
                    "complete_lookup_table",
                    "single_national_instance",
                    "user_choice"
                ]
            }
        },
        {
            "system": false,
            "id": "56888678f528a2",
            "name": "input",
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
            "id": "47c5e4b0c6ac29",
            "name": "output",
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
            "id": "e25e97377a0029",
            "name": "automation",
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
            "id": "fdeb0769da9585",
            "name": "connected",
            "type": "bool",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": {}
        },
        {
            "system": false,
            "id": "0a8e51cfc6c65c",
            "name": "unavailable_reason",
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
            "id": "96097c9f991ac4",
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
        }
    ],
    "indexes": [
        "CREATE UNIQUE INDEX idx_org_profiles_org_id ON org_profiles (org_id)"
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
  const collection = dao.findCollectionByNameOrId("e0ba84be3f8c5d");

  return dao.deleteCollection(collection);
})
