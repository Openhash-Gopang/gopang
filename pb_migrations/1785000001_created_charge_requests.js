/// <reference path="../pb_data/types.d.ts" />
// ── 2026-07-14 신설: GDC 충전(계좌입금 인식) 파이프라인 — "고정계좌 +
// 입금자명 매칭" 방식(SP-GDC-BILLING-v2_0, PG·카드 배제 확정 반영).
// 사용자가 충전 신청(POST /biz/charge-request)을 하면 이 컬렉션에
// status="pending" 레코드가 생기고, 관리자가 은행 앱에서 실제 입금을
// 눈으로 확인한 뒤 POST /biz/charge-confirm으로 매칭 확정 → L1
// /api/mint 호출 → 이 레코드를 status="matched"로 갱신한다.
// SSH 접근이 없어 이 파일 자체는 "적용 안 됨" 상태로 남을 수 있다 —
// create-charge-requests-collection.ps1(Admin REST API 경유)이 동일한
// 결과를 만든다. 나중에 SSH 접근이 생기면 _migrations 시스템 테이블에
// 이 마이그레이션을 "이미 적용됨"으로 표시해 둘 것(다른 create-*.ps1
// 파일들과 동일한 관례 — 해당 파일 상단 주석 참고).
migrate((db) => {
  const collection = new Collection({
    "id": "chrg0000000001",
    "created": "2026-07-14 00:00:00.000Z",
    "updated": "2026-07-14 00:00:00.000Z",
    "name": "charge_requests",
    "type": "base",
    "system": false,
    "schema": [
        {
            "system": false,
            "id": "cr00000000001",
            "name": "guid",
            "type": "text",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "충전을 신청한 가입자 GUID (IPv6)"
        },
        {
            "system": false,
            "id": "cr00000000002",
            "name": "match_code",
            "type": "text",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "입금 시 '보내는 분 표시'에 포함해야 하는 짧은 코드(예: HD482910) — 관리자가 은행 앱 입금 내역과 대조하는 1차 단서"
        },
        {
            "system": false,
            "id": "cr00000000003",
            "name": "requested_krw",
            "type": "number",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": { "min": 0, "max": null },
            "description": "사용자가 신청한 희망 충전 금액(원) — 실제 입금액과 다를 수 있어 matched_krw와 분리"
        },
        {
            "system": false,
            "id": "cr00000000004",
            "name": "status",
            "type": "select",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": { "maxSelect": 1, "values": ["pending", "matched", "cancelled", "expired"] },
            "description": "pending(대기) → matched(관리자 확정+민팅 완료) | cancelled | expired(만료, 방치된 신청)"
        },
        {
            "system": false,
            "id": "cr00000000005",
            "name": "matched_krw",
            "type": "number",
            "required": false,
            "presentable": true,
            "unique": false,
            "options": { "min": 0, "max": null },
            "description": "관리자가 실제 입금 확인 후 확정한 금액(원) — requested_krw와 다를 수 있음(예: 사용자가 단수 조정해 입금)"
        },
        {
            "system": false,
            "id": "cr00000000006",
            "name": "depositor_name",
            "type": "text",
            "required": false,
            "presentable": true,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "관리자가 은행 명세서에서 실제로 본 입금자 표시명(감사 기록용)"
        },
        {
            "system": false,
            "id": "cr00000000007",
            "name": "mint_content_hash",
            "type": "text",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "매칭 확정 시 L1 /api/mint가 발급한 블록의 content_hash — GDC 발행 원장과의 대사(STEP 6) 근거"
        },
        {
            "system": false,
            "id": "cr00000000008",
            "name": "memo",
            "type": "text",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" }
        },
        {
            "system": false,
            "id": "cr00000000009",
            "name": "matched_at",
            "type": "date",
            "required": false,
            "presentable": true,
            "unique": false,
            "options": { "min": "", "max": "" }
        },
        {
            "system": false,
            "id": "cr00000000010",
            "name": "expires_at",
            "type": "date",
            "required": true,
            "presentable": false,
            "unique": false,
            "options": { "min": "", "max": "" },
            "description": "pending 상태가 이 시각을 넘기면 클라이언트/관리자 화면에서 만료로 취급(자동 삭제 아님 — 감사 기록 보존)"
        }
    ],
    "indexes": [
        "CREATE INDEX idx_charge_requests_guid ON charge_requests (guid)",
        "CREATE INDEX idx_charge_requests_status ON charge_requests (status)",
        "CREATE INDEX idx_charge_requests_match_code ON charge_requests (match_code)"
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
  const collection = dao.findCollectionByNameOrId("chrg0000000001");

  return dao.deleteCollection(collection);
})
