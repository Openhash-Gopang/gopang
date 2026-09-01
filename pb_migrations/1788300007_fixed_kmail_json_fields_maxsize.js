/// <reference path="../pb_data/types.d.ts" />
// 2026-09-01 신설 — kmail_contacts.tags / kmail_campaigns.contact_ids
// (둘 다 json 타입)에 options.maxSize가 누락돼 실서버에서 0으로 저장된
// 문제 수정. docs/POCKETBASE-STRUCTURE-GUIDE_v1_1_addendum_2026-07-19.md
// §5에 이미 경고된 PocketBase 0.22.x 숨은 필수값(json 타입은
// options.maxSize 필수)을 원래 마이그레이션(1788300001/1788300002)에서
// 놓쳤다 — account_risk_score.score_basis 때와 정확히 같은 사고
// (1788100001_fixed_account_risk_score_basis_maxsize.js 참고), 이번엔
// K-Mail 라이브 스모크 테스트로 실증됐다: 캠페인 확정 단계에서
// "validation_json_size_limit: maximum allowed JSON size is 0 bytes"로
// 연락처 생성 자체가 막혀 있었다. 관례대로 2000000(2MB)로 설정.
migrate((db) => {
  const dao = new Dao(db);

  const contacts = dao.findCollectionByNameOrId("kmc0001contact");
  const tagsField = contacts.schema.getFieldById("kmc006tags");
  tagsField.options.maxSize = 2000000;
  dao.saveCollection(contacts);

  const campaigns = dao.findCollectionByNameOrId("kmc0002campaign");
  const idsField = campaigns.schema.getFieldById("kcp003ids");
  idsField.options.maxSize = 2000000;
  return dao.saveCollection(campaigns);
}, (db) => {
  const dao = new Dao(db);

  const contacts = dao.findCollectionByNameOrId("kmc0001contact");
  const tagsField = contacts.schema.getFieldById("kmc006tags");
  tagsField.options.maxSize = 0;
  dao.saveCollection(contacts);

  const campaigns = dao.findCollectionByNameOrId("kmc0002campaign");
  const idsField = campaigns.schema.getFieldById("kcp003ids");
  idsField.options.maxSize = 0;
  return dao.saveCollection(campaigns);
});
