/// <reference path="../pb_data/types.d.ts" />
// 2026-08-15 신설 — 전문가 페르소나(리프) 개별 구독. user_subscriptions(시민
// 990원 단일 티어)와는 별개 축이다: 시민 티어는 "혼디 기본 이용" 자격이고,
// 이 컬렉션은 "특정 전문가 페르소나(리프) 하나를 계속 쓸 자격"이다 — 같은
// 사용자가 여러 리프를 구독하면 리프마다 별도 레코드가 생긴다(복합 유일키
// user_guid+persona_id). 중간 노드(physician/lawyer/professor 트리의
// 비-리프 노드)는 이 컬렉션에 레코드를 만들지 않는다 — 과금 대상이 아니기
// 때문(주피터 결정, 2026-08-15).
//
// 스키마는 user_subscriptions와 동일 패턴(status/billing_amount_krw/
// next_billing_at/last_billed_at/last_billing_result/grace_started_at)을
// 따르되, "첫 1개월 무료" 정책 때문에 신규 가입 시점엔 실제 청구를 하지
// 않는다 — last_billing_result='free_trial'로 표시하고 next_billing_at을
// 가입일+1개월(=최초 실 청구 시도일)로 잡아둔다. 별도 free_trial 상태값을
// 두지 않고 기존 status(active/grace/suspended) 위에서 last_billing_result로
// "이번이 무료였는지 실제 결제였는지"만 구분한다 — 스윕 로직(월정기 결제
// 스윕)이 user_subscriptions와 동일 코드 경로를 그대로 재사용할 수 있도록
// 하기 위함.
migrate((db) => {
  const collection = new Collection({
    "id": "eps1pers0nasub",
    "created": "2026-08-15 00:00:00.000Z",
    "updated": "2026-08-15 00:00:00.000Z",
    "name": "expert_persona_subscriptions",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false, "id": "eps1guid", "name": "user_guid", "type": "text",
        "required": true, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "eps2persona", "name": "persona_id", "type": "text",
        "required": true, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "eps3status", "name": "status", "type": "select",
        "required": true, "presentable": false, "unique": false,
        "options": { "maxSelect": 1, "values": ["active", "grace", "suspended"] }
      },
      {
        "system": false, "id": "eps4amount", "name": "billing_amount_krw", "type": "number",
        "required": true, "presentable": false, "unique": false,
        "options": { "min": 0, "max": null, "noDecimal": true }
      },
      {
        "system": false, "id": "eps5next", "name": "next_billing_at", "type": "date",
        "required": true, "presentable": false, "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false, "id": "eps6last", "name": "last_billed_at", "type": "date",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false, "id": "eps7result", "name": "last_billing_result", "type": "select",
        "required": false, "presentable": false, "unique": false,
        "options": { "maxSelect": 1, "values": ["free_trial", "success", "insufficient_balance", "error"] }
      },
      {
        "system": false, "id": "eps8graceat", "name": "grace_started_at", "type": "date",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false, "id": "eps9createdat", "name": "created_at", "type": "date",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": "", "max": "" }
      }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX `idx_expert_persona_subscriptions_guid_persona` ON `expert_persona_subscriptions` (`user_guid`, `persona_id`)",
      "CREATE INDEX `idx_expert_persona_subscriptions_next_billing` ON `expert_persona_subscriptions` (`next_billing_at`)"
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
  const collection = dao.findCollectionByNameOrId("eps1pers0nasub");

  return dao.deleteCollection(collection);
})
