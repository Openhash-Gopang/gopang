/// <reference path="../pb_data/types.d.ts" />
// ── 2026-07-15 신설: PDV 조회 감사 로그(_recordConsentEvent) 저장소.
// 공무원 직무보조 갱신계획 v1.0 §5 레이어 C(92번, 개인정보 오남용 감사)
// 요구사항 대응 — 423d246에서 코드는 추가됐지만 컬렉션 생성 스크립트가
// 누락돼 있었다(이번에 확인). "누가/언제/무슨 목적으로/몇 명분을
// 조회했는지"를 사후 감사 가능하게 남긴다.
migrate((db) => {
  const collection = new Collection({
    "id": "adn55pr750qug3c",
    "created": "2026-07-15 00:00:00.000Z",
    "updated": "2026-07-15 00:00:00.000Z",
    "name": "pdv_query_audit_log",
    "type": "base",
    "system": false,
    "schema": [
        { "system": false, "id": "alp0i3nffub7pe8", "name": "query_id",      "type": "text",   "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "du0k2j3galf5c54", "name": "ipv6",          "type": "text",   "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "s2rcv1cnhog4zfx", "name": "svc",           "type": "text",   "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "ni0w78fs7r1fevq", "name": "scope",         "type": "json",   "required": false, "presentable": false, "unique": false, "options": {} },
        { "system": false, "id": "keq2p9gv6f52m2v", "name": "purpose",       "type": "text",   "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "xn6g5chwvbzhkii", "name": "batch_size",    "type": "number", "required": false, "presentable": true,  "unique": false, "options": { "min": 0, "max": null } },
        { "system": false, "id": "akabodswq13puyy", "name": "official_guid", "type": "text",   "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "bsyds5app259bbk", "name": "official_org",  "type": "text",   "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "iatrl7tnhwlb1fx", "name": "official_role", "type": "text",   "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "y6j996s2lwml7f5", "name": "recorded_at",   "type": "date",   "required": true,  "presentable": true,  "unique": false, "options": { "min": "", "max": "" } }
    ],
    "indexes": [
        "CREATE INDEX idx_pdv_query_audit_log_ipv6 ON pdv_query_audit_log (ipv6)",
        "CREATE INDEX idx_pdv_query_audit_log_recorded_at ON pdv_query_audit_log (recorded_at)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
});
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("adn55pr750qug3c");
  return dao.deleteCollection(collection);
})
