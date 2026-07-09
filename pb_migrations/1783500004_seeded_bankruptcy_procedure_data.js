/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const dao = new Dao(db);

  // ── org_profiles 시드 3건 (개인파산 사고실험에서 확정한 실제 사례) ──
  const orgCol = dao.findCollectionByNameOrId("org_profiles");
  {
    const rec = new Record(orgCol);
    rec.set("org_id", "court-seoul-rehab");
    rec.set("org_name", "서울회생법원");
    rec.set("branch", "judicial");
    rec.set("jurisdiction", "서울특별시 거주 채무자");
    rec.set("as_of_date", "2026-07-08");
    rec.set("guid_model", "judicial");
    rec.set("resolution_strategy", "complete_lookup_table");
    rec.set("input", "{\"required_docs\": [\"파산·면책신청서\", \"진술서\", \"채권자목록\", \"재산목록\", \"수입및지출목록\"], \"identity_verification\": \"전자소송포털 공동인증서(본인 필수)\"}");
    rec.set("output", "{\"produces\": [\"파산선고문\", \"면책결정문\"], \"format\": \"결정문\"}");
    rec.set("automation", "{\"level\": \"assisted\", \"automation_sp\": null, \"source_type\": \"manual_entry\", \"source_ref\": \"채무자 회생 및 파산에 관한 법률\"}");
    rec.set("connected", true);
    rec.set("unavailable_reason", "");
    rec.set("status", "pending_review");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(orgCol);
    rec.set("org_id", "gov24");
    rec.set("org_name", "정부민원포털 정부24");
    rec.set("branch", "admin_central");
    rec.set("jurisdiction", "전국");
    rec.set("as_of_date", "2026-07-08");
    rec.set("guid_model", "government_agency");
    rec.set("resolution_strategy", "single_national_instance");
    rec.set("input", "{\"required_docs\": [\"본인 인증 정보\"], \"identity_verification\": \"공동인증서/간편인증\"}");
    rec.set("output", "{\"produces\": [\"가족관계증명서\", \"주민등록등본 등 760여종\"], \"format\": \"API/PDF\"}");
    rec.set("automation", "{\"level\": \"full_api\", \"automation_sp\": \"GOVSYS-GOV24-FAMILY-CERT\", \"source_type\": \"api\", \"source_ref\": \"data.go.kr 정부24 연계 API(확인 필요)\"}");
    rec.set("connected", false);
    rec.set("unavailable_reason", "실제 API 연동 미착수(worker.js 패치 필요)");
    rec.set("status", "pending_review");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(orgCol);
    rec.set("org_id", "nice-credit");
    rec.set("org_name", "NICE평가정보");
    rec.set("branch", "private_registry");
    rec.set("jurisdiction", "전국(민간)");
    rec.set("as_of_date", "2026-07-08");
    rec.set("guid_model", "private_registry");
    rec.set("resolution_strategy", "user_choice");
    rec.set("input", "{\"required_docs\": [\"본인 신용조회 동의\"], \"identity_verification\": \"본인인증(민간 인증서비스)\"}");
    rec.set("output", "{\"produces\": [\"개인신용정보·채무현황\"], \"format\": \"조회 결과서\"}");
    rec.set("automation", "{\"level\": \"manual_only\", \"automation_sp\": null, \"source_type\": \"manual_entry\", \"source_ref\": null}");
    rec.set("connected", false);
    rec.set("unavailable_reason", "민간기관 연동 계약·API 확인 안 됨(★ 미구현 ★)");
    rec.set("status", "pending_review");
    dao.saveRecord(rec);
  }

  // ── atom_rows 시드 5건 (개인파산 절차 직접 관련분만) ──
  const atomCol = dao.findCollectionByNameOrId("atom_rows");
  {
    const rec = new Record(atomCol);
    rec.set("atom_id", "gov24-family-cert");
    rec.set("pattern", "QUERY");
    rec.set("org_class", "gov24");
    rec.set("required_docs", "[\"본인 인증 정보\"]");
    rec.set("automation_sp", "GOVSYS-GOV24-FAMILY-CERT");
    rec.set("connected", false);
    rec.set("unavailable_reason", "정부24 API 연동 미착수");
    rec.set("status", "pending_review");
    rec.set("pay_subtype", "");
    rec.set("regulatory_intensity", "");
    rec.set("creates_new_status", false);
    rec.set("outcome_type", "");
    rec.set("adjudicate_subtype", "");
    rec.set("escalation_to", "");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(atomCol);
    rec.set("atom_id", "gov24-resident-cert");
    rec.set("pattern", "QUERY");
    rec.set("org_class", "gov24");
    rec.set("required_docs", "[\"본인 인증 정보\"]");
    rec.set("automation_sp", "GOVSYS-GOV24-RESIDENT-CERT");
    rec.set("connected", false);
    rec.set("unavailable_reason", "정부24 API 연동 미착수");
    rec.set("status", "pending_review");
    rec.set("pay_subtype", "");
    rec.set("regulatory_intensity", "");
    rec.set("creates_new_status", false);
    rec.set("outcome_type", "");
    rec.set("adjudicate_subtype", "");
    rec.set("escalation_to", "");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(atomCol);
    rec.set("atom_id", "court-filing");
    rec.set("pattern", "ADJUDICATE");
    rec.set("org_class", "court");
    rec.set("required_docs", "[\"파산·면책신청서\", \"진술서\", \"채권자목록\", \"재산목록\", \"수입및지출목록\"]");
    rec.set("automation_sp", "");
    rec.set("connected", true);
    rec.set("unavailable_reason", "본인인증 필수라 완전자동화 대상 아님(전자소송포털)");
    rec.set("status", "pending_review");
    rec.set("pay_subtype", "");
    rec.set("regulatory_intensity", "");
    rec.set("creates_new_status", false);
    rec.set("outcome_type", "");
    rec.set("adjudicate_subtype", "judicial");
    rec.set("escalation_to", "");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(atomCol);
    rec.set("atom_id", "hometax-income-cert");
    rec.set("pattern", "QUERY");
    rec.set("org_class", "nts");
    rec.set("required_docs", "[\"본인 인증 정보\"]");
    rec.set("automation_sp", "GOVSYS-HOMETAX-INCOME-CERT");
    rec.set("connected", false);
    rec.set("unavailable_reason", "홈택스 API 연동 미착수");
    rec.set("status", "pending_review");
    rec.set("pay_subtype", "");
    rec.set("regulatory_intensity", "");
    rec.set("creates_new_status", false);
    rec.set("outcome_type", "");
    rec.set("adjudicate_subtype", "");
    rec.set("escalation_to", "");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(atomCol);
    rec.set("atom_id", "credit-check");
    rec.set("pattern", "QUERY");
    rec.set("org_class", "nice-credit");
    rec.set("required_docs", "[\"본인 신용조회 동의\"]");
    rec.set("automation_sp", "");
    rec.set("connected", false);
    rec.set("unavailable_reason", "민간기관, 자동조회 수단 미구현(★ 미구현 ★)");
    rec.set("status", "pending_review");
    rec.set("pay_subtype", "");
    rec.set("regulatory_intensity", "");
    rec.set("creates_new_status", false);
    rec.set("outcome_type", "");
    rec.set("adjudicate_subtype", "");
    rec.set("escalation_to", "");
    dao.saveRecord(rec);
  }

  // ── procedure_maps 시드 1건 — 개인파산 면책 (1~4차 라운드 설계 그대로) ──
  const procCol = dao.findCollectionByNameOrId("procedure_maps");
  {
    const rec = new Record(procCol);
    rec.set("goal", "개인파산 면책");
    rec.set("domain", "사법·채무");
    rec.set("status", "pending_review");
    rec.set("steps", "[{\"seq\": 1, \"atom_id\": \"court-filing\", \"expert_advisor\": \"lawyer\", \"condition\": null, \"parallel_group\": null}, {\"seq\": 2, \"atom_id\": \"gov24-family-cert\", \"expert_advisor\": null, \"condition\": null, \"parallel_group\": \"A\"}, {\"seq\": 3, \"atom_id\": \"gov24-resident-cert\", \"expert_advisor\": null, \"condition\": null, \"parallel_group\": \"A\"}, {\"seq\": 4, \"atom_id\": \"credit-check\", \"expert_advisor\": null, \"condition\": null, \"parallel_group\": null}, {\"seq\": 5, \"atom_id\": \"hometax-income-cert\", \"expert_advisor\": null, \"condition\": null, \"parallel_group\": null}]");
    rec.set("eligibility_gate", "[{\"item\": \"최근 5년 낭비성 소비 없음\", \"source\": \"채무자 회생 및 파산에 관한 법률 제564조(면책불허가사유)\"}, {\"item\": \"7년 이내 재면책 제한 없음\", \"source\": \"동법 제564조 — 사고실험 #22에서 추가 발견\"}]");
    rec.set("free_alternative", "{\"org_id\": \"legal-aid-corp\", \"condition\": \"소득기준 충족 시(대한법률구조공단)\"}");
    rec.set("as_of_date", "2026-07-08");
    rec.set("orchestrator", "AC");
    dao.saveRecord(rec);
  }
}, (db) => {
  const dao = new Dao(db);

  // org_profiles 시드 삭제
  const orgIds = ["court-seoul-rehab", "gov24", "nice-credit"];
  orgIds.forEach((id) => {
    try {
      const r = dao.findFirstRecordByData("org_profiles", "org_id", id);
      dao.deleteRecord(r);
    } catch (e) { /* 이미 없으면 무시 */ }
  });
  // atom_rows 시드 삭제
  const atomIds = ["gov24-family-cert", "gov24-resident-cert", "court-filing", "hometax-income-cert", "credit-check"];
  atomIds.forEach((id) => {
    try {
      const r = dao.findFirstRecordByData("atom_rows", "atom_id", id);
      dao.deleteRecord(r);
    } catch (e) { /* 이미 없으면 무시 */ }
  });
  // procedure_maps 시드 삭제
  try {
    const r = dao.findFirstRecordByData("procedure_maps", "goal", "개인파산 면책");
    dao.deleteRecord(r);
  } catch (e) { /* 이미 없으면 무시 */ }
})
