/// <reference path="../pb_data/types.d.ts" />
// 2026-07-28 — Pro/Flash 재설계와 함께 AC-PRO-CORE §DRAFT_REQUEST에
// risk_tier 판정 로직을 넣으면서(주피터님 지시: "불법·부당함이 확실하지
// 않으면 매번 승인부터 구하지 않는다 — 절차가 명확하고 생명·재산에
// 직결되지 않으면 선 수행 후 보고") worker.js handleSPAuthorQueue가
// payload.risk_tier를 받아 레코드에 저장하도록 바꿨다. 이 필드가 스키마에
// 없으면 PocketBase가 알 수 없는 필드로 처리할 위험이 있어(1784100001의
// 전례와 동일 원칙 — 필터링이 필요한 값은 extra JSON이 아니라 톱레벨
// select 필드로 둬야 인덱스를 탄다), 명시적으로 추가한다.
//
// 값은 화이트리스트 2개뿐 — worker.js 쪽에서도 'low'가 아니면 전부
// 'high'로 취급하는 안전한 기본값 처리를 이미 해뒀지만, 스키마 레벨에서도
// 동일하게 제한해 이중으로 막는다.
migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("a1d9f2b7c4e816")

  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "rsktier0001",
    "name": "risk_tier",
    "type": "select",
    "required": false,
    "presentable": true,
    "unique": false,
    "options": {
      "maxSelect": 1,
      "values": ["low", "high"]
    }
  }))

  return dao.saveCollection(collection)
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("a1d9f2b7c4e816")

  collection.schema.removeField("rsktier0001")

  return dao.saveCollection(collection)
})
