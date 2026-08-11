/// <reference path="../pb_data/types.d.ts" />
// 2026-08-11 신설 — 재무제표/경영진단 실기능(사업자 티어 스코프만 항목
// 해소분)의 근거값. stock_qty(1784400001)와 동일한 하위호환 원칙: null
// 허용 필드를 기존 컬렉션에 추가만 한다 — 기존 seller_products 소비
// 코드는 이 필드를 몰라도 그대로 동작한다. 원가를 입력한 판매자만
// 실제 매출총이익(粗利)을 볼 수 있고, 입력 안 하면 매출액까지만 제공한다
// (지어낸 원가로 이익을 계산하지 않는다).
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("y5ug351pn59jxtn");
  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "sp_costprice001",
    "name": "cost_price",
    "type": "number",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": { "min": 0, "max": null, "noDecimal": false }
  }));
  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("y5ug351pn59jxtn");
  collection.schema.removeField("sp_costprice001");
  return dao.saveCollection(collection);
})
