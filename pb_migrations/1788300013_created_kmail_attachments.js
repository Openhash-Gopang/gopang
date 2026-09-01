/// <reference path="../pb_data/types.d.ts" />
// 2026-09-01 신설 — K-Mail 5단계(첨부파일). 실제 바이트는 여기 안 담고
// Cloudflare R2(hondi-kmail-attachments 버킷)에 저장 — 이 레코드는
// 메타데이터 + r2_key 참조만. message_id는 발신 완료 후(ai_messages
// 레코드가 생긴 뒤) 연결되고, 그 전(초안·발송 대기 상태)에는 비워둔
// 채로 owner_user_guid만으로 소유권을 추적한다.
//
// 저장 용량 과금(주피터 지시, 2026-09-01): 기본 1MB 무료, 초과분은
// OCI Object Storage 정가($0.0255/GB/월) 기준 10배 마진, 10MB 단위로
// 올림하여 10MB당 GDC 3 — size_bytes 합계를 월정기 크론이 집계해서
// 청구(kmail_user_settings.storage_next_billing_at 기준, 별도 스키마
// 없이 그 필드 하나만 재사용).
migrate((db) => {
  const collection = new Collection({
    "id": "kmc0013attach",
    "created": "2026-09-01 00:00:00.000Z",
    "updated": "2026-09-01 00:00:00.000Z",
    "name": "kmail_attachments",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "kat001owner", "name": "owner_user_guid", "type": "text",   "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "kat002msgid", "name": "message_id",      "type": "text",   "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" }, "description": "발신 완료 후 ai_messages 레코드 id로 연결. 발송 전(초안)엔 비어있음" },
      { "system": false, "id": "kat003fname", "name": "filename",        "type": "text",   "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": 255, "pattern": "" } },
      { "system": false, "id": "kat004mime",  "name": "content_type",    "type": "text",   "required": true,  "presentable": false, "unique": false, "options": { "min": null, "max": 255, "pattern": "" } },
      { "system": false, "id": "kat005size",  "name": "size_bytes",      "type": "number", "required": true,  "presentable": true,  "unique": false, "options": { "min": 0, "max": null } },
      { "system": false, "id": "kat006r2key", "name": "r2_key",          "type": "text",   "required": true,  "presentable": false, "unique": true,  "options": { "min": null, "max": null, "pattern": "" } }
    ],
    "indexes": [
      "CREATE INDEX idx_kmail_attachments_owner ON kmail_attachments (owner_user_guid)",
      "CREATE INDEX idx_kmail_attachments_message_id ON kmail_attachments (message_id)",
      "CREATE UNIQUE INDEX idx_kmail_attachments_r2_key ON kmail_attachments (r2_key)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0013attach");
  return dao.deleteCollection(collection);
})
