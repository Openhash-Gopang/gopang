/// <reference path="../pb_data/types.d.ts" />
// 2026-08-20 신설 — desktop.html/dashboard.html의 학생 대시보드가
// school_student_profiles에서 native_language, career_personal,
// career_primary를 참조하는데 1788200001 마이그레이션엔 report.js가
// 쓰는 필드만 옮겨서 빠져있었다. 대시보드까지 같은 세션에서 마저 고치며
// 뒤늦게 발견 — 여기서 추가한다(선행 마이그레이션을 수정하지 않고
// alter로 별도 파일을 두는 기존 관례를 따름, 예: altered_org_profiles_*).
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("ssp0001stdprf");

  collection.schema.addField(new SchemaField({
    "system": false, "id": "ssp020lang", "name": "native_language", "type": "text",
    "required": false, "presentable": false, "unique": false,
    "options": { "min": null, "max": null, "pattern": "" }
  }));
  collection.schema.addField(new SchemaField({
    "system": false, "id": "ssp021cpers", "name": "career_personal", "type": "text",
    "required": false, "presentable": false, "unique": false,
    "options": { "min": null, "max": 200, "pattern": "" },
    "description": "학생 본인이 희망하는 진로 — career_balance(균형점)와 구분"
  }));
  collection.schema.addField(new SchemaField({
    "system": false, "id": "ssp022cprim", "name": "career_primary", "type": "text",
    "required": false, "presentable": false, "unique": false,
    "options": { "min": null, "max": 200, "pattern": "" },
    "description": "career_personal 폴백값(desktop.html이 career_personal||career_primary로 사용)"
  }));

  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("ssp0001stdprf");

  collection.schema.removeField("ssp020lang");
  collection.schema.removeField("ssp021cpers");
  collection.schema.removeField("ssp022cprim");

  return dao.saveCollection(collection);
})
