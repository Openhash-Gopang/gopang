/// <reference path="../pb_data/types.d.ts" />
// 2026-09-01 신설 — K-Mail 보낸함/받은함 조회("sender_guid=내guid" /
// "receiver_guid=내guid" 필터)가 지금까지 session_id 인덱스만 있는
// ai_messages를 인덱스 없이 스캔하게 된다. K-Mail 전용 컬렉션을 새로
// 만드는 대신(§ ai_messages를 그대로 재사용하는 기존 원칙 유지) 인덱스만
// 추가한다 — gov-mail 등 이 컬렉션을 쓰는 다른 기능의 조회에도 도움이 됨.
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("ai_messages");
  collection.indexes = [
    ...collection.indexes,
    "CREATE INDEX idx_ai_messages_sender_guid ON ai_messages (sender_guid)",
    "CREATE INDEX idx_ai_messages_receiver_guid ON ai_messages (receiver_guid)",
  ];
  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("ai_messages");
  collection.indexes = collection.indexes.filter(idx =>
    !idx.includes('idx_ai_messages_sender_guid') && !idx.includes('idx_ai_messages_receiver_guid'));
  return dao.saveCollection(collection);
})
