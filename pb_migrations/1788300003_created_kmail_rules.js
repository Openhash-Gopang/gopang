/// <reference path="../pb_data/types.d.ts" />
// 2026-09-01 신설 — K-Mail 인바운드 필터 규칙("혼디야, 나에게 불필요한
// 내용의 메일은 도착 즉시 삭제해"). rule_text는 자연어 원문 그대로 저장 —
// 판정은 매 수신 메일마다 worker.js의 email() 핸들러가 이 텍스트를 LLM
// 분류기에 넘겨 실시간으로 한다(설계 §5). action은 지금은 auto_delete
// 하나뿐이지만 select로 둬서 이후 확장 가능하게 함.
// ⚠️ 삭제 판정은 소프트 삭제로만 구현할 것(설계 §6) — 이 컬렉션 자체는
// 규칙 정의만 담고, 실제 삭제 로직/이력은 ai_messages 쪽에서 처리.
migrate((db) => {
  const collection = new Collection({
    "id": "kmc0003rule",
    "created": "2026-09-01 00:00:00.000Z",
    "updated": "2026-09-01 00:00:00.000Z",
    "name": "kmail_rules",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "krl001owner",  "name": "owner_user_guid", "type": "text",   "required": true, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "krl002text",   "name": "rule_text",       "type": "text",   "required": true, "presentable": true,  "unique": false, "options": { "min": null, "max": 500, "pattern": "" } },
      { "system": false, "id": "krl003action", "name": "action",         "type": "select", "required": true, "presentable": true,  "unique": false, "options": { "maxSelect": 1, "values": ["auto_delete"] } },
      { "system": false, "id": "krl004enab",   "name": "enabled",        "type": "bool",   "required": false, "presentable": true,  "unique": false, "options": {} }
    ],
    "indexes": [
      "CREATE INDEX idx_kmail_rules_owner ON kmail_rules (owner_user_guid)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0003rule");
  return dao.deleteCollection(collection);
})
