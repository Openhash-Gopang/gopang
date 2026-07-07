/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("1fjkz4szfer124h")

  // add
  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "v0wbj49q",
    "name": "pubkey_ed25519",
    "type": "text",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": {
      "min": null,
      "max": null,
      "pattern": ""
    }
  }))

  // add
  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "mfuibtip",
    "name": "x25519_pubkey",
    "type": "text",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": {
      "min": null,
      "max": null,
      "pattern": ""
    }
  }))

  // add
  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "p4aqzp0z",
    "name": "x25519_registered_at",
    "type": "text",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": {
      "min": null,
      "max": null,
      "pattern": ""
    }
  }))

  return dao.saveCollection(collection)
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("1fjkz4szfer124h")

  // remove
  collection.schema.removeField("v0wbj49q")

  // remove
  collection.schema.removeField("mfuibtip")

  // remove
  collection.schema.removeField("p4aqzp0z")

  return dao.saveCollection(collection)
})
