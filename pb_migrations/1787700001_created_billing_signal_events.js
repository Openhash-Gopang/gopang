/// <reference path="../pb_data/types.d.ts" />
// 2026-08-13 신설 — 혼디 자율 과금 제안 시스템 §1: 신호 축적 컬렉션.
//
// 배경(주피터 지시): 1천만 명 규모에서는 새 요청 유형이 나올 때마다
// 관리자에게 물어보는 게 비현실적이다. kgov(§REQUIRED-DOCUMENTS 등)나
// 다른 K-서비스가 아직 과금 규칙이 없는 task_key를 처리할 때마다, 우선
// 기존 토큰 과금(× BILLING_MULTIPLIER_DEFAULT)을 그대로 적용하면서
// 이 컬렉션에 신호만 조용히 쌓는다 — 사용자에게 아무 영향 없음, 순수
// 관측 로그. billing_rule_proposals가 표본이 쌓였는지 판단할 때 이
// 컬렉션을 집계한다.
migrate((db) => {
  const collection = new Collection({
    "id": "blgsig0001evt",
    "created": "2026-08-13 00:00:00.000Z",
    "updated": "2026-08-13 00:00:00.000Z",
    "name": "billing_signal_events",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false, "id": "blgsig000001", "name": "task_key", "type": "text",
        "required": true, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" },
        "description": "agency:task_key 또는 K-서비스 task_type 식별자"
      },
      {
        "system": false, "id": "blgsig000002", "name": "service_id", "type": "text",
        "required": true, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "blgsig000003", "name": "guid", "type": "text",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "blgsig000004", "name": "cost_krw", "type": "number",
        "required": true, "presentable": true, "unique": false,
        "options": { "min": 0, "max": null, "noDecimal": false },
        "description": "이 건의 실제 API 원가(원) — 배율 적용 전 원본값"
      },
      {
        "system": false, "id": "blgsig000005", "name": "used_paid_external_api", "type": "bool",
        "required": false, "presentable": true, "unique": false,
        "options": {}
      },
      {
        "system": false, "id": "blgsig000006", "name": "gov_task_roundtrips", "type": "number",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": 0, "max": null, "noDecimal": true }
      }
    ],
    "indexes": [
      "CREATE INDEX idx_billing_signal_events_task_key ON billing_signal_events (task_key)"
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
  const collection = dao.findCollectionByNameOrId("blgsig0001evt");

  return dao.deleteCollection(collection);
})
