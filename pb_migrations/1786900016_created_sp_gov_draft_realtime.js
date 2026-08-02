/// <reference path="../pb_data/types.d.ts" />
// 2026-08-02 신설 — gov-tree(제주도 등 지방행정) 기관·부서 SP 실시간 생성
// 결과 저장 테이블. sp_industry_transform_realtime(2026-07-23, 업종 SP
// 전용)과 완전히 동일한 설계 원칙을 gov-tree에 적용한다.
//
// 배경: AC-PRO-CORE §DRAFT_REQUEST가 2026-07-28부터 risk_tier(a·b 기준 —
// (a) 절차가 이미 공개돼 명확한가, (b) 생명·신체·재산에 직접 영향을
// 주는가)를 판정해 [GOV_SP_DRAFT_REQUEST: ..., risk_tier=low|high]를
// 보내왔다. 지금까지는 risk_tier와 무관하게 "사람이 나중에 SP를 쓴다"는
// 큐잉(sp_draft_requests)만 있었고, risk_tier=low에서도 실제 SP 문서
// 생성은 사람 손을 기다려야 했다. 이 테이블은 risk_tier=low인 경우에만
// (high는 기존처럼 사전 승인 없이는 생성 자체를 하지 않음 — 화이트리스트
// 방식, 주피터님 2026-08-02 지시) 실시간 생성을 활성화한다.
//
// 생명주기: generating -> active_pending_review(자동검증 통과, 이미
// 라우터가 서빙 가능) 또는 generation_failed(검증 실패, 서빙 안 됨) ->
// (사람이 검토 후) approved(정식 gov-tree 파일로 승격 예정) 또는
// rejected(즉시 서빙 중단).
migrate((db) => {
  const collection = new Collection({
    "id": "g0v1dra7tre4l0",
    "created": "2026-08-02 00:00:00.000Z",
    "updated": "2026-08-02 00:00:00.000Z",
    "name": "sp_gov_draft_realtime",
    "type": "base",
    "system": false,
    "schema": [
        {
            "system": false,
            "id": "g0vfd000000001",
            "name": "institution",
            "type": "text",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": { "min": 1, "max": 200, "pattern": "" },
            "description": "AC가 특정한 기관·부서명(예: '정읍시 노인복지과'). GOV_SP_DRAFT_REQUEST의 institution 그대로."
        },
        {
            "system": false,
            "id": "g0vfd000000002",
            "name": "task",
            "type": "text",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": { "min": 1, "max": 1000, "pattern": "" }
        },
        {
            "system": false,
            "id": "g0vfd000000003",
            "name": "tier_hint",
            "type": "text",
            "required": false,
            "presentable": true,
            "unique": false,
            "options": { "min": null, "max": 200, "pattern": "" },
            "description": "GOV_SP_DRAFT_REQUEST의 tier_hint(추정 계층 — 예: 'do-dept', 'city-dept', 'org')"
        },
        {
            "system": false,
            "id": "g0vfd000000004",
            "name": "institution_key",
            "type": "text",
            "required": true,
            "presentable": true,
            "unique": true,
            "options": { "min": 1, "max": 220, "pattern": "" },
            "description": "institution을 정규화한 중복방지 키(공백 제거·소문자화 등) — 같은 기관에 여러 시민이 동시에 질문해도 최초 1건만 생성."
        },
        {
            "system": false,
            "id": "g0vfd000000005",
            "name": "risk_tier",
            "type": "select",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": { "maxSelect": 1, "values": ["low"] },
            "description": "이 테이블은 risk_tier=low만 받는다(화이트리스트) — high는 애초에 이 컬렉션에 들어오지 않고 기존 sp_draft_requests(사전 승인 큐)로만 간다."
        },
        {
            "system": false,
            "id": "g0vfd000000006",
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
            "id": "g0vfd000000007",
            "name": "generated_content",
            "type": "text",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": null, "max": 50000, "pattern": "" },
            "description": "SP-AUTHOR(약식) PHASE 0~E 생성 결과 전문"
        },
        {
            "system": false,
            "id": "g0vfd000000008",
            "name": "validation_notes",
            "type": "text",
            "required": false,
            "presentable": true,
            "unique": false,
            "options": { "min": null, "max": 2000, "pattern": "" }
        },
        {
            "system": false,
            "id": "g0vfd000000009",
            "name": "generated_at",
            "type": "date",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": { "min": "", "max": "" }
        },
        {
            "system": false,
            "id": "g0vfd000000010",
            "name": "reviewed_at",
            "type": "date",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": "", "max": "" }
        },
        {
            "system": false,
            "id": "g0vfd000000011",
            "name": "reviewer_note",
            "type": "text",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": null, "max": 2000, "pattern": "" }
        },
        {
            "system": false,
            "id": "g0vfd000000012",
            "name": "source_conversation",
            "type": "text",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": null, "max": 4000, "pattern": "" }
        }
    ],
    "indexes": [
        "CREATE INDEX idx_sp_gov_draft_realtime_status ON sp_gov_draft_realtime (status)",
        "CREATE INDEX idx_sp_gov_draft_realtime_generated_at ON sp_gov_draft_realtime (generated_at)"
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
  const collection = dao.findCollectionByNameOrId("g0v1dra7tre4l0");

  return dao.deleteCollection(collection);
})
