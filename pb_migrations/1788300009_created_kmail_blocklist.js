/// <reference path="../pb_data/types.d.ts" />
// 2026-09-01 신설 — K-Mail 1단계(차단 목록). 회신 수집(_handleKmailInboundEmail)
// 에서 발신자가 차단 목록에 있으면 ai_messages 기록 자체를 건너뛰도록
// 다음 패치에서 연결할 것 — 이번 마이그레이션은 스키마만.
migrate((db) => {
  const collection = new Collection({
    "id": "kmc0009block",
    "created": "2026-09-01 00:00:00.000Z",
    "updated": "2026-09-01 00:00:00.000Z",
    "name": "kmail_blocklist",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "kbl001owner", "name": "owner_user_guid", "type": "text",  "required": true, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "kbl002email", "name": "blocked_email",   "type": "email", "required": true, "presentable": true, "unique": false, "options": {} }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_kmail_blocklist_owner_email ON kmail_blocklist (owner_user_guid, blocked_email)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0009block");
  return dao.deleteCollection(collection);
})
