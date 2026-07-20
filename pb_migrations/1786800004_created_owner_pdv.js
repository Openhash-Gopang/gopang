/// <reference path="../pb_data/types.d.ts" />
// 2026-07-20 신설 — prompts/SP_PDV_v1_2.md §7(기관측 PDV) 구현.
//
// SP_PDV v1.2 §7.1 문서에는 "<ownerAgency>_pdv 컬렉션"(에이전시별 별도 컬렉션)
// 이라고 적혀 있었으나, 실사 결과 klaw/market 등 개별 K-서비스 저장소에는
// 자체 PocketBase가 없고 전체 플랫폼이 gopang의 단일 공유 PocketBase를
// 쓰고 있음을 확인했다(gwp_registry 컬렉션과 동일 패턴). 그래서 에이전시별
// 컬렉션을 25개 만드는 대신, gwp_registry처럼 단일 공유 컬렉션(owner_pdv)에
// owner_agency 필드로 파티션한다 — SP_PDV 문서 §7.1의 표현은 개념상 맞지만
// (K-서비스마다 "자신의" 레코드 집합을 갖는다는 의미) 물리적 구현은 이렇게
// 단일 테이블이다. 각 K-서비스는 API 조회 시 owner_agency로 필터링해
// 자기 레코드만 본다(listRule 참조).
//
// who_hash(§7.2 가명화 해시) 계산에 쓰이는 salt는 이 컬렉션에 저장하지
// 않는다 — Cloudflare Worker(hondi-proxy) 측 환경변수 비밀로만 관리한다.
// 클라이언트(gwp-report-client.js recordOwnerPDV())는 원문 guid를 보내고,
// Worker가 salt로 해싱한 뒤 이 컬렉션에는 who_hash만 쓴다(원문 guid는
// Worker 로그에도 남기지 않는다 — SP_PDV §7.2 "역추적 불가" 원칙).
migrate((db) => {
  const collection = new Collection({
    "id": "opv001pdv0shared",
    "created": "2026-07-20 00:00:00.000Z",
    "updated": "2026-07-20 00:00:00.000Z",
    "name": "owner_pdv",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false, "id": "opv101rectype", "name": "record_type",
        "type": "select", "required": true, "presentable": true, "unique": false,
        "options": { "maxSelect": 1, "values": ["consultation", "own_output"] }
      },
      {
        "system": false, "id": "opv102owneragency", "name": "owner_agency",
        "type": "text", "required": true, "presentable": true, "unique": false,
        "options": { "min": 1, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "opv103personakey", "name": "persona_key",
        "type": "text", "required": false, "presentable": true, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "opv104personaver", "name": "persona_version",
        "type": "text", "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "opv105whohash", "name": "who_hash",
        "type": "text", "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": 64, "pattern": "" }
      },
      {
        "system": false, "id": "opv106when", "name": "when",
        "type": "date", "required": true, "presentable": true, "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false, "id": "opv107where", "name": "where",
        "type": "text", "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "opv108what", "name": "what",
        "type": "text", "required": true, "presentable": true, "unique": false,
        "options": { "min": null, "max": 500, "pattern": "" }
      },
      {
        "system": false, "id": "opv109how", "name": "how",
        "type": "select", "required": true, "presentable": true, "unique": false,
        "options": {
          "maxSelect": 1,
          "values": ["completed", "escalated_success", "escalated_ai_limit", "early_exit"]
        }
      },
      {
        "system": false, "id": "opv110why", "name": "why",
        "type": "text", "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "opv111sourceref", "name": "source_ref",
        "type": "text", "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
        // §7.3 원칙상 항상 null — 원문 미저장. 스키마 자체는 미래에 예외가
        // 생길 가능성에 대비해 필드만 남겨두되, 쓰기 경로(recordOwnerPDV)는
        // 항상 null을 보낸다.
      },
      {
        "system": false, "id": "opv112confidence", "name": "confidence",
        "type": "number", "required": false, "presentable": false, "unique": false,
        "options": { "min": 0, "max": 1 }
      }
    ],
    "indexes": [
      "CREATE INDEX idx_owner_pdv_agency ON owner_pdv (owner_agency)",
      "CREATE INDEX idx_owner_pdv_agency_whohash ON owner_pdv (owner_agency, who_hash)",
      "CREATE INDEX idx_owner_pdv_persona ON owner_pdv (persona_key)",
      "CREATE INDEX idx_owner_pdv_when ON owner_pdv (when)"
    ],
    // 리포팅 전용 쓰기(Worker가 서비스 계정으로 insert) — 클라이언트 직접
    // list/view는 막는다(§7.2 who_hash라도 대량 조회는 원치 않는 상관관계
    // 분석에 쓰일 수 있음, C8 취지). API 룰 세부 조정은 Worker 인증 체계
    // 확정 후 후속 마이그레이션에서 조인다(현재는 fail-safe로 전체 비공개).
    "listRule": null,
    "viewRule": null,
    "createRule": null,
    "updateRule": null,
    "deleteRule": null
  });

  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("owner_pdv");
  return dao.deleteCollection(collection);
});
