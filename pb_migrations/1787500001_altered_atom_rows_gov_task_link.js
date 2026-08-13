/// <reference path="../pb_data/types.d.ts" />
// atom_rows 스키마 확장 — gov_task_agency/gov_task_key 필드 신설 (2026-08-13)
//
// 배경: K-Compose/K-Execute 오케스트레이션(procedure_maps/atom_rows/CALL_GOVSYS)과
// GOV_TASK/dept_task 파이프라인(REQUIRED_DOCUMENTS_REGISTRY/GOV_TASK_SUBMIT_REQUEST/
// handleGovTaskSubmit)이 지금까지 완전히 분리된 두 실행 경로였다 — K-Execute STEP1의
// atom_id 분기는 automation_sp(CALL_GOVSYS)로만 위임하고, GOV_TASK_SUBMIT_REQUEST는
// kpublic 등 도메인 SP만 알고 있어 K-Execute를 거친 요청은 dept_task를 전혀 생성하지
// 않았다 — Pathfinder(dept_task_events 기반)가 이 경로를 볼 수 없었다는 뜻이기도 하다.
//
// 해법: gov_tree_delegate(org_profiles, 2026-08-05)와 동일한 패턴 — atom_rows에
// REQUIRED_DOCUMENTS_REGISTRY를 가리키는 얇은 포인터 필드 2개를 추가한다. 이 값이
// 둘 다 있으면 K-Execute는 automation_sp 분기보다 먼저 GOV_TASK_SUBMIT_REQUEST를
// 낸다(SP-22_kexecute 지침 동시 수정) — CALL_GOVSYS(실제 API 자동화 여부)와는 별개로,
// "정식 접수·추적 시작"은 항상 먼저 이뤄지게 한다. ADJUDICATE 패턴처럼 본인인증이
// 필요해 자동화 대상이 아닌 atom(court-filing 등)도 접수·추적 자체는 가능하므로
// 이 필드는 pattern·automation_sp 유무와 무관하게 채울 수 있다.
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("atom_rows");

  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "gtaskagcy0813",
    "name": "gov_task_agency",
    "type": "text",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": { "min": null, "max": null, "pattern": "" },
  }));

  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "gtaskkey0813",
    "name": "gov_task_key",
    "type": "text",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": { "min": null, "max": null, "pattern": "" },
  }));

  dao.saveCollection(collection);

  // 실제 매핑 확인된 유일한 사례 — court-filing(ADJUDICATE, org_class=court)은
  // REQUIRED_DOCUMENTS_REGISTRY.court.personal_bankruptcy_filing과 동일한
  // 실제 절차(개인파산 신청)를 가리킨다(1783500004 시드, 2026-07-08).
  try {
    const rec = dao.findFirstRecordByData("atom_rows", "atom_id", "court-filing");
    rec.set("gov_task_agency", "court");
    rec.set("gov_task_key", "personal_bankruptcy_filing");
    dao.saveRecord(rec);
  } catch (e) {
    // court-filing 레코드가 없는 환경(테스트 DB 등)에서는 조용히 건너뜀
  }

  return null;
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("atom_rows");

  collection.schema.removeField("gtaskagcy0813");
  collection.schema.removeField("gtaskkey0813");

  return dao.saveCollection(collection);
})
