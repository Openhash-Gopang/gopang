#!/usr/bin/env node
/**
 * live-gov-router-smoketest.mjs
 *
 * gov-router.js(과/팀 2단계 라우팅 + LLM 동점 폴백)를 실제 네트워크로
 * 검증한다 — 이전 스모크테스트는 fetch를 전부 로컬 파일로 mock했고
 * classifyFn도 "후보 목록 첫 줄을 그대로 고르는" 가짜였다. 이 스크립트는
 * 둘 다 진짜를 쓴다:
 *   - _fetchText 경로: 실제 raw.githubusercontent.com (mock 없음)
 *   - classifyFn: 실제 hondi-proxy /chat/completions → 실제 DeepSeek
 *     (pages/regional-gov.html에 새로 배선한 _govClassifyFn과 동일 로직)
 *
 * 실행 (샌드박스가 아니라 실제 네트워크가 열려있는 로컬/CI 환경에서):
 *   node live-gov-router-smoketest.mjs
 *
 * 종료 코드: 시나리오 중 하나라도 예상과 다르면 1, 전부 기대대로면 0.
 * (단, LLM 자유응답이라 "동점 시나리오가 두 후보 중 하나를 골랐는가"
 * 처럼 결정론적이지 않은 부분은 PASS/FAIL 대신 사람이 raw 출력을
 * 직접 확인하도록 REVIEW로 표시한다 — live_smoketest.py와 같은 관례.)
 */

const PROXY = 'https://hondi-proxy.tensor-city.workers.dev';

global.window = {}; // gov-router.js가 window.assembleGovSystemPrompt = ... 를 top-level에서 실행함

async function _govClassifyFn(text, candidatesText) {
  try {
    const r = await fetch(`${PROXY}/chat/completions`, {
      method: 'POST',
      // worker.js가 2026-06-28부터 AI 프록시 경로(/chat/completions 포함)에
      // 브라우저 Origin 헤더 없는 요청을 403으로 차단한다(무단 크레딧
      // 소진 사고 이후 추가된 보안장치 — worker.js:8088 AI_PROXY_PATHS).
      // 브라우저에서 도는 실제 프로덕션(regional-gov.html)은 자동으로
      // Origin을 보내므로 문제없지만, 이 스크립트는 Node라 직접 세팅해야
      // 한다. ALLOWED_ORIGINS(worker.js:29)에 있는 진짜 허용 오리진을
      // 그대로 쓴다 — 우회가 아니라 "브라우저인 척" 진단용.
      headers: { 'Content-Type': 'application/json', 'Origin': 'https://hondi.net' },
      body: JSON.stringify({
        model: 'deepseek-v4-flash', max_tokens: 20, temperature: 0,
        messages: [
          { role: 'system', content:
            '아래는 제주 지방행정 라우팅 코드 후보 목록이다. 사용자 발화를 읽고 ' +
            '가장 알맞은 코드 하나만 답하라. 확신이 없거나 해당하는 코드가 없으면 ' +
            'NONE이라고만 답하라. 다른 설명·문장부호 없이 코드 또는 NONE만 출력한다.\n\n' +
            candidatesText },
          { role: 'user', content: text },
        ],
      }),
    });
    if (!r.ok) {
      const errBody = await r.text().catch(() => '');
      console.warn(`  [classifyFn] HTTP ${r.status}: ${errBody.slice(0, 200)}`);
      return null;
    }
    const d = await r.json();
    const raw = (d.choices?.[0]?.message?.content || '').trim();
    const m = raw.match(/[A-Z0-9][A-Z0-9-]*/);
    return m ? m[0] : (raw === 'NONE' ? 'NONE' : null);
  } catch (e) {
    console.warn('  [classifyFn] 실패:', e.message);
    return null;
  }
}

const mod = await import('../../src/gopang/gov/gov-router.js');
// ※ 경로가 안 맞으면(리포 구조상 이 파일을 어디 두느냐에 따라) 아래처럼
// 절대경로/상대경로를 직접 조정해서 실행해주세요:
//   node live-gov-router-smoketest.mjs   (리포 루트에서 실행한다고 가정,
//   그 경우 import 경로를 './src/gopang/gov/gov-router.js'로 바꾸세요)

const SCENARIOS = [
  // [label, text, useLLM, expectation]
  // expectation: 'contains:CODE' → trace에 해당 코드가 있어야 PASS
  //              'not-contains:CODE' → 없어야 PASS
  //              'review' → 자동판정 안 함, 사람이 raw trace 확인

  // ── 1) 단독 최고점(LLM 불필요) ──
  ['시청 과 — 단독매칭', '제주시 환경오염 단속 신고하고 싶어요', true,
    'contains:SP-CITYDIV-JEJUSI-CLIMATE-ENVGUIDE'],
  ['도청 실국 과 — 단독매칭', '제주도청 청년정책 상담하고 싶어요', true,
    'contains:SP-DIV-PLAN-YOUTH'],
  ['직속기관 — 단독매칭(기관+과)', '제주 농업기술원 기술보급과 관련 문의드려요', true,
    'contains:SP-AGYDIV-AGRITECH-EXTENSION'],
  ['출자출연기관 — 단독매칭(기관+팀)', '제주의료원 진료부 예약하고 싶어요', true,
    'contains:SP-ORGDIV-JEJUMED-CLINICAL'],

  // ── 2) 세부 과 없음(미특정) — LLM 폴백 없이도 국/기관 단위에서 멈춰야 함 ──
  ['시청 국만 — 세부 과 매칭 없음', '제주시 청정환경국 관련 문의입니다', true,
    'not-contains:(과/팀 특정)'],

  // ── 3) 진짜 동점 — LLM 폴백 발동, 결정론적이지 않으므로 사람이 확인 ──
  ['도청 복지 — 동점(장애인+노인)', '제주도청 복지가족국인데 장애인복지랑 노인복지 둘 다 관련된 문의예요', true,
    'review'],

  // ── 4) 회귀(기존 로직, 이번 세션 변경과 무관) ──
  ['회귀 — 서귀포 건축허가', '서귀포시 건축허가 신청하고 싶어요', false,
    'contains:SP-CITYDIV-SEOGWIPO-CONSTRUCTION-BUILDING'],
  ['회귀 — 국세', '제주 세무서 국세 문의', false, 'contains:SP-NAT-TAX'],
  ['회귀 — 응급', '제주에서 불났어요 도와주세요', false, 'contains:SP-EXP-EMERGENCY'],
];

let pass = 0, fail = 0, review = 0;

for (const [label, text, useLLM, expectation] of SCENARIOS) {
  process.stdout.write(`\n=== ${label} ===\n입력: ${text}\n`);
  let result;
  try {
    result = await mod.assembleGovSystemPrompt(text, null, useLLM ? _govClassifyFn : null, null);
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
    fail++;
    continue;
  }
  const traceStr = JSON.stringify(result.trace);
  console.log('trace:', traceStr);

  if (expectation === 'review') {
    console.log('→ REVIEW (LLM 자유응답 — 위 trace가 타당한지 직접 확인)');
    review++;
    continue;
  }
  const [kind, code] = expectation.split(':');
  const found = traceStr.includes(code);
  const ok = kind === 'contains' ? found : !found;
  console.log(ok ? '→ PASS' : `→ FAIL (기대: ${expectation})`);
  ok ? pass++ : fail++;
}

console.log(`\n${'='.repeat(50)}\n결과: PASS ${pass} / FAIL ${fail} / REVIEW ${review} (총 ${SCENARIOS.length})`);
process.exit(fail > 0 ? 1 : 0);
