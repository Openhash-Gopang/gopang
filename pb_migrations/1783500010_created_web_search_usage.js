/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const collection = new Collection({
    "id": "e5b3d6f1a8c250",
    "created": "2026-07-11 00:00:00.000Z",
    "updated": "2026-07-11 00:00:00.000Z",
    "name": "web_search_usage",
    "type": "base",
    "system": false,
    "schema": [
        {
            "system": false,
            "id": "f5e5000000001",
            "name": "date",
            "type": "text",
            "required": true,
            "presentable": true,
            "unique": true,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "YYYY-MM-DD (KST) — 하루 한 레코드, count를 증분한다"
        },
        {
            "system": false,
            "id": "f5e5000000002",
            "name": "count",
            "type": "number",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": { "min": 0, "max": null },
            "description": "그날 실제로 Serper.dev API를 호출한 횟수(캐시 히트는 포함 안 함)"
        }
    ],
    "indexes": [
        "CREATE UNIQUE INDEX idx_web_search_usage_date ON web_search_usage (date)"
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
  const collection = dao.findCollectionByNameOrId("e5b3d6f1a8c250");

  return dao.deleteCollection(collection);
})
