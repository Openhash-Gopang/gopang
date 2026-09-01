/// <reference path="../pb_data/types.d.ts" />
// 2026-09-01 신설 — K-Mail 5단계, 저장 용량 월정기 과금용 필드 추가.
// 별도 컬렉션(예: kmail_storage_billing) 대신 이미 있는
// kmail_user_settings(사용자당 1행)에 필드 하나만 얹었다 — 4단계에서
// 만든 이 컬렉션이 "사용자당 1행" 성격과 정확히 맞는다.
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0012usrst");
  collection.schema.addField(new SchemaField({
    "system": false, "id": "kus007snbat", "name": "storage_next_billing_at", "type": "date",
    "required": false, "presentable": true, "unique": false, "options": { "min": "", "max": "" },
    "description": "다음 저장용량 정산 예정 시각 — _runExpertPersonaBillingSweep과 동일 패턴의 월정기 크론이 참조",
  }));
  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0012usrst");
  collection.schema.removeField("kus007snbat");
  return dao.saveCollection(collection);
})
