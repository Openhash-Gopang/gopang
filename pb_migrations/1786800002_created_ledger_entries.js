/// <reference path="../pb_data/types.d.ts" />
// 2026-07-18 신설 — GDC 상거래 완성 계획서(docs/gdc_commerce_completion_plan_v0_1.md)
// Phase 4. 정식 복식부기 재무제표 원장.
//
// 이미 있던 것과 다른 점을 명확히 해둔다:
//   - `blocks` 컬렉션: UTXO 정산의 정본(무엇이 얼마나 이동했는지)
//   - `l1_ledger` 컬렉션: Merkle 해시 앵커링(OpenHash 위변조 방지) — 회계
//     계정과목(차변/대변, bs-cash/pl-purchase/pl-revenue) 개념이 없다
//   - `ledger_entries`(이번 신설): 각 사용자의 재무제표 관점(차변/대변,
//     계정과목)을 담는다. src/profile2.0/ledger.js(M10)가 이미 이 개념을
//     설계해뒀었는데 어디서도 호출이 안 되고 있었다(2026-07-18 실사로
//     발견) — 그 설계(구매자 차변/판매자 대변 구조)를 그대로 재사용하되,
//     레거시 Supabase 대신 이 L1 컬렉션에 쓴다(인프라가 이미 L1로 이관
//     중이므로 Supabase를 되살리지 않는다).
migrate((db) => {
  const collection = new Collection({
    "id": "lgr8r4k2y0nz062",
    "created": "2026-07-18 00:00:00.000Z",
    "updated": "2026-07-18 00:00:00.000Z",
    "name": "ledger_entries",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false, "id": "lef001guid", "name": "guid",
        "type": "text", "required": true, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "lef002direction", "name": "direction",
        "type": "select", "required": true, "presentable": true, "unique": false,
        "options": { "maxSelect": 1, "values": ["debit", "credit"] }
      },
      {
        "system": false, "id": "lef003amount", "name": "amount",
        "type": "number", "required": true, "presentable": true, "unique": false,
        "options": { "min": 0, "max": null }
      },
      {
        "system": false, "id": "lef004fs_account", "name": "fs_account",
        "type": "text", "required": true, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "lef005source", "name": "source",
        "type": "select", "required": true, "presentable": false, "unique": false,
        "options": { "maxSelect": 1, "values": ["market", "gdc_transfer", "ai_usage", "mint"] }
      },
      {
        "system": false, "id": "lef006block_hash", "name": "block_hash",
        "type": "text", "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "lef007tx_id", "name": "tx_id",
        "type": "text", "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      }
    ],
    "indexes": [
      "CREATE INDEX idx_ledger_entries_guid ON ledger_entries (guid)",
      "CREATE INDEX idx_ledger_entries_tx_id ON ledger_entries (tx_id)"
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
  const collection = dao.findCollectionByNameOrId("ledger_entries");
  return dao.deleteCollection(collection);
});
