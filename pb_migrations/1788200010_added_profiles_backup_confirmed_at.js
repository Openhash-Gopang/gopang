/// <reference path="../pb_data/types.d.ts" />
// 2026-08-31 신설 — 백업 키 저장 확인 여부를 계정(guid) 단위로 서버에
// 기록한다. 지금까지 이 확인 상태는 각 브라우저의 localStorage에만
// 있어서, 폰에서 이미 백업을 저장한 사용자가 PC에서 device-link로
// 같은 계정을 열어도 PC 입장에선 "확인한 적 없음"이라 매번 경고
// 배너가 다시 떴다(2026-08-31 라이브 검증에서 재현 확인). worker.js의
// POST /auth/confirm-backup이 이 필드를 채우고, 로그인 시 이 값을
// 읽어 각 기기의 로컬 플래그(gopang_backup_confirmed_v1)를 채운다.
migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("1fjkz4szfer124h")

  // add
  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "bkupconf01",
    "name": "backup_confirmed_at",
    "type": "text",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": {
      "min": null,
      "max": null,
      "pattern": ""
    }
  }))

  return dao.saveCollection(collection)
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("1fjkz4szfer124h")

  // remove
  collection.schema.removeField("bkupconf01")

  return dao.saveCollection(collection)
})
