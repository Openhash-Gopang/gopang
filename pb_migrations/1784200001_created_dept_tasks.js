/// <reference path="../pb_data/types.d.ts" />
// 2026-07-12 — B그룹(기관/부서 간 업무지시) 100건 사고실험에서 확인된
// 공백을 메운다. 기존 두 메커니즘과의 차이를 명확히 해 둔다:
//
//   - SP_DELEGATION_REGISTRY/handleGovRelay(worker.js) — "하나의 질의에
//     여러 관할 정보를 합성해 답한다"가 목적. 한 턴짜리 LLM 컨텍스트
//     조립이고, 영속 기록이 없다(MAX_SP_HOPS=2, 세션 끝나면 사라짐).
//     jeju_do/jeju_national/health/police/911 등 "총괄" 단위만 대상.
//   - GOV_TASK(/gov/task/submit) — "시민이 이미 정해진 한 기관에 서류를
//     접수한다"가 목적. 접수자는 항상 시민(개인) 1명, 대상은 항상 기관
//     1곳으로 고정.
//   - 이 컬렉션(dept_tasks) — "기관/부서/사업자가 다른 기관/부서에
//     실행을 지시하고, 그 처리 상태를 추적한다"가 목적. 도청 12개
//     do-dept domain끼리, 07-org 법인, 민간 사업자(guid)까지 요청측이
//     될 수 있다는 게 위 둘과의 핵심 차이 — 영속 레코드로 남아
//     상태(requested→completed)를 추적할 수 있어야 실제 행정업무
//     위임을 흉내낼 수 있다(SP_CALL처럼 한 턴 안에 끝나지 않음).
//
// 순환 위임 방지는 origin_chain(JSON 배열)에 지금까지 거친 target_id를
// 누적하고, 신규 target_id가 이미 배열에 있으면 서버가 거부하는 방식으로
// SP-INTERCALL-PROTOCOL 원칙3(순환 방지)을 이 비동기 큐에도 적용한다.
migrate((db) => {
  const collection = new Collection({
    "id": "dtq7f2k9m3xh010",
    "created": "2026-07-12 00:00:00.000Z",
    "updated": "2026-07-12 00:00:00.000Z",
    "name": "dept_tasks",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false, "id": "dtf001requester_type", "name": "requester_type",
        "type": "select", "required": true, "presentable": true, "unique": false,
        "options": { "maxSelect": 1, "values": ["dept", "org", "business", "citizen"] }
      },
      {
        "system": false, "id": "dtf002requester_id", "name": "requester_id",
        "type": "text", "required": true, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "dtf003requester_label", "name": "requester_label",
        "type": "text", "required": false, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "dtf004target_type", "name": "target_type",
        "type": "select", "required": true, "presentable": true, "unique": false,
        "options": { "maxSelect": 1, "values": ["dept", "org", "business", "national", "k-service"] }
      },
      {
        "system": false, "id": "dtf005target_id", "name": "target_id",
        "type": "text", "required": true, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "dtf006task_type", "name": "task_type",
        "type": "text", "required": true, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "dtf007directive", "name": "directive",
        "type": "text", "required": true, "presentable": false, "unique": false,
        "options": { "min": null, "max": 2000, "pattern": "" }
      },
      {
        "system": false, "id": "dtf008payload", "name": "payload",
        "type": "json", "required": false, "presentable": false, "unique": false,
        "options": { "maxSize": 2000000 }
      },
      {
        "system": false, "id": "dtf009status", "name": "status",
        "type": "select", "required": true, "presentable": true, "unique": false,
        "options": { "maxSelect": 1, "values": ["requested", "acknowledged", "in_progress", "completed", "rejected"] }
      },
      {
        "system": false, "id": "dtf010origin_chain", "name": "origin_chain",
        "type": "json", "required": false, "presentable": false, "unique": false,
        "options": { "maxSize": 2000000 }
      },
      {
        "system": false, "id": "dtf011result_note", "name": "result_note",
        "type": "text", "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": 2000, "pattern": "" }
      }
    ],
    "indexes": [
      "CREATE INDEX idx_dept_tasks_target ON dept_tasks (target_id)",
      "CREATE INDEX idx_dept_tasks_requester ON dept_tasks (requester_id)",
      "CREATE INDEX idx_dept_tasks_status ON dept_tasks (status)"
    ],
    "listRule": null,
    "viewRule": null,
    "createRule": null,
    "updateRule": null,
    "deleteRule": null
  });

  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("dept_tasks");
  return dao.deleteCollection(collection);
})
