/// <reference path="../pb_data/types.d.ts" />
// 2026-08-20 신설 — account_risk_score.score_basis(json)에 options.maxSize가
// 누락돼 실서버(l1-hanlim)에서 0으로 저장된 문제 수정.
// docs/POCKETBASE-STRUCTURE-GUIDE_v1_1_addendum_2026-07-19.md §5에 이미
// 경고된 PocketBase 0.22.x 숨은 필수값(json 타입은 options.maxSize 필수)을
// 원래 마이그레이션(1788000001)에서 놓쳤다 — 스모크 테스트로 실증된 원인.
// 관례대로 2000000(2MB)로 설정.
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("account_risk_score");
  const field = collection.schema.getFieldById("ars006basis");
  field.options.maxSize = 2000000;
  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("account_risk_score");
  const field = collection.schema.getFieldById("ars006basis");
  field.options.maxSize = 0;
  return dao.saveCollection(collection);
});
