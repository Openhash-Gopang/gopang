/// <reference path="../pb_data/types.d.ts" />
// 2026-07-24 신설 — LAZY-INSTANCE-ENRICHMENT-DESIGN_v1.0.md §3-2 구현
// (주피터 지시로 승인·구현 착수: "혼디는 안내가 아니라, 실행이 주된
// 목표"라는 철학을 도청·시청·국가기관 인스턴스 데이터에도 반영).
//
// 이 컬렉션은 "확정된 진실"이 아니라 초안 대기소다 — git의
// *-master-data.json이 여전히 유일한 확정 계층이고, 여기 쌓이는 레코드는
// 사람이 검증해서 승격(patch)하기 전까지는 어떤 응답에도 반영되지 않는다
// (읽기 경로 변경 없음 — 설계 문서 §6).
//
// source=user_reported인 레코드는 특히 주의해서 다뤄야 한다(설계 문서
// §5) — 검증 없이 승격 자동화하지 않는다.
migrate((db) => {
  const collection = new Collection({
    "id": "ied001draft0shrd",
    "created": "2026-07-24 00:00:00.000Z",
    "updated": "2026-07-24 00:00:00.000Z",
    "name": "instance_enrichment_drafts",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false, "id": "ied101layer", "name": "layer",
        "type": "select", "required": true, "presentable": true, "unique": false,
        "options": { "maxSelect": 1, "values": ["do", "city", "citydept", "emd", "national"] }
      },
      {
        "system": false, "id": "ied102province", "name": "province",
        "type": "text", "required": true, "presentable": true, "unique": false,
        "options": { "min": 1, "max": null, "pattern": "" }
        // 도코드(예: busan, gyeonggi). national 계층에서는 지사 디렉터리
        // 항목의 도코드를 그대로 쓴다(09-national/NATIONAL-AGENCY-CLASS-
        // INSTANCE-ARCHITECTURE_v1.0.md §5-3 정정 반영 — "도별 인스턴스"가
        // 아니라 싱글턴이 참조하는 지사 디렉터리 항목의 키일 뿐).
      },
      {
        "system": false, "id": "ied103instanceid", "name": "instance_id",
        "type": "text", "required": true, "presentable": true, "unique": false,
        "options": { "min": 1, "max": null, "pattern": "" }
        // 예: haeundae(시), haeundae/econ(시청 국), police(국가기관 도메인).
      },
      {
        "system": false, "id": "ied104field", "name": "field",
        "type": "text", "required": true, "presentable": true, "unique": false,
        "options": { "min": 1, "max": null, "pattern": "" }
        // 기존 *-master-data.json 스키마의 필드명을 그대로 쓴다(새 필드명
        // 임의 생성 금지 — 설계 문서 §6).
      },
      {
        "system": false, "id": "ied105value", "name": "value",
        "type": "text", "required": true, "presentable": true, "unique": false,
        "options": { "min": null, "max": 2000, "pattern": "" }
      },
      {
        "system": false, "id": "ied106source", "name": "source",
        "type": "select", "required": true, "presentable": true, "unique": false,
        "options": { "maxSelect": 1, "values": ["user_reported", "web_search", "inference"] }
      },
      {
        "system": false, "id": "ied107confidence", "name": "confidence",
        "type": "select", "required": true, "presentable": true, "unique": false,
        "options": { "maxSelect": 1, "values": ["low", "medium", "high"] }
      },
      {
        "system": false, "id": "ied108note", "name": "note",
        "type": "text", "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": 1000, "pattern": "" }
      },
      {
        "system": false, "id": "ied109submitguid", "name": "submitted_by_guid_hash",
        "type": "text", "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": 64, "pattern": "" }
        // owner_pdv의 who_hash와 동일 철학(U5 개인정보 최소화) — 원문 guid는
        // 저장하지 않는다.
      },
      {
        "system": false, "id": "ied110submitat", "name": "submitted_at",
        "type": "date", "required": true, "presentable": true, "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false, "id": "ied111status", "name": "status",
        "type": "select", "required": true, "presentable": true, "unique": false,
        "options": { "maxSelect": 1, "values": ["draft", "promoted", "rejected"] }
      },
      {
        "system": false, "id": "ied112reviewedby", "name": "reviewed_by",
        "type": "text", "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false, "id": "ied113reviewedat", "name": "reviewed_at",
        "type": "date", "required": false, "presentable": false, "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false, "id": "ied114reviewnote", "name": "review_note",
        "type": "text", "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": 1000, "pattern": "" }
      }
    ],
    "indexes": [
      "CREATE INDEX idx_ied_status ON instance_enrichment_drafts (status)",
      "CREATE INDEX idx_ied_layer_province_instance ON instance_enrichment_drafts (layer, province, instance_id)",
      "CREATE INDEX idx_ied_submitat ON instance_enrichment_drafts (submitted_at)"
    ],
    // 쓰기 전용 대기소 — Worker가 서비스 계정으로 insert. 클라이언트 직접
    // list/view는 막는다(owner_pdv와 동일 fail-safe 원칙) — 검토·승격
    // 도구는 L1 관리자 인증 경로로 별도 접근한다.
    "listRule": null,
    "viewRule": null,
    "createRule": null,
    "updateRule": null,
    "deleteRule": null
  });

  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("instance_enrichment_drafts");
  return dao.deleteCollection(collection);
});
