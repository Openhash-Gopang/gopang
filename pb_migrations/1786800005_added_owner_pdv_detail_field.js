/// <reference path="../pb_data/types.d.ts" />
// 2026-07-20 신설 — owner_pdv에 detail(JSON) 필드 추가.
//
// 배경: K-Law 재검토 결과, 가상 판결문(webapp.html)과 벤치마크 평가
// (benchmark.html, 기존 saveBenchRecord() — 실제 판결문과 즉시 대조해 채점,
// klaw_benchmark Supabase 테이블에 이미 저장 중이었음을 확인)는 own_output
// 레코드에 case_no·klaw_version·score_total·grade 등 K-서비스마다 다른
// 구조화 데이터를 담아야 한다. own_output이 K-서비스마다 스키마가 다르다는
// 원칙(SP_PDV v1.2 §7.1)에 따라 표준 컬럼을 늘리는 대신 JSON 필드 하나로
// 수용한다. consultation 레코드는 이 필드를 쓰지 않는다(항상 null —
// gwp-report-client.js recordOwnerPDV()가 강제).
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("owner_pdv");
  collection.schema.addField(new SchemaField({
    "system": false, "id": "opv113detail", "name": "detail",
    "type": "json", "required": false, "presentable": false, "unique": false,
    "options": { "maxSize": 20000 }
  }));
  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("owner_pdv");
  collection.schema.removeField("opv113detail");
  return dao.saveCollection(collection);
});
