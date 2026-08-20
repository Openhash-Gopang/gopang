/// <reference path="../pb_data/types.d.ts" />
// pdv_records에 receipt_no(text, 인덱스) 필드 신설 (2026-08-20)
//
// 배경: GOV-TASK-POST-ACCEPTANCE-REVIEW_v2_1가 정의하는 심사·보완·의견제출·
// 결재 흐름은 모두 "이 receipt_no의 케이스"를 반복 조회한다. 지금까지는
// receipt_no가 summary_6w(JSON 문자열) 안에만 있어서, PocketBase filter로
// 직접 대조할 방법이 없었다 — handleGovTaskBatchStatus가 이미 이 한계를
// 겪고 있다(guid + type으로 넓게 가져온 뒤 서버에서 JSON.parse로 매 레코드
// 순회·대조, batch_id 전용). receipt_no 단건 조회를 같은 방식으로 반복하면
// 케이스 수가 늘수록 스캔 비용이 커진다 — 이번 심사 파이프라인은 한
// receipt_no당 여러 이벤트(접수→보완요청→재제출→의견제출→결재)가 쌓이므로
// 특히 그렇다.
//
// 해법: atom_rows의 gov_task_agency/gov_task_key(1787500001)와 동일한
// 패턴 — 이미 JSON 안에 있는 값을 가리키는 얇은 인덱스 필드를 하나 추가한다.
// summary_6w는 그대로 두고(하위호환 유지, 기존 조회 코드 안 깨짐), 쓰기
// 시점(handleGovTaskSubmit 등)에 이 필드도 함께 채운다. receipt_no가 없는
// 레코드(pending_documents 등 접수 전 상태, 또는 gov_task_submission이 아닌
// 다른 type)는 빈 문자열로 둔다 — required:false.
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("pdv_records");

  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "pdvrcpt0820",
    "name": "receipt_no",
    "type": "text",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": { "min": null, "max": null, "pattern": "" },
  }));

  dao.saveCollection(collection);

  // 조회 성능 — receipt_no 단독 인덱스. unique로 걸지 않는 이유: 한
  // receipt_no에 접수/보완요청/재제출/의견제출/결재 등 여러 이벤트 레코드가
  // 쌓이는 설계이므로(이 컬렉션 자체가 append-only 감사로그, handleGovTaskSubmit
  // 참고) 값 자체는 중복되는 게 정상이다.
  try {
    db.newQuery('CREATE INDEX IF NOT EXISTS idx_pdv_records_receipt_no ON pdv_records (receipt_no)').execute();
  } catch (e) {
    // 이미 존재하거나(재실행) 인덱스 생성 문법이 이 PocketBase 버전과 다르면
    // 조용히 건너뛴다 — 인덱스는 성능 최적화일 뿐 필드 자체(위)가 핵심이며,
    // 인덱스 없이도 filter 쿼리 자체는 정상 동작한다.
    console.warn('[migration] idx_pdv_records_receipt_no 생성 건너뜀:', e.message);
  }

  return null;
}, (db) => {
  const dao = new Dao(db);
  try { db.newQuery('DROP INDEX IF EXISTS idx_pdv_records_receipt_no').execute(); } catch (e) {}
  const collection = dao.findCollectionByNameOrId("pdv_records");
  collection.schema.removeField("pdvrcpt0820");
  return dao.saveCollection(collection);
});
