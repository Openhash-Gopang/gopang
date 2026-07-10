/**
 * phase20_document_handoff.test.mjs
 *
 * "내 이력서와 등본 두 통을 모모 기업에 보내줘" 사고실험(원래 "불가능"
 * 판정, 3중 벽 중 마지막 하나)을 다룬다. share-inbox.js(Web Share
 * Target — 수신)의 반대 방향인 document-handoff.js(Web Share API —
 * 전달)를 검증한다. Node에 navigator가 없으므로 mock을 주입한다.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  canShareFiles, shareDocumentsToApp, toShareableFile, buildShareableBundle,
  RESUME_MATCH_KEYWORDS,
} from '../../gopang/pdv/document-handoff.js';
import { DOCUMENT_SOURCES, guessDocumentMatch } from '../../gopang/pdv/procedure-docs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function makeMockNav({ hasShare = true, hasCanShare = true, canShareResult = true, shareImpl = null } = {}) {
  const nav = {};
  if (hasShare) nav.share = shareImpl || (async () => {});
  if (hasCanShare) nav.canShare = () => canShareResult;
  return nav;
}

describe('N-69: canShareFiles — 파일 공유 지원 여부 확인(기능감지)', () => {
  it('navigator.share와 canShare 둘 다 있고 canShare가 true면 지원', () => {
    const nav = makeMockNav({ canShareResult: true });
    assert.equal(canShareFiles([new File(['x'], 'a.pdf')], { nav }), true);
  });

  it('navigator.share가 아예 없으면 미지원', () => {
    const nav = makeMockNav({ hasShare: false });
    assert.equal(canShareFiles([], { nav }), false);
  });

  it('navigator.canShare가 없으면(있어도 파일 지원 여부를 확인 못하니) 안전하게 미지원 처리', () => {
    const nav = makeMockNav({ hasCanShare: false });
    assert.equal(canShareFiles([new File(['x'], 'a.pdf')], { nav }), false);
  });

  it('canShare가 false를 반환하면 미지원', () => {
    const nav = makeMockNav({ canShareResult: false });
    assert.equal(canShareFiles([new File(['x'], 'a.pdf')], { nav }), false);
  });

  it('canShare 호출이 예외를 던져도(브라우저 버그 등) 안전하게 false', () => {
    const nav = { share: async () => {}, canShare: () => { throw new Error('boom'); } };
    assert.equal(canShareFiles([new File(['x'], 'a.pdf')], { nav }), false);
  });
});

describe('N-70: shareDocumentsToApp — 실제 전달 시도(항상 사람이 마지막 버튼을 누름)', () => {
  it('정상 지원 환경에서 navigator.share가 파일과 함께 정확히 호출됨', async () => {
    let capturedArgs = null;
    const nav = makeMockNav({ shareImpl: async (args) => { capturedArgs = args; } });
    const files = [new File(['x'], '등본.pdf', { type: 'application/pdf' })];
    const result = await shareDocumentsToApp(files, { title: '제출 서류', text: '등본입니다', nav });
    assert.equal(result.ok, true);
    assert.equal(capturedArgs.files, files);
    assert.equal(capturedArgs.title, '제출 서류');
  });

  it('파일이 없으면 시도조차 안 하고 NO_FILES', async () => {
    const nav = makeMockNav();
    const result = await shareDocumentsToApp([], { nav });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'NO_FILES');
  });

  it('브라우저가 파일공유 미지원이면 UNSUPPORTED(호출부가 다운로드 등 폴백 결정 가능하게)', async () => {
    const nav = makeMockNav({ hasCanShare: false });
    const files = [new File(['x'], 'a.pdf')];
    const result = await shareDocumentsToApp(files, { nav });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'UNSUPPORTED');
  });

  it('사용자가 공유시트에서 취소하면(AbortError) 에러 아니라 CANCELLED로 조용히 구분', async () => {
    const nav = makeMockNav({
      shareImpl: async () => { const e = new Error('cancelled'); e.name = 'AbortError'; throw e; },
    });
    const files = [new File(['x'], 'a.pdf')];
    const result = await shareDocumentsToApp(files, { nav });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'CANCELLED');
  });

  it('진짜 실패(다른 에러)는 FAILED로 구분하고 메시지도 담음', async () => {
    const nav = makeMockNav({ shareImpl: async () => { throw new Error('진짜 실패'); } });
    const files = [new File(['x'], 'a.pdf')];
    const result = await shareDocumentsToApp(files, { nav });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'FAILED');
    assert.equal(result.message, '진짜 실패');
  });

  it('★ 이 함수는 "회사에 전송 완료"를 절대 보장하지 않는다 — ok:true는 공유시트 호출 성공일 뿐, 실제 발송은 사용자가 다음 앱에서 완료해야 함(구조 검사)', () => {
    // shareDocumentsToApp의 성공 응답에 "전송완료"/"발송완료" 같은 확정적 문구가
    // 없어야 한다 — 반환값 자체가 그런 과장을 하지 않는지 소스로 확인.
    const raw = readFileSync(path.resolve(__dirname, '../../gopang/pdv/document-handoff.js'), 'utf-8');
    const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/전송\s*완료|발송\s*완료|보내짐|전달됨(?!\.)/.test(codeOnly),
      '실제 코드(주석 제외)에 "전송완료"를 단정하는 문구가 있으면 안 됨');
  });
});

describe('N-71: toShareableFile/buildShareableBundle — share-inbox.js 결과를 File로 변환', () => {
  it('toShareableFile — blob/filename/mimeType으로 File 객체 생성', () => {
    const blob = new Blob(['content'], { type: 'application/pdf' });
    const file = toShareableFile({ blob, filename: '등본.pdf', mimeType: 'application/pdf' });
    assert.ok(file instanceof File);
    assert.equal(file.name, '등본.pdf');
    assert.equal(file.type, 'application/pdf');
  });

  it('filename이 없으면 기본값 "document"로', () => {
    const file = toShareableFile({ blob: new Blob(['x']), mimeType: 'application/pdf' });
    assert.equal(file.name, 'document');
  });

  it('buildShareableBundle — 여러 문서(등본+이력서)를 한번에 File[]로 묶음', () => {
    const docs = [
      { blob: new Blob(['a']), filename: '등본.pdf', mimeType: 'application/pdf' },
      { blob: new Blob(['b']), filename: '이력서.pdf', mimeType: 'application/pdf' },
    ];
    const bundle = buildShareableBundle(docs);
    assert.equal(bundle.length, 2);
    assert.equal(bundle[0].name, '등본.pdf');
    assert.equal(bundle[1].name, '이력서.pdf');
  });

  it('아직 안 받은 문서(blob 없음)는 조용히 제외 — 준비 안 된 걸 억지로 보내지 않음', () => {
    const docs = [
      { blob: new Blob(['a']), filename: '등본.pdf' },
      null, // 이력서를 아직 안 받음
      { filename: '이상한거' }, // blob 없음
    ];
    const bundle = buildShareableBundle(docs);
    assert.equal(bundle.length, 1);
    assert.equal(bundle[0].name, '등본.pdf');
  });

  it('빈 배열/undefined 입력도 안전하게 빈 배열 반환', () => {
    assert.deepEqual(buildShareableBundle([]), []);
    assert.deepEqual(buildShareableBundle(undefined), []);
  });
});

describe('N-72: 이력서 문서 소스 등록(procedure-docs.js 연동)', () => {
  it("DOCUMENT_SOURCES['이력서'] — source는 user-upload, AI가 대신 작성 안 한다고 명시", () => {
    const g = DOCUMENT_SOURCES['이력서'];
    assert.equal(g.source, 'user-upload');
    assert.match(g.guidance, /대신 작성해드리지는 않습니다/);
  });

  it('guessDocumentMatch가 "이력서.pdf" 파일명을 정확히 매칭', () => {
    const matches = guessDocumentMatch({ filename: '이력서_2026.pdf' }, ['이력서', '주민등록등본']);
    assert.deepEqual(matches, ['이력서']);
  });

  it('RESUME_MATCH_KEYWORDS와 procedure-docs.js의 키워드가 일관됨(최소 "이력서" 공통 포함)', () => {
    assert.ok(RESUME_MATCH_KEYWORDS.includes('이력서'));
  });

  it('주민등록등본은 이미 등록돼 있음(오늘 앞선 작업에서 완료 — 이 사고실험의 절반은 이미 풀려 있었음)', () => {
    const g = DOCUMENT_SOURCES['주민등록등본'];
    assert.equal(g.source, 'gov24');
  });
});
