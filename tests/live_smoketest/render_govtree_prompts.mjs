#!/usr/bin/env node
/**
 * tests/live_smoketest/render_govtree_prompts.mjs
 * -------------------------------------------------
 * "새 대화창에서 호출된 제주 지역 공공기관·부서 SP가 관제탑 원칙에 따라
 * 대응하는지" 테스트(NEXT_SESSION_HANDOFF_20260809.md §2)의 1단계 —
 * directCode로 실제 기관 SP 텍스트(assembleGovSystemPrompt의 systemPrompt)
 * 를 미리 렌더링해서 파일로 저장한다.
 *
 * ## 왜 별도 렌더 단계가 필요한가
 * control_tower_live_smoketest.py(2026-08-08 신설)는 sp-catalog.json
 * 매니페스트의 고정 sp_keys 목록만 system prompt로 합성할 수 있다 —
 * gov-tree 기관 SP는 그 매니페스트에 없고, gov-router.js의
 * assembleGovSystemPrompt(text, hint, classifyFn, onProgress, directCode)
 * 가 매 기관마다 province master data + 위성 저장소 콘텐츠를 "그때그때"
 * 조립해야 한다(JS 런타임 필요, 파이썬 하네스가 직접 재구현할 수 없다).
 * 그래서 이 Node 스크립트가 먼저 각 시나리오의 directCode를 실제
 * 프로덕션 코드 경로(gov-router.js 그 자체, 재구현 아님)로 풀어
 * results/govtree-prompts/<id>.txt에 저장하면, control_tower_live_
 * smoketest.py는 system_prompt_file 필드로 그 파일을 읽기만 하면 된다.
 *
 * ## 네트워크 요구사항(중요)
 * - city-dept/do-agency/org/do-dept/province/emd/team tier는
 *   raw.githubusercontent.com만 필요(정적 콘텐츠) — 대부분 환경에서 됨.
 * - nat-agency tier(국가기관 지사 — 세무서/법원 등, 이번 세션이 가장
 *   위험하다고 판단한 category)는 SIGUNGU_RESOLVE_ORIGIN
 *   (hondi-proxy.tensor-city.workers.dev)에 실제로 붙어야 한다 — egress가
 *   제한된 sandbox에서는 이 tier가 error_fallback으로 빈 렌더링된다.
 *   GitHub Actions(ubuntu-latest, 무제한 아웃바운드)에서 실행할 것.
 *
 * Usage:
 *   node render_govtree_prompts.mjs \
 *     --scenarios scenarios_control_tower_govtree_jeju_20260809.json \
 *     --out ../../results/govtree-prompts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = { scenarios: 'scenarios_control_tower_govtree_jeju_20260809.json', out: '../../results/govtree-prompts' };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--scenarios') args.scenarios = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs();

  // gov-router.js가 top-level에서 window.assembleGovSystemPrompt = ... 를
  // 실행한다(브라우저 전역 가정) — 다른 live_smoketest .mjs 하네스와 동일한
  // 이유로 빈 전역 객체를 먼저 만들어준다.
  global.window = global.window || {};

  const modPath = path.resolve(__dirname, '../../src/gopang/gov/gov-router.js');
  const { assembleGovSystemPrompt } = await import(modPath);

  const scenariosPath = path.resolve(__dirname, args.scenarios);
  const scenarios = JSON.parse(fs.readFileSync(scenariosPath, 'utf-8'));

  const outDir = path.resolve(__dirname, args.out);
  fs.mkdirSync(outDir, { recursive: true });

  const manifest = [];
  let failCount = 0;

  for (const s of scenarios) {
    const { id, directCode, renderText = '', pdvLocationHint = null } = s;
    if (!directCode) {
      console.error(`[skip] ${id}: directCode 없음 (system_prompt_file을 이미 직접 지정한 시나리오일 수 있음)`);
      continue;
    }
    try {
      const r = await assembleGovSystemPrompt(renderText, pdvLocationHint, null, null, directCode);
      const outFile = path.join(outDir, `${id}.txt`);
      fs.writeFileSync(outFile, r.systemPrompt, 'utf-8');

      // ★ error_fallback 감지 — nat-agency tier가 hondi-proxy에 못 붙으면
      // resolveNationalAgencyLazy가 조용히 "정부24/110으로 확인하세요" 같은
      // 일반 안내문으로 대체한다(예외를 던지지 않음). 이 상태로 그냥
      // 넘어가면 "실제 기관 SP 텍스트"가 아니라 껍데기만 채점하게 되므로,
      // trace에 이 신호가 있으면 렌더 자체를 실패로 표시한다.
      const isErrorFallback = r.trace.some(t => /error_fallback/.test(t));
      manifest.push({
        id,
        directCode,
        trace: r.trace,
        promptLength: r.systemPrompt.length,
        renderStatus: isErrorFallback ? 'ERROR_FALLBACK' : 'OK',
        systemPromptFile: `${id}.txt`,
      });
      if (isErrorFallback) {
        failCount++;
        console.error(`[ERROR_FALLBACK] ${id} (${directCode}): trace=${JSON.stringify(r.trace)}`);
      } else {
        console.log(`[ok] ${id} (${directCode}) -> ${r.systemPrompt.length}자, trace=${JSON.stringify(r.trace)}`);
      }
    } catch (e) {
      failCount++;
      manifest.push({ id, directCode, renderStatus: 'EXCEPTION', error: e.message });
      console.error(`[EXCEPTION] ${id} (${directCode}): ${e.message}`);
    }
  }

  fs.writeFileSync(path.join(outDir, '_render_manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`\n${manifest.length}건 렌더 완료, 실패 ${failCount}건. 매니페스트: ${path.join(outDir, '_render_manifest.json')}`);
  if (failCount > 0) process.exitCode = 1;
}

main();
