/// <reference path="../pb_data/types.d.ts" />
// 2026-07-13 신설 — GDC-재무제표-재고 연동 4단계. 매출원가(COGS) 인식을
// 위해 상품별 매입원가를 저장한다. 절대 공개 카탈로그(GET /biz/catalog)
// 응답에 포함하지 않는다(worker.js handleCatalogGet에서 명시적으로
// 제외 — 같은 패치의 별도 변경) — 원가는 사업자 본인 외 누구에게도
// 노출되면 안 되는 데이터다(마진이 그대로 드러남).
migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("y5ug351pn59jxtn")

  // add
  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "costprc01",
    "name": "cost_price",
    "type": "number",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": {
      "min": 0,
      "max": null,
      "noDecimal": false
    }
  }))

  return dao.saveCollection(collection)
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("y5ug351pn59jxtn")

  // remove
  collection.schema.removeField("costprc01")

  return dao.saveCollection(collection)
})
