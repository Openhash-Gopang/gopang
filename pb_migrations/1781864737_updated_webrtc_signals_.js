/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("3nq6x0w73s783bq")

  collection.name = "webrtc_signals"

  return dao.saveCollection(collection)
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("3nq6x0w73s783bq")

  collection.name = "webrtc_signals_"

  return dao.saveCollection(collection)
})
