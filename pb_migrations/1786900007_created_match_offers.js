/// <reference path="../pb_data/types.d.ts" />
// 2026-07-26 신설 — 기사가 특정 수요(match_demands)에 응답한 기록.
// dawn_endorsements와 동일한 유니크 조합 인덱스 패턴(한 사람이 같은
// 대상에 중복 행위 못 하게 DB가 최종 방어) — 여기선 한 차량이 같은
// 수요에 offer를 두 번 못 내게 막는다.
migrate((db) => {
  const collection = new Collection({
    "id": "mch003offer001",
    "created": "2026-07-26 00:00:00.000Z",
    "updated": "2026-07-26 00:00:00.000Z",
    "name": "match_offers",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false, "id": "mch301demandid", "name": "demand_id",
        "type": "text", "required": true, "presentable": true, "unique": false,
        "options": { "min": 1, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "mch302vehicleid", "name": "vehicle_id",
        "type": "text", "required": true, "presentable": true, "unique": false,
        "options": { "min": 1, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "mch303drvhash", "name": "driver_guid_hash",
        "type": "text", "required": true, "presentable": false, "unique": false,
        "options": { "min": 1, "max": 64, "pattern": "" }
      },
      {
        // pending: 승객 응답 대기. accepted/rejected: 승객 결정.
        // expired: 응답 시간 초과(읽기 시점 지연계산).
        "system": false, "id": "mch304status", "name": "status",
        "type": "select", "required": true, "presentable": true, "unique": false,
        "options": { "maxSelect": 1, "values": ["pending", "accepted", "rejected", "expired"] }
      },
      {
        // offer 생성 시점의 _haversineKm 계산값을 그대로 기록 — 매칭
        // 근거·추후 감사용. 실시간 재계산 아님(그 시점 스냅샷).
        "system": false, "id": "mch305distkm", "name": "distance_km",
        "type": "number", "required": false, "presentable": true, "unique": false,
        "options": { "min": 0, "max": null }
      },
      {
        "system": false, "id": "mch306createdat", "name": "created_at",
        "type": "date", "required": true, "presentable": true, "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false, "id": "mch307respondat", "name": "responded_at",
        "type": "date", "required": false, "presentable": true, "unique": false,
        "options": { "min": "", "max": "" }
      }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_match_offers_unique ON match_offers (demand_id, vehicle_id)",
      "CREATE INDEX idx_match_offers_demand ON match_offers (demand_id)",
      "CREATE INDEX idx_match_offers_vehicle ON match_offers (vehicle_id)"
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
  const collection = dao.findCollectionByNameOrId("match_offers");
  return dao.deleteCollection(collection);
});
