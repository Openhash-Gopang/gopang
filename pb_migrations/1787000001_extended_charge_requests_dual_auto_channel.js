/// <reference path="../pb_data/types.d.ts" />
// ── 2026-08-10 신설: GDC 충전 자동화(방식 A 오픈뱅킹 폴링 + 방식 B PG
// 가상계좌 웹훅) 동시 지원을 위한 charge_requests 스키마 확장.
//
// 기존 흐름(수동, "관리자가 은행 앱 육안 확인 후 /biz/charge-confirm")은
// 그대로 유지하고, 아래 4개 필드만 추가한다 — 기존 레코드는 전부
// channel=null(구버전 데이터)로 남고, 신규 확정 건부터 값이 채워진다.
//
//   channel          : 이 충전이 어떤 경로로 확정됐는지
//                       ('manual_admin' | 'auto_openbanking' | 'auto_pg_webhook')
//   confirmed_by      : 감사 추적용 — 'admin' | 'system:openbanking' | 'system:pg_webhook'
//   external_tx_id    : 오픈뱅킹 거래고유번호 또는 PG 웹훅 거래ID.
//                        같은 거래가 중복 폴링/재전송돼도 두 번 민팅되지
//                        않도록 하는 멱등성 키(unique index, NULL 다건 허용
//                        — SQLite unique index는 NULL을 서로 다른 값으로
//                        취급하므로 기존 수동 확정 레코드(NULL)와 충돌 없음).
//   virtual_account_no: 방식 B(PG 가상계좌)로 입금된 경우, 그 가상계좌 번호.
//                        방식 A(매칭코드) 건에서는 항상 빈 값.
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("charge_requests");

  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "cr0000000011",
    "name": "channel",
    "type": "select",
    "required": false,
    "presentable": true,
    "unique": false,
    "options": { "maxSelect": 1, "values": ["manual_admin", "auto_openbanking", "auto_pg_webhook"] },
    "description": "확정 경로 — 기존 레코드는 비어있음(수동 확정으로 간주). 신규 확정부터 기록.",
  }));

  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "cr0000000012",
    "name": "confirmed_by",
    "type": "text",
    "required": false,
    "presentable": true,
    "unique": false,
    "options": { "min": null, "max": null, "pattern": "" },
    "description": "'admin' | 'system:openbanking' | 'system:pg_webhook' — 감사 추적용",
  }));

  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "cr0000000013",
    "name": "external_tx_id",
    "type": "text",
    "required": false,
    "presentable": true,
    "unique": false,
    "options": { "min": null, "max": null, "pattern": "" },
    "description": "오픈뱅킹 거래고유번호 또는 PG 웹훅 거래ID — 멱등성 키(unique index 별도)",
  }));

  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "cr0000000014",
    "name": "virtual_account_no",
    "type": "text",
    "required": false,
    "presentable": true,
    "unique": false,
    "options": { "min": null, "max": null, "pattern": "" },
    "description": "방식 B(PG 가상계좌)로 입금된 경우의 가상계좌 번호",
  }));

  collection.indexes = collection.indexes.concat([
    "CREATE UNIQUE INDEX idx_charge_requests_external_tx_id ON charge_requests (external_tx_id) WHERE external_tx_id IS NOT NULL AND external_tx_id != ''",
  ]);

  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("charge_requests");

  ["channel", "confirmed_by", "external_tx_id", "virtual_account_no"].forEach((name) => {
    const field = collection.schema.getFieldByName(name);
    if (field) collection.schema.removeField(field.id);
  });
  collection.indexes = collection.indexes.filter(
    (idx) => !idx.includes("idx_charge_requests_external_tx_id")
  );

  return dao.saveCollection(collection);
})
