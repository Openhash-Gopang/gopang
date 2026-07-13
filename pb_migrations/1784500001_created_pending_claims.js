/// <reference path="../pb_data/types.d.ts" />
// 2026-07-13 신설 — 판매자 claim 전달 큐. 지금까지 buyer_claim/seller_claim
// 둘 다 구매자의 opener 창에만 postMessage로 전달되고 있었다(profile.html
// _submitOrder 참조) — redeemClaim()의 claimant 필터(2026-07-07 신설,
// 이중계상 방지용)가 seller_claim을 조용히 버렸기 때문에, 판매자는
// 실제 거래가 있어도 자기 재무제표(pl-revenue)가 갱신될 방법이 전혀
// 없었다(실사로 발견). order_queue와 동일한 "확인 후 처리" 패턴으로,
// 판매자가 앱을 열 때 자기 앞으로 온 미청구 claim을 조회해 로컬에서
// redeemClaim()한 뒤 서버에 수령 처리한다.
migrate((db) => {
  const collection = new Collection({
    "id": "pdc7m2k9x4qz033",
    "created": "2026-07-13 00:00:00.000Z",
    "updated": "2026-07-13 00:00:00.000Z",
    "name": "pending_claims",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false, "id": "pcf001claimant", "name": "claimant",
        "type": "text", "required": true, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "pcf002claim_data", "name": "claim_data",
        "type": "json", "required": true, "presentable": false, "unique": false,
        "options": { "maxSize": 20000 }
      },
      {
        "system": false, "id": "pcf003block_hash", "name": "block_hash",
        "type": "text", "required": true, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "pcf004block_id", "name": "block_id",
        "type": "text", "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "pcf005tx_hash", "name": "tx_hash",
        "type": "text", "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "pcf006session_id", "name": "session_id",
        "type": "text", "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "pcf007source", "name": "source",
        "type": "text", "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "pcf008redeemed", "name": "redeemed",
        "type": "bool", "required": false, "presentable": true, "unique": false,
        "options": {}
      },
      {
        "system": false, "id": "pcf009redeemed_at", "name": "redeemed_at",
        "type": "date", "required": false, "presentable": false, "unique": false,
        "options": { "min": "", "max": "" }
      }
    ],
    "indexes": [
      "CREATE INDEX idx_pending_claims_claimant ON pending_claims (claimant)",
      "CREATE INDEX idx_pending_claims_redeemed ON pending_claims (redeemed)"
    ],
    "listRule": null,
    "viewRule": null,
    "createRule": null,
    "updateRule": null,
    "deleteRule": null
  });

  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("pending_claims");
  return dao.deleteCollection(collection);
})
