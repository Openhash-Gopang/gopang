/// <reference path="../pb_data/types.d.ts" />
// 2026-09-01 신설 — K-Mail 3단계(스레드 뮤트/스누즈). session_id
// (ai_messages.session_id와 동일 값 — kmail:<campaign_id> 또는
// kmail:direct:<guid>) 단위로 뮤트/스누즈 상태를 보관. 메시지 단위
// 상태(kmail_message_state, 1단계)와 별개 컬렉션인 이유: 뮤트/스누즈는
// "이 대화 전체"에 대한 설정이지 개별 메시지 속성이 아니라서, 같은
// 테이블에 욱여넣으면 의미가 헷갈린다.
migrate((db) => {
  const collection = new Collection({
    "id": "kmc0011thrst",
    "created": "2026-09-01 00:00:00.000Z",
    "updated": "2026-09-01 00:00:00.000Z",
    "name": "kmail_thread_state",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "kts001sid",    "name": "session_id",      "type": "text", "required": true,  "presentable": true,  "unique": true,  "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "kts002owner",  "name": "owner_user_guid", "type": "text", "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "kts003mute",   "name": "muted",           "type": "bool", "required": false, "presentable": true,  "unique": false, "options": {} },
      { "system": false, "id": "kts004snooze", "name": "snoozed_until",   "type": "date", "required": false, "presentable": true,  "unique": false, "options": { "min": "", "max": "" } }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_kmail_thread_state_session_id ON kmail_thread_state (session_id)",
      "CREATE INDEX idx_kmail_thread_state_owner ON kmail_thread_state (owner_user_guid)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0011thrst");
  return dao.deleteCollection(collection);
})
