/// <reference path="../pb_data/types.d.ts" />
// 2026-09-01 신설 — K-Mail 1단계(메시지 단위 상태). Gmail류의 라벨/
// 별표/읽음 상태를 ai_messages 자체에 필드로 얹지 않고 별도 컬렉션으로
// 뺐다 — ai_messages는 gov-mail·K-Law 등 다른 기능도 공유하는 컬렉션
// 이라, K-Mail 전용 필드를 거기 얹으면 그 기능들 입장에서 의미 없는
// 컬럼이 계속 늘어난다. 대신 message_id로 ai_messages 레코드를
// 가리키는 얇은 부가정보 테이블로 둔다 — 사용자가 실제로 라벨을
// 달거나 별표 찍은 메시지에만 행이 생긴다(대부분의 메시지는 행 자체가
// 없는 게 정상).
migrate((db) => {
  const collection = new Collection({
    "id": "kmc0008msgst",
    "created": "2026-09-01 00:00:00.000Z",
    "updated": "2026-09-01 00:00:00.000Z",
    "name": "kmail_message_state",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "kms001msgid", "name": "message_id",       "type": "text",   "required": true,  "presentable": true,  "unique": true,  "options": { "min": null, "max": null, "pattern": "" }, "description": "ai_messages 레코드 id" },
      { "system": false, "id": "kms002owner", "name": "owner_user_guid",  "type": "text",   "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "kms003lbl",   "name": "labels",           "type": "json",   "required": false, "presentable": false, "unique": false, "options": { "maxSize": 2000000 } },
      { "system": false, "id": "kms004star",  "name": "starred",          "type": "bool",   "required": false, "presentable": true,  "unique": false, "options": {} },
      { "system": false, "id": "kms005read",  "name": "read_at",          "type": "date",   "required": false, "presentable": false, "unique": false, "options": { "min": "", "max": "" } }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_kmail_message_state_message_id ON kmail_message_state (message_id)",
      "CREATE INDEX idx_kmail_message_state_owner ON kmail_message_state (owner_user_guid)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0008msgst");
  return dao.deleteCollection(collection);
})
