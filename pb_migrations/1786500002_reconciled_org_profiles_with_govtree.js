/// <reference path="../pb_data/types.d.ts" />
// org_profiles ↔ gov-tree 신원 조정 1차분 (2026-08-05)
//
// 배경: docs 대화 세션에서 발견 — org_profiles의 admin_local 376건 중
// 246건(중복 제거 후)이 gov-tree(city-master-data.json/province-master-
// data.json)와 이름으로 매칭됐고, 그중 gov-tree 쪽에 "정식 확인 중" 같은
// 스텁이 아니라 실제 콘텐츠가 있는 게 28건(시·군·구 15건 + 도청 13건)이었다.
// 이 28건만 이번에 connected:true·resolution_strategy:gov_tree_delegate로
// 정정한다 — 나머지(gov-tree도 스텁인 184건, 아예 매칭 안 되는 34건)는
// 지금 그대로 두는 게 정직하다(실제로 연결 안 된 게 맞으므로).
//
// 매칭 방법: org_name(예: "부산광역시 해운대구")을 gov-tree의
// (도이름+시이름) 또는 (도이름 단독)과 공백 제거 후 완전일치로 대조.
// gov-tree 쪽 완결 여부는 city-master-data.json의 행정구역구성_문구에
// "정식 확인 중" 문자열이 있는지로 판별했다(있으면 스텁, 없으면 실사 완료).
//
// unavailable_reason이 "혜택 카탈로그 전수 적재 — 검토 전"이라는 오래된
// 문구를 그대로 달고 있었는데, 이제 사실이 아니므로 함께 지운다.
migrate((db) => {
  const dao = new Dao(db);
  const orgCol = dao.findCollectionByNameOrId("org_profiles");

  const entries = [
    { org_id: "gov24-org:3370000", gov_tree_ref: "city:SP-CITY-BUSAN_YEONJE" },
    { org_id: "gov24-org:3260000", gov_tree_ref: "city:SP-CITY-BUSAN_SEO" },
    { org_id: "gov24-org:3270000", gov_tree_ref: "city:SP-CITY-BUSAN_DONG" },
    { org_id: "gov24-org:3300000", gov_tree_ref: "city:SP-CITY-BUSAN_DONGNAE" },
    { org_id: "gov24-org:3340000", gov_tree_ref: "city:SP-CITY-BUSAN_SAHA" },
    { org_id: "gov24-org:3280000", gov_tree_ref: "city:SP-CITY-BUSAN_YEONGDO" },
    { org_id: "gov24-org:3390000", gov_tree_ref: "city:SP-CITY-BUSAN_SASANG" },
    { org_id: "gov24-org:3350000", gov_tree_ref: "city:SP-CITY-BUSAN_GEUMJEONG" },
    { org_id: "gov24-org:3330000", gov_tree_ref: "city:SP-CITY-BUSAN_HAEUNDAE" },
    { org_id: "gov24-org:3380000", gov_tree_ref: "city:SP-CITY-BUSAN_SUYEONG" },
    { org_id: "gov24-org:3310000", gov_tree_ref: "city:SP-CITY-BUSAN_NAM" },
    { org_id: "gov24-org:3290000", gov_tree_ref: "city:SP-CITY-BUSAN_BUSANJIN" },
    { org_id: "gov24-org:5670000", gov_tree_ref: "city:SP-CITY-CHANGWON" },
    { org_id: "gov24-org:3250000", gov_tree_ref: "city:SP-CITY-BUSAN_JUNG" },
    { org_id: "gov24-org:3320000", gov_tree_ref: "city:SP-CITY-BUSAN_BUK" },
    { org_id: "gov24-org:6130000", gov_tree_ref: "province:jeonnam-gwangju" },
    { org_id: "gov24-org:6440000", gov_tree_ref: "province:chungnam" },
    { org_id: "gov24-org:6410000", gov_tree_ref: "province:gyeonggi" },
    { org_id: "gov24-org:6280000", gov_tree_ref: "province:incheon" },
    { org_id: "gov24-org:6540000", gov_tree_ref: "province:jeonbuk" },
    { org_id: "gov24-org:6470000", gov_tree_ref: "province:gyeongbuk" },
    { org_id: "gov24-org:6260000", gov_tree_ref: "province:busan" },
    { org_id: "gov24-org:6300000", gov_tree_ref: "province:daejeon" },
    { org_id: "gov24-org:6310000", gov_tree_ref: "province:ulsan" },
    { org_id: "gov24-org:6430000", gov_tree_ref: "province:chungbuk" },
    { org_id: "gov24-org:6480000", gov_tree_ref: "province:gyeongnam" },
    { org_id: "gov24-org:5690000", gov_tree_ref: "province:sejong" },
    { org_id: "gov24-org:6110000", gov_tree_ref: "province:seoul" },
  ];

  const results = { updated: [], skipped_not_found: [] };
  entries.forEach(({ org_id, gov_tree_ref }) => {
    let rec;
    try {
      rec = dao.findFirstRecordByData("org_profiles", "org_id", org_id);
    } catch (e) {
      results.skipped_not_found.push(org_id);
      return;
    }
    rec.set("connected", true);
    rec.set("resolution_strategy", "gov_tree_delegate");
    rec.set("gov_tree_ref", gov_tree_ref);
    rec.set("unavailable_reason", "");
    rec.set("as_of_date", "2026-08-05");
    dao.saveRecord(rec);
    results.updated.push(org_id);
  });

  console.log(`org_profiles gov-tree 조정: ${results.updated.length}건 갱신, ${results.skipped_not_found.length}건 org_id 못 찾음`);
  if (results.skipped_not_found.length) {
    console.log("못 찾은 org_id:", results.skipped_not_found.join(", "));
  }
}, (db) => {
  const dao = new Dao(db);
  const orgIds = [
    "gov24-org:3370000", "gov24-org:3260000", "gov24-org:3270000", "gov24-org:3300000",
    "gov24-org:3340000", "gov24-org:3280000", "gov24-org:3390000", "gov24-org:3350000",
    "gov24-org:3330000", "gov24-org:3380000", "gov24-org:3310000", "gov24-org:3290000",
    "gov24-org:5670000", "gov24-org:3250000", "gov24-org:3320000",
    "gov24-org:6130000", "gov24-org:6440000", "gov24-org:6410000", "gov24-org:6280000",
    "gov24-org:6540000", "gov24-org:6470000", "gov24-org:6260000", "gov24-org:6300000",
    "gov24-org:6310000", "gov24-org:6430000", "gov24-org:6480000", "gov24-org:5690000",
    "gov24-org:6110000",
  ];
  orgIds.forEach((org_id) => {
    try {
      const rec = dao.findFirstRecordByData("org_profiles", "org_id", org_id);
      rec.set("connected", false);
      rec.set("resolution_strategy", "complete_lookup_table");
      rec.set("gov_tree_ref", "");
      rec.set("unavailable_reason", "혜택 카탈로그 전수 적재 — 검토 전");
      dao.saveRecord(rec);
    } catch (e) { /* 없으면 무시 */ }
  });
})
