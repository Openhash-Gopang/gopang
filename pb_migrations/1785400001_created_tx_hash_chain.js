/// <reference path="../pb_data/types.d.ts" />
// ── 2026-07-14 신설(2026-07-15 ID 규칙 위반 수정): 거래별 선형
// 해시체인(updateNodeHashChain) 저장소. Supabase l1_ledger → L1 이관.
migrate((db) => {
  const collection = new Collection({
    "id": "f3sxtdkw1q6e4su",
    "created": "2026-07-14 00:00:00.000Z",
    "updated": "2026-07-14 00:00:00.000Z",
    "name": "tx_hash_chain",
    "type": "base",
    "system": false,
    "schema": [
        { "system": false, "id": "cwrsrlzasaclgvl", "name": "tx_id",           "type": "text",   "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "asy16xue9pku1ha", "name": "buyer_guid",      "type": "text",   "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "ap9ftcsaljw7kct", "name": "seller_guid",     "type": "text",   "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "qfac2af1d0f7jkk", "name": "block_hash",      "type": "text",   "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "ai8b8a34uexbhmd", "name": "user_hash",       "type": "text",   "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "go7i952h0wna2te", "name": "node_hash",       "type": "text",   "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "fpnlv6mj82w5978", "name": "balance_claimed", "type": "number", "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null } },
        { "system": false, "id": "hhtgky8x0fd1omq", "name": "anchored_at",     "type": "date",   "required": true,  "presentable": true,  "unique": false, "options": { "min": "", "max": "" } }
    ],
    "indexes": [ "CREATE INDEX idx_tx_hash_chain_anchored_at ON tx_hash_chain (anchored_at)" ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
});
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("f3sxtdkw1q6e4su");
  return dao.deleteCollection(collection);
})
