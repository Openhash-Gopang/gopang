/// <reference path="../pb_data/types.d.ts" />
// 2026-08-20 신설 — K-Market_Architecture_Master_v1.0.md 항목 22
// "재무제표 기반 신용평가" 중 account_risk_score 컬렉션.
//
// 🔒 범위 경계 (반드시 지킬 것):
//   이 컬렉션과 trust-score.js(services/gopang-worker/src/lib/trust-score.js)는
//   순수 평판/리스크 지표만 다룬다. 대출 한도, 이자율, 채권 발행 조건 등
//   어떤 형태의 여신·가격결정에도 이 값을 입력값으로 쓰지 않는다.
//   대출/여신 관련 로직은 js/gdc-credit.js의 LEGAL-HOLD(2026-07-18) 대상이며,
//   대부업법 등록 여부가 확정되기 전까지는 이 컬렉션의 존재가 그 홀드를
//   해제하는 근거가 되지 않는다. trust_level을 참조하는 신규 코드를 작성할
//   때는 "대출/이자율/신용한도"라는 단어가 그 코드 경로에 등장하는지부터
//   확인할 것 — 등장하면 이 컬렉션이 아니라 gdc-credit.js 쪽 검토가 우선이다.
//
// 필드는 이미 사용 중이던 lib/account-risk.js(getAccountRisk/upsertAccountRisk)
// 및 routes/fraud.js의 사기 탐지 오버라이드(step_up_required, current_score,
// trust_level='L0')와 하위호환되도록 그대로 맞췄다.
migrate((db) => {
  const collection = new Collection({
    "id": "ars0001acctrsk",
    "created": "2026-08-20 00:00:00.000Z",
    "updated": "2026-08-20 00:00:00.000Z",
    "name": "account_risk_score",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false, "id": "ars001guid", "name": "guid",
        "type": "text", "required": true, "presentable": true, "unique": true,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "ars002score", "name": "current_score",
        "type": "number", "required": true, "presentable": true, "unique": false,
        "options": { "min": 0, "max": 100 }
      },
      {
        "system": false, "id": "ars003level", "name": "trust_level",
        "type": "select", "required": true, "presentable": true, "unique": false,
        "options": { "maxSelect": 1, "values": ["L0", "L1", "L2", "L3", "L4"] }
      },
      {
        "system": false, "id": "ars004cases", "name": "open_case_count",
        "type": "number", "required": false, "presentable": false, "unique": false,
        "options": { "min": 0, "max": null }
      },
      {
        "system": false, "id": "ars005stepup", "name": "step_up_required",
        "type": "bool", "required": false, "presentable": false, "unique": false,
        "options": {}
      },
      {
        "system": false, "id": "ars006basis", "name": "score_basis",
        "type": "json", "required": false, "presentable": false, "unique": false,
        "options": {}
      },
      {
        "system": false, "id": "ars007computed", "name": "last_computed_at",
        "type": "date", "required": false, "presentable": false, "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false, "id": "ars008source", "name": "computed_by",
        "type": "select", "required": false, "presentable": false, "unique": false,
        "options": { "maxSelect": 1, "values": ["batch", "fraud_override", "manual_review"] }
      }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_account_risk_score_guid ON account_risk_score (guid)",
      "CREATE INDEX idx_account_risk_score_level ON account_risk_score (trust_level)"
    ],
    "listRule": null,
    "viewRule": null,
    "createRule": null,
    "updateRule": null,
    "deleteRule": null
  });

  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("account_risk_score");
  return dao.deleteCollection(collection);
});
