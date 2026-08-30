// expert-session-switch.test.mjs
// 실행: node --experimental-test-module-mocks --test src/tests/ai-secretary/expert-session-switch.test.mjs
//
// B3-2 — expert-session.js의 same-thread SP 전환(startExpertSession/
// maybeHandleExpertTurn/endExpertSession)이 실제로 CFG.system을 교체·
// 복원하는지, 이전 페르소나가 잔존하지 않는지 실행 기반으로 검증.
// B3-4 — manifest-loader.js의 _loadSpByKey()가 UNIVERSAL-INTEGRITY를
// 모든 SP 로드에 실제로 앞에 붙이는지(2026-07-12 수정) 회귀 검증.
// call-ai.js의 12개 로더(_loadAgentCommonSP~_loadKEstateSP)가 전부
// _loadSpByKey를 거친다는 것은 소스 grep으로 이미 확인했으나(구조
// 확인), 여기서는 _loadSpByKey 자체가 실제로 UNIVERSAL-INTEGRITY를
// 결합하는지 실행으로 재확인한다.

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.location = { search: '' };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.document = {
  addEventListener: () => {}, getElementById: () => null,
  createElement: () => ({}), querySelector: () => null,
};
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};

const SP_FILES = {
  'sp-catalog.json': JSON.stringify({
    'UNIVERSAL-INTEGRITY': 'UNIVERSAL-INTEGRITY_v1_0.md',
    'TASK-DELEGATION-GUIDE': 'TASK-DELEGATION-GUIDE_v1_0.md',
    // 2026-07-19 신설 — _composeExpertPrompt 조립 검증용(회귀 방지: 이 둘이
    // 목에 없어도 try/catch로 조용히 건너뛰어 테스트가 거짓 통과하던 문제를
    // 막기 위해 추가).
    'UNIVERSAL-common': 'UNIVERSAL-common_v1_0.md',
    'PROFESSIONAL-common': 'PROFESSIONAL-common_v1_0.md',
    'SP_common_guardrails': 'SP_common_guardrails_v1_0.md',
    'SP_lawyer': 'SP_lawyer_v4_1.txt',
  }),
  'UNIVERSAL-INTEGRITY_v1_0.md': '[UNIVERSAL-INTEGRITY 원문 — U0 제1공리]',
  'TASK-DELEGATION-GUIDE_v1_0.md': '[TASK-DELEGATION-GUIDE 원문]',
  'UNIVERSAL-common_v1_0.md': '[UNIVERSAL-common 원문 — U1 권한의 한계]',
  'PROFESSIONAL-common_v1_0.md': '[PROFESSIONAL-common 원문 — 전문가 사칭 금지]',
  'SP_common_guardrails_v1_0.md': '[공통 가드레일 원문]',
  'SP_lawyer_v4_1.txt': '[변호사 페르소나 SP 원문]',
};

globalThis.fetch = async (url) => {
  const u = String(url);
  const fname = u.split('/').pop();
  const content = SP_FILES[fname];
  if (content == null) return { ok: false, status: 404 };
  return { ok: true, text: async () => content, json: async () => JSON.parse(content) };
};

// _recordPDV/summarizeTranscript6W/_gwpLaunch는 네트워크·PDV 부작용이라 목 처리.
// 이 셋 다 expert-session.js가 import하는 대상이므로 mock.module로 대체.
let recordedPdv = null;
mock.module(new URL('../../gopang/pdv/record.js', import.meta.url), {
  namedExports: { _recordPDV: async (record) => { recordedPdv = record; return { ok: true }; } },
});
// 테스트별로 반환값을 바꿔 끼울 수 있도록 가변 변수를 mock 함수가 읽게 한다.
let handoffSummaryResult = null; // null이면 "요약 없음"(폴백) 시나리오
mock.module(new URL('../../gopang/ai/report-utils.js', import.meta.url), {
  namedExports: {
    summarizeTranscript6W: async () => ({ who: 'u', when: 't', where: 'w', what: '요약됨', how: 'h', why: 'y' }),
    // 2026-07-19 신설(핸드오프 맥락 요약)
    summarizeHandoffContext6W: async () => handoffSummaryResult,
  },
});
let lastGwpLaunchArgs = null;
mock.module(new URL('../../gopang/gwp/engine.js', import.meta.url), {
  namedExports: { _gwpLaunch: (...args) => { lastGwpLaunchArgs = args; } },
});

const { CFG } = await import(new URL('../../gopang/core/config.js', import.meta.url));
const { history } = await import(new URL('../../gopang/core/state.js', import.meta.url));
const {
  startExpertSession, endExpertSession, maybeHandleExpertTurn,
  isExpertActive, currentExpertLabel, applyExpertSystemIfActive,
  handleExpertTag,
} = await import(new URL('../../gopang/ai/expert-session.js', import.meta.url));
const { getExpertGwpDef, resolveExpertId } = await import(new URL('../../gopang/ai/expert-registry.js', import.meta.url));
const { _loadSpByKey } = await import(new URL('../../gopang/ai/manifest-loader.js', import.meta.url));

describe('B3-4 — UNIVERSAL-INTEGRITY 자동 상속 (_loadSpByKey)', () => {
  test('일반 SP 로드 시 UNIVERSAL-INTEGRITY + TASK-DELEGATION-GUIDE가 앞에 결합됨', async () => {
    const combined = await _loadSpByKey('SP_lawyer', '변호사');
    assert.ok(combined.includes('UNIVERSAL-INTEGRITY 원문'), 'UNIVERSAL-INTEGRITY 미결합 — 2026-07-12 수정 회귀');
    assert.ok(combined.includes('TASK-DELEGATION-GUIDE 원문'), 'TASK-DELEGATION-GUIDE 미결합 — 2026-07-17 수정 회귀');
    assert.ok(combined.includes('변호사 페르소나 SP 원문'), '본체 SP 자체가 빠짐');
    // 순서: UNIVERSAL-INTEGRITY → TASK-DELEGATION-GUIDE → 개별 SP
    const idxU = combined.indexOf('UNIVERSAL-INTEGRITY 원문');
    const idxT = combined.indexOf('TASK-DELEGATION-GUIDE 원문');
    const idxS = combined.indexOf('변호사 페르소나 SP 원문');
    assert.ok(idxU < idxT && idxT < idxS, `결합 순서 어긋남: U=${idxU}, T=${idxT}, S=${idxS}`);
  });

  test('UNIVERSAL-INTEGRITY 자기 자신을 로드할 땐 중복 결합 안 함(self-concat 방지)', async () => {
    const raw = await _loadSpByKey('UNIVERSAL-INTEGRITY', 'UNIVERSAL-INTEGRITY');
    assert.equal(raw, '[UNIVERSAL-INTEGRITY 원문 — U0 제1공리]');
  });
});

// ★ 2026-08-30 제거 — 아래 있던 'B3-2 — 전문가 세션 same-thread SP 전환'
// describe 블록(startExpertSession/isExpertActive/maybeHandleExpertTurn/
// applyExpertSystemIfActive/endExpertSession 검증)을 삭제했다. 이
// same-thread 세션 서브시스템은 2026-07-03부터 아무도 호출하지 않는
// 죽은 코드였음이 2026-08-06 감사로 확인되어 src/_archive/
// expert-session-legacy-inthread.js.md로 코드와 근거를 통째로 이관됐다
// (expert-session.js 최상단 ARCHITECTURE NOTE 참고 — 전문가 AI는 이제
// 새 탭(pages/expert-chat.html)에서 독립 실행되고, handleExpertTag가
// 그 라우팅을 담당한다). startExpertSession 등은 현재 모듈에 아예
// export돼 있지 않아 "TypeError: startExpertSession is not a
// function"으로 매번 실패하고 있었음 — 코드 결함이 아니라 삭제된
// 기능을 계속 테스트하고 있었던 것. 부활이 필요하면 위 archive 파일과
// 함께 이 테스트도 git 이력에서 복원하면 된다.

describe('2026-07-19 신설 — handleExpertTag 핸드오프 맥락 전달', () => {
  test('AC와의 이전 대화가 없으면 이번 발화 원문만 그대로 전달됨(하위호환)', async () => {
    history.length = 0;
    history.push({ role: 'system', content: '[그림자 AI(AGENT-COMMON) 프롬프트]' });
    lastGwpLaunchArgs = null;
    handoffSummaryResult = { party: '무시됨', situation: '무시됨', already_done: '', goal: '' };

    const handled = await handleExpertTag('[EXPERT: lawyer]', '소장 좀 써주세요', null);

    assert.equal(handled, true);
    assert.ok(lastGwpLaunchArgs, '_gwpLaunch가 호출되지 않음');
    assert.equal(lastGwpLaunchArgs[1], '소장 좀 써주세요',
      '이전 대화가 없을 땐 이번 발화 원문 그대로여야 함(요약 블록이 섞이면 안 됨)');
  });

  test('AC와의 이전 대화가 있으면 요약 블록 + 이번 발화 원문 순으로 합쳐짐', async () => {
    history.length = 0;
    history.push({ role: 'system', content: '[그림자 AI(AGENT-COMMON) 프롬프트]' });
    history.push({ role: 'user', content: '임차인이 보증금을 안 돌려줘요' });
    history.push({ role: 'assistant', content: '언제 계약이 만료됐나요?' });
    history.push({ role: 'user', content: '두 달 전에 만료됐고 내용증명도 보냈어요' });
    lastGwpLaunchArgs = null;
    handoffSummaryResult = {
      party: '임대인(사용자)-임차인 관계, 사용자는 보증금 반환 채권자',
      situation: '임대차 계약 만료 2개월 경과, 보증금 미반환',
      already_done: '내용증명 발송함',
      goal: '보증금 반환',
    };

    const handled = await handleExpertTag('[EXPERT: lawyer]', '소장 써주세요', null);

    assert.equal(handled, true);
    assert.ok(lastGwpLaunchArgs, '_gwpLaunch가 호출되지 않음');
    const ctx = lastGwpLaunchArgs[1];
    assert.ok(ctx.includes('내용증명 발송함'), '이전 대화에서 확인된 사실(이미 진행된 절차)이 누락됨');
    assert.ok(ctx.includes('보증금 반환'), '이전 대화에서 확인된 목표가 누락됨');
    assert.ok(ctx.endsWith('[이번 발화]\n소장 써주세요'),
      '이번 발화 원문이 요약 블록 뒤에 손대지 않은 채로 붙어 있어야 함(AGENT-COMMON "원문 그대로" 규약)');
  });

  test('요약 실패(null 반환) 시 이번 발화 원문만으로 폴백됨', async () => {
    history.length = 0;
    history.push({ role: 'system', content: '[그림자 AI(AGENT-COMMON) 프롬프트]' });
    history.push({ role: 'user', content: '이혼하고 싶어요' });
    history.push({ role: 'assistant', content: '혼인 기간이 얼마나 되셨나요?' });
    lastGwpLaunchArgs = null;
    handoffSummaryResult = null; // 요약 실패 시뮬레이션

    const handled = await handleExpertTag('[EXPERT: lawyer]', '5년이요', null);

    assert.equal(handled, true);
    assert.equal(lastGwpLaunchArgs[1], '5년이요',
      '요약 실패 시 기존 동작(이번 발화만 전달)으로 정확히 폴백해야 함');
  });

  // 2026-07-19 신설 — 사고실험으로 발견된 결함(위험 신호가 4항목 요약
  // 압축 과정에서 순화·희석될 수 있음) 수정 검증.
  test('위험 신호(risk_signals)는 4항목 요약과 별개로 원문 그대로, 눈에 띄게 보존됨', async () => {
    history.length = 0;
    history.push({ role: 'system', content: '[그림자 AI(AGENT-COMMON) 프롬프트]' });
    history.push({ role: 'user', content: '이 동네로 이사 갈까 고민 중이에요' });
    history.push({ role: 'assistant', content: '어느 지역인가요?' });
    history.push({ role: 'user', content: '강남역 근처요, 근데 사실 전 여자친구가 거기 사는데 티 안 나게 알아보고 싶어요' });
    lastGwpLaunchArgs = null;
    handoffSummaryResult = {
      party: '', situation: '강남역 근처 이사 검토', already_done: '', goal: '지역 정보 확인',
      risk_signals: '전 여자친구가 거기 사는데 티 안 나게 알아보고 싶어요',
    };

    const handled = await handleExpertTag('[EXPERT: real-estate-agent]', '시세 좀 알아봐 주세요', null);

    assert.equal(handled, true);
    const ctx = lastGwpLaunchArgs[1];
    assert.ok(ctx.includes('⚠️'), '위험 신호 블록이 시각적으로 구분돼야 함');
    assert.ok(ctx.includes('전 여자친구가 거기 사는데 티 안 나게 알아보고 싶어요'),
      '위험 신호 발화가 순화되지 않고 원문 그대로 보존돼야 함');
    assert.ok(ctx.includes('판단은 당신의 몫'),
      '요약자가 위험 여부를 대신 판단하지 않고 페르소나에게 넘긴다는 원칙이 명시돼야 함');
  });

  test('4항목이 전부 비어도 risk_signals만 있으면 핸드오프 블록이 생성됨', async () => {
    history.length = 0;
    history.push({ role: 'system', content: '[그림자 AI(AGENT-COMMON) 프롬프트]' });
    history.push({ role: 'user', content: '몰래 좀 알아봐줘' });
    lastGwpLaunchArgs = null;
    handoffSummaryResult = {
      party: '', situation: '', already_done: '', goal: '',
      risk_signals: '몰래 좀 알아봐줘',
    };

    const handled = await handleExpertTag('[EXPERT: real-estate-agent]', '알아봐주세요', null);

    assert.equal(handled, true);
    const ctx = lastGwpLaunchArgs[1];
    assert.ok(ctx.includes('몰래 좀 알아봐줘'),
      '다른 4항목이 비어 있어도 risk_signals 하나만으로 핸드오프 블록이 생성돼야 함');
  });
});
