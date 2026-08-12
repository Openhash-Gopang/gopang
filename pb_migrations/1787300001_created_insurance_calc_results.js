/// <reference path="../pb_data/types.d.ts" />
// 2026-08-12 신설 — K-Insurance(insurance.hondi.net)의 월별 보험료 산출
// 결과 저장소. 기존 Supabase(insurance_calc_results) 테이블을 대체한다
// (2026-08-12 시크릿 유출 인시던트 대응의 일환, README_SECRETS_INCIDENT.md
// 참조). 원본 Supabase 스키마는 insurance 저장소의 js/report.js 파일 끝
// 주석에 남아있다 — 컬럼 구성은 그대로 옮기되 jsonb는 PocketBase json
// 타입으로, bigserial PK는 PocketBase 기본 id로 대체.
// citizen_schedule/community_groups와 동일 MVP 컨벤션(guid 소유, API
// 규칙 전부 null — 클라이언트는 hondi-proxy를 통해서만 접근, 직접 PB
// 접근 불가. worker.js의 handleInsuranceCalcLatest/Save 참조).
migrate((db) => {
  const collection = new Collection({
    "id": "ic22kt7mx5wb3fn",
    "created": "2026-08-12 00:00:00.000Z",
    "updated": "2026-08-12 00:00:00.000Z",
    "name": "insurance_calc_results",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "ic01calcid", "name": "calc_id", "type": "text", "required": true, "presentable": false, "unique": true, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "ic02userguid", "name": "user_guid", "type": "text", "required": true, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "ic03pstart", "name": "period_start", "type": "date", "required": true, "presentable": false, "unique": false, "options": { "min": "", "max": "" } },
      { "system": false, "id": "ic04pend", "name": "period_end", "type": "date", "required": true, "presentable": false, "unique": false, "options": { "min": "", "max": "" } },
      { "system": false, "id": "ic05monthly", "name": "monthly_total", "type": "number", "required": true, "presentable": false, "unique": false, "options": { "min": 0, "max": null, "noDecimal": false } },
      { "system": false, "id": "ic06risk", "name": "risk_profile", "type": "text", "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": 20, "pattern": "" } },
      { "system": false, "id": "ic07calcdata", "name": "calc_data", "type": "json", "required": false, "presentable": false, "options": {} },
      { "system": false, "id": "ic08pdvid", "name": "pdv_entry_id", "type": "text", "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "ic09model", "name": "model", "type": "text", "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": 60, "pattern": "" } },
      { "system": false, "id": "ic10calcat", "name": "calc_at", "type": "date", "required": true, "presentable": false, "unique": false, "options": { "min": "", "max": "" } }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX `idx_insurance_calc_results_calc_id` ON `insurance_calc_results` (`calc_id`)",
      "CREATE INDEX `idx_insurance_calc_results_user_guid_calc_at` ON `insurance_calc_results` (`user_guid`, `calc_at`)",
      "CREATE INDEX `idx_insurance_calc_results_user_guid_period_start` ON `insurance_calc_results` (`user_guid`, `period_start`)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("ic22kt7mx5wb3fn");
  return dao.deleteCollection(collection);
})
