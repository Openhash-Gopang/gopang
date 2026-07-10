/**
 * pdv/procedure-docs.js — 절차별 필요서류 정의 및 진행상황 추적
 *
 * 2026-07-09 신설 — Web Share Target으로 받은 문서를 실제 절차(개인파산
 * 등)의 필요서류와 연결하는 계층. atom_rows의 court-filing 레코드가
 * 이미 정의한 required_docs(파산·면책신청서/진술서/채권자목록/재산목록/
 * 수입및지출목록)를 클라이언트에서도 참조할 수 있게 복사해뒀다 —
 * atom_rows는 L1(PocketBase) 서버 데이터라 클라이언트가 오프라인/사전
 * 로드 없이 즉시 참조할 상수가 필요했다. ★ 서버 쪽 court-filing 레코드가
 * 나중에 바뀌면 이 상수도 같이 갱신해야 한다는 걸 명시해둔다(단일
 * 진실공급원 아님 — 알려진 한계).
 */

// atom_rows의 court-filing.required_docs와 동일(2026-07-08 시딩 데이터 기준)
export const BANKRUPTCY_REQUIRED_DOCS = [
  '파산·면책신청서',
  '진술서',
  '채권자목록',
  '재산목록',
  '수입및지출목록',
];

export const PROCEDURE_REQUIRED_DOCS = {
  'court-filing': BANKRUPTCY_REQUIRED_DOCS,
};

// 문서명 → 매칭용 키워드(파일명/제목/공유텍스트에 이 키워드가 있으면
// 그 문서로 추정한다). 어디까지나 "추정"이라 항상 사람 확인을 거친다
// (guessDocumentMatch는 결정을 내리지 않고 후보만 제시).
const _MATCH_KEYWORDS = {
  '파산·면책신청서': ['파산', '면책신청'],
  '진술서': ['진술서'],
  '채권자목록': ['채권자'],
  '재산목록': ['재산목록', '재산 목록'],
  '수입및지출목록': ['수입', '지출', '소득'],
  // 정부24에서 흔히 오는 문서 — court-filing 자체보다 그 하위 증빙
  '가족관계증명서': ['가족관계증명서', '가족관계'],
  '주민등록등본': ['주민등록등본', '등본'],
};

/**
 * 공유받은 문서(파일명/제목/텍스트)로 필요서류 후보를 추정한다.
 * 절대 자동 확정하지 않는다 — 항상 사람 확인용 후보 목록만 반환.
 * @param {{filename?: string, title?: string, text?: string}} doc
 * @param {string[]} requiredDocs - 후보를 좁힐 필요서류 목록(예: BANKRUPTCY_REQUIRED_DOCS)
 * @returns {string[]} 매칭된 필요서류 라벨 목록(매칭 안 되면 빈 배열)
 */
export function guessDocumentMatch(doc, requiredDocs) {
  const haystack = [doc.filename, doc.title, doc.text].filter(Boolean).join(' ');
  if (!haystack) return [];
  const matched = [];
  for (const label of requiredDocs) {
    const keywords = _MATCH_KEYWORDS[label] || [label];
    if (keywords.some(kw => haystack.includes(kw))) matched.push(label);
  }
  return matched;
}

const _STORAGE_KEY_PREFIX = 'hondi_procedure_progress_';

function _getStorage(opts) {
  return opts?.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
}

/**
 * 절차의 진행상황(어떤 필요서류가 제공됐는지)을 읽는다.
 * @returns {{procedureId: string, provided: Record<string,{ts:number, sourceTitle?:string}>}}
 */
export function getProcedureProgress(procedureId, opts = {}) {
  const storage = _getStorage(opts);
  if (!storage) return { procedureId, provided: {} };
  try {
    const raw = storage.getItem(_STORAGE_KEY_PREFIX + procedureId);
    const provided = raw ? JSON.parse(raw) : {};
    return { procedureId, provided };
  } catch {
    return { procedureId, provided: {} };
  }
}

/**
 * 필요서류 하나가 제공됐음을 기록한다. 사람이 확인을 마친 뒤에만
 * 호출해야 한다(guessDocumentMatch의 추정만으로 자동 호출 금지).
 */
export function markDocumentProvided(procedureId, docLabel, meta = {}, opts = {}) {
  const storage = _getStorage(opts);
  if (!storage) return false;
  const { provided } = getProcedureProgress(procedureId, opts);
  provided[docLabel] = { ts: Date.now(), ...meta };
  try {
    storage.setItem(_STORAGE_KEY_PREFIX + procedureId, JSON.stringify(provided));
    return true;
  } catch {
    return false;
  }
}

/**
 * 아직 제공 안 된 필요서류 목록(다음에 뭘 더 받아야 하는지).
 */
export function getMissingDocuments(procedureId, opts = {}) {
  const required = PROCEDURE_REQUIRED_DOCS[procedureId] || [];
  const { provided } = getProcedureProgress(procedureId, opts);
  return required.filter(label => !provided[label]);
}
