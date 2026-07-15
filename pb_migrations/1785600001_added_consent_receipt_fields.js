/// <reference path="../pb_data/types.d.ts" />
// 2026-07-15 — PERSONAL-AC-CALL-PROTOCOL_v1_0 §5 수신확인 3단계
// (sent→delivered→acknowledged) 구현. sent는 _sendPushToGuid 호출
// 자체로 이미 기록되므로(감사로그), 여기선 delivered/acknowledged
// 2개 시각만 pdv_consent_requests에 추가한다 — 두 값 다 null이면
// "발송은 됐으나 도달·인지 여부 불명"(사고실험에서 짚은 "실패의
// 책임 소재" 구분의 근거 데이터가 된다).
migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("p1tketkfid3uup8")

  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "dlvrdat01",
    "name": "delivered_at",
    "type": "date",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": { "min": "", "max": "" }
  }))

  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "acknwat01",
    "name": "acknowledged_at",
    "type": "date",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": { "min": "", "max": "" }
  }))

  return dao.saveCollection(collection)
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("p1tketkfid3uup8")

  collection.schema.removeField("dlvrdat01")
  collection.schema.removeField("acknwat01")

  return dao.saveCollection(collection)
})
