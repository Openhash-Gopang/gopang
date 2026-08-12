/// <reference path="../pb_data/types.d.ts" />
// 2026-08-13 신설 — klaw(Openhash-Gopang/klaw 저장소) dashboard.html의
// 관리자 인증(기기지문 기반)이 쓰던 Supabase users 테이블을 PocketBase
// (L1 hanlim)로 이전. klaw_cases/klaw_benchmark/klaw_sessions(동시 브랜치,
// 5754b1ee)와 겹치지 않는 부분이라 별도 마이그레이션으로 신설한다.
//
// 원 Supabase users 테이블은 guid를 PK로 썼으나, PocketBase 레코드 id는
// 15자 고정이라 guid를 그대로 id로 재사용하지 않는다(klaw_cases의 case_no와
// 동일한 이유) — guid는 별도 unique 인덱스 필드, id는 PocketBase 기본
// 자동생성에 맡긴다. registered_at도 Supabase 커스텀 컬럼 대신 PocketBase
// 기본 제공 created 시스템 필드로 대체(값을 클라이언트가 보내도 서버가
// 무시하고 created를 씀).
//
// 이 컬렉션은 관리자 인증 판별에 쓰이므로 seller_reviews/klaw_cases 등과
// 달리 listRule을 열어두지 않는다(다른 사람의 guid/is_admin을 목록 조회로
// 긁어갈 수 없도록) — API 규칙은 전부 null로 두고 worker.js가 L1 admin
// 토큰으로만 접근, 클라이언트는 반드시 worker.js 프록시 경유.
migrate((db) => {
  const collection = new Collection({
    "id": "klu0000adminus",
    "created": "2026-08-13 00:00:00.000Z",
    "updated": "2026-08-13 00:00:00.000Z",
    "name": "klaw_admin_users",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false, "id": "klu00000001", "name": "guid", "type": "text",
        "required": true, "presentable": true, "unique": true,
        "options": { "min": null, "max": null, "pattern": "" },
        "description": "고팡 GUID (URL 파라미터 경유 또는 기기지문 등록 시 발급)"
      },
      {
        "system": false, "id": "klu00000002", "name": "device_fp", "type": "text",
        "required": true, "presentable": true, "unique": true,
        "options": { "min": null, "max": null, "pattern": "" },
        "description": "기기지문(SHA-256) — UA+언어+화면크기+타임존+코어수 조합"
      },
      {
        "system": false, "id": "klu00000003", "name": "phone", "type": "text",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "klu00000004", "name": "is_admin", "type": "bool",
        "required": false, "presentable": true, "unique": false,
        "options": {}
      }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_klaw_admin_users_guid ON klaw_admin_users (guid)",
      "CREATE UNIQUE INDEX idx_klaw_admin_users_device_fp ON klaw_admin_users (device_fp)"
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
  const collection = dao.findCollectionByNameOrId("klu0000adminus");

  return dao.deleteCollection(collection);
})
