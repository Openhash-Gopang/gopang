/// <reference path="../pb_data/types.d.ts" />
// 2026-09-01 신설 — K-Mail 5단계, 캠페인 발송에도 첨부 지원. json
// 필드라 1788100001 사고(maxSize 누락)를 반복하지 않도록 이번엔
// 처음부터 maxSize를 명시한다.
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0002campaign");
  collection.schema.addField(new SchemaField({
    "system": false, "id": "kcp011attid", "name": "attachment_ids", "type": "json",
    "required": false, "presentable": false, "unique": false, "options": { "maxSize": 2000000 },
    "description": "kmail_attachments 레코드 id 배열 — 발신 시 _kmailResolveAttachmentsForSend가 R2에서 실제 바이트를 불러온다",
  }));
  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0002campaign");
  collection.schema.removeField("kcp011attid");
  return dao.saveCollection(collection);
})
