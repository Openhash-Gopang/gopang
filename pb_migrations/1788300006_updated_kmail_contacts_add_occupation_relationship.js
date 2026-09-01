/// <reference path="../pb_data/types.d.ts" />
// 2026-09-01 신설 — 주소록 다차원 분류·검색(주피터 지시): 직업, 소속
// 기관(org/dept는 이미 있음), 나와의 관계(가족/친구/직장/업무 등)로
// 분류·검색 가능해야 한다. kmail_contacts가 곧 주소록이다 —
// status='confirmed'가 "주소록에 저장된 상태"이므로 별도 컬렉션을
// 새로 만들지 않고 여기에 필드 2개만 추가한다.
//
// relationship은 select가 아니라 text(자유 입력)로 뒀다 — 예시로 든
// 가족/친구/직장/업무 외에도 "은사님", "학회 지인"처럼 실제 관계는
// 미리 정한 값으로 다 못 담는다. 검색은 handleKmailContactsList의
// relationship 파라미터가 '~'(부분일치) 필터로 처리한다.
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0001contact");
  collection.schema.addField(new SchemaField({
    "system": false, "id": "kmc011occ", "name": "occupation", "type": "text",
    "required": false, "presentable": true, "unique": false,
    "options": { "min": null, "max": null, "pattern": "" },
  }));
  collection.schema.addField(new SchemaField({
    "system": false, "id": "kmc012rel", "name": "relationship", "type": "text",
    "required": false, "presentable": true, "unique": false,
    "options": { "min": null, "max": 100, "pattern": "" },
    "description": "나와의 관계 자유 기술 (예: 가족, 친구, 직장 동료, 업무 파트너 등)",
  }));
  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("kmc0001contact");
  collection.schema.removeField("kmc011occ");
  collection.schema.removeField("kmc012rel");
  return dao.saveCollection(collection);
})
