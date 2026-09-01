/// <reference path="../pb_data/types.d.ts" />
// 2026-09-01 신설 — K-Mail(사용자 간 메일 기능) 1단계. "서울대 컴퓨터
// 관련 학과 교수들에게 보내줘" 같은 모호한 자연어 수신자 서술을 바로
// 발송하지 않고, 리서치 에이전트가 수집한 후보를 여기 pending_review로
// 스테이징 → 사용자 승인 후 confirmed로 바뀐 것만 실제 발송 대상이 되는
// 구조(설계 §2 "수신자 확정 파이프라인"). CONTACT_ADD 명령(주소록 추가만)도
// 동일 컬렉션·동일 승인 절차를 탄다.
migrate((db) => {
  const collection = new Collection({
    "id": "kmc0001contact",
    "created": "2026-09-01 00:00:00.000Z",
    "updated": "2026-09-01 00:00:00.000Z",
    "name": "kmail_contacts",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "kmc001owner",  "name": "owner_user_guid",  "type": "text",   "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "kmc002name",   "name": "name",             "type": "text",   "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "kmc003org",    "name": "org",              "type": "text",   "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "kmc004dept",   "name": "dept",             "type": "text",   "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "kmc005email",  "name": "email",            "type": "email",  "required": true,  "presentable": true,  "unique": false, "options": {} },
      { "system": false, "id": "kmc006tags",   "name": "tags",             "type": "json",   "required": false, "presentable": false, "unique": false, "options": {} },
      { "system": false, "id": "kmc007src",    "name": "source_url",       "type": "url",    "required": false, "presentable": false, "unique": false, "options": {} },
      { "system": false, "id": "kmc008conf",   "name": "confidence",       "type": "number", "required": false, "presentable": false, "unique": false, "options": { "min": 0, "max": 1 } },
      { "system": false, "id": "kmc009status", "name": "status",           "type": "select", "required": true,  "presentable": true,  "unique": false, "options": { "maxSelect": 1, "values": ["pending_review", "confirmed", "rejected"] } },
      { "system": false, "id": "kmc010query",  "name": "added_via_query",  "type": "text",   "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" }, "description": "이 연락처를 찾아낸 원본 자연어 명령 (예: '서울대 컴퓨터 관련 학과 교수들')" }
    ],
    "indexes": [
      "CREATE INDEX idx_kmail_contacts_owner ON kmail_contacts (owner_user_guid)",
      "CREATE INDEX idx_kmail_contacts_status ON kmail_contacts (status)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0001contact");
  return dao.deleteCollection(collection);
})
