/// <reference path="../pb_data/types.d.ts" />
// 2026-07-13 신설 — PDV 일상/업무 영역 완전 분할(주피터님 지시).
// domain='work'인 레코드는 handlePdvQuery/work-query 경로에서 일반
// consent만으로는 조회 불가 — affiliation_org_id가 요청자의 인증된
// 소속과 일치해야만 통과한다(worker.js _isAuthorizedForWorkDomain).
// affiliation_org_id는 select가 아니라 text — DEPT_TASK_TAXONOMY가
// 계속 늘어나는 개방형 목록이라 select maxSelect 고정 목록으로 묶지 않음.
migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("f02ztpjp0b2vc18") // pdv_records

  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "pdvdomn01",
    "name": "domain",
    "type": "select",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": {
      "maxSelect": 1,
      "values": ["personal", "work"]
    }
  }))

  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "pdvaffl01",
    "name": "affiliation_org_id",
    "type": "text",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": { "min": null, "max": null, "pattern": "" }
  }))

  return dao.saveCollection(collection)
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("f02ztpjp0b2vc18")
  collection.schema.removeField("pdvdomn01")
  collection.schema.removeField("pdvaffl01")
  return dao.saveCollection(collection)
})
