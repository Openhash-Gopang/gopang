/**
 * phase18_procedure_docs.test.mjs
 *
 * "정부24 공유문서 → 개인파산 court-filing 필요서류 연결" 완성 검증.
 * src/gopang/pdv/procedure-docs.js(순수 ESM, 바로 import)와 call-ai.js의
 * _buildShareInboxContext/_processShareDocTags(CRLF-safe 추출 방식,
 * phase11/12/13과 동일 패턴)를 함께 검증한다.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  BANKRUPTCY_REQUIRED_DOCS, PROCEDURE_REQUIRED_DOCS,
  guessDocumentMatch, getProcedureProgress, markDocumentProvided, getMissingDocuments,
} from '../../gopang/pdv/procedure-docs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

function makeMockStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

describe('N-52: BANKRUPTCY_REQUIRED_DOCS — atom_rows court-filing과 동일한 5개', () => {
  it('atom_rows 시딩 데이터(2026-07-08)와 정확히 일치', () => {
    assert.deepEqual(BANKRUPTCY_REQUIRED_DOCS, [
      '파산·면책신청서', '진술서', '채권자목록', '재산목록', '수입및지출목록',
    ]);
  });

  it('PROCEDURE_REQUIRED_DOCS에 court-filing 키로 등록됨', () => {
    assert.equal(PROCEDURE_REQUIRED_DOCS['court-filing'], BANKRUPTCY_REQUIRED_DOCS);
  });
});

describe('N-53: guessDocumentMatch — 추정만 하고 절대 확정하지 않음', () => {
  it('파일명에 "채권자"가 있으면 채권자목록으로 추정', () => {
    const matches = guessDocumentMatch({ filename: '채권자목록_2026.pdf' }, BANKRUPTCY_REQUIRED_DOCS);
    assert.deepEqual(matches, ['채권자목록']);
  });

  it('제목/공유텍스트도 매칭 대상(파일명만 보지 않음)', () => {
    const matches = guessDocumentMatch({ filename: 'doc.pdf', title: '재산목록 작성본' }, BANKRUPTCY_REQUIRED_DOCS);
    assert.deepEqual(matches, ['재산목록']);
  });

  it('매칭 안 되면 빈 배열(단정하지 않음)', () => {
    const matches = guessDocumentMatch({ filename: '완전히무관한파일.pdf' }, BANKRUPTCY_REQUIRED_DOCS);
    assert.deepEqual(matches, []);
  });

  it('여러 필요서류에 동시에 매칭될 수도 있음(수입및지출목록의 "소득" 키워드 등)', () => {
    const matches = guessDocumentMatch({ filename: '소득증빙.pdf' }, BANKRUPTCY_REQUIRED_DOCS);
    assert.ok(matches.includes('수입및지출목록'));
  });

  it('정부24 흔한 문서(가족관계증명서/등본)도 매칭 키워드에 등록돼 있음', () => {
    const requiredPlus = [...BANKRUPTCY_REQUIRED_DOCS, '가족관계증명서', '주민등록등본'];
    assert.deepEqual(guessDocumentMatch({ filename: '가족관계증명서.pdf' }, requiredPlus), ['가족관계증명서']);
    assert.deepEqual(guessDocumentMatch({ filename: '주민등록등본_발급.pdf' }, requiredPlus), ['주민등록등본']);
  });

  it('doc에 아무 텍스트도 없으면(filename/title/text 전부 없음) 빈 배열', () => {
    assert.deepEqual(guessDocumentMatch({}, BANKRUPTCY_REQUIRED_DOCS), []);
  });
});

describe('N-54: getProcedureProgress/markDocumentProvided/getMissingDocuments — 진행상황 추적', () => {
  it('처음엔 진행상황이 비어있음', () => {
    const storage = makeMockStorage();
    const progress = getProcedureProgress('court-filing', { storage });
    assert.deepEqual(progress.provided, {});
  });

  it('markDocumentProvided 이후 getProcedureProgress에 반영됨', () => {
    const storage = makeMockStorage();
    markDocumentProvided('court-filing', '채권자목록', { filename: 'a.pdf' }, { storage });
    const progress = getProcedureProgress('court-filing', { storage });
    assert.ok(progress.provided['채권자목록']);
    assert.equal(progress.provided['채권자목록'].filename, 'a.pdf');
    assert.ok(typeof progress.provided['채권자목록'].ts === 'number');
  });

  it('getMissingDocuments — 제공 안 된 것만 남음', () => {
    const storage = makeMockStorage();
    markDocumentProvided('court-filing', '채권자목록', {}, { storage });
    markDocumentProvided('court-filing', '재산목록', {}, { storage });
    const missing = getMissingDocuments('court-filing', { storage });
    assert.deepEqual(missing, ['파산·면책신청서', '진술서', '수입및지출목록']);
  });

  it('5개 전부 제공하면 missing이 빈 배열', () => {
    const storage = makeMockStorage();
    for (const label of BANKRUPTCY_REQUIRED_DOCS) markDocumentProvided('court-filing', label, {}, { storage });
    assert.deepEqual(getMissingDocuments('court-filing', { storage }), []);
  });

  it('storage 없으면(예: 서버사이드) 에러 없이 안전하게 빈 값 반환', () => {
    assert.deepEqual(getProcedureProgress('court-filing', { storage: null }), { procedureId: 'court-filing', provided: {} });
    assert.equal(markDocumentProvided('court-filing', 'x', {}, { storage: null }), false);
  });
});

// ── call-ai.js 함수 추출(CRLF-safe, phase11/12/13과 동일 패턴) ──────
function loadShareContextFns() {
  const raw = readFileSync(path.join(REPO_ROOT, 'src/gopang/ai/call-ai.js'), 'utf-8').replace(/\r\n/g, '\n');

  const buildStart = raw.indexOf('export function _buildShareInboxContext() {');
  assert.ok(buildStart !== -1, '_buildShareInboxContext를 call-ai.js에서 찾지 못함');
  const buildEnd = raw.indexOf('\n}\n', buildStart) + '\n}\n'.length;
  const buildBlock = raw.slice(buildStart, buildEnd).replace('export function', 'function');

  const processStart = raw.indexOf('export async function _processShareDocTags(fullReply, deps = {}) {');
  assert.ok(processStart !== -1, '_processShareDocTags를 call-ai.js에서 찾지 못함');
  const processEnd = raw.indexOf('\n}\n', processStart) + '\n}\n'.length;
  const processBlock = raw.slice(processStart, processEnd).replace('export async function', 'async function');

  const body = `
    let sessionStorage = __sessionStorage__;
    let console = __console__;
    ${buildBlock}
    ${processBlock}
    return { _buildShareInboxContext, _processShareDocTags };
  `;
  // eslint-disable-next-line no-new-func
  return new Function('__sessionStorage__', '__console__', body);
}

function makeMockSessionStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

const silentConsole = { log: () => {}, warn: () => {}, info: () => {} };

describe('N-55: _buildShareInboxContext — 대기중 공유문서가 있을 때만 주입', () => {
  it('hondi_share_pending 없으면 빈 문자열', () => {
    const factory = loadShareContextFns();
    const { _buildShareInboxContext } = factory(makeMockSessionStorage(), silentConsole);
    assert.equal(_buildShareInboxContext(), '');
  });

  it('대기중이면 파일명과 추정후보를 포함한 SHARE_DOC_PENDING 태그 생성', () => {
    const pending = { filename: '채권자목록.pdf', guesses: ['채권자목록'], procedureId: 'court-filing' };
    const factory = loadShareContextFns();
    const { _buildShareInboxContext } = factory(
      makeMockSessionStorage({ hondi_share_pending: JSON.stringify(pending) }), silentConsole,
    );
    const ctx = _buildShareInboxContext();
    assert.match(ctx, /채권자목록\.pdf/);
    assert.match(ctx, /채권자목록.*가능성/);
    assert.match(ctx, /절대 임의로 단정하지 마세요/, '추정은 AI가 확정하면 안 됨을 명시해야 함');
    assert.match(ctx, /SHARE_DOC_CONFIRMED/);
    assert.match(ctx, /SHARE_DOC_REJECTED/);
  });

  it('추정 후보가 없으면 "짐작할 단서가 부족" 문구로 대체', () => {
    const pending = { filename: '알수없는파일.pdf', guesses: [], procedureId: 'court-filing' };
    const factory = loadShareContextFns();
    const { _buildShareInboxContext } = factory(
      makeMockSessionStorage({ hondi_share_pending: JSON.stringify(pending) }), silentConsole,
    );
    assert.match(_buildShareInboxContext(), /단서가 부족/);
  });

  it('sessionStorage 값이 깨진 JSON이어도 예외 없이 빈 문자열', () => {
    const factory = loadShareContextFns();
    const { _buildShareInboxContext } = factory(
      makeMockSessionStorage({ hondi_share_pending: '{{{broken' }), silentConsole,
    );
    assert.equal(_buildShareInboxContext(), '');
  });
});

describe('N-56: _processShareDocTags — 사람 확답 이후에만 기록(핵심 원칙)', () => {
  it('SHARE_DOC_CONFIRMED 태그가 있으면 markDocumentProvided 호출됨(주입된 mock 확인)', async () => {
    const pending = { id: 'share-1', filename: '채권자목록.pdf', title: '', procedureId: 'court-filing' };
    const sessionStorage = makeMockSessionStorage({ hondi_share_pending: JSON.stringify(pending) });
    const factory = loadShareContextFns();
    const { _processShareDocTags } = factory(sessionStorage, silentConsole);

    let markedLabel = null, clearedId = null;
    await _processShareDocTags('확인했습니다. [SHARE_DOC_CONFIRMED:채권자목록]', {
      procedureDocsModule: { markDocumentProvided: (procId, label) => { markedLabel = label; } },
      shareInboxModule: { clearSharedDocument: async (id) => { clearedId = id; } },
    });

    assert.equal(markedLabel, '채권자목록');
    assert.equal(clearedId, 'share-1');
    assert.equal(sessionStorage.getItem('hondi_share_pending'), null, '처리 후 pending 플래그는 지워져야 함');
  });

  it('SHARE_DOC_REJECTED면 markDocumentProvided를 호출하지 않음(기록 안 함)', async () => {
    const pending = { id: 'share-2', filename: '무관한파일.pdf', procedureId: 'court-filing' };
    const sessionStorage = makeMockSessionStorage({ hondi_share_pending: JSON.stringify(pending) });
    const factory = loadShareContextFns();
    const { _processShareDocTags } = factory(sessionStorage, silentConsole);

    let markCalled = false, clearedId = null;
    await _processShareDocTags('이건 관련 없는 문서네요. [SHARE_DOC_REJECTED]', {
      procedureDocsModule: { markDocumentProvided: () => { markCalled = true; } },
      shareInboxModule: { clearSharedDocument: async (id) => { clearedId = id; } },
    });

    assert.equal(markCalled, false, '거부됐는데 기록하면 절대 안 됨');
    assert.equal(clearedId, 'share-2', '거부돼도 인박스 항목은 정리해야 함(계속 안 쌓이게)');
  });

  it('태그가 아예 없으면 아무 것도 안 함(조기 반환)', async () => {
    const sessionStorage = makeMockSessionStorage({ hondi_share_pending: JSON.stringify({ id: 'x' }) });
    const factory = loadShareContextFns();
    const { _processShareDocTags } = factory(sessionStorage, silentConsole);

    let called = false;
    await _processShareDocTags('그냥 일반 답변입니다', {
      procedureDocsModule: { markDocumentProvided: () => { called = true; } },
      shareInboxModule: { clearSharedDocument: async () => { called = true; } },
    });
    assert.equal(called, false);
    assert.ok(sessionStorage.getItem('hondi_share_pending'), '태그 없으면 pending도 안 지워져야 함(다음 턴에 계속 물어봄)');
  });

  it('pending이 없는데 태그만 왔으면(비정상 상황) 조용히 무시', async () => {
    const sessionStorage = makeMockSessionStorage({}); // pending 없음
    const factory = loadShareContextFns();
    const { _processShareDocTags } = factory(sessionStorage, silentConsole);
    // 예외 없이 끝나야 함
    await _processShareDocTags('[SHARE_DOC_CONFIRMED:채권자목록]', {
      procedureDocsModule: { markDocumentProvided: () => { throw new Error('호출되면 안 됨'); } },
      shareInboxModule: { clearSharedDocument: async () => {} },
    });
  });
});

describe('N-57: 태그 스트리핑 — 최종 화면 텍스트에서 SHARE_DOC 태그가 제거되는지(정적 검사)', () => {
  it('SHARE_DOC_PENDING/CONFIRMED/REJECTED 전부 strip 정규식에 등록됨', () => {
    const raw = readFileSync(path.join(REPO_ROOT, 'src/gopang/ai/call-ai.js'), 'utf-8').replace(/\r\n/g, '\n');
    assert.match(raw, /\\\[SHARE_DOC_PENDING:/);
    assert.match(raw, /\\\[SHARE_DOC_CONFIRMED:/);
    assert.match(raw, /\\\[SHARE_DOC_REJECTED\\\]/);
  });
});
