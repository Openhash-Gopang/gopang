/// <reference path="../pb_data/types.d.ts" />
// RESOLUTION_TIER_REGISTRY(worker.js, 2026-07-16 임시로 신설했다가 폐기) 이관.
// org_profiles/atom_rows가 이미 라이브(K-Compose SP-20 소비)인데 같은 개념
// (기관별 자동화 수준)을 담는 별도 하드코딩 레지스트리를 worker.js에 새로
// 만든 것을 발견해 정정 — 대학재학증명·사실증명13종 2건을 이 스키마로 이관.
migrate((db) => {
  const dao = new Dao(db);
  const orgCol = dao.findCollectionByNameOrId("org_profiles");

  {
    const rec = new Record(orgCol);
    rec.set("org_id", "university-generic");
    rec.set("org_name", "대학교(개별 학교 미특정 — 기본값)");
    rec.set("branch", "public_institution");
    rec.set("jurisdiction", "전국(대학마다 개별 발급 시스템 보유)");
    rec.set("as_of_date", "2026-07-16");
    rec.set("guid_model", "none");
    rec.set("resolution_strategy", "user_choice");
    rec.set("input", JSON.stringify({
      required_docs: [],
      identity_verification: "대학 자체 계정 또는 공동인증서(대학마다 상이)",
    }));
    rec.set("output", JSON.stringify({
      produces: ["재학증명서", "졸업증명서", "성적증명서 등 대학 자체 제증명"],
      format: "PDF/출력",
    }));
    rec.set("automation", JSON.stringify({
      level: "manual_only",
      automation_sp: null,
      source_type: "manual_entry",
      source_ref: "정부24 비대상 — 대학 자체 홈페이지 발급이 원칙(§공문서 발급 안내 예외)",
    }));
    rec.set("connected", false);
    rec.set("unavailable_reason", "대학별 AI비서 디렉토리 미구축 — 개별 대학이 확인되면 그 학교 전용 org_id로 별도 등록하고 automation.level을 격상 검토");
    rec.set("status", "pending_review");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(orgCol);
    rec.set("org_id", "nts-hometax");
    rec.set("org_name", "국세청 홈택스");
    rec.set("branch", "admin_central");
    rec.set("jurisdiction", "전국");
    rec.set("as_of_date", "2026-07-16");
    rec.set("guid_model", "government_agency");
    rec.set("resolution_strategy", "complete_lookup_table");
    rec.set("input", JSON.stringify({
      required_docs: ["본인 인증 정보"],
      identity_verification: "공동인증서/간편인증(홈택스 로그인)",
    }));
    rec.set("output", JSON.stringify({
      produces: ["사실증명(13종 전체)", "정부24/어디서나민원 대비 발급 범위가 더 넓음"],
      format: "PDF/출력",
    }));
    rec.set("automation", JSON.stringify({
      level: "manual_only",
      automation_sp: null,
      source_type: "manual_entry",
      source_ref: "국세청 홈택스 API 연동 미착수 — 연동되면 level을 full_api로 격상",
    }));
    rec.set("connected", false);
    rec.set("unavailable_reason", "국세청 홈택스 API 연동 미착수(worker.js 패치 필요)");
    rec.set("status", "pending_review");
    dao.saveRecord(rec);
  }

  return null;
}, (db) => {
  const dao = new Dao(db);
  const orgCol = dao.findCollectionByNameOrId("org_profiles");
  for (const orgId of ["university-generic", "nts-hometax"]) {
    try {
      const rec = dao.findFirstRecordByData("org_profiles", "org_id", orgId);
      dao.deleteRecord(rec);
    } catch (e) { /* 이미 없으면 무시 */ }
  }
})
