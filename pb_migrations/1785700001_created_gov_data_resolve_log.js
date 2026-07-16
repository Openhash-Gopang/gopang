/// <reference path="../pb_data/types.d.ts" />
// ── 2026-07-16 신설: KOSIS 리졸버(resolveGovData) 검색·매칭 로그 저장소.
// `resolveGovData-최소버전설계_v1.0_2026-07-16.md` §3 요구사항 대응.
//
// [재배포 2026-07-16] 이 파일은 deploy-pb-migrations.yml 파이프라인이
// 만들어지기 전에 커밋되어, "이번 push의 변경파일"만 감지하는 파이프라인의
// diff 범위 밖에 있었다 — 그래서 L1(hanlim)에 한 번도 실제 적용되지 않았다.
// 이 주석 추가가 새 push의 diff에 잡히게 해서 파이프라인이 정상 감지·적용
// 하도록 만드는 목적이다 (내용 변경 없음, 트리거 목적의 touch).
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
