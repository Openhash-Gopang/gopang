/**
 * phase12_gov_importance_scoring.test.mjs
 *
 * "오픈해시 철학과 GWP 수준의 보안을 동시에 달성하려면?" 논의의 1단계 —
 * 대화 중요도 점수 함수(_estimateGovImportance/_selectGovVerificationMode)
 * 검증. 아직 어떤 라이브 경로에도 연결되지 않은 순수 함수라 call-ai.js의
 * 무거운 브라우저 의존성(window/document/location) 없이, 실제 소스에서
 * 해당 블록만 추출해 격리 테스트한다 — phase11의 loadStripFns()와 동일한
 * 방식(재구현 아님, 실제 배포 코드 원문을 그대로 실행).
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

const IMPORTANCE_MOCK = { LIGHTWEIGHT_MAX: 25, STANDARD_MAX: 60 };

function loadGovImportanceFns() {
  const raw = readFileSync(path.join(REPO_ROOT, 'src/gopang/ai/call-ai.js'), 'utf-8');
  const src = raw.replace(/\r\n/g, '\n'); // CRLF 안전화(N-13/14와 동일 이유)

  const startMarker = 'export const GOV_VERIFICATION_MODE = Object.freeze({';
  const endMarker = 'export function _selectGovVerificationMode(score) {';
  const startIdx = src.indexOf(startMarker);
  assert.ok(startIdx !== -1, 'GOV_VERIFICATION_MODE 블록을 call-ai.js에서 찾지 못함 — 이름이 바뀌었나?');
  const endFnStart = src.indexOf(endMarker, startIdx);
  assert.ok(endFnStart !== -1, '_selectGovVerificationMode를 call-ai.js에서 찾지 못함');
  // 함수 본문 끝(첫 줄 닫는 '}\n')까지 포함해서 잘라낸다.
  const afterEndFnStart = src.slice(endFnStart);
  const closeIdx = afterEndFnStart.indexOf('\n}\n');
  assert.ok(closeIdx !== -1, '_selectGovVerificationMode 닫는 괄호를 찾지 못함');
  const block = src.slice(startIdx, endFnStart + closeIdx + '\n}\n'.length);

  const body = `
    const IMPORTANCE = __IMPORTANCE__;
    let getService = __getService__;
    ${block.replace(/^export /gm, '')}
    return { GOV_VERIFICATION_MODE, _estimateGovImportance, _selectGovVerificationMode };
  `;
  // eslint-disable-next-line no-new-func
  const factory = new Function('__IMPORTANCE__', '__getService__', body);
  return factory;
}

describe('N-17: _estimateGovImportance / _selectGovVerificationMode', () => {
  const factory = loadGovImportanceFns();

  function makeGetService(registry) {
    return (id) => registry[id] || null;
  }

  it('응급 트리거 포함 시 무조건 100점 — 다른 계산 전부 생략', () => {
    const { _estimateGovImportance } = factory(IMPORTANCE_MOCK, makeGetService({
      kemergency: { id: 'kemergency', category: 'EMG', triggers: ['화재', '살려줘', '119'] },
    }));
    assert.equal(_estimateGovImportance('지금 불났어요 살려줘', null), 100);
    assert.equal(_estimateGovImportance('아무 관련 없는 말인데 119는 아님', { category: 'UTL' }), 100,
      '트리거 키워드가 포함되면 gwpEntry와 무관하게 100점이어야 함');
  });

  it('GWP 미매칭 일반 잡담 — 기본 가중치로 낮은 점수', () => {
    const { _estimateGovImportance, _selectGovVerificationMode } = factory(IMPORTANCE_MOCK, makeGetService({}));
    const score = _estimateGovImportance('오늘 날씨 어때', null);
    assert.ok(score < IMPORTANCE_MOCK.LIGHTWEIGHT_MAX, `기본 잡담은 LIGHTWEIGHT 미만이어야 함(실제 ${score})`);
    assert.equal(_selectGovVerificationMode(score), 'LIGHTWEIGHT');
  });

  it('GOV 카테고리 + 처분성 키워드 + 위임대상 agency — ENHANCED 등급', () => {
    const { _estimateGovImportance, _selectGovVerificationMode } = factory(IMPORTANCE_MOCK, makeGetService({}));
    const score = _estimateGovImportance('전입신고 접수 확정해주세요', { id: 'jeju_do', category: 'GOV' });
    assert.ok(score >= IMPORTANCE_MOCK.STANDARD_MAX, `GOV+처분성+위임대상 조합은 ENHANCED여야 함(실제 ${score})`);
    assert.equal(_selectGovVerificationMode(score), 'ENHANCED');
  });

  it('GOV 카테고리지만 처분성 키워드 없음 — STANDARD 등급 근처(중간)', () => {
    const { _estimateGovImportance, _selectGovVerificationMode } = factory(IMPORTANCE_MOCK, makeGetService({}));
    const score = _estimateGovImportance('제주도청 조직이 어떻게 되나요', { id: 'jeju', category: 'GOV' });
    assert.ok(score >= IMPORTANCE_MOCK.LIGHTWEIGHT_MAX, `순수 정보성 GOV 질의도 최소 STANDARD는 돼야 함(실제 ${score})`);
    assert.notEqual(_selectGovVerificationMode(score), 'ENHANCED',
      '처분성·위임신호 없는 단순 조직 안내 질문까지 ENHANCED로 과도 분류되면 안 됨');
  });

  it('TOOL/UTL 카테고리 — 처분성 키워드 있어도 낮게 유지(도구성 서비스는 원래 저위험)', () => {
    const { _estimateGovImportance } = factory(IMPORTANCE_MOCK, makeGetService({}));
    const score = _estimateGovImportance('검색 결과 확정해줘', { id: 'ksearch', category: 'UTL' });
    // 처분성 키워드가 걸려도(0.3 가중치) 카테고리 가중치가 낮아 ENHANCED까지는 안 감
    assert.ok(score < IMPORTANCE_MOCK.STANDARD_MAX, `UTL 카테고리는 ENHANCED까지 안 가야 함(실제 ${score})`);
  });

  it('점수 범위는 항상 0~100 (formula 검산)', () => {
    const { _estimateGovImportance } = factory(IMPORTANCE_MOCK, makeGetService({}));
    const cases = [
      [null, null], ['', null], ['확정 승인 발급 접수 신청서 제출 과세 처분 허가', { id: 'public', category: 'GOV' }],
    ];
    for (const [text, entry] of cases) {
      const score = _estimateGovImportance(text, entry);
      assert.ok(score >= 0 && score <= 100, `범위 밖 점수: ${score}`);
    }
  });

  it('selectMode 임계값 경계값 확인(IMPORTANCE.LIGHTWEIGHT_MAX/STANDARD_MAX 그대로 재사용)', () => {
    const { _selectGovVerificationMode } = factory(IMPORTANCE_MOCK, makeGetService({}));
    assert.equal(_selectGovVerificationMode(24.9), 'LIGHTWEIGHT');
    assert.equal(_selectGovVerificationMode(25), 'STANDARD');
    assert.equal(_selectGovVerificationMode(59.9), 'STANDARD');
    assert.equal(_selectGovVerificationMode(60), 'ENHANCED');
  });
});

// ══════════════════════════════════════════════════════════════════
// N-18: 2단계(해시 앵커링) — _sha256Hex 순수함수 검증 + _anchorGovChain
// 구조 일관성 검증(브라우저/동적임포트 의존이 커서 전체 동작 테스트는
// p2p-chat.js _saveP2PSession()도 마찬가지로 기존에 없음 — 같은 기준
// 적용. 대신 소스 자체를 규칙 기반으로 검사해 오타·경로착오를 잡는다 —
// IMPORTANCE import 경로를 한 번 잘못 썼다가 잡았던 전례가 있어 특히
// import 경로는 반드시 검사한다).
// ══════════════════════════════════════════════════════════════════
describe('N-18: _sha256Hex 및 _anchorGovChain 구조 검증', () => {
  const raw = readFileSync(path.join(REPO_ROOT, 'src/gopang/ai/call-ai.js'), 'utf-8').replace(/\r\n/g, '\n');

  it('_sha256Hex — 알려진 SHA-256 벡터와 일치(빈 문자열, "abc")', async () => {
    const fnMatch = raw.match(/async function _sha256Hex\(text\) \{[\s\S]*?\n\}\n/);
    assert.ok(fnMatch, '_sha256Hex를 call-ai.js에서 찾지 못함');
    const body = fnMatch[0].replace('async function', 'return async function') + 'return _sha256Hex;\n';
    // eslint-disable-next-line no-new-func
    const _sha256Hex = new Function(body.replace('return async function _sha256Hex', 'const _sha256Hex = async function'))();
    const emptyHash = await _sha256Hex('');
    assert.equal(emptyHash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      '빈 문자열의 SHA-256 표준값과 불일치');
    const abcHash = await _sha256Hex('abc');
    assert.equal(abcHash, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      '"abc"의 SHA-256 표준값과 불일치');
  });

  it('_anchorGovChain — hashChain.js를 올바른 상대경로로 import함(src/gopang/ai/ 기준)', () => {
    assert.match(raw, /await import\('\.\.\/\.\.\/openhash\/hashChain\.js'\)/,
      '경로가 틀리면(예: ../core/constants.js 사례처럼) 조용히 런타임에만 실패한다 — 반드시 정적으로 검사');
  });

  it('_anchorGovChain — anchor()를 lcat/score 포함 5개 인자로 호출함(PLSM 계층분포 연동)', () => {
    assert.match(raw, /anchor\(contentHash,\s*\[userSig\],\s*msgId,\s*'gov_chat',\s*score\)/,
      'score를 안 넘기면 plsm.js selectLayer()가 폴백 단일분포로 빠져 이번 신설의 핵심(중요도 기반 계층분포)이 무의미해짐');
  });

  it('_anchorGovChain — 원문(userText/fullReply)을 앵커 envelope에 직접 포함하지 않음(PDV §5 원칙)', () => {
    const fnMatch = raw.match(/async function _anchorGovChain\([\s\S]*?\n\}\n/);
    assert.ok(fnMatch, '_anchorGovChain을 call-ai.js에서 찾지 못함');
    const body = fnMatch[0];
    const envelopeMatch = body.match(/const envelope = \{[\s\S]*?\};/);
    assert.ok(envelopeMatch, 'envelope 객체를 찾지 못함');
    assert.ok(!/userText\s*,|fullReply\s*,|content:\s*userText|content:\s*fullReply/.test(envelopeMatch[0]),
      'envelope에 원문이 그대로 들어가면 PDV 원칙(원문 아닌 해시만 저장) 위반');
    assert.match(envelopeMatch[0], /userTextHash/);
    assert.match(envelopeMatch[0], /replyHash/);
  });

  it('_anchorGovChain — 게스트(비등록, _USER.ipv6 없음)는 앵커링을 생략함', () => {
    const fnMatch = raw.match(/async function _anchorGovChain\([\s\S]*?\n\}\n/);
    assert.match(fnMatch[0], /if \(!_USER\?\.ipv6\) return;/,
      '서명 주체 없이 앵커링을 시도하면 안 됨');
  });

  it('_anchorGovChain — 실패해도 채팅 흐름을 막지 않음(호출부가 .catch로 감싸져 있음)', () => {
    assert.match(raw, /_anchorGovChain\(userText, fullReply\)\.catch\(/,
      'await로 직접 기다리면 앵커링 실패/지연이 사용자 응답을 막게 됨 — fire-and-forget이어야 함');
  });
});

// ══════════════════════════════════════════════════════════════════
// N-19: 3단계(동적 UNIVERSAL-INTEGRITY 주입) — _buildUniversalIntegrityContext
// 실제 동작 검증. _estimateGovImportance/IMPORTANCE/_loadSpByKey를 함께
// 추출해 결합, mock _loadSpByKey로 실제 게이트 로직(점수 임계값 통과 시만
// 로드+주입)을 끝까지 실행해본다.
// ══════════════════════════════════════════════════════════════════
function loadUniversalIntegrityFn() {
  const raw = readFileSync(path.join(REPO_ROOT, 'src/gopang/ai/call-ai.js'), 'utf-8').replace(/\r\n/g, '\n');

  const scoringStart = raw.indexOf('export const GOV_VERIFICATION_MODE = Object.freeze({');
  assert.ok(scoringStart !== -1);
  const selectModeStart = raw.indexOf('export function _selectGovVerificationMode(score) {', scoringStart);
  const selectModeBodyEnd = raw.indexOf('\n}\n', selectModeStart) + '\n}\n'.length;
  const scoringBlock = raw.slice(scoringStart, selectModeBodyEnd);

  const uiStart = raw.indexOf('let _universalIntegrityCache = null;');
  assert.ok(uiStart !== -1, '_universalIntegrityCache를 찾지 못함');
  const uiFnStart = raw.indexOf('async function _buildUniversalIntegrityContext(userText) {', uiStart);
  const uiFnEnd = raw.indexOf('\n}\n', uiFnStart) + '\n}\n'.length;
  const uiBlock = raw.slice(uiStart, uiFnEnd);

  const body = `
    const IMPORTANCE = __IMPORTANCE__;
    let getService = __getService__;
    let _loadSpByKey = __loadSpByKey__;
    ${scoringBlock.replace(/^export /gm, '')}
    ${uiBlock}
    return { _buildUniversalIntegrityContext, _estimateGovImportance };
  `;
  // eslint-disable-next-line no-new-func
  return new Function('__IMPORTANCE__', '__getService__', '__loadSpByKey__', body);
}

describe('N-19: _buildUniversalIntegrityContext — 점수 게이트 기반 동적 주입', () => {
  const factory = loadUniversalIntegrityFn();

  it('처분성 키워드 없는 일반 잡담 — 주입 안 함(빈 문자열)', async () => {
    let loadCalls = 0;
    const { _buildUniversalIntegrityContext } = factory(
      IMPORTANCE_MOCK, () => null,
      async () => { loadCalls++; return '[UNIVERSAL-INTEGRITY 본문]'; },
    );
    const result = await _buildUniversalIntegrityContext('오늘 날씨 어때');
    assert.equal(result, '');
    assert.equal(loadCalls, 0, '점수 미달인데 fetch를 시도하면 안 됨(불필요한 네트워크 호출)');
  });

  it('처분성 키워드 있음 — UNIVERSAL-INTEGRITY 본문을 포함해 블록으로 반환', async () => {
    const { _buildUniversalIntegrityContext } = factory(
      IMPORTANCE_MOCK, () => null,
      async () => '[UNIVERSAL-INTEGRITY 본문 원문]',
    );
    const result = await _buildUniversalIntegrityContext('전입신고 접수 확정해주세요');
    assert.match(result, /\[UNIVERSAL-INTEGRITY 참고/);
    assert.match(result, /\[UNIVERSAL-INTEGRITY 본문 원문\]/);
    assert.match(result, /\]\s*$/, '블록이 대괄호로 닫혀야 함(HONDI-FAQ와 동일한 감싸기 규칙)');
  });

  it('응급 신호 — 처분성 키워드 없어도 주입됨(응급은 항상 최고 점수)', async () => {
    const { _buildUniversalIntegrityContext } = factory(
      IMPORTANCE_MOCK,
      (id) => id === 'kemergency' ? { id: 'kemergency', triggers: ['살려줘', '화재'] } : null,
      async () => '[UNIVERSAL-INTEGRITY 본문]',
    );
    const result = await _buildUniversalIntegrityContext('지금 화재 났어요 살려줘');
    assert.notEqual(result, '');
  });

  it('같은 세션에서 두 번째 호출부터는 캐시 재사용 — fetch 1회만', async () => {
    let loadCalls = 0;
    const { _buildUniversalIntegrityContext } = factory(
      IMPORTANCE_MOCK, () => null,
      async () => { loadCalls++; return '[본문]'; },
    );
    await _buildUniversalIntegrityContext('신청서 제출 확정');
    await _buildUniversalIntegrityContext('과세 처분 관련 문의');
    assert.equal(loadCalls, 1, 'UNIVERSAL-INTEGRITY는 세션당 1회만 fetch해야 함(AGENT-COMMON 캐싱과 동일 원칙)');
  });

  it('로드 실패 시 예외를 던지지 않고 빈 문자열로 조용히 무시', async () => {
    const { _buildUniversalIntegrityContext } = factory(
      IMPORTANCE_MOCK, () => null,
      async () => { throw new Error('네트워크 오류(시뮬레이션)'); },
    );
    const result = await _buildUniversalIntegrityContext('신청서 제출 확정');
    assert.equal(result, '', '로드 실패가 채팅 흐름을 막으면 안 됨');
  });
});

describe('N-20: _buildUniversalIntegrityContext가 실제로 ctxBlock 조립에 연결됐는지(정적 검사)', () => {
  const raw = readFileSync(path.join(REPO_ROOT, 'src/gopang/ai/call-ai.js'), 'utf-8').replace(/\r\n/g, '\n');

  it('_buildEnhancedUserContent 안에서 integrityBlock을 계산하고 ctxBlock에 포함시킴', () => {
    assert.match(raw, /const integrityBlock = await _buildUniversalIntegrityContext\(plainText\);/);
    assert.match(raw, /const ctxBlock = integrityBlock \+ shareBlock \+ firstContact \+ faqBlock/,
      'integrityBlock이 조립 순서 맨 앞이어야 함(§U5 — 판단원칙이 정체성보다 먼저 와야 한다는 UNIVERSAL-INTEGRITY 자신의 설계 원칙)');
  });

  it('gwpEntry는 항상 null로 호출 — matchService() 재도입 방지(2026-07-05 제거 결정 존중)', () => {
    assert.match(raw, /_estimateGovImportance\(userText, null\);/,
      '사전 판단 시점엔 [GWP:] 태그가 없어 카테고리를 알 수 없다 — 키워드로 추정하면 죽은 코드였던 matchService()를 되살리는 셈');
  });
});
