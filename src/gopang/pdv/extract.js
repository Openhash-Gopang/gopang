/**
 * pdv/extract.js — PDV 과거 상호작용 요약으로부터 구조화 필드 추출
 *
 * 2026-07-09 신설 — "PDV는 과거 상호작용 요약으로부터 고정 필드를 가진
 * 테이블을 추출한다. 그게 PDV의 주된 용도"라는 정정을 반영. 지금까지
 * pdv-store.js(list/listByCategory)는 원본 요약 텍스트를 그대로 돌려줄
 * 뿐, 거기서 "월소득 250만원" 같은 구조화 필드를 뽑아내는 계층이 없었다
 * — 이 파일이 그 계층이다.
 *
 * ★ 핵심 원칙(_buildPDVNote의 "추측 금지" 주석과 동일) — 기록에 명시적
 * 근거가 없는 필드는 절대 채우지 않는다. LLM이 그럴듯하게 지어낼 위험이
 * 있어서, 매 필드마다 confidence(high/low/unknown)와 evidence(근거 원문)
 * 를 강제로 같이 받고, 호출부는 반드시 사람에게 확인받게 만든다
 * (formatFieldsForConfirmation).
 *
 * PDV 원본이 클라이언트 IndexedDB에만 있다는 원칙(2026-07-05 확정,
 * supabase_to_l1_migration_plan.md) 그대로 — 이 추출도 클라이언트에서
 * 일어난다. LLM 호출 자체는 이 파일이 하지 않고 callLLMFn을 주입받는다
 * (call-ai.js의 _callLLM 등을 그대로 재사용 가능하게, 순환 의존 없이).
 */

const _EXTRACT_MAX_RECORDS = 200; // 프롬프트 크기 제한(오래된 기록은 자연히 밀려남 — list()가 최신순 아님에 주의, 아래 slice(-N)로 최신 N건만)

function _formatRecordsForPrompt(records) {
  return records
    .filter(r => r && (r.summary || r.what))
    .slice(-_EXTRACT_MAX_RECORDS)
    .map(r => {
      const date = r.ts ? new Date(r.ts).toISOString().slice(0, 10) : '날짜미상';
      return `- [${date}] ${r.summary || r.what}`;
    })
    .join('\n');
}

function _buildExtractPrompt(fieldSpecs, recordsText) {
  const fieldList = fieldSpecs.map(f => `- ${f.key} (${f.label}): ${f.hint || ''}`).join('\n');
  return `다음은 사용자의 과거 서비스 이용 기록 요약입니다(PDV — Personal Data Vault):

${recordsText || '(기록 없음)'}

위 기록에서 아래 항목들을 추출하세요. 기록에 명시적으로 근거가 있는 경우에만 값을 채우고, 근거가 없으면 반드시 value를 null로, confidence를 "unknown"으로 두세요. 추측하거나 지어내지 마세요.

${fieldList}

JSON 배열로만 응답하세요(다른 텍스트 없이):
[{"key":"필드키","value":값 또는 null,"confidence":"high"|"low"|"unknown","evidence":"근거가 된 기록 원문 일부 또는 null"}]`;
}

function _emptyResult(fieldSpecs) {
  return fieldSpecs.map(f => ({ key: f.key, value: null, confidence: 'unknown', evidence: null }));
}

/**
 * @param {Array<{key:string, label:string, hint?:string}>} fieldSpecs
 * @param {(prompt: string) => Promise<string>} callLLMFn - 주입받는 LLM 호출 함수
 * @param {{category?: string, pdvStore?: object}} opts - pdvStore를 안 주면 window.GopangPDV를 씀(테스트용 주입 지점)
 * @returns {Promise<Array<{key, value, confidence, evidence}>>}
 */
export async function extractFields(fieldSpecs, callLLMFn, opts = {}) {
  if (!Array.isArray(fieldSpecs) || !fieldSpecs.length) return [];
  if (typeof callLLMFn !== 'function') throw new Error('callLLMFn 함수가 필요합니다');

  const gopangPDV = opts.pdvStore || (typeof window !== 'undefined' ? window.GopangPDV : null);
  if (!gopangPDV) {
    // PDV 스토어 자체가 없으면(pdv-store.js 미로드) 전부 unknown 처리 —
    // 에러를 던지는 대신 "기록이 없다"와 동일하게 다룬다.
    return _emptyResult(fieldSpecs);
  }

  const category = opts.category || 'all';
  let records;
  try {
    records = category === 'all' ? await gopangPDV.list() : await gopangPDV.listByCategory(category);
  } catch (e) {
    console.warn('[PDV Extract] 레코드 조회 실패:', e.message);
    return _emptyResult(fieldSpecs);
  }

  const recordsText = _formatRecordsForPrompt(records || []);
  if (!recordsText) return _emptyResult(fieldSpecs);

  const prompt = _buildExtractPrompt(fieldSpecs, recordsText);
  let raw;
  try {
    raw = await callLLMFn(prompt);
  } catch (e) {
    console.warn('[PDV Extract] LLM 호출 실패:', e.message);
    return _emptyResult(fieldSpecs);
  }

  let parsed;
  try {
    const jsonMatch = typeof raw === 'string' ? raw.match(/\[[\s\S]*\]/) : null;
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
  } catch (e) {
    console.warn('[PDV Extract] 응답 파싱 실패:', e.message);
    return _emptyResult(fieldSpecs);
  }
  if (!Array.isArray(parsed)) return _emptyResult(fieldSpecs);

  // 요청한 필드 목록과 정확히 대조 — LLM이 요청 안 한 필드를 지어내거나
  // 빠뜨려도 항상 요청한 만큼, 요청한 키로만 정확히 반환한다.
  const byKey = new Map(parsed.filter(p => p && typeof p.key === 'string').map(p => [p.key, p]));
  return fieldSpecs.map(f => {
    const found = byKey.get(f.key);
    if (!found) return { key: f.key, value: null, confidence: 'unknown', evidence: null };
    return {
      key: f.key,
      value: found.value ?? null,
      confidence: ['high', 'low', 'unknown'].includes(found.confidence) ? found.confidence : 'unknown',
      evidence: typeof found.evidence === 'string' ? found.evidence : null,
    };
  });
}

/**
 * 추출 결과를 사람이 확인할 수 있는 문장으로 바꾼다 — 절대 그냥 믿고
 * 쓰면 안 된다는 원칙(PDV §5, §14 적극적 보조 원칙)을 호출부에 강제하기
 * 위한 헬퍼. extractFields의 결과를 바로 화면에 못 쓰게, 항상 이 함수를
 * 거치도록 유도하는 것이 목적이다(강제는 아니지만 관례).
 */
export function formatFieldsForConfirmation(extracted, fieldSpecs) {
  const byKey = new Map(fieldSpecs.map(f => [f.key, f]));
  return extracted.map(e => {
    const spec = byKey.get(e.key);
    const label = spec?.label || e.key;
    if (e.value == null || e.confidence === 'unknown') {
      return `${label}: 기록에서 확인 안 됨 — 직접 입력해 주세요.`;
    }
    const certainty = e.confidence === 'high' ? '확실' : '불확실';
    return `${label}: ${e.value} (과거 기록 기반 추정, ${certainty} — 맞는지 확인해 주세요)`;
  });
}
