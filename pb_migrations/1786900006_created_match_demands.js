/// <reference path="../pb_data/types.d.ts" />
// 2026-07-26 신설 — K-Traffic/K-Logistics 실매칭 시스템, 이동·물류 수요 게시.
// match_vehicles와 배경 동일(1786900005 참고).
//
// 2026-07-26: 수요 만료 시간(expires_at)의 절대적 기본값(예: 게시 후 30분)은
// 이번 커밋 시점까지 피터님 확정을 받지 못했다 — worker.js에
// MATCH_DEMAND_EXPIRY_MS 상수로 관리하고 임시로 30분을 넣어둔다(DAWN의
// DAWN_VOTE_WINDOW_MS 7일 임의 설정과 동일한 성격의 미확정 값). 조정
// 필요시 그 상수만 바꾸면 스키마 변경은 불필요.
migrate((db) => {
  const collection = new Collection({
    "id": "mch002demand01",
    "created": "2026-07-26 00:00:00.000Z",
    "updated": "2026-07-26 00:00:00.000Z",
    "name": "match_demands",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false, "id": "mch201reqhash", "name": "requester_guid_hash",
        "type": "text", "required": true, "presentable": false, "unique": false,
        "options": { "min": 1, "max": 64, "pattern": "" }
      },
      {
        "system": false, "id": "mch202demtype", "name": "demand_type",
        "type": "select", "required": true, "presentable": true, "unique": false,
        "options": { "maxSelect": 1, "values": ["ride", "cargo"] }
      },
      {
        "system": false, "id": "mch203fromlat", "name": "from_lat",
        "type": "number", "required": true, "presentable": true, "unique": false,
        "options": { "min": -90, "max": 90 }
      },
      {
        "system": false, "id": "mch204fromlng", "name": "from_lng",
        "type": "number", "required": true, "presentable": true, "unique": false,
        "options": { "min": -180, "max": 180 }
      },
      {
        "system": false, "id": "mch205fromlabel", "name": "from_label",
        "type": "text", "required": false, "presentable": true, "unique": false,
        "options": { "min": null, "max": 200, "pattern": "" }
      },
      {
        "system": false, "id": "mch206tolat", "name": "to_lat",
        "type": "number", "required": true, "presentable": true, "unique": false,
        "options": { "min": -90, "max": 90 }
      },
      {
        "system": false, "id": "mch207tolng", "name": "to_lng",
        "type": "number", "required": true, "presentable": true, "unique": false,
        "options": { "min": -180, "max": 180 }
      },
      {
        "system": false, "id": "mch208tolabel", "name": "to_label",
        "type": "text", "required": false, "presentable": true, "unique": false,
        "options": { "min": null, "max": 200, "pattern": "" }
      },
      {
        // demand_type='cargo'일 때만 사용(품목·수량·중량). ride일 땐 빈 값.
        "system": false, "id": "mch209cargodet", "name": "cargo_detail",
        "type": "text", "required": false, "presentable": true, "unique": false,
        "options": { "min": null, "max": 1000, "pattern": "" }
      },
      {
        // open: 매칭 대기. matched: 성사(offer accepted). expired: 시간 초과
        // (지연계산, _dawnMaybeCloseVoting과 동일 패턴으로 읽기 시점 갱신).
        // cancelled: 요청자 취소.
        "system": false, "id": "mch210status", "name": "status",
        "type": "select", "required": true, "presentable": true, "unique": false,
        "options": { "maxSelect": 1, "values": ["open", "matched", "expired", "cancelled"] }
      },
      {
        "system": false, "id": "mch211expiresat", "name": "expires_at",
        "type": "date", "required": true, "presentable": true, "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false, "id": "mch212createdat", "name": "created_at",
        "type": "date", "required": true, "presentable": true, "unique": false,
        "options": { "min": "", "max": "" }
      }
    ],
    "indexes": [
      "CREATE INDEX idx_match_demands_status ON match_demands (status)",
      "CREATE INDEX idx_match_demands_created ON match_demands (created_at)",
      "CREATE INDEX idx_match_demands_requester ON match_demands (requester_guid_hash)"
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
  const collection = dao.findCollectionByNameOrId("match_demands");
  return dao.deleteCollection(collection);
});
