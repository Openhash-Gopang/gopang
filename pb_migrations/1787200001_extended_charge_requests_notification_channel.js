/// <reference path="../pb_data/types.d.ts" />
// ── 2026-08-12 신설: 방식C(관리자 폰 알림 캡처) 자동 확정 채널 추가.
// 1787000001_extended_charge_requests_dual_auto_channel.js가 만든 channel
// select 필드(manual_admin | auto_openbanking | auto_pg_webhook)에
// 'auto_notification_capture' 값 하나만 추가한다 — 필드 자체는 이미
// 있으므로 select options의 values 배열만 갱신하면 된다.
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("charge_requests");

  const field = collection.schema.getFieldByName("channel");
  if (field) {
    field.options.values = ["manual_admin", "auto_openbanking", "auto_pg_webhook", "auto_notification_capture"];
  }

  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("charge_requests");

  const field = collection.schema.getFieldByName("channel");
  if (field) {
    field.options.values = ["manual_admin", "auto_openbanking", "auto_pg_webhook"];
  }

  return dao.saveCollection(collection);
})
