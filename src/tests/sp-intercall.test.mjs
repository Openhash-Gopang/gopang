// SP-INTERCALL 오케스트레이션 실제 코드 검증 하네스
// worker.js를 그대로 import해서 실제 handleGovRelay 경로를 통과시킨다
// (재구현이 아니라 실행 결과로 검증 — 기존 라우팅 검증과 동일한 방식).
import worker from '../../worker.js';

// ── DeepSeek 응답 스크립트 ────────────────────────────────
// 시나리오별로 순서대로 소비되는 응답 큐. agency 호출과 상관없이
// 실제 코드가 몇 번, 어떤 순서로 fetch(DEEPSEEK_URL, ...)를 호출하는지
// 그대로 관찰한다.
let deepseekQueue = [];
let deepseekCallLog = [];

const PROMPT_FILES = {
  'UNIVERSAL-INTEGRITY_v1_0.md': '[UNIVERSAL-INTEGRITY 텍스트]',
  'UNIVERSAL-common_v1_1.md':    '[UNIVERSAL-common v1.1 텍스트 — U9 포함]',
  'K-Public_common_v1_3.md':     '[K-Public_common 텍스트]',
  'PROFESSIONAL-common_v1_0.md': '[PROFESSIONAL-common 텍스트]',
  'sp-catalog.json': JSON.stringify({ 'SP-04_khealth': 'SP-04_khealth_v2.1.txt' }),
  'SP-04_khealth_v2.1.txt': '[K-Health SP 텍스트]',
  'JEJU-DO-SP_v1.0.md':       '[제주도청 총괄 SP 텍스트 — JEJU-GOV-COMMON 포함]',
  'JEJU-NATIONAL-SP_v1.0.md': '[제주 국가기관 총괄 SP 텍스트 — JEJU-GOV-COMMON 포함]',
};

global.fetch = async (url, opts = {}) => {
  const u = String(url);

  if (u.includes('api.deepseek.com')) {
    const body = JSON.parse(opts.body);
    deepseekCallLog.push({ model: body.model, lastMsg: body.messages[body.messages.length - 1] });
    const next = deepseekQueue.shift();
    if (!next) throw new Error('deepseekQueue 고갈 — 예상보다 LLM 호출이 많음(무한루프 의심)');
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: next } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    };
  }

  if (u.includes('raw.githubusercontent.com')) {
    const fname = u.split('/').pop();
    const content = PROMPT_FILES[fname];
    if (content == null) return { ok: false, status: 404 };
    return { ok: true, text: async () => content, json: async () => JSON.parse(content) };
  }

  throw new Error('예상치 못한 fetch 대상: ' + u);
};

function makeEnv() { return { DEEPSEEK_API_KEY: 'test-key' }; } // KV 미설정 → 과금은 0으로 처리(정상)

function makeRequest(payload) {
  return new Request('https://worker.example/gov/relay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': 'https://public.hondi.net' },
    body: JSON.stringify(payload),
  });
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}`); }
  else { fail++; console.log(`❌ ${name} — ${detail || ''}`); }
}

async function run(name, queue, payload) {
  deepseekQueue = [...queue];
  deepseekCallLog = [];
  const res = await worker.fetch(makeRequest(payload), makeEnv(), { waitUntil: (p) => p.catch(() => {}) });
  const data = await res.json();
  return { res, data, calls: deepseekCallLog, leftoverQueue: deepseekQueue.length };
}

// ═══════════════════════════════════════════════════════════
// 시나리오 1 — 정상 위임: public → jeju_national → 최종 합성 (LLM 3회)
// ═══════════════════════════════════════════════════════════
{
  const { data, calls } = await run('정상 위임', [
    JSON.stringify({ sp_call: { target: 'jeju_national', purpose: '국세 확인', query: '국세 체납액 확인' } }), // 1차: 위임 요청
    '국세 체납 조회는 홈택스 연동이 필요합니다.',                                                              // 2차: 위임 대상(jeju_national) 답변
    '제주 소재 국가기관 확인 결과, 국세는 홈택스에서 확인 필요합니다. 지방세는 0원입니다.',                     // 3차: 원 SP 최종 합성
  ], { guid: 'u1', agency: 'public', agencyPrompt: '[도청 SP]', messages: [{ role: 'user', content: '국세랑 지방세 체납액 합쳐서 알려줘' }], stream: false });

  check('LLM 호출 정확히 3회', calls.length === 3, `실제 ${calls.length}회`);
  check('2번째 호출이 위임 대상(jeju_national) 프롬프트 기반', calls[1]?.lastMsg?.content === '국세 체납액 확인');
  check('최종 응답에 위임 결과가 반영됨', data.choices[0].message.content.includes('홈택스'));
  check('최종 응답에 출처 문구 포함(U9-5 취지)', data.choices[0].message.content.includes('국가기관'));
}

// ═══════════════════════════════════════════════════════════
// 시나리오 2 — 순환 감지: public이 자기 자신(public)에게 위임 시도 → 거부
// ═══════════════════════════════════════════════════════════
{
  const { data, calls } = await run('순환(자기 자신 위임) 거부', [
    JSON.stringify({ sp_call: { target: 'public', purpose: '자기참조', query: 'x' } }), // 1차: 순환 시도
    '죄송합니다, 문의하신 내용은 관련 기관에 직접 확인하시는 것을 권장드립니다.',        // 2차: 거부 후 마무리
  ], { guid: 'u2', agency: 'public', agencyPrompt: '[도청 SP]', messages: [{ role: 'user', content: 'x' }], stream: false });

  check('순환 감지 시 LLM 호출 2회로 종료(대상 서브 호출 없음)', calls.length === 2, `실제 ${calls.length}회`);
  check('2번째 호출 프롬프트에 CYCLE_DETECTED 사유 포함',
    calls[1]?.lastMsg?.content?.includes('CYCLE_DETECTED'));
  check('클라이언트에는 정상 응답(에러 아님) 반환', !!data.choices?.[0]?.message?.content);
}

// ═══════════════════════════════════════════════════════════
// 시나리오 3 — 미등록 대상: 존재하지 않는 target으로 위임 시도 → 거부
// ═══════════════════════════════════════════════════════════
{
  const { calls } = await run('미등록 대상 거부', [
    JSON.stringify({ sp_call: { target: 'made_up_agency', purpose: 'x', query: 'y' } }),
    '알겠습니다, 가진 정보로만 답변드립니다.',
  ], { guid: 'u3', agency: 'jeju_do', agencyPrompt: '[도청]', messages: [{ role: 'user', content: 'x' }], stream: false });

  check('미등록 대상 거부 시 LLM 호출 2회로 종료', calls.length === 2, `실제 ${calls.length}회`);
  check('거부 사유가 TARGET_NOT_REGISTERED', calls[1]?.lastMsg?.content?.includes('TARGET_NOT_REGISTERED'));
}

// ═══════════════════════════════════════════════════════════
// 시나리오 4 — 재위임 시도 방어: 위임 대상 답변이 규칙을 어기고 또 sp_call을
// 내놓아도 서버가 절대 재귀하지 않고 raw text로 그대로 흡수해야 한다.
// ═══════════════════════════════════════════════════════════
{
  const { data, calls } = await run('위임 대상의 재위임 시도 무시', [
    JSON.stringify({ sp_call: { target: 'jeju_national', purpose: 'x', query: 'y' } }),      // 1차: 정상 위임
    JSON.stringify({ sp_call: { target: 'health', purpose: '재위임시도', query: 'z' } }),     // 2차: 위임 대상이 규칙 위반 시도
    '위임 대상의 응답을 있는 그대로 반영한 최종 답변입니다.',                                  // 3차: 원 SP 최종 합성
  ], { guid: 'u4', agency: 'public', agencyPrompt: '[도청]', messages: [{ role: 'user', content: 'x' }], stream: false });

  check('재위임 시도가 있어도 LLM 호출 정확히 3회(4회 이상으로 번지지 않음)', calls.length === 3, `실제 ${calls.length}회`);
  check('원 SP가 받은 위임 결과 텍스트에 재위임 JSON 원문이 그대로 포함(무시하고 흡수됨)',
    calls[2]?.lastMsg?.content?.includes('sp_call'));
}

// ═══════════════════════════════════════════════════════════
// 시나리오 5 — 최종 안전망: 최종 합성 호출조차 sp_call을 내놓으면
// 정형화된 안내 문구로 강제 치환(재귀 절대 없음).
// ═══════════════════════════════════════════════════════════
{
  const { data, calls } = await run('최종 합성 단계 안전망', [
    JSON.stringify({ sp_call: { target: 'jeju_national', purpose: 'x', query: 'y' } }),
    '위임 대상 정상 답변',
    JSON.stringify({ sp_call: { target: 'health', purpose: '또시도', query: 'z' } }), // 최종 합성조차 규칙 위반
  ], { guid: 'u5', agency: 'public', agencyPrompt: '[도청]', messages: [{ role: 'user', content: 'x' }], stream: false });

  check('최종 안전망 발동 시에도 LLM 호출 3회로 종료', calls.length === 3, `실제 ${calls.length}회`);
  check('클라이언트에 원문 JSON이 새지 않고 안내 문구로 치환됨',
    !data.choices[0].message.content.includes('sp_call'));
}

// ═══════════════════════════════════════════════════════════
// 시나리오 6 — 위임 불가 agency(원래 GOV_AGENCIES이지만 originator 아님)는
// sp_call을 출력해도 위임 로직 자체가 발동하지 않아야 한다(파일럿 범위 제한).
// ═══════════════════════════════════════════════════════════
{
  const { data, calls } = await run('비-originator agency는 위임 발동 안 함', [
    JSON.stringify({ sp_call: { target: 'jeju_national', purpose: 'x', query: 'y' } }), // health는 originator가 아니므로 이 텍스트가 그대로 최종 응답이 되어야 함
  ], { guid: 'u6', agency: 'health', agencyPrompt: '[K-Health]', messages: [{ role: 'user', content: 'x' }], stream: false });

  check('비-originator는 LLM 호출 1회로 종료(위임 오케스트레이션 미발동)', calls.length === 1, `실제 ${calls.length}회`);
  check('sp_call JSON이 그대로(가공 없이) 반환됨 — 파일럿 범위 제한 확인용',
    data.choices[0].message.content.includes('sp_call'));
}

// ═══════════════════════════════════════════════════════════
// 시나리오 7 — 실사용 사례 A: jeju_do(도청, 지방세 담당)가 국세 정보가
// 필요해 jeju_national(국가기관)에 위임. jeju-router.test.mjs에서
// "국세랑 지방세 체납액 합쳐서 알려줘"가 배타적 분기 때문에 도청 트리
// 하나만 선택되는 걸 실측한 뒤, 그 한계를 메우는 실제 위임 흐름을 검증.
// ═══════════════════════════════════════════════════════════
{
  const { data, calls } = await run('실사용 A: 도청→국가기관(국세) 위임', [
    JSON.stringify({ sp_call: { target: 'jeju_national', purpose: '국세 체납액 확인', query: '국세 체납액이 얼마인지 확인해줘' } }),
    '국세 체납 조회는 홈택스 로그인 후 "나의 세금 조회"에서 확인 가능합니다. Hondi와는 아직 직접 연동돼 있지 않습니다.',
    '지방세(취득세·재산세) 체납액은 0원으로 확인됩니다. 국세는 제주세무서(국가기관) 확인 결과, 홈택스에서 직접 조회하셔야 합니다 — 두 세목은 관할이 달라 따로 안내드립니다.',
  ], { guid: 'jeju1', agency: 'jeju_do', agencyPrompt: '[SP-DO-PLAN — 지방세 담당]', messages: [{ role: 'user', content: '국세랑 지방세 체납액 합쳐서 알려줘' }], stream: false });

  check('실사용 A: LLM 호출 3회(판단/위임대상/최종합성)', calls.length === 3, `실제 ${calls.length}회`);
  check('실사용 A: 최종 답변에 지방세+국세 정보 모두 포함', data.choices[0].message.content.includes('지방세') && data.choices[0].message.content.includes('국세'));
  check('실사용 A: 출처(국가기관) 명시', data.choices[0].message.content.includes('국가기관'));
}

// ═══════════════════════════════════════════════════════════
// 시나리오 8 — 실사용 사례 B: 역방향 — jeju_national(국가기관, 국민연금
// 담당)이 전입신고 정보가 필요해 jeju_do(도청)에 위임. "중앙 행정기관
// SP가 제주 지방정부 SP를 호출하거나, 그 역도 가능"이라는 요구사항의
// 양방향성을 실제로 검증(시나리오 7과 반대 방향).
// ═══════════════════════════════════════════════════════════
{
  const { data, calls } = await run('실사용 B: 국가기관→도청(전입신고) 위임', [
    JSON.stringify({ sp_call: { target: 'jeju_do', purpose: '전입신고 절차 확인', query: '제주 전입신고는 어디서 어떻게 하나요' } }),
    '전입신고는 관할 읍면동 주민센터 방문 또는 정부24 온라인으로 가능합니다.',
    '국민연금 가입은 저희(국민연금공단 제주지역본부)에서 안내드리며, 전입신고는 제주도청 확인 결과 읍면동 주민센터 방문 또는 정부24로 가능합니다.',
  ], { guid: 'jeju2', agency: 'jeju_national', agencyPrompt: '[SP-NAT-NPS — 국민연금 담당]', messages: [{ role: 'user', content: '전입신고랑 국민연금 가입 둘 다 어디서 처리하나요' }], stream: false });

  check('실사용 B: LLM 호출 3회', calls.length === 3, `실제 ${calls.length}회`);
  check('실사용 B: 위임 방향이 역방향(국가기관→도청)으로 정상 작동', calls[1]?.lastMsg?.content === '제주 전입신고는 어디서 어떻게 하나요');
  check('실사용 B: 최종 답변에 도청 확인 결과 반영', data.choices[0].message.content.includes('도청'));
}

console.log(`\n총 ${pass + fail}개 검증 — 통과 ${pass} / 실패 ${fail}`);
process.exit(fail > 0 ? 1 : 0);
