/// <reference path="../pb_data/types.d.ts" />
// 2026-08-13 신설 — 사고실험 사건7(미완결 유료 사건) 정책 결정: 즉시 환불.
//
// STEP0 결제 후 사용자가 STEP C까지 도달하지 못하고 이탈한 "미완결 유료
// 사건"을 감지해 즉시 환불하기 위한 추적 필드 2개를 klaw_case_charges에
// 추가한다.
//   - completed_at: 클라이언트가 STEP C 렌더링을 완료하고 POST
//     /klaw/case/complete를 호출하면 채워진다. 이게 채워진 사건은
//     환불 대상에서 제외된다.
//   - refunded_at: 이탈 신호(POST /klaw/case/abandon, navigator.sendBeacon)
//     를 받아 환불을 실행한 시각. 중복 환불 방지용(이미 채워져 있으면
//     재환불 스킵).
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("klg0000charges");

  collection.schema.addField(new SchemaField({
    "system": false, "id": "klg00000009", "name": "completed_at", "type": "date",
    "required": false, "presentable": true, "unique": false,
    "options": { "min": "", "max": "" },
    "description": "STEP C 완료 신호(POST /klaw/case/complete) 수신 시각 — 이게 있으면 환불 대상 아님"
  }));
  collection.schema.addField(new SchemaField({
    "system": false, "id": "klg00000010", "name": "refunded_at", "type": "date",
    "required": false, "presentable": true, "unique": false,
    "options": { "min": "", "max": "" },
    "description": "미완결 이탈로 환불 처리된 시각 — 중복 환불 방지용"
  }));

  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("klg0000charges");

  collection.schema.removeField("klg00000009");
  collection.schema.removeField("klg00000010");

  return dao.saveCollection(collection);
})
