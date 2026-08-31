/**
 * ai/routing-hint.js — 라우팅 힌트 통합 (2026-08-08 신설)
 *
 * ★★★ 설계 전환 배경(중요) — 원래 계획을 실제 코드 제약에 맞춰 조정 ★★★
 * 원래 구상은 "0단계+1단계로 후보를 좁혀서, 그 후보만 담은 slim
 * AC-PRO-CORE를 매 턴 동적으로 만들어 CFG.system에 넣는다"였다. 하지만
 * call-ai.js에 이미 명문화된 원칙이 있다: "system 메시지는 세션 내
 * 절대 변경하지 않는다(DeepSeek Auto Prompt Caching 캐시 prefix 보존)"
 * — CFG.system_base는 세션당 1회만 로드되고 이후 고정된다. 매 턴 다른
 * (좁혀진) system을 넣으면 이 캐시가 매번 깨져서, 짧아진 프롬프트인데도
 * 캐시 할인 없이 매번 전체 요금을 내는 역설이 생길 수 있다 — 그리고
 * 세션 전체를 한 번만 좁히는 방식은 대화 도중 도메인이 바뀌면(예:
 * 교육 얘기하다가 갑자기 법률 질문) 후보가 영영 안 맞게 되는 위험이
 * 있어 채택하지 않았다.
 *
 * 그래서 이 모듈은 이미 코드베이스에 확립된 다른 패턴을 그대로 따른다
 * — GUID·위치·PDV 요약처럼, "매 턴 바뀌는 데이터"는 system이 아니라
 * user 메시지 앞 [ctx] 블록에 얹는다(_buildEnhancedUserContent 참고,
 * 캐시 prefix 무관). AC-PRO-CORE 쪽에는 "[ctx]에 라우팅후보: 힌트가
 * 있으면 §CATALOG/§CATALOG-EXPERT 전체를 다시 훑기 전에 그 후보부터
 * 본다"는 한 문장만 추가하면 된다(별도 patch로 진행) — system 텍스트
 * 자체는 안 줄어들지만(캐싱 유지가 우선), flash가 93개 대신 5~8개
 * 안에서 판단하게 되는 신뢰성 효과는 그대로 얻는다.
 *
 * 비용 절충: 0단계(prefilter, 무료)는 항상 돈다. 1단계(domain-classifier,
 * LLM 호출 1회 추가)는 0단계 신호가 약할 때만 돈다 — subject-gate.js가
 * "리프가 2개 이상일 때만 게이트를 돈다"로 절충한 것과 동일한 원칙.
 */
import { narrowCandidates, buildCandidateList, findGwpR2Winner } from './candidate-prefilter.js';
import { classifyDomain } from './domain-classifier.js';
import { getCandidateIdsForDomains } from './domain-taxonomy.js';

// 0단계 최상위 점수가 이 값 이상이면 1단계(LLM 호출)를 건너뛴다 — 이미
// 충분히 구체적인 trigger가 리터럴로 걸렸다는 뜻(예: "재판"=2자는 약한
// 신호일 수 있지만 "헌법소원"=4자, "부당해고"=4자처럼 길고 구체적인
// trigger는 §CORE R2축이 이미 "길수록 신뢰"라고 정한 것과 같은 기준).
const WEAK_SIGNAL_THRESHOLD = 4;

// 0단계(trigger 실매칭, 점수로 순위를 매길 수 있음)에서만 쓰는 상한 —
// 여기서 자르는 건 "점수 낮은 후보부터 버림"이라 안전하다.
const MAX_HINT_CANDIDATES = 8;

// 1단계(도메인 분류) 폴백 경로에서 쓰는 상한 — 이쪽은 도메인 소속
// 여부만 있고 후보 간 우열(점수)이 없어서 자르면 무작위로 정답을
// 버릴 위험이 있다(2026-08-08 실사로 발견: education 도메인 12개 중
// naive slice(0,8)가 professor를 잘라버림 — 정확히 이 통합 작업의
// 출발점이었던 패러프레이즈 케이스가 힌트에서 빠지는 사고). 그래서
// 이 상한은 가장 큰 도메인(health, 21개)도 통째로 들어갈 만큼 넉넉하게
// 잡아 "거의 안 자름"에 가깝게 둔다 — 그래도 93개보다는 훨씬 좁다.
const MAX_DOMAIN_HINT_CANDIDATES = 25;

/**
 * 사용자 발화 하나에 대한 라우팅 힌트 문자열을 만든다.
 * _buildEnhancedUserContent의 parts 배열에 그대로 push할 수 있는 형태
 * (짧은 key:value 한 줄) — 없으면 빈 문자열.
 *
 * @param {string} plainText - 이번 턴 사용자 발화(텍스트만)
 * @param {Array} gwpRegistryArray - window.GWP_REGISTRY
 * @param {object} expertRegistryObject - EXPERT_REGISTRY
 * @returns {Promise<string>} "라우팅후보:id1,id2,..." 또는 ''
 */
export async function buildRoutingHintPart(plainText, gwpRegistryArray, expertRegistryObject) {
  if (!plainText) return '';
  try {
    const candidates = buildCandidateList(gwpRegistryArray, expertRegistryObject);
    const { candidates: narrowed } = narrowCandidates(plainText, candidates, { topN: MAX_HINT_CANDIDATES });
    const realHits = narrowed.filter(c => c.score > 0);
    const topScore = realHits[0]?.score || 0;

    // 2026-08-31 신설 — R2-AC(GWP끼리 충돌) 결정을 여기서 미리 확정한다.
    // findGwpR2Winner()는 순수 문자열 포함관계만 보는 결정론적 판단이라
    // LLM에게 "다시 판단해 달라"고 맡길 이유가 없다 — 오히려 맡기면
    // ktax↔kbusiness처럼 매 턴 다시 흔들린다(라이브 재현 확인,
    // ROUTING-BRANCH-REFERENCE 참고). 확정되면 힌트 문자열에 별도
    // 줄로 추가해 AC-PRO-CORE §CORE 2단계가 그대로 채택하게 한다.
    const r2Winner = findGwpR2Winner(narrowed);

    let finalIds;

    if (topScore >= WEAK_SIGNAL_THRESHOLD) {
      // 0단계 신호가 충분히 강함 — 추가 LLM 호출 없이 그대로 힌트로 씀.
      finalIds = narrowed.map(c => c.id);
    } else {
      // 신호가 약하거나 없음(패러프레이즈 의심 구간) — 1단계로 보완.
      const domainIds = await classifyDomain(plainText);
      if (domainIds === null) {
        // 1단계도 실패 — 0단계가 뭐라도 건졌으면 그거라도 힌트로 준다.
        // 아무것도 없으면 힌트 자체를 생략(AC가 평소처럼 전체 판단).
        finalIds = realHits.length ? narrowed.map(c => c.id) : [];
      } else if (domainIds.length === 0) {
        // 1단계가 "어느 도메인도 아님"으로 명확히 답함(예: 맛집 추천) —
        // 억지로 후보를 만들지 않는다. 0단계 잡음(예: kcommerce '음식'
        // 오탐)도 여기서 자연스럽게 걸러진다.
        finalIds = [];
      } else {
        const domainCandidateIds = getCandidateIdsForDomains(domainIds, candidates);
        // 0단계에서 실제로 매칭된 것도(있다면) 앞쪽에 병합 — 정보 손실 방지.
        // 도메인 폴백 경로는 후보 간 점수 우열이 없으므로 MAX_DOMAIN_
        // HINT_CANDIDATES(넉넉한 상한)만 적용한다 — 여기서 세게 자르면
        // 무작위로 정답 후보를 버릴 수 있다(위 주석 참고).
        const merged = [...new Set([...realHits.map(c => c.id), ...domainCandidateIds])];
        finalIds = merged.slice(0, MAX_DOMAIN_HINT_CANDIDATES);
      }
    }

    if (!finalIds.length) return '';
    const hintLine = `라우팅후보:${finalIds.join(',')}`;
    // r2Winner는 0단계 narrowed 기준으로 계산됐으므로, finalIds에 실제로
    // 그 둘이 남아있을 때만 덧붙인다(1단계 도메인 폴백 병합으로 후보
    // 구성이 달라졌을 가능성에 대한 안전장치).
    if (r2Winner && finalIds.includes(r2Winner.winnerId) && finalIds.includes(r2Winner.loserId)) {
      return `${hintLine}\nR2확정:${r2Winner.winnerId}(사유: '${r2Winner.winnerTrigger}'가 '${r2Winner.loserTrigger}'보다 구체적 — ${r2Winner.loserId} 아님)`;
    }
    return hintLine;
  } catch (e) {
    console.warn('[RoutingHint] 힌트 생성 실패(무시 — 힌트 없이 진행):', e.message);
    return '';
  }
}
