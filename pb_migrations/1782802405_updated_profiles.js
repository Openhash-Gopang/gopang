/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("1fjkz4szfer124h")

  // add
  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "xg9mcqgj",
    "name": "extra",
    "type": "json",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": {
      "maxSize": 2000000
    }
  }))

  return dao.saveCollection(collection)
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("1fjkz4szfer124h")

  // remove
  collection.schema.removeField("xg9mcqgj")

  return dao.saveCollection(collection)
})
