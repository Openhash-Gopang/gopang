/**
 * ai/subject-gate.js — EXPERT 2단계 과목 게이트 (2026-08-08 신설)
 *
 * 배경(사고실험 사전 코드추적으로 확인된 구조적 결함): §CATALOG-EXPERT
 * 표는 라우팅 후보를 절약하려고 professor/physician/lawyer를 각각 한
 * 줄로만 올린다(예: professor | 교수(1:1 맞춤교육)). 세부 리프(교수
 * 158개+, 의사 26개, 변호사 47개)는 이 표에 없으므로, 1단계 라우팅 LLM은
 * "[EXPERT: professor]"까지만 낼 수 있고 "[EXPERT: professor-math]"처럼
 * 구체적인 리프 ID는 스스로 지어낼 근거가 없다(오히려 표에 없는 ID를
 * 지어내지 않도록 설계돼 있어, 만들어내지도 않는다).
 *
 * 이 모듈은 handleExpertTag가 1단계에서 professor/physician/lawyer 같은
 * "리프 아닌" personaId를 받았을 때, 그 아래 실제 리프 후보 목록을
 * getLeafDescendants()로 모으고, 저지연 경량 모델(deepseek-v4-flash,
 * report-utils.js summarizeHandoffContext6W와 동일 패턴)로 사용자 발화를
 * 그 후보 중 하나에 재분류한다. 실패(네트워크 오류, 파싱 실패, 후보
 * 0개)하면 원래 personaId로 안전하게 폴백한다 — 사용자 흐름을 절대
 * 막지 않는다.
 */
import { CFG } from '../core/config.js';
import { EXPERT_REGISTRY, getLeafDescendants } from './expert-registry.js';

const GATE_SYS_PROMPT_HEAD =
  '사용자 발화를 아래 후보 목록 중 정확히 하나로 분류하세요. ' +
  '반드시 후보 목록의 id 값 중 하나만, 다른 텍스트 없이 JSON으로만 ' +
  '응답하세요: {"id": "<후보 id>"}. 확신이 없거나 후보 중 뚜렷이 맞는 ' +
  '것이 없으면 {"id": null}로 응답하세요(지어내지 않습니다).\n\n후보 목록:\n';

// ── 2026-08-08 신설(초중고 학년대 어휘 보강) ────────────────────────
// 배경(주피터 지시): 초등 산수와 대학 수학을 별도 페르소나로 안 쪼갠다
// — SP_professor_v1_5.md §3-1(학습자 프로파일 확정)이 이미 학습자
// 수준에 맞춰 교수법을 조정하도록 설계돼 있어, professor-math 하나가
// 초등학생부터 대학원생까지 다 받는다(persona 정체성은 그대로,
// 교수법만 상대에 맞춤). 다만 이 게이트의 후보 메뉴는 EXPERT_REGISTRY의
// label(예: "교수(수학)")을 그대로 보여주는데, 이 라벨은 학과 명칭
// 위주라 "산수"·"구구단"처럼 초등 수준 발화에 쓰이는 실제 어휘와
// 문자열이 안 겹칠 수 있다 — 그러면 분류 LLM이 후보 중 뚜렷이 맞는
// 게 없다고 보고 null을 낼 위험이 있다. EXPERT_REGISTRY.label 자체는
// 건드리지 않는다(그 필드는 새 탭 제목 등 다른 곳에도 쓰임) — 이 게이트
// 전용으로 리프 id별 저학년 동의어를 별도로 매핑해 메뉴에만 덧붙인다.
// 커버 범위는 초중고 정규 교과 중 대응되는 대학 학과가 명확한 것만
// (국어/수학/영어/과학/사회/체육/미술) — 음악처럼 리프가 세부장르별로만
// 쪼개져 있어 마땅한 초등 catch-all 리프가 없는 과목은 일단 제외했다
// (필요해지면 그때 재검토).
const LEAF_SYNONYMS = {
  'professor-korean':             ['국어', '받아쓰기', '맞춤법', '한글', '초등 국어', '글쓰기 기초'],
  'professor-math':               ['수학', '산수', '구구단', '덧셈', '뺄셈', '곱셈', '나눗셈', '초등 수학'],
  'professor-english':            ['영어', '알파벳', '파닉스', '영어 기초', '초등 영어'],
  'professor-generalscience':     ['과학', '초등 과학', '과학 실험'],
  'professor-generalsocialscience': ['사회', '초등 사회'],
  'professor-physicaleducation':  ['체육', '초등 체육'],
  'professor-finearts':           ['미술', '초등 미술', '그리기'],
};

function _leafMenuLine(leaf) {
  const syn = LEAF_SYNONYMS[leaf.id];
  return syn ? `- ${leaf.id}: ${leaf.label} (${syn.join('·')} 포함)` : `- ${leaf.id}: ${leaf.label}`;
}

/**
 * personaId 아래에 실제 리프가 둘 이상 있으면(=1단계 라우팅이 뭉뚱그린
 * 상위 직업군일 가능성) 그 발화를 리프 하나로 재분류해 personaId를
 * 정밀화한다. 리프가 하나뿐이거나(=personaId 자신이 곧 리프) 분류
 * 실패 시에는 원래 personaId를 그대로 반환한다.
 *
 * @param {string} personaId - 1단계 라우팅이 낸 EXPERT_REGISTRY 키
 * @param {string} userText  - 이 태그를 유발한 사용자 발화 원문
 * @returns {Promise<string>} 정밀화된(또는 변경 없는) personaId
 */
export async function refineToLeaf(personaId, userText) {
  const leaves = getLeafDescendants(personaId);

  // 리프가 하나뿐이면(=personaId 자신이 리프이거나, 자식이 정확히
  // 하나) 이미 정밀하다 — 게이트를 돌 필요 없음.
  if (leaves.length <= 1) return personaId;

  try {
    const menu = leaves
      .map(_leafMenuLine)
      .join('\n');
    const res = await fetch(CFG.endpoint + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:       'deepseek-v4-flash',
        // 2026-08-09 수정(60→1000, 실사로 발견된 결함) — subject_gate_live_smoketest.py
        // 실사 검증 결과, deepseek-v4-flash가 reasoning_content(사고 과정)에
        // 토큰을 먼저 쓰고 최종 답변(content)을 나중에 내는 방식이라 60으로는
        // 사고 과정만으로 소진되어 content가 빈 문자열로 오는 경우가 대부분이었다
        // (60에서 거의 전멸 → 500에서 35/38 PASS, 그중 2건은 500도 부족해 여전히
        // 빈 응답). 기본이 non-thinking 계열 모델이라 매 호출이 이 상한까지
        // 차는 게 아니라 실제 필요한 만큼만 쓰므로, 토큰 비용 증가는 크지 않다는
        // 전제로 여유 있게 1000으로 올린다.
        max_tokens:  1000,
        temperature: 0.0,
        stream:      false,
        messages: [
          { role: 'system', content: GATE_SYS_PROMPT_HEAD + menu },
          { role: 'user',   content: (userText || '').slice(0, 2000) },
        ],
      }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const raw  = data.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    const chosenId = parsed?.id;

    // 화이트리스트 검증 — 후보 목록에 실제로 있는 id만 채택. 모델이
    // 후보에 없는 id를 지어내거나 null을 낸 경우 원래 personaId로 폴백.
    if (chosenId && leaves.some(l => l.id === chosenId) && EXPERT_REGISTRY[chosenId]) {
      console.info('[SubjectGate] 리프 정밀화:', personaId, '→', chosenId);
      return chosenId;
    }
    return personaId;
  } catch (e) {
    console.warn('[SubjectGate] 과목 게이트 실패(무시 — 상위 personaId로 폴백):', e.message);
    return personaId;
  }
}
