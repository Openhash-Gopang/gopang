/// <reference path="../pb_data/types.d.ts" />
// 2026-09-01 신설 — K-Mail 1단계(임시보관함). "저장만 해두고 나중에
// 보낼게" 시나리오 — kmail_campaigns와 다르다: 캠페인은 send_at이
// 확정된 예약 발송이고, 초안은 발송 시각조차 아직 안 정해진 상태다.
// 발송 확정되는 순간 이 레코드는 지우고 kmail_campaigns로 넘어간다
// (초안→캠페인 전이는 다음 패치에서 API로 연결).
migrate((db) => {
  const collection = new Collection({
    "id": "kmc0010draft",
    "created": "2026-09-01 00:00:00.000Z",
    "updated": "2026-09-01 00:00:00.000Z",
    "name": "kmail_drafts",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "kdr001owner", "name": "owner_user_guid", "type": "text", "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "kdr002to",    "name": "recipients",      "type": "json", "required": false, "presentable": false, "unique": false, "options": { "maxSize": 2000000 }, "description": "확정 전 초안 수신자 [{name,email}] — kmail_contacts와 무관, 자유 입력" },
      { "system": false, "id": "kdr003subj",  "name": "subject",         "type": "text", "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "kdr004body",  "name": "body",            "type": "text", "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" } }
    ],
    "indexes": [
      "CREATE INDEX idx_kmail_drafts_owner ON kmail_drafts (owner_user_guid)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0010draft");
  return dao.deleteCollection(collection);
})
