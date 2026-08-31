/**
 * ai/candidate-prefilter.js — 0단계 후보 축소 (2026-08-08 신설)
 *
 * 배경(주피터 지시로 설계 방향 확정): AC-PRO-CORE(flash 모델이 매 턴
 * 읽는 라우팅 판단 프롬프트)가 §CATALOG 표 93개 행 + 8,655자(전체의
 * 23.6%)에 달하는 과거 실패 사후분석 브래킷을 매 턴 전부 싣고 있다.
 * "근처 중국음식점" 같은 도메인 밖 발화에도, "고전문학 봐주실 분"
 * 같은 교육 도메인 발화에도 매번 93개 후보 전체를 훑게 하는 구조라,
 * flash 입장에서 판단해야 할 표면적이 불필요하게 넓다 — subject-gate.js가
 * professor 157개 리프를 "일단 professor까지만 좁히고, 그 다음에
 * 리프를 정밀화"하는 2단계로 쪼갠 것과 같은 문제를 한 층 위(GWP vs
 * EXPERT 판정 자체)에서도 겪고 있다.
 *
 * 이 모듈은 그 앞단에 놓일 "0단계"다 — LLM 호출 없이(순수 로컬
 * 스코어링) 사용자 발화와 각 GWP/EXPERT 후보의 trigger·description을
 * 대조해서, 관련성이 있는 후보만 추려 AC-PRO-CORE에 넘길 후보 목록을
 * 좁힌다. 최종 GWP vs EXPERT 판정(§CORE R1축의 위임의도 여부)은 여전히
 * 다음 단계(축소된 AC-PRO-CORE 프롬프트) 몫이다 — 이 모듈은 "누가
 * 관련 있어 보이는가"만 판단하지 "누가 맞는가"는 판단하지 않는다.
 *
 * ★ 알려진 한계(2026-08-08 실사로 확인, 정직하게 기록) ★
 * 1) 이 모듈은 순수 문자열 부분일치 기반이라 리터럴 trigger 단어가
 *    전혀 없는 패러프레이즈(예: "고전문학이 너무 어려워서 저 한 사람만
 *    놓고 계속 봐주실 전문가가 있으면 좋겠어요" — kedu/professor/teacher
 *    triggers 중 어느 것도 문자열로 안 나타남)에는 후보를 못 좁혀준다 —
 *    그 발화들은 여전히 폴백 후보 목록(FALLBACK_DOMAINS, 아래)에
 *    의존한다. 진짜 의미론적 패러프레이즈 매칭(임베딩 등)은 이 저장소에
 *    아직 인프라가 없어 이번 범위에 포함하지 않았다 — 후속 결정 필요.
 * 2) 부분일치이므로 동음이의어·부분문자열 오탐이 생긴다(예: "중국
 *    음식점"의 "음식"이 kcommerce trigger '음식'과 우연히 겹침) —
 *    AC-PRO-CORE가 이미 문서화한 "강도"(범죄 vs 운동강도) 충돌과
 *    같은 클래스의 문제다. 0단계는 후보를 "넓게" 추리는 역할이라 이런
 *    저점수 오탐 1~2건은 치명적이지 않지만, 완전한 해결책은 아니다.
 */

// 트리거가 하나도 안 걸려도 항상 후보에 포함할 고빈도 도메인(재현율
// 안전망). 여기 있는 GWP/EXPERT id는 발화가 이 도메인에 속할 가능성이
// 충분히 높은 경우(예: 교육 관련 대화 전체) 트리거 매칭 실패 시에도
// 완전히 후보에서 빠지지 않게 한다 — 다만 항상 최하위 점수로 넣어서,
// 실제 트리거가 매칭된 후보보다 우선순위가 낮게 유지되도록 한다.
// ★ 이 안전망은 패러프레이즈 recall을 부분적으로만 메운다 — 위 한계
// 참고. 여기 없는 도메인(예: 세무·부동산)의 패러프레이즈는 여전히
// 못 잡는다. 사용 빈도·민원 빈도가 높은 도메인부터 점진적으로 추가할
// 것을 권장한다.
export const FALLBACK_DOMAINS = ['kedu', 'professor', 'teacher'];

/**
 * 후보 하나의 매칭 텍스트를 만든다 — description/label + triggers를
 * 합친 문자열. 실제 스코어링은 이 텍스트가 아니라 triggers 배열
 * 각각을 개별 매칭하는 방식을 쓰지만(더 긴/구체적인 trigger에 더 높은
 * 점수를 주기 위해, §CORE R2축 "더 길고 구체적인 trigger 문구...
 * 우선"과 동일 원칙), 디버깅·로깅용으로 이 함수도 남겨둔다.
 */
export function buildMatchText(entry) {
  const label = entry.label || entry.name || '';
  const desc = entry.description || '';
  const triggers = (entry.triggers || []).join(' ');
  return [label, desc, triggers].filter(Boolean).join(' ');
}

/**
 * 발화 하나와 후보 하나를 대조해 점수를 낸다.
 * - trigger 문자열이 발화에 그대로 포함되면, 그 trigger 길이만큼
 *   점수를 더한다(길고 구체적인 trigger일수록 우연한 매칭일 확률이
 *   낮으므로 더 신뢰 — §CORE R2축과 동일 원칙).
 * - 매칭된 trigger가 하나도 없으면 0점.
 */
function scoreOne(utterance, entry) {
  const triggers = entry.triggers || [];
  let score = 0;
  const matched = [];
  for (const t of triggers) {
    if (t && utterance.includes(t)) {
      score += t.length;
      matched.push(t);
    }
  }
  return { score, matched };
}

/**
 * 발화를 candidates(id/kind/label/description/triggers를 가진 GWP+
 * EXPERT 합친 배열)와 대조해 상위 topN개만 반환한다.
 *
 * @param {string} utterance - 사용자 발화 원문
 * @param {Array}  candidates - [{id, kind:'gwp'|'expert', label, description, triggers}]
 * @param {object} [opts]
 * @param {number} [opts.topN=8] - 최대 후보 수
 * @param {number} [opts.minScore=1] - 이 점수 미만은 제외(트리거 매칭 전무 시 0점 → 제외)
 * @returns {{candidates: Array, fallbackApplied: boolean}}
 *   candidates: [{id, kind, label, score, matched}] score 내림차순.
 *   빈 배열이면 "표 밖" — AC가 직접 답하거나 별도 경로로 처리.
 *   fallbackApplied: FALLBACK_DOMAINS가 순위에 추가로 끼어들었는지 여부
 *   (매칭 스코어 0인 채로 최하위에 포함된 경우 — 호출부가 로깅·모니터링에
 *   활용할 수 있도록 별도 신호로 노출한다).
 */
export function narrowCandidates(utterance, candidates, opts = {}) {
  const topN = opts.topN ?? 8;
  const minScore = opts.minScore ?? 1;

  const scored = candidates.map(c => {
    const { score, matched } = scoreOne(utterance, c);
    return { id: c.id, kind: c.kind, label: c.label, score, matched };
  });

  const withHits = scored.filter(c => c.score >= minScore);
  withHits.sort((a, b) => b.score - a.score);

  let result = withHits.slice(0, topN);
  let fallbackApplied = false;

  // 재현율 안전망: FALLBACK_DOMAINS 중 결과에 아직 없는 것을, 자리가
  // 남아 있으면 최하위(score 0)로 추가한다. 이미 트리거로 매칭돼
  // 상위에 있는 항목은 중복 추가하지 않는다.
  if (result.length < topN) {
    const already = new Set(result.map(r => r.id));
    for (const fid of FALLBACK_DOMAINS) {
      if (result.length >= topN) break;
      if (already.has(fid)) continue;
      const entry = candidates.find(c => c.id === fid);
      if (!entry) continue;
      result.push({ id: entry.id, kind: entry.kind, label: entry.label, score: 0, matched: [] });
      fallbackApplied = true;
    }
  }

  return { candidates: result, fallbackApplied };
}

/**
 * GWP_REGISTRY(window.GWP_REGISTRY, plain array)와 EXPERT_REGISTRY
 * (import된 object)를 narrowCandidates가 먹는 균일한 배열 형태로
 * 합친다. 두 레지스트리 모듈 형식이 다르므로(GWP_REGISTRY는 브라우저
 * 전역 배열, EXPERT_REGISTRY는 ES 모듈 object) 호출부에서 둘 다 이미
 * 갖고 있는 상태로 이 함수에 넘겨준다 — 이 모듈 자체는 두 레지스트리를
 * import하지 않는다(테스트 환경에서 순수 함수로 검증 가능하도록,
 * 그리고 gwp-registry.js가 ES 모듈이 아니라 window 전역이라 Node
 * import가 안 되는 제약도 자연히 피해간다).
 */
/**
 * R2-AC(§CORE, GWP끼리 충돌 시 우선순위) 결정을 여기서 미리 내린다
 * (2026-08-31 신설 — 근본 원인 수정).
 *
 * ★ 배경 — 이 결정을 프롬프트 텍스트로만 맡기면 왜 안 되는가 ★
 * AC-PRO-CORE §CORE에는 이미 "부가세 신고"(kbusiness, 구체) vs "부가세"
 * (ktax, 일반) 사례가 R2-AC 규칙의 근거로 명시돼 있고, 이 정확한 문구
 * 충돌을 고치겠다고 2026-08-06에 규칙까지 신설했다. 그런데도
 * scenarios_routing_branches_20260806.json 라이브 재검증(2026-08-31)에서
 * 동일 발화가 다시 ktax로 흡수되는 게 재현됐다 — kestate/ktelecom의
 * 구식 [GWP:id] 오출력이 "25개 중 23개 습관을 프롬프트 경고 한 줄로
 * 못 이긴다"고 이미 결론 낸 것과 완전히 같은 실패 유형이다: R2는
 * "누가 더 구체적인 trigger로 매칭됐는가"라는 순수 문자열 사실이라
 * 애초에 LLM의 판단(의미론적 이해)이 필요 없는 결정인데, 그걸 후보
 * 목록만 던져주고 LLM이 매 턴 다시 판단하게 하니 익숙한 서비스(ktax)로
 * 재차 흡수되는 것이다.
 *
 * 이 함수는 narrowCandidates()가 이미 계산해 둔 점수(트리거 길이 기반,
 * §CORE R2축과 동일 원칙)를 사후에 한 번 더 사용해, GWP끼리 충돌하고
 * 그 충돌이 "한쪽의 매칭 trigger가 다른 쪽의 매칭 trigger를 문자열로
 * 포함하는" 명백한 구체성 우위일 때만 승자를 확정한다. 애매하면(포함
 * 관계가 아니면) 아무것도 확정하지 않고 null을 반환해 기존처럼 AC의
 * 판단에 맡긴다 — "잘못 확정하는 것이 확정 안 하는 것보다 나쁘다"는
 * domain-classifier.js와 동일한 안전 원칙.
 *
 * @param {Array} narrowed - narrowCandidates()의 candidates 배열
 *   ({id, kind, label, score, matched}[])
 * @returns {{winnerId: string, loserId: string, winnerTrigger: string,
 *   loserTrigger: string} | null}
 */
export function findGwpR2Winner(narrowed) {
  const gwps = (narrowed || [])
    .filter(c => c.kind === 'gwp' && c.score > 0)
    .sort((a, b) => b.score - a.score);

  if (gwps.length < 2) return null;
  const [top, second] = gwps;
  if (top.score <= second.score) return null; // 동점이면 확정하지 않음

  // top의 매칭 trigger 중 하나가 second의 매칭 trigger 중 하나를
  // 문자열로 포함해야만 "구체성 우위"로 인정한다(우연한 점수 차이가
  // 아니라, 실제로 더 좁고 구체적인 표현이라는 근거가 있을 때만).
  for (const wt of top.matched) {
    for (const lt of second.matched) {
      if (wt.includes(lt) && wt !== lt) {
        return { winnerId: top.id, loserId: second.id, winnerTrigger: wt, loserTrigger: lt };
      }
    }
  }
  return null;
}

export function buildCandidateList(gwpRegistryArray, expertRegistryObject) {
  const gwpList = (gwpRegistryArray || [])
    .filter(e => e.status === 'active')
    .map(e => ({ id: e.id, kind: 'gwp', category: e.category, label: e.name, description: e.description, triggers: e.triggers }));

  const expertList = Object.entries(expertRegistryObject || {})
    // 리프가 아닌 루트만 0단계 후보에 올린다(예: professor 자체만,
    // professor-math 같은 157개 리프는 여기 안 올림) — 리프 정밀화는
    // subject-gate.js(2단계) 몫이라 0단계에서 같이 다루면 다시 93개가
    // 아니라 250개+ 후보를 스코어링하게 돼 원래 목적(축소)에 어긋난다.
    .filter(([, def]) => !def.parentKey)
    .map(([id, def]) => ({ id, kind: 'expert', category: def.category, label: def.label, description: def.label, triggers: def.triggers }));

  return [...gwpList, ...expertList];
}
