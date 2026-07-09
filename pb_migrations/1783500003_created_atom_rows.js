/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const collection = new Collection({
    "id": "e83fce826c7640",
    "created": "2026-07-09 00:00:00.000Z",
    "updated": "2026-07-09 00:00:00.000Z",
    "name": "atom_rows",
    "type": "base",
    "system": false,
    "schema": [
        {
            "system": false,
            "id": "e752298407f918",
            "name": "atom_id",
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
            "id": "d8dc434eeb4b13",
            "name": "pattern",
            "type": "select",
            "required": true,
            "presentable": false,
            "unique": false,
            "options": {
                "maxSelect": 1,
                "values": [
                    "REPORT",
                    "DECISION",
                    "PAY",
                    "QUERY",
                    "ADJUDICATE"
                ]
            }
        },
        {
            "system": false,
            "id": "088c436fe7d0a3",
            "name": "org_class",
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
            "id": "a992830635f62f",
            "name": "required_docs",
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
            "id": "bcefdff8c67962",
            "name": "automation_sp",
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
            "id": "9834d7221e4eae",
            "name": "connected",
            "type": "bool",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": {}
        },
        {
            "system": false,
            "id": "0159ba7a6b508b",
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
            "id": "6706575fd3a515",
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
            "id": "d845e812160c35",
            "name": "pay_subtype",
            "type": "select",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": {
                "maxSelect": 1,
                "values": [
                    "self_assessed",
                    "assessed"
                ]
            }
        },
        {
            "system": false,
            "id": "2985e42a6864c1",
            "name": "regulatory_intensity",
            "type": "select",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": {
                "maxSelect": 1,
                "values": [
                    "report",
                    "register",
                    "permit"
                ]
            }
        },
        {
            "system": false,
            "id": "07fb37ef53cab9",
            "name": "creates_new_status",
            "type": "bool",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": {}
        },
        {
            "system": false,
            "id": "baa54e5e51d47c",
            "name": "outcome_type",
            "type": "select",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": {
                "maxSelect": 1,
                "values": [
                    "benefit",
                    "registration"
                ]
            }
        },
        {
            "system": false,
            "id": "f431ffe1de7524",
            "name": "adjudicate_subtype",
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
            "id": "b01b65cc2305fc",
            "name": "escalation_to",
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
        "CREATE UNIQUE INDEX idx_atom_rows_atom_id ON atom_rows (atom_id)"
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
  const collection = dao.findCollectionByNameOrId("e83fce826c7640");

  return dao.deleteCollection(collection);
})
