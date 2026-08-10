/// <reference path="../pb_data/types.d.ts" />
// ── 2026-08-10 신설: GDC 충전 자동화 방식 B(PG 가상계좌) 전용 컬렉션.
// 사용자가 "내 전용 가상계좌 발급받기"를 요청하면(charge.html 신규 UI),
// PG사(예: 다날/NHN KCP/토스페이먼츠) API로 그 사용자 전용 가상계좌를
// 발급받아 이 컬렉션에 guid↔계좌번호로 매핑해 둔다. 이후 그 계좌로
// 입금이 들어오면 PG가 POST /biz/charge-webhook-pg로 즉시 통지하고,
// 워커는 이 매핑으로 어느 guid에 GDC를 발행할지 조회한다 —
// 방식 A(매칭코드)와 달리 건별 charge_requests 사전 신청이 필요 없다
// (charge_requests 레코드는 웹훅 처리 시점에 status="matched"로 즉시
// 생성됨 — handleChargeWebhookPG 참고).
migrate((db) => {
  const collection = new Collection({
    "id": "vacc0000000001",
    "created": "2026-08-10 00:00:00.000Z",
    "updated": "2026-08-10 00:00:00.000Z",
    "name": "virtual_accounts",
    "type": "base",
    "system": false,
    "schema": [
        {
            "system": false, "id": "va00000000001", "name": "guid", "type": "text",
            "required": true, "presentable": true, "unique": true,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "가상계좌 소유 가입자 GUID (IPv6) — 1인 1계좌 원칙(unique)",
        },
        {
            "system": false, "id": "va00000000002", "name": "pg_provider", "type": "text",
            "required": true, "presentable": true, "unique": false,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "발급한 PG사 식별자(예: 'danal', 'kcp', 'tosspayments') — 웹훅 서명 검증 시 provider별 시크릿 분기용",
        },
        {
            "system": false, "id": "va00000000003", "name": "account_no", "type": "text",
            "required": true, "presentable": true, "unique": true,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "발급된 가상계좌 번호 — 웹훅 페이로드의 계좌번호로 이 필드를 조회해 guid를 역매핑",
        },
        {
            "system": false, "id": "va00000000004", "name": "bank_name", "type": "text",
            "required": false, "presentable": true, "unique": false,
            "options": { "min": null, "max": null, "pattern": "" },
        },
        {
            "system": false, "id": "va00000000005", "name": "status", "type": "select",
            "required": true, "presentable": true, "unique": false,
            "options": { "maxSelect": 1, "values": ["active", "expired", "revoked"] },
            "description": "PG사 가상계좌 만료 정책에 따라 주기 갱신 필요 — active가 아니면 웹훅 처리 시 거절",
        },
        {
            "system": false, "id": "va00000000006", "name": "expires_at", "type": "date",
            "required": false, "presentable": true, "unique": false,
            "options": { "min": "", "max": "" },
        },
    ],
    "indexes": [
        "CREATE UNIQUE INDEX idx_virtual_accounts_guid ON virtual_accounts (guid)",
        "CREATE UNIQUE INDEX idx_virtual_accounts_account_no ON virtual_accounts (account_no)",
    ],
    "listRule": null,
    "viewRule": null,
    "createRule": null,
    "updateRule": null,
    "deleteRule": null,
    "options": {},
  });

  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("vacc0000000001");
  return dao.deleteCollection(collection);
})

// 2026-08-10 재배포 트리거 (최초 배포 시 diff에서 누락됨)
