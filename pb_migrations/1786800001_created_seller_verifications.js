/// <reference path="../pb_data/types.d.ts" />
// 2026-07-18 신설 — GDC 상거래 완성 계획서(docs/gdc_commerce_completion_plan_v0_1.md)
// Phase 2. 판매자 자격 확인(verified_seller) 상태를 저장한다.
//
// 검증 방식(피터 확정): 정부24 앱에서 발급받은 사업자등록증을 첨부하는 것으로
// 인증한다. 단, worker.js에는 파일 바이너리 저장소(R2 등)가 없다(2026-07-12
// K-Gov REQUIRED_DOCUMENTS 작업 때 이미 확인된 제약, 그때와 동일한 한계를
// 그대로 물려받는다) — 따라서 원본 파일이 아니라 클라이언트가 계산한
// SHA-256 해시 + 파일명 + 크기만 "서류 소지 증명"으로 받는다. 실제 사업자
// 등록번호 진위 확인(국세청 API 연동)은 이번 범위 밖이다 — status는
// 'pending'으로 시작하고 별도 관리자 승인 절차로 'verified'/'rejected'로
// 전환하는 구조를 전제로 한다(승인 UI/절차는 이번 마이그레이션에 포함 안 함,
// 다음 배치 과제).
migrate((db) => {
  const collection = new Collection({
    "id": "svr7q3k1x9mz051",
    "created": "2026-07-18 00:00:00.000Z",
    "updated": "2026-07-18 00:00:00.000Z",
    "name": "seller_verifications",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false, "id": "svf001guid", "name": "guid",
        "type": "text", "required": true, "presentable": true, "unique": true,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "svf002status", "name": "status",
        "type": "select", "required": true, "presentable": true, "unique": false,
        "options": { "maxSelect": 1, "values": ["pending", "verified", "rejected"] }
      },
      {
        "system": false, "id": "svf003biz_reg_hash", "name": "biz_reg_hash",
        "type": "text", "required": true, "presentable": false, "unique": false,
        "options": { "min": 64, "max": 64, "pattern": "^[0-9a-f]{64}$" }
      },
      {
        "system": false, "id": "svf004biz_reg_filename", "name": "biz_reg_filename",
        "type": "text", "required": true, "presentable": false, "unique": false,
        "options": { "min": null, "max": 255, "pattern": "" }
      },
      {
        "system": false, "id": "svf005biz_reg_size", "name": "biz_reg_size",
        "type": "number", "required": true, "presentable": false, "unique": false,
        "options": { "min": 1, "max": null }
      },
      {
        "system": false, "id": "svf006submitted_at", "name": "submitted_at",
        "type": "date", "required": true, "presentable": false, "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false, "id": "svf007verified_at", "name": "verified_at",
        "type": "date", "required": false, "presentable": false, "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false, "id": "svf008reject_reason", "name": "reject_reason",
        "type": "text", "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_seller_verifications_guid ON seller_verifications (guid)",
      "CREATE INDEX idx_seller_verifications_status ON seller_verifications (status)"
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
  const collection = dao.findCollectionByNameOrId("seller_verifications");
  return dao.deleteCollection(collection);
});
