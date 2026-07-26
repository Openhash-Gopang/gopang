/// <reference path="../pb_data/types.d.ts" />
// 2026-07-26 신설 — desktop.html 클라이언트 연동(§9-3) 중 발견: match_offers는
// 프라이버시 최소화를 위해 driver_guid_hash(해시)만 저장했는데, 매칭 성사
// 후 승객이 GDC로 기사에게 직접 송금(wallet.sendGdc)하려면 원본 guid가
// 필요하다 — 해시로는 송금 대상을 지정할 수 없다. 실제 라이드쉐어 서비스도
// 매칭 성사 후에는 상대방 식별 정보를 공개하는 게 일반적이므로(승객이 누구
// 차를 탈지 알아야 함), offer 단계에서 원본 guid를 함께 저장하고 accept
// 응답에만 노출한다 — pending 상태에서 목록 조회 시엔 여전히 해시만 보이게
// 유지(handleMatchOfferSubmit/nearby 응답 로직은 변경하지 않음).
migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("match_offers")

  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "mch308drvguid",
    "name": "driver_guid",
    "type": "text",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": { "min": null, "max": 128, "pattern": "" }
  }))

  return dao.saveCollection(collection)
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("match_offers")
  collection.schema.removeField("mch308drvguid")
  return dao.saveCollection(collection)
})
