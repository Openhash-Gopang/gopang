/// <reference path="../pb_data/types.d.ts" />
// 2026-07-26 신설 — dawn_proposals의 "동의(endorsement)" 1건씩을 기록한다.
// 한 안건에 한 사용자는 1회만 동의할 수 있다(proposal_id+voter_guid_hash
// 조합 유니크 인덱스로 서버 측에서 강제 — worker.js는 insert 전에 조회로
// 한 번 더 막지만, 동시 요청 경합에 대비해 DB 인덱스가 최종 방어선).
migrate((db) => {
  const collection = new Collection({
    "id": "dwn201endors01",
    "created": "2026-07-26 00:00:00.000Z",
    "updated": "2026-07-26 00:00:00.000Z",
    "name": "dawn_endorsements",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false, "id": "dwn211propid", "name": "proposal_id",
        "type": "text", "required": true, "presentable": true, "unique": false,
        "options": { "min": 1, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "dwn212voterhash", "name": "voter_guid_hash",
        "type": "text", "required": true, "presentable": false, "unique": false,
        "options": { "min": 1, "max": 64, "pattern": "" }
      },
      {
        // 2026-07-26: AI 산정 가중 투표권 시스템은 이번 범위 밖 — 항상 1로
        // 기록한다. 컬럼은 미리 둬서 나중에 가중치 로직만 worker.js에
        // 추가하면 되게 한다(스키마 변경 불필요).
        "system": false, "id": "dwn213weight", "name": "weight",
        "type": "number", "required": true, "presentable": true, "unique": false,
        "options": { "min": 0, "max": null }
      },
      {
        "system": false, "id": "dwn214createdat", "name": "created_at",
        "type": "date", "required": true, "presentable": true, "unique": false,
        "options": { "min": "", "max": "" }
      }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_dwn_endorsements_unique ON dawn_endorsements (proposal_id, voter_guid_hash)",
      "CREATE INDEX idx_dwn_endorsements_proposal ON dawn_endorsements (proposal_id)"
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
  const collection = dao.findCollectionByNameOrId("dawn_endorsements");
  return dao.deleteCollection(collection);
});
