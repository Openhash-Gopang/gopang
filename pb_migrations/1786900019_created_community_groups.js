/// <reference path="../pb_data/types.d.ts" />
// 2026-08-11 신설 — 시민 티어 미구현 항목(사회적 활동 관리·모임 추천).
// 알고리즘 매칭 데이터가 없어 "모임 생성·검색·참여의사 표시"까지만
// 구현 — 실제 대화는 기존 고팡 P2P 메시징으로 이어진다.
migrate((db) => {
  const collection = new Collection({
    "id": "cg19jp9sw3pu4jk",
    "created": "2026-08-11 00:00:00.000Z",
    "updated": "2026-08-11 00:00:00.000Z",
    "name": "community_groups",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "cg01creator", "name": "creator_guid", "type": "text", "required": true, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "cg02title", "name": "title", "type": "text", "required": true, "presentable": false, "unique": false, "options": { "min": null, "max": 100, "pattern": "" } },
      { "system": false, "id": "cg03category", "name": "category", "type": "text", "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": 40, "pattern": "" } },
      { "system": false, "id": "cg04desc", "name": "description", "type": "text", "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": 1000, "pattern": "" } },
      { "system": false, "id": "cg05status", "name": "status", "type": "select", "required": true, "presentable": false, "unique": false, "options": { "maxSelect": 1, "values": ["open", "closed"] } },
      { "system": false, "id": "cg06members", "name": "member_count", "type": "number", "required": false, "presentable": false, "unique": false, "options": { "min": 0, "max": null, "noDecimal": true } },
      { "system": false, "id": "cg07createdat", "name": "created_at", "type": "date", "required": false, "presentable": false, "unique": false, "options": { "min": "", "max": "" } }
    ],
    "indexes": ["CREATE INDEX `idx_community_groups_category` ON `community_groups` (`category`)"],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
  });
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("cg19jp9sw3pu4jk");
  return dao.deleteCollection(collection);
})
