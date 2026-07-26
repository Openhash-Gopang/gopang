/// <reference path="../pb_data/types.d.ts" />
// 2026-07-26 신설 — 피터님 결정: 버스·택시·화물차도 팜플렛이 약속한
// "모든 교통 수단" 범위에 포함한다. 별도의 대중교통 노선 시스템이나
// 면허 택시 배차 인프라를 새로 만드는 게 아니라, 그 차량의 운전자가
// 혼디 앱에서 이 트래픽 모듈을 활성화(match_vehicles 등록)하면 기존
// 매칭 파이프라인을 그대로 타게 하는 방식 — vehicle_type 선택지만
// 확장하면 되고 매칭·결제·실시간알림 로직은 전부 재사용된다.
migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("match_vehicles")
  const field = collection.schema.getFieldById("mch102vehtype")
  field.options.values = ["passenger", "taxi", "bus", "cargo"]
  return dao.saveCollection(collection)
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("match_vehicles")
  const field = collection.schema.getFieldById("mch102vehtype")
  field.options.values = ["passenger", "cargo"]
  return dao.saveCollection(collection)
})
