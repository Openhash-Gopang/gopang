/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const collection = new Collection({
    "id": "b7d82ef19a4c05",
    "created": "2026-07-09 00:00:00.000Z",
    "updated": "2026-07-09 00:00:00.000Z",
    "name": "delivery_requests",
    "type": "base",
    "system": false,
    "schema": [
        {
            "system": false,
            "id": "d1e2f3a4b5c601",
            "name": "seller_guid",
            "type": "text",
            "required": true,
            "presentable": false,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" }
        },
        {
            "system": false,
            "id": "d1e2f3a4b5c602",
            "name": "buyer_guid",
            "type": "text",
            "required": true,
            "presentable": false,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" }
        },
        {
            "system": false,
            "id": "d1e2f3a4b5c603",
            "name": "queue_id",
            "type": "text",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" }
        },
        {
            "system": false,
            "id": "d1e2f3a4b5c604",
            "name": "courier_guid",
            "type": "text",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" }
        },
        {
            "system": false,
            "id": "d1e2f3a4b5c605",
            "name": "pickup_lat",
            "type": "number",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": null, "max": null, "noDecimal": false }
        },
        {
            "system": false,
            "id": "d1e2f3a4b5c606",
            "name": "pickup_lng",
            "type": "number",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": null, "max": null, "noDecimal": false }
        },
        {
            "system": false,
            "id": "d1e2f3a4b5c607",
            "name": "dropoff_lat",
            "type": "number",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": null, "max": null, "noDecimal": false }
        },
        {
            "system": false,
            "id": "d1e2f3a4b5c608",
            "name": "dropoff_lng",
            "type": "number",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": null, "max": null, "noDecimal": false }
        },
        {
            "system": false,
            "id": "d1e2f3a4b5c609",
            "name": "status",
            "type": "select",
            "required": true,
            "presentable": false,
            "unique": false,
            "options": {
                "maxSelect": 1,
                "values": ["requested", "no_courier_found", "accepted", "picked_up", "delivered", "cancelled"]
            }
        },
        {
            "system": false,
            "id": "d1e2f3a4b5c610",
            "name": "eta_minutes",
            "type": "number",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": 0, "max": null, "noDecimal": false }
        },
        {
            "system": false,
            "id": "d1e2f3a4b5c611",
            "name": "requested_at",
            "type": "date",
            "required": true,
            "presentable": false,
            "unique": false,
            "options": { "min": "", "max": "" }
        }
    ],
    "indexes": [
        "CREATE INDEX idx_delivery_requests_seller ON delivery_requests (seller_guid)"
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
  const collection = dao.findCollectionByNameOrId("b7d82ef19a4c05");

  return dao.deleteCollection(collection);
})
