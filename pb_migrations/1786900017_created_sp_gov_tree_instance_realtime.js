/// <reference path="../pb_data/types.d.ts" />
// 2026-08-05 신설 — gov-tree(04-city-dept·05-emd) 인스턴스 실시간 저작
// 결과 저장 테이블. sp_gov_draft_realtime(2026-08-02, 이름 있는 기관용)과
// 완전히 동일한 설계 원칙을 gov-tree 계층(구조화 키로 식별되는 시·군·구
// 부서/읍·면·동)에 적용한다.
//
// 배경: GOV_TREE_LAZY_INSTANCING_DESIGN_v1_0.md — "나머지 광역시도·
// 시군구·읍면동·산하기관 인스턴스는 사용자 발화가 그 기관을 호출하는
// 시점에 구성해야 한다"(주피터 2026-08-05 지시). gov-router.js가
// city-dept/emd 계층에서 STUB·MISSING을 판정하면(§3), risk_tier=low로
// 실시간 SP 저작을 큐잉한다(§4-1) — 이 테이블이 그 결과를 담는다.
//
// sp_gov_draft_realtime과의 차이: 그쪽은 institution(자유텍스트) +
// institution_key(정규화 dedup 키)로 이름 있는 기관을 식별하지만, 여기는
// 애초에 구조화된 위치 코드(province_code/city_code/dept_code/emd_name)
// 로 식별되는 대상이라 그 코드 자체를 1급 필드로 둔다 — LIKE 매칭보다
// 정확하고 오탐이 없다. instance_key는 이 네 필드를 조합한 완전일치
// dedup 키(worker.js _govTreeInstanceKey()).
//
// ★ 필드명은 영어(ASCII)로 통일했다 — 최초 초안은 도코드/시코드/국코드/
// 읍면동명처럼 한글 필드명을 쓰려다, 이 저장소의 다른 모든 PocketBase
// 컬렉션이 예외 없이 영어 필드명이라는 걸 뒤늦게 확인하고 정정했다
// (docs/schema/sp_gov_tree_instance_realtime.schema.json 참고문서에
// 경위 기록). worker.js↔gov-router.js 사이를 오가는 JS 객체(govTreeKey)
// 자체는 한글 키(도코드 등)를 그대로 쓰고, PocketBase에 실제로 쓰는
// 시점(_l1CreateGovTreeInstanceRealtime 등)에서만 번역한다.
//
// 생명주기: sp_gov_draft_realtime과 동일 — generating -> (자동검증)
// active_pending_review 또는 generation_failed -> (사람 검토)
// approved(정식 gov-tree 파일로 승격) 또는 rejected. rate_limited는
// 이 컬렉션만의 추가 상태(§9-2 비용 상한 도달, 다음 시간대 또는 수동
// 처리 대기).
migrate((db) => {
  const collection = new Collection({
    "id": "g0vtre31nst0nc",
    "created": "2026-08-05 00:00:00.000Z",
    "updated": "2026-08-05 00:00:00.000Z",
    "name": "sp_gov_tree_instance_realtime",
    "type": "base",
    "system": false,
    "schema": [
        {
            "system": false,
            "id": "g0vti000000001",
            "name": "tier",
            "type": "select",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": { "maxSelect": 1, "values": ["city-dept", "emd"] }
        },
        {
            "system": false,
            "id": "g0vti000000002",
            "name": "province_code",
            "type": "text",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": { "min": 1, "max": 40, "pattern": "" },
            "description": "예: busan, jeju — PROVINCE_REGISTRY 키와 동일 어휘. govTreeKey.도코드."
        },
        {
            "system": false,
            "id": "g0vti000000003",
            "name": "city_code",
            "type": "text",
            "required": false,
            "presentable": true,
            "unique": false,
            "options": { "min": null, "max": 40, "pattern": "" },
            "description": "tier=city-dept 전용(예: busan_dongnae). tier=emd면 공란. govTreeKey.시코드."
        },
        {
            "system": false,
            "id": "g0vti000000004",
            "name": "dept_code",
            "type": "text",
            "required": false,
            "presentable": true,
            "unique": false,
            "options": { "min": null, "max": 40, "pattern": "" },
            "description": "tier=city-dept 전용(예: jachi, econ). govTreeKey.국코드."
        },
        {
            "system": false,
            "id": "g0vti000000005",
            "name": "emd_name",
            "type": "text",
            "required": false,
            "presentable": true,
            "unique": false,
            "options": { "min": null, "max": 40, "pattern": "" },
            "description": "tier=emd 전용(예: 우1동). 값 자체는 한글 지명 그대로. govTreeKey.읍면동명."
        },
        {
            "system": false,
            "id": "g0vti000000006",
            "name": "instance_key",
            "type": "text",
            "required": true,
            "presentable": true,
            "unique": true,
            "options": { "min": 1, "max": 200, "pattern": "" },
            "description": "worker.js _govTreeInstanceKey() 자동 생성 — '{tier}:{province}:{city}:{dept 또는 emd}'. 완전일치 dedup 키, 수기 입력 금지."
        },
        {
            "system": false,
            "id": "g0vti000000007",
            "name": "institution",
            "type": "text",
            "required": false,
            "presentable": true,
            "unique": false,
            "options": { "min": null, "max": 200, "pattern": "" },
            "description": "사람이 읽는 표시용(예: '부산 동구 총무국') — 매칭에는 안 씀, instance_key가 정본."
        },
        {
            "system": false,
            "id": "g0vti000000008",
            "name": "task",
            "type": "text",
            "required": false,
            "presentable": true,
            "unique": false,
            "options": { "min": null, "max": 500, "pattern": "" }
        },
        {
            "system": false,
            "id": "g0vti000000009",
            "name": "risk_tier",
            "type": "select",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": { "maxSelect": 1, "values": ["low"] },
            "description": "sp_gov_draft_realtime과 동일한 화이트리스트 원칙 — high는 이 컬렉션에 들어올 일이 없다(들어오면 §4-1 위반, 점검 필요)."
        },
        {
            "system": false,
            "id": "g0vti000000010",
            "name": "status",
            "type": "select",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": {
                "maxSelect": 1,
                "values": ["generating", "active_pending_review", "generation_failed", "rate_limited", "approved", "rejected"]
            }
        },
        {
            "system": false,
            "id": "g0vti000000011",
            "name": "generated_content",
            "type": "text",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": null, "max": 20000, "pattern": "" },
            "description": "gov-tree 계층 렌더링 결과 전문(city-dept: 국 정보, emd: 읍면동 정보)."
        },
        {
            "system": false,
            "id": "g0vti000000012",
            "name": "validation_notes",
            "type": "text",
            "required": false,
            "presentable": true,
            "unique": false,
            "options": { "min": null, "max": 2000, "pattern": "" }
        },
        {
            "system": false,
            "id": "g0vti000000013",
            "name": "generated_at",
            "type": "date",
            "required": true,
            "presentable": true,
            "unique": false,
            "options": { "min": "", "max": "" }
        },
        {
            "system": false,
            "id": "g0vti000000014",
            "name": "source_conversation",
            "type": "text",
            "required": false,
            "presentable": false,
            "unique": false,
            "options": { "min": null, "max": 4000, "pattern": "" }
        }
    ],
    "indexes": [
        "CREATE INDEX idx_sp_gov_tree_instance_realtime_status ON sp_gov_tree_instance_realtime (status)",
        "CREATE INDEX idx_sp_gov_tree_instance_realtime_tier ON sp_gov_tree_instance_realtime (tier)"
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
  const collection = dao.findCollectionByNameOrId("g0vtre31nst0nc");

  return dao.deleteCollection(collection);
})
