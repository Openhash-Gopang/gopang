/// <reference path="../pb_data/types.d.ts" />
// 2026-07-26 신설 — 수락된 offer가 실제 완료·정산까지 간 기록.
//
// 결제 정책(2026-07-26, 피터님 확정): GDC 정산은 handleGdcTransfer
// (worker.js:7451)를 그대로 재사용하되 purpose='transfer'로 호출한다
// (purpose='purchase'가 아니므로 GDC_UNVERIFIED_SELLER_LIMIT 초과 시의
// verified_seller 요구 로직이 적용되지 않는다 — 일반 개인 카풀 기사에게
// 사업자등록 인증을 요구하지 않기로 한 결정 반영). gdc_tx_hash 필드에
// 그 결과 tx_hash를 그대로 기록해 감사 추적선을 남긴다.
migrate((db) => {
  const collection = new Collection({
    "id": "mch004trip0001",
    "created": "2026-07-26 00:00:00.000Z",
    "updated": "2026-07-26 00:00:00.000Z",
    "name": "match_trips",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false, "id": "mch401demandid", "name": "demand_id",
        "type": "text", "required": true, "presentable": true, "unique": false,
        "options": { "min": 1, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "mch402offerid", "name": "offer_id",
        "type": "text", "required": true, "presentable": true, "unique": true,
        "options": { "min": 1, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "mch403gdctxhash", "name": "gdc_tx_hash",
        "type": "text", "required": false, "presentable": true, "unique": false,
        "options": { "min": null, "max": 128, "pattern": "" }
      },
      {
        // in_progress: 수락됐지만 아직 완료 처리 안 됨. completed: 정상
        // 완료+정산. disputed: 분쟁(정산 보류 — 처리 절차는 이번 범위 밖,
        // 기존 GDC 분쟁 시스템(transaction_disputes 컬렉션) 연동 검토 필요).
        "system": false, "id": "mch404status", "name": "status",
        "type": "select", "required": true, "presentable": true, "unique": false,
        "options": { "maxSelect": 1, "values": ["in_progress", "completed", "disputed"] }
      },
      {
        "system": false, "id": "mch405completedat", "name": "completed_at",
        "type": "date", "required": false, "presentable": true, "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false, "id": "mch406createdat", "name": "created_at",
        "type": "date", "required": true, "presentable": true, "unique": false,
        "options": { "min": "", "max": "" }
      }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_match_trips_offer ON match_trips (offer_id)",
      "CREATE INDEX idx_match_trips_demand ON match_trips (demand_id)",
      "CREATE INDEX idx_match_trips_status ON match_trips (status)"
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
  const collection = dao.findCollectionByNameOrId("match_trips");
  return dao.deleteCollection(collection);
});
