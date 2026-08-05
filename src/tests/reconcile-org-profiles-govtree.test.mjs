// reconcile-org-profiles-govtree.test.mjs — 2026-08-05 신설
//
// tools/reconcile_org_profiles_govtree.mjs가 재구현한 매칭 알고리즘이
// 원 세션에서 손으로 조정해 이미 커밋된 pb_migrations/1786500002의 28건
// 결과를 정확히 재현하는지 검증한다. 마침 pb_migrations/1786400001
// (org_profiles 시딩 1/12, 376건)에 그 28건이 전부 포함돼 있어(직접 대조
// 확인) 실제 데이터로 회귀 테스트를 만들 수 있다 — 이 스크립트가 다음
// 실사 라운드에서도 신뢰하고 재사용할 수 있는 루틴인지의 근거다
// (HANDOFF_2026-08-05 §4-4).
//
// 실행: node --test src/tests/reconcile-org-profiles-govtree.test.mjs

import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

const { reconcile } = await import('../../tools/reconcile_org_profiles_govtree.mjs');

function loadSeedOrgs() {
  const src = fs.readFileSync(
    path.join(ROOT, 'pb_migrations/1786400001_seeded_benefit_catalog_orgs_full.js'),
    'utf-8'
  );
  const m = src.match(/const orgs = (\[.*?\]);/s);
  assert.ok(m, '시딩 파일에서 orgs 배열을 못 찾음 — 파일 형식이 바뀌었을 수 있음');
  return JSON.parse(m[1]);
}

function loadKnownGoodEntries() {
  const src = fs.readFileSync(
    path.join(ROOT, 'pb_migrations/1786500002_reconciled_org_profiles_with_govtree.js'),
    'utf-8'
  );
  const m = src.match(/const entries = (\[[\s\S]*?\]);/);
  assert.ok(m, '조정 마이그레이션에서 entries 배열을 못 찾음 — 파일 형식이 바뀌었을 수 있음');
  // eslint-disable-next-line no-eval -- 신뢰된 로컬 repo 파일, 테스트 전용
  return eval(m[1]);
}

test('시딩 파일(376건) 대조 — 알고리즘이 기존 28건 REAL 매칭을 정확히 재현', () => {
  const orgs = loadSeedOrgs();
  const known = loadKnownGoodEntries();
  const result = reconcile(orgs, ROOT);

  const gotMap = new Map(result.real_matched.map(e => [e.org_id, e.gov_tree_ref]));
  assert.equal(gotMap.size, known.length, `REAL 매칭 건수 불일치 — got ${gotMap.size}, expected ${known.length}`);

  for (const { org_id, gov_tree_ref } of known) {
    assert.equal(gotMap.get(org_id), gov_tree_ref, `${org_id}의 gov_tree_ref 불일치`);
  }
});

test('admin_local이 아닌 branch(admin_central·public_institution 등)는 건너뜀', () => {
  const orgs = loadSeedOrgs();
  const result = reconcile(orgs, ROOT);
  const nonLocalCount = orgs.filter(o => o.branch !== 'admin_local').length;
  assert.equal(result.skipped_non_admin_local.length, nonLocalCount);
  // 스킵된 것들이 실제로 REAL/STUB/미매칭(두 종류 다) 어디에도 안 들어갔는지 확인
  const allClassified = [
    ...result.real_matched,
    ...result.stub_matched,
    ...result.unmatched,
    ...result.unmatched_out_of_scope,
  ].map(e => e.org_id);
  const nonLocalIds = new Set(orgs.filter(o => o.branch !== 'admin_local').map(o => o.org_id));
  assert.ok(allClassified.every(id => !nonLocalIds.has(id)), 'admin_local 아닌 레코드가 분류 결과에 섞여 들어감');
});

test('STUB/미매칭 분류 — 알려진 28건과 겹치지 않음(REAL과 배타적)', () => {
  const orgs = loadSeedOrgs();
  const result = reconcile(orgs, ROOT);
  const realIds = new Set(result.real_matched.map(e => e.org_id));
  const stubIds = result.stub_matched.map(e => e.org_id);
  const unmatchedIds = result.unmatched.map(e => e.org_id);
  const outOfScopeIds = result.unmatched_out_of_scope.map(e => e.org_id);
  assert.ok(stubIds.every(id => !realIds.has(id)));
  assert.ok(unmatchedIds.every(id => !realIds.has(id)));
  assert.ok(outOfScopeIds.every(id => !realIds.has(id) && !stubIds.includes(id) && !unmatchedIds.includes(id)));
});

// 2026-08-05 추가 — §3-2(34건 미매칭) 방침 결정 회귀 테스트.
// 34건이 무작위가 아니라 두 카테고리(강원도 관련 18건 / 교육청 16건)로
// 정확히 나뉘는지, 그리고 교육청은 전부 "교육청" 접미 이름으로 걸러지는지
// 확인한다. 이 수(18/16)는 2026-08-05 기준 gov-tree 실사 스냅샷에 대한
// 값이라 향후 gov-tree가 강원도를 채우면 unmatched 쪽 수는 줄어드는 게
// 정상이다 — 그럴 땐 이 테스트의 기댓값을 그때 갱신할 것.
test('34건 미매칭 분류 — 교육청은 unmatched_out_of_scope로, 나머지(강원도 등)는 unmatched로 분리', () => {
  const orgs = loadSeedOrgs();
  const result = reconcile(orgs, ROOT);

  assert.equal(
    result.unmatched.length + result.unmatched_out_of_scope.length,
    34,
    '미매칭 총합이 34건이 아님 — gov-tree 실사 데이터가 바뀌었을 수 있음(이 경우 기댓값을 재검토할 것)'
  );
  assert.equal(result.unmatched_out_of_scope.length, 16, '교육청으로 분류된 건수가 16건이 아님');
  assert.ok(
    result.unmatched_out_of_scope.every(e => e.org_name.endsWith('교육청')),
    'unmatched_out_of_scope에 "교육청"으로 끝나지 않는 org_name이 섞여 있음'
  );
  assert.ok(
    result.unmatched.every(e => !e.org_name.endsWith('교육청')),
    'unmatched(확장 후보)에 교육청이 잘못 섞여 들어감'
  );
});
