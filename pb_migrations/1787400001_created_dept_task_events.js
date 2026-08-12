/// <reference path="../pb_data/types.d.ts" />
// 2026-08-13 — Pathfinder(docs/PATHFINDER_design.md) 1단계 계측 신설.
// dept_tasks는 상태 전이를 같은 레코드에 PATCH로 덮어써 구간별 소요시간
// 이력이 유실된다(최종 소요시간만 알 수 있음). 이 컬렉션은 그 유실을
// 메우는 append-only 이벤트 로그다 — dept_tasks 자체의 PATCH 로직은
// 건드리지 않고, PATCH 직전/직후에 이 컬렉션에 한 행만 추가한다.
//
// Pathfinder 그래프 모델과의 대응:
//   노드 = (task_type, target_type, target_id)
//   간선 = 이 컬렉션의 연속된 두 행 사이 구간, 가중치 = to.at - from.at
//   경로 = origin_chain 순서대로 이어지는 dept_task_id 시퀀스
migrate((db) => {
  const collection = new Collection({
    "id": "dte8f2k9m3xhpath",
    "created": "2026-08-13 00:00:00.000Z",
    "updated": "2026-08-13 00:00:00.000Z",
    "name": "dept_task_events",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false, "id": "dtef001task_id", "name": "task_id",
        "type": "text", "required": true, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
        // dept_tasks.id 참조 — PocketBase relation 필드 대신 text로 둔 이유:
        // dept_tasks가 이미 text id 기반 index만 쓰고 relation 필드를 안 씀
        // (dept_tasks 마이그레이션 참고), 기존 관례를 그대로 따름
      },
      {
        "system": false, "id": "dtef002from_status", "name": "from_status",
        "type": "select", "required": false, "presentable": true, "unique": false,
        "options": { "maxSelect": 1, "values": ["requested", "acknowledged", "in_progress", "completed", "rejected"] }
        // 최초 생성 이벤트(requested)는 from_status가 없음(null 허용)
      },
      {
        "system": false, "id": "dtef003to_status", "name": "to_status",
        "type": "select", "required": true, "presentable": true, "unique": false,
        "options": { "maxSelect": 1, "values": ["requested", "acknowledged", "in_progress", "completed", "rejected"] }
      },
      {
        "system": false, "id": "dtef004at", "name": "at",
        "type": "date", "required": true, "presentable": true, "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false, "id": "dtef005actor_hash", "name": "actor_hash",
        "type": "text", "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
        // 선택 필드, v2 이후 담당자 단위 분석 도입 시 사용. hash(employeeGuid+salt) —
        // Pathfinder 설계 문서 5장 프라이버시 원칙(개인 식별 불가) 그대로 적용
      }
    ],
    "indexes": [
      "CREATE INDEX idx_dept_task_events_task_id ON dept_task_events (task_id)",
      "CREATE INDEX idx_dept_task_events_at ON dept_task_events (at)"
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
  const collection = dao.findCollectionByNameOrId("dept_task_events");
  return dao.deleteCollection(collection);
})
