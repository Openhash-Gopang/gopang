/// <reference path="../pb_data/types.d.ts" />
// ── 2026-07-16 신설: KOSIS 리졸버(resolveGovData) 검색·매칭 로그 저장소.
// `resolveGovData-최소버전설계_v1.0_2026-07-16.md` §3 요구사항 대응.
//
// pdv_query_audit_log(1785500001)와 별도 컬렉션인 이유: 그쪽은 개인정보(PDV) 조회
// 감사용으로 batch_size/official_guid 등 개인 조회 전제 필드가 핵심이라, 성격이
// 다른 KOSIS 검색 로그를 거기 끼워넣으면 ISSUE-8(동의 로직 오적용)과 같은 종류의
// 혼선이 로깅 레벨에서 재발한다. 이쪽은 개인정보가 없는 분석 로그라 Phase 4
// (온나라시스템 연동)를 기다리지 않고 지금 바로 persist를 구현한다.
migrate((db) => {
  const collection = new Collection({
    "id": "gdr70qxr550mkl2",
    "created": "2026-07-16 00:00:00.000Z",
    "updated": "2026-07-16 00:00:00.000Z",
    "name": "gov_data_resolve_log",
    "type": "base",
    "system": false,
    "schema": [
        { "system": false, "id": "gd001araw_query",  "name": "raw_query",            "type": "text",   "required": true,  "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "gd002arequester",  "name": "requester_type",       "type": "select", "required": true,  "presentable": true,  "unique": false, "options": { "maxSelect": 1, "values": ["gov-sp", "k-public"] } },
        { "system": false, "id": "gd003acandidates",  "name": "kosis_search_candidates", "type": "json", "required": false, "presentable": false, "unique": false, "options": {} },
        { "system": false, "id": "gd004afiltered",   "name": "filtered_candidates",  "type": "json",   "required": false, "presentable": false, "unique": false, "options": {} },
        { "system": false, "id": "gd005aoutcome",    "name": "outcome",              "type": "select", "required": true,  "presentable": true,  "unique": false, "options": { "maxSelect": 1, "values": ["confirmed", "ambiguous", "not_found"] } },
        { "system": false, "id": "gd006aentry",      "name": "selected_entry_id",    "type": "text",   "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "gd007aoverride",   "name": "human_override",       "type": "text",   "required": false, "presentable": true,  "unique": false, "options": { "min": null, "max": null, "pattern": "" } },
        { "system": false, "id": "gd008arecorded",   "name": "recorded_at",          "type": "date",   "required": true,  "presentable": true,  "unique": false, "options": { "min": "", "max": "" } }
    ],
    "indexes": [
        "CREATE INDEX idx_gov_data_resolve_log_outcome ON gov_data_resolve_log (outcome)",
        "CREATE INDEX idx_gov_data_resolve_log_recorded_at ON gov_data_resolve_log (recorded_at)"
    ],
    "listRule": null, "viewRule": null, "createRule": null, "updateRule": null, "deleteRule": null,
    "options": {}
});
  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("gdr70qxr550mkl2");
  return dao.deleteCollection(collection);
})
