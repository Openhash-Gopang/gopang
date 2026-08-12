/// <reference path="../pb_data/types.d.ts" />
// 2026-08-12 신설 — klaw 저장소 benchmark.html이 기록하던 Supabase klaw_benchmark
// 테이블(klaw_benchmark_table.sql)을 PocketBase(L1 hanlim)로 이전. 원 SQL 스키마에는
// summary 컬럼이 없었는데 benchmark.html이 매 저장마다 이 필드를 채워 보내고 있어
// (v15.2 정합성 리뷰에서 발견) 이 컬렉션에는 처음부터 포함시켰다.
//
// klaw_benchmark_trend 뷰(버전별 평균 일치도)는 Supabase의 SQL VIEW였는데
// PocketBase에는 동일 개념이 없으므로, 이 마이그레이션에서는 만들지 않는다 —
// 대신 dashboard.html/benchmark.html 쪽에서 klaw_version별로 클라이언트 집계하도록
// 변경한다 (klaw 저장소 클라이언트 패치 별도 참조).
//
// 원 Supabase RLS는 "anon insert 허용 + anon select는 본인 reporter만"이었으나,
// PocketBase는 이 코드베이스에서 GUID 기반 익명 데이터에 그런 헤더 기반 행 단위
// 규칙을 걸지 않는 것이 기존 컨벤션(ai_usage_log, seller_reviews 등 전부 listRule
// null)이라 동일하게 맞췄다 — 이 컬렉션은 평가자 내부 도구용이라 보안 영향은
// 제한적이지만, listRule을 열어둔 것 자체는 원 RLS 대비 조회 범위가 넓어진
// 변경이니 인지하고 계셔야 한다.
migrate((db) => {
  const collection = new Collection({
    "id": "klb0000benchmk",
    "created": "2026-08-12 00:00:00.000Z",
    "updated": "2026-08-12 00:00:00.000Z",
    "name": "klaw_benchmark",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false, "id": "klb00000001", "name": "case_no", "type": "text",
        "required": true, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "klb00000002", "name": "case_type", "type": "text",
        "required": false, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "klb00000003", "name": "case_input", "type": "text",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": 2000, "pattern": "" }
      },
      {
        "system": false, "id": "klb00000004", "name": "summary", "type": "text",
        "required": false, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" },
        "description": "사건 한 줄 요약 — 원 Supabase 스키마 누락분(v15.2 정합성 리뷰 발견), 이 컬렉션엔 처음부터 포함"
      },
      {
        "system": false, "id": "klb00000005", "name": "virtual_verdict", "type": "text",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": 8000, "pattern": "" }
      },
      {
        "system": false, "id": "klb00000006", "name": "real_verdict", "type": "text",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": 8000, "pattern": "" }
      },
      {
        "system": false, "id": "klb00000007", "name": "score_conclusion", "type": "number",
        "required": false, "presentable": true, "unique": false,
        "options": { "min": 0, "max": 4 }
      },
      {
        "system": false, "id": "klb00000008", "name": "score_law_logic", "type": "number",
        "required": false, "presentable": true, "unique": false,
        "options": { "min": 0, "max": 3 }
      },
      {
        "system": false, "id": "klb00000009", "name": "score_detail", "type": "number",
        "required": false, "presentable": true, "unique": false,
        "options": { "min": 0, "max": 3 }
      },
      {
        "system": false, "id": "klb00000010", "name": "score_total", "type": "number",
        "required": false, "presentable": true, "unique": false,
        "options": { "min": 0, "max": 10 }
      },
      {
        "system": false, "id": "klb00000011", "name": "grade", "type": "text",
        "required": false, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "klb00000012", "name": "eval_raw", "type": "text",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": 4000, "pattern": "" }
      },
      {
        "system": false, "id": "klb00000013", "name": "klaw_version", "type": "text",
        "required": true, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" },
        "description": "예: 'v15.1' — 원 SQL default 'v15.3'는 실재하지 않는 파일 버전이라 이관하지 않음, 클라이언트가 매번 명시적으로 채워야 함(default 없음)"
      },
      {
        "system": false, "id": "klb00000014", "name": "llm_model", "type": "text",
        "required": false, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "klb00000015", "name": "reporter", "type": "text",
        "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      }
    ],
    "indexes": [
      "CREATE INDEX idx_klaw_benchmark_created ON klaw_benchmark (created)",
      "CREATE INDEX idx_klaw_benchmark_klaw_version ON klaw_benchmark (klaw_version)",
      "CREATE INDEX idx_klaw_benchmark_reporter ON klaw_benchmark (reporter)"
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
  const collection = dao.findCollectionByNameOrId("klb0000benchmk");

  return dao.deleteCollection(collection);
})
