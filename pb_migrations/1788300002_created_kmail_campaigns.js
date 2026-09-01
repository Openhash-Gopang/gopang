/// <reference path="../pb_data/types.d.ts" />
// 2026-09-01 신설 — K-Mail 발송 단위. 하나의 "혼디야, ~보내고 회신 오면
// 모레 정오에 정리해줘" 명령이 캠페인 레코드 하나가 된다. contact_ids는
// kmail_contacts 중 status=confirmed로 승인된 것만 들어간다(설계 §2).
// 발송(send_at)과 다이제스트 취합(digest_at)은 Cron Trigger가 이 필드를
// 폴링해서 처리(설계 §5) — 별도 스케줄러 인프라 추가 없음.
migrate((db) => {
  const collection = new Collection({
    "id": "kmc0002campaign",
    "created": "2026-09-01 00:00:00.000Z",
    "updated": "2026-09-01 00:00:00.000Z",
    "name": "kmail_campaigns",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "kcp001owner",  "name": "owner_user_guid",       "type": "text",   "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "kcp002query",  "name": "recipient_query",       "type": "text",   "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "kcp003ids",    "name": "contact_ids",           "type": "json",   "required": false, "presentable": false, "unique": false, "options": {}, "description": "kmail_contacts 중 status=confirmed인 레코드 id 배열" },
      { "system": false, "id": "kcp004subj",   "name": "subject",               "type": "text",   "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "kcp005body",   "name": "body",                  "type": "text",   "required": true,  "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "kcp006sendat", "name": "send_at",               "type": "date",   "required": false, "presentable": true,  "unique": false, "options": { "min": "", "max": "" } },
      { "system": false, "id": "kcp007status", "name": "status",                "type": "select", "required": true,  "presentable": true,  "unique": false, "options": { "maxSelect": 1, "values": ["scheduled", "sent", "failed"] } },
      { "system": false, "id": "kcp008until",  "name": "collect_replies_until", "type": "date",   "required": false, "presentable": true,  "unique": false, "options": { "min": "", "max": "" } },
      { "system": false, "id": "kcp009digat",  "name": "digest_at",             "type": "date",   "required": false, "presentable": true,  "unique": false, "options": { "min": "", "max": "" } },
      { "system": false, "id": "kcp010digst",  "name": "digest_status",         "type": "select", "required": false, "presentable": true,  "unique": false, "options": { "maxSelect": 1, "values": ["none", "pending", "sent"] } }
    ],
    "indexes": [
      "CREATE INDEX idx_kmail_campaigns_owner ON kmail_campaigns (owner_user_guid)",
      "CREATE INDEX idx_kmail_campaigns_status ON kmail_campaigns (status)",
      "CREATE INDEX idx_kmail_campaigns_send_at ON kmail_campaigns (send_at)",
      "CREATE INDEX idx_kmail_campaigns_digest_at ON kmail_campaigns (digest_at)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0002campaign");
  return dao.deleteCollection(collection);
})
