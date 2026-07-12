/// <reference path="../pb_data/types.d.ts" />
// 2026-07-12 — SP-18_ksearch STEP3(미청구 프로필 생성) 선행조건 (a) 구현.
//
// K-Search가 "Hondi에 등록 안 된 소규모 서비스업체"를 웹검색으로 찾아
// 확인받은 뒤, 서명 계정 없이도 검색 가능하게 만드는 잠정(unclaimed)
// 프로필을 만든다. claim_status가 'unclaimed'인 레코드는:
//   - handleProfilePost가 서명(pubkey/signature) 없이도 생성을 허용
//   - handleSearch가 phone 등 민감 필드를 마스킹한 채로만 반환
//   - 실제 업체 관계자가 /profile/claim으로 서명 등록하면 'claimed'로 전환
//
// 검색 필터링(claim_status=unclaimed인 것만 별도 취급)이 필요해 이전
// 마이그레이션(1784000001, srch_* 필드들)과 같은 원칙으로 톱레벨
// select 필드로 추가한다 — extra(JSON) 안에 묻으면 PocketBase 필터가
// 인덱스를 못 탄다는 점이 이미 그 커밋에서 확인된 전례.
migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("1fjkz4szfer124h")

  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "clm_status01",
    "name": "claim_status",
    "type": "select",
    "required": false,
    "presentable": true,
    "unique": false,
    "options": {
      "maxSelect": 1,
      "values": ["claimed", "unclaimed"]
    }
  }))

  // 미청구 프로필의 출처 기록 — K-Search가 웹검색으로 채운 것인지,
  // 향후 다른 경로(예: 공공데이터 포털 일괄 임포트)로 채운 것인지 구분.
  // 감사(audit) 목적 — 검색/필터에는 안 쓰이므로 text로 충분.
  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "clm_source01",
    "name": "claim_source",
    "type": "text",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": { "min": null, "max": null, "pattern": "" }
  }))

  return dao.saveCollection(collection)
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("1fjkz4szfer124h")

  collection.schema.removeField("clm_status01")
  collection.schema.removeField("clm_source01")

  return dao.saveCollection(collection)
})
