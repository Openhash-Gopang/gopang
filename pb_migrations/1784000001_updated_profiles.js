/// <reference path="../pb_data/types.d.ts" />
// 2026-07-12 — Supabase→L1 이관 완성 작업.
//
// 지금까지 name/address/lat/lng/occupation이 전부 extra(json) 안에
// (extra.core.name 등으로) 접혀 있었다 — Supabase 쪽 컬럼 수를 안
// 늘리기 위한 절약이었는데, 이 때문에 L1만으로는 검색(search_entities
// RPC가 하던 일: 이름/주소/업종 텍스트매칭 + 거리정렬)을 구현할 수
// 없었다. PocketBase는 JSON 내부 경로 필터가 인덱스를 안 타 성능이
// 나쁘고, 이 프로젝트에서 그런 필터를 쓴 전례도 없다 — 검색용 필드는
// 톱레벨로 승격하는 게 안전하다.
//
// _l1UpsertProfile()이 이제 이 필드들도 함께 채운다(extra.core는
// 하위호환을 위해 유지 — 기존 코드가 참조하는 곳이 있을 수 있어
// 당장 제거하지 않는다).
migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("1fjkz4szfer124h")

  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "srch_name01",
    "name": "name",
    "type": "text",
    "required": false,
    "presentable": true,
    "unique": false,
    "options": { "min": null, "max": null, "pattern": "" }
  }))

  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "srch_addr01",
    "name": "address",
    "type": "text",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": { "min": null, "max": null, "pattern": "" }
  }))

  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "srch_lat001",
    "name": "lat",
    "type": "number",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": { "min": -90, "max": 90, "noDecimal": false }
  }))

  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "srch_lng001",
    "name": "lng",
    "type": "number",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": { "min": -180, "max": 180, "noDecimal": false }
  }))

  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "srch_occp01",
    "name": "occupation",
    "type": "text",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": { "min": null, "max": null, "pattern": "" }
  }))

  // 검색어 매칭용 — 공백으로 구분된 키워드 문자열(전문검색 tsvector
  // 대체품, 단순화됨). name/handle/설명/태그를 채워질 때 합쳐 넣는다.
  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "srch_text001",
    "name": "search_text",
    "type": "text",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": { "min": null, "max": null, "pattern": "" }
  }))

  return dao.saveCollection(collection)
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("1fjkz4szfer124h")

  collection.schema.removeField("srch_name01")
  collection.schema.removeField("srch_addr01")
  collection.schema.removeField("srch_lat001")
  collection.schema.removeField("srch_lng001")
  collection.schema.removeField("srch_occp01")
  collection.schema.removeField("srch_text001")

  return dao.saveCollection(collection)
})
