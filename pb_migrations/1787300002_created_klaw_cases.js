/// <reference path="../pb_data/types.d.ts" />
// 2026-08-12 신설 — klaw(Openhash-Gopang/klaw 저장소)의 desktop.html·benchmark.html이
// 기록하고 dashboard.html·board.html이 조회하던 Supabase klaw_cases 테이블을
// PocketBase(L1 hanlim)로 이전. 원 Supabase 테이블은 오늘 자 45개 저장소 시크릿
// 스캔으로 자격증명이 제거되어 이 컬렉션이 생성되기 전까지 klaw 쪽 저장/조회가
// 전부 비활성 상태였다 (klaw 저장소 쪽 클라이언트 코드 별도 패치 필요, 이 파일은
// 그중 백엔드 컬렉션 부분).
//
// id는 원래 Supabase에서 caseNo(예: "CASE-2026-1234")를 그대로 PK로 썼으나,
// PocketBase 레코드 id는 15자 고정 규칙이 있어 caseNo를 id로 재사용할 수 없다.
// case_no를 별도 인덱스 필드로 두고 id는 PocketBase 기본 자동생성에 맡긴다.
// 생성/조회 시각도 Supabase의 커스텀 created_at 대신 PocketBase 기본 제공
// created/updated 시스템 필드를 그대로 쓴다 (klaw 쪽 클라이언트 코드에서
// created_at → created로 참조 변경 필요).
//
// seller_reviews/ai_usage_log와 동일한 컨벤션: guid(여기선 reporter)로 소유,
// 별도 인증 없는 공개 제출 — listRule/createRule 모두 null.
migrate((db) => {
  const collection = new Collection({
    "id": "klc0000000cases",
    "created": "2026-08-12 00:00:00.000Z",
    "updated": "2026-08-12 00:00:00.000Z",
    "name": "klaw_cases",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false, "id": "klc00000001", "name": "case_no", "type": "text",
        "required": true, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" },
        "description": "표시용 사건번호 (예: CASE-2026-1234) — 원 Supabase의 id(PK) 역할을 대신함"
      },
      {
        "system": false, "id": "klc00000002", "name": "source", "type": "select",
        "required": false, "presentable": true, "unique": false,
        "options": { "maxSelect": 1, "values": ["desktop", "webapp", "benchmark"] },
        "description": "어느 화면에서 생성됐는지 — benchmark.html이 'desktop'으로 오기록하던 버그를 이 컬렉션 전환과 함께 수정"
      },
      {
        "system": false, "id": "klc00000003", "name": "case_type", "type": "text",
        "required": false, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "klc00000004", "name": "case_type_code", "type": "text",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "klc00000005", "name": "case_level", "type": "text",
        "required": false, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "klc00000006", "name": "case_detail", "type": "text",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "klc00000007", "name": "case_input", "type": "text",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": 2000, "pattern": "" }
      },
      {
        "system": false, "id": "klc00000008", "name": "case_summary", "type": "text",
        "required": false, "presentable": true, "unique": false,
        "options": { "min": null, "max": 500, "pattern": "" }
      },
      {
        "system": false, "id": "klc00000009", "name": "verdict", "type": "text",
        "required": false, "presentable": true, "unique": false,
        "options": { "min": null, "max": 80, "pattern": "" }
      },
      {
        "system": false, "id": "klc00000010", "name": "confidence", "type": "text",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" },
        "description": "LLM 자기보고 문자열 (예: '8/10') — 숫자 아님, board.html/dashboard.html이 클라이언트에서 파싱"
      },
      {
        "system": false, "id": "klc00000011", "name": "complexity", "type": "text",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "klc00000012", "name": "match_rate", "type": "text",
        "required": false, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" },
        "description": "LLM 자기보고 문자열 (예: '94.4%', '90~99.99%') — dashboard.html._parseMatchRate가 파싱"
      },
      {
        "system": false, "id": "klc00000013", "name": "verdict_type", "type": "text",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "klc00000014", "name": "llm_model", "type": "text",
        "required": false, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "klc00000015", "name": "klaw_version", "type": "text",
        "required": false, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "klc00000016", "name": "reporter", "type": "text",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" },
        "description": "등록자 ipv6(익명) — dashboard.html의 사용자별 통계가 이 필드를 참조 (user_id 아님, 클라이언트 별칭 필요)"
      },
      {
        "system": false, "id": "klc00000017", "name": "status", "type": "text",
        "required": false, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      }
    ],
    "indexes": [
      "CREATE INDEX idx_klaw_cases_created ON klaw_cases (created)",
      "CREATE INDEX idx_klaw_cases_case_no ON klaw_cases (case_no)",
      "CREATE INDEX idx_klaw_cases_reporter ON klaw_cases (reporter)",
      "CREATE INDEX idx_klaw_cases_klaw_version ON klaw_cases (klaw_version)",
      "CREATE INDEX idx_klaw_cases_status ON klaw_cases (status)"
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
  const collection = dao.findCollectionByNameOrId("klc0000000cases");

  return dao.deleteCollection(collection);
})
