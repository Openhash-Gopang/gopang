#!/usr/bin/env node
/**
 * seed_gov_tree_pocketbase.mjs — GOV_TREE_LAZY_INSTANCING_DESIGN_v1_0.md §5-2
 * 부트스트랩 시딩 스크립트.
 *
 * 이번 세션(2026-08-05)에 사람이 직접 조사·검증한 부산 43개 동
 * (해운대 18 + 강서 9 + 금정 16, emd-master-data-busan.json)과 jachi
 * 16개 구·군(city-dept-master-data.json)을 PocketBase(L1)
 * sp_gov_tree_instance_realtime 컬렉션으로 1회성 이관한다.
 *
 * 왜 Python이 아니라 Node.js인가: gov-router.js의 렌더링 함수
 * (_renderEmdTemplate/_renderCityDeptTemplate)는 export되지 않은 내부
 * 함수라 Python에서 재구현하면 로직이 갈라질 위험이 있다. 대신
 * assembleGovSystemPrompt()를 그대로 재사용해(테스트 파일들과 동일한
 * readLocal 패턴으로 로컬 디스크 fetch를 모킹) "실제로 kgov 탭이 만드는
 * 것과 100% 동일한 텍스트"를 얻는다 — 재구현이 아니라 재사용.
 *
 * 사용법:
 *   node tools/seed_gov_tree_pocketbase.mjs --dry-run   # 렌더링만 확인, 전송 안 함
 *   node tools/seed_gov_tree_pocketbase.mjs --apply     # 실제로 worker.js에 POST
 *   node tools/seed_gov_tree_pocketbase.mjs --apply --worker-base https://hondi-proxy.tensor-city.workers.dev
 *
 * 전제: worker.js가 POST /gov-tree-instance/seed를 이미 서빙 중이어야 한다
 * (이번 세션에 handleGovTreeInstanceSeed로 신설, 이 패치가 배포된 뒤 실행할 것).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PROMPTS_ROOT = path.join(REPO_ROOT, 'prompts');
const SRC_ROOT = path.join(REPO_ROOT, 'src');

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--apply');
const workerBaseIdx = args.indexOf('--worker-base');
const WORKER_BASE = workerBaseIdx >= 0 && args[workerBaseIdx + 1]
  ? args[workerBaseIdx + 1]
  : 'https://hondi-proxy.tensor-city.workers.dev';

// ── metro-districts-phase1.test.mjs 등 기존 테스트 파일들과 동일한
// readLocal 패턴 — 실제 라우팅 로직을 그대로 재사용하기 위한 fetch 모킹.
function readLocal(u) {
  const govTreeIdx = u.indexOf('prompts/gov-tree/');
  const promptsIdx = u.indexOf('prompts/');
  const srcIdx = u.indexOf('src/gopang/gov/');
  let p;
  if (govTreeIdx !== -1) p = path.join(PROMPTS_ROOT, 'gov-tree', u.slice(govTreeIdx + 'prompts/gov-tree/'.length));
  else if (promptsIdx !== -1) p = path.join(PROMPTS_ROOT, u.slice(promptsIdx + 'prompts/'.length));
  else if (srcIdx !== -1) p = path.join(SRC_ROOT, 'gopang/gov', u.slice(srcIdx + 'src/gopang/gov/'.length));
  else return null;
  p = p.split('?')[0];
  try { return fs.readFileSync(p, 'utf-8'); } catch { return null; }
}

// ★ 2026-08-05 버그 수정(주피터님 실사용 중 발견) — 아래서 로컬 파일
// 읽기용으로 globalThis.fetch를 모의(mock) 함수로 덮어쓰는데, 이후 실제
// PocketBase 전송 단계(main()의 /gov-tree-instance/seed POST)에서 "원래
// fetch로 복원"하는 코드가 없어서, 실전송도 이 모의 함수를 그대로 타고
// 있었다 — 매번 ok:true + 빈 객체 {}를 돌려주는 목이라 "생성 0/스킵
// 0/실패 0"만 반복 출력되고 실제로는 서버에 아무 요청도 안 나가고
// 있었다(--apply를 여러 번 실행해도 항상 0/0/0, 걸린 시간도 사실상
// 0ms — 원본 네이티브 fetch 참조를 애초에 저장해두지 않아서
// "globalThis.fetch = fetch"가 그냥 자기 자신을 재대입하는 무의미한
// 코드였다). 원본을 먼저 저장해두고, 실전송 시점에만 명시적으로 그걸
// 쓴다.
const _nativeFetch = globalThis.fetch;

globalThis.window = globalThis;
globalThis.fetch = async (url) => {
  const u = String(url);
  // 이 스크립트 자신이 만드는 /gov-tree-instance/lookup 조회는 항상
  // "없음"으로 응답 — 시딩 중에는 아직 PocketBase에 아무것도 없으므로
  // (있으면 그건 이 스크립트가 이미 실행됐다는 뜻) 항상 로컬 JSON
  // 렌더링 경로를 타야 한다.
  if (u.includes('/gov-tree-instance/lookup')) return { ok: true, json: async () => ({ found: false }) };
  if (u.includes('/sp-author/queue')) return { ok: true, json: async () => ({ status: 'queued' }) }; // 미스 신호는 무시
  const content = readLocal(u);
  if (content === null) return { ok: true, text: async () => '{}', json: async () => ({}) };
  return { ok: true, text: async () => content, json: async () => JSON.parse(content) };
};

const { assembleGovSystemPrompt } = await import(pathToFileURL(path.join(SRC_ROOT, 'gopang/gov/gov-router.js')));

// ── 3분류 판정기 재구현(gov-router.js와 동일 규칙) — REAL만 시딩 대상.
// STUB/MISSING을 잘못 시딩하면 §4-1 미스 신호가 영구히 안 나가게 된다.
function classifyCityDeptInstance(rec) {
  if (!rec) return 'MISSING';
  if (!rec.국이름) return 'STUB';
  if (!rec.산하과목록) return 'STUB';
  return 'REAL';
}
function classifyEmdInstance(rec) {
  if (!rec) return 'MISSING';
  if (!rec.청사주소 || !rec.대표전화) return 'STUB';
  if (rec.청사주소.includes('TBD')) return 'STUB';
  return 'REAL';
}

async function collectCityDeptRecords() {
  const raw = readLocal('prompts/gov-tree/04-city/templates/city-dept-master-data.json');
  const all = JSON.parse(raw).국목록;
  // ★ 주피터 결정(2026-08-05): "해운대·강서·금정 43개 동 + jachi 16개 —
  // 그대로 유지, 부트스트랩 시드로 활용"에 정확히 맞춰 부산(시코드가
  // busan_ 접두)만 시딩 대상으로 한다. 제주 등 다른 도의 기존 REAL
  // 레코드(오래전부터 이미 완성돼 있던 것)는 이번 부트스트랩의 범위
  // 밖 — 필요하면 별도 세션에서 명시적으로 다시 결정할 것.
  const real = all.filter(r => r.시코드?.startsWith('busan_') && classifyCityDeptInstance(r) === 'REAL');
  console.log(`[city-dept] 부산 레코드 중 REAL ${real.length}건(전체 ${all.length}건 중, 다른 도 제외)`);

  const out = [];
  for (const rec of real) {
    const directCode = `city-dept:${rec.시코드}-${rec.국코드}`;
    const result = await assembleGovSystemPrompt('', null, null, null, directCode);
    // ★ city-dept 렌더링 순서는 항상 [...GOV-COMMON/도 체인..., cityText,
    // cityDeptText] — cityDeptText가 항상 "마지막" 조각으로 push된다
    // (gov-router.js tier==='city-dept' 핸들러 확인). 앞쪽 체인 길이가
    // 국가/도마다 달라 인덱스로 자르면 위험하므로, 항상 "마지막 조각만"
    // 취해 department 전용 내용을 안전하게 분리한다 — gov-router.js의
    // _fetchCityDeptText()가 호출부에게 department 조각만 반환하는 것과
    // 동일한 계약(호출부가 cityText는 항상 별도로 이미 push했으므로).
    const parts = result.systemPrompt.split('\n\n---\n\n');
    const deptOnly = parts[parts.length - 1];
    out.push({
      tier: 'city-dept', 도코드: 'busan', 시코드: rec.시코드, 국코드: rec.국코드,
      institution: `${rec.도이름 || ''} ${rec.시이름 || rec.시코드} ${rec.국이름}`.trim(),
      task: `${rec.국이름} 관련 문의(부트스트랩 시딩)`,
      generated_content: deptOnly,
    });
  }
  return out;
}

async function collectEmdRecords() {
  const raw = readLocal('prompts/gov-tree/05-emd/emd-master-data-busan.json');
  const all = JSON.parse(raw).읍면동목록;
  const real = all.filter(r => classifyEmdInstance(r) === 'REAL');
  console.log(`[emd] 전체 ${all.length}건 중 REAL ${real.length}건`);

  const out = [];
  for (const rec of real) {
    const directCode = `emd:${rec.읍면동명}`;
    const result = await assembleGovSystemPrompt('', null, null, null, directCode);
    // ★ 위 city-dept와 동일한 이유로 마지막 조각만 취한다(emd 렌더링도
    // 항상 [...체인..., cityText, emdText] 순서 — gov-router.js
    // tier==='emd' 핸들러 확인).
    const parts = result.systemPrompt.split('\n\n---\n\n');
    const emdOnly = parts[parts.length - 1];
    out.push({
      tier: 'emd', 도코드: 'busan', 읍면동명: rec.읍면동명,
      institution: `${rec.상위기관명 || ''} ${rec.읍면동명}`.trim(),
      task: `${rec.읍면동명} 행정복지센터 관련 문의(부트스트랩 시딩)`,
      generated_content: emdOnly,
    });
  }
  return out;
}

async function main() {
  console.log(`모드: ${DRY_RUN ? 'DRY-RUN(전송 안 함)' : `APPLY(${WORKER_BASE}로 전송)`}`);
  const cityDeptRecords = await collectCityDeptRecords();
  const emdRecords = await collectEmdRecords();
  const allRecords = [...cityDeptRecords, ...emdRecords];

  console.log(`\n총 ${allRecords.length}건 수집 완료(city-dept ${cityDeptRecords.length} + emd ${emdRecords.length})`);
  for (const r of allRecords.slice(0, 3)) {
    console.log(`  예시: [${r.tier}] ${r.institution} — 본문 ${r.generated_content.length}자`);
  }

  if (DRY_RUN) {
    const outPath = path.join(REPO_ROOT, 'tools', 'gov_tree_pocketbase_seed_preview.json');
    fs.writeFileSync(outPath, JSON.stringify(allRecords, null, 2), 'utf-8');
    console.log(`\nDRY-RUN — 실제 전송하지 않음. 미리보기를 ${outPath}에 저장했습니다.`);
    console.log('실제 이관은: node tools/seed_gov_tree_pocketbase.mjs --apply');
    return;
  }

  // 한 번에 너무 많이 보내지 않는다(§9-2 비용 상한 정신과 동일 —
  // worker.js 요청 바디 크기 제한도 고려). 10건씩 배치.
  // ★ 2026-08-05 축소(10→4, 주피터님 실사용 중 발견) — Cloudflare Workers
  // 하위요청(subrequest) 한도 초과("Too many subrequests by single Worker
  // invocation")가 실사용에서 재현됨. 레코드 1건당 PocketBase 왕복이
  // 최대 4번(sp_gov_tree_instance_realtime 조회+생성, profiles 조회+
  // 등록) 필요해 배치 10건이면 최대 40건 — 실측 결과 배치 뒷부분(8~9번째
  // 레코드 근방)에서 한도를 넘겨 실패했다(§9-2 비용 상한 KV 카운터와는
  // 무관한 별개 제약 — Cloudflare 플랫폼 자체의 요청당 하위요청 수
  // 상한). 4건이면 최대 16개 하위요청으로 여유 있게 안전.
  const BATCH_SIZE = 4;
  let created = 0, skipped = 0, failed = 0;
  for (let i = 0; i < allRecords.length; i += BATCH_SIZE) {
    const batch = allRecords.slice(i, i + BATCH_SIZE);
    console.log(`\n배치 ${i / BATCH_SIZE + 1} 전송 중... (${batch.length}건)`);
    const res = await _nativeFetch(`${WORKER_BASE}/gov-tree-instance/seed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: batch }),
    });
    if (!res.ok) {
      console.error(`  실패: HTTP ${res.status} — ${await res.text().catch(() => '')}`);
      failed += batch.length;
      continue;
    }
    const data = await res.json();
    created += (data.created || []).length;
    skipped += (data.skipped_existing || []).length;
    failed += (data.failed || []).length;
    console.log(`  생성 ${data.created?.length || 0} / 기존 건너뜀 ${data.skipped_existing?.length || 0} / 실패 ${data.failed?.length || 0}`);
    if (data.failed?.length) console.error('  실패 상세:', data.failed);
  }
  console.log(`\n=== 완료 === 생성 ${created} / 기존 건너뜀 ${skipped} / 실패 ${failed} (총 ${allRecords.length}건)`);
}

main().catch((e) => {
  console.error('시딩 스크립트 실행 실패:', e);
  process.exit(1);
});
