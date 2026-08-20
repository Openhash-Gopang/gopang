/// <reference path="../pb_data/types.d.ts" />
// 2026-08-20 신설 — 제주대학교 구상 1단계. school 저장소가 그동안 Supabase
// school_student_profiles 테이블을 썼는데, 2026-08-12 시크릿 사고 이후
// 자격증명이 비워진 채 PocketBase 이전이 안 되어 있던 것을 여기서 이전한다
// (klaw_cases와 동일 전례: Supabase→L1 hanlim PocketBase).
//
// 필드명은 새로 설계하지 않고 school/js/report.js가 이미 참조하던
// profile.display_name / c_score / p_score / cr_score / s_score / j_score /
// ai_replaceability 등을 그대로 유지했다 — report.js 쪽 수정 범위를
// "Supabase→PocketBase 호출부 교체"로만 좁히기 위함.
//
// 🔒 개인정보 주의: 미성년 학생의 실명·나이가 들어간다. klaw_cases처럼
// listRule/viewRule을 null(공개 조회)로 두면 안 되는 데이터지만, 이 플랫폼엔
// 아직 owner 기준 필터링을 강제할 PocketBase 네이티브 인증이 없다. 지금은
// 임시로 null로 두되, school 쪽 클라이언트가 반드시 guid 필터를 걸어서만
// 조회하도록 강제하고, 정식 인가 모델이 정해지기 전까지 프로덕션 개인정보로
// 신중히 취급할 것 (TODO로 남김 — 이 마이그레이션이 그 결정을 대신하지 않음).
migrate((db) => {
  const collection = new Collection({
    "id": "ssp0001stdprf",
    "created": "2026-08-20 00:00:00.000Z",
    "updated": "2026-08-20 00:00:00.000Z",
    "name": "school_student_profiles",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "ssp001guid", "name": "user_guid", "type": "text", "required": true, "presentable": true, "unique": true, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "ssp002name", "name": "display_name", "type": "text", "required": false, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "ssp003age", "name": "age", "type": "number", "required": false, "presentable": true, "unique": false, "options": { "min": 3, "max": 99 } },
      { "system": false, "id": "ssp004gender", "name": "gender", "type": "text", "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "ssp005stage", "name": "stage", "type": "select", "required": true, "presentable": true, "unique": false, "options": { "maxSelect": 1, "values": ["kindergarten", "elementary", "middle", "high", "university", "graduate"] } },
      { "system": false, "id": "ssp006region", "name": "region", "type": "text", "required": false, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" }, "description": "제주 읍면동/학교 소재 — 제주대학교 산하 초중고 매핑용" },
      { "system": false, "id": "ssp007pers", "name": "personality", "type": "text", "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": 500, "pattern": "" } },
      { "system": false, "id": "ssp008int", "name": "interests", "type": "text", "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": 500, "pattern": "" } },
      { "system": false, "id": "ssp009style", "name": "learning_style", "type": "select", "required": false, "presentable": false, "unique": false, "options": { "maxSelect": 1, "values": ["visual", "auditory", "kinesthetic", "reading"] } },
      { "system": false, "id": "ssp010c", "name": "c_score", "type": "number", "required": false, "presentable": false, "unique": false, "options": { "min": 0, "max": 100 } },
      { "system": false, "id": "ssp011p", "name": "p_score", "type": "number", "required": false, "presentable": false, "unique": false, "options": { "min": 0, "max": 100 } },
      { "system": false, "id": "ssp012cr", "name": "cr_score", "type": "number", "required": false, "presentable": false, "unique": false, "options": { "min": 0, "max": 100 } },
      { "system": false, "id": "ssp013s", "name": "s_score", "type": "number", "required": false, "presentable": false, "unique": false, "options": { "min": 0, "max": 100 } },
      { "system": false, "id": "ssp014j", "name": "j_score", "type": "number", "required": false, "presentable": false, "unique": false, "options": { "min": 0, "max": 100 } },
      { "system": false, "id": "ssp015ai", "name": "ai_replaceability", "type": "number", "required": false, "presentable": false, "unique": false, "options": { "min": 0, "max": 100 } },
      { "system": false, "id": "ssp016career", "name": "career_balance", "type": "text", "required": false, "presentable": true, "unique": false, "options": { "min": null, "max": 300, "pattern": "" } },
      { "system": false, "id": "ssp017util", "name": "utility_score", "type": "number", "required": false, "presentable": false, "unique": false, "options": { "min": 0, "max": 1 } },
      { "system": false, "id": "ssp018happy", "name": "happiness_score", "type": "number", "required": false, "presentable": false, "unique": false, "options": { "min": 0, "max": 1 } },
      { "system": false, "id": "ssp019onbrd", "name": "onboarding_completed", "type": "bool", "required": false, "presentable": true, "unique": false, "options": {} }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_ssp_user_guid ON school_student_profiles (user_guid)",
      "CREATE INDEX idx_ssp_stage ON school_student_profiles (stage)"
    ],
    "listRule": null,
    "viewRule": null,
    "createRule": null,
    "updateRule": null,
    "deleteRule": null,
    "options": {}
  });

  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("ssp0001stdprf");

  return dao.deleteCollection(collection);
})
