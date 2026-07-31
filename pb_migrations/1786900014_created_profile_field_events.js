/// <reference path="../pb_data/types.d.ts" />
// ── 2026-0X-XX 신설: 사용자가 PA(profile-assistant) 대화 중 자발적으로
// 필드를 추가·삭제 요청한 사건을 구조화 로그로 남긴다. industry_fields
// 자체(PROFILE_SUBMIT)에는 "지금 이 프로필에 이 필드가 있다/없다"만
// 남고 "왜 없는가"(한 번도 안 물어봄 vs 사용자가 명시적으로 거절함)를
// 구분할 방법이 없어서, renew_identity_templates.py의 존재-빈도 통계와
// 별개로 이 컬렉션을 신설한다 — 존재 여부만으로는 안 잡히는 "명시적
// 요청/거절" 신호를 그대로 보존하는 것이 목적(사용자 정의 필드 →
// 반복 요청 통계 → 다음 동종 사용자 템플릿 반영으로 이어지는 파이프라인의
// 원재료).
migrate((db) => {
  const collection = new Collection({
    "id": "xaji0y6dpbhsahx",
    "created": "2026-0X-XX 00:00:00.000Z",
    "updated": "2026-0X-XX 00:00:00.000Z",
    "name": "profile_field_events",
    "type": "base",
    "system": false,
    "schema": [
        { "system": false, "id": "thv3a3zmf8mdd4v", "name": "guid",         "type": "text", "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "30t9nt3w5uzbikc", "name": "entity_type",  "type": "text", "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "idkwnnhj7xvg0fn", "name": "category_key", "type": "text", "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "9xuy41ibljh75lx", "name": "field_key",    "type": "text", "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "o6qjiujv6oh9sdb", "name": "field_label",  "type": "text", "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "dw2pcn9t84azytj", "name": "action",       "type": "text", "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "b4t7dz3m6yqhrpc", "name": "context_sp",   "type": "text", "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" } }
    ],
    "indexes": [
        "CREATE INDEX idx_profile_field_events_category ON profile_field_events (category_key)",
        "CREATE INDEX idx_profile_field_events_action ON profile_field_events (action)",
        "CREATE INDEX idx_profile_field_events_field_key ON profile_field_events (field_key)",
        "CREATE INDEX idx_profile_field_events_guid ON profile_field_events (guid)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
});
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("xaji0y6dpbhsahx");
  return dao.deleteCollection(collection);
})
