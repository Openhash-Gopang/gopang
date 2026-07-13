/// <reference path="../pb_data/types.d.ts" />
// 2026-07-13 신설 — GDC-재무제표-재고 연동 1단계. 기존 stock 필드는
// select(in/low/out) 3단계 상태값일 뿐 실제 수량이 아니었다 — 판매·매입
// 시 자동으로 증감시킬 수치 기반 재고 추적이 애초에 불가능한 구조였다.
// stock_qty(숫자, null 허용)를 추가한다: null=무제한/미추적(기존 상태와
// 동일한 기본 동작), 0=품절, N>0=N개. 기존 stock(select) 필드는 표시용
// 하위호환으로 그대로 유지하고, 서버 측에서 stock_qty로부터 자동
// 파생한다(worker.js handleCatalogSync 참조 — 같은 패치의 별도 변경).
migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("y5ug351pn59jxtn")

  // add
  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "stkqty01a",
    "name": "stock_qty",
    "type": "number",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": {
      "min": 0,
      "max": null,
      "noDecimal": true
    }
  }))

  return dao.saveCollection(collection)
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("y5ug351pn59jxtn")

  // remove
  collection.schema.removeField("stkqty01a")

  return dao.saveCollection(collection)
})
