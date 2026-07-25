/// <reference path="../pb_data/types.d.ts" />
// 2026-07-26 신설 — K-Traffic/K-Logistics 실매칭 시스템, 기사·차량 등록.
//
// 배경: traffic/desktop.html의 "차량 탐색" 화면에 하드코딩된 가짜 샘플
// ("김○○ 겹침 92%")과 SYS 프롬프트가 매 요청마다 즉석에서 지어내던 가짜
// 매칭 결과를 실제 공유 백엔드로 교체하는 작업(피터님 지시로 발견·시정).
// DAWN(dawn_proposals 등)과 동일한 설계 원칙 — 클라이언트는 PocketBase를
// 직접 두드리지 않고 worker.js(/match/*)만 서비스 계정으로 접근한다.
//
// 정책 결정 (2026-07-26, 피터님 확정):
// - traffic·logistics가 이 컬렉션을 공유한다(화물기사 복귀길 승객 매칭 등
//   교차 활용 목적). vehicle_type으로 구분.
// - 1인 1차량 프로필로 시작한다(owner_guid_hash unique) — 여러 대 등록은
//   이번 범위 밖. 필요해지면 스키마 변경 없이 unique 인덱스만 제거하면 됨.
//
// 개인정보: 원문 guid는 저장하지 않는다(dawn_proposals와 동일한 도메인
// 분리 salt + SHA-256 해싱, worker.js의 _matchHashGuid 패턴).
migrate((db) => {
  const collection = new Collection({
    "id": "mch001vehicl01",
    "created": "2026-07-26 00:00:00.000Z",
    "updated": "2026-07-26 00:00:00.000Z",
    "name": "match_vehicles",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false, "id": "mch101ownerhash", "name": "owner_guid_hash",
        "type": "text", "required": true, "presentable": false, "unique": true,
        "options": { "min": 1, "max": 64, "pattern": "" }
      },
      {
        "system": false, "id": "mch102vehtype", "name": "vehicle_type",
        "type": "select", "required": true, "presentable": true, "unique": false,
        "options": { "maxSelect": 1, "values": ["passenger", "cargo"] }
      },
      {
        // 승객: 탑승 가능 인원. 화물: 적재 가능 kg. 단위는 vehicle_type으로
        // 구분해서 해석한다(스키마 자체엔 단위 없음 — worker.js 검증 로직에서
        // vehicle_type별로 합리적 범위인지 확인 권장).
        "system": false, "id": "mch103capacity", "name": "capacity",
        "type": "number", "required": true, "presentable": true, "unique": false,
        "options": { "min": 1, "max": null }
      },
      {
        // offline: 미운행. available: 운행 중, 매칭 가능. matched: 현재
        // 수요 처리 중(다른 매칭 제외 대상).
        "system": false, "id": "mch104status", "name": "status",
        "type": "select", "required": true, "presentable": true, "unique": false,
        "options": { "maxSelect": 1, "values": ["offline", "available", "matched"] }
      },
      {
        // "고팡 블랙박스" 자동 GPS 전송 하드웨어는 실존하지 않음(2026-07-26
        // 조사로 확인) — 기사 측 웹/앱이 navigator.geolocation으로 주기적
        // 자진 전송하는 값을 그대로 저장한다.
        "system": false, "id": "mch105curlat", "name": "current_lat",
        "type": "number", "required": false, "presentable": true, "unique": false,
        "options": { "min": -90, "max": 90 }
      },
      {
        "system": false, "id": "mch106curlng", "name": "current_lng",
        "type": "number", "required": false, "presentable": true, "unique": false,
        "options": { "min": -180, "max": 180 }
      },
      {
        "system": false, "id": "mch107locupdat", "name": "location_updated_at",
        "type": "date", "required": false, "presentable": true, "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false, "id": "mch108createdat", "name": "created_at",
        "type": "date", "required": true, "presentable": true, "unique": false,
        "options": { "min": "", "max": "" }
      }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_match_vehicles_owner ON match_vehicles (owner_guid_hash)",
      "CREATE INDEX idx_match_vehicles_status_type ON match_vehicles (status, vehicle_type)"
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
  const collection = dao.findCollectionByNameOrId("match_vehicles");
  return dao.deleteCollection(collection);
});
