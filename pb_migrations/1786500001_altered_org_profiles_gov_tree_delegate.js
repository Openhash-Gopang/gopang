/// <reference path="../pb_data/types.d.ts" />
// org_profiles 스키마 확장 — gov_tree_delegate 전략 신설 (2026-08-05)
//
// 배경: org_profiles(K-Compose가 소비하는 오케스트레이션 레지스트리)와
// gov-tree(gov-router.js, kregionalgov가 실제로 서빙하는 지방행정 SP
// 콘텐츠)가 지금까지 완전히 분리된 두 신원 체계로 같은 기관을 각자
// 따로 등록해왔다 — 예: "부산광역시 해운대구"가 gov-tree에서는
// 시코드=busan_haeundae로 완결된 SP를 갖고 있는데, org_profiles에는
// gov24-org:3330000이라는 별개 ID로 connected:false·빈 껍데기 상태로만
// 등록돼 있었다(1786400001_seeded_benefit_catalog_orgs_full.js). K-Compose가
// 오케스트레이션 계획을 짤 때 이 기관을 조회하면 "연결 안 됨"이라는
// 틀린 정보만 얻는다.
//
// 해법: org_profiles의 admin_local 레코드가 자체 데이터를 중복 보유하지
// 않고, gov-tree의 기존 라우팅 코드를 가리키는 얇은 포인터가 되도록
// resolution_strategy에 새 값(gov_tree_delegate)과 그 포인터를 담을
// 필드(gov_tree_ref)를 추가한다. gov_tree_ref 형식은 gov-router.js
// directCode 규약과 동일한 "{tier}:{code}"다:
//   - province: "province:{도코드}"        (예: province:gyeonggi)
//   - city:     "city:{SP코드}"             (예: city:SP-CITY-BUSAN_HAEUNDAE)
// 이 규약을 실제로 받아주는 tier='province' 핸들러는 이 마이그레이션과
// 같은 세션에서 gov-router.js에 함께 신설했다(전에는 tier='city' 아래
// 계층만 있고 도청 자체 진입점이 없었음 — 이번에 발견한 공백).
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("org_profiles");

  // resolution_strategy select 필드에 새 값 추가
  const strategyField = collection.schema.getFieldById("d205ca55849cd4");
  strategyField.options.values = [
    ...strategyField.options.values,
    "gov_tree_delegate",
  ];

  // gov_tree_ref 필드 신설 — resolution_strategy=gov_tree_delegate일 때만
  // 의미 있음(다른 전략에서는 빈 값). "{tier}:{code}" 형식, gov-router.js
  // directCode 파서가 그대로 소비 가능.
  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "gtref0805a1",
    "name": "gov_tree_ref",
    "type": "text",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": {
      "min": null,
      "max": null,
      "pattern": "^(province|city|city-dept|emd|do-dept|do-agency|org):.+$",
    },
  }));

  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("org_profiles");

  const strategyField = collection.schema.getFieldById("d205ca55849cd4");
  strategyField.options.values = strategyField.options.values.filter(
    (v) => v !== "gov_tree_delegate"
  );

  collection.schema.removeField("gtref0805a1");

  return dao.saveCollection(collection);
})
