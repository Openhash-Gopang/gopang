/// <reference path="../pb_data/types.d.ts" />
// 2026-08-20 신설 — report.js의 saveReportToSupabase/fetchReports가 참조하던
// Supabase school_reports 테이블의 PocketBase 이전. report_data는 주간/월간
// 보고서 전체(과목별 AI 코멘트·강점·다음주 계획 등 텍스트 포함)를 그대로
// 담는 json이라 maxSize를 넉넉히(50000) 잡았다 — 이 값을 비워두면
// 2026-08-20 account_risk_score와 같은 유형의 저장 실패가 재발한다.
migrate((db) => {
  const collection = new Collection({
    "id": "srp0001rpts",
    "created": "2026-08-20 00:00:00.000Z",
    "updated": "2026-08-20 00:00:00.000Z",
    "name": "school_reports",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "srp001guid", "name": "user_guid", "type": "text", "required": true, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "srp002type", "name": "report_type", "type": "select", "required": true, "presentable": true, "unique": false, "options": { "maxSelect": 1, "values": ["school_weekly_progress", "school_monthly_analysis"] } },
      { "system": false, "id": "srp003start", "name": "period_start", "type": "date", "required": true, "presentable": true, "unique": false, "options": {} },
      { "system": false, "id": "srp004end", "name": "period_end", "type": "date", "required": true, "presentable": true, "unique": false, "options": {} },
      { "system": false, "id": "srp005data", "name": "report_data", "type": "json", "required": true, "presentable": false, "unique": false, "options": { "maxSize": 50000 } },
      { "system": false, "id": "srp006pdv", "name": "pdv_entry_id", "type": "text", "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" } }
    ],
    "indexes": [
      "CREATE INDEX idx_srp_user_guid ON school_reports (user_guid)",
      "CREATE INDEX idx_srp_type ON school_reports (report_type)",
      "CREATE INDEX idx_srp_created ON school_reports (created)"
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
  const collection = dao.findCollectionByNameOrId("srp0001rpts");

  return dao.deleteCollection(collection);
})
