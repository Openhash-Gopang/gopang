/// <reference path="../pb_data/types.d.ts" />
// 2026-08-15 신설 — (agency, task_key) → gov_fee_schedule 레코드 id 매핑
// 캐시. 같은 민원이 다시 접수될 때마다 매번 시맨틱/키워드 검색을 새로
// 돌리는 대신, 첫 성공 매칭의 레코드 id를 여기 기록해두고 다음부터는
// resolveGovFee(..., { cachedRecordId })로 바로 조회한다.
//
// 캐시가 가리키는 레코드가 삭제되거나 REAL이 아니게 재분류되면
// resolveGovFee()가 자동으로 일반 검색 경로로 폴백한다(gov-fee-lookup.js
// 참조) — 이 컬렉션 자체는 캐시 무효화 로직을 갖고 있지 않다(단순 힌트).
migrate((db) => {
  const collection = new Collection({
    "id": "gftc1cache001",
    "created": "2026-08-15 00:00:00.000Z",
    "updated": "2026-08-15 00:00:00.000Z",
    "name": "gov_fee_task_cache",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false, "id": "gftc1agency", "name": "agency", "type": "text",
        "required": true, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "gftc2taskkey", "name": "task_key", "type": "text",
        "required": true, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "gftc3recid", "name": "gov_fee_schedule_id", "type": "text",
        "required": true, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "gftc4cachedat", "name": "cached_at", "type": "date",
        "required": true, "presentable": false, "unique": false,
        "options": { "min": "", "max": "" }
      }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX `idx_gov_fee_task_cache_agency_task` ON `gov_fee_task_cache` (`agency`, `task_key`)"
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
  const collection = dao.findCollectionByNameOrId("gftc1cache001");

  return dao.deleteCollection(collection);
})
