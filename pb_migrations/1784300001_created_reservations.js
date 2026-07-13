/// <reference path="../pb_data/types.d.ts" />
// 2026-07-13 — 사업자 프로필 예약 기능 신설. 설계 근거(세션 합의):
//   - 시간대 예약(식당 좌석 등)과 날짜 단위 예약(숙박 등) 둘 다 지원
//     (reservation_type: slot|range — range만 end_at 사용)
//   - 확정 방식은 업종/사업자별로 다름 → confirm_mode를 예약 생성 시점의
//     사업자 설정값으로 스냅샷(향후 사업자가 설정을 바꿔도 이미 생성된
//     예약의 확정 방식이 소급 변경되지 않도록 — trade_ratings의
//     rater_temp_snapshot과 동일한 원칙)
//   - 노쇼 방지 보증금은 "온도(신뢰도) 낮은 사용자만" 요구 → 이미 있는
//     /biz/order(contract_type='escrow')를 그대로 재사용해 별도 결제
//     시스템을 새로 만들지 않는다. 이 컬렉션은 그 escrow 주문의
//     tx_hash를 deposit_order_tx_hash로 참조만 한다(에스크로 자체의
//     소유권은 여전히 blocks/거래 파이프라인에 있음).
migrate((db) => {
  const collection = new Collection({
    "id": "rsv9k2m4p7qz021",
    "created": "2026-07-13 00:00:00.000Z",
    "updated": "2026-07-13 00:00:00.000Z",
    "name": "reservations",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false, "id": "rvf001guid", "name": "guid",
        "type": "text", "required": true, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "rvf002seller_guid", "name": "seller_guid",
        "type": "text", "required": true, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "rvf003reservation_type", "name": "reservation_type",
        "type": "select", "required": true, "presentable": true, "unique": false,
        "options": { "maxSelect": 1, "values": ["slot", "range"] }
      },
      {
        "system": false, "id": "rvf004start_at", "name": "start_at",
        "type": "date", "required": true, "presentable": true, "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false, "id": "rvf005end_at", "name": "end_at",
        "type": "date", "required": false, "presentable": false, "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false, "id": "rvf006status", "name": "status",
        "type": "select", "required": true, "presentable": true, "unique": false,
        "options": { "maxSelect": 1, "values": ["pending", "confirmed", "cancelled", "completed", "no_show"] }
      },
      {
        "system": false, "id": "rvf007confirm_mode", "name": "confirm_mode",
        "type": "select", "required": true, "presentable": false, "unique": false,
        "options": { "maxSelect": 1, "values": ["auto", "manual"] }
      },
      {
        "system": false, "id": "rvf008deposit_required", "name": "deposit_required",
        "type": "bool", "required": false, "presentable": false, "unique": false,
        "options": {}
      },
      {
        "system": false, "id": "rvf009deposit_order_tx_hash", "name": "deposit_order_tx_hash",
        "type": "text", "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "rvf010note", "name": "note",
        "type": "text", "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": 500, "pattern": "" }
      },
      {
        "system": false, "id": "rvf011created_at", "name": "created_at",
        "type": "date", "required": true, "presentable": false, "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false, "id": "rvf012updated_at", "name": "updated_at",
        "type": "date", "required": false, "presentable": false, "unique": false,
        "options": { "min": "", "max": "" }
      }
    ],
    "indexes": [
      "CREATE INDEX idx_reservations_guid ON reservations (guid)",
      "CREATE INDEX idx_reservations_seller_guid ON reservations (seller_guid)",
      "CREATE INDEX idx_reservations_status ON reservations (status)",
      "CREATE INDEX idx_reservations_start_at ON reservations (start_at)"
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
  const collection = dao.findCollectionByNameOrId("reservations");
  return dao.deleteCollection(collection);
})
