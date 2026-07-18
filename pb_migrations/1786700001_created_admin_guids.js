/// <reference path="../pb_data/types.d.ts" />
// ── 2026-07-18 신설 — 플랫폼 공통 관리자 인증(handleVerifyAdmin).
// HONDI_GAP_REMEDIATION_DIRECTIVE v1.0 §2.3 참고. tax 하나만의 문제가
// 아니라 "로그인=관리자"로 착각하기 쉬운 구조적 공백이 여러 K-서비스
// 관리자 대시보드에 공통으로 있어, gopang 레벨에서 한 번만 설계한다.
//
// services 필드는 문자열 배열 — 특정 K-서비스(예: ["tax"])만 관리자로
// 등록하거나, 모든 서비스에 대해 관리자면 ["*"]로 등록한다.
// listRule/updateRule은 다른 L1 컬렉션과 동일하게 null(서버 관리자
// 토큰 경유만 허용) — 관리자 목록 자체가 민감정보라 클라이언트가
// 직접 조회할 수 없고, handleVerifyAdmin이 "이 guid가 admin인지
// true/false만" 응답한다(목록 자체는 절대 노출하지 않음).
migrate((db) => {
  const collection = new Collection({
    "id": "m06aq1yqszvs8af",
    "created": "2026-07-18 07:49:30.000Z",
    "updated": "2026-07-18 07:49:30.000Z",
    "name": "admin_guids",
    "type": "base",
    "system": false,
    "schema": [
        { "system": false, "id": "8al8zy82aieq1cm", "name": "guid",     "type": "text", "required": true,  "presentable": true,  "unique": true,  "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "qqjisay62j90erh", "name": "services", "type": "json", "required": true,  "presentable": true,  "unique": false, "options": { "maxSize": 2000000 } },
        { "system": false, "id": "vi23w897q5ovsft", "name": "note",     "type": "text", "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "av1898krvciz9ik", "name": "active",   "type": "bool", "required": false, "presentable": true,  "unique": false, "options": {} }
    ],
    "indexes": [ "CREATE UNIQUE INDEX idx_admin_guids_guid ON admin_guids (guid)" ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
});
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("m06aq1yqszvs8af");
  return dao.deleteCollection(collection);
})
