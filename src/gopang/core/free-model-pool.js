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
 * 사용처:
 *   - pages/ai-setup.html (PC에서 OpenRouter 키 최초 등록 시)
 *   - ui/settings.js의 _refreshFreeModelPool() (폰 AI 설정창의 "모델 갱신" 버튼)
 */

export const OR_FREE_MODELS_FALLBACK = [
  'deepseek/deepseek-r1:free',
  'deepseek/deepseek-chat-v3-0324:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'meta-llama/llama-3.2-3b-instruct:free',
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
  'qwen/qwen3-coder:free',
  'qwen/qwen3-next-80b-a3b-instruct:free',
  'openai/gpt-oss-120b:free',
  'openai/gpt-oss-20b:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nvidia/nemotron-3-nano-30b-a3b:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  'nvidia/nemotron-nano-12b-v2-vl:free',
  'nvidia/nemotron-nano-9b-v2:free',
  'nvidia/nemotron-3.5-content-safety:free',
  'moonshotai/kimi-k2.6:free',
  'z-ai/glm-4.5-air:free',
  'poolside/laguna-m.1:free',
  'poolside/laguna-xs.2:free',
  'nex-agi/nex-n2-pro:free',
  'cohere/north-mini-code:free',
  'nousresearch/hermes-3-llama-3.1-405b:free',
  'liquid/lfm-2.5-1.2b-thinking:free',
  'liquid/lfm-2.5-1.2b-instruct:free',
  'cognitivecomputations/dolphin-mistral-24b-venice-edition:free',
  'openrouter/free',
];

// ── 무료 모델 풀 실시간 검증 ──────────────────────────────
// OpenRouter 공개 모델 카탈로그(/api/v1/models, 인증 불필요·과금 없음)를 조회해
// "현재 실제로 무료인 모델"만 골라 풀을 구성한다.
//   1) 우선순위 목록(OR_FREE_MODELS_FALLBACK) 중 현재도 무료인 것만 채택(순서 유지)
//   2) 우선순위 목록에 없는 새 무료 모델이 있으면 뒤에 추가(향후 신규 모델 자동 포함)
//   3) 조회 자체가 실패하면(네트워크/CORS 등) 안전하게 정적 목록으로 폴백
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

    const liveFreeIds = new Set(all.filter(isFree).map(m => m.id));
    if (liveFreeIds.size === 0) throw new Error('무료 모델 0개 — 응답 형식 변경 추정');

    // 1) 우선순위 목록 중 현재도 살아있는 것만, 순서 유지
    const ranked = OR_FREE_MODELS_FALLBACK.filter(id => liveFreeIds.has(id));

    // 2) 우선순위 목록에 없는 신규 무료 모델 추가 (라우터형 id는 제외)
    const known = new Set(OR_FREE_MODELS_FALLBACK);
    const discovered = [...liveFreeIds].filter(id => !known.has(id) && id !== 'openrouter/free');

    let pool = [...ranked, ...discovered].slice(0, 40);
    if (pool.length === 0) throw new Error('교차 검증된 무료 모델 0개');

    // 자동 무료모델 라우터는 최종 안전망으로 항상 마지막에 위치
    pool = pool.filter(id => id !== 'openrouter/free');
    pool.push('openrouter/free');

    console.info(`[무료모델풀] 실시간 검증 완료 — ${pool.length}개 (우선순위:${ranked.length}, 신규발견:${discovered.length})`);
    return { pool, validated: true };
  } catch (e) {
    console.warn('[무료모델풀] 실시간 검증 실패 — 정적 목록으로 폴백:', e.message);
    return { pool: OR_FREE_MODELS_FALLBACK, validated: false, error: e.message };
  }
}
