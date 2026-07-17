/// <reference path="../pb_data/types.d.ts" />
// 드리프트 해소: d9d566b(feat: qna/users GWP_REGISTRY 등록)에서 kqna/kusers를
// gwp-registry.js(정적 core 파일)에만 추가하고 gwp_registry 테이블(1783500009
// 시딩분)은 갱신하지 않아 두 계층 사이에 드리프트가 발생했다. GWP-REGISTRY-SCALING_v1_0.md
// §2 설계 의도대로 core 21개는 이 테이블에도 동일하게 존재해야 하므로, 누락된 2건을
// 추가 시딩한다. gwp-registry.js 원본 항목의 triggers 배열을 keywords(공백 구분)로 이관.
migrate((db) => {
  const dao = new Dao(db);
  const col = dao.findCollectionByNameOrId("gwp_registry");

  {
    const rec = new Record(col);
    rec.set("gwp_id", "kqna");
    rec.set("name", "Gopang QnA");
    rec.set("tier", "core");
    rec.set("category", "GOV");
    rec.set("keywords", "질문있어 문의 궁금해 뭐예요 어떻게 해요 절차가 신청 방법 자격 요건 필요한 서류");
    rec.set("jurisdiction", "national");
    rec.set("file_ref", "kqna");
    rec.set("status", "active");
    dao.saveRecord(rec);
  }
  {
    const rec = new Record(col);
    rec.set("gwp_id", "kusers");
    rec.set("name", "Gopang Users");
    rec.set("tier", "core");
    rec.set("category", "GOV");
    rec.set("keywords", "이 사람 찾아줘 프로필 찾아줘 연락처 찾아줘 누구세요 가입자 조회 엔티티 검색");
    rec.set("jurisdiction", "national");
    rec.set("file_ref", "kusers");
    rec.set("status", "active");
    dao.saveRecord(rec);
  }
}, (db) => {
  const dao = new Dao(db);
  const ids = ["kqna", "kusers"];
  for (const id of ids) {
    try {
      const rec = dao.findFirstRecordByFilter("gwp_registry", `gwp_id = "${id}"`);
      dao.deleteRecord(rec);
    } catch (e) {
      // 이미 없으면 무시 (down 마이그레이션 재실행 안전성)
    }
  }
})
