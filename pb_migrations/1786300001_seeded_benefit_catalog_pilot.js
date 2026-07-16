/// <reference path="../pb_data/types.d.ts" />
// 혜택 카탈로그(civil-petitions-raw.json, 10,966건) 파일럿 시딩 — 30건 표본
// (서비스분야 10종 x 3건). docs/HANDOFF-혜택카탈로그트랙_2026-07-16.md 인수인계
// 후 첫 파일럿. eligibility_gate 파싱은 정규식 기반 최소 추출이며, 대부분
// confidence:"none"으로 남아 사람 검토가 필요함을 그대로 노출한다 — 없는
// 정확도를 지어내지 않는다(U2 원칙). 전수(10,966건) 적재 전 스키마 검증용.
migrate((db) => {
  const dao = new Dao(db);

  // ── org_profiles 시드 10건 ──
  const orgCol = dao.findCollectionByNameOrId("org_profiles");
  {
    const rec = new Record(orgCol);
    rec.set("org_id", "gov24-org:1342000");
    rec.set("org_name", "교육부");
    rec.set("branch", "admin_central");
    rec.set("jurisdiction", "전국");
    rec.set("as_of_date", "2026-07-16");
    rec.set("guid_model", "government_agency");
    rec.set("resolution_strategy", "complete_lookup_table");
    rec.set("input", "{\"required_docs\": [\"본인 인증 정보\"], \"identity_verification\": \"정부24/기관별 상이(파일럿 단계 미확정)\"}");
    rec.set("output", "{\"produces\": [\"복지·지원 서비스\"], \"format\": \"지원금/서비스\", \"dept\": \"영유아재정과\"}");
    rec.set("automation", "{\"level\": \"manual_only\", \"automation_sp\": null, \"source_type\": \"manual_entry\", \"source_ref\": \"civil-petitions-raw.json 파일럿 — 미검증\"}");
    rec.set("connected", false);
    rec.set("unavailable_reason", "혜택 카탈로그 파일럿 단계 — 전수 검증 전");
    rec.set("status", "pending_review");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(orgCol);
    rec.set("org_id", "gov24-org:1220000");
    rec.set("org_name", "관세청");
    rec.set("branch", "admin_central");
    rec.set("jurisdiction", "전국");
    rec.set("as_of_date", "2026-07-16");
    rec.set("guid_model", "government_agency");
    rec.set("resolution_strategy", "complete_lookup_table");
    rec.set("input", "{\"required_docs\": [\"본인 인증 정보\"], \"identity_verification\": \"정부24/기관별 상이(파일럿 단계 미확정)\"}");
    rec.set("output", "{\"produces\": [\"복지·지원 서비스\"], \"format\": \"지원금/서비스\", \"dept\": \"자유무역협정집행과\"}");
    rec.set("automation", "{\"level\": \"manual_only\", \"automation_sp\": null, \"source_type\": \"manual_entry\", \"source_ref\": \"civil-petitions-raw.json 파일럿 — 미검증\"}");
    rec.set("connected", false);
    rec.set("unavailable_reason", "혜택 카탈로그 파일럿 단계 — 전수 검증 전");
    rec.set("status", "pending_review");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(orgCol);
    rec.set("org_id", "gov24-org:1270000");
    rec.set("org_name", "법무부");
    rec.set("branch", "admin_central");
    rec.set("jurisdiction", "전국");
    rec.set("as_of_date", "2026-07-16");
    rec.set("guid_model", "government_agency");
    rec.set("resolution_strategy", "complete_lookup_table");
    rec.set("input", "{\"required_docs\": [\"본인 인증 정보\"], \"identity_verification\": \"정부24/기관별 상이(파일럿 단계 미확정)\"}");
    rec.set("output", "{\"produces\": [\"복지·지원 서비스\"], \"format\": \"지원금/서비스\", \"dept\": \"소년범죄예방팀\"}");
    rec.set("automation", "{\"level\": \"manual_only\", \"automation_sp\": null, \"source_type\": \"manual_entry\", \"source_ref\": \"civil-petitions-raw.json 파일럿 — 미검증\"}");
    rec.set("connected", false);
    rec.set("unavailable_reason", "혜택 카탈로그 파일럿 단계 — 전수 검증 전");
    rec.set("status", "pending_review");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(orgCol);
    rec.set("org_id", "gov24-org:1210000");
    rec.set("org_name", "국세청");
    rec.set("branch", "admin_central");
    rec.set("jurisdiction", "전국");
    rec.set("as_of_date", "2026-07-16");
    rec.set("guid_model", "government_agency");
    rec.set("resolution_strategy", "complete_lookup_table");
    rec.set("input", "{\"required_docs\": [\"본인 인증 정보\"], \"identity_verification\": \"정부24/기관별 상이(파일럿 단계 미확정)\"}");
    rec.set("output", "{\"produces\": [\"복지·지원 서비스\"], \"format\": \"지원금/서비스\", \"dept\": \"장려세제과\"}");
    rec.set("automation", "{\"level\": \"manual_only\", \"automation_sp\": null, \"source_type\": \"manual_entry\", \"source_ref\": \"civil-petitions-raw.json 파일럿 — 미검증\"}");
    rec.set("connected", false);
    rec.set("unavailable_reason", "혜택 카탈로그 파일럿 단계 — 전수 검증 전");
    rec.set("status", "pending_review");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(orgCol);
    rec.set("org_id", "gov24-org:B551408");
    rec.set("org_name", "한국주택금융공사");
    rec.set("branch", "public_institution");
    rec.set("jurisdiction", "전국");
    rec.set("as_of_date", "2026-07-16");
    rec.set("guid_model", "government_agency");
    rec.set("resolution_strategy", "complete_lookup_table");
    rec.set("input", "{\"required_docs\": [\"본인 인증 정보\"], \"identity_verification\": \"정부24/기관별 상이(파일럿 단계 미확정)\"}");
    rec.set("output", "{\"produces\": [\"복지·지원 서비스\"], \"format\": \"지원금/서비스\", \"dept\": \"주택보증부\"}");
    rec.set("automation", "{\"level\": \"manual_only\", \"automation_sp\": null, \"source_type\": \"manual_entry\", \"source_ref\": \"civil-petitions-raw.json 파일럿 — 미검증\"}");
    rec.set("connected", false);
    rec.set("unavailable_reason", "혜택 카탈로그 파일럿 단계 — 전수 검증 전");
    rec.set("status", "pending_review");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(orgCol);
    rec.set("org_id", "gov24-org:1250000");
    rec.set("org_name", "통일부");
    rec.set("branch", "admin_central");
    rec.set("jurisdiction", "전국");
    rec.set("as_of_date", "2026-07-16");
    rec.set("guid_model", "government_agency");
    rec.set("resolution_strategy", "complete_lookup_table");
    rec.set("input", "{\"required_docs\": [\"본인 인증 정보\"], \"identity_verification\": \"정부24/기관별 상이(파일럿 단계 미확정)\"}");
    rec.set("output", "{\"produces\": [\"복지·지원 서비스\"], \"format\": \"지원금/서비스\", \"dept\": \"자립지원과\"}");
    rec.set("automation", "{\"level\": \"manual_only\", \"automation_sp\": null, \"source_type\": \"manual_entry\", \"source_ref\": \"civil-petitions-raw.json 파일럿 — 미검증\"}");
    rec.set("connected", false);
    rec.set("unavailable_reason", "혜택 카탈로그 파일럿 단계 — 전수 검증 전");
    rec.set("status", "pending_review");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(orgCol);
    rec.set("org_id", "gov24-org:1192000");
    rec.set("org_name", "해양수산부");
    rec.set("branch", "admin_central");
    rec.set("jurisdiction", "전국");
    rec.set("as_of_date", "2026-07-16");
    rec.set("guid_model", "government_agency");
    rec.set("resolution_strategy", "complete_lookup_table");
    rec.set("input", "{\"required_docs\": [\"본인 인증 정보\"], \"identity_verification\": \"정부24/기관별 상이(파일럿 단계 미확정)\"}");
    rec.set("output", "{\"produces\": [\"복지·지원 서비스\"], \"format\": \"지원금/서비스\", \"dept\": \"어선안전정책과\"}");
    rec.set("automation", "{\"level\": \"manual_only\", \"automation_sp\": null, \"source_type\": \"manual_entry\", \"source_ref\": \"civil-petitions-raw.json 파일럿 — 미검증\"}");
    rec.set("connected", false);
    rec.set("unavailable_reason", "혜택 카탈로그 파일럿 단계 — 전수 검증 전");
    rec.set("status", "pending_review");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(orgCol);
    rec.set("org_id", "gov24-org:1371000");
    rec.set("org_name", "문화체육관광부");
    rec.set("branch", "admin_central");
    rec.set("jurisdiction", "전국");
    rec.set("as_of_date", "2026-07-16");
    rec.set("guid_model", "government_agency");
    rec.set("resolution_strategy", "complete_lookup_table");
    rec.set("input", "{\"required_docs\": [\"본인 인증 정보\"], \"identity_verification\": \"정부24/기관별 상이(파일럿 단계 미확정)\"}");
    rec.set("output", "{\"produces\": [\"복지·지원 서비스\"], \"format\": \"지원금/서비스\", \"dept\": \"관광정책과\"}");
    rec.set("automation", "{\"level\": \"manual_only\", \"automation_sp\": null, \"source_type\": \"manual_entry\", \"source_ref\": \"civil-petitions-raw.json 파일럿 — 미검증\"}");
    rec.set("connected", false);
    rec.set("unavailable_reason", "혜택 카탈로그 파일럿 단계 — 전수 검증 전");
    rec.set("status", "pending_review");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(orgCol);
    rec.set("org_id", "gov24-org:1352000");
    rec.set("org_name", "보건복지부");
    rec.set("branch", "admin_central");
    rec.set("jurisdiction", "전국");
    rec.set("as_of_date", "2026-07-16");
    rec.set("guid_model", "government_agency");
    rec.set("resolution_strategy", "complete_lookup_table");
    rec.set("input", "{\"required_docs\": [\"본인 인증 정보\"], \"identity_verification\": \"정부24/기관별 상이(파일럿 단계 미확정)\"}");
    rec.set("output", "{\"produces\": [\"복지·지원 서비스\"], \"format\": \"지원금/서비스\", \"dept\": \"기초의료보장과\"}");
    rec.set("automation", "{\"level\": \"manual_only\", \"automation_sp\": null, \"source_type\": \"manual_entry\", \"source_ref\": \"civil-petitions-raw.json 파일럿 — 미검증\"}");
    rec.set("connected", false);
    rec.set("unavailable_reason", "혜택 카탈로그 파일럿 단계 — 전수 검증 전");
    rec.set("status", "pending_review");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(orgCol);
    rec.set("org_id", "gov24-org:1290000");
    rec.set("org_name", "국방부");
    rec.set("branch", "admin_central");
    rec.set("jurisdiction", "전국");
    rec.set("as_of_date", "2026-07-16");
    rec.set("guid_model", "government_agency");
    rec.set("resolution_strategy", "complete_lookup_table");
    rec.set("input", "{\"required_docs\": [\"본인 인증 정보\"], \"identity_verification\": \"정부24/기관별 상이(파일럿 단계 미확정)\"}");
    rec.set("output", "{\"produces\": [\"복지·지원 서비스\"], \"format\": \"지원금/서비스\", \"dept\": \"국방일자리정책과\"}");
    rec.set("automation", "{\"level\": \"manual_only\", \"automation_sp\": null, \"source_type\": \"manual_entry\", \"source_ref\": \"civil-petitions-raw.json 파일럿 — 미검증\"}");
    rec.set("connected", false);
    rec.set("unavailable_reason", "혜택 카탈로그 파일럿 단계 — 전수 검증 전");
    rec.set("status", "pending_review");
    dao.saveRecord(rec);
  }

  // ── atom_rows 시드 2건 (재사용 패턴 2개) ──
  const atomCol = dao.findCollectionByNameOrId("atom_rows");
  {
    const rec = new Record(atomCol);
    rec.set("atom_id", "welfare-apply-online");
    rec.set("pattern", "APPLY");
    rec.set("org_class", "benefit-provider");
    rec.set("required_docs", "[]");
    rec.set("automation_sp", null);
    rec.set("connected", false);
    rec.set("unavailable_reason", "정부24/복지로 등 온라인 신청 가능");
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
    rec.set("atom_id", "welfare-apply-visit");
    rec.set("pattern", "APPLY");
    rec.set("org_class", "benefit-provider");
    rec.set("required_docs", "[]");
    rec.set("automation_sp", null);
    rec.set("connected", false);
    rec.set("unavailable_reason", "읍면동 주민센터 등 방문신청 필수 — automation 상한선");
    rec.set("status", "pending_review");
    rec.set("pay_subtype", "");
    rec.set("regulatory_intensity", "");
    rec.set("creates_new_status", false);
    rec.set("outcome_type", "");
    rec.set("adjudicate_subtype", "");
    rec.set("escalation_to", "");
    dao.saveRecord(rec);
  }

  // ── procedure_maps 시드 30건 ──
  const procCol = dao.findCollectionByNameOrId("procedure_maps");
  {
    const rec = new Record(procCol);
    rec.set("goal", "유아학비 (누리과정) 지원 (000000465790)");
    rec.set("domain", "보육·교육");
    rec.set("status", "pending_review");
    rec.set("steps", "[{\"seq\": 1, \"atom_id\": \"welfare-apply-visit\", \"org_id\": \"gov24-org:1342000\", \"expert_advisor\": null, \"condition\": null, \"parallel_group\": null}]");
    rec.set("eligibility_gate", "[{\"item\": \"연령 3~5세\", \"source\": \"target/eligibility 필드 정규식 추출 — 원문 재확인 필요\", \"confidence\": \"low\"}]");
    rec.set("free_alternative", "null");
    rec.set("as_of_date", "2026-07-16");
    rec.set("orchestrator", "AC");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(procCol);
    rec.set("goal", "원산지검증 대응 지원 (122000000003)");
    rec.set("domain", "보육·교육");
    rec.set("status", "pending_review");
    rec.set("steps", "[{\"seq\": 1, \"atom_id\": \"welfare-apply-online\", \"org_id\": \"gov24-org:1220000\", \"expert_advisor\": null, \"condition\": null, \"parallel_group\": null}]");
    rec.set("eligibility_gate", "[{\"item\": \"자동 추출 실패 — 원문 직접 검토 필요\", \"source\": \"target/eligibility raw text\", \"confidence\": \"none\"}]");
    rec.set("free_alternative", "null");
    rec.set("as_of_date", "2026-07-16");
    rec.set("orchestrator", "AC");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(procCol);
    rec.set("goal", "소년원 출원생 등 소외계층 청소년을 위한 청소년자립생활관 운영 지원 (127000000037)");
    rec.set("domain", "보육·교육");
    rec.set("status", "pending_review");
    rec.set("steps", "[{\"seq\": 1, \"atom_id\": \"welfare-apply-visit\", \"org_id\": \"gov24-org:1270000\", \"expert_advisor\": null, \"condition\": null, \"parallel_group\": null}]");
    rec.set("eligibility_gate", "[{\"item\": \"자동 추출 실패 — 원문 직접 검토 필요\", \"source\": \"target/eligibility raw text\", \"confidence\": \"none\"}]");
    rec.set("free_alternative", "null");
    rec.set("as_of_date", "2026-07-16");
    rec.set("orchestrator", "AC");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(procCol);
    rec.set("goal", "근로·자녀장려금 (105100000001)");
    rec.set("domain", "주거·자립");
    rec.set("status", "pending_review");
    rec.set("steps", "[{\"seq\": 1, \"atom_id\": \"welfare-apply-online\", \"org_id\": \"gov24-org:1210000\", \"expert_advisor\": null, \"condition\": null, \"parallel_group\": null}]");
    rec.set("eligibility_gate", "[{\"item\": \"자동 추출 실패 — 원문 직접 검토 필요\", \"source\": \"target/eligibility raw text\", \"confidence\": \"none\"}]");
    rec.set("free_alternative", "null");
    rec.set("as_of_date", "2026-07-16");
    rec.set("orchestrator", "AC");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(procCol);
    rec.set("goal", "주택금융공사 월세자금보증 (116010000001)");
    rec.set("domain", "주거·자립");
    rec.set("status", "pending_review");
    rec.set("steps", "[{\"seq\": 1, \"atom_id\": \"welfare-apply-visit\", \"org_id\": \"gov24-org:B551408\", \"expert_advisor\": null, \"condition\": null, \"parallel_group\": null}]");
    rec.set("eligibility_gate", "[{\"item\": \"자동 추출 실패 — 원문 직접 검토 필요\", \"source\": \"target/eligibility raw text\", \"confidence\": \"none\"}]");
    rec.set("free_alternative", "null");
    rec.set("as_of_date", "2026-07-16");
    rec.set("orchestrator", "AC");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(procCol);
    rec.set("goal", "북한이탈주민 자산형성 지원 (미래행복통장) (125000000004)");
    rec.set("domain", "주거·자립");
    rec.set("status", "pending_review");
    rec.set("steps", "[{\"seq\": 1, \"atom_id\": \"welfare-apply-visit\", \"org_id\": \"gov24-org:1250000\", \"expert_advisor\": null, \"condition\": null, \"parallel_group\": null}]");
    rec.set("eligibility_gate", "[{\"item\": \"자동 추출 실패 — 원문 직접 검토 필요\", \"source\": \"target/eligibility raw text\", \"confidence\": \"none\"}]");
    rec.set("free_alternative", "null");
    rec.set("as_of_date", "2026-07-16");
    rec.set("orchestrator", "AC");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(procCol);
    rec.set("goal", "친환경 에너지절감장비 보급 (119200000001)");
    rec.set("domain", "농림축산어업");
    rec.set("status", "pending_review");
    rec.set("steps", "[{\"seq\": 1, \"atom_id\": \"welfare-apply-visit\", \"org_id\": \"gov24-org:1192000\", \"expert_advisor\": null, \"condition\": null, \"parallel_group\": null}]");
    rec.set("eligibility_gate", "[{\"item\": \"자동 추출 실패 — 원문 직접 검토 필요\", \"source\": \"target/eligibility raw text\", \"confidence\": \"none\"}]");
    rec.set("free_alternative", "null");
    rec.set("as_of_date", "2026-07-16");
    rec.set("orchestrator", "AC");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(procCol);
    rec.set("goal", "옵서버 승선경비 지원 (119200000008)");
    rec.set("domain", "농림축산어업");
    rec.set("status", "pending_review");
    rec.set("steps", "[{\"seq\": 1, \"atom_id\": \"welfare-apply-visit\", \"org_id\": \"gov24-org:1192000\", \"expert_advisor\": null, \"condition\": null, \"parallel_group\": null}]");
    rec.set("eligibility_gate", "[{\"item\": \"자동 추출 실패 — 원문 직접 검토 필요\", \"source\": \"target/eligibility raw text\", \"confidence\": \"none\"}]");
    rec.set("free_alternative", "null");
    rec.set("as_of_date", "2026-07-16");
    rec.set("orchestrator", "AC");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(procCol);
    rec.set("goal", "합작수산물 관세 감면 추진 (119200000010)");
    rec.set("domain", "농림축산어업");
    rec.set("status", "pending_review");
    rec.set("steps", "[{\"seq\": 1, \"atom_id\": \"welfare-apply-online\", \"org_id\": \"gov24-org:1192000\", \"expert_advisor\": null, \"condition\": null, \"parallel_group\": null}]");
    rec.set("eligibility_gate", "[{\"item\": \"자동 추출 실패 — 원문 직접 검토 필요\", \"source\": \"target/eligibility raw text\", \"confidence\": \"none\"}]");
    rec.set("free_alternative", "null");
    rec.set("as_of_date", "2026-07-16");
    rec.set("orchestrator", "AC");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(procCol);
    rec.set("goal", "해양사고 국선 심판변론인 선정 지원 (119200000007)");
    rec.set("domain", "행정·안전");
    rec.set("status", "pending_review");
    rec.set("steps", "[{\"seq\": 1, \"atom_id\": \"welfare-apply-visit\", \"org_id\": \"gov24-org:1192000\", \"expert_advisor\": null, \"condition\": null, \"parallel_group\": null}]");
    rec.set("eligibility_gate", "[{\"item\": \"자동 추출 실패 — 원문 직접 검토 필요\", \"source\": \"target/eligibility raw text\", \"confidence\": \"none\"}]");
    rec.set("free_alternative", "null");
    rec.set("as_of_date", "2026-07-16");
    rec.set("orchestrator", "AC");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(procCol);
    rec.set("goal", "연안선박 현대화 지원 (119200000055)");
    rec.set("domain", "행정·안전");
    rec.set("status", "pending_review");
    rec.set("steps", "[{\"seq\": 1, \"atom_id\": \"welfare-apply-visit\", \"org_id\": \"gov24-org:1192000\", \"expert_advisor\": null, \"condition\": null, \"parallel_group\": null}]");
    rec.set("eligibility_gate", "[{\"item\": \"자동 추출 실패 — 원문 직접 검토 필요\", \"source\": \"target/eligibility raw text\", \"confidence\": \"none\"}]");
    rec.set("free_alternative", "null");
    rec.set("as_of_date", "2026-07-16");
    rec.set("orchestrator", "AC");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(procCol);
    rec.set("goal", "어업인안전조업교육지원 (119200000067)");
    rec.set("domain", "행정·안전");
    rec.set("status", "pending_review");
    rec.set("steps", "[{\"seq\": 1, \"atom_id\": \"welfare-apply-visit\", \"org_id\": \"gov24-org:1192000\", \"expert_advisor\": null, \"condition\": null, \"parallel_group\": null}]");
    rec.set("eligibility_gate", "[{\"item\": \"자동 추출 실패 — 원문 직접 검토 필요\", \"source\": \"target/eligibility raw text\", \"confidence\": \"none\"}]");
    rec.set("free_alternative", "null");
    rec.set("as_of_date", "2026-07-16");
    rec.set("orchestrator", "AC");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(procCol);
    rec.set("goal", "패각 친환경 처리 지원 (119200000110)");
    rec.set("domain", "문화·환경");
    rec.set("status", "pending_review");
    rec.set("steps", "[{\"seq\": 1, \"atom_id\": \"welfare-apply-visit\", \"org_id\": \"gov24-org:1192000\", \"expert_advisor\": null, \"condition\": null, \"parallel_group\": null}]");
    rec.set("eligibility_gate", "[{\"item\": \"자동 추출 실패 — 원문 직접 검토 필요\", \"source\": \"target/eligibility raw text\", \"confidence\": \"none\"}]");
    rec.set("free_alternative", "null");
    rec.set("as_of_date", "2026-07-16");
    rec.set("orchestrator", "AC");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(procCol);
    rec.set("goal", "해양문화행사 및 해양영토 대장정 (119200000176)");
    rec.set("domain", "문화·환경");
    rec.set("status", "pending_review");
    rec.set("steps", "[{\"seq\": 1, \"atom_id\": \"welfare-apply-online\", \"org_id\": \"gov24-org:1192000\", \"expert_advisor\": null, \"condition\": null, \"parallel_group\": null}]");
    rec.set("eligibility_gate", "[{\"item\": \"자동 추출 실패 — 원문 직접 검토 필요\", \"source\": \"target/eligibility raw text\", \"confidence\": \"none\"}]");
    rec.set("free_alternative", "null");
    rec.set("as_of_date", "2026-07-16");
    rec.set("orchestrator", "AC");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(procCol);
    rec.set("goal", "관광진흥개발기금 융자지원 (137100000004)");
    rec.set("domain", "문화·환경");
    rec.set("status", "pending_review");
    rec.set("steps", "[{\"seq\": 1, \"atom_id\": \"welfare-apply-visit\", \"org_id\": \"gov24-org:1371000\", \"expert_advisor\": null, \"condition\": null, \"parallel_group\": null}]");
    rec.set("eligibility_gate", "[{\"item\": \"자동 추출 실패 — 원문 직접 검토 필요\", \"source\": \"target/eligibility raw text\", \"confidence\": \"none\"}]");
    rec.set("free_alternative", "null");
    rec.set("as_of_date", "2026-07-16");
    rec.set("orchestrator", "AC");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(procCol);
    rec.set("goal", "수산동물질병 예방백신 공급 지원 (119200000111)");
    rec.set("domain", "보건·의료");
    rec.set("status", "pending_review");
    rec.set("steps", "[{\"seq\": 1, \"atom_id\": \"welfare-apply-visit\", \"org_id\": \"gov24-org:1192000\", \"expert_advisor\": null, \"condition\": null, \"parallel_group\": null}]");
    rec.set("eligibility_gate", "[{\"item\": \"자동 추출 실패 — 원문 직접 검토 필요\", \"source\": \"target/eligibility raw text\", \"confidence\": \"none\"}]");
    rec.set("free_alternative", "null");
    rec.set("as_of_date", "2026-07-16");
    rec.set("orchestrator", "AC");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(procCol);
    rec.set("goal", "의료급여 틀니·치과임플란트 지원 (135200000002)");
    rec.set("domain", "보건·의료");
    rec.set("status", "pending_review");
    rec.set("steps", "[{\"seq\": 1, \"atom_id\": \"welfare-apply-visit\", \"org_id\": \"gov24-org:1352000\", \"expert_advisor\": null, \"condition\": null, \"parallel_group\": null}]");
    rec.set("eligibility_gate", "[{\"item\": \"자동 추출 실패 — 원문 직접 검토 필요\", \"source\": \"target/eligibility raw text\", \"confidence\": \"none\"}]");
    rec.set("free_alternative", "null");
    rec.set("as_of_date", "2026-07-16");
    rec.set("orchestrator", "AC");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(procCol);
    rec.set("goal", "임산부 및 영유아 영양플러스 (135200000005)");
    rec.set("domain", "보건·의료");
    rec.set("status", "pending_review");
    rec.set("steps", "[{\"seq\": 1, \"atom_id\": \"welfare-apply-visit\", \"org_id\": \"gov24-org:1352000\", \"expert_advisor\": null, \"condition\": null, \"parallel_group\": null}]");
    rec.set("eligibility_gate", "[{\"item\": \"자동 추출 실패 — 원문 직접 검토 필요\", \"source\": \"target/eligibility raw text\", \"confidence\": \"none\"}]");
    rec.set("free_alternative", "null");
    rec.set("as_of_date", "2026-07-16");
    rec.set("orchestrator", "AC");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(procCol);
    rec.set("goal", "선원복지고용센터 운영 (119200000162)");
    rec.set("domain", "고용·창업");
    rec.set("status", "pending_review");
    rec.set("steps", "[{\"seq\": 1, \"atom_id\": \"welfare-apply-online\", \"org_id\": \"gov24-org:1192000\", \"expert_advisor\": null, \"condition\": null, \"parallel_group\": null}]");
    rec.set("eligibility_gate", "[{\"item\": \"자동 추출 실패 — 원문 직접 검토 필요\", \"source\": \"target/eligibility raw text\", \"confidence\": \"none\"}]");
    rec.set("free_alternative", "null");
    rec.set("as_of_date", "2026-07-16");
    rec.set("orchestrator", "AC");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(procCol);
    rec.set("goal", "전역예정군인 재취업 지원 (129000000013)");
    rec.set("domain", "고용·창업");
    rec.set("status", "pending_review");
    rec.set("steps", "[{\"seq\": 1, \"atom_id\": \"welfare-apply-online\", \"org_id\": \"gov24-org:1290000\", \"expert_advisor\": null, \"condition\": null, \"parallel_group\": null}]");
    rec.set("eligibility_gate", "[{\"item\": \"자동 추출 실패 — 원문 직접 검토 필요\", \"source\": \"target/eligibility raw text\", \"confidence\": \"none\"}]");
    rec.set("free_alternative", "null");
    rec.set("as_of_date", "2026-07-16");
    rec.set("orchestrator", "AC");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(procCol);
    rec.set("goal", "전역예정장병 취업활동지원 (129000000015)");
    rec.set("domain", "고용·창업");
    rec.set("status", "pending_review");
    rec.set("steps", "[{\"seq\": 1, \"atom_id\": \"welfare-apply-online\", \"org_id\": \"gov24-org:1290000\", \"expert_advisor\": null, \"condition\": null, \"parallel_group\": null}]");
    rec.set("eligibility_gate", "[{\"item\": \"자동 추출 실패 — 원문 직접 검토 필요\", \"source\": \"target/eligibility raw text\", \"confidence\": \"none\"}]");
    rec.set("free_alternative", "null");
    rec.set("as_of_date", "2026-07-16");
    rec.set("orchestrator", "AC");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(procCol);
    rec.set("goal", "특별공로자 및 우수인재 특별귀화 허가 신청 수수료 면제 안내 (127000000022)");
    rec.set("domain", "생활안정");
    rec.set("status", "pending_review");
    rec.set("steps", "[{\"seq\": 1, \"atom_id\": \"welfare-apply-visit\", \"org_id\": \"gov24-org:1270000\", \"expert_advisor\": null, \"condition\": null, \"parallel_group\": null}]");
    rec.set("eligibility_gate", "[{\"item\": \"자동 추출 실패 — 원문 직접 검토 필요\", \"source\": \"target/eligibility raw text\", \"confidence\": \"none\"}]");
    rec.set("free_alternative", "null");
    rec.set("as_of_date", "2026-07-16");
    rec.set("orchestrator", "AC");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(procCol);
    rec.set("goal", "귀화허가, 국적회복허가 신청 및 국적업무 증명서 발급 수수료 면제 안내 (127000000023)");
    rec.set("domain", "생활안정");
    rec.set("status", "pending_review");
    rec.set("steps", "[{\"seq\": 1, \"atom_id\": \"welfare-apply-visit\", \"org_id\": \"gov24-org:1270000\", \"expert_advisor\": null, \"condition\": null, \"parallel_group\": null}]");
    rec.set("eligibility_gate", "[{\"item\": \"자동 추출 실패 — 원문 직접 검토 필요\", \"source\": \"target/eligibility raw text\", \"confidence\": \"none\"}]");
    rec.set("free_alternative", "null");
    rec.set("as_of_date", "2026-07-16");
    rec.set("orchestrator", "AC");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(procCol);
    rec.set("goal", "군인 재해보상 유족급여 지급 (129000000007)");
    rec.set("domain", "생활안정");
    rec.set("status", "pending_review");
    rec.set("steps", "[{\"seq\": 1, \"atom_id\": \"welfare-apply-visit\", \"org_id\": \"gov24-org:1290000\", \"expert_advisor\": null, \"condition\": null, \"parallel_group\": null}]");
    rec.set("eligibility_gate", "[{\"item\": \"자동 추출 실패 — 원문 직접 검토 필요\", \"source\": \"target/eligibility raw text\", \"confidence\": \"none\"}]");
    rec.set("free_alternative", "null");
    rec.set("as_of_date", "2026-07-16");
    rec.set("orchestrator", "AC");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(procCol);
    rec.set("goal", "학대피해아동쉼터 지원 (135200000012)");
    rec.set("domain", "보호·돌봄");
    rec.set("status", "pending_review");
    rec.set("steps", "[{\"seq\": 1, \"atom_id\": \"welfare-apply-visit\", \"org_id\": \"gov24-org:1352000\", \"expert_advisor\": null, \"condition\": null, \"parallel_group\": null}]");
    rec.set("eligibility_gate", "[{\"item\": \"자동 추출 실패 — 원문 직접 검토 필요\", \"source\": \"target/eligibility raw text\", \"confidence\": \"none\"}]");
    rec.set("free_alternative", "null");
    rec.set("as_of_date", "2026-07-16");
    rec.set("orchestrator", "AC");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(procCol);
    rec.set("goal", "발달장애인 개인별지원계획 수립 지원 (135200000095)");
    rec.set("domain", "보호·돌봄");
    rec.set("status", "pending_review");
    rec.set("steps", "[{\"seq\": 1, \"atom_id\": \"welfare-apply-visit\", \"org_id\": \"gov24-org:1352000\", \"expert_advisor\": null, \"condition\": null, \"parallel_group\": null}]");
    rec.set("eligibility_gate", "[{\"item\": \"자동 추출 실패 — 원문 직접 검토 필요\", \"source\": \"target/eligibility raw text\", \"confidence\": \"none\"}]");
    rec.set("free_alternative", "null");
    rec.set("as_of_date", "2026-07-16");
    rec.set("orchestrator", "AC");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(procCol);
    rec.set("goal", "발달장애인 주간활동서비스 (135200000130)");
    rec.set("domain", "보호·돌봄");
    rec.set("status", "pending_review");
    rec.set("steps", "[{\"seq\": 1, \"atom_id\": \"welfare-apply-visit\", \"org_id\": \"gov24-org:1352000\", \"expert_advisor\": null, \"condition\": null, \"parallel_group\": null}]");
    rec.set("eligibility_gate", "[{\"item\": \"자동 추출 실패 — 원문 직접 검토 필요\", \"source\": \"target/eligibility raw text\", \"confidence\": \"none\"}]");
    rec.set("free_alternative", "null");
    rec.set("as_of_date", "2026-07-16");
    rec.set("orchestrator", "AC");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(procCol);
    rec.set("goal", "고위험 임산부 의료비 지원 (135200000114)");
    rec.set("domain", "임신·출산");
    rec.set("status", "pending_review");
    rec.set("steps", "[{\"seq\": 1, \"atom_id\": \"welfare-apply-visit\", \"org_id\": \"gov24-org:1352000\", \"expert_advisor\": null, \"condition\": null, \"parallel_group\": null}]");
    rec.set("eligibility_gate", "[{\"item\": \"자동 추출 실패 — 원문 직접 검토 필요\", \"source\": \"target/eligibility raw text\", \"confidence\": \"none\"}]");
    rec.set("free_alternative", "null");
    rec.set("as_of_date", "2026-07-16");
    rec.set("orchestrator", "AC");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(procCol);
    rec.set("goal", "입양축하금 (135200005011)");
    rec.set("domain", "임신·출산");
    rec.set("status", "pending_review");
    rec.set("steps", "[{\"seq\": 1, \"atom_id\": \"welfare-apply-visit\", \"org_id\": \"gov24-org:1352000\", \"expert_advisor\": null, \"condition\": null, \"parallel_group\": null}]");
    rec.set("eligibility_gate", "[{\"item\": \"자동 추출 실패 — 원문 직접 검토 필요\", \"source\": \"target/eligibility raw text\", \"confidence\": \"none\"}]");
    rec.set("free_alternative", "null");
    rec.set("as_of_date", "2026-07-16");
    rec.set("orchestrator", "AC");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(procCol);
    rec.set("goal", "첫만남이용권 지원 (135200005015)");
    rec.set("domain", "임신·출산");
    rec.set("status", "pending_review");
    rec.set("steps", "[{\"seq\": 1, \"atom_id\": \"welfare-apply-visit\", \"org_id\": \"gov24-org:1352000\", \"expert_advisor\": null, \"condition\": null, \"parallel_group\": null}]");
    rec.set("eligibility_gate", "[{\"item\": \"자동 추출 실패 — 원문 직접 검토 필요\", \"source\": \"target/eligibility raw text\", \"confidence\": \"none\"}]");
    rec.set("free_alternative", "null");
    rec.set("as_of_date", "2026-07-16");
    rec.set("orchestrator", "AC");
    dao.saveRecord(rec);
  }
}, (db) => {
  const dao = new Dao(db);

  // procedure_maps 시드 삭제
  const procGoals = ["유아학비 (누리과정) 지원 (000000465790)", "원산지검증 대응 지원 (122000000003)", "소년원 출원생 등 소외계층 청소년을 위한 청소년자립생활관 운영 지원 (127000000037)", "근로·자녀장려금 (105100000001)", "주택금융공사 월세자금보증 (116010000001)", "북한이탈주민 자산형성 지원 (미래행복통장) (125000000004)", "친환경 에너지절감장비 보급 (119200000001)", "옵서버 승선경비 지원 (119200000008)", "합작수산물 관세 감면 추진 (119200000010)", "해양사고 국선 심판변론인 선정 지원 (119200000007)", "연안선박 현대화 지원 (119200000055)", "어업인안전조업교육지원 (119200000067)", "패각 친환경 처리 지원 (119200000110)", "해양문화행사 및 해양영토 대장정 (119200000176)", "관광진흥개발기금 융자지원 (137100000004)", "수산동물질병 예방백신 공급 지원 (119200000111)", "의료급여 틀니·치과임플란트 지원 (135200000002)", "임산부 및 영유아 영양플러스 (135200000005)", "선원복지고용센터 운영 (119200000162)", "전역예정군인 재취업 지원 (129000000013)", "전역예정장병 취업활동지원 (129000000015)", "특별공로자 및 우수인재 특별귀화 허가 신청 수수료 면제 안내 (127000000022)", "귀화허가, 국적회복허가 신청 및 국적업무 증명서 발급 수수료 면제 안내 (127000000023)", "군인 재해보상 유족급여 지급 (129000000007)", "학대피해아동쉼터 지원 (135200000012)", "발달장애인 개인별지원계획 수립 지원 (135200000095)", "발달장애인 주간활동서비스 (135200000130)", "고위험 임산부 의료비 지원 (135200000114)", "입양축하금 (135200005011)", "첫만남이용권 지원 (135200005015)"];
  procGoals.forEach((g) => {
    try {
      const r = dao.findFirstRecordByData("procedure_maps", "goal", g);
      dao.deleteRecord(r);
    } catch (e) { /* 이미 없으면 무시 */ }
  });
  // atom_rows 시드 삭제
  const atomIds = ["welfare-apply-online", "welfare-apply-visit"];
  atomIds.forEach((id) => {
    try {
      const r = dao.findFirstRecordByData("atom_rows", "atom_id", id);
      dao.deleteRecord(r);
    } catch (e) { /* 이미 없으면 무시 */ }
  });
  // org_profiles 시드 삭제
  const orgIds = ["gov24-org:1342000", "gov24-org:1220000", "gov24-org:1270000", "gov24-org:1210000", "gov24-org:B551408", "gov24-org:1250000", "gov24-org:1192000", "gov24-org:1371000", "gov24-org:1352000", "gov24-org:1290000"];
  orgIds.forEach((id) => {
    try {
      const r = dao.findFirstRecordByData("org_profiles", "org_id", id);
      dao.deleteRecord(r);
    } catch (e) { /* 이미 없으면 무시 */ }
  });
})
