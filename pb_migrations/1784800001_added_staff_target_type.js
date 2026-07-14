/// <reference path="../pb_data/types.d.ts" />
// 2026-07-14 신설 — 부서 SP가 개인 직원 AC에게 "작업을 게시"할 수 있도록
// target_type에 staff(특정 직원)·org_staff_pool(그 부서 검증된 직원
//누구나 집어갈 수 있는 공용 게시판)을 추가한다. STAFF_TASK_QUEUE_v1_0.md
// 참고 — 이건 "호출"이 아니라 "게시"다(AGENCY-AC-COMMON 0-4 준수).
migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("dtq7f2k9m3xh010") // dept_tasks
  const field = collection.schema.getFieldById("dtf004target_type")
  field.options.values = ["dept", "org", "business", "national", "k-service", "staff", "org_staff_pool"]
  return dao.saveCollection(collection)
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("dtq7f2k9m3xh010")
  const field = collection.schema.getFieldById("dtf004target_type")
  field.options.values = ["dept", "org", "business", "national", "k-service"]
  return dao.saveCollection(collection)
})
