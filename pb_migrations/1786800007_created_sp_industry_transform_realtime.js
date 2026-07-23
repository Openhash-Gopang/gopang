/// <reference path="../pb_data/types.d.ts" />
// 2026-07-23 신설 — SP-INDUSTRY-TRANSFORM 실시간 생성 결과 저장 테이블.
//
// sp_draft_requests(기존, 2026-07-11)는 기관 SP(SP-DO-*, SP-NAT-* 등) 전용으로
// 설계돼 있어(institution·target_sp_id 필드가 기관 중심, signal_source 값도
// kcompose_match_fail 등 기관 라우팅 실패 신호 위주) 산업 SP를 억지로 끼워
// 넣기보다 전용 테이블을 새로 둔다. 대시보드는 별도 UI를 만들지 않고 이
// 컬렉션을 PocketBase 관리자 화면에서 status=active_pending_review,
// generated_at 오름차순으로 보면 된다(주피터님 2026-07-23 지시 — "대시보드
// 확인, 사람이 최대한 빨리 확인하는 게 최선").
//
// 생명주기: generating -> active_pending_review(자동검증 통과, 이미 사업자
// 그림자 AI에 반영됨) 또는 generation_failed(검증 실패, 활성화 안 됨) ->
// (사람이 검토 후) approved(정식 파일로 승격 예정) 또는 rejected(즉시
// automation_opt_in 자동 OFF).
migrate((db) => {
  const collection = new Collection({
    "id": "c3f1b4d9e6082a",
    "created": "2026-07-23 00:00:00.000Z",
    "updated": "2026-07-23 00:00:00.000Z",
    "name": "sp_industry_transform_realtime",
    "type": "base",
    "system": false,
    "schema": [
        {
            "system": false,
            "id": "g1c1000000001",
            "name": "schema_id",
            "type": "text",
            "required": true,
            "presentable": true,
            "unique": true,
            "options": { "min": 1, "max": 4, "pattern": "^[0-9]{2,4}$" },
            "description": "KSIC 중분류 코드(예: '11'). 업종당 최대 1개 활성 레코드만 유지(unique) — 같은 업종에 여러 사업자가 동시에 트리거해도 최초 1건만 생성."
        },
        {
            "system": false,
            "id": "g1c1000000002",
            "name": "status",
            "type": "select",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": {
                "maxSelect": 1,
                "values": ["generating", "active_pending_review", "generation_failed", "approved", "rejected"]
            }
        },
        {
            "system": false,
            "id": "g1c1000000003",
            "name": "generated_content",
            "type": "text",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": null, "max": 50000, "pattern": "" },
            "description": "SP-INDUSTRY-TRANSFORM-COMMON PHASE 0~5 생성 결과 전문(마크다운/텍스트)"
        },
        {
            "system": false,
            "id": "g1c1000000004",
            "name": "validation_notes",
            "type": "text",
            "required": false,
            "presentable": true,
            "unique": false,
            "options": { "min": null, "max": 2000, "pattern": "" },
            "description": "자동 검증 결과(예: 누락된 PHASE, generation_failed 사유)"
        },
        {
            "system": false,
            "id": "g1c1000000005",
            "name": "generated_at",
            "type": "date",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": { "min": "", "max": "" }
        },
        {
            "system": false,
            "id": "g1c1000000006",
            "name": "reviewed_at",
            "type": "date",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": "", "max": "" }
        },
        {
            "system": false,
            "id": "g1c1000000007",
            "name": "reviewer_note",
            "type": "text",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": null, "max": 2000, "pattern": "" }
        },
        {
            "system": false,
            "id": "g1c1000000008",
            "name": "triggered_by_profile_guid",
            "type": "text",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": null, "max": null, "pattern": "" },
            "description": "최초 생성을 트리거한 프로필(사업자) guid — 감사 추적용, 개인정보 아님(프로필 자체가 이미 등록 데이터)"
        }
    ],
    "indexes": [
        "CREATE INDEX idx_sp_industry_transform_realtime_status ON sp_industry_transform_realtime (status)",
        "CREATE INDEX idx_sp_industry_transform_realtime_generated_at ON sp_industry_transform_realtime (generated_at)"
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
  const collection = dao.findCollectionByNameOrId("c3f1b4d9e6082a");

  return dao.deleteCollection(collection);
})
