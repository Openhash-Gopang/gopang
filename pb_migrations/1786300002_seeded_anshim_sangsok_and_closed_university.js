/// <reference path="../pb_data/types.d.ts" />
// 배치2·4 사고실험에서 발견: "안심상속"이 원본 데이터에 3가지 다른 표기로
// 흩어져 있었다(제목·소관기관 전부 다름 — R6은 제목 정확 일치만 봐서 못 잡음):
//   - "안심 상속 원스톱 서비스 지원(사망자 재산조회 서비스)" / 충청북도 보은군
//   - "사망자 및 피후견인 등 재산조회 통합처리 신청(안심상속)" / 행정안전부
//   - "안심상속 원스톱서비스 제공" / 경기도 화성시
// 실제로는 하나의 전국 서비스(행정안전부 정책 소관, 시군구가 접수처)이고,
// 금융·토지·자동차·세금·연금 등 여러 도메인을 한 번에 조회하는 절차라
// AGENT-COMMON §0-H 오케스트레이션 기준(2개 이상 기관·절차 조합)에 해당한다
// — REQUIRED_DOCUMENTS_REGISTRY(단일기관용)가 아니라 procedure_maps로 병합.
// steps는 아직 설계 전이라 draft로만 등록 — 다음 세션에서 K-Compose 관점으로 구체화 필요.
migrate((db) => {
  const dao = new Dao(db);

  const procCol = dao.findCollectionByNameOrId("procedure_maps");
  {
    const rec = new Record(procCol);
    rec.set("goal", "사망자_재산_통합조회_안심상속");
    rec.set("domain", "가족관계");
    rec.set("status", "draft");
    rec.set("steps", JSON.stringify([]));
    rec.set("eligibility_gate", JSON.stringify({
      note: "상속인 또는 후견인만 신청 가능 — 구체 자격요건은 다음 세션에서 확정",
    }));
    rec.set("free_alternative", JSON.stringify({
      note: "정부24 또는 관할 읍면동 방문으로 동일하게 신청 가능(무료) — 대행 수수료 없음",
    }));
    rec.set("as_of_date", "2026-07-16");
    rec.set("orchestrator", "K-Compose");
    dao.saveRecord(rec);
  }

  // ── 폐교대학 예외 (org_profiles) ──────────────────────────────────
  // 배치4 #45 "폐교대학 졸업증명서 발급" — university-generic(1786200001)의
  // "각 대학 홈페이지에서 발급" 전제가 성립하지 않는 예외(학교 자체가 없어짐).
  // 한국사학진흥재단이 대신 발급하므로 별도 org_id로 분리.
  const orgCol = dao.findCollectionByNameOrId("org_profiles");
  {
    const rec = new Record(orgCol);
    rec.set("org_id", "kasfo-closed-university");
    rec.set("org_name", "한국사학진흥재단(폐교대학 학적 관리)");
    rec.set("branch", "public_institution");
    rec.set("jurisdiction", "전국(폐교대학 재학·졸업 이력 보유자)");
    rec.set("as_of_date", "2026-07-16");
    rec.set("guid_model", "government_agency");
    rec.set("resolution_strategy", "single_national_instance");
    rec.set("input", JSON.stringify({
      required_docs: ["본인 인증 정보", "재학 당시 학교명·학번(확인 가능한 경우)"],
      identity_verification: "공동인증서/간편인증",
    }));
    rec.set("output", JSON.stringify({
      produces: ["폐교대학 졸업증명서", "폐교대학 관련 제증명"],
      format: "PDF/출력",
    }));
    rec.set("automation", JSON.stringify({
      level: "manual_only",
      automation_sp: null,
      source_type: "manual_entry",
      source_ref: "university-generic(1786200001)과 달리 대학 홈페이지가 아닌 한국사학진흥재단이 대신 발급 — 학교 폐교로 자체 발급 시스템 부재",
    }));
    rec.set("connected", false);
    rec.set("unavailable_reason", "한국사학진흥재단 API 연동 미착수");
    rec.set("status", "pending_review");
    dao.saveRecord(rec);
  }

  return null;
}, (db) => {
  const dao = new Dao(db);
  try {
    const rec = dao.findFirstRecordByData("procedure_maps", "goal", "사망자_재산_통합조회_안심상속");
    dao.deleteRecord(rec);
  } catch (e) {}
  try {
    const rec = dao.findFirstRecordByData("org_profiles", "org_id", "kasfo-closed-university");
    dao.deleteRecord(rec);
  } catch (e) {}
})
