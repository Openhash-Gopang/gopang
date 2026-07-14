/// <reference path="../pb_data/types.d.ts" />
// ── 2026-07-14 신설: PDV 머클 배치 앵커링(anchorL1MerkleRoot, 10분마다
// 도는 Cloudflare Worker cron) Supabase merkle_anchors → L1 이관.
migrate((db) => {
  const collection = new Collection({
    "id": "pmka00000001",
    "created": "2026-07-14 00:00:00.000Z",
    "updated": "2026-07-14 00:00:00.000Z",
    "name": "pdv_merkle_anchors",
    "type": "base",
    "system": false,
    "schema": [
        { "system": false, "id": "pma0000000001", "name": "merkle_root", "type": "text", "required": true, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "pma0000000002", "name": "block_count", "type": "number", "required": true, "presentable": true, "unique": false, "options": { "min": 0, "max": null } },
        { "system": false, "id": "pma0000000003", "name": "pdv_ids", "type": "text", "required": true, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "pma0000000004", "name": "status", "type": "text", "required": true, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "pma0000000005", "name": "anchored_at", "type": "date", "required": true, "presentable": true, "unique": false, "options": { "min": "", "max": "" } }
    ],
    "indexes": [ "CREATE INDEX idx_pdv_merkle_anchors_anchored_at ON pdv_merkle_anchors (anchored_at)" ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
});
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("pmka00000001");
  return dao.deleteCollection(collection);
})
