/// <reference path="../pb_data/types.d.ts" />
// 2026-07-15 — 발견① P0 마무리: digit_code_id에 실제 유니크 인덱스 추가.
//
// "unique": true 스키마 플래그만으로는 PocketBase v0.22.14에서 아무
// 효과가 없음을 실제 바이너리로 확인(대화 로그 참고) — 반드시 진짜
// SQL 인덱스가 있어야 강제된다. digit_code_id가 빈 문자열인 레코드
// (전화번호 없는 프로필)는 여러 개 허용해야 하므로 WHERE 절로 제외.
//
// 적용 전 필수: 기존 중복 데이터가 없어야 마이그레이션이 성공한다.
//   sqlite3 data.db "SELECT digit_code_id, COUNT(*) FROM profiles
//     WHERE digit_code_id != '' GROUP BY digit_code_id HAVING COUNT(*) > 1;"
//   (2026-07-15 확인 시점 기준 hanlim 노드에 중복 없음)
migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("1fjkz4szfer124h")

  collection.indexes = collection.indexes.concat([
    "CREATE UNIQUE INDEX idx_profiles_digit_code_id ON profiles (digit_code_id) WHERE digit_code_id != ''"
  ])

  return dao.saveCollection(collection)
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("1fjkz4szfer124h")

  collection.indexes = collection.indexes.filter((idx) => !idx.includes("idx_profiles_digit_code_id"))

  return dao.saveCollection(collection)
})
