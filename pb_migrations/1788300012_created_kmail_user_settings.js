/// <reference path="../pb_data/types.d.ts" />
// 2026-09-01 신설 — K-Mail 4단계(계정 설정). 사용자당 1행(owner_user_guid
// 유니크) — 서명, 발신자 표시 이름(지금까지 _kmailSendOneEmail에
// '혼디 K-Mail'로 하드코딩돼 있던 것), 부재중 자동응답 설정을 담는다.
migrate((db) => {
  const collection = new Collection({
    "id": "kmc0012usrst",
    "created": "2026-09-01 00:00:00.000Z",
    "updated": "2026-09-01 00:00:00.000Z",
    "name": "kmail_user_settings",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "kus001owner", "name": "owner_user_guid",    "type": "text", "required": true,  "presentable": true,  "unique": true,  "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "kus002sig",   "name": "signature",          "type": "text", "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": 1000, "pattern": "" } },
      { "system": false, "id": "kus003name",  "name": "sender_display_name","type": "text", "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": 100, "pattern": "" } },
      { "system": false, "id": "kus004arep",  "name": "auto_reply_enabled", "type": "bool", "required": false, "presentable": true,  "unique": false, "options": {} },
      { "system": false, "id": "kus005artx",  "name": "auto_reply_text",    "type": "text", "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": 2000, "pattern": "" } },
      { "system": false, "id": "kus006aruntil","name": "auto_reply_until",  "type": "date", "required": false, "presentable": true,  "unique": false, "options": { "min": "", "max": "" } }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_kmail_user_settings_owner ON kmail_user_settings (owner_user_guid)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0012usrst");
  return dao.deleteCollection(collection);
})
