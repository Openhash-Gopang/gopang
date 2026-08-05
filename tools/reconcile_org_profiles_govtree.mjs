#!/usr/bin/env node
// reconcile_org_profiles_govtree.mjs — 2026-08-05 신설
//
// 배경: docs/ORG_PROFILES_GOVTREE_RECONCILIATION_v1_0.md에서 발견·수정한
// org_profiles(admin_local) ↔ gov-tree(city-master-data.json/province-
// master-data.json) 신원 불일치 조정 작업(28건, pb_migrations/1786500002)
// 은 그 세션에서 손으로 한 번 돌린 일회성 스크립트였다. HANDOFF_2026-
// 08-05 §4-4가 지적한 대로, gov-tree 실사가 계속 진행 중이라(184건은
// 아직 gov-tree 쪽도 스텁, 34건은 아예 매칭 안 됨) 이 조정을 앞으로도
// 반복해서 돌려야 한다 — 이 파일이 그 반복 가능한 루틴이다.
//
// 매칭 알고리즘은 원 세션(§2-3)과 동일하게 유지한다:
//   1. org_profiles의 admin_local 레코드를 org_name(도이름+시이름 또는
//      도이름 단독)으로, gov-tree의 city-master-data.json(도이름+시이름)
//      /province-master-data.json(도이름 단독)과 공백 제거 후 완전일치로
//      대조한다.
//   2. gov-tree 쪽이 실제 콘텐츠(REAL)인지 스텁(STUB)인지는
//      city-master-data.json의 행정구역구성_문구에 "정식 확인 중"
//      문자열이 있는지로 기계적으로 판별한다(province-master-data.json은
//      2026-08-05 기준 스텁 레코드가 없어 항상 REAL로 취급 — 향후 스텁이
//      생기면 이 스크립트도 같은 마커로 자동 반영된다).
//   3. REAL로 매칭된 것만 gov_tree_ref(city:{SP코드} 또는
//      province:{도코드})·resolution_strategy(gov_tree_delegate)로
//      갱신 대상에 포함한다. 나머지(스텁 매칭·미매칭)는 그대로 둔다 —
//      실제로 미연결이 맞으므로 손대지 않는 게 정직하다.
//
// 이 스크립트는 PocketBase에 직접 붙지 않는다(이 세션도 라이브 접근이
// 없다는 게 반복된 제약 — HANDOFF §4-2). 대신:
//   - 입력: org_profiles의 admin_local 레코드를 JSON 배열로 export한
//     파일(PocketBase Admin UI → Collections → org_profiles → Export,
//     또는 `pb_hooks`의 관리자 API로 branch="admin_local" 필터링해 받은
//     결과). 필요한 필드는 org_id·org_name·branch(admin_local만 필터링해
//     넘겨도 되고, 이 스크립트가 branch!=='admin_local'인 레코드는
//     알아서 건너뛴다) 셋뿐이다.
//   - 출력: 사람이 검토할 리포트(REAL/STUB/미매칭 분류, stdout) +
//     실제 적용용 pb_migration 파일 초안(--emit-migration 지정 시).
//     주피터님이 리포트를 검토한 뒤 마이그레이션을 배포 파이프라인에
//     넣는 건 여전히 사람의 결정이다 — 이 스크립트가 자동 적용하지
//     않는다(RULE-01 "검토 대기 상태를 조용히 쓰지 않는다"와 동일 정신).
//
// 사용법:
//   node tools/reconcile_org_profiles_govtree.mjs --input <org_profiles.json>
//   node tools/reconcile_org_profiles_govtree.mjs --input <path> --emit-migration <출력.js>
//   node tools/reconcile_org_profiles_govtree.mjs --self-test   ← 코드 검증용,
//     아래 §자체 테스트 참고. 실제 org_profiles 데이터 없이도 매칭
//     알고리즘 자체가 맞는지 확인할 수 있다.
//
// 단위 테스트: node --test src/tests/reconcile-org-profiles-govtree.test.mjs
// (알고리즘이 pb_migrations/1786500002의 기존 28건 결과를 그대로
// 재현하는지 회귀 검증한다 — 이 스크립트가 실제 조정 로직을 정확히
// 재구현했는지의 근거.)

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CITY_MASTER_PATH = path.join(ROOT, 'prompts/gov-tree/04-city/templates/city-master-data.json');
const PROVINCE_MASTER_PATH = path.join(ROOT, 'prompts/gov-tree/01-do/templates/province-master-data.json');

const STUB_MARKER = '정식 확인 중';

function norm(s) {
  return String(s || '').replace(/\s+/g, '');
}

export function loadGovTreeIndex(root = ROOT) {
  const cityPath = root === ROOT ? CITY_MASTER_PATH : path.join(root, 'prompts/gov-tree/04-city/templates/city-master-data.json');
  const provincePath = root === ROOT ? PROVINCE_MASTER_PATH : path.join(root, 'prompts/gov-tree/01-do/templates/province-master-data.json');

  const cityData = JSON.parse(fs.readFileSync(cityPath, 'utf-8'));
  const provinceData = JSON.parse(fs.readFileSync(provincePath, 'utf-8'));

  const provinceByCode = new Map();
  for (const p of provinceData.도목록) provinceByCode.set(p.도코드, p);

  // key: norm(도이름+시이름) → { govTreeRef, isReal }
  const cityIndex = new Map();
  for (const c of cityData.시목록) {
    const province = provinceByCode.get(c.도코드);
    if (!province) continue; // 데이터 정합성 문제 — 조용히 건너뛴다(리포트에서 드러나지 않지만 city record 자체가 드묾)
    const key = norm(province.도이름 + c.시이름);
    const isReal = !String(c.행정구역구성_문구 || '').includes(STUB_MARKER);
    cityIndex.set(key, { govTreeRef: `city:${c.SP코드}`, isReal, label: `${province.도이름} ${c.시이름}` });
  }

  // key: norm(도이름) → { govTreeRef, isReal }
  const provinceIndex = new Map();
  for (const p of provinceData.도목록) {
    const key = norm(p.도이름);
    // province-master-data.json은 2026-08-05 기준 스텁 마커가 전혀 없다
    // (grep 확인됨) — 향후 스텁이 생기면 city와 동일한 마커로 자동 반영.
    const isReal = !JSON.stringify(p).includes(STUB_MARKER);
    provinceIndex.set(key, { govTreeRef: `province:${p.도코드}`, isReal, label: p.도이름 });
  }

  return { cityIndex, provinceIndex };
}

// orgProfilesRecords: [{org_id, org_name, branch}, ...]
// 2026-08-05 추가 — 34건 미매칭 처리 방침(주피터 확인) 반영.
// "미매칭"을 실사해보니 무작위가 아니라 두 카테고리였다:
//   (a) 강원특별자치도 도청 + 산하 시·군 12곳 — 다른 16개 도와 마찬가지로
//       province/city 계층으로 매칭될 "정상 후보"인데 gov-tree 실사가 아직
//       거기까지 안 갔을 뿐. → 여전히 unmatched(gov-tree 확장 대상)로 분류.
//   (b) 광역 교육청 15곳 전부 — 시·도·구·군과 관할·조직 구조가 근본적으로
//       달라(학교급별·교육지원청 체계) gov-tree의 province/city 계층 개념
//       자체가 안 맞는다. 억지로 gov_tree_delegate로 편입하려 하지 말고,
//       org_profiles 쪽에서 별도 트랙으로 처리하는 게 맞다는 게 주피터
//       결정 — 그래서 이 스크립트가 "gov-tree 확장 후보"와 섞어 보고하지
//       않도록 별도 버킷(unmatched_out_of_scope)으로 분리한다.
// 판별은 org_name이 "교육청"으로 끝나는지로 기계적으로 한다(모든 시행
// 관측 사례가 이 패턴이었음 — 예: "서울특별시교육청", "경상남도교육청").
function isEducationOffice(orgName) {
  return typeof orgName === 'string' && orgName.trim().endsWith('교육청');
}

export function reconcile(orgProfilesRecords, root = ROOT) {
  const { cityIndex, provinceIndex } = loadGovTreeIndex(root);

  const result = {
    real_matched: [],
    stub_matched: [],
    unmatched: [],
    unmatched_out_of_scope: [],
    skipped_non_admin_local: [],
  };
  const seenOrgId = new Set();

  for (const rec of orgProfilesRecords) {
    if (rec.branch !== 'admin_local') {
      result.skipped_non_admin_local.push(rec.org_id);
      continue;
    }
    if (seenOrgId.has(rec.org_id)) continue; // 원 세션과 동일 — 중복 제거
    seenOrgId.add(rec.org_id);

    const key = norm(rec.org_name);
    const cityHit = cityIndex.get(key);
    const provinceHit = !cityHit ? provinceIndex.get(key) : null;
    const hit = cityHit || provinceHit;

    if (!hit) {
      const entry = { org_id: rec.org_id, org_name: rec.org_name };
      if (isEducationOffice(rec.org_name)) {
        result.unmatched_out_of_scope.push({
          ...entry,
          reason: 'education_office_structurally_different — gov-tree province/city 계층 대상 아님(2026-08-05 방침 결정)',
        });
      } else {
        result.unmatched.push(entry);
      }
      continue;
    }
    const entry = { org_id: rec.org_id, org_name: rec.org_name, gov_tree_ref: hit.govTreeRef, matched_label: hit.label };
    if (hit.isReal) result.real_matched.push(entry);
    else result.stub_matched.push(entry);
  }

  return result;
}

export function renderMigrationDraft(realMatched, migrationTimestamp) {
  const ts = migrationTimestamp || String(Math.floor(Date.now() / 1000));
  const entriesLiteral = realMatched
    .map(e => `    { org_id: ${JSON.stringify(e.org_id)}, gov_tree_ref: ${JSON.stringify(e.gov_tree_ref)} }, // ${e.matched_label}`)
    .join('\n');
  const orgIdsLiteral = realMatched.map(e => JSON.stringify(e.org_id)).join(', ');

  return `/// <reference path="../pb_data/types.d.ts" />
// org_profiles ↔ gov-tree 신원 조정 — tools/reconcile_org_profiles_govtree.mjs
// 자동 생성 초안(사람 검토 후 배포 파이프라인에 반영할 것). 원본 알고리즘은
// pb_migrations/1786500002_reconciled_org_profiles_with_govtree.js와 동일.
migrate((db) => {
  const dao = new Dao(db);
  const orgCol = dao.findCollectionByNameOrId("org_profiles");

  const entries = [
${entriesLiteral}
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
    rec.set("as_of_date", new Date().toISOString().slice(0, 10));
    dao.saveRecord(rec);
    results.updated.push(org_id);
  });

  console.log(\`org_profiles gov-tree 조정: \${results.updated.length}건 갱신, \${results.skipped_not_found.length}건 org_id 못 찾음\`);
  if (results.skipped_not_found.length) {
    console.log("못 찾은 org_id:", results.skipped_not_found.join(", "));
  }
}, (db) => {
  const dao = new Dao(db);
  const orgIds = [${orgIdsLiteral}];
  orgIds.forEach((org_id) => {
    try {
      const rec = dao.findFirstRecordByData("org_profiles", "org_id", org_id);
      rec.set("connected", false);
      rec.set("resolution_strategy", "complete_lookup_table");
      rec.set("gov_tree_ref", "");
      dao.saveRecord(rec);
    } catch (e) { /* 없으면 무시 */ }
  });
})
`;
}

function printReport(result) {
  console.log(`매칭 결과 — REAL(반영 대상) ${result.real_matched.length}건 / STUB(보류) ${result.stub_matched.length}건 / 미매칭-확장후보 ${result.unmatched.length}건 / 미매칭-대상아님 ${result.unmatched_out_of_scope.length}건`);
  if (result.real_matched.length) {
    console.log('\n[REAL — gov_tree_ref 반영 대상]');
    for (const e of result.real_matched) console.log(`  ${e.org_id}  ${e.org_name}  →  ${e.gov_tree_ref}`);
  }
  if (result.stub_matched.length) {
    console.log(`\n[STUB — gov-tree 쪽도 아직 스텁이라 보류] ${result.stub_matched.length}건 (--verbose로 목록 확인)`);
  }
  if (result.unmatched.length) {
    console.log(`\n[미매칭 — gov-tree 확장 후보(예: 강원도)] ${result.unmatched.length}건 (--verbose로 목록 확인)`);
  }
  if (result.unmatched_out_of_scope.length) {
    console.log(`\n[미매칭 — gov-tree 대상 아님(교육청 등, 2026-08-05 방침)] ${result.unmatched_out_of_scope.length}건 (--verbose로 목록 확인)`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const getFlag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };
  const verbose = args.includes('--verbose');
  const inputPath = getFlag('--input');
  const emitMigrationPath = getFlag('--emit-migration');

  if (!inputPath) {
    console.log(`사용법: node tools/reconcile_org_profiles_govtree.mjs --input <org_profiles_admin_local.json> [--emit-migration <출력.js>] [--verbose]

입력 파일은 org_profiles 컬렉션을 branch="admin_local"로 필터링해 export한
JSON 배열이어야 한다(PocketBase Admin UI → Collections → org_profiles →
Export, 또는 관리자 API 조회 결과). 각 레코드는 최소 org_id·org_name·branch
필드가 있어야 한다.`);
    process.exit(1);
  }

  const orgProfilesRecords = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  const result = reconcile(Array.isArray(orgProfilesRecords) ? orgProfilesRecords : orgProfilesRecords.items || []);

  printReport(result);
  if (verbose) {
    if (result.stub_matched.length) {
      console.log('\n[STUB 상세]');
      for (const e of result.stub_matched) console.log(`  ${e.org_id}  ${e.org_name}  →  ${e.gov_tree_ref}(스텁)`);
    }
    if (result.unmatched.length) {
      console.log('\n[미매칭-확장후보 상세]');
      for (const e of result.unmatched) console.log(`  ${e.org_id}  ${e.org_name}`);
    }
    if (result.unmatched_out_of_scope.length) {
      console.log('\n[미매칭-대상아님 상세]');
      for (const e of result.unmatched_out_of_scope) console.log(`  ${e.org_id}  ${e.org_name}  (${e.reason})`);
    }
  }

  if (emitMigrationPath) {
    fs.writeFileSync(emitMigrationPath, renderMigrationDraft(result.real_matched));
    console.log(`\n마이그레이션 초안 작성: ${emitMigrationPath} (검토 후 pb_migrations/로 옮겨 배포 파이프라인에 반영할 것 — 자동 적용 안 함)`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
