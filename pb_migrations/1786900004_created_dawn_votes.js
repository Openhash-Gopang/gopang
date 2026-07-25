/// <reference path="../pb_data/types.d.ts" />
// 2026-07-26 신설 — dawn_proposals.status가 'voting'으로 정식 회부된
// 안건에 대한 실제 투표 1건씩을 기록한다. 동의(dawn_endorsements)와
// 완전히 별개 단계다 — 동의는 "심사 상정 여부"를, 투표는 "가결/부결"을
// 결정한다. 한 안건에 한 사용자는 1회만 투표할 수 있다(유니크 인덱스).
migrate((db) => {
  const collection = new Collection({
    "id": "dwn301votes001",
    "created": "2026-07-26 00:00:00.000Z",
    "updated": "2026-07-26 00:00:00.000Z",
    "name": "dawn_votes",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false, "id": "dwn311propid", "name": "proposal_id",
        "type": "text", "required": true, "presentable": true, "unique": false,
        "options": { "min": 1, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "dwn312voterhash", "name": "voter_guid_hash",
        "type": "text", "required": true, "presentable": false, "unique": false,
        "options": { "min": 1, "max": 64, "pattern": "" }
      },
      {
        "system": false, "id": "dwn313side", "name": "side",
        "type": "select", "required": true, "presentable": true, "unique": false,
        "options": { "maxSelect": 1, "values": ["for", "against"] }
      },
      {
        // dawn_endorsements.weight와 동일한 사유로 이번 범위에서는 1 고정.
        "system": false, "id": "dwn314weight", "name": "weight",
        "type": "number", "required": true, "presentable": true, "unique": false,
        "options": { "min": 0, "max": null }
      },
      {
        "system": false, "id": "dwn315createdat", "name": "created_at",
        "type": "date", "required": true, "presentable": true, "unique": false,
        "options": { "min": "", "max": "" }
      }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_dwn_votes_unique ON dawn_votes (proposal_id, voter_guid_hash)",
      "CREATE INDEX idx_dwn_votes_proposal ON dawn_votes (proposal_id)"
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
  const collection = dao.findCollectionByNameOrId("dawn_votes");
  return dao.deleteCollection(collection);
});
