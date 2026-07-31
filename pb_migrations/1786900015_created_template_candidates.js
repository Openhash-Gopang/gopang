/// <reference path="../pb_data/types.d.ts" />
// ── 2026-0X-XX 신설: [TEMPLATE_CANDIDATE] 태그가 지금까지 각 사용자의
// 브라우저 localStorage(hondi_template_candidates)에만 큐잉되고 서버로
// 전송된 적이 없었다(PA 전용 사고실험으로 발견 — [USER_FEEDBACK]이
// 예전에 겪었던 것과 정확히 같은 "로컬 큐잉만 되고 아무도 못 봄" 결함).
// §RENEWALING이 전제하는 "최초 사례 필드 구성을 사람이 리뷰할 수 있게
// 남긴다"는 목적이 실제로는 개국 이래 한 번도 서버에 도달한 적이
// 없었던 것으로 보인다 — 이번에 서버 컬렉션으로 옮긴다.
migrate((db) => {
  const collection = new Collection({
    "id": "2li3eruwfws4b8g",
    "created": "2026-0X-XX 00:00:00.000Z",
    "updated": "2026-0X-XX 00:00:00.000Z",
    "name": "template_candidates",
    "type": "base",
    "system": false,
    "schema": [
        { "system": false, "id": "3s4gld2thgchupz", "name": "guid",         "type": "text", "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "c49004dqc2tdq1t", "name": "category_key", "type": "text", "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "e7c4918thr01n8b", "name": "fields",       "type": "text", "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "rbm9e96ycqydkd4", "name": "context_sp",   "type": "text", "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" } }
    ],
    "indexes": [
        "CREATE INDEX idx_template_candidates_category ON template_candidates (category_key)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
});
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("2li3eruwfws4b8g");
  return dao.deleteCollection(collection);
})
