/// <reference path="../pb_data/types.d.ts" />
// 2026-07-20 신설 — owner_pdv에 outcome_signals(JSON) 필드 추가.
//
// #4 사고실험 대응: 만족도 신호는 문장/단어 판독(감정분석 등)이 아니라
// 구조화된 행동 신호로 구성한다.
//
// 현재 담는 값: { explicit_rating: 'up' | 'down' | null } — 세션 종료 시
// 1탭 버튼(텍스트 입력 없음, 판독 불필요).
//
// 이번에 검토했지만 이 필드에 넣지 않은 신호 2가지(설계만 남김):
//   - 재상담 간격/빈도: 이미 있는 who_hash+when 인덱스로 쿼리 시점에 계산
//     가능 — 별도 필드로 미리 계산해 저장할 필요 없음.
//   - 다운스트림 전환(예: K-Market 실거래로 이어졌는지): who_hash가
//     가명화돼 있어 ledger_entries(실명 guid 기반)와 직접 조인이 불가능함을
//     확인했다 — 원문 guid를 아는 시점(Worker)에서만 도는 별도 주기적
//     배치 잡으로 사후 연계해야 하며(guid를 영속 저장하지 않고 그 잡
//     실행 중에만 해싱해 대조), 이 마이그레이션 범위 밖이다.
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("owner_pdv");
  collection.schema.addField(new SchemaField({
    "system": false, "id": "opv114outcomesig", "name": "outcome_signals",
    "type": "json", "required": false, "presentable": false, "unique": false,
    "options": { "maxSize": 2000 }
  }));
  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("owner_pdv");
  collection.schema.removeField("opv114outcomesig");
  return dao.saveCollection(collection);
});
