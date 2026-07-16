/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const collection = new Collection({
    "id": "a17c5d0f39b221",
    "created": "2026-07-16 00:00:00.000Z",
    "updated": "2026-07-16 00:00:00.000Z",
    "name": "public_data_usage",
    "type": "base",
    "system": false,
    "schema": [
        {
            "system": false,
            "id": "b28d6e1040c332",
            "name": "dataset",
            "type": "text",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "데이터셋 식별자(예: bdong_code, molit_realprice) — web_search_usage와 달리 데이터셋별로 예산을 분리 집계하기 위한 축(PUBLIC-DATA-PORTAL-INTEGRATION-PLAN_v1_0 §2-3)"
        },
        {
            "system": false,
            "id": "b28d6e1040c333",
            "name": "date",
            "type": "text",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "YYYY-MM-DD (KST) — dataset+date 조합이 하루 한 레코드"
        },
        {
            "system": false,
            "id": "b28d6e1040c334",
            "name": "count",
            "type": "number",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": { "min": 0, "max": null },
            "description": "그날 해당 데이터셋의 실제 data.go.kr API 호출 횟수(캐시 히트는 포함 안 함)"
        }
    ],
    "indexes": [
        "CREATE UNIQUE INDEX idx_public_data_usage_dataset_date ON public_data_usage (dataset, date)"
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
  const collection = dao.findCollectionByNameOrId("a17c5d0f39b221");

  return dao.deleteCollection(collection);
})
