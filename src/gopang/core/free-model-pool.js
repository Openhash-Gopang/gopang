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
 * 우선순위 정책 (v3.1, 2026-06-24):
 *   기본 정렬은 컨텍스트·파라미터 기준 품질 순서(아래 OR_FREE_MODELS_FALLBACK)다.
 *   2026-06 시점 Anthropic·xAI는 OpenRouter에 무료 모델을 올리지 않으므로,
 *   "vendor 그룹 전체 재정렬"은 오늘은 효과가 없고 코드만 복잡해지는 것으로
 *   판단해 제거했다. 대신 OR_AUTO_PROMOTE_VENDORS에 해당하는 vendor
 *   (anthropic·x-ai)가 신규로 무료 모델을 올리는 순간, 그 모델만 카탈로그
 *   신규 발견 단계에서 자동으로 풀 최상단에 배치한다 — 정적 목록을
 *   수정할 필요 없이 다음 buildLiveFreeModelPool() 호출(가입 시·설정 새로고침 시)
 *   부터 즉시 반영된다.
 *
 * 컨텍스트 정렬 정책(2026-06):
 *     1순위 (1~14): 컨텍스트 128K+, 파라미터 20B+ — 추론·라우팅·지시이행 최상
 *     2순위 (15~21): 컨텍스트 32K~131K, 파라미터 9B+ — 충분한 여유
 *     3순위 (22~23): 컨텍스트 16K — System Prompt 수용 가능한 최소 규격
 *     후순위 (24~26): 파라미터 1~3B — 복잡한 다단계 지시(Hash·라우팅) 이행 불안정
 *
 * 신뢰성 관리(2026-06-24 신규):
 *   매일 전체 모델을 미리 호출 테스트하는 방식은 그 자체로 호출량을 낭비하므로
 *   채택하지 않았다. 대신 "실제 사용 중 실패하면 24시간 동안 그 모델만 제외"하는
 *   반응형 쿨다운 캐시(markModelFailed/isModelOnCooldown)를 쓴다.
 *   24시간 뒤 자동 만료되므로 결과적으로 "매일 목록이 갱신"되는 효과를 내며,
 *   불필요한 테스트 호출이 전혀 추가되지 않는다.
 *   또한 OpenRouter 분당 호출 한도를 보호하기 위해 60초 슬라이딩 윈도우
 *   호출 카운터(canCallOpenRouterNow/recordOpenRouterCall)를 둔다.
 *
 * 사용처:
 *   - pages/ai-setup-mobile.html (OpenRouter 키 최초 등록 시 풀 구성)
 *   - ai/call-ai.js (_buildCallCandidates에서 쿨다운·레이트리밋 적용)
 *   - ui/settings.js의 _refreshFreeModelPool() (폰 AI 설정창의 "모델 갱신" 버튼)
 */

// ── 신규 발견 시 자동 최우선 배치할 vendor (OR 모델 id의 'vendor-slug/...' 부분) ──
// 오늘(2026-06) 기준 Claude(anthropic)·Grok(x-ai)는 OR에 무료 모델이 없다.
// 둘 중 하나라도 무료 모델을 올리면, 카탈로그에서 발견되는 즉시 풀 최상단으로
// 자동 승격된다 — 코드 수정이나 정적 목록 갱신이 전혀 필요 없다.
export const OR_AUTO_PROMOTE_VENDORS = ['anthropic', 'x-ai'];

function _vendorOf(id) {
  return typeof id === 'string' ? id.split('/')[0] : '';
}

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

    // 2-1) 신규 모델 중 anthropic·x-ai(Claude/Grok) — 발견 즉시 최우선 배치
    //      (OR_AUTO_PROMOTE_VENDORS. 오늘은 보통 0개지만, 추가되는 순간부터
    //       정적 목록 수정 없이 자동으로 풀 맨 앞에 들어간다.)
    const discoveredPromoted = discovered.filter(
      id => OR_AUTO_PROMOTE_VENDORS.includes(_vendorOf(id))
    );
    const discoveredRest = discovered.filter(
      id => !OR_AUTO_PROMOTE_VENDORS.includes(_vendorOf(id))
    );

    // 2-2) 나머지 신규 모델: 16K+ → preferred / 16K 미만 → small
    const discoveredPreferred = discoveredRest.filter(
      id => (ctxMap.get(id) ?? 0) >= MIN_CONTEXT_PREFERRED
    );
    const discoveredSmall = discoveredRest.filter(
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
    //   [Claude/Grok 신규발견(있으면 최상단)] + [전위 우선순위] + [신규 16K+]
    //   + [후위 소형] + [신규 16K 미만] + openrouter/free
    let pool = [
      ...discoveredPromoted,
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
      `| 후순위: ${rankedRear.length + discoveredSmall.length}`,
      discoveredPromoted.length ? `| Claude/Grok 신규발견 최우선배치: ${discoveredPromoted.join(', ')}` : ''
    );
    return { pool, validated: true };
  } catch (e) {
    console.warn('[무료모델풀] 실시간 검증 실패 — 정적 목록으로 폴백:', e.message);
    return { pool: OR_FREE_MODELS_FALLBACK, validated: false, error: e.message };
  }
}

// ══════════════════════════════════════════════════════════════════
// ── 신뢰성 관리: 24h 쿨다운 캐시 + 60초 슬라이딩 호출 제한기 ──────────
// ══════════════════════════════════════════════════════════════════
//
// 설계 이유: "매일 모든 무료 모델을 실제로 호출해 응답 확인"하는 방식은
// 그 검증 호출 자체가 분당/일일 한도를 갉아먹는다. 대신:
//   1) 실제 사용 중 실패(429/402/404/5xx)한 모델만 그 시각부터 24시간
//      "쿨다운" 처리해 후보에서 제외한다 → 추가 호출 비용 0.
//   2) 24시간이 지나면 캐시에서 자동 만료되어 다시 후보에 포함된다
//      → 결과적으로 "매일 목록이 갱신"되는 효과.
//   3) call-ai.js가 OR 모델을 시도하기 직전마다 분당 호출 카운터를
//      확인해, 한도(OR_MAX_CALLS_PER_MINUTE)에 도달하면 남은 OR 후보를
//      전부 건너뛰고 사용자 등록 키 폴백으로 넘어간다 — OR 한도 초과로
//      키 자체가 일시 차단되는 사태를 예방한다.

const _HEALTH_KEY      = 'gopang_or_health';   // localStorage: { [modelId]: { failedAt, status } }
const _RATE_KEY        = 'gopang_or_rate';     // localStorage: number[] (최근 호출 타임스탬프)
const _COOLDOWN_MS     = 24 * 60 * 60 * 1000;  // 24시간
const _RATE_WINDOW_MS  = 60 * 1000;            // 60초 슬라이딩 윈도우
export const OR_MAX_CALLS_PER_MINUTE = 15;     // OR 공유 무료풀 분당 한도(보통 ~20rpm) 대비 여유

function _readJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return v ?? fallback;
  } catch { return fallback; }
}
function _writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

/** 24시간 지난 쿨다운 항목을 캐시에서 제거 (만료 = 자동 "매일 갱신") */
export function pruneModelHealthCache() {
  const cache = _readJSON(_HEALTH_KEY, {});
  const now = Date.now();
  let changed = false;
  for (const id of Object.keys(cache)) {
    if (now - (cache[id]?.failedAt || 0) > _COOLDOWN_MS) { delete cache[id]; changed = true; }
  }
  if (changed) _writeJSON(_HEALTH_KEY, cache);
  return cache;
}

/** 모델이 현재 24h 쿨다운 중인지 확인 (openrouter/free 자동라우터는 절대 제외하지 않음) */
export function isModelOnCooldown(modelId) {
  if (modelId === 'openrouter/free') return false;
  const cache = pruneModelHealthCache();
  return !!cache[modelId];
}

/** 실패한 모델을 24h 쿨다운 캐시에 기록 */
export function markModelFailed(modelId, status) {
  if (!modelId || modelId === 'openrouter/free') return;
  const cache = pruneModelHealthCache();
  cache[modelId] = { failedAt: Date.now(), status: status || 0 };
  _writeJSON(_HEALTH_KEY, cache);
}

/** pool에서 현재 쿨다운 중인 모델을 제외한 배열 반환 */
export function filterHealthyModels(pool) {
  if (!Array.isArray(pool)) return pool;
  const cache = pruneModelHealthCache();
  return pool.filter(id => !cache[id]);
}

/** 60초 슬라이딩 윈도우 내 OR 호출 횟수가 한도 미만인지 확인 */
export function canCallOpenRouterNow() {
  return getOpenRouterRemainingBudget() > 0;
}

/** 이번 60초 윈도우에 추가로 시도할 수 있는 OR 호출 잔여 횟수 */
export function getOpenRouterRemainingBudget() {
  const now = Date.now();
  const hits = _readJSON(_RATE_KEY, []).filter(t => now - t < _RATE_WINDOW_MS);
  return Math.max(0, OR_MAX_CALLS_PER_MINUTE - hits.length);
}

/** OR 호출 시도를 기록 (성공/실패 무관 — 시도 자체가 분당 한도를 소모) */
export function recordOpenRouterCall() {
  const now = Date.now();
  const hits = _readJSON(_RATE_KEY, []).filter(t => now - t < _RATE_WINDOW_MS);
  hits.push(now);
  _writeJSON(_RATE_KEY, hits);
}
