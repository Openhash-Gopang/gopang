/// <reference path="../pb_data/types.d.ts" />
// ── 2026-07-14 신설: PDV 머클 배치 앵커링(anchorL1MerkleRoot, 10분마다
// 도는 Cloudflare Worker cron) Supabase merkle_anchors → L1 이관.
//
// l1_ledger/node_ledger에 적용한 merkle_checkpoints(체크포인트 체이닝)
// 방식과 달리 이 컬렉션은 단순 append-only다 — anchorL1MerkleRoot
// 자체가 이미 "openhash_anchored=false인 것만" 걸러서 배치를 만들기
// 때문에(pdv_records 컬렉션에 그 필드가 있음), 처리된 배치는 자동으로
// 다음 배치에서 제외된다. 즉 이 함수는 애초부터 l1_ledger/node_ledger가
// 갖고 있던 "매번 전체를 다시 계산하는" 버그가 없었다 — 그래서 별도
// 체크포인트 커서 없이 그대로 이관한다.
migrate((db) => {
  const collection = new Collection({
    "id": "pmka00000001",
    "created": "2026-07-14 00:00:00.000Z",
    "updated": "2026-07-14 00:00:00.000Z",
    "name": "pdv_merkle_anchors",
    "type": "base",
    "system": false,
    "schema": [
        {
            "system": false, "id": "pma0000000001", "name": "merkle_root",
            "type": "text", "required": true, "presentable": true, "unique": false,
            "options": { "min": null, "max": null, "pattern": "" }
        },
        {
            "system": false, "id": "pma0000000002", "name": "block_count",
            "type": "number", "required": true, "presentable": true, "unique": false,
            "options": { "min": 0, "max": null }
        },
        {
            "system": false, "id": "pma0000000003", "name": "pdv_ids",
            "type": "text", "required": true, "presentable": false, "unique": false,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "JSON.stringify(pdv_records id 배열) — PocketBase에 배열 필드가 없어 텍스트로 저장, 조회 시 JSON.parse"
        },
        {
            "system": false, "id": "pma0000000004", "name": "status",
            "type": "text", "required": true, "presentable": true, "unique": false,
            "options": { "min": null, "max": null, "pattern": "" }
        },
        {
            "system": false, "id": "pma0000000005", "name": "anchored_at",
            "type": "date", "required": true, "presentable": true, "unique": false,
            "options": { "min": "", "max": "" }
        }
    ],
    "indexes": [
        "CREATE INDEX idx_pdv_merkle_anchors_anchored_at ON pdv_merkle_anchors (anchored_at)"
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
  const collection = dao.findCollectionByNameOrId("pmka00000001");

  return dao.deleteCollection(collection);
})
