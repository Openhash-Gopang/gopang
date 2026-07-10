/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const collection = new Collection({
    "id": "f3ac91de50b7c2",
    "created": "2026-07-09 00:00:00.000Z",
    "updated": "2026-07-09 00:00:00.000Z",
    "name": "order_queue",
    "type": "base",
    "system": false,
    "schema": [
        {
            "system": false,
            "id": "a1b2c3d4e5f601",
            "name": "seller_guid",
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
            "id": "a1b2c3d4e5f602",
            "name": "buyer_guid",
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
            "id": "a1b2c3d4e5f603",
            "name": "session_id",
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
            "id": "a1b2c3d4e5f604",
            "name": "items",
            "type": "json",
            "required": true,
            "presentable": false,
            "unique": false,
            "options": {
                "maxSize": 500000
            }
        },
        {
            "system": false,
            "id": "a1b2c3d4e5f605",
            "name": "total",
            "type": "number",
            "required": true,
            "presentable": false,
            "unique": false,
            "options": {
                "min": 0,
                "max": null,
                "noDecimal": false
            }
        },
        {
            "system": false,
            "id": "a1b2c3d4e5f606",
            "name": "currency",
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
            "id": "a1b2c3d4e5f607",
            "name": "status",
            "type": "select",
            "required": true,
            "presentable": false,
            "unique": false,
            "options": {
                "maxSelect": 1,
                "values": [
                    "accepted",
                    "preparing",
                    "ready",
                    "completed",
                    "cancelled"
                ]
            }
        },
        {
            "system": false,
            "id": "a1b2c3d4e5f608",
            "name": "estimated_prep_minutes",
            "type": "number",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": {
                "min": 0,
                "max": null,
                "noDecimal": false
            }
        },
        {
            "system": false,
            "id": "a1b2c3d4e5f609",
            "name": "queued_at",
            "type": "date",
            "required": true,
            "presentable": false,
            "unique": false,
            "options": {
                "min": "",
                "max": ""
            }
        }
    ],
    "indexes": [
        "CREATE INDEX idx_order_queue_seller_status ON order_queue (seller_guid, status)"
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
  const collection = dao.findCollectionByNameOrId("f3ac91de50b7c2");

  return dao.deleteCollection(collection);
})
