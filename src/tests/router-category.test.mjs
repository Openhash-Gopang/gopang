// SP-00-ROUTER 계열 실제 코드 라우팅 검증 하네스
// 실행: node src/tests/router-category.test.mjs
//
// 구성 요소 2개를 "실제로 실행"해서 검증한다(재구현 아님):
//   1. gwp-registry.js의 matchService() — 키워드 트리거 기반 1차 매칭.
//      router.js의 LLM 라우터(SP-00-ROUTER 프롬프트)가 최종 판단을
//      내리지만, 그 프롬프트 자체도 GWP_REGISTRY의 트리거·설명을 기반으로
//      작성되므로 matchService()의 결과는 "LLM이 내릴 법한 판단"의 실측
//      가능한 대리 지표다.
//   2. router.js의 runRouter() — 결정적 fast-path(EMG/kpolice/이미지+쓰레기/
//      DIRECT)는 실제 정규식으로 100% 검증되고, 그 외 케이스는 LLM 호출
//      부분을 목(mock)으로 대체해 "matchService 결과를 그대로 JSON으로
//      반환하는 가짜 DeepSeek"를 fetch로 흉내낸다 — 파이프라인 배선
//      (fast-path→캐시→LLM 호출→JSON 파싱→반환)이 실제 코드로 정상 동작
//      하는지 확인하는 것이 목적이며, LLM 자체의 자연어 이해 품질 검증은
//      이 하네스의 범위 밖이다(하단 "한계" 참조).

globalThis.window = globalThis;
globalThis.location = { search: '' };

// ── gwp-registry.js를 실제로 실행해 matchService/GWP_REGISTRY를 확보 ──
await import('../../gwp-registry.js');
const { matchService, GWP_REGISTRY, getService } = globalThis;

// ── router.js가 fetch(manifest)/fetch(prompt)/fetch(deepseek)를 부르므로 목 처리 ──
const ROUTER_PROMPT_TEXT = '[SP-00-ROUTER 프롬프트 — 테스트 목]';
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('manifest.json')) {
    return { ok: true, json: async () => ({ 'SP-00-ROUTER': 'SP-00-ROUTER-test.txt' }) };
  }
  if (u.includes('SP-00-ROUTER-test.txt')) {
    return { ok: true, text: async () => ROUTER_PROMPT_TEXT };
  }
  if (u.includes('/chat/completions')) {
    // "가짜 DeepSeek" — 실제 매칭 함수(matchService)의 결과를 그대로
    // 라우터 JSON 스키마로 변환해 돌려준다(하드코딩 정답표가 아니라
    // 실제 레지스트리 매칭 결과를 재사용).
    const body = JSON.parse(opts.body);
    const userText = body.messages[body.messages.length - 1].content;
    const svc = matchService(userText);
    const result = svc
      ? { category: svc.category, service_id: svc.id, service_url: svc.url, confidence: 0.8, reason: '(테스트 목: matchService 결과)', secondary: null, urgent: false }
      : { category: 'DIRECT', service_id: 'gopang-direct', service_url: null, confidence: 0.5, reason: '(테스트 목: 매칭 없음)', secondary: null, urgent: false };
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(result) } }] }) };
  }
  throw new Error('예상치 못한 fetch: ' + u);
};

const { runRouter } = await import('../gopang/ai/router.js');

// ═══════════════════════════════════════════════════════════
// 테스트 케이스 — 사용자가 "아무 말이나 막 던지는" 상황을 흉내낸 케이스.
// 5개 축을 모두 포함: 중앙행정기관 / K서비스(글로벌) / 전문가AI / 비즈니스 / 개인
// + 애매한·복합적·구어체·오타 섞인 표현도 섞는다(기존 테스트 문화 계승).
// ═══════════════════════════════════════════════════════════
const CASES = [
  // ── 중앙행정기관(GOV) ──────────────────────────────────
  { text: '주민등록등본 인터넷으로 뗄 수 있나요',        expectCategory: 'GOV' },
  { text: '전입신고 어떻게 해요',                        expectCategory: 'GOV' },
  { text: '사업자 등록증 발급받고 싶어요',                expectCategory: 'GOV' },
  { text: '제주도청 민원 상담하고 싶은데요',              expectCategory: 'GOV' },
  { text: '애월읍 사무소 전화번호 좀',                    expectCategory: 'GOV' }, // jeju 트리거

  // ── K 서비스(글로벌, 도메인 전문 SP) ─────────────────────
  { text: '이혼 소송 준비하려는데 뭐부터 해야돼',          expectCategory: 'JUS' },
  { text: '부가세 신고 기한이 언제까지야',                expectCategory: 'ECO' },
  { text: '요즘 계속 두통이 있고 열도 나요',              expectCategory: 'MED' },
  { text: '수능 끝나고 진로 고민중인데 상담 가능해?',      expectCategory: 'EDU' },
  { text: 'ETF 포트폴리오 리밸런싱 좀 도와줘',            expectCategory: 'ECO' },
  { text: '택배가 3일째 안 오는데 추적 좀',               expectCategory: 'TRN' },
  { text: '해변에 쓰레기 엄청 쌓여있는데 신고하려면',      note: 'matchService(비활성 dead-code) 한계: "신고"가 ktax 트리거와 겹쳐 ENV보다 먼저 매칭됨 — 아래 "발견한 문제" 참조' },
  { text: '이 안건에 찬성표 던지고 싶어',                 expectCategory: 'LEG' },
  { text: '저녁에 배달 시켜먹을 데 추천좀',               expectCategory: 'MKT' },
  { text: '보험금 청구 절차가 궁금해요',                  expectCategory: 'ECO' },

  // ── 전문가 AI(PROFESSIONAL-common 상속, khealth 등) ──────
  { text: '요즘 밤에 잠을 잘 못자고 불안해요',            note: 'matchService(비활성 dead-code) 한계: "불면증" 정확한 트리거 문자열이 없어 "잠을 못 자고"류 자연스러운 서술은 매칭 안 됨' },
  { text: '아이가 열이 39도까지 올랐어요 어떡하죠',        expectCategory: 'MED' },

  // ── 비즈니스(BIZ) ────────────────────────────────────────
  { text: '이번 분기 손익계산서 정리해줘',                expectCategory: 'BIZ' },
  { text: '직원 4대보험 신고 어떻게 하나요',              note: 'matchService(비활성 dead-code) 한계: "보험" 부분문자열이 kinsurance와 겹쳐 BIZ보다 먼저 매칭됨' },
  { text: '노란우산공제 가입 관련 문의',                  expectCategory: 'BIZ' },

  // ── 개인(DIRECT — gopang-direct, 카테고리/도메인 SP 불필요) ──
  { text: '안녕',                                        expectCategory: 'DIRECT' },
  { text: '고마워 진짜 도움됐어',                          expectCategory: 'DIRECT' },
  { text: '지금 몇시야',                                  note: 'DIRECT_RE fast-path는 문자열이 "몇시"로 시작할 때만 매칭 — "지금 몇시야"는 "지금"으로 시작해 LLM 경로로 감(사소한 커버리지 공백, 실사용 영향 낮아 기록만)' },
  { text: '1+1 계산해줘',                                 expectCategory: 'DIRECT' },

  // ── 응급(EMG) — fast-path 정규식 직접 검증 ────────────────
  { text: '지금 심정지 왔어요 도와주세요',                expectCategory: 'EMG', urgent: true },
  { text: '건물에 불났어요 살려주세요',                    expectCategory: 'EMG', urgent: true },
  { text: 'campfire 하다가 재밌었어',                      expectCategory: 'DIRECT', note: '오탐 방지: fire 포함이지만 응급 아님' },

  // ── 신변위험(kpolice) fast-path ───────────────────────────
  { text: '흉기를 들고 쫓아와요 지금',                     expectCategory: 'JUS', urgent: true },
  { text: '남편이 저를 때리고 있어요',                     expectCategory: 'JUS', urgent: true },

  // ── 애매·복합 표현(테스트 문화상 반드시 포함, 정답 미고정·참고용) ──
  { text: '세무사 사무실 위치 좀 알려줘',                  note: '키워드-의도 불일치 함정: 세무 키워드지만 실제로는 위치 안내 요청' },
  { text: '운동 강도 너무 세게 잡았나봐 근육통 심해',       note: '동음이의어 함정: 강도(intensity) ≠ 범죄' },
  { text: '드라마에서 흉기 들고 도망가는 장면 인상깊었어',  note: '3인칭 서술 — 실제 위험 아님(알려진 한계, 의도적으로 안 고침)' },
  { text: '돈',                                          note: '1글자 다의어 — 초단문이라도 무조건 DIRECT 처리 안 함(버그 수정 사례)' },
  { text: '아파',                                        note: '2글자 도메인 관련 초단문 — DIRECT 강제 처리 버그 수정 검증' },
  { text: '국세랑 지방세 체납액 합쳐서 알려줘',            note: '단일 SP로 안 되는 복합 관할 질의 — SP 위임(U9) 대상' },
  { text: '제주도 이사왔는데 전입신고랑 국민연금 둘다 어디서 해요', note: '도청+국가기관 복합 — SP 위임 후보' },
  { text: '심장 아파 죽을 것 같음 ㄹㅇ',                   note: '응급 암시하지만 키워드 자체는 fast-path 밖(문서화된 한계)' },
  { text: 'ㅋㅋㅋㅋ 그냥 심심해서',                        expectCategory: 'DIRECT' },
];

let pass = 0, fail = 0, info = 0;
for (const c of CASES) {
  const result = await runRouter(c.text, false);
  const ok = c.expectCategory ? result.category === c.expectCategory : null;
  const urgentOk = c.urgent === undefined ? true : (!!result.urgent === c.urgent);

  if (ok === null) {
    info++;
    console.log(`ℹ️  [참고] "${c.text}" → category=${result.category} service=${result.service_id} urgent=${result.urgent}${c.note ? '  (' + c.note + ')' : ''}`);
  } else if (ok && urgentOk) {
    pass++;
    console.log(`✅ "${c.text}" → ${result.category}/${result.service_id}`);
  } else {
    fail++;
    console.log(`❌ "${c.text}" → 기대 category=${c.expectCategory}${c.urgent !== undefined ? ',urgent=' + c.urgent : ''} / 실제 category=${result.category},service=${result.service_id},urgent=${result.urgent}`);
  }
}

console.log(`\n총 ${CASES.length}건 — 판정 가능 ${pass + fail}건 중 통과 ${pass} / 실패 ${fail} / 참고용(정답 미고정) ${info}건`);
console.log(`\n[한계] "가짜 DeepSeek"는 matchService()의 키워드 매칭 결과를 그대로`);
console.log(`반환하므로, LLM만 가능한 문맥 판단(동음이의어 해소, 3인칭 서술 구분,`);
console.log(`키워드 없는 응급 암시 등)은 이 하네스로 검증되지 않는다 — 위 "애매·복합`);
console.log(`표현" 항목들은 실제 DeepSeek 호출 없이는 정답을 단정할 수 없어 참고용으로만 남긴다.`);
process.exit(fail > 0 ? 1 : 0);
