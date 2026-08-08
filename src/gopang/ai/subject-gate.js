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
      .map(l => `- ${l.id}: ${l.label}`)
      .join('\n');
    const res = await fetch(CFG.endpoint + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:       'deepseek-v4-flash',
        max_tokens:  60,
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
