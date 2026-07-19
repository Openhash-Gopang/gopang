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

describe('B3-2 — 전문가 세션 same-thread SP 전환', () => {
  test('세션 시작 시 CFG.system이 페르소나 합성 프롬프트로 교체되고 history는 유지됨', async () => {
    CFG.system = '[그림자 AI(AGENT-COMMON) 프롬프트]';
    CFG.system_base = CFG.system;
    history.length = 0;
    history.push({ role: 'system', content: CFG.system });
    history.push({ role: 'user', content: '이혼 소송 준비 중이에요' });

    const personaId = resolveExpertId('lawyer');
    assert.equal(personaId, 'lawyer');
    const def = { label: '변호사', icon: '⚖️', key: 'SP_lawyer', needsMedicalSafety: false };

    await startExpertSession(personaId, def);

    assert.equal(isExpertActive(), true);
    assert.equal(currentExpertLabel(), '⚖️ 변호사');
    assert.ok(CFG.system.includes('변호사 페르소나 SP 원문'), 'CFG.system이 페르소나 프롬프트로 안 바뀜');
    assert.ok(CFG.system.includes('UNIVERSAL-INTEGRITY 원문'), '페르소나 전환에도 UNIVERSAL-INTEGRITY 유지돼야 함');
    // 2026-07-19 신설 — U0/U1/U7("안내로 끝내지 않는다")과 전문가 정체성
    // 계층이 실제로 조립되는지 검증(2026-07-19 실사로 발견된 결함의 회귀 방지).
    assert.ok(CFG.system.includes('UNIVERSAL-common 원문'), 'UNIVERSAL-common(U0/U1/U7)이 조립에서 빠짐 — 회귀');
    assert.ok(CFG.system.includes('PROFESSIONAL-common 원문'), 'PROFESSIONAL-common(전문가 정체성 계층)이 조립에서 빠짐 — 회귀');
    // UNIVERSAL-INTEGRITY가 중복 삽입되지 않는지 검증(3중복 버그 회귀 방지).
    const uiCount = CFG.system.split('UNIVERSAL-INTEGRITY 원문').length - 1;
    assert.equal(uiCount, 1, `UNIVERSAL-INTEGRITY가 ${uiCount}회 삽입됨 — 정확히 1회여야 함(중복 버그 회귀)`);
    assert.equal(history[0].content, CFG.system, 'history[0](캐시된 system)도 함께 갱신돼야 함(캐시 최적화 우회)');
    assert.equal(history.length, 2, '기존 대화(history)가 유실되면 안 됨 — 같은 스레드 유지가 핵심');

    await endExpertSession('test_cleanup');
  });

  test('종료 발화 감지 시 세션 종료 + CFG.system이 system_base로 복원 + 이전 페르소나 잔존 없음', async () => {
    CFG.system = '[그림자 AI(AGENT-COMMON) 프롬프트]';
    CFG.system_base = CFG.system;
    history.length = 0;
    history.push({ role: 'system', content: CFG.system });

    const def = { label: '변호사', icon: '⚖️', key: 'SP_lawyer', needsMedicalSafety: false };
    await startExpertSession('lawyer', def);
    assert.equal(isExpertActive(), true);

    const ended = await maybeHandleExpertTurn('상담 끝났어, 그만할게');
    assert.equal(ended, true, '종료 발화인데 세션이 안 끝남');
    assert.equal(isExpertActive(), false, '세션 활성 플래그가 안 꺼짐(이전 페르소나 잔존)');
    assert.equal(currentExpertLabel(), null);
    assert.equal(CFG.system, '[그림자 AI(AGENT-COMMON) 프롬프트]', 'system_base로 정확히 복원 안 됨');
    assert.ok(!CFG.system.includes('변호사'), '이전 페르소나 프롬프트가 잔존함');
    assert.ok(recordedPdv, '세션 종료 시 PDV 기록(_recordPDV)이 호출돼야 함');
    assert.equal(recordedPdv.serviceId, 'lawyer');
  });

  test('종료 발화가 아니면 세션이 계속 유지됨(오탐 방지)', async () => {
    CFG.system = '[그림자 AI(AGENT-COMMON) 프롬프트]';
    CFG.system_base = CFG.system;
    const def = { label: '변호사', icon: '⚖️', key: 'SP_lawyer', needsMedicalSafety: false };
    await startExpertSession('lawyer', def);

    const ended = await maybeHandleExpertTurn('그럼 위자료는 어느 정도 받을 수 있을까요');
    assert.equal(ended, false);
    assert.equal(isExpertActive(), true, '무관한 발화로 세션이 조기 종료되면 안 됨');

    await endExpertSession('test_cleanup');
  });

  test('applyExpertSystemIfActive — 활성 세션의 system이 캐시에서 재적용됨(다른 곳이 system을 덮어써도 복구)', async () => {
    CFG.system = '[그림자 AI(AGENT-COMMON) 프롬프트]';
    CFG.system_base = CFG.system;
    const def = { label: '변호사', icon: '⚖️', key: 'SP_lawyer', needsMedicalSafety: false };
    await startExpertSession('lawyer', def);

    CFG.system = '[누군가 실수로 덮어씀]';
    const applied = applyExpertSystemIfActive();
    assert.equal(applied, true);
    assert.ok(CFG.system.includes('변호사 페르소나 SP 원문'), '캐시에서 재적용 안 됨');

    await endExpertSession('test_cleanup');
  });
});

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
});
