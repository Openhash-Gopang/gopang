/// <reference path="../pb_data/types.d.ts" />
// 2026-09-01 신설 — K-Mail 5일 이동평균 발송 쿼터용 일별 집계
// (주피터 지시: 5일 평균 100통 초과분 1통당 GDC 10T 부과, 관리자 제외).
// user_guid+date 유니크 1행에 sent_count를 upsert — 캠페인이 여러 개라도
// 하루 총 발송량 하나로 합산되어야 이동평균 계산이 맞다. 발송 시점마다
// (오늘까지의 sent_count + 이번 1통) 기준 최근 5일 평균을 예측 계산해서
// 그 자리에서 초과 여부를 판정하는 방식(설계 "발송 쿼터" 참고) — 이
// 컬렉션은 그 계산에 필요한 일별 원자료만 담는다.
migrate((db) => {
  const collection = new Collection({
    "id": "kmc0004sendlog",
    "created": "2026-09-01 00:00:00.000Z",
    "updated": "2026-09-01 00:00:00.000Z",
    "name": "kmail_send_log",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "ksl001guid",  "name": "user_guid",  "type": "text",   "required": true, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "ksl002date",  "name": "date",       "type": "text",   "required": true, "presentable": true, "unique": false, "options": { "min": 10, "max": 10, "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" }, "description": "YYYY-MM-DD (KST 기준 하루 단위)" },
      { "system": false, "id": "ksl003cnt",   "name": "sent_count", "type": "number", "required": true, "presentable": true, "unique": false, "options": { "min": 0, "max": null } }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_kmail_send_log_user_date ON kmail_send_log (user_guid, date)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0004sendlog");
  return dao.deleteCollection(collection);
})
