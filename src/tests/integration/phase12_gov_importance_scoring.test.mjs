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
