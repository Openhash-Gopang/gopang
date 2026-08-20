/// <reference path="../pb_data/types.d.ts" />
// 2026-08-20 신설 — "일정표에 맞게 컨텐츠를 작성하고, 향후 여타 학습자가
// 재활용할 수 있도록 공개된 장소(GitHub)에 저장" 요구사항 대응. klaw
// 저장소가 이미 쓰고 있는 패턴(KLAW_REPO_API/KLAW_RAW_BASE로 GitHub 저장소
// 자체를 컨텐츠 스토어로 쓰는 방식, webapp.html 참고)을 school에도 그대로
// 적용한다 — 이 컬렉션은 PocketBase에 "메타데이터+GitHub 경로"만 두고,
// 실제 컨텐츠 본문은 school 저장소의 generated-content/ 하위에 커밋해서
// GitHub이 진짜 저장소가 되도록 한다(중복 저장 방지).
migrate((db) => {
  const collection = new Collection({
    "id": "scc0001catlg",
    "created": "2026-08-20 00:00:00.000Z",
    "updated": "2026-08-20 00:00:00.000Z",
    "name": "school_content_catalog",
    "type": "base",
    "system": false,
    "schema": [
      { "system": false, "id": "scc001subj", "name": "subject_id", "type": "text", "required": true, "presentable": true, "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
      { "system": false, "id": "scc002stage", "name": "stage", "type": "select", "required": true, "presentable": true, "unique": false, "options": { "maxSelect": 1, "values": ["kindergarten", "elementary", "middle", "high", "university", "graduate"] } },
      { "system": false, "id": "scc003topic", "name": "topic", "type": "text", "required": true, "presentable": true, "unique": false, "options": { "min": null, "max": 200, "pattern": "" } },
      { "system": false, "id": "scc004path", "name": "github_path", "type": "text", "required": true, "presentable": true, "unique": true, "options": { "min": null, "max": null, "pattern": "" }, "description": "예: generated-content/middle/math/이차방정식-01.md — Openhash-Gopang/school 저장소 기준 상대경로" },
      { "system": false, "id": "scc005bloom", "name": "bloom_level", "type": "number", "required": false, "presentable": true, "unique": false, "options": { "min": 1, "max": 6 } },
      { "system": false, "id": "scc006author", "name": "created_by_guid", "type": "text", "required": false, "presentable": false, "unique": false, "options": { "min": null, "max": null, "pattern": "" }, "description": "최초 생성을 유발한 학생 guid — 재사용 통계용, 접근권한과 무관(공개 컨텐츠)" },
      { "system": false, "id": "scc007reuse", "name": "reuse_count", "type": "number", "required": false, "presentable": true, "unique": false, "options": { "min": 0, "max": null } }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_scc_github_path ON school_content_catalog (github_path)",
      "CREATE INDEX idx_scc_subject_stage ON school_content_catalog (subject_id, stage)"
    ],
    "listRule": "",
    "viewRule": "",
    "createRule": null,
    "updateRule": null,
    "deleteRule": null,
    "options": {}
  });

  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("scc0001catlg");

  return dao.deleteCollection(collection);
})
