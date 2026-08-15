// pilot_test_semantic_search.mjs
//
// 시맨틱 검색(gov-fee-semantic-search) 품질 검증 파일럿 — 2026-08-15
//
// 사용법:
//   node pilot_test_semantic_search.mjs --worker-url https://hondi-proxy.tensor-city.workers.dev
//
// 구성:
//   - POSITIVE_CASES: 실제 REAL 데이터(천안시 민원사무편람)에서 뽑은 40개 항목을
//     "실사용자가 실제로 물어볼 법한 자연어"로 바꿔 쓴 쿼리 + 정답(expectedService).
//     쿼리 문구는 원본 민원사무명을 그대로 베끼지 않고 일부러 구어체·완곡 표현으로
//     바꿨다 — 정확 문자열 매칭이 아니라 "의미"를 이해하는지 보기 위함.
//   - NEGATIVE_CASES: 정부 민원과 전혀 무관한 10개 발화. 여기서 그럴듯한 매칭이
//     나오면(= False Positive) 임계값이 너무 낮다는 신호다.
//
// 출력: 각 케이스별 top-3 후보 + 점수, Top-1/Top-3 정확도, False Positive율,
// 실패 케이스 상세 목록.

const args = process.argv.slice(2);
const workerUrlIdx = args.indexOf('--worker-url');
const WORKER_URL = workerUrlIdx >= 0 ? args[workerUrlIdx + 1] : process.env.HONDI_WORKER_URL;
if (!WORKER_URL) {
  console.error('사용법: node pilot_test_semantic_search.mjs --worker-url <URL>');
  process.exit(1);
}

// ── 긍정 케이스 (실제 REAL 서비스명 기반, 자연어로 paraphrase) ──────────
// region_code는 baseline으로 통일(전국 어디서든 이 값이 있어야 정상).
const POSITIVE_CASES = [
  // 건축
  { query: '가설건축물 임시로 더 쓰고 싶은데 연장신고 하려면?', expected: '가설건축물 존치기간 연장신고' },
  { query: '건축신고 하려고요', expected: '건축신고' },
  { query: '건축허가 받고 싶어요', expected: '건축허가' },
  { query: '건축주가 바뀌어서 변경신고 해야 하는데', expected: '건축관계자 변경 신고' },
  { query: '가설건축물 짓기 전에 신고할 게 있나요', expected: '가설건축물 축조신고' },

  // 자동차·건설기계
  { query: '건설기계 등록증 잃어버려서 재발급 받으려고요', expected: '건설기계 등록(검사)증 재발급' },
  { query: '건설기계 다 써서 등록 말소하고 싶어요', expected: '건설기계 등록말소신청' },
  { query: '건설기계 빌려주는 사업 등록하려면?', expected: '건설기계대여업 등록신청' },
  { query: '자동차등록원부 등본 발급받고 싶어요', expected: '자동차등록원부 등본(초본) 발급ㆍ열람 신청서' },
  { query: '건설기계 조종사 면허 갱신 시기라 적성검사 받아야 해요', expected: '건설기계조종사면허 정기(수시)적성검사 신청' },

  // 영업신고·등록
  { query: '집단급식소 운영신고증 재발급 받고 싶어요', expected: '(영업허가증, 영업신고증, 집단급식소 설치 ㆍ 운영신고증)재발급' },
  { query: '가축 분뇨 관련 영업 허가 받으려고요', expected: '가축분뇨관련영업 [허가신청서, 변경허가신청서, 변경신고서]' },
  { query: '건강기능식품 파는 가게 영업신고 하려는데', expected: '건강기능식품영업신고' },
  { query: '건강기능식품 가게 사장이 바뀌어서 승계신고 해야 해요', expected: '건강기능식품영업자승계신고' },
  { query: '통신판매업 시작하려고 신고하려는데', expected: '통신판매업자의 신고' },

  // 환경
  { query: '건설 폐기물 처리업 허가받고 싶습니다', expected: '건설폐기물 처리업(허가, 변경허가) 신청' },
  { query: '공장에 대기오염물질 배출시설 설치하려고 신고하려는데', expected: '대기배출시설 설치신고' },
  { query: '대기배출시설 새로 허가받아야 하는데', expected: '대기배출시설 설치허가' },
  { query: '공장 소음이 심해서 방지시설 바꾸려고 하는데 신고해야 하나요', expected: '소음·진동 배출시설 변경신고-시설변경' },
  { query: '소음 진동 배출시설 새로 설치하는데 신고할 게 있나요', expected: '소음·진동 배출시설 설치신고' },

  // 보건·의료
  { query: '동물병원 개원하려는데 신고해야 하나요', expected: '동물병원 개설신고' },
  { query: '동물약국 차리려고 하는데', expected: '동물약국 개설신고' },
  { query: '병원에 부속 진료소 새로 여는데 신고할 게 있나요', expected: '부속의료기관 개설 신고 및 변경신고' },
  { query: '약국 허가증 다시 발급받고 싶어요', expected: '약국·안전상비의약품판매업·의약품판매업 (등록증·허가증) 재발급' },

  // 운수업
  { query: '개인택시 다른 사람한테 넘기려고 하는데 어떻게 해야 하나요', expected: '개인택시운송사업 양도·양수인가' },
  { query: '렌터카 사업 다른 사람한테 넘기려고요', expected: '여객자동차운송사업(자동차대여사업) 양도양수신고-시외고속버스이외' },
  { query: '렌터카 사업 그만하려고 폐업신고 하려는데', expected: '여객자동차운송사업(자동차대여사업)의 휴업 ·폐업 신고' },

  // 면허·자격
  { query: '이발소 차리려고 하는데 미용사 면허 신청하려면?', expected: '이용사, 미용사면허신청' },
  { query: '사냥 면허 갱신하려고 하는데요', expected: '수렵면허 갱신 신청서' },
  { query: '면허증 잃어버려서 다시 받고 싶어요', expected: '면허(등록)증 재교부 신청' },

  // 전국공통(national) — region_code 필터 없이 검증
  { query: '부동산 매매계약서 쓰는데 세금 내야 하나요', expected: '인지세(부동산·선박·항공기 소유권이전증서)', national: true },
  { query: '자동차 사고 파는데 인지세 내야 하나요', expected: '인지세(등록대상 동산 양도증서 - 자동차 등)', national: true },
  { query: '소송 걸려는데 법원에 내야 하는 돈이 얼마인가요', expected: '법원 인지대(민사소송 등, 본안)', national: true },
  { query: '재판 서류 우편으로 받으려면 송달료 얼마 내야 하나요', expected: '법원 송달료', national: true },
];

// ── 부정 케이스 (정부 민원과 무관한 발화) ────────────────────────────
const NEGATIVE_CASES = [
  '오늘 날씨 어때',
  '점심 뭐 먹을까',
  '넷플릭스 추천해줘',
  '주식 시장 어떻게 되고 있어',
  '요즘 재밌는 영화 뭐 있어',
  '커피 어디서 사는 게 맛있어',
  '헬스장 다니는 게 좋을까',
  '오늘 야구 경기 결과 알려줘',
  '노래 하나 추천해줘',
  '강아지 산책 얼마나 시켜야 해',
];

async function query(text, { regionCode } = {}) {
  const url = new URL('/gov-fee-semantic-search', WORKER_URL);
  url.searchParams.set('query', text);
  url.searchParams.set('limit', '3');
  if (regionCode) url.searchParams.set('region_code', regionCode);
  const res = await fetch(url.toString());
  if (!res.ok) return { error: `HTTP ${res.status}` };
  return res.json();
}

function normalize(s) {
  return String(s || '').replace(/\s+/g, '').replace(/['"'']/g, '');
}

// 2026-08-15 갱신 — gov-fee-lookup.js에 추가된 "1·2위 점수차 안전장치"를
// 그대로 시뮬레이션한다. 실제 자동 확정(OK)이 몇 건인지, 그중 진짜 맞았는지,
// 안전장치가 애매한 걸 잘 잡아냈는지까지 봐야 이 기능의 진짜 신뢰도를 알 수 있다.
const SEMANTIC_SCORE_THRESHOLD = 0.55; // gov-fee-lookup.js와 동일하게 유지할 것
const AMBIGUOUS_SCORE_GAP = 0.03; // gov-fee-lookup.js와 동일하게 유지할 것

function simulateDecision(candidates) {
  const top = candidates[0];
  if (!top || typeof top.score !== 'number' || top.score < SEMANTIC_SCORE_THRESHOLD) {
    return 'BELOW_THRESHOLD'; // 키워드 매칭 등 다른 경로로 폴백(여기선 시뮬레이션 안 함)
  }
  const second = candidates[1];
  const gap = typeof second?.score === 'number' ? top.score - second.score : Infinity;
  if (gap < AMBIGUOUS_SCORE_GAP) return 'NEEDS_APPROVAL';
  return 'OK';
}

async function runPositiveCases() {
  console.log('══════════════ 긍정 케이스 (정답 있음) ══════════════\n');
  let top1Correct = 0;
  let top3Correct = 0;
  const failures = [];

  // 실제 시스템 동작 시뮬레이션 집계
  const sim = { okCorrect: 0, okWrong: 0, needsApproval: 0, belowThreshold: 0 };
  const okWrongDetails = [];

  for (const [i, c] of POSITIVE_CASES.entries()) {
    const opts = c.national ? {} : { regionCode: 'baseline' };
    const result = await query(c.query, opts);
    const candidates = result.candidates || [];
    const names = candidates.map((cand) => cand.service_name);
    const scores = candidates.map((cand) => cand.score?.toFixed(3));

    const expectedNorm = normalize(c.expected);
    const top1Match = candidates[0] && normalize(candidates[0].service_name) === expectedNorm;
    const top3Match = candidates.some((cand) => normalize(cand.service_name) === expectedNorm);

    if (top1Match) top1Correct++;
    if (top3Match) top3Correct++;

    const decision = simulateDecision(candidates);
    if (decision === 'OK' && top1Match) sim.okCorrect++;
    else if (decision === 'OK' && !top1Match) {
      sim.okWrong++;
      okWrongDetails.push({ ...c, got: names[0], score: scores[0] });
    } else if (decision === 'NEEDS_APPROVAL') sim.needsApproval++;
    else sim.belowThreshold++;

    const mark = top1Match ? '✅' : top3Match ? '🟡' : '❌';
    const decisionTag = { OK: '[자동확정]', NEEDS_APPROVAL: '[승인요구]', BELOW_THRESHOLD: '[임계값미달]' }[decision];
    console.log(`${mark} ${decisionTag} [${i + 1}/${POSITIVE_CASES.length}] "${c.query}"`);
    console.log(`     기대: ${c.expected}`);
    console.log(`     결과: ${names.map((n, j) => `${n}(${scores[j]})`).join(' / ') || '(없음)'}`);
    console.log();

    if (!top1Match) {
      failures.push({ ...c, got: names, scores });
    }

    // Vectorize 쿼리 사이 짧은 간격 (레이트리밋 방지)
    await new Promise((r) => setTimeout(r, 150));
  }

  return { top1Correct, top3Correct, total: POSITIVE_CASES.length, failures, sim, okWrongDetails };
}

async function runNegativeCases() {
  console.log('\n══════════════ 부정 케이스 (정답 없어야 함) ══════════════\n');
  let falsePositives = 0;
  const fpDetails = [];

  for (const [i, text] of NEGATIVE_CASES.entries()) {
    const result = await query(text, { regionCode: 'baseline' });
    const candidates = result.candidates || [];
    const top = candidates[0];

    // resolveGovFee의 실제 임계값을 기준으로 "통과됐을 후보"만 오탐으로 카운트
    const wouldPass = top && typeof top.score === 'number' && top.score >= SEMANTIC_SCORE_THRESHOLD;
    if (wouldPass) falsePositives++;

    const mark = wouldPass ? '❌ FP' : '✅';
    console.log(`${mark} [${i + 1}/${NEGATIVE_CASES.length}] "${text}"`);
    if (top) {
      console.log(`     최상위 후보: ${top.service_name} (${top.score?.toFixed(3)})${wouldPass ? `  ← 임계값(${SEMANTIC_SCORE_THRESHOLD}) 통과! 오탐` : '  (임계값 미달, 정상 차단)'}`);
    } else {
      console.log('     후보 없음 (정상)');
    }
    console.log();

    if (wouldPass) fpDetails.push({ text, top });
    await new Promise((r) => setTimeout(r, 150));
  }

  return { falsePositives, total: NEGATIVE_CASES.length, fpDetails };
}

async function main() {
  console.log(`대상 Worker: ${WORKER_URL}`);
  console.log(`긍정 케이스 ${POSITIVE_CASES.length}건, 부정 케이스 ${NEGATIVE_CASES.length}건\n`);

  const pos = await runPositiveCases();
  const neg = await runNegativeCases();

  console.log('\n══════════════ 최종 요약 ══════════════');
  console.log(`Top-1 정확도(순수 매칭력): ${pos.top1Correct}/${pos.total} (${((pos.top1Correct / pos.total) * 100).toFixed(1)}%)`);
  console.log(`Top-3 정확도: ${pos.top3Correct}/${pos.total} (${((pos.top3Correct / pos.total) * 100).toFixed(1)}%)`);
  console.log(`False Positive율(임계값 ${SEMANTIC_SCORE_THRESHOLD} 기준): ${neg.falsePositives}/${neg.total} (${((neg.falsePositives / neg.total) * 100).toFixed(1)}%)`);

  console.log('\n--- 실제 시스템 동작 시뮬레이션(점수차 안전장치 반영) ---');
  const s = pos.sim;
  console.log(`  자동확정(OK) & 정답:        ${s.okCorrect}건  ← 이상적인 경우`);
  console.log(`  자동확정(OK) & 오답:        ${s.okWrong}건  ← ⚠️ 위험: 사용자가 모르는 채로 잘못된 요금이 나갈 수 있는 케이스`);
  console.log(`  승인요구(NEEDS_APPROVAL):   ${s.needsApproval}건  ← 안전(맞든 틀리든 사람이 확인)`);
  console.log(`  임계값 미달(폴백):          ${s.belowThreshold}건  ← 키워드 매칭 등 다른 경로로 위임`);
  if (pos.okWrongDetails.length > 0) {
    console.log('\n  ⚠️ 자동확정됐는데 틀린 케이스 상세(가장 중요하게 봐야 할 목록):');
    for (const d of pos.okWrongDetails) {
      console.log(`    "${d.query}" → 기대: ${d.expected} / 실제 자동확정된 답: ${d.got} (${d.score})`);
    }
  } else {
    console.log('\n  ✅ 자동확정됐는데 틀린 케이스 없음 — 점수차 안전장치가 위험 케이스를 전부 승인요구로 돌렸습니다.');
  }

  if (pos.failures.length > 0) {
    console.log('\n--- Top-1 실패 케이스 상세 ---');
    for (const f of pos.failures) {
      console.log(`  "${f.query}" → 기대: ${f.expected} / 실제: ${f.got.join(', ') || '(없음)'} (${f.scores.join(', ')})`);
    }
  }
  if (neg.fpDetails.length > 0) {
    console.log('\n--- False Positive 상세 ---');
    for (const fp of neg.fpDetails) {
      console.log(`  "${fp.text}" → ${fp.top.service_name} (${fp.top.score?.toFixed(3)})`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
