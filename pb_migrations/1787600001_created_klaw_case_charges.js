/// <reference path="../pb_data/types.d.ts" />
// 2026-08-13 신설 — K-Law 사건단위 정액과금 중복방지 컬렉션.
//
// 2026-08-11/12에 worker.js(handleKlawRelay)가 이 컬렉션을 전제로 코드를
// 작성했는데, 정작 컬렉션 자체를 만드는 마이그레이션이 없었다 — L1
// hanlim 서버에도 실제로 존재하지 않는 상태였음이 라이브 스모크테스트
// (2026-08-13, docs/klaw_case_billing_thought_experiment_2026-08-13_
// narrative.md 후속 검증)로 뒤늦게 발견됐다. 그 결과 "동일 사건
// 재생성은 무료"라는 핵심 기능이 처음부터 한 번도 작동하지 않았고,
// 매 재생성마다 조용히 다시 과금되고 있었다(에러가 삼켜지고 로그만
// 남게 설계돼 있어 지금까지 아무도 못 알아챘다).
//
// (guid, case_id) 복합 유일 인덱스는 단순 중복방지를 넘어, worker.js의
// 과금 로직을 "확인 후 처리"에서 "선점 후 처리"로 재설계하는 데
// 필요한 원자적 락 역할도 겸한다(같은 세션 커밋 참고) — 두 STEP0
// 요청이 거의 동시에 도착해도 이 인덱스 덕분에 INSERT는 하나만
// 성공하므로, 이중 과금 레이스 창구 자체가 없어진다.
migrate((db) => {
  const collection = new Collection({
    "id": "klg0000charges",
    "created": "2026-08-13 00:00:00.000Z",
    "updated": "2026-08-13 00:00:00.000Z",
    "name": "klaw_case_charges",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false, "id": "klg00000001", "name": "guid", "type": "text",
        "required": true, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "klg00000002", "name": "case_id", "type": "text",
        "required": true, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" },
        "description": "클라이언트가 발급하는 UUID — 같은 사건의 재생성 전체에서 동일하게 유지됨"
      },
      {
        "system": false, "id": "klg00000003", "name": "claim_amount_krw", "type": "number",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": 0, "max": null, "noDecimal": false }
      },
      {
        "system": false, "id": "klg00000004", "name": "fee_krw", "type": "number",
        "required": false, "presentable": true, "unique": false,
        "options": { "min": 0, "max": null, "noDecimal": false },
        "description": "확정 청구액. 예약 직후(과금 시도 전)에는 0 — _klawFinalizeCaseCharge가 실제 결제 성공 후 채운다"
      },
      {
        "system": false, "id": "klg00000005", "name": "fee_tier", "type": "text",
        "required": false, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "klg00000006", "name": "verdict_count", "type": "number",
        "required": false, "presentable": true, "unique": false,
        "options": { "min": 1, "max": null, "noDecimal": true }
      },
      {
        "system": false, "id": "klg00000007", "name": "mint_content_hash", "type": "text",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "klg00000008", "name": "last_regen_at", "type": "date",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": "", "max": "" }
      }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_klaw_case_charges_guid_case ON klaw_case_charges (guid, case_id)"
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
  const collection = dao.findCollectionByNameOrId("klg0000charges");

  return dao.deleteCollection(collection);
})
