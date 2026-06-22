/**
 * core/free-model-pool.js — OpenRouter 무료(:free) 모델 풀 실시간 검증
 *
 * OpenRouter는 무료 모델을 수시로 추가/제거한다. 고정 리스트만 믿으면
 * 단종된 모델 때문에 call-ai.js의 페일오버 체인이 막히는 문제가 생긴다
 * (예: 과거 google/gemini-flash-1.5:free 단종 → 404).
 *
 * OR_FREE_MODELS_FALLBACK은 두 가지 역할을 한다:
 *   1) 검증 시 "우선순위" 기준 — 우리가 품질을 검토해둔 순서
 *   2) 카탈로그 조회 자체가 실패했을 때(네트워크/CORS 등) 쓰는 안전망
 *
 * 우선순위 정책 (v2.0, 2026-06 — COMMON-01 v4.0 대응):
 *   COMMON-01 v4.0 시스템 프롬프트 정적 부분이 704 tokens이므로,
 *   컨텍스트 윈도우가 8K인 모델(10% 예산 819 tokens)에서는 PDV 동적 여유가
 *   115 tokens뿐이어서 안정적인 Hash Chain 임무 수행이 불가능하다.
 *   → 16K+ 모델(10% 예산 1,638+)을 우선 배치하여 폴백 체인 초반에
 *     항상 충분한 컨텍스트가 확보되도록 한다.
 *
 *   정렬 기준:
 *     1순위 (1~14): 컨텍스트 128K+, 파라미터 20B+ — 추론·라우팅·지시이행 최상
 *     2순위 (15~21): 컨텍스트 32K~131K, 파라미터 9B+ — 충분한 여유
 *     3순위 (22~23): 컨텍스트 16K — System Prompt 수용 가능한 최소 규격
 *     후순위 (24~26): 파라미터 1~3B — 복잡한 다단계 지시(Hash·라우팅) 이행 불안정
 *   제거:
 *     nvidia/nemotron-3.5-content-safety:free — 8K 특수 안전 분류 전용, AI 비서 부적합
 *
 * 사용처:
 *   - pages/ai-setup.html (PC에서 OpenRouter 키 최초 등록 시)
 *   - ui/settings.js의 _refreshFreeModelPool() (폰 AI 설정창의 "모델 갱신" 버튼)
 */

export const OR_FREE_MODELS_FALLBACK = [
  // ── 1순위: 컨텍스트 128K+, 파라미터 20B+ ────────────────────────────────
  // COMMON-01 v4.0 정적 704 tokens → 예산(128K×10%=12,800)의 5.5%만 소진
  // DeepSeek: 추론·한국어·163K 컨텍스트
  'deepseek/deepseek-r1:free',
  'deepseek/deepseek-chat-v3-0324:free',
  // Meta Llama 3.3 70B: 다국어·지시이행·131K
  'meta-llama/llama-3.3-70b-instruct:free',
  // Kimi K2.6: 한국어 포함 아시아권 언어 강점·131K
  'moonshotai/kimi-k2.6:free',
  // NVIDIA Nemotron 대형
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  // OpenAI OSS 대형
  'openai/gpt-oss-120b:free',
  // Qwen3 대형: 코드·추론·다국어
  'qwen/qwen3-next-80b-a3b-instruct:free',
  'qwen/qwen3-coder:free',
  // Hermes 405B: 복잡한 지시이행 특화
  'nousresearch/hermes-3-llama-3.1-405b:free',
  // Google Gemma 4 대형
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
  // GLM 4.5: 중국어·한국어·다국어
  'z-ai/glm-4.5-air:free',
  // OpenAI OSS 소형 (128K이므로 1순위 말미)
  'openai/gpt-oss-20b:free',

  // ── 2순위: 컨텍스트 32K~131K, 파라미터 9B+ ──────────────────────────────
  // COMMON-01 v4.0 정적 704 tokens → 10% 예산(32K×10%=3,276)의 21% 소진
  // 동적 여유 2,572 tokens — PDV_SUMMARY·SLIDING_WINDOW 충분
  'nvidia/nemotron-3-nano-30b-a3b:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  'nvidia/nemotron-nano-12b-v2-vl:free',
  'nvidia/nemotron-nano-9b-v2:free',
  'poolside/laguna-m.1:free',
  'nex-agi/nex-n2-pro:free',
  'cognitivecomputations/dolphin-mistral-24b-venice-edition:free',

  // ── 3순위: 컨텍스트 16K — System Prompt 수용 가능한 최소 규격 ───────────
  // 10% 예산 1,638 tokens → 정적 43% 소진, 동적 여유 934 tokens
  'poolside/laguna-xs.2:free',
  'cohere/north-mini-code:free',

  // ── 후순위: 파라미터 1~3B — 복잡한 다단계 지시(Hash·라우팅) 이행 불안정 ──
  // 컨텍스트는 충분하나 COMMON-01의 5단계 프로토콜·PDV_STORE 포맷·
  // 15개 라우팅 경로 등 복합 지시를 안정적으로 이행하기 어려울 수 있음
  // 폴백 체인 후반 안전망으로만 유지
  'meta-llama/llama-3.2-3b-instruct:free',
  'liquid/lfm-2.5-1.2b-thinking:free',
  'liquid/lfm-2.5-1.2b-instruct:free',

  // ── 최종 안전망: OpenRouter 자동 무료 라우터 ────────────────────────────
  'openrouter/free',

  // 제거 목록 (주석으로 이력 보존):
  // 'nvidia/nemotron-3.5-content-safety:free'
  //   → 8K 컨텍스트(예산 819 tokens, 정적 소진 86%) + 안전 분류 전용 모델
  //   → AI 비서 역할(라우팅·Hash·대화) 부적합 → 완전 제거
];

// ── 무료 모델 풀 실시간 검증 ──────────────────────────────
// OpenRouter 공개 모델 카탈로그(/api/v1/models, 인증 불필요·과금 없음)를 조회해
// "현재 실제로 무료인 모델"만 골라 풀을 구성한다.
//   1) 우선순위 목록(OR_FREE_MODELS_FALLBACK) 중 현재도 무료인 것만 채택(순서 유지)
//   2) 우선순위 목록에 없는 새 무료 모델이 있으면 컨텍스트 크기에 따라 삽입
//      - context >= 16K: 3순위 자리(후순위 앞)에 추가
//      - context < 16K:  후순위 뒤, openrouter/free 앞에 추가
//   3) 조회 자체가 실패하면(네트워크/CORS 등) 안전하게 정적 목록으로 폴백
//
// 컨텍스트 최소 기준 (MIN_CONTEXT_PREFERRED):
//   COMMON-01 v4.0 정적 704 tokens 기준, 10% 예산이 최소 1,638 tokens이어야
//   PDV·대화 동적 데이터(각 ~400 tokens)를 안전하게 수용할 수 있다.
//   → 16,384 tokens (16K) 이상 모델을 우선 배치.
const MIN_CONTEXT_PREFERRED = 16_384;

export async function buildLiveFreeModelPool() {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models');
    if (!res.ok) throw new Error(`models API ${res.status}`);
    const data = await res.json();
    const all = Array.isArray(data?.data) ? data.data : [];
    if (all.length === 0) throw new Error('모델 목록 비어있음 — 응답 형식 변경 추정');

    const isFree = (m) =>
      typeof m?.id === 'string' && (
        m.id.endsWith(':free') ||
        (m.pricing && m.pricing.prompt === '0' && m.pricing.completion === '0')
      );

    // id → context_length 맵 구성
    const ctxMap = new Map();
    for (const m of all) {
      if (m?.id && m.context_length) ctxMap.set(m.id, m.context_length);
    }

    const liveFreeIds = new Set(all.filter(isFree).map(m => m.id));
    if (liveFreeIds.size === 0) throw new Error('무료 모델 0개 — 응답 형식 변경 추정');

    // 1) 우선순위 목록 중 현재도 살아있는 것만, 순서 유지
    //    openrouter/free는 일단 제외하고 마지막에 추가
    const ranked = OR_FREE_MODELS_FALLBACK.filter(
      id => id !== 'openrouter/free' && liveFreeIds.has(id)
    );

    // 2) 우선순위 목록에 없는 신규 무료 모델 분류
    const known = new Set(OR_FREE_MODELS_FALLBACK);
    const discovered = [...liveFreeIds].filter(
      id => !known.has(id) && id !== 'openrouter/free'
    );

    // 신규 모델: 16K+ → preferred / 16K 미만 → small
    const discoveredPreferred = discovered.filter(
      id => (ctxMap.get(id) ?? 0) >= MIN_CONTEXT_PREFERRED
    );
    const discoveredSmall = discovered.filter(
      id => (ctxMap.get(id) ?? 0) < MIN_CONTEXT_PREFERRED
    );

    // 후순위(소형 파라미터) 모델 식별 — OR_FREE_MODELS_FALLBACK에서 후순위로 명시된 항목
    // 정적 목록에서 openrouter/free 직전 3개
    const routerIdx  = OR_FREE_MODELS_FALLBACK.indexOf('openrouter/free');
    const rearModels = new Set(
      OR_FREE_MODELS_FALLBACK.slice(routerIdx - 3, routerIdx)
    );

    // ranked를 전위(rearModels 아닌 것) / 후위(rearModels) 로 분리
    const rankedFront = ranked.filter(id => !rearModels.has(id));
    const rankedRear  = ranked.filter(id => rearModels.has(id));

    // 최종 풀 조합:
    //   [전위 우선순위] + [신규 16K+] + [후위 소형] + [신규 16K 미만] + openrouter/free
    let pool = [
      ...rankedFront,
      ...discoveredPreferred,
      ...rankedRear,
      ...discoveredSmall,
    ].slice(0, 40);

    if (pool.length === 0) throw new Error('교차 검증된 무료 모델 0개');

    pool.push('openrouter/free');

    const preferredCount = rankedFront.length + discoveredPreferred.length;
    console.info(
      `[무료모델풀] 실시간 검증 완료 — ${pool.length}개`,
      `| 16K+우선: ${preferredCount}`,
      `| 신규발견: ${discovered.length}(16K+:${discoveredPreferred.length})`,
      `| 후순위: ${rankedRear.length + discoveredSmall.length}`
    );
    return { pool, validated: true };
  } catch (e) {
    console.warn('[무료모델풀] 실시간 검증 실패 — 정적 목록으로 폴백:', e.message);
    return { pool: OR_FREE_MODELS_FALLBACK, validated: false, error: e.message };
  }
}
