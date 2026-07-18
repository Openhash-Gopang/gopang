/// <reference path="../pb_data/types.d.ts" />
// 2026-07-18 신설 — GDC 상거래 완성 계획서 Phase 3(가격 공정성).
//
// 계획서 §2에서 이미 정리했듯, 카탈로그 없는 완전 비정형 개인간 거래
// (노점 짜장면 같은)의 "공정 가격"을 시스템이 실시간 자동 판단하는 건
// 근본적으로 어렵다(오탐 위험이 큰 통계적 이상거래 탐지는 1차 범위에서
// 제외 — 계획서 §2 결론). 대신 사후 신고제(§2의 (B) 대안)를 구현한다:
// 거래 당사자가 "이 거래가 부당했다"고 신고하면 관리자 검토 큐에 쌓인다.
//
// 완전 자동 가격판단 자체는 여전히 미구현 — 이건 §2에서 이미 "1차 범위
// 제외"로 결론 낸 부분이라 이번 배치에 포함하지 않는다.
migrate((db) => {
  const collection = new Collection({
    "id": "tdp9s5k3z1oa073",
    "created": "2026-07-18 00:00:00.000Z",
    "updated": "2026-07-18 00:00:00.000Z",
    "name": "transaction_disputes",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false, "id": "tdf001tx_id", "name": "tx_id",
        "type": "text", "required": true, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "tdf002reporter_guid", "name": "reporter_guid",
        "type": "text", "required": true, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "tdf003reason", "name": "reason",
        "type": "text", "required": true, "presentable": false, "unique": false,
        "options": { "min": null, "max": 1000, "pattern": "" }
      },
      {
        "system": false, "id": "tdf004status", "name": "status",
        "type": "select", "required": true, "presentable": true, "unique": false,
        "options": { "maxSelect": 1, "values": ["open", "reviewing", "resolved"] }
      },
      {
        "system": false, "id": "tdf005resolution_note", "name": "resolution_note",
        "type": "text", "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "tdf006created_at", "name": "created_at",
        "type": "date", "required": true, "presentable": false, "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false, "id": "tdf007resolved_at", "name": "resolved_at",
        "type": "date", "required": false, "presentable": false, "unique": false,
        "options": { "min": "", "max": "" }
      }
    ],
    "indexes": [
      "CREATE INDEX idx_transaction_disputes_tx_id ON transaction_disputes (tx_id)",
      "CREATE INDEX idx_transaction_disputes_status ON transaction_disputes (status)"
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
  const collection = dao.findCollectionByNameOrId("transaction_disputes");
  return dao.deleteCollection(collection);
});
