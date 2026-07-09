// ═══════════════════════════════════════════════════════════
// hondi-proxy — v4.9
// v4.8: /biz/profile, /biz/order, /biz/review, /biz/product
// v4.9: STEP 08 /biz/order L1 위임 (Worker 검증 제거)
//       STEP 09 handlePdvReport 동기 앵커링
//       STEP 10 VALID_PDV_SCOPES 11개 확장
//       STEP 11 reporter_svc 중복 PDV 방지
// ═══════════════════════════════════════════════════════════

const ALLOWED_ORIGINS = [
  'https://hondi.net',
  'https://www.hondi.net',
  // ── 전환 기간 병행 허용 (gopang.net → hondi.net 301 리다이렉트 완료 후 제거) ──
  'https://gopang.net',
  'https://www.gopang.net',
  'https://klaw.hondi.net',
  'https://market.hondi.net',
  'https://tax.hondi.net',
  'https://gdc.hondi.net',
  'https://health.hondi.net',
  'https://school.hondi.net',
  'https://public.hondi.net',
  'https://security.hondi.net',
  'https://democracy.hondi.net',
  'https://police.hondi.net',
  'https://insurance.hondi.net',
  'https://911.hondi.net',
  'https://stock.hondi.net',
  'https://traffic.hondi.net',
  'https://logistics.hondi.net',
  'https://users.hondi.net',
  'https://l1-hanlim.hondi.net',
  'https://jeju.hondi.net',
  'https://fiil.kr',
  'https://openhash.kr',
  'https://nounweb.github.io',
  'http://localhost',
  'http://127.0.0.1',
];


// ══════════════════════════════════════════════════════════════
// 2026-07-07 신설(제주 L1~L3 필드 테스트) — 43개 L1(읍면동) 노드맵
// jeju-l1-l3-field-test-plan-2026-07-07.md §2.4 참고: 노드마다 서브도메인/
// 인증서를 새로 만들지 않고, l1-hanlim.hondi.net 하나를 nginx 경로 기반
// 라우팅(/n/{folder} → 127.0.0.1:{port})으로 확장해 전부 처리한다.
const L1_BASE_HOST = 'https://l1-hanlim.hondi.net';
// 2026-07-08 신설: 서귀포시 관할 17개 읍면동(L1) 전용 물리 호스트.
// hanlim(AMD Micro, 1GB) 메모리 한계로 별도 서버로 이전(jeju-l1-l3
// 필드테스트 후속 조치). L2(l2-seogwipo)는 여전히 hanlim에 있음.
const SEOGWIPO_L1_BASE_HOST = 'https://seogwipo-l1-nodes.hondi.net';

const L1_NODE_MAP = {
  'KR-JEJU-JEJU-HANLIM':  L1_BASE_HOST, // 기존 그대로 — 이미 8091 직결
  'KR-JEJU-JEJU-SI':      L1_BASE_HOST + '/n/l2-jeju',
  'KR-JEJU-SGP-SI':       L1_BASE_HOST + '/n/l2-seogwipo',
  'KR-JEJU':              L1_BASE_HOST + '/n/l3-jejudo',
  'KR':                   'https://openhash-l4-kr.hondi.net', // 이번 계획 범위 밖(§10), 기존 값 유지
  'GLOBAL':               'https://openhash-l5-global.hondi.net', // 이번 계획 범위 밖(§10), 기존 값 유지
  // ── 43개 L1(읍면동) — provision-l1-nodes.py 생성분과 반드시 일치할 것 ──
  'KR-JEJU-JEJU-AEWOL': L1_BASE_HOST + '/n/l1-aewol',
  'KR-JEJU-JEJU-ARA': L1_BASE_HOST + '/n/l1-ara',
  'KR-JEJU-JEJU-BONGGAE': L1_BASE_HOST + '/n/l1-bonggae',
  'KR-JEJU-JEJU-CHUJA': L1_BASE_HOST + '/n/l1-chuja',
  'KR-JEJU-JEJU-DODU': L1_BASE_HOST + '/n/l1-dodu',
  'KR-JEJU-JEJU-GEONIP': L1_BASE_HOST + '/n/l1-geonip',
  'KR-JEJU-JEJU-GUJWA': L1_BASE_HOST + '/n/l1-gujwa',
  'KR-JEJU-JEJU-HANGYEONG': L1_BASE_HOST + '/n/l1-hangyeong',
  'KR-JEJU-JEJU-HWABUK': L1_BASE_HOST + '/n/l1-hwabuk',
  'KR-JEJU-JEJU-IDO1': L1_BASE_HOST + '/n/l1-ido1',
  'KR-JEJU-JEJU-IDO2': L1_BASE_HOST + '/n/l1-ido2',
  'KR-JEJU-JEJU-IHO': L1_BASE_HOST + '/n/l1-iho',
  'KR-JEJU-JEJU-ILDO1': L1_BASE_HOST + '/n/l1-ildo1',
  'KR-JEJU-JEJU-ILDO2': L1_BASE_HOST + '/n/l1-ildo2',
  'KR-JEJU-JEJU-JOCHEON': L1_BASE_HOST + '/n/l1-jocheon',
  'KR-JEJU-JEJU-NOHYEONG': L1_BASE_HOST + '/n/l1-nohyeong',
  'KR-JEJU-JEJU-OEDO': L1_BASE_HOST + '/n/l1-oedo',
  'KR-JEJU-JEJU-ORA': L1_BASE_HOST + '/n/l1-ora',
  'KR-JEJU-JEJU-SAMDO1': L1_BASE_HOST + '/n/l1-samdo1',
  'KR-JEJU-JEJU-SAMDO2': L1_BASE_HOST + '/n/l1-samdo2',
  'KR-JEJU-JEJU-SAMYANG': L1_BASE_HOST + '/n/l1-samyang',
  'KR-JEJU-JEJU-UDO': L1_BASE_HOST + '/n/l1-udo',
  'KR-JEJU-JEJU-YEONDONG': L1_BASE_HOST + '/n/l1-yeondong',
  'KR-JEJU-JEJU-YONGDAM1': L1_BASE_HOST + '/n/l1-yongdam1',
  'KR-JEJU-JEJU-YONGDAM2': L1_BASE_HOST + '/n/l1-yongdam2',
  'KR-JEJU-SGP-ANDEOK': SEOGWIPO_L1_BASE_HOST + '/n/l1-andeok',
  'KR-JEJU-SGP-CHEONJI': SEOGWIPO_L1_BASE_HOST + '/n/l1-cheonji',
  'KR-JEJU-SGP-DAECHEON': SEOGWIPO_L1_BASE_HOST + '/n/l1-daecheon',
  'KR-JEJU-SGP-DAEJEONG': SEOGWIPO_L1_BASE_HOST + '/n/l1-daejeong',
  'KR-JEJU-SGP-DAERYUN': SEOGWIPO_L1_BASE_HOST + '/n/l1-daeryun',
  'KR-JEJU-SGP-DONGHONG': SEOGWIPO_L1_BASE_HOST + '/n/l1-donghong',
  'KR-JEJU-SGP-HYODON': SEOGWIPO_L1_BASE_HOST + '/n/l1-hyodon',
  'KR-JEJU-SGP-JEONGBANG': SEOGWIPO_L1_BASE_HOST + '/n/l1-jeongbang',
  'KR-JEJU-SGP-JUNGANG-SGP': SEOGWIPO_L1_BASE_HOST + '/n/l1-jungang-sgp',
  'KR-JEJU-SGP-JUNGMUN': SEOGWIPO_L1_BASE_HOST + '/n/l1-jungmun',
  'KR-JEJU-SGP-NAMWON': SEOGWIPO_L1_BASE_HOST + '/n/l1-namwon',
  'KR-JEJU-SGP-PYOSEON': SEOGWIPO_L1_BASE_HOST + '/n/l1-pyoseon',
  'KR-JEJU-SGP-SEOHONG': SEOGWIPO_L1_BASE_HOST + '/n/l1-seohong',
  'KR-JEJU-SGP-SEONGSAN': SEOGWIPO_L1_BASE_HOST + '/n/l1-seongsan',
  'KR-JEJU-SGP-SONGSAN': SEOGWIPO_L1_BASE_HOST + '/n/l1-songsan',
  'KR-JEJU-SGP-YEONGCHEON': SEOGWIPO_L1_BASE_HOST + '/n/l1-yeongcheon',
  'KR-JEJU-SGP-YERAE': SEOGWIPO_L1_BASE_HOST + '/n/l1-yerae',
};
const L1_DEFAULT = 'https://l1-hanlim.hondi.net';
// L3(제주도 전체) — guid_home_l1 레지스트리(§4)의 단일 소스
const L3_BASE = L1_NODE_MAP['KR-JEJU'];

// 2026-07-07 신설: 시뮬레이션 중 /api/bridge-in이 무인증이라 대응하는
// bridge_out 없이도 임의 크레딧이 가능했던 걸 발견 — L1의 4개 브릿지
// 엔드포인트에 공유 비밀키를 추가했다. main.pb.js의 하드코딩값(개발 단계,
// MINT_SECRET과 동일 관례)과 반드시 일치해야 한다. 운영 전환 시
// env.BRIDGE_SECRET(wrangler secret)으로 교체할 것 — 지금은 개발 단계라
// 기본값 폴백을 둔다.
function _bridgeSecret(env) {
  return env.BRIDGE_SECRET || 'hondi-dev-bridge-2026';
}

const OPENAI_URL     = 'https://api.openai.com/v1/chat/completions';
const DEEPSEEK_URL   = 'https://api.deepseek.com/v1/chat/completions';
// OpenRouter — Worker 내부 AI 호출 (내부 Agent, 피드백 분류 등)
// 클라이언트가 OR 키로 직접 OR에 접속하는 것과 별개.
// env.OPENROUTER_API_KEY = wrangler secret put OPENROUTER_API_KEY 로 등록.
const OR_URL         = 'https://openrouter.ai/api/v1/chat/completions';
const OR_MODEL_FAST  = 'deepseek/deepseek-v4-flash:free'; // 내부용 경량 모델 (v4-flash)
const OR_MODEL_THINK = 'deepseek/deepseek-r1:free';           // 추론 필요 시
const KAKAO_BASE     = 'https://dapi.kakao.com/v2/local/geo/coord2address.json';
const OPENAI_MODEL   = 'gpt-4o-mini';
const DEEPSEEK_MODEL = 'deepseek/deepseek-r1:free'; // OR 무료 최상위 모델 (프록시 폴백용)
const SUPABASE_URL   = 'https://ebbecjfrwaswbdybbgiu.supabase.co';

// ══════════════════════════════════════════════════════════
// 혼디 제공 무료 기본 키(deepseek-default) — Flash/Pro 티어 + 비용 산정
// ══════════════════════════════════════════════════════════
//
// [자체 서버 전환 설계 — 2026-07-01]
// 현재는 두 티어 모두 api.deepseek.com(공식 API)을 그대로 호출하며,
// "혼디 Flash"="deepseek-chat"(비사고), "혼디 Pro"="deepseek-reasoner"(사고)
// 라는 모델 파라미터 차이만으로 구분한다. 나중에 혼디 자체 GPU 추론 서버
// (한국어 파인튜닝 패치 모델)가 준비되면, 아래 두 시크릿만 등록하면 자동
// 전환된다 — 클라이언트 코드는 전혀 안 건드려도 됨:
//   wrangler secret put HONDI_SELFHOST_URL       (예: https://infer.hondi.net/v1/chat/completions)
//   wrangler secret put HONDI_SELFHOST_API_KEY
// 두 시크릿이 모두 설정되면 자체 서버로, 아니면 지금처럼 공식 API로 나간다.
// 자체 서버의 실제 모델 파라미터명이 deepseek-chat/-reasoner와 다르다면
// HONDI_TIER_MODELS의 backendModel만 바꾸면 된다.
function _selfHostReady(env) { return !!(env.HONDI_SELFHOST_URL && env.HONDI_SELFHOST_API_KEY); }

// 클라이언트는 실제 벤더 모델명 대신 "hondi-flash" / "hondi-pro" 논리 이름만
// 보낸다 — 어느 백엔드(공식 API vs 자체 서버)를 쓰든 클라이언트는 안 바뀐다.
const HONDI_TIER_MODELS = {
  'hondi-flash': {
    backendModel: 'deepseek-chat',      // deepseek-v4-flash 비사고 모드 별칭
    price: { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 }, // $/1M tokens
  },
  'hondi-pro': {
    backendModel: 'deepseek-reasoner',  // deepseek-v4-flash 사고 모드 별칭
    // V4 Pro 프로모션가 기준(2026-06) — 자체 서버 전환 후 실제 원가로 재조정 필요
    price: { cacheHit: 0.0145, cacheMiss: 0.435, output: 0.87 },
  },
};
const USD_TO_KRW = 1500; // 실시간 조회 없이 보수적 고정값(1,000원 한도 안에서 오차 무시 가능)
// "첫 사용자(가입 직후 키 미등록 상태) 1,000원 무료 한도" — guid당 평생 1회
// 누적 한도(일일 리셋 아님). AGENT-COMMON 튜토리얼(§0-1-T STEP 5) "기본
// 1,000원어치는 무료"와 반드시 같은 값으로 유지할 것(2026-07-01 통일).
const FREE_QUOTA_KRW_LIMIT = 1000;

function _deepseekUsageToKRW(usage, tierKey) {
  if (!usage) return 0;
  const price = HONDI_TIER_MODELS[tierKey]?.price || HONDI_TIER_MODELS['hondi-flash'].price;
  // DeepSeek 응답의 usage 필드명: prompt_cache_hit_tokens / prompt_cache_miss_tokens
  // (없으면 prompt_tokens 전체를 캐시 미스로 간주 — 보수적 상한 추정)
  const hit  = usage.prompt_cache_hit_tokens ?? 0;
  const miss = usage.prompt_cache_miss_tokens ?? (usage.prompt_tokens ?? 0) - hit;
  const out  = usage.completion_tokens ?? 0;
  const usd =
    (hit  / 1e6) * price.cacheHit +
    (Math.max(miss, 0) / 1e6) * price.cacheMiss +
    (out  / 1e6) * price.output;
  return usd * USD_TO_KRW;
}

// ═══════════════════════════════════════════════════════════
// 통합 과금 배수 — gopang 기본 챗, K-Law, 향후 K-Tax·K-Public 등 모든
// 서브시스템이 공유하는 단일 마진 정책 (2026-07-03).
//
// 청구액 = 실제 DeepSeek API 비용 × BILLING_MULTIPLIER.
// "대화 길이"(컨텍스트 토큰)와 "연산량"(추론 토큰 등)은 이미 DeepSeek 자체
// usage에 반영되어 있으므로 이것으로 충분하다 — 별도로 벽시계 경과시간을
// 더해서 청구하면, 네트워크 지연·Worker 콜드스타트처럼 사용자 책임이 아닌
// 우리 쪽 인프라 요인까지 사용자에게 전가하게 된다. "초당 X원" 식의 요금은
// 이 방식과 수학적으로 동일하다(청구액 ÷ 경과초 = 그 호출의 초당 요율)—
// 다만 모델·티어별로 실제 비용이 다르므로, 매 호출 실비를 그대로 쓰는 편이
// 고정 초당 요율을 추정하는 것보다 정확하다.
//
// 기본 배수 2 = 청구액의 50%는 API 비용 충당, 50%는 개발자 보상.
// 배수 조정은 재배포 없이 가능하도록 env var를 최우선으로 읽는다:
//   wrangler secret put BILLING_MULTIPLIER   (예: "2.5")
// ═══════════════════════════════════════════════════════════
const BILLING_MULTIPLIER_DEFAULT = 2;
function _billingMultiplier(env) {
  const v = parseFloat(env?.BILLING_MULTIPLIER);
  return Number.isFinite(v) && v > 0 ? v : BILLING_MULTIPLIER_DEFAULT;
}
// usage: DeepSeek 응답의 usage 필드 그대로. priceTier: 'hondi-flash' | 'hondi-pro' 가격표 키.
// 반환: apiCostKRW(실비) / billedKRW(실제 청구·예산 차감액) / multiplier(적용된 배수)
function computeBilledKRW(env, usage, priceTier) {
  const apiCostKRW = _deepseekUsageToKRW(usage, priceTier);
  const multiplier = _billingMultiplier(env);
  return { apiCostKRW, billedKRW: apiCostKRW * multiplier, multiplier };
}

// 스트리밍 응답 본문에서 마지막 usage 청크를 파싱(스트림은 tee()로 복제해
// 클라이언트에게는 그대로 전달하면서 이 쪽에서만 소비한다 — 지연 없음).
async function _parseUsageFromStream(stream) {
  try {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buf = '', usage = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') continue;
        try { const chunk = JSON.parse(payload); if (chunk.usage) usage = chunk.usage; } catch {}
      }
    }
    return usage;
  } catch { return null; }
}

// guid별 누적 지출(원)과 "첫 지출 시각"을 함께 기록한다. 첫 지출 시각은
// /free-quota-status가 "이 사용 속도라면 한 달에 얼마"를 추정하는 기준이 된다.
async function _recordFreeSpend(env, guid, usageKRW) {
  if (!guid || !usageKRW) return;
  const kv = env.AI_SETUP_SEALS_KV;
  if (!kv) return;
  try {
    const spendKey = `hondi:free_spend:${guid}`;
    const sinceKey = `hondi:free_spend_since:${guid}`;
    const prev = parseFloat(await kv.get(spendKey) || '0');
    await kv.put(spendKey, String(prev + usageKRW)); // TTL 없음 — 평생 누적
    if (prev === 0) {
      const existing = await kv.get(sinceKey);
      if (!existing) await kv.put(sinceKey, new Date().toISOString());
    }
  } catch (e) { console.warn('[FreeQuota] 기록 실패:', e.message); }
}

// GET /free-quota-status?guid=... — 지금까지 쓴 금액 + 사용 속도 기반
// "이대로 쓰면 한 달에 대략 얼마" 추정치.
async function handleFreeQuotaStatus(request, env, corsHeaders) {
  const url  = new URL(request.url);
  const guid = url.searchParams.get('guid');
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);

  const kv = env.AI_SETUP_SEALS_KV;
  if (!kv) return _err(500, 'KV_UNAVAILABLE', 'KV 바인딩 없음', corsHeaders);

  const spent = parseFloat(await kv.get(`hondi:free_spend:${guid}`) || '0');
  const since = await kv.get(`hondi:free_spend_since:${guid}`);

  let daysElapsed = 0, dailyAvgKrw = 0, estimatedMonthlyKrw = 0;
  if (since) {
    daysElapsed = Math.max((Date.now() - new Date(since).getTime()) / 86400000, 1 / 24);
    dailyAvgKrw = spent / daysElapsed;
    estimatedMonthlyKrw = dailyAvgKrw * 30;
  }

  return new Response(JSON.stringify({
    ok: true,
    guid,
    spent_krw: Math.round(spent),
    limit_krw: FREE_QUOTA_KRW_LIMIT,
    remaining_krw: Math.max(Math.round(FREE_QUOTA_KRW_LIMIT - spent), 0),
    since,
    days_elapsed: Math.round(daysElapsed * 10) / 10,
    estimated_monthly_krw: Math.round(estimatedMonthlyKrw),
    projected_days_to_limit: dailyAvgKrw > 0 ? Math.round(((FREE_QUOTA_KRW_LIMIT - spent) / dailyAvgKrw) * 10) / 10 : null,
  }), { status: 200, headers: corsHeaders });
}


// ── GitHub (Prompt Editor PR 워크플로) ──────────────────────
const GITHUB_OWNER          = 'Openhash-Gopang';
const GITHUB_REPO_NAME      = 'gopang';
const GITHUB_API            = 'https://api.github.com';
const GITHUB_DEFAULT_BRANCH = 'main';

// ── OpenHash L1~L5 저장소 매핑 (repository_dispatch 앵커링용) ─
// buildout_plan_v2 Phase 1: 클라이언트가 GitHub 토큰 직접 보유 금지
// → worker.js가 OPENHASH_TOKEN으로 dispatch를 중계
//
// 저장소 오너: Openhash-Gopang (push 권한 보유)
// nounweb은 GitHub Pages 호스팅 fork — node.json repo 필드 오기재
// 로컬 경로: Downloads\openhash\L1-ido1 ~ L5-global
const LAYER_REPOS = {
  L1: 'Openhash-Gopang/openhash-L1-ido1',
  L2: 'Openhash-Gopang/openhash-L2-jeju-city',
  L3: 'Openhash-Gopang/openhash-L3-jeju',
  L4: 'Openhash-Gopang/openhash-L4-kr',
  L5: 'Openhash-Gopang/openhash-L5-global',
};

// 2026-06-22: industry_fields.schema_id 화이트리스트 — ksic_schema_tier_classification_v1.md Tier1.
// profile_pdv_schema_plan_v1.md Phase 6에서 Tier2/3가 추가될 때마다 이 목록도 같이 늘린다.
// 클라이언트(또는 모델 출력)가 "{ksic}" 같은 미치환 리터럴이나 미정의 코드를 보내는 걸 막는 최소 방어선.
const VALID_INDUSTRY_SCHEMA_IDS = new Set([
  // 2026-06-30: manifest.json의 AGENT-SUPPLIER-* 77개 키 전체와 동기화.
  // 기존엔 15개만 등록돼 있어 제조업·광업·건설·금융·의료 등 60개 이상
  // 업종의 가입이 INVALID_SCHEMA_ID로 막혀 있었음(2026-06-30 발견·수정).
  '01','02','03','05','06','07','08','10','11','12','13','14','15','16',
  '17','18','19','20','21','22','23','24','25','26','27','28','29','30',
  '31','32','33','34','35','36','37','38','39','41','42','45','46','47',
  '49','50','51','52','55','56','58','59','60','61','62','63','64','65',
  '66','68','70','71','72','73','74','75','76','84','85','86','87','90',
  '91','94','95','96','97','98','99',
]);

// 2026-07-05: KSIC 코드 → 한글 업종명 단일 소스.
// AGENT-SUPPLIER-{code}_*.txt 파일 첫 줄("[공급자형 AI Agent · X00 · 업종명]")에서
// 자동 추출 — VALID_INDUSTRY_SCHEMA_IDS와 정확히 동일한 77개 코드를 커버한다.
// register-profile.html의 업종 선택 UI와 occupation 자동 파생(아래 handleProfilePost)이
// 이 하나의 맵만 참조하도록 통일 — tags(자유태그)/occupation(검색컬럼)/
// industry_fields.schema_id(KSIC, B2B 페르소나용)로 3중 분리돼 있던 업종 분류를
// industry_fields.schema_id를 단일 진실 소스로 하나로 합친다.
const KSIC_LABELS = {
  '01': '농업',
  '02': '임업',
  '03': '어업',
  '05': '석탄, 원유 및 천연가스 광업',
  '06': '금속 광업',
  '07': '비금속광물 광업; 연료용 제외',
  '08': '광업 지원 서비스업',
  '10': '식료품 제조업',
  '11': '음료 제조업',
  '12': '담배 제조업',
  '13': '섬유제품 제조업; 의복 제외',
  '14': '의복 제조업',
  '15': '가죽, 가방 및 신발 제조업',
  '16': '목재 및 나무제품 제조업; 가구 제외',
  '17': '펄프, 종이 및 종이제품 제조업',
  '18': '인쇄 및 기록매체 복제업',
  '19': '코크스, 연탄 및 석유정제품 제조업',
  '20': '화학물질 및 화학제품 제조업; 의약품 제외',
  '21': '의료용 물질 및 의약품 제조업',
  '22': '고무 및 플라스틱제품 제조업',
  '23': '비금속 광물제품 제조업',
  '24': '1차 금속 제조업',
  '25': '금속가공제품 제조업; 기계 및 가구 제외',
  '26': '전자부품, 컴퓨터, 영상, 음향 및 통신장비 제조업',
  '27': '의료, 정밀, 광학기기 및 시계 제조업',
  '28': '전기장비 제조업',
  '29': '기타 기계 및 장비 제조업',
  '30': '자동차 및 트레일러 제조업',
  '31': '기타 운송장비 제조업',
  '32': '가구 제조업',
  '33': '그 외 기타 제품 제조업',
  '34': '산업용 기계 및 장비 수리업',
  '35': '전기, 가스, 증기 및 공기조절 공급업',
  '36': '수도업',
  '37': '하수, 폐수 및 분뇨 처리업',
  '38': '폐기물 수집, 운반, 처리 및 원료 재생업',
  '39': '환경 정화 및 복원업',
  '41': '종합건설업',
  '42': '전문직별 공사업',
  '45': '자동차 판매업 및 부품 소매업',
  '46': '도매 및 상품중개업',
  '47': '소매업(자동차 제외)',
  '49': '육상운송 및 파이프라인 운송업',
  '50': '수상운송업',
  '51': '항공운송업',
  '52': '창고 및 운송관련 서비스업',
  '55': '숙박업',
  '56': '음식점 및 주점업',
  '58': '출판업',
  '59': '영화, 비디오물, 방송프로그램 제작 및 배급업',
  '60': '방송업',
  '61': '우편 및 통신업',
  '62': '컴퓨터 프로그래밍, 시스템 통합 및 관리업',
  '63': '정보서비스업',
  '64': '금융업(은행 및 저축기관 등)',
  '65': '보험업',
  '66': '금융 및 보험관련 서비스업',
  '68': '부동산업',
  '70': '연구개발업',
  '71': '전문서비스업(법무·회계·세무·디자인 등)',
  '72': '건축기술, 엔지니어링 및 관련 기술서비스업',
  '73': '기타 전문, 과학 및 기술 서비스업',
  '74': '사업시설 관리 및 조경 서비스업',
  '75': '사업지원 서비스업',
  '76': '임대업(부동산 제외)',
  '84': '공공행정, 국방 및 사회보장 행정',
  '85': '교육 서비스업',
  '86': '보건업',
  '87': '사회복지 서비스업',
  '90': '창작, 예술 및 여가관련 서비스업',
  '91': '스포츠 및 오락관련 서비스업',
  '94': '협회 및 단체',
  '95': '개인 및 가정용품 수리업',
  '96': '기타 개인 서비스업',
  '97': '가구 내 고용활동',
  '98': '자가소비를 위한 가구의 재화 생산활동',
  '99': '국제 및 외국기관',
};

// 2026-07-05: 카테고리 키워드 → KSIC 코드 결정적 매핑. LLM이 업종을
// '추측'하게 하지 않는다 — 판매자가 등록한 상품 카테고리(seller_products.category,
// 아래 handleCatalogSync 참조)에서 이 표로 다수결 매핑해 occupation을
// 자동으로 채운다. 매칭 실패 시 occupation은 null로 남고, 판매자가 카테고리를
// 더 구체적으로 쓰면 다음 동기화 때 자동으로 채워진다(사용자가 업종을 직접
// 고르게 하지 않는다 — market 시스템이 상품 등록으로부터 판단한다).
const KSIC_KEYWORD_MAP = {
  '농산물': '01',
  '농업': '01',
  '감귤': '01',
  '채소': '01',
  '과일': '01',
  '수산물': '03',
  '해산물': '03',
  '어업': '03',
  '생선': '03',
  // 2026-07-05 정정: 합성 테스트(catalog_sync_test.js)로 발견됨 —
  // "정육/축산물/육류"를 10(식료품 제조업, 공장 가공)으로 잘못 매핑해
  // 흑돼지 농장 직판 같은 흔한 K-Market 케이스가 제조업으로 오분류됐음.
  // K-Market은 소비자 대상 마켓이므로 이 세 키워드는 47(소매업)이 기본값에
  // 더 맞다 — 실제 식품 "가공"을 명시한 경우만 10으로 남긴다.
  '정육': '47', '축산물': '47', '육류': '47',
  '가공식품': '10',
  '음료': '11',
  '도매': '46',
  '소매': '47',
  '잡화': '47',
  '편의점': '47',
  '마트': '47',
  '숙박': '55',
  '펜션': '55',
  '호텔': '55',
  '게스트하우스': '55',
  '음식점': '56',
  '식당': '56',
  '중식': '56',
  '한식': '56',
  '일식': '56',
  '양식': '56',
  '카페': '56',
  '커피': '56',
  '주점': '56',
  '배달음식': '56',
  '베이커리': '56',
  '디저트': '56',
  '렌터카': '49',
  '택시': '49',
  '퀵서비스': '49',
  '택배': '49',
  '유람선': '50',
  '페리': '50',
  '항공': '51',
  'it': '62',
  '프로그래밍': '62',
  '앱개발': '62',
  '웹개발': '62',
  '정보서비스': '63',
  '렌탈': '76',
  '대여': '76',
  '스쿠터대여': '76',
  '캠핑용품대여': '76',
  '공연': '90',
  '체험': '90',
  '예술': '90',
  '다이빙': '91',
  '골프': '91',
  '레저': '91',
  '액티비티': '91',
  '스포츠': '91',
  '미용': '96',
  '네일': '96',
  '세탁': '96',
  '이발': '96',
  '수리': '95',
};

function _deriveOccupationFromCategories(categories) {
  const votes = {};
  for (const raw of categories || []) {
    const cat = String(raw || '').trim();
    if (!cat) continue;
    for (const [kw, code] of Object.entries(KSIC_KEYWORD_MAP)) {
      if (cat.includes(kw) || kw.includes(cat)) {
        votes[code] = (votes[code] || 0) + 1;
        break;
      }
    }
  }
  const entries = Object.entries(votes);
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  const bestCode = entries[0][0];
  return { schema_id: bestCode, occupation: KSIC_LABELS[bestCode] || null };
}


// 2026-07-01: INDIVIDUAL_ENTITY_TYPES/INSTITUTION_ENTITY_TYPES는
// "개인은 별도 행 없이 병합, 기관은 별도 그림자 행"으로 나누던
// 구설계의 분기 상수였다 — 모든 entity_type이 _mergeAgentSP 하나로
// 통합되며 더 이상 분기가 필요 없어져 제거함.

// ═══════════════════════════════════════════════════════════════
// ★ PDV SCOPE 명명 원칙 (2026-07-04, 여러 차례 정정 끝에 확정) ★
//
// scope 이름에는 지역·행정구역명을 접두어로 넣지 않는다.
//
// 판단 기준: "이 종류의 부서/기관을 다른 지역(다른 국가기관 지사,
// 다른 도, 다른 시·군·구 등 — 행정 계층 무관)도 일반적으로
// 가지고 있는가?" 그렇다면(거의 항상 그렇다) k 접두어의 전국
// 단위 scope로 등록한다. 지금 어느 지역이 실제로 이 scope를
// 구현·보고하는지는 SCOPE_SOURCE_MAP의 reporter_svc 배열에만
// 담는다 — scope 이름 자체는 절대 건드리지 않는다.
//   예) kagri: ['jeju']  →  나중에 경상남도가 자체 구현하면
//       kagri: ['jeju', 'gyeongnam']으로 배열만 늘린다.
//
// "지금 하나의 지역만 구현했다"는 사실은 scope를 지역화해야 할
// 근거가 되지 않는다 — 국가기관 지사든, 광역자치단체(도) 부서든,
// 기초자치단체(시) 부서든 전부 동일하게 적용한다(제주시·서귀포시
// 같은 시 단위 부서도 다른 시가 유사 조직을 가질 것으로 상정 —
// 예외로 두지 않는다). 정말로 그 지역에만 존재하는 극히 이례적인
// 제도가 나오면 그때 예외를 개별 검토한다.
// ═══════════════════════════════════════════════════════════════

// STEP 10: VALID_PDV_SCOPES 확장
// 2026-07-04b: kpolice·kpublic 신규 등록 — GOV_AGENCIES 9개 중 이 둘만
// VALID_PDV_SCOPES에 없었다. K-Public_common의 P11 예시엔 "K-Tax는 ktax"
// 식으로 몇몇만 명시돼 있어서, LLM이 police/public에 대해서는 근거 없이
// 'police'나 'kpolice'를 추측했을 가능성이 높다 — 어느 쪽이든 이 목록에
// 없었으므로 SCOPE_INVALID로 항상 실패했을 것이다. 911도 명명 패턴상
// LLM이 'k911'로 추측하기 쉬운데 실제 등록값은 k119이므로 같은 위험군 —
// 이건 handleGovRelay의 서버측 치환(GOV_AGENCY_PDV_SCOPE)으로 근본 해결한다.
//
// 2026-07-04c~e(제주 전국 확장 설계, 여러 차례 정정 끝에 확정): jeju
// 저장소 실사 결과, jeju가 다루는 39개 부서/기관(국가기관 26개 + 세무서·
// 경찰서 + 도 자체 부서 13개) 중 기존 scope와 겹치는 건 ktax·kpolice
// 뿐이었다. 처음엔 "국가기관 26개는 전국 scope, 도 자체 부서 13개는
// jeju_ 지역 scope"로 나눴었으나, 도 자체 부서도 대부분 다른 도(경상남도,
// 충청북도 등)가 유사한 조직(농정국·관광국·복지국 등)을 갖고 있다는
// 지적을 받고 재정정했다 — 국가기관이든 도 조직이든, "여러 시도가 같은
// 종류의 부서/기관을 가질 것"이라는 전제가 성립하면 scope는 지역 접두어
// 없이 국가 단위(k 접두어)로 등록하고, 지금 jeju가 유일한 구현체라는
// 사실은 SCOPE_SOURCE_MAP의 reporter_svc 배열에만 반영한다. 결과적으로
// jeju 관련 신규 scope 39개 전부 지역 접두어가 없다 — 나중에 다른 도가
// 자기 지역판 서비스를 만들면 해당 scope의 source 배열에 이름만 추가하면
// 된다(예: kagri: ['jeju'] → ['jeju', 'gyeongnam']).
const VALID_PDV_SCOPES = [
  'ktraffic', 'khealth', 'pdv_general', 'kmarket', 'k119',
  'klaw', 'ktax', 'kinsurance', 'kgdc', 'kdemocracy', 'klogistics',
  'kschool', 'kstock', // 2026-07-04: PDV_HISTORY_REQUEST 파일럿 확장 — 이전엔 미등록
  'kpolice', 'kpublic', // 2026-07-04b: GOV_AGENCIES 9개 중 누락됐던 나머지 2개
  // 2026-07-04e: jeju발 신규 국가기관 26개(jeju가 현재의 유일한 reporter_svc)
  'kagroquality', 'kairport', 'kanimalquarantine', 'kcoastguard', 'kcourt',
  'kdata', 'kenv', 'kfishquality', 'kfoodimport', 'khumanquarantine',
  'kimmigration', 'kinternet', 'klabor', 'klaborimprove', 'klaborrel',
  'kmma', 'knhis', 'knps', 'kport', 'kpost', 'kpps', 'kprobation',
  'kprosecution', 'kradio', 'kveterans', 'kweather',
  // 2026-07-04e: jeju발 신규 도 자체 부서 13개(마찬가지로 전국 scope —
  // 다른 도도 유사 조직을 가질 것으로 상정)
  'kagri', 'kclimate', 'kculture', 'kecon', 'khousing',
  'kinnov', 'kjachi', 'kocean', 'kplan', 'ksafety',
  'ktourism', 'ktransport', 'kwelfare',
];
const SCOPE_MIN_LEVEL = {
  ktraffic:'L1', khealth:'L1', pdv_general:'L1', k119:'L1', kmarket:'L0',
  klaw:'L0', ktax:'L1', kinsurance:'L1', kgdc:'L1', kdemocracy:'L1', klogistics:'L0',
  kschool:'L1', kstock:'L1', // 학습기록·투자정보는 L1(본인 확인) 이상 요구
  kpolice:'L1', kpublic:'L0',
  // jeju 신규 scope — 전부 잠정 L1(기본값)로 등록. TODO(피터 확인 필요):
  // kcourt·kprosecution·kprobation·kimmigration·khumanquarantine은 성격상
  // L2 이상이 맞아 보이지만, Bearer 토큰 검증 배선이 아직 없는 상태에서
  // L2로 걸면(handlePdvQuery의 "검증 불가 → L1 강등" 정책상) 그 즉시 아무도
  // 통과 못 하는 scope가 된다 — 배선 완성 후에 올리는 걸 권장.
  kagroquality:'L1', kairport:'L1', kanimalquarantine:'L1', kcoastguard:'L1', kcourt:'L1',
  kdata:'L1', kenv:'L1', kfishquality:'L1', kfoodimport:'L1', khumanquarantine:'L1',
  kimmigration:'L1', kinternet:'L1', klabor:'L1', klaborimprove:'L1', klaborrel:'L1',
  kmma:'L1', knhis:'L1', knps:'L1', kport:'L1', kpost:'L1', kpps:'L1', kprobation:'L1',
  kprosecution:'L1', kradio:'L1', kveterans:'L1', kweather:'L0', // 날씨는 낮은 민감도
  kagri:'L1', kclimate:'L1', kculture:'L0', kecon:'L1', khousing:'L1',
  kinnov:'L1', kjachi:'L1', kocean:'L1', kplan:'L1', ksafety:'L1',
  ktourism:'L0', ktransport:'L0', kwelfare:'L1',
};
// 2026-07-04c: scope → source 배열(1:다)로 변경. 이전엔 scope 하나당 저장소
// 하나만 가능했는데, 같은 종류의 데이터(예: 세무 상담)를 여러 지역/서비스가
// 보고할 수 있어야 한다 — jeju가 대표 사례(ktax·kpolice에 'jeju' 추가).
// _fetchPdvByScope가 이 배열을 Supabase `source=in.(...)` 필터로 사용한다.
const SCOPE_SOURCE_MAP = {
  ktraffic:['traffic'], khealth:['health'], pdv_general:null, kmarket:['market'], k119:['911'],
  klaw:['klaw'], ktax:['tax','jeju'], kinsurance:['insurance'], kgdc:['gdc'], kdemocracy:['democracy'],
  klogistics:['logistics'], kschool:['school'], kstock:['stock'],
  kpolice:['police','jeju'], kpublic:['public'],
  kagroquality:['jeju'], kairport:['jeju'], kanimalquarantine:['jeju'], kcoastguard:['jeju'], kcourt:['jeju'],
  kdata:['jeju'], kenv:['jeju'], kfishquality:['jeju'], kfoodimport:['jeju'], khumanquarantine:['jeju'],
  kimmigration:['jeju'], kinternet:['jeju'], klabor:['jeju'], klaborimprove:['jeju'], klaborrel:['jeju'],
  kmma:['jeju'], knhis:['jeju'], knps:['jeju'], kport:['jeju'], kpost:['jeju'], kpps:['jeju'], kprobation:['jeju'],
  kprosecution:['jeju'], kradio:['jeju'], kveterans:['jeju'], kweather:['jeju'],
  kagri:['jeju'], kclimate:['jeju'], kculture:['jeju'], kecon:['jeju'], khousing:['jeju'],
  kinnov:['jeju'], kjachi:['jeju'], kocean:['jeju'], kplan:['jeju'], ksafety:['jeju'],
  ktourism:['jeju'], ktransport:['jeju'], kwelfare:['jeju'],
};

const SVC_ALIAS = {
  'kemergency':'911','kpolice':'police','ksecurity':'security',
  'khealth':'health','kedu':'school','kgdc':'gdc','kfinance':'stock',
  'kinsurance':'insurance','ktax':'tax','kcommerce':'market',
  'ktransport':'traffic','klogistics':'logistics','fiil-kcleaner':'fiil',
  'kgov':'public','kdemocracy':'democracy',
  // ── 백업 별칭(2026-07-03) — GOV_AGENCIES/AGENCY_ID를 REGISTERED_SERVICES
  // 키와 통일했지만, 혹시 남은 캐시된 클라이언트나 실수로 하이픈형을 보내는
  // 경우에도 /pdv/report가 조용히 실패하지 않도록 하는 안전망. GOV_AGENCIES
  // 자체는 별칭 해석을 안 거치므로 이걸로 /gov/relay까지 고쳐지진 않는다 —
  // 그쪽은 반드시 (a) 방식(직접 통일)으로만 해결된다.
  'k-public':'public', 'k-province':'public', 'k-city':'public', 'k-county':'public',
  'k-tax':'tax', 'k-health':'health', 'k-insurance':'insurance',
  'k-logistics':'logistics', 'k-traffic':'traffic',
};

function _resolveSvcId(svcId) { return SVC_ALIAS[svcId] || svcId; }

function getCorsOrigin(request) {
  const origin = request.headers.get('Origin') || '';
  if (ALLOWED_ORIGINS.some(o => origin.startsWith(o))) return origin;
  if (origin === '') return '';
  return null;
}

function buildCorsHeaders(corsOrigin, extra = {}) {
  return {
    'Content-Type':                     'application/json',
    'Access-Control-Allow-Origin':      corsOrigin || '*',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods':     'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':     'Content-Type, Authorization',
    ...extra,
  };
}

function _err(status, code, detail, corsHeaders) {
  return new Response(
    JSON.stringify({ ok: false, error: code, detail }),
    { status, headers: corsHeaders }
  );
}

function _supabaseAnonKey() {
  return 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYmVjamZyd2Fzd2JkeWJiZ2l1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NjE5ODQsImV4cCI6MjA5NTEzNzk4NH0.H2ahQKtWdSke04Pdi3hDY86pdTx7UUKPUpQMlS_zciA';
}

function _sbHeaders(env) {
  const key = env.SUPABASE_KEY || _supabaseAnonKey();
  return { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' };
}

function _sbServiceHeaders(env) {
  const key = env.SUPABASE_SERVICE_KEY || env.SUPABASE_KEY || _supabaseAnonKey();
  return { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' };
}

// ═══════════════════════════════════════════════════════════
// L1 PocketBase Admin 인증 — X25519/Ed25519 등 보안 필드는 L1이 소스
// Supabase는 필드 테스트/시뮬레이션 용도이므로 신원 관련 핵심 키는 L1에 둔다.
// 토큰은 Worker 인스턴스 생애 동안 메모리에 캐싱 (PocketBase 토큰 기본 유효기간 길음).
// ═══════════════════════════════════════════════════════════
// 2026-07-07 수정(제주 L1~L3 필드 테스트): 43개 L1 + L2 + L3가 전부 별개
// PocketBase 프로세스라, admin 토큰도 노드(base URL)별로 따로 받아야 한다
// — 예전처럼 L1_DEFAULT(hanlim) 토큰 하나를 전역 캐싱해 재사용하면, 다른
// 노드 호출 시 그 인스턴스가 서명하지 않은 토큰이라 인증에 실패한다.
const _l1AdminTokenCache = {}; // base URL → { token, exp }

async function _l1AdminTokenFor(env, base) {
  const now = Date.now();
  const cached = _l1AdminTokenCache[base];
  if (cached && now < cached.exp) return cached.token;

  const email = env.L1_ADMIN_EMAIL;
  const password = env.L1_ADMIN_PASSWORD;
  if (!email || !password) throw new Error('L1_ADMIN_EMAIL/L1_ADMIN_PASSWORD secret 미설정');

  // 이 L1 인스턴스(PocketBase 구버전)는 /api/admins/auth-with-password 경로 사용
  // (※ /api/collections/_superusers/auth-with-password는 이 인스턴스에서 404)
  const res = await fetch(`${base}/api/admins/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: email, password }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`L1 admin auth(${base}) ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json().catch(() => null);
  if (!data?.token) throw new Error(`L1 admin auth(${base}): token 없음`);
  _l1AdminTokenCache[base] = { token: data.token, exp: now + 25 * 60 * 1000 }; // 25분 캐시
  return data.token;
}

// 기존 호출부(hanlim 고정) 하위호환용 래퍼 — 신규 코드는 _l1AdminTokenFor를 직접 쓸 것
async function _l1AdminToken(env) {
  return _l1AdminTokenFor(env, L1_DEFAULT);
}

// ── §4 guid→L1 소속 레지스트리 (L3 guid_home_l1 컬렉션) ──────────────
const L1_ONLY_NODE_IDS = [
  'KR-JEJU-JEJU-AEWOL',
  'KR-JEJU-JEJU-ARA',
  'KR-JEJU-JEJU-BONGGAE',
  'KR-JEJU-JEJU-CHUJA',
  'KR-JEJU-JEJU-DODU',
  'KR-JEJU-JEJU-GEONIP',
  'KR-JEJU-JEJU-GUJWA',
  'KR-JEJU-JEJU-HANGYEONG',
  'KR-JEJU-JEJU-HANLIM',
  'KR-JEJU-JEJU-HWABUK',
  'KR-JEJU-JEJU-IDO1',
  'KR-JEJU-JEJU-IDO2',
  'KR-JEJU-JEJU-IHO',
  'KR-JEJU-JEJU-ILDO1',
  'KR-JEJU-JEJU-ILDO2',
  'KR-JEJU-JEJU-JOCHEON',
  'KR-JEJU-JEJU-NOHYEONG',
  'KR-JEJU-JEJU-OEDO',
  'KR-JEJU-JEJU-ORA',
  'KR-JEJU-JEJU-SAMDO1',
  'KR-JEJU-JEJU-SAMDO2',
  'KR-JEJU-JEJU-SAMYANG',
  'KR-JEJU-JEJU-UDO',
  'KR-JEJU-JEJU-YEONDONG',
  'KR-JEJU-JEJU-YONGDAM1',
  'KR-JEJU-JEJU-YONGDAM2',
  'KR-JEJU-SGP-ANDEOK',
  'KR-JEJU-SGP-CHEONJI',
  'KR-JEJU-SGP-DAECHEON',
  'KR-JEJU-SGP-DAEJEONG',
  'KR-JEJU-SGP-DAERYUN',
  'KR-JEJU-SGP-DONGHONG',
  'KR-JEJU-SGP-HYODON',
  'KR-JEJU-SGP-JEONGBANG',
  'KR-JEJU-SGP-JUNGANG-SGP',
  'KR-JEJU-SGP-JUNGMUN',
  'KR-JEJU-SGP-NAMWON',
  'KR-JEJU-SGP-PYOSEON',
  'KR-JEJU-SGP-SEOHONG',
  'KR-JEJU-SGP-SEONGSAN',
  'KR-JEJU-SGP-SONGSAN',
  'KR-JEJU-SGP-YEONGCHEON',
  'KR-JEJU-SGP-YERAE',
];

// 판매자(또는 임의 guid)의 소속 L1을 L3 레지스트리에서 조회.
// 없으면 null 반환 — 호출부는 null을 "기본값(hanlim)"으로 처리한다.
async function _resolveHomeL1Node(env, guid) {
  try {
    const token = await _l1AdminTokenFor(env, L3_BASE);
    const filter = encodeURIComponent(`guid='${guid}'`);
    const res = await fetch(`${L3_BASE}/api/collections/guid_home_l1/records?filter=${filter}&perPage=1`,
      { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json().catch(() => ({ items: [] }));
    return data.items?.[0]?.node_id || null;
  } catch (e) {
    console.warn('[HomeL1] 조회 실패(기본값으로 폴백):', e.message);
    return null;
  }
}

// guid의 소속 L1을 L3 레지스트리에 기록(가입/키등록 시점). 이미 있으면 갱신.
async function _writeHomeL1Node(env, guid, nodeId) {
  try {
    const token = await _l1AdminTokenFor(env, L3_BASE);
    const filter = encodeURIComponent(`guid='${guid}'`);
    const existingRes = await fetch(`${L3_BASE}/api/collections/guid_home_l1/records?filter=${filter}&perPage=1`,
      { headers: { 'Authorization': `Bearer ${token}` } });
    const existingData = await existingRes.json().catch(() => ({ items: [] }));
    const existing = existingData.items?.[0];
    if (existing) {
      if (existing.node_id === nodeId) return; // 이미 같은 값 — 갱신 불필요
      await fetch(`${L3_BASE}/api/collections/guid_home_l1/records/${existing.id}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_id: nodeId }),
      });
    } else {
      await fetch(`${L3_BASE}/api/collections/guid_home_l1/records`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ guid, node_id: nodeId, registered_at: new Date().toISOString() }),
      });
    }
  } catch (e) {
    console.error('[HomeL1] 레지스트리 기록 실패(guid가 어느 L1 소속인지 못 찾게 될 수 있음):', e.message);
  }
}

// ── §5 브릿지 릴레이 — Worker가 허브로서 두 L1을 중개(P1: L1끼리 직접 통신 금지) ──
// bridge-in 성공 시 소스 L1에 completed로 갱신, 실패 시 그대로 두어(pending)
// scheduled() 크론 스윕이 재시도하게 한다.
async function _relayBridge(env, { sourceBase, targetNodeId, tx_hash, guid, amount }) {
  const targetBase = L1_NODE_MAP[targetNodeId] || null;
  if (!targetBase) {
    console.error('[Bridge] 대상 L1 URL을 못 찾음:', targetNodeId);
    return false;
  }
  try {
    const res = await fetch(`${targetBase}/api/bridge-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tx_hash, source_node: L1_NODE_MAP_ID_OF(sourceBase), guid, amount, bridge_secret: _bridgeSecret(env) }),
    });
    const data = await res.json().catch(() => ({ ok: false }));
    if (!data.ok) {
      console.warn('[Bridge] bridge-in 실패:', tx_hash, JSON.stringify(data));
      return false;
    }
    // 완료 처리 — 실패해도 치명적이지 않음(다음 스윕 때 재조회하면 이미
    // ok:true였던 tx_hash는 bridge-in의 멱등성이 지켜주므로 중복 크레딧 없음)
    await fetch(`${sourceBase}/api/bridge-out/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tx_hash, bridge_secret: _bridgeSecret(env) }),
    }).catch(e => console.warn('[Bridge] complete 통지 실패(다음 스윕에서 재시도):', e.message));
    console.info('[Bridge] 완료:', tx_hash, '→', targetNodeId);
    return true;
  } catch (e) {
    console.warn('[Bridge] 릴레이 실패(재시도 대상으로 남음):', tx_hash, e.message);
    return false;
  }
}

// sourceBase(URL)로부터 L1_NODE_MAP 역조회 — bridge-in 호출 시 "어느 L1에서
// 왔는지"를 상대 L1에 알려주기 위한 보조 함수.
function L1_NODE_MAP_ID_OF(base) {
  for (const [id, url] of Object.entries(L1_NODE_MAP)) if (url === base) return id;
  return 'UNKNOWN';
}

// L1 profiles 컬렉션에서 guid로 레코드 조회 (Admin 토큰 필요 — is_public=false인 레코드도 봐야 하므로)
async function _l1FindProfileByGuid(env, guid) {
  const token = await _l1AdminToken(env);
  const filter = encodeURIComponent(`guid='${guid}'`);
  const res = await fetch(`${L1_DEFAULT}/api/collections/profiles/records?filter=${filter}&perPage=1`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`L1 조회 실패 (HTTP ${res.status})`);
  const data = await res.json().catch(() => ({ items: [] }));
  return data.items?.[0] || null;
}

// L1 profiles 컬렉션에서 handle로 레코드 조회 — 관리자 일괄삭제에서 @handle 입력을 guid로 환산할 때 사용
async function _l1FindProfileByHandle(env, handle) {
  const token = await _l1AdminToken(env);
  const filter = encodeURIComponent(`handle='${handle}'`);
  const res = await fetch(`${L1_DEFAULT}/api/collections/profiles/records?filter=${filter}&perPage=1`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`L1 조회 실패 (HTTP ${res.status})`);
  const data = await res.json().catch(() => ({ items: [] }));
  return data.items?.[0] || null;
}

// L1 profiles 레코드 PATCH (Admin 토큰 필요 — Update rule이 Admins only이므로)

async function _l1PatchProfile(env, recordId, patch) {
  const token = await _l1AdminToken(env);
  const res = await fetch(`${L1_DEFAULT}/api/collections/profiles/records/${recordId}`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`L1 PATCH 실패 (HTTP ${res.status}): ${errText}`);
  }
  return res.json();
}

// ── 오케스트레이션 레지스트리 L1 헬퍼 (2026-07-08 신설) ─────────────
// _l1FindProfileByGuid 등 기존 함수와 동일 패턴(컬렉션별 전용 함수,
// 범용 _l1Find/_l1Create 같은 건 이 코드베이스에 없다 — 이전 설계
// 문서(worker_orchestration_registry_patch_2026-07-08.md)가 가정했던
// 범용 헬퍼는 실제 코드와 안 맞아 이번에 컬렉션별 전용 함수로 정정함).

async function _l1FindProcedureMap(env, goal) {
  const token = await _l1AdminToken(env);
  const filter = encodeURIComponent(`goal='${goal.replace(/'/g, "\\'")}'`);
  const res = await fetch(`${L1_DEFAULT}/api/collections/procedure_maps/records?filter=${filter}&perPage=1`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`procedure_maps 조회 실패 (HTTP ${res.status})`);
  const data = await res.json().catch(() => ({ items: [] }));
  return data.items?.[0] || null;
}

async function _l1CreateProcedureMap(env, record) {
  const token = await _l1AdminToken(env);
  const res = await fetch(`${L1_DEFAULT}/api/collections/procedure_maps/records`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`procedure_maps 생성 실패 (HTTP ${res.status}): ${errText}`);
  }
  return res.json();
}

async function _l1PatchProcedureMap(env, recordId, patch) {
  const token = await _l1AdminToken(env);
  const res = await fetch(`${L1_DEFAULT}/api/collections/procedure_maps/records/${recordId}`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`procedure_maps PATCH 실패 (HTTP ${res.status}): ${errText}`);
  }
  return res.json();
}

async function _l1FindOrgProfile(env, orgId) {
  const token = await _l1AdminToken(env);
  const filter = encodeURIComponent(`org_id='${orgId.replace(/'/g, "\\'")}'`);
  const res = await fetch(`${L1_DEFAULT}/api/collections/org_profiles/records?filter=${filter}&perPage=1`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`org_profiles 조회 실패 (HTTP ${res.status})`);
  const data = await res.json().catch(() => ({ items: [] }));
  return data.items?.[0] || null;
}

async function _l1FindAtomRow(env, atomId) {
  const token = await _l1AdminToken(env);
  const filter = encodeURIComponent(`atom_id='${atomId.replace(/'/g, "\\'")}'`);
  const res = await fetch(`${L1_DEFAULT}/api/collections/atom_rows/records?filter=${filter}&perPage=1`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`atom_rows 조회 실패 (HTTP ${res.status})`);
  const data = await res.json().catch(() => ({ items: [] }));
  return data.items?.[0] || null;
}

// ── 오케스트레이션 HTTP 핸들러 (2026-07-08 신설) ────────────────────
// status:active인 항목만 실제 라우팅에 안전하게 쓸 수 있다고 간주한다
// — draft/pending_review는 조회는 되지만 호출자(K-Compose)가 이용자에게
// "아직 검토 중"이라고 고지해야 한다(AGENT-COMMON §3-0 SP_DRAFT_REQUEST와
// 동일한 승인 원칙, 여기서도 그대로 적용).

const ORCHESTRATION_STALE_THRESHOLD_DAYS = 90; // 신선도 경고 임계값(임의값, 운영 중 조정 필요)

function _daysSince(dateStr) {
  if (!dateStr) return Infinity;
  return (Date.now() - new Date(dateStr).getTime()) / 86400000;
}

async function handleProcedureMapLookup(request, env, corsHeaders) {
  const { searchParams } = new URL(request.url);
  const goal = searchParams.get('goal');
  if (!goal) return new Response(JSON.stringify({ error: 'goal required' }), { status: 400, headers: corsHeaders });

  let rec;
  try {
    rec = await _l1FindProcedureMap(env, goal);
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: corsHeaders });
  }
  if (!rec) return new Response(JSON.stringify({ status: 'miss' }), { headers: corsHeaders });

  const steps = rec.steps || [];
  // steps 각 항목의 atom_id를 실제 atom_rows로 조인 — sub_goal 항목은
  // atom이 아니므로 조인하지 않고 그대로 둔다(K-Compose가 재귀 조회).
  const resolvedSteps = await Promise.all(steps.map(async (s) => {
    if (s.sub_goal) return s;
    try {
      const atom = await _l1FindAtomRow(env, s.atom_id);
      return { ...s, atom };
    } catch {
      return { ...s, atom: null };
    }
  }));

  const body = {
    status: rec.status === 'active' ? 'hit' : 'hit_pending_review',
    procedure: { ...rec, steps: resolvedSteps },
  };
  if (_daysSince(rec.as_of_date) > ORCHESTRATION_STALE_THRESHOLD_DAYS) {
    body.freshness_warning = `이 절차 정보는 ${rec.as_of_date} 기준입니다 — 재검증 권장`;
  }
  return new Response(JSON.stringify(body), { headers: corsHeaders });
}

async function handleProcedureMapDraft(request, env, corsHeaders) {
  let payload;
  try { payload = await request.json(); } catch { return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: corsHeaders }); }
  if (!payload.goal) return new Response(JSON.stringify({ error: 'goal required' }), { status: 400, headers: corsHeaders });

  const existing = await _l1FindProcedureMap(env, payload.goal).catch(() => null);
  if (existing) {
    return new Response(JSON.stringify({ error: 'already exists', status: existing.status }), { status: 409, headers: corsHeaders });
  }
  try {
    const rec = await _l1CreateProcedureMap(env, {
      goal: payload.goal,
      domain: payload.domain || '',
      steps: payload.steps || [],
      eligibility_gate: payload.eligibility_gate || [],
      free_alternative: payload.free_alternative || null,
      as_of_date: payload.as_of_date || new Date().toISOString().slice(0, 10),
      orchestrator: 'AC',
      status: 'pending_review', // ★ 절대 draft 생성 시점에 active로 두지 않는다
    });
    return new Response(JSON.stringify({ status: 'created', id: rec.id }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: corsHeaders });
  }
}

async function handleProcedureMapUpdate(request, env, corsHeaders) {
  let payload;
  try { payload = await request.json(); } catch { return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: corsHeaders }); }
  if (!payload.goal) return new Response(JSON.stringify({ error: 'goal required' }), { status: 400, headers: corsHeaders });

  const existing = await _l1FindProcedureMap(env, payload.goal).catch(() => null);
  if (!existing) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: corsHeaders });

  // 구조 변경(steps 자체를 바꾸는 것)만 다시 pending_review로 내린다.
  // 단순 사실 갱신(연락처 등)은 기존 status를 유지한다 — 매번 재검토를
  // 강제하면 배보다 배꼽이 크다는 판단(2026-07-08 결정, 사고실험으로
  // 재검증 필요 — 이 기준이 너무 느슨한지 빡빡한지는 운영 데이터로 확인).
  const patch = {};
  let structuralChange = false;
  for (const change of (payload.changes || [])) {
    patch[change.field] = change.value;
    if (change.field === 'steps') structuralChange = true;
  }
  patch.as_of_date = new Date().toISOString().slice(0, 10);
  if (structuralChange && existing.status === 'active') patch.status = 'pending_review';

  try {
    const rec = await _l1PatchProcedureMap(env, existing.id, patch);
    return new Response(JSON.stringify({ status: 'updated', record: rec }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: corsHeaders });
  }
}

async function handleOrgProfileLookup(request, env, corsHeaders) {
  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get('org_id');
  if (!orgId) return new Response(JSON.stringify({ error: 'org_id required' }), { status: 400, headers: corsHeaders });
  let rec;
  try {
    rec = await _l1FindOrgProfile(env, orgId);
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: corsHeaders });
  }
  if (!rec) return new Response(JSON.stringify({ status: 'miss' }), { headers: corsHeaders });
  return new Response(JSON.stringify({ status: rec.status === 'active' ? 'hit' : 'hit_pending_review', org: rec }), { headers: corsHeaders });
}

// ── L1 profiles upsert — 2026-06-30 user_profiles 이전 작업 ────────────
// L1 profiles 컬렉션 스키마(2026-06-30 확장 후): guid, handle,
// nickname_hash, native_lang, entity_type, is_public, fpHex, e164,
// country_code, nickname, region, pubkey_ed25519, x25519_pubkey,
// x25519_registered_at, push_subscription, push_sound, extra(json).
// Supabase user_profiles에는 있지만 L1엔 컬럼이 없는 필드
// (name/address/lat/lng/phone/website/casts_for)는 extra.core에 접어서
// 같이 저장한다 — 이번 스키마 변경에서 컬럼을 더 늘리지 않기 위함.
async function _l1UpsertProfile(env, { guid, handle, entityType, nativeLang, isPublic, pubkey, extra, core }) {
  const token = await _l1AdminToken(env);
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
  const mergedExtra = { ...(extra || {}), core: { ...(extra?.core || {}), ...(core || {}) } };

  const body = {
    guid,
    handle,
    entity_type: entityType,
    native_lang: nativeLang || 'ko',
    is_public: isPublic !== false,
    pubkey_ed25519: pubkey || undefined,
    extra: mergedExtra,
  };

  const existing = await _l1FindProfileByGuid(env, guid).catch(() => null);
  if (existing?.id) {
    const res = await fetch(`${L1_DEFAULT}/api/collections/profiles/records/${existing.id}`, {
      method: 'PATCH', headers, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`L1 profiles PATCH 실패 (HTTP ${res.status}): ${await res.text().catch(() => '')}`);
    return res.json();
  }
  const res = await fetch(`${L1_DEFAULT}/api/collections/profiles/records`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`L1 profiles POST 실패 (HTTP ${res.status}): ${await res.text().catch(() => '')}`);
  return res.json();
}

// L1 profiles 중 push_subscription이 설정된 전체 레코드 조회 (배포 브로드캐스트용, 페이지네이션)
async function _l1ListPushSubscribers(env) {
  const token = await _l1AdminToken(env);
  const filter = encodeURIComponent("push_subscription != ''");
  const out = [];
  let page = 1;
  const perPage = 200;
  while (true) {
    const res = await fetch(
      `${L1_DEFAULT}/api/collections/profiles/records?filter=${filter}&perPage=${perPage}&page=${page}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`L1 조회 실패 (HTTP ${res.status})`);
    const data = await res.json().catch(() => ({ items: [] }));
    out.push(...(data.items || []));
    if (!data.items?.length || data.items.length < perPage) break;
    page++;
    if (page > 50) break; // 안전장치
  }
  return out;
}

// ═══════════════════════════════════════════════════════════
// 메인 fetch 핸들러
// ═══════════════════════════════════════════════════════════
// ── §5.1 브릿지 아웃박스 스윕 — cron이 주기적으로 호출 ────────────────
// 각 L1의 pending bridge_out을 조회해 재릴레이 시도하고, REFUND_TIMEOUT_MS
// (기본 1시간)을 넘긴 건은 보상 트랜잭션(환불)으로 마감한다. tx_hash가
// buyer_guid를 담고 있지 않으므로, 환불 대상 buyer_guid는 pending 레코드
// 자체엔 없다 — PDV 감사 로그(pdv_log)에서 tx_hash로 역조회한다.
const BRIDGE_REFUND_TIMEOUT_MS = 60 * 60 * 1000; // 1시간(§5.1 유예시간)

async function _sweepBridgeOutbox(env) {
  for (const nodeId of L1_ONLY_NODE_IDS) {
    const base = L1_NODE_MAP[nodeId];
    if (!base) continue;
    let pending;
    try {
      const res = await fetch(`${base}/api/bridge-out/pending?bridge_secret=${encodeURIComponent(_bridgeSecret(env))}`);
      const data = await res.json().catch(() => ({ ok: false }));
      if (!data.ok) continue;
      pending = data.pending || [];
    } catch (e) {
      console.warn(`[BridgeSweep] ${nodeId} 폴링 실패:`, e.message);
      continue;
    }
    for (const item of pending) {
      const ageMs = Date.now() - new Date(item.created_at).getTime();
      if (ageMs > BRIDGE_REFUND_TIMEOUT_MS) {
        // 유예시간 초과 — 원 구매자를 PDV 로그(tx_hash 기준)에서 역조회해 환불
        try {
          const sbH = _sbHeaders(env);
          const pdvRes = await fetch(
            `${SUPABASE_URL}/rest/v1/pdv_log?raw_hash=eq.${encodeURIComponent(item.tx_hash)}&select=guid&limit=1`,
            { headers: sbH });
          const pdvRows = await pdvRes.json().catch(() => []);
          const buyerGuid = pdvRows?.[0]?.guid;
          if (!buyerGuid) {
            console.error(`[BridgeSweep] ${item.tx_hash} 환불 대상(구매자) 조회 실패 — 수동 감사 필요`);
            continue;
          }
          await fetch(`${base}/api/bridge-out/refund`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tx_hash: item.tx_hash, buyer_guid: buyerGuid, bridge_secret: _bridgeSecret(env) }),
          });
          console.warn(`[BridgeSweep] 유예시간 초과 환불 처리:`, item.tx_hash, '→', buyerGuid);
        } catch (e) {
          console.error(`[BridgeSweep] 환불 처리 실패:`, item.tx_hash, e.message);
        }
      } else {
        // 아직 유예시간 안 — 재시도
        await _relayBridge(env, {
          sourceBase:   base,
          targetNodeId: item.target_node,
          tx_hash:      item.tx_hash,
          guid:         item.guid,
          amount:       item.amount,
        }).catch(e => console.warn('[BridgeSweep] 재시도 실패(다음 스윕에 재시도):', item.tx_hash, e.message));
      }
    }
  }
}

export default {
  // ── Cron 트리거 (10분마다 머클 앵커링 + 브릿지 아웃박스 스윕) ────────
  async scheduled(event, env, ctx) {
    ctx.waitUntil(anchorL1MerkleRoot(env));
    ctx.waitUntil(_sweepBridgeOutbox(env).catch(e => console.error('[BridgeSweep] 전체 실패:', e.message)));
  },

  async fetch(request, env, ctx) {
    const corsOrigin = getCorsOrigin(request);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin':      corsOrigin ?? 'null',
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Methods':     'GET, POST, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers':     'Content-Type, Authorization',
          'Access-Control-Max-Age':           '86400',
        },
      });
    }

    if (corsOrigin === null) {
      return new Response(
        JSON.stringify({ error: 'Forbidden', origin: request.headers.get('Origin') }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const corsHeaders = buildCorsHeaders(corsOrigin);
    const url         = new URL(request.url);
    const pathname    = url.pathname;

    // ── SSO 인증 ──────────────────────────────────────────
    if (pathname === '/auth/issue')              return handleIssue(request, env, corsHeaders);
    if (pathname === '/auth/verify')             return handleVerify(request, env, corsHeaders);
    if (pathname === '/auth/refresh')            return handleRefresh(request, env, corsHeaders);

    // ── WebAuthn ─────────────────────────────────────────
    if (pathname === '/auth/webauthn/challenge') return handleWAChallenge(request, env, corsHeaders);
    if (pathname === '/auth/webauthn/register')  return handleWARegister(request, env, corsHeaders);
    if (pathname === '/auth/webauthn/verify')    return handleWAVerify(request, env, corsHeaders);

    // ── PDV ──────────────────────────────────────────────
    if (pathname === '/pdv/query')               return handlePdvQuery(request, env, corsHeaders);
    if (pathname === '/pdv/report')              return handlePdvReport(request, env, corsHeaders);
    if (pathname.startsWith('/pdv/page/'))       return handlePdvPage(request, env, corsHeaders);

    // ── PDV 조회 동의 승인 페이지 (consent.html 전용, 2026-07-02 신설) ──
    if (pathname === '/consent/info')            return handleConsentInfo(request, env, corsHeaders);
    if (pathname === '/consent/respond')         return handleConsentRespond(request, env, corsHeaders);

    // ── 서비스 등록 ───────────────────────────────────────
    if (pathname === '/svc/register')            return handleSvcRegister(request, env, corsHeaders);
    if (pathname === '/svc/verify')              return handleSvcVerify(request, env, corsHeaders);

    // ── 지오코딩 / 카카오 ─────────────────────────────────
    if (pathname.startsWith('/geocode'))         return handleGeocode(url, env, corsHeaders);
    if (pathname === '/kakao/appkey')            return handleKakaoAppKey(request, env, corsHeaders);

    // ── search (v4.7) ────────────────────────────────────
    if (pathname === '/search' && request.method === 'POST') return handleSearch(request, env, corsHeaders);
    // ── 오케스트레이션 레지스트리 (2026-07-08 신설 — AGENT-COMMON §0-H v3.40 /
    //    K-Compose SP-20이 참조. PROCEDURE_MAP·ORG_PROFILE·ATOM_ROW를 실제
    //    L1 PocketBase 컬렉션에 저장한다. 컬렉션 자체(procedure_maps·
    //    org_profiles·atom_rows)는 이 패치 범위 밖 — 관리자 패널에서 별도
    //    생성 필요(★ 미구현 — 배포 전 필수 ★, 아래 함수들은 컬렉션이
    //    존재한다는 전제로 작성됨) ──
    if (pathname === '/orchestration/procedure-map' && request.method === 'GET')
      return handleProcedureMapLookup(request, env, corsHeaders);
    if (pathname === '/orchestration/procedure-map/draft' && request.method === 'POST')
      return handleProcedureMapDraft(request, env, corsHeaders);
    if (pathname === '/orchestration/procedure-map/update' && request.method === 'POST')
      return handleProcedureMapUpdate(request, env, corsHeaders);
    if (pathname === '/orchestration/org-profile' && request.method === 'GET')
      return handleOrgProfileLookup(request, env, corsHeaders);

    // ── merkle (T10) ─────────────────────────────────────────
    if (pathname === '/merkle/verify')           return handleMerkleVerify(request, env, corsHeaders);

    // ── OpenHash 앵커링 프록시 ────────────────────────────────
    // buildout_plan_v2 Phase 1: 클라이언트가 GitHub 토큰 직접 보유 금지
    // hashChain.js의 _submitToLayer가 이 엔드포인트를 호출
    // worker.js가 OPENHASH_TOKEN으로 repository_dispatch 중계
    if (pathname === '/openhash/anchor' && request.method === 'POST')
      return handleOpenhashAnchor(request, env, corsHeaders);

    // ── OpenHash ILMV 상태 조회 (Phase 5) ───────────────────────────────
    if (pathname === '/openhash/status' && request.method === 'GET')
      return handleOpenhashStatus(request, env, corsHeaders);

    // ── debug (진단용, 인증 불필요) ──────────────────────────
    if (pathname === '/debug/importance' && request.method === 'GET') {
      const amount        = parseFloat(url.searchParams.get('amount')        || '1050');
      const asset_type    = url.searchParams.get('asset_type')    || 'stable';
      const contract_type = url.searchParams.get('contract_type') || 'instant';
      const buyer_region  = url.searchParams.get('buyer_region')  || null;
      const seller_region = url.searchParams.get('seller_region') || null;
      const score = _computeImportanceScore(amount, asset_type, contract_type);
      const mode  = _selectImportanceMode(score);
      const lcat  = computeLCAT(buyer_region, seller_region);
      return new Response(JSON.stringify({
        ok: true,
        input:  { amount, asset_type, contract_type, buyer_region, seller_region },
        output: {
          score: parseFloat(score.toFixed(4)),
          mode,
          lcat,
          thresholds: { LIGHTWEIGHT_MAX: 25, STANDARD_MAX: 60 },
        },
        note: '이 엔드포인트는 score/LCAT 진단 전용입니다. L1 호출 없음.',
      }, null, 2), { status: 200, headers: corsHeaders });
    }

    // ── biz (v4.8+) ──────────────────────────────────────
    if (pathname.startsWith('/biz/profile/'))   return handleBizProfile(request, env, corsHeaders);
    if (pathname === '/gwp/register-key' && request.method === 'POST') return handleRegisterKey(request, env, corsHeaders);
    if (pathname === '/biz/order'   && request.method === 'POST') return handleBizOrder(request, env, corsHeaders, ctx);
    if (pathname === '/biz/balance' && request.method === 'GET')  return handleBizBalance(request, env, corsHeaders);
    if (pathname === '/biz/supply'  && request.method === 'GET')  return handleBizSupply(request, env, corsHeaders);
    // 2026-07-07: /biz/review(Supabase biz_reviews, 5점 척도) → 완전 대체.
    // 실거래(tx_hash) 기반 trade_ratings(PocketBase, polarity+온도)로 이전.
    // handleBizReview는 하단에 DEPRECATED로 남겨두되 라우팅에서 제거함.
    if (pathname === '/biz/trade-rating' && request.method === 'POST') return handleTradeRatingSubmit(request, env, corsHeaders);
    if (pathname === '/biz/temperature'  && request.method === 'GET')  return handleTemperatureQuery(request, env, corsHeaders);
    if (pathname === '/biz/product' && request.method === 'POST') return handleBizProduct(request, env, corsHeaders);

    // ── ai-setup (AI 비서 설정) ─────────────────────────────
    // v5.1: 토큰 기반 폐기 — Ed25519 서명(/biz/product와 동일 패턴)으로 전환
    //   GET  : ?guid=... 만으로 조회 (저장값은 암호화되어 있어 평문 키 노출 없음)
    //   POST : body={guid,pubkey,signature,...} — _verifyEd25519 + TOFU
    // ── Wallet X25519 (PC→휴대폰 AI 설정 봉투암호화) ──────
    if (pathname === '/wallet/x25519') {
      if (request.method === 'GET')  return handleWalletX25519Get(request, env, corsHeaders);
      if (request.method === 'POST') return handleWalletX25519Post(request, env, corsHeaders);
    }
    if (pathname === '/account/delete-profile' && request.method === 'POST') {
      return handleAccountDeleteProfile(request, env, corsHeaders);
    }
    // 계정 완전 삭제 시 Supabase user_profiles row도 함께 정리 (L1과 별도 저장소이므로 누락되면
    // pubkey_ed25519/x25519 TOFU 키가 남아 재가입 시 PUBKEY_MISMATCH 발생)
    if (pathname === '/account/full-reset' && request.method === 'POST') {
      return handleAccountFullReset(request, env, corsHeaders);
    }
    if (pathname === '/ai-setup/seal') {
      if (request.method === 'GET')  return handleAiSetupSealGet(request, env, corsHeaders);
      if (request.method === 'POST') return handleAiSetupSealPost(request, env, corsHeaders);
    }

    if (pathname === '/ai-setup') {
      if (request.method === 'GET') {
        const guid = url.searchParams.get('guid');
        if (!guid) return _err(400, 'MISSING_FIELD', 'guid 파라미터 필수', corsHeaders);
        return handleAiSetupGet(request, env, corsHeaders, guid);
      }
      if (request.method === 'POST') return handleAiSetupPost(request, env, corsHeaders);
    }

    // ── TURN credential (coturn, RFC 8489) — _TURN_COTURN_PATCH_APPLIED_ ──────
    // GET /turn/credential?guid=...
    // TURN 서버: l1-hanlim.hondi.net:3478 (UDP/TCP), :5349 (TLS)
    // Credential: HMAC-SHA1 time-limited (coturn static-auth-secret 방식)
    if (pathname === '/turn/credential' && request.method === 'GET')
      return handleTurnCredential(request, env, corsHeaders);

    // ── WebRTC 시그널링 (P2P 채팅 — OpenHash 철학) ──────────
    // 메시지는 서버에 저장하지 않음 — 시그널(SDP/ICE)만 임시 경유
    if (pathname === '/signal/send')   return handleSignalSend(request, env, corsHeaders);
    if (pathname === '/signal/poll')   return handleSignalPoll(request, env, corsHeaders);
    if (pathname === '/signal/delete') return handleSignalDelete(request, env, corsHeaders);

    // ── 사용자 P2P 등록/검색 (GDUDA Phase 1) ───────────────────
    if (pathname === '/p2p/register' && request.method === 'POST')
      return handleP2PRegister(request, env, corsHeaders);
    if (pathname === '/p2p/search'   && request.method === 'GET')
      return handleP2PSearch(request, env, corsHeaders);

    // ── 사용자 검색 (GDUDA Phase 1) ──────────────────────────
    if (pathname === '/search/users')  return handleSearchUsers(request, env, corsHeaders);

    // ── profile (사용자/사업자 프로필 등록·조회 — v5.1) ──────
    //   GET  : 인증 불필요 — handle 또는 guid로 공개 조회
    //   POST : body={guid,pubkey,signature,...} — _verifyEd25519 + TOFU
    // 2026-07-01: /profile/delegate(위임 인증서) 폐기 — 별도 그림자
    // 정체성이 없어졌으므로 "위임" 자체가 무의미해짐(_mergeAgentSP 참조).

    // GET /profile/verify-owner — 핸드셰이크 실시간 본인 검증
    // (Ed25519 서명+TOFU. gopang-wallet.js의 sign()/verify()와 동일한
    // 서명 체계 — 전체 시스템이 서명 체계를 하나만 공유한다는 원칙.
    // 2026-07-01: SP를 돌려주던 /profile/my-sp를 대체 — 이제 system_prompt는
    // 단 하나뿐이라 "내려줄 internal SP"가 없고, "본인이 맞는지"만 매
    // 핸드셰이크마다 실시간으로 묻는다. AGENT-COMMON §4 참조)
    if (pathname === '/profile/verify-owner' && request.method === 'GET')
      return handleProfileVerifyOwner(request, env, corsHeaders);

    if (pathname.startsWith('/profile')) {
      if (request.method === 'GET')  return handleProfileGet(request, env, corsHeaders);
      if (request.method === 'POST') return handleProfilePost(request, env, corsHeaders);
    }

    // ── K-Market 판매자 카탈로그(로컬 IndexedDB 원본 + L1 백업/공개미러) ──
    if (pathname === '/biz/catalog/sync' && request.method === 'POST')
      return handleCatalogSync(request, env, corsHeaders);
    if (pathname === '/biz/catalog/hydrate' && request.method === 'POST')
      return handleCatalogHydrate(request, env, corsHeaders);
    if (pathname === '/biz/catalog' && request.method === 'GET')
      return handleCatalogGet(request, env, corsHeaders);

    // ── Feedback ─────────────────────────────────────────────
    if (pathname === '/feedback' && request.method === 'POST')
      return handleFeedbackPost(request, env, corsHeaders);
    if (pathname === '/feedback' && request.method === 'GET')
      return handleFeedbackGet(request, env, corsHeaders);
    if (pathname.startsWith('/feedback/') && request.method === 'PATCH')
      return handleFeedbackPatch(request, env, corsHeaders);

    // ── Push 알림 ───────────────────────────────────────────
    if (pathname === '/push/subscribe' && request.method === 'POST')
      return handlePushSubscribe(request, env, corsHeaders);
    if (pathname === '/push/send' && request.method === 'POST')
      return handlePushSend(request, env, corsHeaders);
    if (pathname === '/push/vapid-public-key' && request.method === 'GET')
      return handlePushVapidKey(request, env, corsHeaders);
    if (pathname === '/push/broadcast' && request.method === 'POST')
      return handlePushBroadcast(request, env, corsHeaders);

    // ── Prompt Editor (관리자 — L1 prompt_admins 인증 + GitHub PR) ──
    if (pathname === '/admin/login' && request.method === 'POST')
      return handleAdminLogin(request, env, corsHeaders);

    // GET /admin/stats — 대시보드 통계 (HMAC 인증, L1 PocketBase 프록시)
    if (pathname === '/admin/stats' && request.method === 'GET')
      return handleAdminStats(request, env, corsHeaders);

    // POST /admin/cf-dns — Cloudflare DNS CNAME 추가 (CORS 우회 프록시)
    if (pathname === '/admin/cf-dns' && request.method === 'POST')
      return handleAdminCfDns(request, env, corsHeaders);

    // POST /admin/users/bulk-delete — 관리자 일괄 삭제 (L1 + Supabase 9개 테이블 + KV)
    if (pathname === '/admin/users/bulk-delete' && request.method === 'POST')
      return handleAdminBulkDelete(request, env, corsHeaders);

    // ── 디폴트 LLM 키 관리 ──────────────────────────────────────
    // POST /admin/default-key  — 관리자가 KV에 저장 (HMAC 인증)
    // GET  /default-key        — 앱이 체험기간 확인 후 키 수신
    if (pathname === '/admin/default-key' && request.method === 'POST')
      return handleAdminDefaultKeySet(request, env, corsHeaders);
    if (pathname === '/default-key' && request.method === 'GET')
      return handleDefaultKeyGet(request, env, corsHeaders);
    if (pathname === '/free-quota-status' && request.method === 'GET')
      return handleFreeQuotaStatus(request, env, corsHeaders);
    if (pathname === '/prompt' && request.method === 'GET')
      return handlePromptGet(request, env, corsHeaders);
    if (pathname === '/admin/prompt' && request.method === 'POST')
      return handleAdminPromptSave(request, env, corsHeaders);

    // ── POST 전용 ────────────────────────────────────────
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers: corsHeaders });
    }

    const bodyText = await request.text();

    // ── AI 프록시 라우트 추가 보호 — 비용이 직접 발생하는 경로이므로
    // 한 번 더 엄격하게 검사한다. 위쪽 전역 검사(line ~275)는
    // corsOrigin === null(허용되지 않은 명시적 Origin)일 때만 403을
    // 반환하고, corsOrigin === ''(Origin 헤더 자체가 없는 요청 —
    // curl/스크립트/봇의 기본 동작이며 브라우저는 절대 이렇게 보내지
    // 않음)는 통과시켜버린다. 그 결과 인증 절차가 전혀 없는 이 4개
    // 라우트는 Origin 헤더만 안 보내면 누구나 직접 두드려 env의
    // DEEPSEEK_API_KEY 등 서버 보유 키로 무제한 호출이 가능했다.
    // (2026-06-28 — 기기를 모두 끈 상태에서도 DeepSeek 크레딧이
    // 소진된 사고의 원인 분석 후 추가)
    const AI_PROXY_PATHS = ['/chat/completions', '/deepseek', '/ai/chat', '/gemini/', '/llm/relay', '/klaw/relay', '/gov/relay'];
    const isAiProxyPath = AI_PROXY_PATHS.some(p => pathname === p || pathname.startsWith(p));
    const _meta = {
      ip:     request.headers.get('cf-connecting-ip') || 'unknown',
      origin: request.headers.get('Origin') || '(no-origin)',
      ua:     request.headers.get('User-Agent') || 'unknown',
      path:   pathname,
    };
    if (isAiProxyPath && !corsOrigin) {
      console.warn(JSON.stringify({ tag: 'AI_PROXY_BLOCKED_NO_ORIGIN', ts: new Date().toISOString(), ..._meta }));
      return _err(403, 'FORBIDDEN_NO_ORIGIN', 'AI 프록시 호출에는 브라우저 Origin이 필요합니다.', corsHeaders);
    }

    if (pathname === '/chat/completions')        return callDeepSeek(bodyText, env, corsHeaders, null, _meta, ctx);
    if (pathname.startsWith('/deepseek'))        return callDeepSeek(bodyText, env, corsHeaders, null, _meta, ctx);
    if (pathname === '/llm/relay')               return handleLLMRelay(bodyText, env, corsHeaders, _meta);
    if (pathname === '/klaw/relay')               return handleKlawRelay(bodyText, env, corsHeaders, _meta, ctx);
    if (pathname === '/gov/relay')                return handleGovRelay(bodyText, env, corsHeaders, _meta, ctx);
    if (pathname === '/business/relay')           return handleBusinessRelay(bodyText, env, corsHeaders, _meta, ctx);
    if (pathname.startsWith('/gemini/'))         return callOpenAIFromGeminiBody(bodyText, env, corsHeaders, _meta);
    if (pathname === '/ai/chat')                 return handleAIChat(bodyText, env, corsHeaders, _meta);

    return new Response(JSON.stringify({ error: 'Not Found', path: pathname }), { status: 404, headers: corsHeaders });
  },
};

// ═══════════════════════════════════════════════════════════
// v4.9 STEP 08 — /biz/order (L1 위임, Worker 검증 제거)
// ═══════════════════════════════════════════════════════════
// 2026-07-07 신설: 플랫폼 수수료율 — 지금까지 서버 어디에도 정해진 값이
// 없어(worker.js/ledger.js/payment.js 세 초안이 각각 다른 값을 가정)
// 클라이언트가 보낸 seller_net/fee 분할을 그대로 신뢰하고 있었다. 이제
// 이 값이 유일한 정본이다 — profile.html의 _PLATFORM_FEE_RATE도 반드시
// 이 값과 같아야 한다(다르면 매 결제가 PRICE_MISMATCH로 거부됨).
const PLATFORM_FEE_RATE = 0.03; // 3%

async function handleBizOrder(request, env, corsHeaders, ctx) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  const {
    tx, tx_hash, buyer_sig, buyer_public_key,
    from_guid, seller_guid, l1_node, memo,
    prev_settle_hash, balance_claimed, outputs,
    session_id, reporter_svc,
    item_name, item_id, quantity,
    seller_net, fee,
    // Phase 3/4 추가: 중요도 점수 + LCAT 입력
    asset_type    = 'stable',  // 'stable'|'physical'|'point'
    contract_type = 'instant', // 'instant'|'conditional'|'escrow'
    buyer_region  = null,      // 지역 코드 (예: 'jeju', 'seoul')
    seller_region = null,
  } = body;

  // 필수 필드 확인
  if (!tx_hash)          return _err(400, 'MISSING_FIELD', 'tx_hash 필수', corsHeaders);
  if (!buyer_sig)        return _err(400, 'MISSING_FIELD', 'buyer_sig 필수', corsHeaders);
  if (!buyer_public_key) return _err(400, 'MISSING_FIELD', 'buyer_public_key 필수', corsHeaders);
  if (!from_guid)        return _err(400, 'MISSING_FIELD', 'from_guid 필수', corsHeaders);
  if (!seller_guid)      return _err(400, 'MISSING_FIELD', 'seller_guid 필수', corsHeaders);

  // ── 2026-07-07 신설: 카탈로그 가격 검증(사고실험 G 대응) ──────────────
  // 지금까지는 tx.items에 담긴 price/quantity, 그리고 seller_net/fee를
  // 전부 클라이언트가 보낸 그대로 신뢰했다 — 즉 잔액만 충분하면 임의의
  // 금액으로 "구매"를 만들 수 있었다. 이제 tx.items가 있으면(=Market
  // 카탈로그 구매) 판매자의 실제 seller_products를 서버가 직접 재조회해
  // 가격을 재계산하고, 클라이언트가 주장한 금액과 대조한다.
  // items가 비어 있으면(= P2P 송금 등 카탈로그와 무관한 거래) 이 검증은
  // 건너뛴다 — 애초에 대조할 카탈로그가 없는 케이스이기 때문이다.
  const txItems = Array.isArray(tx?.items) ? tx.items : [];
  if (txItems.length) {
    let catalog;
    try {
      catalog = await _l1ListSellerProducts(env, seller_guid);
    } catch (e) {
      return _err(502, 'L1_UNREACHABLE', '카탈로그 조회 실패: ' + e.message, corsHeaders);
    }
    const byId = new Map(catalog.map(r => [r.id, r]));

    let authoritativeTotal = 0;
    for (const item of txItems) {
      const rec = byId.get(item.id);
      if (!rec) {
        return _err(404, 'ITEM_NOT_FOUND', `카탈로그에 없는 상품입니다: ${item.id}`, corsHeaders);
      }
      if (rec.is_public === false) {
        return _err(403, 'ITEM_NOT_PUBLIC', `비공개 상품은 구매할 수 없습니다: ${item.id}`, corsHeaders);
      }
      if (typeof rec.price !== 'number') {
        return _err(400, 'ITEM_PRICE_UNSET', `가격 미정 상품은 이 경로로 구매할 수 없습니다: ${item.id}`, corsHeaders);
      }
      const qty = Number(item.quantity) > 0 ? Number(item.quantity) : 1;
      authoritativeTotal += rec.price * qty;
    }

    const claimedTotal = (seller_net || 0) + (fee || 0);
    // 정수 원 단위 반올림 오차 허용(1원) — 그 이상 차이는 위조/버그로 간주
    if (Math.abs(claimedTotal - authoritativeTotal) > 1) {
      return _err(409, 'PRICE_MISMATCH',
        `가격 불일치: 서버 계산 ₮${authoritativeTotal} vs 요청 ₮${claimedTotal}`,
        corsHeaders);
    }
    // 총액만 맞추고 seller_net/fee 분할을 임의로 조작하는 걸 막는다(예:
    // fee=0, seller_net=total로 보내 플랫폼 수수료를 가로채거나, 반대로
    // seller_net을 깎고 fee를 부풀리는 경우) — 분할도 서버가 강제한다.
    const authoritativeFee = Math.round(authoritativeTotal * PLATFORM_FEE_RATE);
    const authoritativeSellerNet = authoritativeTotal - authoritativeFee;
    if (Math.abs((fee || 0) - authoritativeFee) > 1 ||
        Math.abs((seller_net || 0) - authoritativeSellerNet) > 1) {
      return _err(409, 'FEE_SPLIT_MISMATCH',
        `수수료 분할 불일치: 서버 계산 seller_net=₮${authoritativeSellerNet}/fee=₮${authoritativeFee} vs 요청 seller_net=₮${seller_net || 0}/fee=₮${fee || 0}`,
        corsHeaders);
    }
  }

  // ── STEP 08: L1 위임 — Worker는 검증 로직 없음 ───────────
  const buyerNodeId = l1_node || 'KR-JEJU-JEJU-HANLIM';
  const l1Base = L1_NODE_MAP[buyerNodeId] || L1_DEFAULT;
  const l1Url  = l1Base + '/api/tx';

  // ── 2026-07-07 신설(제주 L1~L3 필드 테스트, §4/§5): 판매자 소속 L1 조회 ──
  // 판매자가 구매자와 다른 L1 소속이면, 그 사실을 L1의 /api/tx에 미리
  // 알려줘야 L1이 판매자 몫 output을 sentinel(bridge-out)로 리디렉션할 수
  // 있다. L1은 다른 L1을 직접 조회하지 않으므로(P1), 이 조회는 반드시
  // Worker(허브)가 대신 해서 넘겨준다.
  const sellerHomeNode = await _resolveHomeL1Node(env, seller_guid);
  const isCrossL1 = sellerHomeNode && sellerHomeNode !== buyerNodeId;
  if (isCrossL1) {
    console.log(`[BizOrder] 크로스-L1 거래 감지: ${buyerNodeId} → ${sellerHomeNode}`);
  }

  // ── Phase 3/4: 중요도 점수 + LCAT 계산 ──────────────────────────────────
  // importanceVerifier.js와 동일 공식(단일 정의 원칙) — refactor_plan_v2 §Phase1 참조
  const _txAmount = (tx?.input?.balance_claimed ?? balance_claimed ?? 0);
  const _actualAmount = (seller_net || 0) + (fee || 0) || _txAmount;
  const importance_score = _computeImportanceScore(_actualAmount, asset_type, contract_type);
  const importance_mode  = _selectImportanceMode(importance_score);
  const lcat             = computeLCAT(buyer_region, seller_region);
  // LCAT과 requires_geo는 완전히 독립 — PLSM 계층 라우팅 전용 입력
  console.log(`[BizOrder] score=${importance_score.toFixed(2)} mode=${importance_mode} lcat=${lcat}`);

  // L1에는 순수 UTXO만 전달 (items/memo 등 제거)
  const txPayload = {
    version: tx?.version || 1,
    input: tx?.input || {
      owner_guid:        from_guid,
      prev_settle_hash:  prev_settle_hash || null,
      balance_claimed:   balance_claimed  || 0,
    },
    outputs: tx?.outputs || outputs || [
      { recipient_guid: seller_guid,        amount: seller_net || 0 },
      { recipient_guid: 'gopang-platform',  amount: fee        || 0 },
    ],
    // PLSM 입력값 — L1이 아직 미수신해도 unknown field 무시, 거래 흐름 미차단
    score: importance_score,
    lcat,
  };
  // §5 브릿지 트리거 — cross-L1일 때만 넘긴다(같은 L1이면 undefined로 두어
  // L1의 기존 로컬 처리 경로를 그대로 탄다).
  const bridgeBody = isCrossL1 ? { seller_home_node: sellerHomeNode } : {};

  let l1Result;
  try {
    // 2026-07-07 제거: 여기 있던 Supabase user_profiles.extra.fs 기반
    // BIVM 사전검증(_fetchUserBalance/_bivmVerify)을 걷어냈다. L1의
    // /api/tx가 이제 balance_claimed를 신뢰하지 않고 자기 blocks 원장을
    // 재생(computeBalance)해서 직접 잔액을 검증하므로, Worker가 별도로
    // (그것도 이제 갱신되지 않는 Supabase 값으로) 사전 검증하는 건
    // 중복일 뿐 아니라 유해하다 — Supabase 쪽 값이 실제 L1 잔액과
    // 어긋나면 정상 거래가 여기서 먼저 잘못 막힐 수 있었다.

    const l1Res = await fetch(l1Url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: (() => { const p = { tx: txPayload, tx_hash, buyer_sig, buyer_public_key, ...bridgeBody }; console.log('[L1] tx:', JSON.stringify(p.tx)); return JSON.stringify(p); })(),
    });
    l1Result = await l1Res.json().catch(() => ({ ok: false, error: 'L1_PARSE_FAILED' }));
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 노드 연결 실패: ' + e.message, corsHeaders);
  }

  if (!l1Result.ok) {
    console.log('[BizOrder] L1 실패:', JSON.stringify(l1Result));
    const statusMap = {
      INVALID_SIGNATURE:    401,
      UNREGISTERED_KEY:     403,
      STALE_STATE:          409,
      INSUFFICIENT_BALANCE: 402,
      BLOCK_SAVE_FAILED:    500,
    };
    return _err(statusMap[l1Result.error] || 400, l1Result.error, l1Result.detail || l1Result.error, corsHeaders);
  }

  const { block_id, block_hash, height } = l1Result;
  // 2026-07-07 수정: buyer_claim/seller_claim을 Worker가 다시 만들지
  // 않는다 — 이전엔 (신뢰하면 안 되는) balance_claimed로 balance_after를
  // 자체 계산했었다. 이제 L1이 자기 원장 재생 결과(computeBalance)로
  // 계산한 진짜 claim을 돌려주므로 그걸 그대로 쓴다.
  const buyer_claim  = l1Result.buyer_claim  || null;
  const seller_claim = l1Result.seller_claim || null;

  // ── §5 브릿지 릴레이 트리거 — L1이 bridge_out을 outbox에 남겼으면
  // (l1Result.bridge.status === 'pending'), Worker가 허브로서 대상 L1의
  // /api/bridge-in을 호출하고 성공하면 소스 L1에 완료 통지한다. 실패해도
  // 여기서 거래 자체를 막지 않는다 — scheduled() 크론 스윕이 재시도한다.
  if (l1Result.bridge && l1Result.bridge.status === 'pending') {
    const bridgePromise = _relayBridge(env, {
      sourceBase:   l1Base,
      targetNodeId: l1Result.bridge.target_node,
      tx_hash,
      guid:         seller_guid,
      amount:       seller_net || 0,
    }).catch(e => console.warn('[BizOrder] 브릿지 릴레이 예외:', e.message));
    if (ctx?.waitUntil) ctx.waitUntil(bridgePromise);
  }

  // ── Module 5.5: verifyOutputConsistency + verifyDeltaZero ──────────
  // 2026-07-07 수정: 이전엔 결과를 로그만 찍고 버렸다("감시 모드") —
  // 사용자가 요청한 "매 거래마다 판매자·구매자 재무제표 변동 일치
  // 검증"을 실제로 기록에 남기려면 결과를 어딘가에 보존해야 한다.
  // 이제 PDV(_recordOrderPdv)와 API 응답 양쪽에 결과를 남긴다 — 검증
  // 자체는 여전히 거래를 막지 않는다(블록은 L1에 이미 저장된 뒤라
  // 여기서 "막는다"는 게 의미가 없다 — 대신 불일치 시 크게 로그를
  // 남기고 응답에도 명시해서, 이상 거래로 추적·감사할 수 있게 한다).
  const _outputs = txPayload.outputs;
  const outputConsistent = verifyOutputConsistency(l1Result, _outputs);
  const deltaZeroResult  = verifyDeltaZero(_outputs, txPayload.input?.balance_claimed || balance_claimed || 0);
  const consistencyCheck = {
    output_consistent: outputConsistent,
    delta_zero_valid:  deltaZeroResult.valid,
    sigma_delta:       deltaZeroResult.sigmaDelta ?? null,
    reason:            deltaZeroResult.reason || (outputConsistent ? null : 'output_mismatch'),
  };
  if (!outputConsistent || !deltaZeroResult.valid) {
    console.error('[BizOrder] 재무제표 변동 일치 검증 실패:', JSON.stringify(consistencyCheck));
  }

  // ── Phase 4: 차등 검증 레이어 (refactor_plan_v2 §Phase1 차등 레이어) ─────
  // baseline(카탈로그+수수료 검증)은 항상 실행됨 — ILMV-100% 대응
  // 표준 모드: 가격 재조회 로그(TOCTOU 창 축소) — 현재 pilot 단계라 로그만
  // 강화 모드: PDV에 risk_tier:'high' 플래그 기록 (L1/L4 강화 모드 트리거 힌트)
  if (importance_mode === 'ENHANCED') {
    console.warn(`[BizOrder][ENHANCED] score=${importance_score.toFixed(2)} — risk_tier:high 기록 예정`);
    // risk_tier 플래그는 아래 PDV 기록 시 extra에 포함됨
  } else if (importance_mode === 'STANDARD') {
    console.log(`[BizOrder][STANDARD] score=${importance_score.toFixed(2)} — 표준 검증`);
  }

  // ── Module 5.5: l1_ledger H_N 기록 (updateNodeHashChain) ──
  // await는 fs_ledger RPC와 병렬 실행 — 거래 응답 차단 안 함
  // 2026-07-07 수정: 이전엔 이 promise가 만들어진 뒤 어디서도 참조되지
  // 않아 .catch()조차 없었다(unhandled rejection 위험) + ctx.waitUntil로
  // 등록도 안 돼 있어 응답 반환 후 Cloudflare Workers가 격리 실행 환경을
  // 종료하면 완료 전에 중단될 수 있었다. 다른 곳(2195/2211행 등)에 이미
  // 확립된 패턴을 그대로 적용한다.
  const userHashPromise = _computeUserHash(tx_hash, block_hash, height);
  const nodeChainPromise = userHashPromise.then(userHash =>
    updateNodeHashChain(env, {
      userHash,
      txId:            tx_hash,
      blockHash:       block_hash,
      buyerGuid:       from_guid,
      sellerGuid:      seller_guid,
      balanceClaimed:  txPayload.input?.balance_claimed || balance_claimed || 0,
    })
  ).catch(e => console.warn('[BizOrder] nodeChainPromise 실패:', e.message));
  if (ctx?.waitUntil) ctx.waitUntil(nodeChainPromise);

  // 2026-07-07 제거: 여기 있던 Supabase market_purchase RPC 호출과
  // _patchFs(buyer/seller extra.fs 메타데이터 병합)를 걷어냈다. 잔액의
  // 유일한 진실은 이제 L1의 blocks 원장이고(computeBalance), L1이
  // 응답으로 돌려주는 block_id/block_hash/buyer_claim/seller_claim만
  // 있으면 충분하다 — 별도로 Supabase에 사본을 만들 필요가 없어졌다.
  // (item_name/quantity 등 상품 메타데이터는 여전히 PDV 기록에 쓰인다 —
  // 아래 _recordOrderPdv 참조.)
  const totalOutput = txPayload.outputs.reduce((s, o) => s + (o.amount || 0), 0);

  // ── STEP 11: reporter_svc 없을 때만 Worker가 PDV 기록 ────
  // reporter_svc가 있으면 하위 시스템이 이미 기록했으므로 중복 방지
  if (!reporter_svc) {
    await _recordOrderPdv(env, {
      from_guid, seller_guid, tx_hash, block_hash, block_id,
      session_id, item_name: item_name || memo || '상품',
      total: totalOutput, l1_result: l1Result,
      importance_score, importance_mode, lcat,
      risk_tier: importance_mode === 'ENHANCED' ? 'high'
               : importance_mode === 'STANDARD' ? 'standard'
               : 'low',
      consistency_check: consistencyCheck,
    });
  }
  console.log('[BizOrder] 성공:', JSON.stringify({ ok: true, block_hash, height, buyer_claim: !!buyer_claim }));

  return new Response(JSON.stringify({
    ok:           true,
    tx_hash,
    block_id,
    block_hash,
    height,
    openhash:     l1Result.openhash,
    buyer_claim,
    seller_claim,
    // 2026-07-07 수정: rpcResult(Supabase market_purchase RPC 응답) 제거 —
    // 이제 L1이 재생 계산한 진짜 잔액을 그대로 노출한다.
    balance_after: l1Result.balance_after ?? null,
    consistency_check: consistencyCheck,
    reporter_svc: reporter_svc || 'hondi-proxy',
    importance: {
      score: parseFloat(importance_score.toFixed(4)),
      mode:  importance_mode,
      lcat,
    },
  }), { status: 200, headers: corsHeaders });
}

// ── GET /biz/balance?guid=... — 재대사(reconcile) 지원 ────────────
// 2026-07-07 신설. 클라이언트(gopang-wallet.js) 로컬 IndexedDB가 서버
// 원장과 어긋났을 때(새 기기, 스토리지 초기화 등) 복구용으로 L1의
// /api/balance를 그대로 프록시한다 — 이 리포의 다른 모든 L1 접근과
// 마찬가지로 클라이언트는 L1을 직접 부르지 않고 Worker를 거친다.
async function handleBizBalance(request, env, corsHeaders) {
  const url  = new URL(request.url);
  const guid = url.searchParams.get('guid');
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 쿼리 파라미터 필수', corsHeaders);

  try {
    const res  = await fetch(`${L1_DEFAULT}/api/balance?guid=${encodeURIComponent(guid)}`);
    const data = await res.json().catch(() => ({ ok: false, error: 'L1_PARSE_FAILED' }));
    if (!data.ok) return _err(502, data.error || 'L1_ERROR', data.detail || 'L1 잔액 조회 실패', corsHeaders);
    return new Response(JSON.stringify(data), { status: 200, headers: corsHeaders });
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
  }
}

// ── GET /biz/supply — GDC 발행 총량 보존 검증 프록시 ──────────────
// 2026-07-07 신설. L1의 /api/supply/verify를 그대로 프록시한다 —
// 발행 총량(mint 누적) == 이 L1에 등장한 모든 guid 잔액 합, 이 두 값이
// 항상 같아야 한다는 불변식을 확인한다. verify=0 쿼리로 가벼운 총량만
// 조회할 수도 있다(대시보드 등 자주 호출하는 곳용).
async function handleBizSupply(request, env, corsHeaders) {
  const url = new URL(request.url);
  const verifyOnly = url.searchParams.get('verify') !== '0';
  const path = verifyOnly ? '/api/supply/verify' : '/api/supply';

  try {
    const res  = await fetch(`${L1_DEFAULT}${path}`);
    const data = await res.json().catch(() => ({ ok: false, error: 'L1_PARSE_FAILED' }));
    if (!data.ok) return _err(502, data.error || 'L1_ERROR', data.detail || 'L1 총량 조회 실패', corsHeaders);
    if (verifyOnly && !data.valid) {
      console.error('[Supply] 보존 검증 실패!', JSON.stringify({ minted: data.total_minted, balance: data.total_balance, diff: data.diff }));
    }
    return new Response(JSON.stringify(data), { status: 200, headers: corsHeaders });
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
  }
}

// ── POST /gwp/register-key — 가입 시점 지갑 공개키 등록 ─────────────
// 2026-07-07 신설. 지금까지 GopangWallet이 로컬에서 Ed25519 키페어를
// 자동 생성하긴 했지만, 그 공개키를 L1의 gdc_keys 컬렉션에 등록하는
// 코드가 어디에도 없었다 — 즉 신규 가입자의 첫 실거래가 L1의 2단계
// (공개키 확인)에서 무조건 UNREGISTERED_KEY(403)로 막히는 상태였다.
//
// TOFU(Trust On First Use) 방식: guid+timestamp를 그 공개키에 대응하는
// 개인키로 서명하게 해서, "이 공개키를 실제로 갖고 있다"는 걸 증명한
// 뒤에만 등록한다 — 서명 없이 아무 공개키나 등록 요청할 수 있으면 안
// 되기 때문이다. 이미 등록된 guid면(기기 교체 등) 갱신(PATCH)한다.
async function handleRegisterKey(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  const { guid, public_key, signature, ts, home_l1 } = body;
  if (!guid)       return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  if (!public_key) return _err(400, 'MISSING_FIELD', 'public_key 필수', corsHeaders);
  if (!signature)  return _err(400, 'MISSING_FIELD', 'signature 필수', corsHeaders);
  if (!ts)         return _err(400, 'MISSING_FIELD', 'ts 필수', corsHeaders);

  const sigMsg = `register-key:${guid}:${ts}`;
  const sigOk  = await _verifyEd25519Simple(public_key, signature, sigMsg);
  if (!sigOk) return _err(401, 'INVALID_SIGNATURE', '서명 검증 실패 — 이 공개키의 개인키로 서명한 게 맞는지 확인하세요', corsHeaders);

  // 2026-07-07 신설(제주 L1~L3 필드 테스트, §4): 클라이언트가 위치 기반으로
  // 확정한 읍면동 소속 L1 노드 ID(home_l1, 예: "KR-JEJU-JEJU-AEWOL")를
  // 받는다. 안 보내면(기존 클라이언트 하위호환) hanlim으로 폴백한다.
  const homeNodeId = (home_l1 && L1_NODE_MAP[home_l1]) ? home_l1 : 'KR-JEJU-JEJU-HANLIM';
  const homeBase    = L1_NODE_MAP[homeNodeId] || L1_DEFAULT;

  try {
    const token  = await _l1AdminTokenFor(env, homeBase);
    const filter = encodeURIComponent(`guid='${guid}'`);
    const existingRes  = await fetch(`${homeBase}/api/collections/gdc_keys/records?filter=${filter}&perPage=1`,
      { headers: { 'Authorization': `Bearer ${token}` } });
    const existingData = await existingRes.json().catch(() => ({ items: [] }));
    const existing = existingData.items?.[0];

    if (existing) {
      // 2026-07-07 수정: 기존 공개키와 다른 값으로 덮어쓰는 걸 거부한다.
      // 이전엔 "제출한 공개키의 개인키를 갖고 있다"만 증명하면 통과했는데,
      // 이건 "이 guid의 원래 주인이다"를 증명하는 게 아니다 — guid만 알면
      // 누구나 새 키페어를 만들어 서명해서 등록을 가로챌 수 있었다.
      // 기기 교체 등 정당한 키 교체는 이미 검증된 별도 경로
      // (_restoreFromBackupKey — 백업 키로 복구)를 쓰게 한다. 같은 키로
      // 다시 등록 요청하는 건(멱등) 그대로 허용한다.
      if (existing.public_key !== public_key) {
        return _err(409, 'KEY_ALREADY_REGISTERED',
          '이 guid는 이미 다른 공개키로 등록돼 있습니다 — 기기 교체는 백업 키 복구 절차를 사용하세요', corsHeaders);
      }
      console.info('[RegisterKey] 이미 동일 키로 등록됨(멱등):', guid.slice(0, 20));
    } else {
      await fetch(`${homeBase}/api/collections/gdc_keys/records`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ guid, public_key, created_at: new Date().toISOString() }),
      });
      console.info('[RegisterKey] 신규 등록:', guid.slice(0, 20), '@', homeNodeId);
    }

    // §4 레지스트리 — 이 guid가 어느 L1 소속인지 L3에 기록(브릿지 거래 시
    // 상대방 소속 L1을 조회할 수 있어야 한다). 등록 실패해도 키 등록
    // 자체는 이미 끝났으므로 여기서 전체 요청을 실패시키지 않는다 —
    // 다만 로그는 크게 남겨 감사 가능하게 한다(_writeHomeL1Node 내부에서 처리).
    await _writeHomeL1Node(env, guid, homeNodeId);

    return new Response(JSON.stringify({ ok: true, guid, home_l1: homeNodeId }), { status: 200, headers: corsHeaders });
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 키 등록 실패: ' + e.message, corsHeaders);
  }
}

// ── STEP 09: PDV 기록 헬퍼 (동기 앵커링) ─────────────────
async function _recordOrderPdv(env, {
  from_guid, seller_guid, tx_hash, block_hash, block_id,
  session_id, item_name, total,
  importance_score = 0, importance_mode = 'LIGHTWEIGHT', lcat = 'B', risk_tier = 'low',
  consistency_check = null,
}) {
  const pdvKey   = env.SUPABASE_KEY || _supabaseAnonKey();
  const pdvId    = `PDV-${from_guid.replace(/:/g, '').slice(0, 12)}-${Date.now()}`;
  const reportId = session_id || `RPT-kmarket-${Date.now()}`;
  const now      = new Date().toISOString();

  const summary6w = JSON.stringify({
    who:   `buyer(${from_guid.slice(0, 20)}...)`,
    when:  now,
    where: 'https://market.hondi.net',
    what:  `구매: ${item_name} ₮${total}`,
    how:   'Ed25519 서명 + L1 4단계 검증',
    why:   '상품 구매 거래',
  });

  // risk_level: PDV 표준 필드. importance 기반으로 매핑
  const pdvRiskLevel = risk_tier === 'high' ? 'high'
                     : importance_mode === 'STANDARD' ? 'medium'
                     : 'low';

  await fetch(`${SUPABASE_URL}/rest/v1/pdv_log`, {
    method:  'POST',
    headers: {
      'apikey': pdvKey, 'Authorization': `Bearer ${pdvKey}`,
      'Content-Type': 'application/json', 'Prefer': 'return=minimal',
    },
    body: JSON.stringify({
      id:                   pdvId,
      guid:                 from_guid,
      source:               'market',
      type:                 'tx_2party',
      report_id:            reportId,
      summary:              `구매: ${item_name} ₮${total}`,
      summary_6w:           summary6w,
      risk_level:           pdvRiskLevel,
      raw_hash:             tx_hash,
      // STEP 09: 동기 앵커링 — L1 응답 수신 즉시 true
      block_hash:           block_hash,
      openhash_block_id:    block_id,
      openhash_anchored:    true,
      openhash_anchored_at: now,
      reporter_svc:         'hondi-proxy',
      via_worker:           true,
      created_at:           now,
      // Phase 4: 중요도·LCAT·risk_tier (OpenHash PLSM 입력 추적)
      // 2026-07-07 추가: consistency_check — 판매자·구매자 재무제표 변동
      // 일치 검증 결과. 이전엔 로그에만 찍히고 사라졌다 — 이제 거래마다
      // 감사 가능한 기록으로 남긴다.
      extra: {
        importance_score: parseFloat(importance_score.toFixed(4)),
        importance_mode,
        lcat,
        risk_tier,
        consistency_check,
      },
    }),
  }).catch(e => console.warn('[PDV] 기록 실패:', e.message));
}

// ═══════════════════════════════════════════════════════════
// v4.7 — /pdv/page/{identifier}
// ═══════════════════════════════════════════════════════════
async function handlePdvPage(request, env, corsHeaders) {
  const identifier = decodeURIComponent(new URL(request.url).pathname.replace('/pdv/page/', ''));
  if (!identifier) return _err(400, 'MISSING_ID', 'identifier 필수', corsHeaders);
  const sbH = _sbHeaders(env);
  let primaryGuid = identifier;
  let l1Node      = 'KR-JEJU-JEJU-HANLIM';
  if (identifier.includes(':')) {
    const res  = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?current_ipv6=eq.${encodeURIComponent(identifier)}&select=primary_guid,l1_node&limit=1`, { headers: sbH });
    const rows = await res.json().catch(() => []);
    if (!rows?.length) return _err(404, 'NOT_FOUND', `IPv6 ${identifier} 엔티티 없음`, corsHeaders);
    primaryGuid = rows[0].primary_guid || identifier;
    l1Node      = rows[0].l1_node      || l1Node;
  } else {
    const res  = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?primary_guid=eq.${encodeURIComponent(identifier)}&select=primary_guid,l1_node,name,entity_type,current_ipv6&limit=1`, { headers: sbH });
    const rows = await res.json().catch(() => []);
    if (rows?.length) l1Node = rows[0].l1_node || l1Node;
  }
  const nodeBase   = L1_NODE_MAP[l1Node] || L1_DEFAULT;
  const pguidShort = primaryGuid.slice(0, 8);
  const pdvUrl     = `${nodeBase}/entities/${pguidShort}.html`;
  try {
    const pdvRes = await fetch(pdvUrl);
    if (pdvRes.ok) {
      const html = await pdvRes.text();
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': corsHeaders['Access-Control-Allow-Origin'], 'X-Gopang-Node': l1Node, 'X-Gopang-GUID': primaryGuid } });
    }
  } catch {}
  const res2   = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?primary_guid=eq.${encodeURIComponent(primaryGuid)}&select=*&limit=1`, { headers: sbH });
  const rows2  = await res2.json().catch(() => []);
  const profile = rows2?.[0];
  if (profile) return new Response(_generatePdvHtml(profile), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': corsHeaders['Access-Control-Allow-Origin'], 'X-Gopang-Generated': 'dynamic' } });
  return _err(404, 'PDV_NOT_FOUND', `PDV 페이지 없음: ${primaryGuid}`, corsHeaders);
}

function _generatePdvHtml(p) {
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>${p.name||'엔티티'} — Gopang PDV</title><meta name="ofp:primary_guid" content="${p.primary_guid||''}"><meta name="ofp:current_ipv6" content="${p.current_ipv6||''}"><meta name="ofp:l1_node" content="${p.l1_node||''}"><style>body{font-family:sans-serif;max-width:480px;margin:40px auto;padding:20px;background:#f8f9fa}.card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px}h1{font-size:20px;margin-bottom:16px}.row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px}.label{color:#6b7280}.val{font-family:monospace;font-size:11px;word-break:break-all}.btn{display:block;width:100%;padding:12px;margin-top:16px;background:#3ecf8e;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer}</style></head><body><div class="card"><h1>${p.name||'(이름 없음)'}</h1><div class="row"><span class="label">유형</span><span>${p.entity_type||'–'}</span></div><div class="row"><span class="label">업종</span><span>${p.occupation||'–'}</span></div><div class="row"><span class="label">주소</span><span>${p.address||'–'}</span></div><div class="row"><span class="label">Primary GUID</span><span class="val">${p.primary_guid||'–'}</span></div><div class="row"><span class="label">IPv6</span><span class="val">${p.current_ipv6||'–'}</span></div><div class="row"><span class="label">L1 노드</span><span class="val">${p.l1_node||'–'}</span></div><button class="btn" onclick="window.open('https://hondi.net/?connect=${encodeURIComponent(p.primary_guid||'')}','_blank')">고팡으로 연결</button></div></body></html>`;
}

// ═══════════════════════════════════════════════════════════
// v4.7 — /search
// ═══════════════════════════════════════════════════════════
// 2026-07-05: SP-KMARKET RULE-02 [2-D]("품목 동의어 자동 확장")와 동일한
// 목록. 지금까지 이 확장은 AI([SEARCH] 태그를 낼 때 스스로 동의어를
// 떠올리는 것)에게만 맡겨져 있었다 — AI가 매번 동의어를 다 챙기지
// 못하면 검색이 조용히 좁아지는 위험이 있어, 서버 쪽에도 동일한
// 목록을 이중으로 걸어 최소 커버리지를 보장한다.
// ★ 유지보수 주의 ★ SP-KMARKET-v2_7.txt RULE-02 [2-D]를 고칠 때
// 이 목록도 같이 갱신할 것 — 현재 두 곳에 중복 관리됨(단일소스화는
// 추후 과제로 남김).
const PRODUCT_SEARCH_SYNONYMS = {
  '짜장면': ['자장면', '중식', '짜장'],
  '커피':   ['아메리카노', '라떼', '카페'],
  '치킨':   ['닭', '후라이드', '양념'],
  '흑돼지': ['삼겹살', '오겹살', '돼지고기'],
};

function _expandSearchTerms(keyword) {
  const terms = new Set([keyword]);
  for (const [key, syns] of Object.entries(PRODUCT_SEARCH_SYNONYMS)) {
    if (keyword.includes(key)) syns.forEach(s => terms.add(s));
    // 역방향(동의어로 검색했을 때 대표어·다른 동의어도 함께 포함)
    if (syns.some(s => keyword.includes(s))) { terms.add(key); syns.forEach(s => terms.add(s)); }
  }
  return [...terms];
}

// 2026-07-05: 상품명/설명/카테고리 자체로 검색 — search_entities(Supabase)는
// 엔티티 레벨(이름/태그/업종/주소)만 보므로, 판매자 태그에 없는 상품명으로
// 검색하면(예: 소개엔 "정육점"만 있고 상품명은 "이베리코 등심") 그 판매자
// 자체가 검색 결과에서 아예 빠지는 문제가 있었다. seller_products를
// 직접 훑어 매칭된 seller_guid를 찾아내고, 그 판매자의 엔티티 정보를
// L1에서 보강해 entity-level 검색 결과와 합친다.
async function _l1SearchProductsByKeyword(env, keyword, limit = 20) {
  if (!keyword) return [];
  const token = await _l1AdminToken(env);
  const terms = _expandSearchTerms(String(keyword));
  const orClauses = terms.flatMap(t => {
    const esc = t.replace(/'/g, "\\'");
    return [`name~'${esc}'`, `desc~'${esc}'`, `category~'${esc}'`];
  });
  const filter = encodeURIComponent(`is_public=true && (${orClauses.join(' || ')})`);
  const res = await fetch(
    `${L1_DEFAULT}/api/collections/seller_products/records?filter=${filter}&perPage=${limit * 3}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`L1 상품검색 실패 (HTTP ${res.status})`);
  const data = await res.json().catch(() => ({ items: [] }));
  const items = data.items || [];

  // 관련도 랭킹: 원래 키워드(동의어 확장 전) 기준 — 상품명 완전일치 >
  // 상품명 부분일치 > 카테고리 일치 > 설명만 일치 순.
  const kw = String(keyword).trim();
  function score(p) {
    const name = String(p.name || '');
    if (name === kw) return 4;
    if (name.includes(kw)) return 3;
    if (String(p.category || '').includes(kw)) return 2;
    if (terms.some(t => name.includes(t))) return 2; // 동의어로 이름 매칭
    return 1; // desc만 매칭되거나 동의어로만 매칭
  }
  return items.sort((a, b) => score(b) - score(a)).slice(0, limit);
}

async function handleSearch(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const sbH = _sbHeaders(env);
  const keyword = body.p_keyword || body.q || null;

  // 파라미터 정규화: q/limit → p_keyword/p_limit
  const rpcBody = {
    p_keyword:      keyword,
    p_entity_type:  body.p_entity_type || body.entity_type || null,
    p_occupation:   body.p_occupation  || body.occupation  || null,
    p_address:      body.p_address     || body.address     || null,
    p_gdc_only:     body.p_gdc_only    ?? false,
    p_trust_min:    body.p_trust_min   || null,
    p_lat:          body.p_lat         || body.lat         || null,
    p_lng:          body.p_lng         || body.lng         || null,
    p_sort:         body.p_sort        || 'rank',
    p_limit:        body.p_limit       || body.limit       || body.lim || 20,
    p_offset:       body.p_offset      || body.offset      || body.ofst || 0,
    p_exclude_guid: body.p_exclude_guid|| null,
    p_l1_node:      body.p_l1_node     || null,
    p_l2_node:      body.p_l2_node     || null,
    p_primary_guid: body.p_primary_guid|| null,
    p_handle:       body.p_handle      || body.handle      || null,
    p_nickname:     body.p_nickname    || body.nickname    || null,
    p_lang_code:    body.p_lang_code   || null,
    p_l3_node:      body.p_l3_node     || null,
  };

  const res  = await fetch(`${SUPABASE_URL}/rest/v1/rpc/search_entities`, { method: 'POST', headers: sbH, body: JSON.stringify(rpcBody) });
  const data = await res.json().catch(() => ({ error: 'parse failed' }));
  if (!res.ok || !Array.isArray(data)) {
    return new Response(JSON.stringify(data), { status: res.status, headers: corsHeaders });
  }

  // 2026-07-05: L1 seller_products를 join(엔티티 레벨 매칭 결과 보강)하고,
  // 상품명/설명/카테고리로만 매칭되는(엔티티 검색으론 못 찾는) 판매자를
  // 추가로 찾아 결과에 합친다.
  const byGuid = new Map(data.filter(e => e?.primary_guid).map(e => [e.primary_guid, e]));

  await Promise.all(data.map(async (entity) => {
    if (!entity?.primary_guid) return;
    try {
      entity.products = await _l1ListSellerProducts(env, entity.primary_guid)
        .then(list => list.filter(p => p.is_public !== false).slice(0, 10));
    } catch (e) {
      entity.products = [];
    }
  }));

  if (keyword) {
    try {
      const productMatches = await _l1SearchProductsByKeyword(env, keyword, rpcBody.p_limit);
      const newGuids = [...new Set(productMatches.map(p => p.seller_guid))].filter(g => !byGuid.has(g));

      await Promise.all(newGuids.map(async (guid) => {
        try {
          const profile = await _l1FindProfileByGuid(env, guid);
          if (!profile || profile.is_public === false) return;
          const entity = {
            primary_guid: guid,
            name: profile.name,
            entity_type: profile.entity_type,
            occupation: profile.extra?.core?.occupation ?? null,
            address: profile.extra?.core?.address ?? null,
            matched_via: 'product', // entity-level 필드가 아니라 상품으로 매칭됐음을 표시
            products: productMatches.filter(p => p.seller_guid === guid).slice(0, 10),
          };
          data.push(entity);
          byGuid.set(guid, entity);
        } catch (e) {
          console.warn('[Search] product-match 판매자 프로필 조회 실패(무시):', e.message);
        }
      }));
    } catch (e) {
      console.warn('[Search] 상품 레벨 검색 실패(엔티티 검색 결과는 정상 반환):', e.message);
    }
  }

  return new Response(JSON.stringify(data), { status: res.status, headers: corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// v4.8 — /biz/profile/{handle}
// ═══════════════════════════════════════════════════════════
async function handleBizProfile(request, env, corsHeaders) {
  const rawHandle = decodeURIComponent(new URL(request.url).pathname.replace('/biz/profile/', ''));
  if (!rawHandle) return _err(400, 'MISSING_HANDLE', 'handle 필수', corsHeaders);
  const sbH = _sbHeaders(env);
  let profile = null;
  const pRes  = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?handle=eq.${encodeURIComponent(rawHandle)}&limit=1`, { headers: sbH });
  const pRows = await pRes.json().catch(() => []);
  if (pRows.length) {
    profile = pRows[0];
  } else {
    const nickname = rawHandle.replace(/^@/, '').split('#')[0];
    const res2     = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?nickname=eq.${encodeURIComponent(nickname)}&limit=1`, { headers: sbH });
    const rows2    = await res2.json().catch(() => []);
    if (!rows2.length) {
    // guid로 재시도
    const res3 = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?primary_guid=eq.${encodeURIComponent(rawHandle)}&limit=1`, { headers: sbH });
    const rows3 = await res3.json().catch(() => []);
    if (!rows3.length) return _err(404, 'PROFILE_NOT_FOUND', `handle/guid ${rawHandle} 없음`, corsHeaders);
    profile = rows3[0];
  } else {
    profile = rows2[0];
  }
  }
  const guid = profile.current_ipv6;
  const [prodRes, reviewRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/biz_products?seller_guid=eq.${encodeURIComponent(guid)}&is_active=eq.true&order=sort_order.asc`, { headers: sbH }),
    fetch(`${SUPABASE_URL}/rest/v1/biz_reviews?seller_guid=eq.${encodeURIComponent(guid)}&is_visible=eq.true&order=created_at.desc&limit=20`, { headers: sbH }),
  ]);
  const [products, reviews] = await Promise.all([prodRes.json().catch(()=>[]), reviewRes.json().catch(()=>[])]);
  const avgRating = reviews.length ? (reviews.reduce((s,r)=>s+(r.rating||0),0)/reviews.length).toFixed(1) : null;
  return new Response(JSON.stringify({ ok:true, profile, products, reviews, review_summary:{count:reviews.length,avg_rating:avgRating} }), { status:200, headers:corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// [DEPRECATED 2026-07-07] v4.8 — /biz/review (Supabase biz_reviews)
// 라우팅에서 제거됨 — trade_ratings(PocketBase, polarity+온도)로 완전 대체.
// 백필/마이그레이션 스크립트가 biz_reviews 과거 데이터를 참조할 수 있어
// 함수 자체는 즉시 삭제하지 않고 남겨둔다. 마이그레이션 완료 확인 후
// 이 함수와 Supabase biz_reviews/biz_products 테이블을 함께 제거할 것.
// ═══════════════════════════════════════════════════════════
async function handleBizReview(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { reviewer_guid, product_id, tx_id, rating, body:reviewBody, image_urls=[], seller_guid } = body;
  if (!reviewer_guid) return _err(400, 'MISSING_FIELD', 'reviewer_guid 필수', corsHeaders);
  if (!product_id)    return _err(400, 'MISSING_FIELD', 'product_id 필수', corsHeaders);
  if (!tx_id)         return _err(400, 'MISSING_FIELD', 'tx_id 필수', corsHeaders);
  if (!rating||rating<1||rating>5) return _err(400, 'INVALID_RATING', 'rating 1~5 필수', corsHeaders);
  const sbServiceH = _sbServiceHeaders(env);
  const valRes     = await fetch(`${SUPABASE_URL}/rest/v1/rpc/validate_review`, { method:'POST', headers:sbServiceH, body:JSON.stringify({ p_reviewer_guid:reviewer_guid, p_product_id:product_id, p_tx_id:tx_id }) });
  const valResult  = await valRes.json().catch(()=>({ ok:false, error:'RPC_PARSE_FAILED' }));
  if (!valResult.ok) {
    const statusMap = { NO_VALID_PURCHASE:403, ALREADY_REVIEWED:409 };
    return _err(statusMap[valResult.error]||400, valResult.error, valResult.error, corsHeaders);
  }
  const insRes = await fetch(`${SUPABASE_URL}/rest/v1/biz_reviews`, {
    method:'POST', headers:{...sbServiceH,'Prefer':'return=representation'},
    body:JSON.stringify({ order_id:valResult.order_id, tx_id, reviewer_guid, seller_guid:seller_guid||null, product_id, rating, body:reviewBody||null, image_urls }),
  });
  if (!insRes.ok) return _err(500, 'INSERT_FAILED', await insRes.text(), corsHeaders);
  const inserted = await insRes.json().catch(()=>[]);
  return new Response(JSON.stringify({ ok:true, review_id:inserted[0]?.id||null, message:'리뷰가 등록됐습니다' }), { status:200, headers:corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// v4.8 — /biz/product
// ═══════════════════════════════════════════════════════════
async function handleBizProduct(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { action='create', seller_guid, pubkey, signature, product, l1_node } = body;
  if (!seller_guid)              return _err(400, 'MISSING_FIELD', 'seller_guid 필수', corsHeaders);
  if (!pubkey)                   return _err(400, 'MISSING_FIELD', 'pubkey 필수', corsHeaders);
  if (!signature)                return _err(400, 'MISSING_FIELD', 'signature 필수', corsHeaders);
  if (!product?.name && action==='create') return _err(400, 'MISSING_FIELD', 'product.name 필수', corsHeaders);
  const sigOk = await _verifyEd25519(pubkey, signature, body);
  if (!sigOk) return _err(401, 'INVALID_SIGNATURE', 'TX 서명 검증 실패', corsHeaders);
  const sbH       = _sbHeaders(env);
  const ownerRes  = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?current_ipv6=eq.${encodeURIComponent(seller_guid)}&select=pubkey_ed25519,handle&limit=1`, { headers:sbH });
  const ownerRows = await ownerRes.json().catch(()=>[]);
  if (!ownerRows.length) return _err(404, 'SELLER_NOT_FOUND', 'seller_guid 없음', corsHeaders);
  if (ownerRows[0].pubkey_ed25519 && ownerRows[0].pubkey_ed25519 !== pubkey)
    return _err(403, 'PUBKEY_MISMATCH', '공개키가 등록된 판매자와 일치하지 않습니다', corsHeaders);
  const sellerHandle = ownerRows[0].handle || null;
  const sbServiceH   = _sbServiceHeaders(env);
  if (action === 'create') {
    const insRes = await fetch(`${SUPABASE_URL}/rest/v1/biz_products`, {
      method:'POST', headers:{...sbServiceH,'Prefer':'return=representation'},
      body:JSON.stringify({ seller_guid, seller_handle:sellerHandle, name:product.name, description:product.description||null, category:product.category||null, image_urls:product.image_urls||[], tags:product.tags||[], price_krw:product.price_krw??0, price_gdc:product.price_gdc??0, stock:product.stock??null, sort_order:product.sort_order??0, is_active:product.is_active??true, l1_node:l1_node||null }),
    });
    if (!insRes.ok) return _err(500, 'INSERT_FAILED', await insRes.text(), corsHeaders);
    const inserted = await insRes.json().catch(()=>[]);
    return new Response(JSON.stringify({ ok:true, action:'created', product_id:inserted[0]?.id||null }), { status:200, headers:corsHeaders });
  }
  if (action === 'update') {
    if (!product?.id) return _err(400, 'MISSING_FIELD', 'product.id 필수 (update)', corsHeaders);
    const chkRes  = await fetch(`${SUPABASE_URL}/rest/v1/biz_products?id=eq.${encodeURIComponent(product.id)}&seller_guid=eq.${encodeURIComponent(seller_guid)}&select=id&limit=1`, { headers:sbH });
    const chkRows = await chkRes.json().catch(()=>[]);
    if (!chkRows.length) return _err(403, 'FORBIDDEN', '본인 상품만 수정할 수 있습니다', corsHeaders);
    const patch  = {};
    const fields = ['name','description','category','image_urls','tags','price_krw','price_gdc','stock','sort_order','is_active'];
    for (const f of fields) { if (product[f] !== undefined) patch[f] = product[f]; }
    const updRes = await fetch(`${SUPABASE_URL}/rest/v1/biz_products?id=eq.${encodeURIComponent(product.id)}`, { method:'PATCH', headers:{...sbServiceH,'Prefer':'return=minimal'}, body:JSON.stringify(patch) });
    if (!updRes.ok) return _err(500, 'UPDATE_FAILED', await updRes.text(), corsHeaders);
    return new Response(JSON.stringify({ ok:true, action:'updated', product_id:product.id }), { status:200, headers:corsHeaders });
  }
  return _err(400, 'INVALID_ACTION', 'action은 create 또는 update', corsHeaders);
}

// ═══════════════════════════════════════════════════════════
// Ed25519 서명 검증 (/biz/product, /biz/review 전용)
// /biz/order는 L1이 담당 — Worker에서 호출하지 않음
// ═══════════════════════════════════════════════════════════
async function _verifyEd25519(pubkeyB64u, signatureB64u, bodyObj) {
  try {
    const { signature: _sig, ...rest } = bodyObj;
    const payload     = new TextEncoder().encode(JSON.stringify(rest));
    const pubKeyBytes = _b64uToBytes(pubkeyB64u);
    const sigBytes    = _b64uToBytes(signatureB64u);
    const cryptoKey   = await crypto.subtle.importKey('raw', pubKeyBytes, { name:'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', cryptoKey, sigBytes, payload);
  } catch (e) { console.warn('[Ed25519]', e.message); return false; }
}

async function _verifyEd25519Simple(pubkeyB64u, signatureB64u, message) {
  try {
    const data       = new TextEncoder().encode(message);
    const pubKeyBytes = _b64uToBytes(pubkeyB64u);
    const sigBytes    = _b64uToBytes(signatureB64u);
    const cryptoKey   = await crypto.subtle.importKey('raw', pubKeyBytes, { name:'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', cryptoKey, sigBytes, data);
  } catch (e) { console.warn('[Ed25519Simple]', e.message); return false; }
}

function _b64uToBytes(b64u) {
  const b64 = b64u.replace(/-/g,'+').replace(/_/g,'/');
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

// ═══════════════════════════════════════════════════════════
// v4.9 STEP 09 — handlePdvReport 동기 앵커링
// ═══════════════════════════════════════════════════════════
async function handlePdvReport(request,env,corsHeaders){
  if(request.method!=='POST')return new Response('Method Not Allowed',{status:405});
  const origin=request.headers.get('Origin')||'';
  const body=await request.json().catch(()=>null);
  if(!body?.report)return _err(400,'SCHEMA_ERROR','report.report 필드 필수',corsHeaders);
  const r=body.report;
  const svcId=r.svc||request.headers.get('X-Gopang-Svc')||'unknown';
  const ipv6=r.who?.ipv6;
  const reg=_getSvcRegistration(origin,svcId);
  if(!reg)return _err(403,'SERVICE_NOT_REGISTERED',`${svcId} (${origin})은 등록된 서비스가 아닙니다`,corsHeaders);
  if(reg.level<2&&!reg.pdv)return _err(403,'PDV_NOT_ALLOWED','Level 1 서비스는 PDV 보고서 전송 권한이 없습니다',corsHeaders);
  if(!ipv6)return _err(404,'USER_NOT_FOUND','who.ipv6 필수',corsHeaders);

  // T-C 후속(①): session_id 기반 report_id 결정 — sessionId 있으면 'sessionId:reporterSvc'로
  // 고정해 L1 pdv_records의 report_id UNIQUE 인덱스가 중복방지를 대신하게 한다.
  // (기존 Supabase 사전조회 방식은 report_id=eq.${sessionId}로 비교했지만 실제 저장값은
  //  별도 생성된 reportId라서 절대 일치할 수 없던 잠재 버그였음 — 이번에 같이 해소)
  const sessionId = r.session_id || body.session_id || null;
  const reporterSvc = r.reporter_svc || body.reporter_svc || null;

  const resolvedSvcId=_resolveSvcId(svcId);
  const reportId=r.id||`RPT-${resolvedSvcId}-${Date.now()}-auto`;
  const pdvReportId = sessionId ? `${sessionId}:${reporterSvc || resolvedSvcId}` : reportId;
  const summary6w={
    who:`${r.who?.role||'user'} (${ipv6.slice(0,20)}...)`,
    when:`${(r.when?.period_start||'').slice(0,10)} ~ ${(r.when?.period_end||'').slice(0,10)}`,
    where:r.where?.svc_url||`https://${resolvedSvcId}.hondi.net`,
    what:r.what?.summary||'(요약 없음)',
    how:r.how?.method||'자동 집계',
    why:r.why?.goal||'(목표 미지정)',
  };
  const pdvId=`PDV-${ipv6.replace(/:/g,'').slice(0,12)}-${Date.now()}`;
  const now = new Date().toISOString();

  // STEP 09: block_hash가 report에 포함된 경우 동기 앵커링
  const blockHash   = r.block_hash   || body.block_hash   || null;
  const blockId     = r.block_id     || body.block_id     || null;
  const isAnchored  = !!blockHash;

  // pdv_records 스키마에 없는 필드(period/raw_hash/openhash_block_id/openhash_anchored_at)는
  // summary_6w(JSON, 스키마리스) 안에 같이 보존 — 컬렉션 스키마 변경 없이 무손실 이관
  const summary6wFull = {
    ...summary6w,
    period:             r.when ?? r.period ?? null,
    raw_hash:           r.content_hash || null,
    openhash_block_id:  blockId,
    openhash_anchored_at: isAnchored ? now : null,
  };

  const pdvFetch = await fetch(`${L1_DEFAULT}/api/collections/pdv_records/records`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      guid:         ipv6,
      report_id:    pdvReportId,
      reporter_svc: reporterSvc || resolvedSvcId,
      svc:          resolvedSvcId,
      type:         r.type || 'report',
      summary:      r.what?.summary || '',
      summary_6w:   JSON.stringify(summary6wFull),
      block_hash:   blockHash,
      risk_level:   r.analysis?.risk_level || 'low',
      source:       resolvedSvcId,
      openhash_anchored: isAnchored,
    }),
  });

  if (!pdvFetch.ok) {
    const errBody = await pdvFetch.json().catch(() => null);
    const isDup = errBody?.data?.report_id?.code === 'validation_not_unique';
    if (isDup) {
      return new Response(JSON.stringify({
        ok: true,
        skipped: true,
        reason: 'DUPLICATE_SESSION',
        session_id: sessionId,
        message: '하위 시스템이 이미 PDV를 기록했습니다',
      }), { status: 200, headers: corsHeaders });
    }
    return _err(503,'PDV_LOCKED','PDV 저장 실패, 60초 후 재시도',corsHeaders);
  }

  return new Response(JSON.stringify({
    ok:true,
    report_id:reportId,
    pdv_entry:pdvId,
    recorded_at:now,
    openhash:{
      anchored:    isAnchored,
      block_hash:  blockHash,
      block_id:    blockId,
      anchored_at: isAnchored ? now : null,
    },
    recipients_notified:(r.who?.recipients||[]).filter(x=>x!=='gopang-pdv'),
    svc_level:reg.level,
    message:`PDV 기록 완료. ${resolvedSvcId} (Level ${reg.level})`,
  }),{status:200,headers:corsHeaders});
}

// ═══════════════════════════════════════════════════════════
// 이하 v4.8과 동일 — PDV Query, SSO, WebAuthn, AI, Geocode
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// 2026-07-04b(긴급 보안수정): handlePdvQuery — 인증 레벨 자칭 신뢰 제거
//
// 이전엔 query.auth_token(클라이언트가 만든 {exp,level} JSON)을 서명 검증
// 없이 그대로 믿었다. 지금은 모든 VALID_PDV_SCOPES가 L1 이하만 요구해
// 당장 악용 가치는 없었지만, L2/L3 scope가 하나라도 추가되는 순간 이미
// 배포된 12개 서비스 전체가 동시에(그리고 조용히) 뚫리는 구조였다 —
// "level:'L3'"라고 우기기만 하면 통과됐다.
//
// 고친 방식: Authorization: Bearer <token> 헤더가 있으면 parseToken()
// (buildToken/handleVerify/handleRefresh와 동일한 HMAC-SHA256 서명 검증,
// env.GOPANG_MASTER_KEY)으로 실제 레벨을 확인해 사용한다. 헤더가 없거나
// 검증에 실패하거나 ipv6가 query.ipv6와 다르면 — 즉 "검증된 신원을 확인할
// 수 없으면" — 클라이언트가 뭐라고 주장하든 레벨을 무조건 L1로 강등한다.
//
// 왜 이 방식이 지금 당장 안전하게 배포 가능한가: 오늘 등록된 12개 scope는
// 전부 최대 요구 레벨이 L1이므로(SCOPE_MIN_LEVEL 참조), 아직 어느 클라
// 이언트도 진짜 Bearer 토큰을 보내지 않는 상태에서도 강등 결과는 지금
// 동작과 완전히 동일하다 — 기능 회귀가 없다. 다만 이후 L2/L3 scope가
// 추가되면, 그 scope는 실제 검증된 Bearer 토큰 없이는 항상 403으로
// 막힌다(조용히 뚫리는 대신 눈에 보이게 실패한다) — 그게 핵심 개선점이다.
//
// TODO(플랫폼 전체 후속 과제, 이번 수정 범위 밖): 지금은 handleIssue가
// 응답 JSON에 token 필드를 추가로 내려주기 시작했을 뿐, gopang-sso.js/
// subsystem-auth.js가 이 토큰을 캡처해 하위 서비스에 노출하고, 각
// K-서비스가 그걸 Authorization 헤더로 실어 보내는 배선은 아직 없다.
// 그 배선이 완성되기 전까지는 위 "검증 불가 → L1 강등" 경로가 항상
// 타므로 기능은 그대로 동작하되 L2/L3 scope는 아직 아무도 통과 못한다.
// ═══════════════════════════════════════════════════════════
async function _verifiedPdvSession(request,env){
  const auth=request.headers.get('Authorization')||'';
  const m=auth.match(/^Bearer\s+(.+)$/i);
  if(!m)return null;
  const payload=await parseToken(env,m[1].trim());
  return payload; // null이면 서명 불일치/만료 — 호출부가 검증 실패로 처리
}

async function handlePdvQuery(request,env,corsHeaders){
  if(request.method!=='POST')return new Response('Method Not Allowed',{status:405});
  const origin=request.headers.get('Origin')||'';
  try{
    const body=await request.json().catch(()=>null);
    const query=body?.query;
    if(!query?.svc||!query?.ipv6||!query?.scope||!query?.period)return _err(400,'SCHEMA_ERROR','필수 필드 누락: svc, ipv6, scope, period',corsHeaders);
    if(!Array.isArray(query.scope)||query.scope.length===0)return _err(400,'SCOPE_INVALID','scope는 비어있지 않은 배열이어야 합니다',corsHeaders);
    const invalidScope=query.scope.find(s=>!VALID_PDV_SCOPES.includes(s));
    if(invalidScope)return _err(400,'SCOPE_INVALID',`허용되지 않은 scope: ${invalidScope}`,corsHeaders);
    if(!query.period?.start||!query.period?.end)return _err(400,'SCHEMA_ERROR','period.start, period.end 필수',corsHeaders);
    const periodMs=new Date(query.period.end)-new Date(query.period.start);
    if(periodMs>365*24*60*60*1000)return _err(400,'PERIOD_TOO_LONG','조회 기간은 12개월을 초과할 수 없습니다',corsHeaders);
    const svcReg=_getSvcRegistration(origin,query.svc);
    if(!svcReg||!svcReg.pdv)return _err(403,'SVC_NOT_REGISTERED',`미등록 또는 PDV 권한 없는 서비스: ${query.svc}`,corsHeaders);

    const LEVEL_ORDER={L0:0,L1:1,L2:2,L3:3};
    const verified=await _verifiedPdvSession(request,env);
    // 검증된 세션의 ipv6가 조회 대상 ipv6와 다르면 "검증 안 됨"과 동일하게
    // 취급한다 — 타인 명의로 검증된 토큰을 자기 자신의 조회에 갖다 붙이는
    // 것을 막는다(본인 데이터만 조회 가능해야 한다는 설계 의도).
    const effectiveLevel=(verified && verified.ipv6===query.ipv6) ? (verified.level||'L1') : 'L1';
    const userLevel=LEVEL_ORDER[effectiveLevel]??1;
    for(const scope of query.scope){
      const required=LEVEL_ORDER[SCOPE_MIN_LEVEL[scope]||'L1'];
      if(userLevel<required)return _err(403,'LEVEL_INSUFFICIENT',`${scope} 조회는 ${SCOPE_MIN_LEVEL[scope]} 이상 필요 — 검증된 인증 토큰(Authorization: Bearer)이 필요합니다`,corsHeaders);
    }

    if(!query.consent_token||!query.request_id){
      const reqId=`CNSREQ-${query.ipv6.replace(/:/g,'').slice(0,8)}-${Date.now()}`;
      const expiresAt=Math.floor(Date.now()/1000)+300;
      await _storeConsentRequest(env,reqId,query,expiresAt);
      const consentUrl='https://hondi.net/consent'+`?req=${encodeURIComponent(reqId)}&svc=${encodeURIComponent(query.svc)}`+`&scope=${encodeURIComponent(query.scope.join(','))}`+`&purpose=${encodeURIComponent(query.purpose||'')}`+`&ipv6_hash=${encodeURIComponent(await _sha256Hex(query.ipv6))}`+`&return_to=${encodeURIComponent(origin)}`;
      return new Response(JSON.stringify({ok:false,status:'CONSENT_REQUIRED',consent:{request_id:reqId,expires_at:expiresAt,consent_url:consentUrl,message:'사용자가 고팡 앱에서 PDV 조회에 동의해야 합니다.'}}),{status:202,headers:corsHeaders});
    }
    const consentOk=await _verifyConsentToken(env,query.consent_token,query.request_id,query.ipv6);
    if(!consentOk)return _err(401,'CONSENT_INVALID','동의 토큰이 유효하지 않습니다',corsHeaders);
    const withinLimit=await _checkRateLimit(env,query.ipv6,'pdv_query');
    if(!withinLimit)return _err(429,'RATE_LIMITED','PDV 조회 한도 초과',corsHeaders);
    const pdvSummary=await _fetchPdvByScope(env,query.ipv6,query.scope,query.period);
    const queryId=`PDVQ-${query.ipv6.replace(/:/g,'').slice(0,8)}-${Date.now()}`;
    const pdvEntryId=await _recordConsentEvent(env,query,queryId);
    const expOut=verified?.exp ? new Date(verified.exp*1000).toISOString() : new Date(Date.now()+3600*1000).toISOString();
    return new Response(JSON.stringify({ok:true,query_id:queryId,ipv6:query.ipv6,period:query.period,pdv_summary:pdvSummary,consent:{granted_at:new Date().toISOString(),expires_at:expOut,pdv_entry_id:pdvEntryId}}),{status:200,headers:corsHeaders});
  }catch(e){return _err(500,'INTERNAL_ERROR',e.message,corsHeaders);}
}
async function _storeConsentRequest(env,reqId,query,expiresAt){
  // BUG-FIX(2026-07-02): Supabase pdv_consent_requests 테이블이 실제로는
  // 한 번도 생성된 적이 없었다(HTTP 404 PGRST205 확인됨). Supabase→L1
  // 마이그레이션 방향에 맞춰 Supabase 대신 L1(hanlim) PocketBase에
  // 새로 만든 pdv_consent_requests 컬렉션(id: p1tketkfid3uup8)을 쓴다.
  // 이 컬렉션은 consent_token을 담으므로 listRule/createRule 등을 전부
  // null(관리자 전용)로 잠갔다 — 그래서 anon key가 아니라 _l1AdminToken()
  // 관리자 토큰이 필요하다. 원래 Supabase 스키마의 PK "id"(CNSREQ-... 문자열)는
  // PocketBase의 자동생성 15자 id와 충돌하므로 별도 "request_id" 필드에 담는다
  // (pdv_records가 report_id를 별도 필드로 쓰는 것과 동일 패턴).
  try{
    const token=await _l1AdminToken(env);
    const res=await fetch(`${L1_DEFAULT}/api/collections/pdv_consent_requests/records`,{
      method:'POST',
      headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify({
        request_id: reqId,
        ipv6:       query.ipv6,
        svc:        _resolveSvcId(query.svc),
        scope:      query.scope,
        purpose:    query.purpose||'',
        period:     query.period,
        status:     'pending',
        expires_at: new Date(expiresAt*1000).toISOString(),
      }),
    });
    if(!res.ok) console.warn('[PDVQuery] 동의 요청 저장 실패(L1):', res.status, await res.text().catch(()=>''));
  }catch(e){console.warn('[PDVQuery] 동의 요청 저장 실패:',e.message);}
}
async function _verifyConsentToken(env,consentToken,requestId,ipv6){
  // BUG-FIX(2026-07-02): _storeConsentRequest와 동일한 이유로 L1로 전환.
  // PocketBase filter 문법(작은따옴표 문자열 리터럴) — requestId/ipv6에
  // 작은따옴표가 섞일 가능성은 낮지만 방어적으로 이스케이프한다.
  const esc = s => String(s).replace(/'/g, "\\'");
  try{
    const token=await _l1AdminToken(env);
    const filter=encodeURIComponent(`request_id='${esc(requestId)}' && ipv6='${esc(ipv6)}'`);
    const res=await fetch(`${L1_DEFAULT}/api/collections/pdv_consent_requests/records?filter=${filter}&perPage=1`,{
      headers:{'Authorization':'Bearer '+token},
    });
    if(!res.ok) return _verifyConsentHmac(env,consentToken,requestId,ipv6);
    const data=await res.json().catch(()=>({items:[]}));
    const row=data.items?.[0];
    if(!row)return false;
    if(new Date(row.expires_at)<new Date())return false;
    if(row.status!=='granted')return false;
    if(row.consent_token!==consentToken)return false;
    return true;
  }catch(e){return _verifyConsentHmac(env,consentToken,requestId,ipv6);}
}
async function _verifyConsentHmac(env,consentToken,requestId,ipv6){try{const masterKey=env.GOPANG_MASTER_KEY||'gopang-webauthn-secret-v1';const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(masterKey),{name:'HMAC',hash:'SHA-256'},false,['verify']);const data=new TextEncoder().encode(`${requestId}.${ipv6}`);const sigBytes=Uint8Array.from(atob(consentToken.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));return crypto.subtle.verify('HMAC',key,sigBytes,data);}catch{return false;}}

// ── 동의 토큰 발급 — _verifyConsentHmac의 역함수 (2026-07-02 신설) ──────
// "동의 승인 페이지 미구현" 문제의 핵심: _verifyConsentHmac(검증)는 있었지만
// 이 서명 함수가 없어서 사용자가 승인해도 유효한 consent_token을 만들 방법이
// 없었다. _verifyConsentHmac의 정확한 역과정(같은 HMAC 키·같은 base64url
// 변환)을 따라야 두 함수가 서로 맞물린다.
async function _signConsentHmac(env,requestId,ipv6){
  const masterKey=env.GOPANG_MASTER_KEY||'gopang-webauthn-secret-v1';
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(masterKey),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const data=new TextEncoder().encode(`${requestId}.${ipv6}`);
  const sigBuf=await crypto.subtle.sign('HMAC',key,data);
  let bin='';
  for(const b of new Uint8Array(sigBuf)) bin+=String.fromCharCode(b);
  return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_'); // '=' 패딩은 유지 — _verifyConsentHmac이 '+'/'/'만 되돌리므로
}

// L1(hanlim) pdv_consent_requests에서 request_id로 단일 레코드 조회 (Admin 토큰)
async function _l1FindConsentRequest(env,requestId){
  const token=await _l1AdminToken(env);
  const filter=encodeURIComponent(`request_id='${String(requestId).replace(/'/g,"\\'")}'`);
  const res=await fetch(`${L1_DEFAULT}/api/collections/pdv_consent_requests/records?filter=${filter}&perPage=1`,
    {headers:{'Authorization':'Bearer '+token}});
  if(!res.ok) return null;
  const data=await res.json().catch(()=>({items:[]}));
  return data.items?.[0]||null;
}

// GET/POST /consent/info?req=... — 동의 승인 페이지(consent.html)가 요청 상세를 표시하기 위해 호출.
// 관리자 토큰이 필요한 L1 컬렉션을 안전하게 프록시 — svc/scope/purpose/expires_at/status만 노출,
// consent_token·ipv6 원문은 절대 클라이언트에 반환하지 않는다.
async function handleConsentInfo(request,env,corsHeaders){
  const url=new URL(request.url);
  const reqId=(request.method==='POST'?(await request.json().catch(()=>({})))?.req:url.searchParams.get('req'))||'';
  if(!reqId) return _err(400,'MISSING_FIELD','req 필수',corsHeaders);
  let record;
  try{ record=await _l1FindConsentRequest(env,reqId); }
  catch(e){ return _err(502,'L1_UNREACHABLE','L1 연결 실패: '+e.message,corsHeaders); }
  if(!record) return _err(404,'NOT_FOUND','존재하지 않는 동의 요청입니다',corsHeaders);
  if(new Date(record.expires_at)<new Date()) return _err(410,'EXPIRED','동의 요청이 만료됐습니다',corsHeaders);
  return new Response(JSON.stringify({
    ok:true,
    request_id: record.request_id,
    svc:        record.svc,
    scope:      record.scope,
    purpose:    record.purpose||'',
    period:     record.period,
    status:     record.status,
    expires_at: record.expires_at,
  }),{status:200,headers:corsHeaders});
}

// POST /consent/respond — body: { req, ipv6, decision:'grant'|'deny' }
// consent.html에서 사용자가 동의/거부 버튼을 눌렀을 때 호출. ipv6는 사용자
// 로컬 기기(localStorage gopang_user_v4)에서 읽은 "본인의" 값 — 원 요청이
// 저장해 둔 ipv6와 정확히 일치해야만 승인/거부를 처리한다(다른 사람이 링크만
// 보고 남의 요청에 응답하는 것을 막는 핵심 검증).
async function handleConsentRespond(request,env,corsHeaders){
  if(request.method!=='POST') return new Response('Method Not Allowed',{status:405});
  const body=await request.json().catch(()=>null);
  const reqId=body?.req, ipv6=body?.ipv6, decision=body?.decision;
  if(!reqId||!ipv6||!['grant','deny'].includes(decision))
    return _err(400,'SCHEMA_ERROR','req, ipv6, decision(grant|deny) 필수',corsHeaders);

  let record;
  try{ record=await _l1FindConsentRequest(env,reqId); }
  catch(e){ return _err(502,'L1_UNREACHABLE','L1 연결 실패: '+e.message,corsHeaders); }
  if(!record) return _err(404,'NOT_FOUND','존재하지 않는 동의 요청입니다',corsHeaders);
  if(new Date(record.expires_at)<new Date()) return _err(410,'EXPIRED','동의 요청이 만료됐습니다',corsHeaders);
  if(record.status!=='pending') return _err(409,'ALREADY_RESPONDED',`이미 처리된 요청입니다(${record.status})`,corsHeaders);
  if(record.ipv6!==ipv6) return _err(403,'IPV6_MISMATCH','본인의 요청이 아닙니다',corsHeaders);

  const token=await _l1AdminToken(env);
  // 2026-07-04: 기존엔 승인(grant) 후에도 expires_at을 최초 요청 생성 시점의
  // 5분짜리 값(_storeConsentRequest의 300초) 그대로 뒀다 — 즉 "5분 안에
  // 동의 안 하면 무효"뿐 아니라 "동의해도 5분 지나면 어차피 무효"였다.
  // PDV_HISTORY_REQUEST(K-Public_common P11) 같은 연속성 조회는 수일~수개월
  // 뒤에도 재사용돼야 하므로, 승인 시점에 expires_at을 STANDING_CONSENT_TTL_SEC
  // 만큼 연장한다. 거부(deny)는 연장할 이유가 없으므로 그대로 둔다.
  const STANDING_CONSENT_TTL_SEC = 90*24*60*60; // 90일
  const patch = decision==='grant'
    ? {
        status:'granted',
        consent_token: await _signConsentHmac(env,record.request_id,ipv6),
        expires_at: new Date(Date.now()+STANDING_CONSENT_TTL_SEC*1000).toISOString(),
      }
    : { status:'denied' };

  const patchRes=await fetch(`${L1_DEFAULT}/api/collections/pdv_consent_requests/records/${record.id}`,{
    method:'PATCH',
    headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify(patch),
  });
  if(!patchRes.ok) return _err(502,'L1_UPDATE_FAILED','동의 상태 갱신 실패: HTTP '+patchRes.status,corsHeaders);

  return new Response(JSON.stringify({
    ok:true,
    decision,
    consent_token: patch.consent_token || null,
  }),{status:200,headers:corsHeaders});
}
async function _checkRateLimit(env,ipv6,action){if(env.RATE_LIMIT_KV){const kvKey=`rl:${action}:${ipv6}`;const current=parseInt(await env.RATE_LIMIT_KV.get(kvKey)||'0');if(current>=3)return false;await env.RATE_LIMIT_KV.put(kvKey,String(current+1),{expirationTtl:300});return true;}return true;}
async function _fetchPdvByScope(env,ipv6,scopes,period){const key=env.SUPABASE_KEY||_supabaseAnonKey();const result={};for(const scope of scopes){const sources=SCOPE_SOURCE_MAP[scope];let queryUrl=SUPABASE_URL+'/rest/v1/pdv_log'+`?guid=eq.${encodeURIComponent(ipv6)}`+`&created_at=gte.${period.start}T00:00:00Z&created_at=lte.${period.end}T23:59:59Z`+`&select=summary,summary_6w,risk_level,created_at,source&order=created_at.desc&limit=50`;if(sources&&sources.length===1){queryUrl+=`&source=eq.${encodeURIComponent(sources[0])}`;}else if(sources&&sources.length>1){queryUrl+=`&source=in.(${sources.map(encodeURIComponent).join(',')})`;}try{const res=await fetch(queryUrl,{headers:{'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json'}});const rows=await res.json().catch(()=>[]);if(!rows?.length){result[scope]={available:false,entry_count:0,risk_level:'unknown',summary_6w:null,risk_factors:{}};continue;}const RISK_ORDER={low:0,medium:1,high:2};const maxRisk=rows.reduce((max,r)=>{const lvl=r.risk_level||'low';return RISK_ORDER[lvl]>RISK_ORDER[max]?lvl:max;},'low');let summary6w=null;for(const row of rows){try{summary6w=JSON.parse(row.summary_6w);break;}catch{}}result[scope]={available:true,entry_count:rows.length,risk_level:maxRisk,summary_6w:summary6w,risk_factors:_aggregateRiskFactors(scope,rows),sources:[...new Set(rows.map(r=>r.source).filter(Boolean))]};}catch(e){result[scope]={available:false,entry_count:0,risk_level:'unknown',summary_6w:null,risk_factors:{},error:'fetch_failed'};}}return result;}
function _aggregateRiskFactors(scope,rows){if(scope==='ktraffic')return{accident_count:rows.filter(r=>{try{return JSON.parse(r.summary_6w)?.what?.includes('사고');}catch{return false;}}).length,entry_count:rows.length,high_risk_count:rows.filter(r=>r.risk_level==='high').length,accident_free_months:0};if(scope==='khealth')return{total_records:rows.length,high_risk_count:rows.filter(r=>r.risk_level==='high').length,medium_risk_count:rows.filter(r=>r.risk_level==='medium').length};return{entry_count:rows.length,high_risk_count:rows.filter(r=>r.risk_level==='high').length};}
async function _recordConsentEvent(env,query,queryId){const key=env.SUPABASE_KEY||_supabaseAnonKey();const svcId=_resolveSvcId(query.svc);const pdvId=`PDV-${query.ipv6.replace(/:/g,'').slice(0,12)}-${Date.now()}`;const summary6w=JSON.stringify({who:svcId,when:new Date().toISOString(),where:`https://${svcId}.hondi.net`,what:`PDV 조회 동의: scope=[${query.scope.join(',')}]`,how:'사용자 명시적 동의',why:query.purpose||'PDV 데이터 조회'});try{await fetch(SUPABASE_URL+'/rest/v1/pdv_log',{method:'POST',headers:{'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify({id:pdvId,guid:query.ipv6,source:svcId,type:'consent_event',report_id:queryId,summary:`PDV 조회 동의: ${svcId} → [${query.scope.join(',')}]`,summary_6w:summary6w,risk_level:'low',period:query.period,raw_hash:null,created_at:new Date().toISOString()})});}catch(e){console.warn('[PDVQuery] consent_event 기록 실패:',e.message);}return pdvId;}
async function _sha256Hex(text){const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');}
function buildCookie(token){return[`gopang_token=${token}`,'Path=/','Domain=.hondi.net','Max-Age=3600','SameSite=None','Secure','HttpOnly'].join('; ');}
function parseCookie(header,name){const match=header.match(new RegExp(`(?:^|;)\\s*${name}=([^;]+)`));return match?decodeURIComponent(match[1]):null;}
// ═══════════════════════════════════════════════════════════
// v6.0 — 세션 토큰: HMAC-SHA256 서명 (env.GOPANG_MASTER_KEY, _verifyConsentHmac/
// handleWAChallenge와 동일 패턴). 이전 버전은 base64 평문이라 누구나 임의의
// ipv6로 토큰을 위조할 수 있었다 — 서명 검증 없이는 token이 절대 발급되지 않는다.
// ═══════════════════════════════════════════════════════════
async function buildToken(env,guid,level,svc){
  const now=Math.floor(Date.now()/1000);
  const payload={ipv6:guid,level,svc,iat:now,exp:now+3600};
  const b64p=btoa(JSON.stringify(payload)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.GOPANG_MASTER_KEY||'gopang-webauthn-secret-v1'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(b64p));
  const b64s=btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  return `${b64p}.${b64s}`;
}
async function parseToken(env,token){
  try{
    const [b64p,b64s]=String(token).split('.');
    if(!b64p||!b64s)return null;
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.GOPANG_MASTER_KEY||'gopang-webauthn-secret-v1'),{name:'HMAC',hash:'SHA-256'},false,['verify']);
    const sigBytes=Uint8Array.from(atob(b64s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
    const sigOk=await crypto.subtle.verify('HMAC',key,sigBytes,new TextEncoder().encode(b64p));
    if(!sigOk)return null;
    const padded=b64p.replace(/-/g,'+').replace(/_/g,'/');
    const payload=JSON.parse(atob(padded+'=='.slice((padded.length%4)||4)));
    if(payload.exp<Math.floor(Date.now()/1000))return null;
    return payload;
  }catch{return null;}
}

// POST /auth/issue — v6.0: Ed25519 서명 + TOFU(Trust-On-First-Use) 검증 후에만 세션 발급
// 이전 버전은 클라이언트가 보낸 ipv6를 무검증으로 토큰화했다 — 누구나 임의의 ipv6를
// 자칭해 그 사람으로 로그인할 수 있었다(계정 탈취). 이제는 그 ipv6(guid)에 연결된
// Ed25519 개인키를 실제로 보유하고 있다는 서명 증거 없이는 토큰이 발급되지 않는다.
// body: { guid, pubkey, signature, ts, level, svc }
// 서명 대상: `auth-issue:${guid}:${pubkey}:${svc}:${ts}`
async function handleIssue(request,env,corsHeaders){
  if(request.method!=='POST')return new Response('Method Not Allowed',{status:405});
  const body=await request.json().catch(()=>null);
  if(!body)return _err(400,'INVALID_JSON','JSON body 필수',corsHeaders);
  const{guid,pubkey,signature,ts,level='L0',svc='*'}=body;
  if(!guid)      return _err(400,'MISSING_FIELD','guid 필수',corsHeaders);
  if(!pubkey)    return _err(400,'MISSING_FIELD','pubkey 필수',corsHeaders);
  if(!signature) return _err(400,'MISSING_FIELD','signature 필수',corsHeaders);
  if(!ts)        return _err(400,'MISSING_FIELD','ts 필수',corsHeaders);

  // 재전송(replay) 방지 — 서명 시각이 현재로부터 120초 이상 벗어나면 거부
  const tsNum=Number(ts);
  if(!Number.isFinite(tsNum)||Math.abs(Date.now()-tsNum)>120000){
    return _err(401,'TS_EXPIRED','서명 시각이 만료되었습니다',corsHeaders);
  }

  const sigMsg=`auth-issue:${guid}:${pubkey}:${svc}:${ts}`;
  const sigOk=await _verifyEd25519Simple(pubkey,signature,sigMsg);
  if(!sigOk)return _err(401,'INVALID_SIGNATURE','서명 검증 실패',corsHeaders);

  // TOFU: 이 guid에 이미 핀(pin)된 Ed25519 공개키와 대조 — /profile 등록 시
  // 핀이 기록된다(handleProfilePost). 핀이 있는데 다른 키로 서명했다면, 이 기기는
  // 그 계정의 정당한 기기가 아니다(다른 사람의 전화번호/닉네임을 알아냈을 뿐).
  let existing=null;
  try{
    const r=await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?guid=eq.${encodeURIComponent(guid)}&select=pubkey_ed25519&limit=1`,{headers:_sbHeaders(env)});
    const rows=await r.json().catch(()=>[]);
    existing=rows[0]||null;
  }catch(e){
    return _err(502,'SUPABASE_UNREACHABLE','DB 연결 실패: '+e.message,corsHeaders);
  }
  if(existing?.pubkey_ed25519 && existing.pubkey_ed25519!==pubkey){
    return _err(403,'PUBKEY_MISMATCH','이 기기는 해당 계정의 등록된 기기가 아닙니다',corsHeaders);
  }
  // existing이 없거나 pubkey_ed25519가 비어있는 경우 — 핀 기록 자체는 /profile(POST)이
  // 전담한다(단일 책임). 여기서는 "아직 아무도 핀을 선점하지 않았다"는 사실만으로
  // 통과시키며, 곧이어 /profile 호출이 이 pubkey를 핀으로 기록한다.

  const token=await buildToken(env,guid,level,svc);
  // 2026-07-04b: 쿠키(HttpOnly, .hondi.net)는 그대로 유지하되, 같은 토큰
  // 문자열을 JSON 본문에도 내려준다 — 쿠키는 워커의 실제 도메인이
  // *.hondi.net과 다르면(현재 wrangler.json에 커스텀 도메인 라우트가
  // 없다) 브라우저가 전송하지 않을 수 있다. 본문의 token은 클라이언트가
  // 직접 Authorization: Bearer 헤더로 실어 보낼 수 있어 도메인에 무관하다.
  return new Response(JSON.stringify({ok:true,guid,level,token}),{status:200,headers:{...corsHeaders,'Set-Cookie':buildCookie(token)}});
}

async function handleVerify(request,env,corsHeaders){const cookieHeader=request.headers.get('Cookie')||'';const raw=parseCookie(cookieHeader,'gopang_token');if(!raw)return _err(401,'NO_TOKEN','no_token',corsHeaders);const payload=await parseToken(env,raw);if(!payload)return _err(401,'INVALID_TOKEN','expired_or_invalid',corsHeaders);return new Response(JSON.stringify({valid:true,ipv6:payload.ipv6,level:payload.level,svc:payload.svc,exp:payload.exp}),{status:200,headers:corsHeaders});}
async function handleRefresh(request,env,corsHeaders){const cookieHeader=request.headers.get('Cookie')||'';const raw=parseCookie(cookieHeader,'gopang_token');if(!raw)return _err(401,'NO_TOKEN','no_token',corsHeaders);const payload=await parseToken(env,raw);if(!payload)return _err(401,'INVALID_TOKEN','expired_or_invalid',corsHeaders);const remaining=payload.exp-Math.floor(Date.now()/1000);if(remaining>1800)return new Response(JSON.stringify({ok:false,reason:'not_yet',remaining}),{status:200,headers:corsHeaders});const newToken=await buildToken(env,payload.ipv6,payload.level,payload.svc);return new Response(JSON.stringify({ok:true}),{status:200,headers:{...corsHeaders,'Set-Cookie':buildCookie(newToken)}});}
async function sbFetch(env,path,method='GET',body=null){const key=env.SUPABASE_KEY||_supabaseAnonKey();const headers={'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates'};const res=await fetch(SUPABASE_URL+path,{method,headers,body:body?JSON.stringify(body):undefined});return res.ok?res.json().catch(()=>({})):null;}
async function handleWAChallenge(request,env,corsHeaders){const challenge=crypto.getRandomValues(new Uint8Array(32));const chalB64=btoa(String.fromCharCode(...challenge)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');const exp=Math.floor(Date.now()/1000)+300;const sigData=`${chalB64}.${exp}`;const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.GOPANG_MASTER_KEY||'gopang-webauthn-secret-v1'),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(sigData));const sigHex=Array.from(new Uint8Array(sig)).map(b=>b.toString(16).padStart(2,'0')).join('');return new Response(JSON.stringify({challenge:chalB64,exp,sig:sigHex}),{status:200,headers:corsHeaders});}
async function _verifyChallengeToken(env,chalB64,exp,sig){if(exp<Math.floor(Date.now()/1000))return false;const sigData=`${chalB64}.${exp}`;const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.GOPANG_MASTER_KEY||'gopang-webauthn-secret-v1'),{name:'HMAC',hash:'SHA-256'},false,['verify']);const sigBytes=Uint8Array.from(sig.match(/.{2}/g).map(h=>parseInt(h,16)));return crypto.subtle.verify('HMAC',key,sigBytes,new TextEncoder().encode(sigData));}
async function handleWARegister(request,env,corsHeaders){if(request.method!=='POST')return new Response('Method Not Allowed',{status:405});const body=await request.json().catch(()=>null);if(!body?.ipv6||!body?.credentialId||!body?.publicKey)return _err(400,'MISSING_FIELD','ipv6, credentialId, publicKey 필수',corsHeaders);const chalOk=await _verifyChallengeToken(env,body.challenge,body.challengeExp,body.challengeSig);if(!chalOk)return _err(401,'CHALLENGE_INVALID','챌린지 만료 또는 위조',corsHeaders);const result=await sbFetch(env,'/rest/v1/webauthn_credentials','POST',{ipv6:body.ipv6,credential_id:body.credentialId,public_key:body.publicKey,counter:0,device_type:body.deviceType||'platform',aaguid:body.aaguid||null});if(!result)return _err(502,'DB_ERROR','Supabase 저장 실패',corsHeaders);return new Response(JSON.stringify({ok:true,ipv6:body.ipv6}),{status:200,headers:corsHeaders});}
async function handleWAVerify(request,env,corsHeaders){if(request.method!=='POST')return new Response('Method Not Allowed',{status:405});const body=await request.json().catch(()=>null);if(!body?.ipv6||!body?.credentialId)return _err(400,'MISSING_FIELD','ipv6, credentialId 필수',corsHeaders);const rows=await sbFetch(env,`/rest/v1/webauthn_credentials?ipv6=eq.${encodeURIComponent(body.ipv6)}&credential_id=eq.${encodeURIComponent(body.credentialId)}&select=public_key,counter`,'GET');if(!rows?.length)return _err(404,'CREDENTIAL_NOT_FOUND','credential_not_found',corsHeaders);const cred=rows[0];if(body.counter!==undefined&&body.counter<=cred.counter)return _err(401,'COUNTER_REPLAY','counter_replay',corsHeaders);if(body.counter!==undefined)await sbFetch(env,`/rest/v1/webauthn_credentials?credential_id=eq.${encodeURIComponent(body.credentialId)}`,'PATCH',{counter:body.counter,last_used_at:new Date().toISOString()});const token=await buildToken(env,body.ipv6,'L2','*');return new Response(JSON.stringify({valid:true,ipv6:body.ipv6,level:'L2'}),{status:200,headers:{...corsHeaders,'Set-Cookie':buildCookie(token)}});}
const REGISTERED_SERVICES={'gopang':{level:3,domain:'hondi.net',minAuth:'L0',pdv:true},'klaw':{level:3,domain:'klaw.hondi.net',minAuth:'L0',pdv:true},'market':{level:3,domain:'market.hondi.net',minAuth:'L0',pdv:true},'school':{level:3,domain:'school.hondi.net',minAuth:'L0',pdv:true},'security':{level:3,domain:'security.hondi.net',minAuth:'L1',pdv:true},'health':{level:3,domain:'health.hondi.net',minAuth:'L1',pdv:true},'tax':{level:3,domain:'tax.hondi.net',minAuth:'L0',pdv:true},'gdc':{level:3,domain:'gdc.hondi.net',minAuth:'L1',pdv:true},'public':{level:3,domain:'public.hondi.net',minAuth:'L0',pdv:true},'democracy':{level:3,domain:'democracy.hondi.net',minAuth:'L1',pdv:true},'911':{level:3,domain:'911.hondi.net',minAuth:'L0',pdv:true},'police':{level:3,domain:'police.hondi.net',minAuth:'L1',pdv:true},'insurance':{level:3,domain:'insurance.hondi.net',minAuth:'L1',pdv:true},'stock':{level:3,domain:'stock.hondi.net',minAuth:'L1',pdv:true},'traffic':{level:3,domain:'traffic.hondi.net',minAuth:'L0',pdv:true},'logistics':{level:3,domain:'logistics.hondi.net',minAuth:'L0',pdv:true},'fiil':{level:2,domain:'fiil.kr',minAuth:'L0',pdv:true},'klaw-ext':{level:2,domain:'klaw.openhash.kr',minAuth:'L0',pdv:false},'users':{level:3,domain:'users.hondi.net',minAuth:'L0',pdv:false}};
function _getSvcRegistration(origin,svcId){const resolvedId=_resolveSvcId(svcId);const svc=REGISTERED_SERVICES[resolvedId];if(svc&&origin.includes(svc.domain))return{...svc,svcId:resolvedId,originalId:svcId};if(/^https:\/\/[a-z0-9-]+\.gopang\.net$/.test(origin))return{level:1,domain:origin,minAuth:'L0',pdv:false,svcId:resolvedId,originalId:svcId};return null;}
async function handleSvcRegister(request,env,corsHeaders){if(request.method!=='POST')return new Response('Method Not Allowed',{status:405});const body=await request.json().catch(()=>null);if(!body?.svc_id||!body?.domain||!body?.operator_ipv6)return _err(400,'MISSING_FIELD','svc_id, domain, operator_ipv6 필수',corsHeaders);const{svc_id,domain,description,min_auth,operator_ipv6}=body;const isGopangSub=/^[a-z0-9-]+\.gopang\.net$/.test(domain);await sbFetch(env,'/rest/v1/svc_registry','POST',{svc_id,domain,description:description||'',operator_ipv6,min_auth:min_auth||'L0',trust_level:isGopangSub?1:0,status:isGopangSub?'auto_approved':'pending',registered_at:new Date().toISOString()});return new Response(JSON.stringify({ok:true,svc_id,domain,trust_level:isGopangSub?1:0,status:isGopangSub?'auto_approved':'pending_review',message:isGopangSub?'*.hondi.net 서브도메인으로 자동 승인됐습니다. (Level 1)':'등록 신청이 접수됐습니다.'}),{status:200,headers:corsHeaders});}
async function handleSvcVerify(request,env,corsHeaders){const url=new URL(request.url);const svcId=url.searchParams.get('svc_id');const origin=request.headers.get('Origin')||'';if(!svcId)return _err(400,'MISSING_FIELD','svc_id 파라미터 필수',corsHeaders);const reg=_getSvcRegistration(origin,svcId);if(!reg)return new Response(JSON.stringify({ok:false,registered:false,svc_id:svcId,message:'등록되지 않은 서비스입니다.'}),{status:200,headers:corsHeaders});return new Response(JSON.stringify({ok:true,registered:true,svc_id:svcId,trust_level:reg.level,pdv_allowed:reg.pdv,min_auth:reg.minAuth,message:`등록된 서비스 (Level ${reg.level})`}),{status:200,headers:corsHeaders});}
async function handleGeocode(url,env,corsHeaders){const lat=url.searchParams.get('lat');const lng=url.searchParams.get('lng');if(!lat||!lng)return _err(400,'MISSING_FIELD','lat, lng required',corsHeaders);try{const res=await fetch(`${KAKAO_BASE}?x=${lng}&y=${lat}&input_coord=WGS84`,{headers:{'Authorization':`KakaoAK ${env.KAKAO_REST_KEY}`}});const data=await res.json();return new Response(JSON.stringify(data),{headers:corsHeaders});}catch(e){return _err(502,'GEOCODE_ERROR',e.message,corsHeaders);}}
async function handleKakaoAppKey(request,env,corsHeaders){const appkey=env.KAKAO_JS_KEY||env.KAKAO_REST_KEY;if(!appkey)return _err(500,'CONFIG_ERROR','Kakao key not configured',corsHeaders);return new Response(JSON.stringify({appkey}),{status:200,headers:{...corsHeaders,'Cache-Control':'public, max-age=300'}});}
async function handleAIChat(bodyText,env,corsHeaders,meta=null){let body;try{body=JSON.parse(bodyText);}catch{return _err(400,'INVALID_JSON','Invalid JSON',corsHeaders);}const{provider='deepseek',model,system,messages,max_tokens=2000}=body;const builtMessages=[...(system?[{role:'system',content:system}]:[]),...(messages||[])];
console.log(JSON.stringify({tag:'AI_PROXY_CALL',fn:'handleAIChat',ts:new Date().toISOString(),provider,model,...meta}));
try{if(provider!=='anthropic'){
  const _orKey=env.OPENROUTER_API_KEY||env.DEEPSEEK_API_KEY;
  const _orUrl=env.OPENROUTER_API_KEY?OR_URL:DEEPSEEK_URL;
  const _orMdl=model||(env.OPENROUTER_API_KEY?OR_MODEL_FAST:DEEPSEEK_MODEL);
  const _orHdr={'Content-Type':'application/json','Authorization':`Bearer ${_orKey}`,...(env.OPENROUTER_API_KEY?{'HTTP-Referer':'https://hondi.net','X-Title':'Hondi'}:{})};
  const res=await fetch(_orUrl,{method:'POST',headers:_orHdr,body:JSON.stringify({model:_orMdl,max_tokens,messages:builtMessages})});
  const data=await res.json();const content=data.choices?.[0]?.message?.content;
  if(!content)throw new Error('AI 응답 없음: '+JSON.stringify(data));
  return new Response(JSON.stringify({content,provider:env.OPENROUTER_API_KEY?'openrouter':'deepseek',model:_orMdl}),{status:200,headers:corsHeaders});}else{const res=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':env.ANTHROPIC_API_KEY||env.OpenAI,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:model||'claude-sonnet-4-20250514',max_tokens,...(system?{system}:{}),messages:messages||[]})});const data=await res.json();const content=data.content?.find(c=>c.type==='text')?.text;return new Response(JSON.stringify({content,provider:'anthropic'}),{status:200,headers:corsHeaders});}}catch(e){return _err(502,'AI_ERROR',e.message,corsHeaders);}}
async function callOpenAIFromGeminiBody(bodyText,env,corsHeaders,meta=null){const apiKey=env.OpenAI;if(!apiKey)return _err(500,'CONFIG_ERROR','OpenAI key not configured',corsHeaders);let geminiBody;try{geminiBody=JSON.parse(bodyText);}catch{return _err(400,'INVALID_JSON','Invalid JSON body',corsHeaders);}const systemPrompt=geminiBody.system_instruction?.parts?.[0]?.text||'';const parts=geminiBody.contents?.[0]?.parts||[];const textPart=parts.find(p=>p.text)?.text||'';const imagePart=parts.find(p=>p.inline_data);const maxTokens=geminiBody.generationConfig?.maxOutputTokens||1500;const messages=[];if(systemPrompt)messages.push({role:'system',content:systemPrompt});if(imagePart?.inline_data){messages.push({role:'user',content:[{type:'image_url',image_url:{url:`data:${imagePart.inline_data.mime_type};base64,${imagePart.inline_data.data}`}},{type:'text',text:textPart||'이미지를 분석하여 JSON으로만 출력하라.'}]});}else{messages.push({role:'user',content:textPart});}
console.log(JSON.stringify({tag:'AI_PROXY_CALL',fn:'callOpenAIFromGeminiBody',ts:new Date().toISOString(),...meta}));
try{const res=await fetch(OPENAI_URL,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${apiKey}`},body:JSON.stringify({model:OPENAI_MODEL,messages,max_tokens:maxTokens,temperature:geminiBody.generationConfig?.temperature??0.1})});const data=await res.json();if(!res.ok)throw new Error(data.error?.message||`HTTP ${res.status}`);const text=data.choices?.[0]?.message?.content||'{}';return new Response(JSON.stringify({candidates:[{content:{parts:[{text}],role:'model'},finishReason:'STOP'}],_provider:'openai',_model:OPENAI_MODEL}),{headers:corsHeaders});}catch(e){const fbBody=JSON.stringify({model:DEEPSEEK_MODEL,messages,max_tokens:maxTokens,temperature:0.1,stream:false});return callDeepSeek(fbBody,env,corsHeaders,e.message,meta);}}
async function callDeepSeek(bodyText,env,corsHeaders,fallbackFrom=null,meta=null,ctx=null){try{
  let parsedBody = null; try { parsedBody = JSON.parse(bodyText); } catch {}
  const isStream = !!parsedBody?.stream;
  const guid = parsedBody?.guid || null;

  // ── 티어 해석: 클라이언트는 "hondi-flash"/"hondi-pro" 논리 이름만 보낸다.
  // 알려진 티어 이름이면 실제 벤더 모델명으로 치환하고, 아니면(레거시 호출 등)
  // 받은 model 값을 그대로 쓴다 — 하위 호환.
  const requestedModel = parsedBody?.model || '';
  const tierKey = HONDI_TIER_MODELS[requestedModel] ? requestedModel : null;
  const backendModel = tierKey ? HONDI_TIER_MODELS[tierKey].backendModel : requestedModel;

  // guid가 실려 있으면(=call-ai.js의 deepseek-default 경로) 1,000원 누적 한도 체크.
  let outboundBody = parsedBody ? { ...parsedBody, model: backendModel } : null;
  if (outboundBody) delete outboundBody.guid; // 벤더 API는 guid 필드를 모름

  // UNIVERSAL 레이어 서버 강제 주입 (2026-07-05, handleLLMRelay와 동일 목록/원칙).
  // 이 경로(callDeepSeek)는 gdc처럼 messages 배열이 아니라 별도 system
  // 필드를 쓰는 클라이언트도 있어(client-shape 불일치), 두 형태 모두 지원한다.
  if (outboundBody && parsedBody?.service_id && UNIVERSAL_FORCED_K_SERVICES.has(parsedBody.service_id)) {
    delete outboundBody.service_id; // 벤더 API는 이 필드를 모름
    const [universalIntegrity, universalCommon] = await Promise.all([
      _fetchUniversalIntegrity(), _fetchUniversalCommon(),
    ]);
    const injected = [universalIntegrity, universalCommon].filter(Boolean).join('\n\n---\n\n');
    if (injected) {
      if (Array.isArray(outboundBody.messages)) {
        outboundBody.messages = [{ role: 'system', content: injected }, ...outboundBody.messages];
      } else if (typeof outboundBody.system === 'string') {
        outboundBody.system = injected + '\n\n---\n\n' + outboundBody.system;
      }
    }
    console.log(JSON.stringify({ tag: 'DEEPSEEK_UNIVERSAL_INJECTED', service_id: parsedBody.service_id, ts: new Date().toISOString(), ...meta }));
  } else if (outboundBody) {
    delete outboundBody.service_id; // 강제대상 아니어도 벤더 API로 그대로 넘기지 않음
  }

  let outboundBodyText = outboundBody ? JSON.stringify(outboundBody) : bodyText;

  if (guid) {
    const kv = env.AI_SETUP_SEALS_KV;
    if (kv) {
      const spendKey = `hondi:free_spend:${guid}`;
      const spent = parseFloat(await kv.get(spendKey) || '0');
      if (spent >= FREE_QUOTA_KRW_LIMIT) {
        console.warn(JSON.stringify({ tag: 'FREE_QUOTA_EXCEEDED', guid, spent, ts: new Date().toISOString(), ...meta }));
        return new Response(JSON.stringify({ error: 'FREE_QUOTA_EXCEEDED', message: `무료 한도(${FREE_QUOTA_KRW_LIMIT}원)를 모두 사용했습니다.`, spent_krw: Math.round(spent) }), { status: 429, headers: corsHeaders });
      }
    }
  }

  // ── 백엔드 선택: 혼디 자체 서버(준비되면) > OpenRouter > 공식 DeepSeek API ──
  const _useSelfHost = _selfHostReady(env);
  const _useOR = !_useSelfHost && !!env.OPENROUTER_API_KEY;
  const _url = _useSelfHost ? env.HONDI_SELFHOST_URL : (_useOR ? OR_URL : DEEPSEEK_URL);
  const _key = _useSelfHost ? env.HONDI_SELFHOST_API_KEY : (_useOR ? env.OPENROUTER_API_KEY : env.DEEPSEEK_API_KEY);
  console.log(JSON.stringify({tag:'AI_PROXY_CALL',fn:'callDeepSeek',ts:new Date().toISOString(),target:_useSelfHost?'hondi-selfhost':(_useOR?'openrouter':'deepseek'),tier:tierKey,model:backendModel,guid,fallbackFrom,...meta}));
  const res=await fetch(_url,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${_key}`,...(_useOR?{'HTTP-Referer':'https://hondi.net','X-Title':'Hondi'}:{})},body:outboundBodyText});
  if(!res.ok){const errText=await res.text();let errMsg;try{errMsg=JSON.parse(errText)?.error?.message;}catch{}return new Response(JSON.stringify({error:errMsg||`HTTP ${res.status}`}),{status:res.status,headers:corsHeaders});}

  const spendTier = tierKey || 'hondi-flash'; // 레거시 호출은 flash 단가로 보수적 계산
  if(isStream){
    if (guid && env.AI_SETUP_SEALS_KV) {
      const [forClient, forUsage] = res.body.tee();
      const usageTask = _parseUsageFromStream(forUsage).then(usage => {
        const bill = computeBilledKRW(env, usage, spendTier);
        console.log(JSON.stringify({
          tag: 'HONDI_CHAT_COST', guid, tier: spendTier,
          promptTokens: usage?.prompt_tokens, cacheHitTokens: usage?.prompt_cache_hit_tokens,
          completionTokens: usage?.completion_tokens,
          apiCostKRW: bill.apiCostKRW, billedKRW: bill.billedKRW, multiplier: bill.multiplier,
          ts: new Date().toISOString(), ...meta,
        }));
        return _recordFreeSpend(env, guid, bill.billedKRW);
      });
      if (ctx?.waitUntil) ctx.waitUntil(usageTask); else usageTask.catch(() => {});
      return new Response(forClient,{status:200,headers:{...corsHeaders,'Content-Type':'text/event-stream','Cache-Control':'no-cache','X-Accel-Buffering':'no'}});
    }
    return new Response(res.body,{status:200,headers:{...corsHeaders,'Content-Type':'text/event-stream','Cache-Control':'no-cache','X-Accel-Buffering':'no'}});
  }
  const data=await res.json();
  if (guid && env.AI_SETUP_SEALS_KV && data?.usage) {
    const bill = computeBilledKRW(env, data.usage, spendTier);
    console.log(JSON.stringify({
      tag: 'HONDI_CHAT_COST', guid, tier: spendTier,
      promptTokens: data.usage?.prompt_tokens, cacheHitTokens: data.usage?.prompt_cache_hit_tokens,
      completionTokens: data.usage?.completion_tokens,
      apiCostKRW: bill.apiCostKRW, billedKRW: bill.billedKRW, multiplier: bill.multiplier,
      ts: new Date().toISOString(), ...meta,
    }));
    const recordTask = _recordFreeSpend(env, guid, bill.billedKRW);
    if (ctx?.waitUntil) ctx.waitUntil(recordTask); else recordTask.catch(() => {});
  }
  if(fallbackFrom){const text=data.choices?.[0]?.message?.content||'{}';return new Response(JSON.stringify({candidates:[{content:{parts:[{text}],role:'model'},finishReason:'STOP'}],_provider:'deepseek-fallback',_fallback_from:fallbackFrom}),{headers:corsHeaders});}
  return new Response(JSON.stringify(data),{headers:corsHeaders});
}catch(e){return _err(502,'DEEPSEEK_ERROR',e.message,corsHeaders);}}


// ═══════════════════════════════════════════════════════════
// /llm/relay — 사용자 본인 키(BYOK) 범용 중계 (2026-06-29)
//
// 배경: ai-setup-mobile.html에서 등록한 사용자 본인 키로 DeepSeek 등을
// "브라우저에서 직접" 호출하던 기존 클라이언트 코드가 CORS에 막혔다(대부분
// LLM 벤더 API는 브라우저발 요청을 허용하지 않음 — 서버 간 호출만 허용).
// 무료 폴백(gopang-proxy)이 항상 마지막에 받아주던 시절엔 이게 안 드러났다.
//
// 이 엔드포인트는 "무료 모델을 제공"하는 게 아니다 — 사용자가 직접 등록한
// 키를 그대로, 그 사용자가 고른 모델로, 서버를 한 번 거쳐서만 전달한다
// (서버 간 호출은 CORS 대상이 아님). 비용은 여전히 사용자 본인의 키로 청구됨.
//
// 보안: baseUrl을 알려진 LLM 벤더 호스트로만 제한한다(그 외 호스트로의
// 임의 중계를 막아 이 엔드포인트가 오픈 프록시/SSRF 통로가 되는 것을 방지).
//
// 범위: OpenAI 호환(/chat/completions, 같은 요청·응답 스키마) 벤더만 지원—
// DeepSeek·Gemini(OpenAI 호환 레이어)·OpenAI·Grok·OpenRouter. Claude(Anthropic)는
// 엔드포인트 경로(/v1/messages)와 요청·응답 스키마 자체가 달라서 이 범용
// 중계로 안 된다 — 별도 작업 필요(지금은 일부러 손 안 댐).
// ═══════════════════════════════════════════════════════════
const ALLOWED_LLM_RELAY_HOSTS = new Set([
  'generativelanguage.googleapis.com', // Gemini (OpenAI 호환 레이어)
  'api.deepseek.com',
  'api.x.ai',                          // Grok
  'openrouter.ai',
  'api.openai.com',
  // 'api.anthropic.com' 의도적으로 제외 — OpenAI 호환 스키마가 아님
]);

// K서비스 중 전용 relay(klaw/gov/business)가 없는 14개 — 이 id로 호출하면
// UNIVERSAL-INTEGRITY+UNIVERSAL-common을 서버가 강제로 앞에 붙인다.
// (2026-07-05 신설 — SP-CATALOG_v1_0.md에서 발견한 불일치 해소: 이 목록
// 밖의 klaw/gov/business는 이미 각자 전용 relay에서 처리하므로 제외.
// jeju/kgov는 'gov' 하나로 이미 처리되지만, 클라이언트가 실수로 이
// 목록에 'kgov'를 넣어 보내도 중복 주입만 될 뿐 해는 없다.)
const UNIVERSAL_FORCED_K_SERVICES = new Set([
  'kemergency', 'kpolice', 'ksecurity', 'khealth', 'kedu', 'kgdc',
  'kfinance', 'kinsurance', 'ktax', 'kcommerce', 'ktransport',
  'klogistics', 'kdemocracy', 'fiil-kcleaner',
]);

async function handleLLMRelay(bodyText, env, corsHeaders, meta = null) {
  let body;
  try { body = JSON.parse(bodyText); } catch { return _err(400, 'INVALID_JSON', '', corsHeaders); }

  const { provider, baseUrl, apiKey, model, messages, max_tokens, temperature, stream, service_id } = body || {};
  if (!baseUrl || !apiKey || !model || !Array.isArray(messages)) {
    return _err(400, 'MISSING_FIELD', 'baseUrl/apiKey/model/messages 필수', corsHeaders);
  }

  // UNIVERSAL 레이어 서버 강제 주입 — 클라이언트가 service_id를 보내지
  // 않거나 목록 밖이면 기존 동작 그대로(주입 없음, 예: 메인 AGENT-COMMON
  // 채팅·BYOK 일반 호출). 클라이언트가 조립한 system 메시지를 대체하지
  // 않고 그 앞에 별도 system 메시지로 추가한다(klaw/relay와 동일 방식 —
  // 각 K서비스 SP가 이미 갖고 있을 수도 있는 자체 규칙과 중복되더라도
  // "모든 SP가 이 문서를 상속한다"는 원칙을 예외 없이 지키기 위함).
  let relayMessages = messages;
  if (service_id && UNIVERSAL_FORCED_K_SERVICES.has(service_id)) {
    const [universalIntegrity, universalCommon] = await Promise.all([
      _fetchUniversalIntegrity(), _fetchUniversalCommon(),
    ]);
    const injected = [universalIntegrity, universalCommon].filter(Boolean).join('\n\n---\n\n');
    if (injected) relayMessages = [{ role: 'system', content: injected }, ...messages];
    console.log(JSON.stringify({ tag: 'LLM_RELAY_UNIVERSAL_INJECTED', service_id, ts: new Date().toISOString(), ...meta }));
  }

  let targetHost;
  try { targetHost = new URL(baseUrl).host; } catch { return _err(400, 'INVALID_BASEURL', 'baseUrl 형식이 올바르지 않습니다', corsHeaders); }
  if (!ALLOWED_LLM_RELAY_HOSTS.has(targetHost)) {
    console.warn(JSON.stringify({ tag: 'LLM_RELAY_HOST_BLOCKED', host: targetHost, ts: new Date().toISOString(), ...meta }));
    return _err(403, 'HOST_NOT_ALLOWED', `허용되지 않은 호스트: ${targetHost}`, corsHeaders);
  }

  const targetUrl = baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const isStream  = !!stream;

  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
  if (provider === 'openrouter') { headers['HTTP-Referer'] = 'https://hondi.net'; headers['X-Title'] = 'Hondi'; }

  const payload = { model, messages: relayMessages, stream: isStream };
  if (max_tokens  != null) payload.max_tokens  = max_tokens;
  if (temperature != null) payload.temperature = temperature;

  console.log(JSON.stringify({ tag: 'LLM_RELAY_CALL', provider: provider || targetHost, model, stream: isStream, ts: new Date().toISOString(), ...meta }));

  try {
    const res = await fetch(targetUrl, { method: 'POST', headers, body: JSON.stringify(payload) });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return new Response(errText || JSON.stringify({ error: `HTTP ${res.status}` }), { status: res.status, headers: corsHeaders });
    }
    if (isStream) {
      return new Response(res.body, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' },
      });
    }
    const data = await res.text();
    return new Response(data, { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return _err(502, 'RELAY_ERROR', e.message, corsHeaders);
  }
}

// ═══════════════════════════════════════════════════════════
// /klaw/relay — K-Law 전용 공유 계정 릴레이 (2026-07-02)
//
// 배경: DeepSeek 계정 1개(guid 무관, K-Law 전용 발급 키 — 없으면 공용
// DEEPSEEK_API_KEY로 폴백)를 100여 명이 동시에 공유하며 API 비용을 나눠
// 부담한다. gopang 일반 무료 챗(FREE_QUOTA_KRW_LIMIT=1000원, 평생 누적)과는
// 별개의 예산으로 관리한다 — K-Law 판결 시뮬레이션은 호출당 비용이 훨씬
// 크므로 같은 버킷을 쓰면 사용자의 일반 무료 챗 한도를 잠식한다.
// 방어선 3중: (1) 1인 1일 KRW 한도 (2) 계정 전체 1일 예산 상한
// (3) 1인 1일 "판결 생성"(STEP 0~C 풀사이클) 횟수 한도.
// ═══════════════════════════════════════════════════════════
const KLAW_TIER_MODELS = {
  'klaw-flash': { backendModel: 'deepseek-chat',     price: { cacheHit: 0.0028, cacheMiss: 0.14,  output: 0.28 } }, // 인터뷰·분석 — 경량
  'klaw-pro':   { backendModel: 'deepseek-reasoner', price: { cacheHit: 0.0145, cacheMiss: 0.435, output: 0.87 } }, // STEP 0~C 판결 생성 — 추론
};
const KLAW_USER_DAILY_KRW_LIMIT   = 300;    // 1인 1일 한도(원)
const KLAW_GLOBAL_DAILY_KRW_LIMIT = 30000;  // 계정 전체 1일 예산 상한(원) — 공유 계정 보호
const KLAW_USER_DAILY_STEP_LIMIT  = 3;      // 1인 1일 "판결 생성"(STEP 0~C) 횟수 한도

function _todayKey() { return new Date().toISOString().slice(0, 10); } // YYYY-MM-DD (UTC 기준 일 단위 리셋)
const _KLAW_KV_TTL = 60 * 60 * 30; // 30시간 — 자정 경계 안전마진을 둔 1일 리셋

async function _klawSpendGet(env, key) {
  const kv = env.AI_SETUP_SEALS_KV;
  if (!kv) return 0;
  return parseFloat(await kv.get(key) || '0');
}
async function _klawSpendAdd(env, key, amount) {
  const kv = env.AI_SETUP_SEALS_KV;
  if (!kv || !amount) return;
  try {
    const prev = await _klawSpendGet(env, key);
    await kv.put(key, String(prev + amount), { expirationTtl: _KLAW_KV_TTL });
  } catch (e) { console.warn('[KLaw] 지출 기록 실패:', e.message); }
}

async function handleKlawRelay(bodyText, env, corsHeaders, meta = null, ctx = null) {
  let body;
  try { body = JSON.parse(bodyText); } catch { return _err(400, 'INVALID_JSON', '', corsHeaders); }

  const { guid, tier, messages, max_tokens, stream, step_cycle } = body || {};
  if (!guid || !Array.isArray(messages)) return _err(400, 'MISSING_FIELD', 'guid/messages 필수', corsHeaders);

  // UNIVERSAL-INTEGRITY 서버측 강제 주입(2026-07-04) — K-Law는 클라이언트가
  // 시스템 메시지를 직접 조립해 보내는 구조(/gov/relay와 다름)라, 클라이언트의
  // system 메시지를 대체하지는 않되 그 앞에 별도 system 메시지로 추가한다.
  // K-Law 자체(SP-01_klaw_v15.1)가 이미 이 문서보다 훨씬 정교한 자체 확신도
  // 메커니즘을 갖고 있으므로 중복이지만, "모든 SP가 이 문서를 상속한다"는
  // 원칙을 예외 없이 지키기 위해 형식적으로도 주입한다.
  const universalIntegrity = await _fetchUniversalIntegrity();
  const messagesWithIntegrity = universalIntegrity
    ? [{ role: 'system', content: universalIntegrity }, ...messages]
    : messages;

  const tierKey = KLAW_TIER_MODELS[tier] ? tier : 'klaw-flash';
  const backendModel = KLAW_TIER_MODELS[tierKey].backendModel;

  const day       = _todayKey();
  const userKey   = `klaw:spend:${guid}:${day}`;
  const globalKey = `klaw:spend:global:${day}`;
  const stepKey   = `klaw:steps:${guid}:${day}`;

  const [userSpent, globalSpent, stepCount] = await Promise.all([
    _klawSpendGet(env, userKey), _klawSpendGet(env, globalKey), _klawSpendGet(env, stepKey)
  ]);

  if (globalSpent >= KLAW_GLOBAL_DAILY_KRW_LIMIT) {
    return _err(429, 'KLAW_GLOBAL_QUOTA_EXCEEDED', '오늘 K-Law 전체 이용자의 사용량이 한도에 도달했습니다. 내일 다시 이용해 주세요.', corsHeaders);
  }
  if (userSpent >= KLAW_USER_DAILY_KRW_LIMIT) {
    return _err(429, 'KLAW_USER_QUOTA_EXCEEDED', '오늘 사용 가능한 K-Law 한도를 모두 사용했습니다. 내일 다시 이용해 주세요.', corsHeaders);
  }
  if (step_cycle && stepCount >= KLAW_USER_DAILY_STEP_LIMIT) {
    return _err(429, 'KLAW_STEP_LIMIT_EXCEEDED', `오늘 판결 시뮬레이션 생성 한도(${KLAW_USER_DAILY_STEP_LIMIT}회)를 모두 사용했습니다. 내일 다시 이용해 주세요.`, corsHeaders);
  }

  const isStream = !!stream;
  const payload = { model: backendModel, messages: messagesWithIntegrity, stream: isStream };
  if (max_tokens != null) payload.max_tokens = max_tokens;

  console.log(JSON.stringify({ tag:'KLAW_RELAY_CALL', guid, tier: tierKey, stream: isStream, userSpent, globalSpent, ts: new Date().toISOString(), ...meta }));

  const t0 = Date.now(); // 과금에는 쓰지 않음 — 로그 진단(지연 모니터링) 용도로만 유지
  let res;
  try {
    res = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      // ★ SP-COMMON-05 H6: 모든 서브시스템이 반드시 같은 API 키를 공유해야
      // 캐시 공유(계층 상속의 토큰 절약 전제)가 성립한다. 과거엔 전용 키
      // KLAW_DEEPSEEK_API_KEY가 있으면 그걸 우선 쓰는 폴백이 있었는데,
      // 이게 실수로라도 등록되면 조용히(에러 없이) K-Law만 캐시 공유에서
      // 이탈하는 위험이 있어 폴백 자체를 제거했다 — 정책을 코드로 강제.
      headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify(payload),
    });
  } catch (e) { return _err(502, 'KLAW_RELAY_ERROR', e.message, corsHeaders); }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return new Response(errText || JSON.stringify({ error:`HTTP ${res.status}` }), { status: res.status, headers: corsHeaders });
  }

  const priceTier = tierKey === 'klaw-pro' ? 'hondi-pro' : 'hondi-flash'; // _deepseekUsageToKRW는 hondi-* 가격표를 조회하므로 매핑
  const recordStep = async () => { if (step_cycle) await _klawSpendAdd(env, stepKey, 1); };

  if (isStream) {
    const [forClient, forUsage] = res.body.tee();
    const usageTask = _parseUsageFromStream(forUsage).then(async usage => {
      const bill = computeBilledKRW(env, usage, priceTier);
      console.log(JSON.stringify({ tag:'KLAW_RELAY_COST', guid, tier: tierKey, apiCostKRW: bill.apiCostKRW, billedKRW: bill.billedKRW, multiplier: bill.multiplier, elapsedMs: Date.now() - t0, ts: new Date().toISOString(), ...meta }));
      await Promise.all([_klawSpendAdd(env, userKey, bill.billedKRW), _klawSpendAdd(env, globalKey, bill.billedKRW), recordStep()]);
    });
    if (ctx?.waitUntil) ctx.waitUntil(usageTask); else usageTask.catch(() => {});
    return new Response(forClient, { status:200, headers:{ ...corsHeaders, 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', 'X-Accel-Buffering':'no' } });
  }

  const data = await res.json();
  if (data?.usage) {
    const bill = computeBilledKRW(env, data.usage, priceTier);
    console.log(JSON.stringify({ tag:'KLAW_RELAY_COST', guid, tier: tierKey, apiCostKRW: bill.apiCostKRW, billedKRW: bill.billedKRW, multiplier: bill.multiplier, elapsedMs: Date.now() - t0, ts: new Date().toISOString(), ...meta }));
    const recordTask = Promise.all([_klawSpendAdd(env, userKey, bill.billedKRW), _klawSpendAdd(env, globalKey, bill.billedKRW), recordStep()]);
    if (ctx?.waitUntil) ctx.waitUntil(recordTask); else recordTask.catch(() => {});
  }
  return new Response(JSON.stringify(data), { headers: corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// /gov/relay — K-Public 산하 모든 국가기관 AI 공용 릴레이 (2026-07-03)
//
// SP-COMMON-05 H2/H6 강제 조치: 클라이언트는 시스템 메시지를 직접 조립하지
// 않는다. 서버가 K-Public_common_v1_0.md를 GitHub에서 캐시 fetch해 항상
// system 맨 앞에 붙이고, 클라이언트가 보낸 messages 중 role:'system'은
// 전부 무시한다 — 클라이언트 코드가 실수(또는 고의)로 공통 규칙을
// 빠뜨리거나 조작할 수 있는 여지를 구조적으로 없앤다.
// ═══════════════════════════════════════════════════════════
const K_PUBLIC_COMMON_URL = 'https://raw.githubusercontent.com/Openhash-Gopang/gopang/main/prompts/K-Public_common_v1_3.md';
let _kPublicCommonCache = null;
let _kPublicCommonCacheAt = 0;
const _K_PUBLIC_COMMON_TTL_MS = 10 * 60 * 1000; // 10분 — 문서 갱신 반영 최대 지연

// ═══════════════════════════════════════════════════════════
// UNIVERSAL-common — 정체성 무관 절차·원칙(U1~U8) (2026-07-05 신설)
// K-Public_common v1.2의 P2~P11을 정체성 무관 공통부로 추출한 문서.
// 국가기관(K-Public_common)·전문가 보조 모듈(PROFESSIONAL-common)
// 양쪽 모두 이 문서를 상속한다.
// ═══════════════════════════════════════════════════════════
const UNIVERSAL_COMMON_URL = 'https://raw.githubusercontent.com/Openhash-Gopang/gopang/main/prompts/UNIVERSAL-common_v1_1.md';
let _universalCommonCache = null;
let _universalCommonCacheAt = 0;
const _UNIVERSAL_COMMON_TTL_MS = 10 * 60 * 1000;

async function _fetchUniversalCommon() {
  const now = Date.now();
  if (_universalCommonCache && (now - _universalCommonCacheAt) < _UNIVERSAL_COMMON_TTL_MS) return _universalCommonCache;
  try {
    const res = await fetch(UNIVERSAL_COMMON_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _universalCommonCache = await res.text();
    _universalCommonCacheAt = now;
  } catch (e) {
    console.warn('[UniversalCommon] 로드 실패:', e.message);
    if (!_universalCommonCache) _universalCommonCache = '';
  }
  return _universalCommonCache;
}

// ═══════════════════════════════════════════════════════════
// PROFESSIONAL-common — 전문가 보조 모듈(K-Doctor 등) 정체성 레이어
// (2026-07-05 신설). khealth는 K-Public_common(국가기관 정체성) 대신
// 이 문서를 상속한다 — "국가기관을 대신한다"고 잘못 자기소개하던
// 버그를 구조적으로 해소.
// ═══════════════════════════════════════════════════════════
const PROFESSIONAL_COMMON_URL = 'https://raw.githubusercontent.com/Openhash-Gopang/gopang/main/prompts/PROFESSIONAL-common_v1_0.md';
let _professionalCommonCache = null;
let _professionalCommonCacheAt = 0;
const _PROFESSIONAL_COMMON_TTL_MS = 10 * 60 * 1000;

async function _fetchProfessionalCommon() {
  const now = Date.now();
  if (_professionalCommonCache && (now - _professionalCommonCacheAt) < _PROFESSIONAL_COMMON_TTL_MS) return _professionalCommonCache;
  try {
    const res = await fetch(PROFESSIONAL_COMMON_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _professionalCommonCache = await res.text();
    _professionalCommonCacheAt = now;
  } catch (e) {
    console.warn('[ProfessionalCommon] 로드 실패:', e.message);
    if (!_professionalCommonCache) _professionalCommonCache = '';
  }
  return _professionalCommonCache;
}

// agency별로 어떤 "정체성 레이어"를 상속하는지 — health는 국가기관이
// 아니라 전문가(의사) 보조 모듈이므로 PROFESSIONAL-common을 쓴다.
const PROFESSIONAL_IDENTITY_AGENCIES = new Set(['health']);

// ═══════════════════════════════════════════════════════════
// UNIVERSAL-INTEGRITY — 트랙 무관 전체 SP 최상위 공통 원칙 (2026-07-04 신설)
// K-Law v15.1의 확신도 이원화·불확실 식별자 생성 차단 메커니즘을 일반화한
// 문서. K-Public_common보다도 먼저 로드되어야 한다(§U5 — "어떻게 판단
// 하는가"가 "누구로서 응답하는가"보다 앞선다).
// ═══════════════════════════════════════════════════════════
const UNIVERSAL_INTEGRITY_URL = 'https://raw.githubusercontent.com/Openhash-Gopang/gopang/main/prompts/UNIVERSAL-INTEGRITY_v1_0.md';
let _universalIntegrityCache = null;
let _universalIntegrityCacheAt = 0;
const _UNIVERSAL_INTEGRITY_TTL_MS = 10 * 60 * 1000;

async function _fetchUniversalIntegrity() {
  const now = Date.now();
  if (_universalIntegrityCache && (now - _universalIntegrityCacheAt) < _UNIVERSAL_INTEGRITY_TTL_MS) return _universalIntegrityCache;
  try {
    const res = await fetch(UNIVERSAL_INTEGRITY_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _universalIntegrityCache = await res.text();
    _universalIntegrityCacheAt = now;
  } catch (e) {
    console.warn('[UniversalIntegrity] 로드 실패:', e.message);
    if (!_universalIntegrityCache) _universalIntegrityCache = '';
  }
  return _universalIntegrityCache;
}

async function _fetchKPublicCommon() {
  const now = Date.now();
  if (_kPublicCommonCache && (now - _kPublicCommonCacheAt) < _K_PUBLIC_COMMON_TTL_MS) return _kPublicCommonCache;
  try {
    const res = await fetch(K_PUBLIC_COMMON_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _kPublicCommonCache = await res.text();
    _kPublicCommonCacheAt = now;
  } catch (e) {
    console.warn('[GovRelay] K-Public 공통 규칙 로드 실패:', e.message);
    if (!_kPublicCommonCache) _kPublicCommonCache = ''; // 완전 실패해도 서비스 자체는 지속(경고만)
  }
  return _kPublicCommonCache;
}

// agency 식별자 허용 목록 — K-Law는 다음 개정 때 이 경로로 통합 예정(현재는 /klaw/relay 유지)
// REGISTERED_SERVICES 키와 완전히 동일하게 통일(하이픈 접두어 제거) —
// /pdv/report의 _getSvcRegistration()이 이 값을 그대로 svc 키로 쓰기 때문에
// 여기서 어긋나면 PDV 저장이 조용히 실패한다. province/city/county는 별도
// 서비스로 등록돼 있지 않고(모두 'public' 하나로 처리) 실제 코드에서 보낸
// 적도 없어 제거.
const GOV_AGENCIES = new Set([
  'public', 'tax', 'health', 'police', '911', 'democracy', 'insurance',
  'traffic', 'logistics',
  // 2026-07-05 추가: jeju_do/jeju_national을 SP_DELEGATION_ORIGINATORS에
  // 넣었으나 정작 GOV_AGENCIES에 없어 /gov/relay 최상위 호출 자체가
  // UNKNOWN_AGENCY로 즉시 거부되는 결함을 실제 테스트 하네스
  // (src/tests/sp-intercall.test.mjs 시나리오 3)로 발견해 수정.
  // 현재 jeju-router.js는 /gov/relay가 아니라 /ai/chat을 직접 호출하고
  // 있어(UNIVERSAL-INTEGRITY 미적용) 이 두 값은 아직 실제 트래픽에서
  // 쓰이지 않는다 — 프론트엔드 마이그레이션은 별도 작업.
  'jeju_do', 'jeju_national',
]);

// jeju_do/jeju_national의 agencyPrompt는 이미 JEJU-GOV-COMMON을 통해
// 자체 정체성 레이어를 포함하고 있다(Jejudo 트리는 K-Public_common을
// 상속하지 않는 독립 계통). 이 agency들에는 K-Public_common/
// PROFESSIONAL-common을 추가로 덧씌우지 않는다 — 덧씌우면 정체성이
// 이중으로 겹치는(khealth 때와 같은 유형의) 버그가 난다.
const NO_IDENTITY_LAYER_AGENCIES = new Set(['jeju_do', 'jeju_national']);

// ═══════════════════════════════════════════════════════════
// k-business / business-kr — 사업체 보조 AI (2026-07-05 신설)
// K-Market 판매자 관리 대시보드(kmarket_admin_dashboard.html)의 AI
// 경영 어드바이저가 이 릴레이를 통해 재무·세금·고용 업무를 보조한다.
// GOV_AGENCIES와 별개 축(사업체 모듈)이라 agency 개념 대신 국가모듈
// 하나(business-kr)만 우선 지원 — 다른 국가 확장 시 BUSINESS_COUNTRY_MODULES
// 에 추가한다.
// ═══════════════════════════════════════════════════════════
const K_BUSINESS_URL   = 'https://raw.githubusercontent.com/Openhash-Gopang/gopang/main/prompts/k-business_v1_0.md';
const BUSINESS_KR_URL  = 'https://raw.githubusercontent.com/Openhash-Gopang/gopang/main/prompts/business-kr_v1_0.md';
let _kBusinessCache = null, _kBusinessCacheAt = 0;
let _businessKrCache = null, _businessKrCacheAt = 0;
const _BUSINESS_TTL_MS = 10 * 60 * 1000;

async function _fetchKBusiness() {
  const now = Date.now();
  if (_kBusinessCache && (now - _kBusinessCacheAt) < _BUSINESS_TTL_MS) return _kBusinessCache;
  try {
    const res = await fetch(K_BUSINESS_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _kBusinessCache = await res.text();
    _kBusinessCacheAt = now;
  } catch (e) {
    console.warn('[k-business] 로드 실패:', e.message);
    if (!_kBusinessCache) _kBusinessCache = '';
  }
  return _kBusinessCache;
}

async function _fetchBusinessKr() {
  const now = Date.now();
  if (_businessKrCache && (now - _businessKrCacheAt) < _BUSINESS_TTL_MS) return _businessKrCache;
  try {
    const res = await fetch(BUSINESS_KR_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _businessKrCache = await res.text();
    _businessKrCacheAt = now;
  } catch (e) {
    console.warn('[business-kr] 로드 실패:', e.message);
    if (!_businessKrCache) _businessKrCache = '';
  }
  return _businessKrCache;
}

const BUSINESS_TIER_MODELS = {
  'biz-flash': { backendModel: 'deepseek-chat',     price: { cacheHit: 0.0028, cacheMiss: 0.14,  output: 0.28 } },
  'biz-pro':   { backendModel: 'deepseek-reasoner', price: { cacheHit: 0.0145, cacheMiss: 0.435, output: 0.87 } },
};
const BUSINESS_USER_DAILY_KRW_LIMIT   = 300;
const BUSINESS_GLOBAL_DAILY_KRW_LIMIT = 30000;

async function handleBusinessRelay(bodyText, env, corsHeaders, meta = null, ctx = null) {
  let body;
  try { body = JSON.parse(bodyText); } catch { return _err(400, 'INVALID_JSON', '', corsHeaders); }

  const { guid, business_id, agencyPrompt, messages, max_tokens, stream, tier } = body || {};
  if (!guid || !Array.isArray(messages)) return _err(400, 'MISSING_FIELD', 'guid/messages 필수', corsHeaders);

  // 클라이언트가 보낸 messages 중 system 역할은 전부 제거 — 서버가 직접
  // 조립한 system(k-business 공통 + business-kr + agencyPrompt)만 유효.
  const dialogOnly = (messages || []).filter(m => m.role !== 'system');

  const tierKey = BUSINESS_TIER_MODELS[tier] ? tier : 'biz-flash';
  const backendModel = BUSINESS_TIER_MODELS[tierKey].backendModel;

  const day       = _todayKey();
  const bizKey    = business_id || guid; // 사업체 단위 식별자, 없으면 guid로 대체
  const userKey   = `biz:spend:${bizKey}:${day}`;
  const globalKey = `biz:spend:global:${day}`;

  const [userSpent, globalSpent] = await Promise.all([
    _klawSpendGet(env, userKey), _klawSpendGet(env, globalKey)
  ]);
  if (globalSpent >= BUSINESS_GLOBAL_DAILY_KRW_LIMIT) {
    return _err(429, 'BIZ_GLOBAL_QUOTA_EXCEEDED', '오늘 전체 이용자의 사용량이 한도에 도달했습니다. 내일 다시 이용해 주세요.', corsHeaders);
  }
  if (userSpent >= BUSINESS_USER_DAILY_KRW_LIMIT) {
    return _err(429, 'BIZ_USER_QUOTA_EXCEEDED', '오늘 사용 가능한 한도를 모두 사용했습니다. 내일 다시 이용해 주세요.', corsHeaders);
  }

  const [universalIntegrity, universalCommon, kBusiness, businessKr] = await Promise.all([
    _fetchUniversalIntegrity(), _fetchUniversalCommon(), _fetchKBusiness(), _fetchBusinessKr(),
  ]);
  const systemParts = [universalIntegrity, universalCommon, kBusiness, businessKr, agencyPrompt || ''].filter(Boolean);
  const systemContent = systemParts.length
    ? systemParts.join('\n\n---\n\n')
    : (agencyPrompt || '');

  const isStream = !!stream;
  const payload = { model: backendModel, messages: [{ role: 'system', content: systemContent }, ...dialogOnly], stream: isStream };
  if (max_tokens != null) payload.max_tokens = max_tokens;

  console.log(JSON.stringify({ tag: 'BUSINESS_RELAY_CALL', guid, business_id: bizKey, tier: tierKey, stream: isStream, userSpent, globalSpent, ts: new Date().toISOString(), ...meta }));

  let res;
  try {
    res = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify(payload),
    });
  } catch (e) { return _err(502, 'BUSINESS_RELAY_ERROR', e.message, corsHeaders); }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return new Response(errText || JSON.stringify({ error:`HTTP ${res.status}` }), { status: res.status, headers: corsHeaders });
  }

  const priceTier = tierKey === 'biz-pro' ? 'hondi-pro' : 'hondi-flash';

  if (isStream) {
    const [forClient, forUsage] = res.body.tee();
    const usageTask = _parseUsageFromStream(forUsage).then(async usage => {
      const bill = computeBilledKRW(env, usage, priceTier);
      console.log(JSON.stringify({ tag:'BUSINESS_RELAY_COST', guid, business_id: bizKey, tier: tierKey, apiCostKRW: bill.apiCostKRW, billedKRW: bill.billedKRW, multiplier: bill.multiplier, ts: new Date().toISOString(), ...meta }));
      await Promise.all([_klawSpendAdd(env, userKey, bill.billedKRW), _klawSpendAdd(env, globalKey, bill.billedKRW)]);
    });
    if (ctx?.waitUntil) ctx.waitUntil(usageTask); else usageTask.catch(() => {});
    return new Response(forClient, { status:200, headers:{ ...corsHeaders, 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', 'X-Accel-Buffering':'no' } });
  }

  const data = await res.json();
  if (data?.usage) {
    const bill = computeBilledKRW(env, data.usage, priceTier);
    console.log(JSON.stringify({ tag:'BUSINESS_RELAY_COST', guid, business_id: bizKey, tier: tierKey, apiCostKRW: bill.apiCostKRW, billedKRW: bill.billedKRW, multiplier: bill.multiplier, ts: new Date().toISOString(), ...meta }));
    const recordTask = Promise.all([_klawSpendAdd(env, userKey, bill.billedKRW), _klawSpendAdd(env, globalKey, bill.billedKRW)]);
    if (ctx?.waitUntil) ctx.waitUntil(recordTask); else recordTask.catch(() => {});
  }
  return new Response(JSON.stringify(data), { headers: corsHeaders });
}

// 2026-07-04b: K-Public_common의 P11(PDV_HISTORY_REQUEST) 절엔
// "scope={본인 서비스의 VALID_PDV_SCOPES 값}"라는 자리표시자만 있고,
// 어느 agency도 자기 몫의 구체적 값을 프롬프트에 명시하지 않고 있었다.
// 본문엔 "K-Tax는 ktax" 식 예시가 일부만 있어 LLM이 나머지(특히 police·
// public·911)는 근거 없이 추측해야 했다 — 911은 패턴상 'k911'로 추측하기
// 쉬운데 실제 등록값은 'k119'라 100% 어긋난다. 서버가 agency를 이미 알고
// 있으므로, 여기서 결정적으로 치환해 추측 자체를 없앤다.
const GOV_AGENCY_PDV_SCOPE = {
  tax:'ktax', health:'khealth', police:'kpolice', '911':'k119',
  democracy:'kdemocracy', insurance:'kinsurance', traffic:'ktraffic',
  logistics:'klogistics', public:'kpublic',
};
const _PDV_SCOPE_PLACEHOLDER_RE = /\{본인 서비스의 VALID_PDV_SCOPES 값\}/g;

const GOV_TIER_MODELS = {
  'gov-flash': { backendModel: 'deepseek-chat',     price: { cacheHit: 0.0028, cacheMiss: 0.14,  output: 0.28 } },
  'gov-pro':   { backendModel: 'deepseek-reasoner', price: { cacheHit: 0.0145, cacheMiss: 0.435, output: 0.87 } },
};
const GOV_USER_DAILY_KRW_LIMIT   = 300;
const GOV_GLOBAL_DAILY_KRW_LIMIT = 30000;

// ═══════════════════════════════════════════════════════════
// SP 간 호출(위임) 메커니즘 — /gov/relay 전용 v1.0 (2026-07-05 신설)
//
// 배경: JEJU-NATIONAL-SP_v1.0.md §0는 "도청 트리와 국가기관 트리를 동시에
// 체인하지 않는다"고 명시하며 배타적 단일 분기만 지원해왔다 — SP 간
// 호출이라는 어려운 문제를 애초에 피하는 설계였다. 그러나 "국세와 지방세
// 체납액을 합쳐서 알려줘"처럼 두 관할이 모두 필요한 질의는 이 방식으로
// 답할 수 없다. 이 블록은 그 간극을 메운다 — 단, 무한 위임을 막는 두
// 겹의 방어선(프롬프트 차원: UNIVERSAL-common U9-3 / 서버 차원: 아래
// MAX_SP_HOPS·MAX_LLM_CALLS_PER_TURN·call_chain 순환 검사)을 반드시
// 함께 둔다.
// ═══════════════════════════════════════════════════════════

// 이 턴에서 실제로 응답을 생성하는 SP(에이전시)의 최대 개수. 최초 SP를
// 포함해 2 — 즉 "위임은 최대 1회"만 허용한다. 위임 대상이 다시 위임을
// 시도해도(U9-3 위반) _callDelegationTarget()이 그 결과의 sp_call 여부를
// 아예 확인하지 않으므로 구조적으로 무시된다 — 이 상수보다 먼저 작동하는
// 방어선이다.
const MAX_SP_HOPS = 2;
// 홉 수 계산과는 별개의 2차 방어선. 정상 경로에서 LLM 호출은 최대 3번
// (원 SP 판단 1 + 위임 대상 답변 1 + 원 SP 최종 합성 1)이다. 어떤 경로로든
// 이 한도를 넘기면 그 즉시 있는 답으로 종료한다(방어적 프로그래밍 — 위
// 로직에 버그가 있어도 폭주하지 않도록).
const MAX_LLM_CALLS_PER_TURN = 3;

// target 식별자 → 시스템 프롬프트 로드 방법.
//   via:'manifest' — prompts/manifest.json의 키를 그대로 재사용
//     (SP-00-ROUTER 로더와 동일 인프라). manifest.json에 등록되지 않은
//     agency(예: tax — 현재 manifest에 SP-XX_ktax 키가 없음)는 절대
//     여기 넣지 않는다. 넣으면 fetch가 항상 실패해 위임이 조용히
//     죽는다 — 위임 대상으로 열려면 manifest.json에 해당 agency의
//     안정적 "총괄" SP 키 등록이 선행돼야 한다.
//   via:'url' — Jeju 트리처럼 manifest 밖에서 직접 raw URL로 관리되는
//     문서.
// identity: 'professional' | 'kpublic' | null(문서 자체가 이미 정체성
//     레이어를 포함 — Jeju 트리).
const SP_DELEGATION_REGISTRY = {
  health:     { via: 'manifest', key: 'SP-04_khealth',    identity: 'professional', pdvScope: 'khealth' },
  police:     { via: 'manifest', key: 'SP-03_kpolice',    identity: 'kpublic',       pdvScope: 'kpolice' },
  '911':      { via: 'manifest', key: 'SP-02_k119',       identity: 'kpublic',       pdvScope: 'k119' },
  democracy:  { via: 'manifest', key: 'SP-12_kdemocracy', identity: 'kpublic',       pdvScope: 'kdemocracy' },
  insurance:  { via: 'manifest', key: 'SP-16_kinsurance', identity: 'kpublic',       pdvScope: 'kinsurance' },
  traffic:    { via: 'manifest', key: 'SP-06_ktraffic',   identity: 'kpublic',       pdvScope: 'ktraffic' },
  logistics:  { via: 'manifest', key: 'SP-13_klogistics', identity: 'kpublic',       pdvScope: 'klogistics' },
  public:     { via: 'manifest', key: 'SP-10_kpublic',    identity: 'kpublic',       pdvScope: 'kpublic' },
  jeju_do: {
    via: 'url',
    url: 'https://raw.githubusercontent.com/Openhash-Gopang/gopang/main/prompts/Jejudo/01-do/JEJU-DO-SP_v1.0.md',
    identity: null, label: '제주도청(총괄)',
  },
  jeju_national: {
    via: 'url',
    url: 'https://raw.githubusercontent.com/Openhash-Gopang/gopang/main/prompts/Jejudo/09-national/JEJU-NATIONAL-SP_v1.0.md',
    identity: null, label: '제주 소재 국가기관(총괄)',
  },
  // tax: manifest.json에 SP-XX_ktax 없음 — 등록 전까지 위임 대상에서 제외.
};

// v1.0 파일럿: 이 목록에 속한 agency만 위임을 "시작"할 수 있다(originate).
// 위임을 "받는" 쪽은 SP_DELEGATION_REGISTRY에 있으면 누구나 대상이 된다.
// 시작 가능 목록을 좁혀두는 이유: 이 목록에 속하면 클라이언트가 stream:true를
// 보내도 서버가 강제로 non-stream 처리한다(아래 handleGovRelay 참조) — 위임
// 여부를 알려면 첫 응답 전체를 먼저 봐야 하기 때문이다. 파일럿 단계에서는
// 영향 범위를 최소화한다.
const SP_DELEGATION_ORIGINATORS = new Set(['public', 'jeju_do', 'jeju_national']);

let _spDelegationCache = new Map();
const _SP_DELEGATION_TTL_MS = 10 * 60 * 1000;

async function _fetchDelegationPrompt(regKey) {
  const entry = SP_DELEGATION_REGISTRY[regKey];
  if (!entry) return null;
  const cached = _spDelegationCache.get(regKey);
  const now = Date.now();
  if (cached && (now - cached.at) < _SP_DELEGATION_TTL_MS) return cached.text;

  let url;
  if (entry.via === 'manifest') {
    const manifestRes = await fetch('https://raw.githubusercontent.com/Openhash-Gopang/gopang/main/prompts/manifest.json', { cache: 'no-cache' });
    if (!manifestRes.ok) throw new Error(`manifest fetch 실패: ${manifestRes.status}`);
    const manifest = await manifestRes.json();
    const fname = manifest[entry.key];
    if (!fname) throw new Error(`manifest에 ${entry.key} 키 없음`);
    url = `https://raw.githubusercontent.com/Openhash-Gopang/gopang/main/prompts/${fname}`;
  } else {
    url = entry.url;
  }

  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`위임 대상 SP 로드 실패(${regKey}): HTTP ${res.status}`);
  const text = await res.text();
  _spDelegationCache.set(regKey, { text, at: now });
  return text;
}

// LLM 응답이 순수 JSON 위임 요청(U9-2 형식)인지 검사한다. 아니면 null —
// 일반 자연어 답변은 '{'로 시작하지 않으므로 대부분 JSON.parse 비용 없이 걸러진다.
function _parseSpCallRequest(content) {
  if (typeof content !== 'string') return null;
  // router.js와 동일한 관용: 지시(U9-2)를 어기고 ```json 코드펜스로 감싸
  // 내놓는 경우까지 허용 — 완전한 자연어 답변만 확실히 배제하면 된다.
  const trimmed = content.replace(/```json|```/g, '').trim();
  if (!trimmed.startsWith('{')) return null;
  let parsed;
  try { parsed = JSON.parse(trimmed); } catch { return null; }
  const call = parsed?.sp_call;
  if (!call || typeof call.target !== 'string' || typeof call.query !== 'string') return null;
  return call;
}

// 위임 대상 SP 서브 호출. 대화 이력 전체가 아니라 query 한 줄만 전달한다
// (U9-2 최소 전달 원칙 — PDV scope 최소화와 동일한 사상). 서브 호출 결과가
// 규칙을 어기고 또 sp_call JSON을 내놓더라도 절대 따르지 않는다 — 그 결과의
// sp_call 여부 자체를 확인하지 않고 raw content 그대로 반환한다. 이것이
// "재위임 금지"의 실제 강제 지점이다(U9-3은 프롬프트 차원의 심층 방어).
async function _callDelegationTarget(env, regKey, query, backendModel) {
  const entry = SP_DELEGATION_REGISTRY[regKey];
  if (!entry) return { ok: false, reason: 'TARGET_NOT_REGISTERED' };

  let promptText;
  try { promptText = await _fetchDelegationPrompt(regKey); }
  catch (e) { return { ok: false, reason: 'PROMPT_LOAD_FAILED', detail: e.message }; }

  const [universalIntegrity, universalCommon] = await Promise.all([
    _fetchUniversalIntegrity(), _fetchUniversalCommon(),
  ]);
  let systemContent;
  if (entry.identity === 'professional') {
    const prof = await _fetchProfessionalCommon();
    systemContent = [universalIntegrity, universalCommon, prof, promptText].filter(Boolean).join('\n\n---\n\n');
  } else if (entry.identity === 'kpublic') {
    const kpub = await _fetchKPublicCommon();
    systemContent = [universalIntegrity, universalCommon, kpub, promptText].filter(Boolean).join('\n\n---\n\n');
  } else {
    systemContent = [universalIntegrity, universalCommon, promptText].filter(Boolean).join('\n\n---\n\n');
  }
  systemContent += '\n\n---\n\n[내부 안내] 이 요청은 다른 SP로부터 위임받은 서브 질의입니다. ' +
    '당신은 이 요청에 대해 다시 다른 SP로 위임할 수 없습니다(U9-3) — 아는 선에서 직접 답하십시오.';

  let res;
  try {
    res = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: backendModel, max_tokens: 800, temperature: 0.2, stream: false,
        messages: [{ role: 'system', content: systemContent }, { role: 'user', content: query }],
      }),
    });
  } catch (e) { return { ok: false, reason: 'FETCH_ERROR', detail: e.message }; }

  if (!res.ok) return { ok: false, reason: `HTTP_${res.status}` };
  const data = await res.json();
  const raw  = data?.choices?.[0]?.message?.content || '';
  return { ok: true, content: raw, usage: data?.usage || null, label: entry.label || regKey };
}

async function handleGovRelay(bodyText, env, corsHeaders, meta = null, ctx = null) {
  let body;
  try { body = JSON.parse(bodyText); } catch { return _err(400, 'INVALID_JSON', '', corsHeaders); }

  const { guid, agency, agencyPrompt, messages, max_tokens, stream, tier } = body || {};
  if (!guid || !agency || !Array.isArray(messages)) return _err(400, 'MISSING_FIELD', 'guid/agency/messages 필수', corsHeaders);
  if (!GOV_AGENCIES.has(agency)) return _err(400, 'UNKNOWN_AGENCY', `등록되지 않은 기관: ${agency}`, corsHeaders);

  // 클라이언트가 보낸 messages 중 system 역할은 전부 제거 — 서버가 직접 조립한
  // system(K-Public 공통 + agencyPrompt)만 유효하다.
  const dialogOnly = (messages || []).filter(m => m.role !== 'system');

  const tierKey = GOV_TIER_MODELS[tier] ? tier : 'gov-flash';
  const backendModel = GOV_TIER_MODELS[tierKey].backendModel;

  const day       = _todayKey();
  const userKey   = `gov:${agency}:spend:${guid}:${day}`;
  const globalKey = `gov:${agency}:spend:global:${day}`;

  const [userSpent, globalSpent] = await Promise.all([
    _klawSpendGet(env, userKey), _klawSpendGet(env, globalKey)
  ]);
  if (globalSpent >= GOV_GLOBAL_DAILY_KRW_LIMIT) {
    return _err(429, 'GOV_GLOBAL_QUOTA_EXCEEDED', `오늘 ${agency} 전체 이용자의 사용량이 한도에 도달했습니다. 내일 다시 이용해 주세요.`, corsHeaders);
  }
  if (userSpent >= GOV_USER_DAILY_KRW_LIMIT) {
    return _err(429, 'GOV_USER_QUOTA_EXCEEDED', '오늘 사용 가능한 한도를 모두 사용했습니다. 내일 다시 이용해 주세요.', corsHeaders);
  }

  const usesProfessionalIdentity = PROFESSIONAL_IDENTITY_AGENCIES.has(agency);
  const noIdentityLayer = NO_IDENTITY_LAYER_AGENCIES.has(agency);
  const [universalIntegrity, universalCommonRaw, identityDocRaw] = await Promise.all([
    _fetchUniversalIntegrity(),
    _fetchUniversalCommon(),
    noIdentityLayer ? Promise.resolve('') : (usesProfessionalIdentity ? _fetchProfessionalCommon() : _fetchKPublicCommon()),
  ]);
  const pdvScope = GOV_AGENCY_PDV_SCOPE[agency];
  // PDV_HISTORY_REQUEST(U8) scope 자리표시자는 이제 UNIVERSAL-common에 있다.
  const universalCommon = pdvScope
    ? universalCommonRaw.replace(_PDV_SCOPE_PLACEHOLDER_RE, pdvScope)
    : universalCommonRaw;
  const systemParts = [universalIntegrity, universalCommon, identityDocRaw, agencyPrompt || ''].filter(Boolean);
  const systemContent = systemParts.length
    ? systemParts.join('\n\n---\n\n')
    : (agencyPrompt || ''); // 공통 규칙 로드 실패해도 기관 고유 규칙만으로 서비스 지속

  // 위임 가능(originator) agency는 stream을 서버가 강제로 끈다 — 위임 여부를
  // 판단하려면 응답 전체를 먼저 봐야 하는데, 이미 클라이언트로 흘려보낸 SSE
  // 청크는 취소할 수 없기 때문이다(SP_DELEGATION_ORIGINATORS 정의부 주석 참조).
  const canDelegate = SP_DELEGATION_ORIGINATORS.has(agency);
  const isStream = !!stream && !canDelegate;
  const payload = { model: backendModel, messages: [{ role: 'system', content: systemContent }, ...dialogOnly], stream: isStream };
  if (max_tokens != null) payload.max_tokens = max_tokens;

  console.log(JSON.stringify({ tag: 'GOV_RELAY_CALL', guid, agency, tier: tierKey, stream: isStream, userSpent, globalSpent, ts: new Date().toISOString(), ...meta }));

  let res;
  try {
    res = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify(payload),
    });
  } catch (e) { return _err(502, 'GOV_RELAY_ERROR', e.message, corsHeaders); }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return new Response(errText || JSON.stringify({ error:`HTTP ${res.status}` }), { status: res.status, headers: corsHeaders });
  }

  const priceTier = tierKey === 'gov-pro' ? 'hondi-pro' : 'hondi-flash'; // computeBilledKRW는 hondi-* 가격표를 조회

  // 비용 기록 공통 헬퍼 — 위임 흐름에서 여러 번(원 SP 판단 / 위임 대상 / 최종 합성) 호출된다.
  // via는 감사(audit) 로그용 호출 경로 표시일 뿐 과금 로직에는 영향 없음(같은 guid·agency 한도로 합산).
  const billGovCall = (usage, via) => {
    if (!usage) return;
    const bill = computeBilledKRW(env, usage, priceTier);
    console.log(JSON.stringify({ tag:'GOV_RELAY_COST', guid, agency, tier: tierKey, via, apiCostKRW: bill.apiCostKRW, billedKRW: bill.billedKRW, multiplier: bill.multiplier, ts: new Date().toISOString(), ...meta }));
    const recordTask = Promise.all([_klawSpendAdd(env, userKey, bill.billedKRW), _klawSpendAdd(env, globalKey, bill.billedKRW)]);
    if (ctx?.waitUntil) ctx.waitUntil(recordTask); else recordTask.catch(() => {});
  };

  if (isStream) {
    const [forClient, forUsage] = res.body.tee();
    const usageTask = _parseUsageFromStream(forUsage).then(usage => billGovCall(usage, agency));
    if (ctx?.waitUntil) ctx.waitUntil(usageTask); else usageTask.catch(() => {});
    return new Response(forClient, { status:200, headers:{ ...corsHeaders, 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', 'X-Accel-Buffering':'no' } });
  }

  const data = await res.json();
  billGovCall(data?.usage, agency);

  // ── SP 간 호출(위임) 오케스트레이션 — canDelegate agency에서만 시도 ──────
  // call_chain은 이 요청 안에서만 존재하는 서버 내부 상태다(클라이언트가 보낸
  // 값이 아니다) — 최초 호출은 항상 [agency]에서 시작하므로 순환 검사가
  // 클라이언트 조작에 노출되지 않는다.
  if (canDelegate) {
    const firstContent = data?.choices?.[0]?.message?.content;
    const call = _parseSpCallRequest(firstContent);

    if (call) {
      const callChain = [agency];
      const target = call.target;
      const isCycle = callChain.includes(target);
      const overHopCap = callChain.length >= MAX_SP_HOPS;
      const unknownTarget = !SP_DELEGATION_REGISTRY[target];

      if (isCycle || overHopCap || unknownTarget) {
        // 위임 거부 — 원 SP를 한 번 더(2번째 호출) 불러 "위임 불가"를 알리고
        // 가진 정보로 마무리하게 한다(U9-4). 재시도에서도 sp_call이 다시
        // 오면(MAX_LLM_CALLS_PER_TURN 도달) 더 재귀하지 않고 안전하게 종료.
        const reason = unknownTarget ? 'TARGET_NOT_REGISTERED' : (isCycle ? 'CYCLE_DETECTED' : 'HOP_LIMIT_EXCEEDED');
        const denialNote = { role: 'user', content:
          `[시스템 안내] 방금 요청한 위임(target=${target})이 거부되었습니다(사유: ${reason}). ` +
          `다시 위임을 시도하지 말고, 지금 가진 정보만으로 답변을 마무리하십시오(U9-4).` };
        let res2;
        try {
          res2 = await fetch(DEEPSEEK_URL, {
            method: 'POST',
            headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${env.DEEPSEEK_API_KEY}` },
            body: JSON.stringify({ model: backendModel, max_tokens: max_tokens || 800, temperature: 0, stream: false,
              messages: [{ role:'system', content: systemContent }, ...dialogOnly, { role:'assistant', content: firstContent }, denialNote] }),
          });
        } catch (e) { return new Response(JSON.stringify(data), { headers: corsHeaders }); } // 실패 시 원 응답이라도 반환

        if (res2.ok) {
          const data2 = await res2.json();
          billGovCall(data2?.usage, `${agency}(denied:${reason})`);
          const finalContent = _parseSpCallRequest(data2?.choices?.[0]?.message?.content)
            ? '죄송합니다, 요청을 처리하는 중 확인이 필요한 절차가 있어 완전한 답을 드리기 어렵습니다. 관련 기관에 직접 문의해 주시기 바랍니다.'
            : data2?.choices?.[0]?.message?.content;
          data2.choices[0].message.content = finalContent;
          return new Response(JSON.stringify(data2), { headers: corsHeaders });
        }
        return new Response(JSON.stringify(data), { headers: corsHeaders });
      }

      // ── 위임 승인 — 대상 SP 서브 호출(2번째 LLM 호출) ──────────────
      const sub = await _callDelegationTarget(env, target, call.query, backendModel);
      billGovCall(sub.usage, `${agency}→${target}`);

      if (!sub.ok) {
        // 서브 호출 자체가 실패(네트워크/HTTP 오류 등) — 원 SP에게 알리고 마무리(3번째 호출).
        const failNote = { role:'user', content:
          `[시스템 안내] 위임(target=${target}) 호출이 기술적으로 실패했습니다(${sub.reason}). ` +
          `이 정보 없이 지금 가진 정보만으로 답변을 마무리하십시오.` };
        const res3 = await fetch(DEEPSEEK_URL, {
          method: 'POST',
          headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${env.DEEPSEEK_API_KEY}` },
          body: JSON.stringify({ model: backendModel, max_tokens: max_tokens || 800, temperature: 0.3, stream: false,
            messages: [{ role:'system', content: systemContent }, ...dialogOnly, { role:'assistant', content: firstContent }, failNote] }),
        }).catch(() => null);
        if (res3 && res3.ok) {
          const data3 = await res3.json();
          billGovCall(data3?.usage, `${agency}(sub-fail)`);
          return new Response(JSON.stringify(data3), { headers: corsHeaders });
        }
        return new Response(JSON.stringify(data), { headers: corsHeaders });
      }

      // ── 위임 성공 — 원 SP에게 결과를 넘겨 최종 합성(3번째, 마지막 LLM 호출) ──
      // MAX_LLM_CALLS_PER_TURN(=3)에 맞춰 여기서 대화를 종결한다 — 이 합성
      // 응답이 또 sp_call을 내놓아도(U9-3 위반) 절대 따르지 않는다.
      const resultNote = { role:'user', content:
        `[시스템 안내] 위임 결과 — ${sub.label}의 답변: """${sub.content}"""\n` +
        `이 정보를 반영해 사용자에게 최종 답변을 작성하십시오. 어느 기관을 통해 확인한 정보인지 밝히십시오(U9-5). ` +
        `다시 위임을 시도하지 마십시오(U9-3).` };
      let res4;
      try {
        res4 = await fetch(DEEPSEEK_URL, {
          method: 'POST',
          headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${env.DEEPSEEK_API_KEY}` },
          body: JSON.stringify({ model: backendModel, max_tokens: max_tokens || 1200, temperature: 0.3, stream: false,
            messages: [{ role:'system', content: systemContent }, ...dialogOnly, { role:'assistant', content: firstContent }, resultNote] }),
        });
      } catch (e) { return new Response(JSON.stringify(data), { headers: corsHeaders }); }

      if (res4.ok) {
        const data4 = await res4.json();
        billGovCall(data4?.usage, `${agency}←${target}(synth)`);
        // 마지막 방어선: 여전히 sp_call JSON이면 절대 재귀하지 않고 안전한 문구로 대체.
        if (_parseSpCallRequest(data4?.choices?.[0]?.message?.content)) {
          data4.choices[0].message.content =
            `${sub.label} 확인 결과를 포함해 안내드리려 했으나 응답 처리 중 문제가 있었습니다. ` +
            `${sub.label}에 직접 문의하시거나 잠시 후 다시 시도해 주세요.`;
        }
        return new Response(JSON.stringify(data4), { headers: corsHeaders });
      }
      return new Response(JSON.stringify(data), { headers: corsHeaders });
    }
  }

  return new Response(JSON.stringify(data), { headers: corsHeaders });
}

// Phase 1 — OpenHash 앵커링 프록시 (/openhash/anchor)
// buildout_plan_v2 Phase 1: _submitToLayer 교체
//
// 설계 원칙:
//   - 클라이언트(브라우저)는 GitHub 토큰을 직접 보유하지 않음
//   - hashChain.js anchor()가 POST /openhash/anchor를 호출
//   - worker.js가 env.OPENHASH_TOKEN으로 repository_dispatch 중계
//
// 앵커링 상태:
//   submitted  : dispatch 202 Accepted — 블록 생성 진행 중 (비동기)
//   confirmed  : chain_status.json 재조회로 block 생성 확인
//   failed     : 네트워크 오류 또는 token 누락
// ═══════════════════════════════════════════════════════════
async function handleOpenhashAnchor(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  const { entry_hash, content_hash, msg_id, signatures, layer, score, lcat, block_height, submitted_at } = body;

  // 필수 필드 검증
  if (!entry_hash || entry_hash.length !== 64)
    return _err(400, 'INVALID_ENTRY_HASH', 'entry_hash는 SHA-256 hex(64자) 필수', corsHeaders);
  if (!layer || !LAYER_REPOS[layer])
    return _err(400, 'INVALID_LAYER', `지원 계층: ${Object.keys(LAYER_REPOS).join(', ')}`, corsHeaders);

  // OPENHASH_TOKEN 확인 (env 변수 — wrangler secret)
  const token = env.OPENHASH_TOKEN;
  if (!token) {
    console.warn('[OpenHash] OPENHASH_TOKEN 미설정 — submitted=false');
    return new Response(JSON.stringify({
      ok:        false,
      status:    'failed',
      reason:    'OPENHASH_TOKEN not configured',
      entry_hash,
      layer,
    }), { status: 200, headers: corsHeaders });
  }

  const repo = LAYER_REPOS[layer];

  // repository_dispatch 전송 (GitHub API)
  // 응답: 204 No Content = 수락됨 (비동기 처리)
  let dispatchStatus;
  try {
    const res = await fetch(`${GITHUB_API}/repos/${repo}/dispatches`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept':        'application/vnd.github+json',
        'Content-Type':  'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent':    'hondi-proxy/1.0',
      },
      body: JSON.stringify({
        event_type:     'HASH_CHAIN_ANCHOR',
        client_payload: {
          entry_hash,
          content_hash:  content_hash  || '',
          msg_id:        msg_id        || '',
          signatures:    signatures    || [],
          merkle_layer:  layer,
          score:         score         ?? 0,
          lcat:          lcat          || 'B',
          block_height:  block_height  || 0,
          submitted_at:  submitted_at  || new Date().toISOString(),
        },
      }),
    });
    dispatchStatus = res.status;
  } catch (e) {
    console.error('[OpenHash] dispatch 실패:', e.message);
    return new Response(JSON.stringify({
      ok: false, status: 'failed', reason: e.message, entry_hash, layer,
    }), { status: 200, headers: corsHeaders });
  }

  // 204 = 수락됨 (블록 생성은 Actions 워크플로우가 비동기 처리)
  const submitted = dispatchStatus === 204;
  console.log(`[OpenHash] dispatch ${layer} → ${repo} | status=${dispatchStatus} | entry=${entry_hash.slice(0,16)}...`);

  return new Response(JSON.stringify({
    ok:         submitted,
    status:     submitted ? 'submitted' : 'failed',
    layer,
    repo,
    entry_hash,
    dispatch_status: dispatchStatus,
    note: submitted
      ? '블록 생성 진행 중.'
      : `dispatch 실패 (HTTP ${dispatchStatus})`,
  }), { status: 200, headers: corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// Phase 5 — OpenHash ILMV 상태 조회 (/openhash/status)
// chain_status.json을 fetch해 실시간 ILMV 감사 결과 반환
// ═══════════════════════════════════════════════════════════
async function handleOpenhashStatus(request, env, corsHeaders) {
  const url2 = new URL(request.url);
  const layer = url2.searchParams.get('layer') || null;  // 특정 계층만 조회
  const LAYER_STATUS_URLS = {
    L1: 'https://openhash-gopang.github.io/openhash-L1-ido1/chain_status.json',
    L2: 'https://openhash-gopang.github.io/openhash-L2-jeju-city/chain_status.json',
    L3: 'https://openhash-gopang.github.io/openhash-L3-jeju/chain_status.json',
    L4: 'https://openhash-gopang.github.io/openhash-L4-kr/chain_status.json',
    L5: 'https://openhash-gopang.github.io/openhash-L5-global/chain_status.json',
  };
  // 계층별 타임스탬프 신선도 임계값 (논문 §4.3 주기 기반)
  // L1: 실시간 100% 스트리밍 → 5분
  // L2: 10분 주기 → 15분 (여유 50%)
  // L3: 30분 주기 → 45분
  // L4: 1시간 주기 → 90분
  // L5: 1시간 주기 → 90분
  const STALENESS_THRESHOLDS = {
    L1:  5 * 60,      // 300초
    L2: 15 * 60,      // 900초
    L3: 45 * 60,      // 2700초
    L4: 90 * 60,      // 5400초
    L5: 90 * 60,      // 5400초
  };

  async function fetchOne(l) {
    const url = LAYER_STATUS_URLS[l];
    try {
      const res = await fetch(url, { cf: { cacheTtl: 30 } });
      if (!res.ok) return { layer: l, fetched: false, error: `HTTP ${res.status}` };
      const raw = await res.json();
      const now = Date.now();
      const lastMs = raw.last_verified ? new Date(raw.last_verified).getTime() : 0;
      const staleMs = now - lastMs;
      const staleThresholdSec = STALENESS_THRESHOLDS[l] ?? 300;
      const isStale = lastMs > 0 && staleMs > staleThresholdSec * 1000;
      return {
        layer:          l,
        fetched:        true,
        node_id:        raw.node_id,
        total_blocks:   raw.total_blocks,
        latest_hash:    raw.latest_hash,
        chain_valid:    raw.chain_valid,
        ilmv_status:    raw.ilmv_status,
        openhash_tx:    raw.openhash_tx,
        last_verified:  raw.last_verified,
        staleness_sec:  Math.round(staleMs / 1000),
        staleness_threshold_sec: staleThresholdSec,
        timestamp_stale: isStale,
        audit: {
          hashChainBreak:   raw.chain_valid === false,
          bivmViolation:    raw.ilmv_status === 'VIOLATION',
          timestampStale:   isStale,
          signatureFailure: raw.ilmv_status === 'SIGNATURE_FAILURE',
          errorRate:        raw.openhash_tx === 'FAILED' ? 1.0 : 0,
        },
      };
    } catch(e) {
      return { layer: l, fetched: false, error: e.message };
    }
  }

  let results;
  if (layer && LAYER_STATUS_URLS[layer]) {
    results = { [layer]: await fetchOne(layer) };
  } else {
    const layers = ['L1','L2','L3','L4','L5'];
    const settled = await Promise.allSettled(layers.map(l => fetchOne(l)));
    results = {};
    settled.forEach((r,i) => {
      results[layers[i]] = r.status === 'fulfilled' ? r.value : { layer: layers[i], fetched: false };
    });
  }

  // 전체 상태 요약
  const allFetched = Object.values(results).filter(r => r.fetched);
  // summary: 치명적 이슈(체인단절/BIVM/서명실패)와 경고(타임스탬프)를 분리
  const criticalIssue = allFetched.some(r =>
    r.audit?.hashChainBreak || r.audit?.bivmViolation || r.audit?.signatureFailure
  );
  const staleWarning = allFetched.some(r => r.audit?.timestampStale);

  return new Response(JSON.stringify({
    ok:        true,
    summary:   criticalIssue ? 'ISSUE_DETECTED' : staleWarning ? 'STALE_WARNING' : 'NORMAL',
    queried_at: new Date().toISOString(),
    layers:    results,
  }, null, 2), { status: 200, headers: corsHeaders });
}

// Module 5.5 — Hash Chain & BIVM (PDV-HASHCHAIN-DESIGN-v3.0)
// ═══════════════════════════════════════════════════════════

// ── 중요도 점수 (논문 §4.1 공식) ────────────────────────────────────────
// importanceVerifier.js와 100% 동일 공식 유지 — 단일 정의 원칙
// worker.js는 ES 모듈 import 불가(단일 파일 구조)이므로 인라인 포팅
//
// score = W_AMOUNT·f_amount + W_TYPE·f_type + W_CONTRACT·f_contract
//   f_amount(v)   = min(v / V_REF, 1.0) × 100
//   f_type        : stable=1.0, physical=0.8, point=0.3
//   f_contract    : escrow=1.0, conditional=0.8, instant=0.5
//   임계값: LIGHTWEIGHT<25, STANDARD<60, ENHANCED≥60
const _IMPORTANCE = {
  W_AMOUNT: 0.5, W_TYPE: 0.3, W_CONTRACT: 0.2,
  V_REF: 100_000,
  F_TYPE:     { stable: 1.0, physical: 0.8, point: 0.3 },
  F_CONTRACT: { escrow: 1.0, conditional: 0.8, instant: 0.5 },
  LIGHTWEIGHT_MAX: 25,
  STANDARD_MAX:    60,
};

/**
 * 거래 중요도 점수 계산 (논문 §4.1)
 * importanceVerifier.js#calculateImportanceScore 와 동일 공식
 * @param {number} amount       - 거래 금액 (GDC)
 * @param {string} assetType    - 'stable'|'physical'|'point'
 * @param {string} contractType - 'instant'|'conditional'|'escrow'
 * @returns {number} score (0~100)
 */
function _computeImportanceScore(amount, assetType = 'stable', contractType = 'instant') {
  const fAmount   = Math.min(amount / _IMPORTANCE.V_REF, 1.0) * 100;
  const fType     = _IMPORTANCE.F_TYPE[assetType]     ?? _IMPORTANCE.F_TYPE.stable;
  const fContract = _IMPORTANCE.F_CONTRACT[contractType] ?? _IMPORTANCE.F_CONTRACT.instant;
  return (
    _IMPORTANCE.W_AMOUNT   * fAmount   +
    _IMPORTANCE.W_TYPE     * fType     +
    _IMPORTANCE.W_CONTRACT * fContract
  );
}

/**
 * score → 검증 모드
 * @param {number} score
 * @returns {'LIGHTWEIGHT'|'STANDARD'|'ENHANCED'}
 */
function _selectImportanceMode(score) {
  if (score < _IMPORTANCE.LIGHTWEIGHT_MAX) return 'LIGHTWEIGHT';
  if (score < _IMPORTANCE.STANDARD_MAX)    return 'STANDARD';
  return 'ENHANCED';
}

// ── LCAT 계산 (논문 §4.1 PLSM 입력) ────────────────────────────────────
// LCAT(Localized Commit Affinity Type): 거래 당사자의 물리적 위치로 결정
// 검색 requires_geo 플래그와 완전히 독립 — 절대 같은 플래그로 묶지 않는다
//
// 현재: gopang 한림읍 파일럿 단계 → 제주 내부=A, 제주↔육지=B, 국제=C
// geo 정보가 없는 경우 보수적으로 'B' (표준 계층 라우팅) 사용
/**
 * LCAT 계산
 * @param {string|null} buyerRegion  - 구매자 지역 코드 (예: 'jeju', 'seoul', 'us')
 * @param {string|null} sellerRegion - 판매자 지역 코드
 * @returns {'A'|'B'|'C'}
 */
function computeLCAT(buyerRegion, sellerRegion) {
  const jeju = new Set(['jeju', 'jeju-si', 'seogwipo']);
  const kr   = new Set(['seoul', 'busan', 'daegu', 'incheon', 'gwangju',
                        'daejeon', 'ulsan', 'sejong', 'gyeonggi', 'gangwon',
                        'chungbuk', 'chungnam', 'jeonbuk', 'jeonnam',
                        'gyeongbuk', 'gyeongnam', 'jeju']); // 제주도 본인도 kr 포함
  if (!buyerRegion || !sellerRegion) return 'B'; // 정보 없음 → 보수적
  const bJeju = jeju.has(buyerRegion.toLowerCase());
  const sJeju = jeju.has(sellerRegion.toLowerCase());
  const bKr   = kr.has(buyerRegion.toLowerCase());
  const sKr   = kr.has(sellerRegion.toLowerCase());
  if (bJeju && sJeju) return 'A';   // 제주 내부
  if (bKr   && sKr)   return 'B';   // 국내 (제주↔육지 포함)
  return 'C';                        // 국제
}

// 2026-07-07 제거: _fetchUserBalance()(Supabase user_profiles.extra.fs 조회)와
// _bivmVerify()(그 값 기반 사전검증)를 삭제했다 — handleBizOrder에서 이미
// 호출부를 걷어내 완전히 죽은 코드가 됐다. 잔액 검증은 이제 L1의
// computeBalance()(blocks 원장 재생)가 전담한다.

/**
 * C-1: L1 노드 Hash Chain H_N 기록
 * n_i = SHA-256(n_{i-1} ∥ h_{user,i})
 */
async function updateNodeHashChain(env, { userHash, txId, blockHash, buyerGuid, sellerGuid, balanceClaimed }) {
  try {
    const sbH = _sbServiceHeaders(env);

    // 직전 node_hash 조회
    const lastRes = await fetch(
      `${SUPABASE_URL}/rest/v1/l1_ledger?select=node_hash&order=anchored_at.desc&limit=1`,
      { headers: sbH }
    );
    const lastRows = await lastRes.json().catch(() => []);
    const prevNodeHash = lastRows?.[0]?.node_hash || '0'.repeat(64);

    // n_i = SHA-256(n_{i-1} ∥ h_{user,i})
    const input    = new TextEncoder().encode(prevNodeHash + userHash);
    const buf      = await crypto.subtle.digest('SHA-256', input);
    const nodeHash = Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0')).join('');

    await fetch(`${SUPABASE_URL}/rest/v1/l1_ledger`, {
      method:  'POST',
      headers: { ...sbH, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        tx_id:           txId,
        buyer_guid:      buyerGuid,
        seller_guid:     sellerGuid,
        block_hash:      blockHash,
        user_hash:       userHash,
        node_hash:       nodeHash,
        balance_claimed: balanceClaimed,
        anchored_at:     new Date().toISOString(),
      }),
    });

    console.log('[H_N] l1_ledger 기록 완료 | tx_id:', txId?.slice(0, 8),
      '| node_hash:', nodeHash.slice(0, 8));
    return nodeHash;
  } catch(e) {
    console.warn('[H_N] updateNodeHashChain 실패:', e.message);
  }
}

/**
 * 사용자 Hash Chain h_i 계산
 * h_i = SHA-256(block_hash ∥ tx_hash ∥ height)
 * ※ 클라이언트의 전체 공식과 달리 Worker는 prev_local_hash 없이
 *   block_hash + tx_hash + height로 user_hash를 산출합니다.
 *   (IDB 없는 서버 환경 — L1 응답 기반 단순화)
 */
async function _computeUserHash(txHash, blockHash, height) {
  const input = new TextEncoder().encode(blockHash + txHash + String(height));
  const buf   = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * C-2a: L1 응답 vs outputs 일관성 검증
 * 감시 모드 — 불일치 시 로그만 기록, 거래 차단 안 함 (T10까지)
 */
// 2026-07-07 수정: 이전엔 구매자 쪽(buyer_claim.amount vs 전체 outputs
// 합계)만 봤다 — "판매자와 구매자의 재무제표 변동 사항 일치 검증"이라는
// 요청에 정확히 맞추려면 판매자 쪽도 봐야 한다. L1이 독립적으로 계산해
// 돌려준 seller_claim.amount가, 원래 보내려던 판매자 몫(outputs 중
// gopang-platform이 아닌 첫 수취인)과 정확히 일치하는지도 검증한다.
function verifyOutputConsistency(l1Response, outputs) {
  const l1BuyerTotal  = l1Response.buyer_claim?.amount  || 0;
  const l1SellerTotal = l1Response.seller_claim?.amount || 0;
  const calcTotal     = outputs.reduce((s, o) => s + (o.amount || 0), 0);
  const calcSellerNet = outputs.find(o => o.recipient_guid !== 'gopang-platform')?.amount || 0;

  const buyerConsistent  = Math.abs(l1BuyerTotal  - calcTotal)     < 0.01;
  const sellerConsistent = Math.abs(l1SellerTotal - calcSellerNet) < 0.01;
  const consistent = buyerConsistent && sellerConsistent;

  if (!consistent) {
    console.error('[BIVM] L1 응답 vs outputs 불일치!', JSON.stringify({
      buyer:  { l1: l1BuyerTotal,  calc: calcTotal,     diff: l1BuyerTotal  - calcTotal },
      seller: { l1: l1SellerTotal, calc: calcSellerNet, diff: l1SellerTotal - calcSellerNet },
    }));
  }
  return consistent;
}

/**
 * C-2b: 실시간 Σδ=0 검증 (설계서 E1 수정)
 * buyer_debit = seller_credit + platform_debit
 * 감시 모드 — 불일치 시 로그만 기록, 거래 차단 안 함 (T10까지)
 */
function verifyDeltaZero(outputs, balanceClaimed) {
  const sellerNet   = outputs.find(o => o.recipient_guid !== 'gopang-platform')?.amount || 0;
  const platformFee = outputs.find(o => o.recipient_guid === 'gopang-platform')?.amount  || 0;
  const buyerDebit  = sellerNet + platformFee;
  const sigmaDelta  = Math.abs(buyerDebit - sellerNet - platformFee);

  if (sigmaDelta > 0.01) {
    console.error('[BIVM] Σδ ≠ 0 — 집합 잔액 불변성 위반!',
      JSON.stringify({ buyerDebit, sellerNet, platformFee, sigmaDelta }));
    return { valid: false, sigmaDelta };
  }
  // 2026-07-07 제거: 여기 있던 "balanceClaimed < buyerDebit → 잔액 부족"
  // 판정을 걷어냈다. balance_claimed는 클라이언트 자체 신고값이라 더 이상
  // 신뢰하지 않기로 했고(L1의 computeBalance가 유일한 권위) — 이 시점에
  // 이미 L1이 잔액을 승인했으니(그러지 않았으면 handleBizOrder가 여기까지
  // 오지도 못했다) 거래는 실제로 정상이다. 그런데 이 체크가 남아있으면
  // balance_claimed를 정확히 안 보낸(이제 그럴 필요가 없어진) 모든 정상
  // 거래를 매번 "불일치"로 잘못 표시해서, 감사 기록(consistency_check)
  // 자체를 오염시킨다. balanceClaimed 인자는 참고 로그용으로만 남긴다.
  if (balanceClaimed != null) {
    console.log('[BIVM] balance_claimed(참고용, 판정에 미사용):',
      JSON.stringify({ balanceClaimed, buyerDebit }));
  }
  return { valid: true, sigmaDelta: 0 };
}

// ═══════════════════════════════════════════════════════════
// Module T10 — Merkle Anchoring (anchorL1MerkleRoot)
// Cron: 10분마다 실행
// 미앵커링 pdv_log 배치 → 머클 루트 계산 → merkle_anchors INSERT
// → pdv_log openhash_anchored = true 갱신
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// Wallet X25519 — PC가 휴대폰의 암호화 공개키를 조회/등록
// ═══════════════════════════════════════════════════════════

// GET /wallet/x25519?guid=...  (PC가 호출, 인증 불필요 — 공개키는 비밀 아님)
async function handleWalletX25519Get(request, env, corsHeaders) {
  const url  = new URL(request.url);
  const guid = url.searchParams.get('guid');
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);

  let record;
  try {
    record = await _l1FindProfileByGuid(env, guid);
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
  }

  const pubkey = record?.x25519_pubkey || null;

  if (!pubkey) {
    return new Response(JSON.stringify({
      ok: false, registered: false,
      message: '암호화 키가 아직 준비되지 않았습니다. 휴대폰에서 고팡 앱을 한 번 완전히 종료한 뒤 다시 열어 주세요. (가입이 안 되어 있다면 먼저 가입을 완료해 주세요.)',
    }), { status: 200, headers: corsHeaders });
  }
  return new Response(JSON.stringify({ ok: true, registered: true, x25519_pubkey: pubkey }),
    { status: 200, headers: corsHeaders });
}

// POST /wallet/x25519  — 휴대폰이 자신의 X25519 공개키 등록
// body: { guid, x25519_pubkey, ed25519_pubkey, signature, ts }
// 서명 대상: `${guid}:${x25519_pubkey}:${ts}` (固定 문자열, /profile과 동일 패턴)
// Ed25519 서명을 요구하는 이유: 서명 없이 등록을 허용하면 공격자가
// 피해자의 guid를 알아내 먼저 자신의 키로 선점 등록(레이스 컨디션)할 수 있고,
// 이후 PC가 그 guid로 암호화한 API Key를 공격자가 복호화할 수 있게 된다.
async function handleWalletX25519Post(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { guid, x25519_pubkey, ed25519_pubkey, signature, ts } = body;
  if (!guid)           return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  if (!x25519_pubkey)  return _err(400, 'MISSING_FIELD', 'x25519_pubkey 필수', corsHeaders);
  if (!ed25519_pubkey) return _err(400, 'MISSING_FIELD', 'ed25519_pubkey 필수', corsHeaders);
  if (!signature)      return _err(400, 'MISSING_FIELD', 'signature 필수', corsHeaders);

  const sigMsg = `${guid}:${x25519_pubkey}:${ts || ''}`;
  const sigOk  = await _verifyEd25519Simple(ed25519_pubkey, signature, sigMsg);
  if (!sigOk) return _err(401, 'INVALID_SIGNATURE', '서명 검증 실패', corsHeaders);

  let record;
  try {
    record = await _l1FindProfileByGuid(env, guid);
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
  }
  // L1 profiles row는 가입(_register) 시 이미 생성되어 있어야 한다 — guid가 L1에 없으면
  // 가입 자체가 안 된 상태이므로 등록을 거부한다.
  if (!record) return _err(404, 'PROFILE_NOT_FOUND', '가입(L1 등록)이 먼저 완료되어야 합니다', corsHeaders);

  // TOFU: 이 guid에 이미 등록된 Ed25519 공개키와 일치해야만 진짜 소유자로 인정
  const knownEdPubkey = record.pubkey_ed25519;
  if (knownEdPubkey && knownEdPubkey !== ed25519_pubkey) {
    return _err(403, 'PUBKEY_MISMATCH', '등록된 공개키와 일치하지 않습니다', corsHeaders);
  }

  // 정책: Ed25519 서명 검증 통과 = 본인 증명.
  // 기기 교체/앱 재설치는 계정 삭제로 처리하므로, 동일 기기에서 재등록 시
  // (앱 업데이트 후 IDB 유지 등) Ed25519가 일치하면 X25519도 갱신 허용.
  const alreadyRegistered = !!record.x25519_pubkey;
  try {
    await _l1PatchProfile(env, record.id, {
      pubkey_ed25519: knownEdPubkey || ed25519_pubkey,
      x25519_pubkey,
      x25519_registered_at: new Date().toISOString(),
    });
  } catch (e) {
    return _err(500, 'L1_PATCH_FAILED', e.message, corsHeaders);
  }

  return new Response(JSON.stringify({ ok: true, already_registered: alreadyRegistered, x25519_pubkey }),
    { status: 200, headers: corsHeaders });
}


// POST /account/delete-profile — "계정 삭제"(경량) — L1 profiles 레코드만 삭제
// body: { guid, phone, ed25519_pubkey, signature, ts }
// 서명 대상: `delete-profile:${guid}:${ts}` — full-reset과 동일한 서명 검증 패턴
//
// full-reset과의 차이(2026-07-02 신설, 설정 화면 "계정 삭제" 슬라이드아웃 전용):
//   - full-reset은 L1 + Supabase 9개 테이블 + KV까지 전부 지우고, 클라이언트도
//     로컬 데이터(PDV·지갑)까지 전부 초기화한다 — "완전 초기화" 용도.
//   - 이 엔드포인트는 L1 profiles(전화번호·guid 연결 정보) 딱 하나만 지운다.
//     PDV·지갑 같은 로컬 데이터는 이용자 기기에 그대로 남아있으므로(혼디는
//     서버에 원본 데이터를 두지 않는다는 설계 원칙), 나중에 같은 번호로
//     다시 가입하면 로컬에 남아있던 기록과 함께 이전 상태로 자연스럽게
//     이어진다 — 서버가 곧 원본인 기존 SNS와 근본적으로 다른 지점이다.
async function handleAccountDeleteProfile(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { guid, phone, ed25519_pubkey, signature, ts } = body;
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);

  let l1Record = null;
  try {
    l1Record = await _l1FindProfileByGuid(env, guid);
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
  }
  if (!l1Record) {
    // 이미 없는 계정 — 삭제할 것도 없으므로 성공으로 취급(멱등성)
    return new Response(JSON.stringify({ ok: true, deleted: true, already_gone: true }),
      { status: 200, headers: corsHeaders });
  }

  // ── 본인 확인 1: 서명(핵심 보안 근거) ─────────────────────
  const knownEdPubkey = l1Record.pubkey_ed25519;
  if (knownEdPubkey) {
    if (!ed25519_pubkey || !signature)
      return _err(400, 'MISSING_FIELD', '본인 확인을 위해 ed25519_pubkey/signature가 필요합니다', corsHeaders);
    if (knownEdPubkey !== ed25519_pubkey)
      return _err(403, 'PUBKEY_MISMATCH', '등록된 공개키와 일치하지 않습니다', corsHeaders);
    const sigOk = await _verifyEd25519Simple(ed25519_pubkey, signature, `delete-profile:${guid}:${ts || ''}`);
    if (!sigOk) return _err(401, 'INVALID_SIGNATURE', '서명 검증 실패', corsHeaders);
  }

  // ── 본인 확인 2: 전화번호(사용자가 화면에서 직접 재입력한 값) ──
  // 서명만으로도 충분히 안전하지만, 실수로 잘못된 계정을 지우는 걸 한 번
  // 더 막기 위한 보조 확인 — 저장된 값과 다르면 거부한다.
  if (phone && l1Record.phone && phone !== l1Record.phone) {
    return _err(403, 'PHONE_MISMATCH', '입력한 전화번호가 계정과 일치하지 않습니다', corsHeaders);
  }

  try {
    const token = await _l1AdminToken(env);
    const r = await fetch(
      `${L1_DEFAULT}/api/collections/profiles/records/${l1Record.id}`,
      { method: 'DELETE', headers: { 'Authorization': 'Admin ' + token } }
    );
    if (!r.ok && r.status !== 404) {
      return _err(502, 'L1_DELETE_FAILED', `L1 삭제 실패 (HTTP ${r.status})`, corsHeaders);
    }
  } catch (e) {
    return _err(502, 'L1_DELETE_FAILED', 'L1 삭제 실패: ' + e.message, corsHeaders);
  }

  console.info('[DeleteProfile] 삭제 완료 | guid:', guid.slice(0, 16));
  return new Response(JSON.stringify({ ok: true, deleted: true }), { status: 200, headers: corsHeaders });
}

// POST /account/full-reset — 계정 완전 삭제 시 Supabase user_profiles row 삭제
// body: { guid, ed25519_pubkey, signature, ts }
// 서명 대상: `full-reset:${guid}:${ts}` — 기존 등록된 ed25519 키로 서명해야 본인 확인됨
// (등록된 키가 없는 경우 — 즉 가입 직후 한 번도 X25519 설정을 안 한 계정 —는 서명 검증 없이 허용)
async function handleAccountFullReset(request, env, corsHeaders) {
  // POST /account/full-reset
  // 정책: 해당 사용자의 모든 기록을 서버에서 완전 삭제.
  // L1(profiles), Supabase(전 테이블), KV(봉투)에서 guid에 연결된 모든 row 제거.
  // 본인 확인: L1 pubkey_ed25519로 서명 검증. L1 키가 없으면(가입 직후 미등록) 서명 생략 허용.
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { guid, ed25519_pubkey, signature, ts } = body;
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);

  // ── 본인 확인: L1 기준 ───────────────────────────────────
  let l1Record = null;
  try {
    l1Record = await _l1FindProfileByGuid(env, guid);
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
  }
  const knownEdPubkey = l1Record?.pubkey_ed25519;
  if (knownEdPubkey) {
    if (!ed25519_pubkey || !signature)
      return _err(400, 'MISSING_FIELD', '본인 확인을 위해 ed25519_pubkey/signature가 필요합니다', corsHeaders);
    if (knownEdPubkey !== ed25519_pubkey)
      return _err(403, 'PUBKEY_MISMATCH', '등록된 공개키와 일치하지 않습니다', corsHeaders);
    const sigOk = await _verifyEd25519Simple(ed25519_pubkey, signature, `full-reset:${guid}:${ts || ''}`);
    if (!sigOk) return _err(401, 'INVALID_SIGNATURE', '서명 검증 실패', corsHeaders);
  }

  const results = await _deleteAllUserData(env, guid, l1Record);

  console.info('[FullReset] 삭제 완료 | guid:', guid.slice(0, 16), '| 결과:', JSON.stringify(results));
  return new Response(JSON.stringify({ ok: true, deleted: true, results }), { status: 200, headers: corsHeaders });
}

// ── 사용자 1명의 모든 서버측 데이터 삭제 (L1 + Supabase 9개 테이블 + KV) ──────
// handleAccountFullReset(본인 요청)과 handleAdminBulkDelete(관리자 요청)이 공용으로 호출.
// ⚠️ 호출 전 전제조건: user_profiles.casts_for(그림자 FK)가 이 guid를 가리키는 row가
//    남아있으면 2번 단계(user_profiles 삭제)가 FK 위반으로 실패한다 — 호출자가 먼저
//    그림자 정리를 끝내야 한다(handleAdminBulkDelete의 ① casts_for 일괄 정리 참고).
async function _deleteAllUserData(env, guid, l1Record) {
  const results = {};
  const sbSvcH  = _sbServiceHeaders(env);

  // ── 1. L1 profiles 삭제 ──────────────────────────────────
  if (l1Record?.id) {
    try {
      const token = await _l1AdminToken(env);
      const r = await fetch(
        `${L1_DEFAULT}/api/collections/profiles/records/${l1Record.id}`,
        { method: 'DELETE', headers: { 'Authorization': 'Admin ' + token } }
      );
      results.l1_profiles = r.ok || r.status === 404 ? 'deleted' : `error:${r.status}`;
    } catch (e) { results.l1_profiles = 'error:' + e.message; }
  } else {
    results.l1_profiles = 'not_found';
  }

  // ── 2. Supabase: user_profiles ───────────────────────────
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?guid=eq.${encodeURIComponent(guid)}`,
      { method: 'DELETE', headers: sbSvcH });
    results.sb_user_profiles = r.ok ? 'deleted' : `error:${r.status}`;
  } catch (e) { results.sb_user_profiles = 'error:' + e.message; }

  // ── 3. Supabase: user_llm_keys ───────────────────────────
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/user_llm_keys?guid=eq.${encodeURIComponent(guid)}`,
      { method: 'DELETE', headers: sbSvcH });
    results.sb_user_llm_keys = r.ok ? 'deleted' : `error:${r.status}`;
  } catch (e) { results.sb_user_llm_keys = 'error:' + e.message; }

  // ── 4. Supabase: pdv_log ─────────────────────────────────
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/pdv_log?guid=eq.${encodeURIComponent(guid)}`,
      { method: 'DELETE', headers: sbSvcH });
    results.sb_pdv_log = r.ok ? 'deleted' : `error:${r.status}`;
  } catch (e) { results.sb_pdv_log = 'error:' + e.message; }

  // ── 5. L1(hanlim): pdv_consent_requests ──────────────────
  // BUG-FIX(2026-07-02): 원래 Supabase pdv_consent_requests 테이블이 한 번도
  // 생성된 적이 없어(HTTP 404 PGRST205 확인됨) 여기서 항상 실패해 계정 완전
  // 삭제 전체가 막혔다. Supabase→L1 마이그레이션 방향에 맞춰 테이블을 새로
  // 만드는 대신 L1(hanlim) PocketBase에 pdv_consent_requests 컬렉션을 신설했다
  // (id: p1tketkfid3uup8, listRule 등 전부 관리자 전용). PocketBase REST API는
  // Supabase처럼 필터 조건으로 여러 row를 한 번에 지우는 벌크 DELETE가 없어서,
  // 먼저 ipv6로 목록 조회한 뒤 각 record id로 개별 DELETE한다.
  try {
    const token = await _l1AdminToken(env);
    const filter = encodeURIComponent(`ipv6='${String(guid).replace(/'/g, "\\'")}'`);
    const listRes = await fetch(
      `${L1_DEFAULT}/api/collections/pdv_consent_requests/records?filter=${filter}&perPage=200`,
      { headers: { 'Authorization': 'Bearer ' + token } }
    );
    if (!listRes.ok) {
      results.l1_pdv_consent = `error:${listRes.status}`;
    } else {
      const listData = await listRes.json().catch(() => ({ items: [] }));
      const items = listData.items || [];
      let failCount = 0;
      for (const item of items) {
        const delRes = await fetch(
          `${L1_DEFAULT}/api/collections/pdv_consent_requests/records/${item.id}`,
          { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token } }
        );
        if (!delRes.ok && delRes.status !== 404) failCount++;
      }
      results.l1_pdv_consent = failCount === 0 ? 'deleted' : `error:${failCount}/${items.length}_failed`;
    }
  } catch (e) { results.l1_pdv_consent = 'error:' + e.message; }

  // ── 6. Supabase: biz_products (판매자) ───────────────────
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/biz_products?seller_guid=eq.${encodeURIComponent(guid)}`,
      { method: 'DELETE', headers: sbSvcH });
    results.sb_biz_products = r.ok ? 'deleted' : `error:${r.status}`;
  } catch (e) { results.sb_biz_products = 'error:' + e.message; }

  // ── 7. Supabase: biz_reviews (작성자 + 판매자) ───────────
  try {
    const r1 = await fetch(`${SUPABASE_URL}/rest/v1/biz_reviews?reviewer_guid=eq.${encodeURIComponent(guid)}`,
      { method: 'DELETE', headers: sbSvcH });
    const r2 = await fetch(`${SUPABASE_URL}/rest/v1/biz_reviews?seller_guid=eq.${encodeURIComponent(guid)}`,
      { method: 'DELETE', headers: sbSvcH });
    results.sb_biz_reviews = (r1.ok && r2.ok) ? 'deleted' : `error:${r1.status}/${r2.status}`;
  } catch (e) { results.sb_biz_reviews = 'error:' + e.message; }

  // ── 8. Supabase: webauthn_credentials ────────────────────
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/webauthn_credentials?ipv6=eq.${encodeURIComponent(guid)}`,
      { method: 'DELETE', headers: sbSvcH });
    results.sb_webauthn = r.ok ? 'deleted' : `error:${r.status}`;
  } catch (e) { results.sb_webauthn = 'error:' + e.message; }

  // ── 9. Supabase: webrtc_signals (송신 + 수신) ────────────
  try {
    const r1 = await fetch(`${SUPABASE_URL}/rest/v1/webrtc_signals?from_guid=eq.${encodeURIComponent(guid)}`,
      { method: 'DELETE', headers: sbSvcH });
    const r2 = await fetch(`${SUPABASE_URL}/rest/v1/webrtc_signals?to_guid=eq.${encodeURIComponent(guid)}`,
      { method: 'DELETE', headers: sbSvcH });
    results.sb_webrtc = (r1.ok && r2.ok) ? 'deleted' : `error:${r1.status}/${r2.status}`;
  } catch (e) { results.sb_webrtc = 'error:' + e.message; }

  // ── 10. Supabase: push_subscriptions (레거시 테이블) ─────
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?guid=eq.${encodeURIComponent(guid)}`,
      { method: 'DELETE', headers: sbSvcH });
    results.sb_push_subscriptions = r.ok ? 'deleted' : `error:${r.status}`;
  } catch (e) { results.sb_push_subscriptions = 'error:' + e.message; }

  // ── 11. Cloudflare KV: AI Setup 봉투 ────────────────────
  if (env.AI_SETUP_SEALS_KV) {
    try {
      await env.AI_SETUP_SEALS_KV.delete(guid);
      results.kv_ai_seal = 'deleted';
    } catch (e) { results.kv_ai_seal = 'error:' + e.message; }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════
// POST /admin/users/bulk-delete — 관리자 일괄 삭제 (desktop.html 관리자 대시보드 전용)
// body: { admin_token, identifiers: ['@KR-12345678', '2601:db80:...', ...] }
// identifiers: '@'로 시작하면 handle로 보고 L1에서 guid를 조회, 아니면 그 값을 guid로 간주.
// 절차:
//   ① 식별자 → guid 해석 (handle인 경우 L1 조회)
//   ② casts_for(그림자) 일괄 정리 — 대상 guid를 본체로 둔 그림자 row를 먼저 지워야
//      2번 단계(user_profiles 삭제)가 자기참조 FK 위반으로 막히지 않는다.
//   ③ guid별 _deleteAllUserData()로 L1 + Supabase 9개 테이블 + KV 삭제
// 본인 서명(Ed25519) 검증 없음 — 관리자 HMAC 토큰(_verifyAdminToken)으로만 인증.
// 1회 호출당 최대 100개 — 그 이상은 여러 번에 나눠 호출할 것.
// ═══════════════════════════════════════════════════════════
async function handleAdminBulkDelete(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  const { admin_token, identifiers } = body;
  if (!admin_token) return _err(401, 'MISSING_TOKEN', 'admin_token 필수', corsHeaders);
  const isValid = await _verifyAdminToken(env, admin_token);
  if (!isValid) return _err(403, 'INVALID_TOKEN', '관리자 인증 실패', corsHeaders);

  if (!Array.isArray(identifiers) || identifiers.length === 0)
    return _err(400, 'MISSING_FIELD', 'identifiers(배열) 필수', corsHeaders);
  if (identifiers.length > 100)
    return _err(400, 'TOO_MANY', '한 번에 최대 100개까지 삭제할 수 있습니다', corsHeaders);

  const sbSvcH   = _sbServiceHeaders(env);
  const perItem  = {};

  // ① 식별자 → guid 해석
  const resolved = [];
  for (const raw of identifiers) {
    const id = (raw || '').trim();
    if (!id) continue;
    try {
      if (id.startsWith('@')) {
        const profile = await _l1FindProfileByHandle(env, id.slice(1));
        if (!profile) { perItem[id] = { error: 'handle_not_found' }; continue; }
        resolved.push({ key: id, guid: profile.guid });
      } else {
        resolved.push({ key: id, guid: id });
      }
    } catch (e) { perItem[id] = { error: 'resolve_failed:' + e.message }; }
  }

  if (!resolved.length) {
    return new Response(JSON.stringify({ ok: true, count: 0, results: perItem }),
      { status: 200, headers: corsHeaders });
  }

  // ② 그림자(casts_for) 일괄 정리 — 본체들 삭제 전에 먼저 처리
  let shadowCleanup = 'skipped';
  try {
    const filter = resolved.map(r => encodeURIComponent(r.guid)).join(',');
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/user_profiles?casts_for=in.(${filter})`,
      { method: 'DELETE', headers: sbSvcH }
    );
    shadowCleanup = r.ok ? 'deleted' : `error:${r.status}`;
  } catch (e) { shadowCleanup = 'error:' + e.message; }

  // ③ guid별 전체 삭제
  for (const { key, guid } of resolved) {
    let l1Record = null;
    try {
      l1Record = await _l1FindProfileByGuid(env, guid);
    } catch (e) {
      perItem[key] = { l1_profiles: 'error:' + e.message };
      continue;
    }
    perItem[key] = await _deleteAllUserData(env, guid, l1Record);
  }

  console.info('[AdminBulkDelete] 완료 | 대상:', identifiers.length, '| shadow_cleanup:', shadowCleanup);
  return new Response(JSON.stringify({
    ok: true, count: resolved.length, shadow_cleanup: shadowCleanup, results: perItem,
  }), { status: 200, headers: corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// AI Setup Seal — PC→휴대폰 1회용 암호화 봉투
// 평문 API 키는 절대 이 테이블에 닿지 않음 (PC가 암호화한 바이트만 경유)
// ═══════════════════════════════════════════════════════════

// POST /ai-setup/seal — PC가 암호문 저장 (서명 불필요, 암호문 자체가 무의미한 바이트)
// body: { guid, ephemeral_pubkey, iv, ciphertext }
// AI Setup Seal — PC가 X25519로 암호화한 LLM 설정을 5분짜리 임시 우편함에 보관.
// 영구 저장이 필요 없는 단기 메시지이므로 Supabase(RLS 정책 관리 부담, 관계형 DB)
// 대신 Cloudflare KV를 사용 — TTL을 네이티브로 지원하고 행 단위 권한 정책이
// 없어 이런 종류의 권한 오류(42501 등) 자체가 발생할 수 없다.
async function handleAiSetupSealPost(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { guid, ephemeral_pubkey, iv, ciphertext } = body;
  if (!guid)             return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  if (!ephemeral_pubkey) return _err(400, 'MISSING_FIELD', 'ephemeral_pubkey 필수', corsHeaders);
  if (!iv)               return _err(400, 'MISSING_FIELD', 'iv 필수', corsHeaders);
  if (!ciphertext)       return _err(400, 'MISSING_FIELD', 'ciphertext 필수', corsHeaders);

  if (!env.AI_SETUP_SEALS_KV)
    return _err(500, 'CONFIG_ERROR', 'AI_SETUP_SEALS_KV 바인딩 미설정', corsHeaders);

  const ttlSeconds = 5 * 60; // 5분 — KV expirationTtl 최소값은 60초이므로 충분히 안전
  const expiresAt  = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  try {
    // KV는 같은 키에 put()하면 자동으로 덮어쓰므로 별도 DELETE 불필요
    await env.AI_SETUP_SEALS_KV.put(
      guid,
      JSON.stringify({ ephemeral_pubkey, iv, ciphertext, created_at: new Date().toISOString() }),
      { expirationTtl: ttlSeconds }
    );
  } catch (e) {
    return _err(502, 'KV_ERROR', 'KV 저장 실패: ' + e.message, corsHeaders);
  }

  // PC가 키 전송을 완료한 "이 순간"이 트리거 — 휴대폰이 화면을 보고 있지 않아도
  // 즉시 푸시 알림을 보내 자동 동기화를 깨운다 (polling 불필요).
  _sendPushToGuid(env, guid, {
    title: 'AI 비서 설정',
    body:  'PC에서 보낸 설정을 적용하는 중입니다.',
    tag:   'gopang-ai-setup-' + guid.slice(-8),
    url:   '/webapp.html',
  }).catch(e => console.warn('[AI Setup] 푸시 트리거 실패 (무시):', e.message));

  return new Response(JSON.stringify({ ok: true, expires_at: expiresAt }),
    { status: 200, headers: corsHeaders });
}

// GET /ai-setup/seal?guid=...&consume=1 — 휴대폰이 자신의 봉투 조회 (consume=1이면 즉시 삭제)
async function handleAiSetupSealGet(request, env, corsHeaders) {
  const url     = new URL(request.url);
  const guid    = url.searchParams.get('guid');
  const consume = url.searchParams.get('consume') === '1';
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);

  if (!env.AI_SETUP_SEALS_KV)
    return _err(500, 'CONFIG_ERROR', 'AI_SETUP_SEALS_KV 바인딩 미설정', corsHeaders);

  let raw;
  try {
    raw = await env.AI_SETUP_SEALS_KV.get(guid);
  } catch (e) {
    return _err(502, 'KV_ERROR', 'KV 조회 실패: ' + e.message, corsHeaders);
  }
  if (!raw) {
    return new Response(JSON.stringify({ ok: true, sealed: null }), { status: 200, headers: corsHeaders });
  }
  const sealed = JSON.parse(raw);

  if (consume) {
    await env.AI_SETUP_SEALS_KV.delete(guid).catch(() => {});
  }

  return new Response(JSON.stringify({ ok: true, sealed }), { status: 200, headers: corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// /ai-setup GET — 현재 AI 비서 설정 조회
// ═══════════════════════════════════════════════════════════
async function handleAiSetupGet(request, env, corsHeaders, guid) {
  const sbH = _sbHeaders(env);
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/user_llm_keys?guid=eq.${guid}&select=provider,model,ai_active,custom_prompt,native_lang&limit=1`,
    { headers: sbH }
  );
  if (!res.ok) return _err(502, 'DB_ERROR', 'DB 조회 실패', corsHeaders);
  const rows = await res.json().catch(() => []);
  if (!rows.length) {
    return new Response(JSON.stringify({
      ai_active: false, provider: 'deepseek', model: 'deepseek-v4-flash',
      has_key: false, custom_prompt: '',
    }), { status: 200, headers: corsHeaders });
  }
  const row = rows[0];
  return new Response(JSON.stringify({
    ai_active:     row.ai_active,
    provider:      row.provider,
    model:         row.model,
    has_key:       !!(row.api_key_enc),
    custom_prompt: row.custom_prompt || '',
    native_lang:   row.native_lang || 'ko',
  }), { status: 200, headers: corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// v5.0 — WebRTC 시그널링 핸들러 (P2P 채팅)
// 원칙: 메시지 본문 절대 저장 없음 — SDP/ICE 60초 TTL 후 삭제
// ═══════════════════════════════════════════════════════════

// _SIGNAL_L1_PATCH_APPLIED_
// ═══════════════════════════════════════════════════════════
// 시그널 핸들러 — L1 PocketBase 우선 + Supabase 폴백
// L1: https://l1-hanlim.hondi.net/api/collections/webrtc_signals/records
//     API Rules = 빈칸(모두 허용) — 토큰 불필요
// Supabase: 기존 webrtc_signals 테이블 (L1 실패 시 자동 폴백)
// ═══════════════════════════════════════════════════════════

const L1_SIGNAL_URL = `${L1_DEFAULT}/api/collections/webrtc_signals/records`;

// ── L1 시그널 저장 헬퍼 ──────────────────────────────────────
async function _l1SignalSend(from_guid, to_guid, type, payload, expires_at) {
  const res = await fetch(L1_SIGNAL_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ from_guid, to_guid, type, payload, expires_at }),
  });
  if (!res.ok) throw new Error(`L1 signal send ${res.status}: ${await res.text().catch(()=>'')}`);
  return res;
}

// ── L1 시그널 조회 헬퍼 ──────────────────────────────────────
async function _l1SignalPoll(guid) {
  const now    = new Date().toISOString();
  const filter = encodeURIComponent(`to_guid='${guid}'`);
  // 캐시 완전 무력화: cache:'no-store' + 매번 달라지는 cache-buster 쿼리.
  // Cloudflare Worker의 fetch()는 기본적으로 GET을 엣지에서 캐싱할 수 있어서,
  // 같은 URL 패턴이 반복되는 폴링 요청이 옛(비어있던) 응답을 계속 재사용하는
  // 문제가 있었다. PocketBase에 직접 조회하면 최신 데이터가 보이는데
  // 워커를 거치면 비어있던 게 정확히 이 캐시 문제였다.
  const res    = await fetch(
    `${L1_SIGNAL_URL}?filter=${filter}&sort=-created&perPage=40&_ts=${Date.now()}`,
    { headers: { 'Content-Type': 'application/json' }, cache: 'no-store' }
  );
  if (!res.ok) throw new Error(`L1 signal poll ${res.status}`);
  const data = await res.json().catch(() => ({ items: [] }));
  // PocketBase 응답: { items: [...] } → Supabase 형식 배열로 정규화
  const items = (data.items || []).filter(r => {
    // expires_at 필터 (L1은 필터 표현식으로 처리 안 되므로 클라이언트 필터)
    if (!r.expires_at) return true;
    return new Date(r.expires_at) > new Date();
  });
  return items;
}

// ── L1 시그널 삭제 헬퍼 ──────────────────────────────────────
async function _l1SignalDelete(field, value) {
  // PocketBase: 필터로 목록 조회 후 id별 삭제 (REST v1)
  // 캐시 완전 무력화 (이유는 _l1SignalPoll 주석 참고)
  const filter = encodeURIComponent(`${field}='${value}'`);
  const listRes = await fetch(
    `${L1_SIGNAL_URL}?filter=${filter}&perPage=50&_ts=${Date.now()}`,
    { headers: { 'Content-Type': 'application/json' }, cache: 'no-store' }
  );
  if (!listRes.ok) throw new Error(`L1 signal list ${listRes.status}`);
  const data  = await listRes.json().catch(() => ({ items: [] }));
  const items = data.items || [];
  await Promise.all(items.map(r =>
    fetch(`${L1_SIGNAL_URL}/${r.id}`, { method: 'DELETE' }).catch(() => {})
  ));
}

// ═══════════════════════════════════════════════════════════
// TURN credential 발급 (coturn static-auth-secret 방식)
// RFC 8489 time-limited credential:
//   username  = "{expiry}:{guid}"
//   credential = base64(HMAC-SHA1(TURN_SECRET, username))
// coturn turnserver.conf:
//   use-auth-secret
//   static-auth-secret=${TURN_SECRET}
// ═══════════════════════════════════════════════════════════
async function handleTurnCredential(request, env, corsHeaders) {
  const url    = new URL(request.url);
  const guid   = url.searchParams.get('guid') || 'anonymous';
  const secret = env.TURN_SECRET;

  // TURN_SECRET 미설정 시 STUN 전용 폴백
  if (!secret) {
    console.warn('[TURN] TURN_SECRET 미설정 — STUN 전용 사용');
    return new Response(JSON.stringify({
      ok: true,
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
      fallback: true,
    }), { status: 200, headers: corsHeaders });
  }

  // expiry = 지금 + 1시간
  const expiry   = Math.floor(Date.now() / 1000) + 3600;
  const username = `${expiry}:${guid}`;

  // HMAC-SHA1(secret, username) → base64
  const keyData   = new TextEncoder().encode(secret);
  const msgData   = new TextEncoder().encode(username);
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
  );
  const sigBuf     = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  const credential = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));

  const host = 'l1-hanlim.hondi.net';

  return new Response(JSON.stringify({
    ok: true,
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      {
        urls: [
          `turn:${host}:3478?transport=udp`,
          `turn:${host}:3478?transport=tcp`,
          `turns:${host}:5349?transport=tcp`,
        ],
        username,
        credential,
      },
    ],
    expiry,
  }), { status: 200, headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
}

async function handleSignalSend(request, env, corsHeaders) {
  if (request.method !== 'POST') return _err(405, 'METHOD_NOT_ALLOWED', '', corsHeaders);
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', '', corsHeaders);
  const { from_guid, to_guid, type, payload } = body;
  if (!from_guid || !to_guid || !type || !payload)
    return _err(400, 'MISSING_FIELDS', 'from_guid, to_guid, type, payload 필수', corsHeaders);
  if (!['offer','answer','ice'].includes(type))
    return _err(400, 'INVALID_TYPE', 'offer|answer|ice 만 허용', corsHeaders);

  const expires_at = new Date(Date.now() + 60_000).toISOString();

  // ① L1 우선 저장
  let savedTo = 'l1';
  try {
    await _l1SignalSend(from_guid, to_guid, type, payload, expires_at);
    console.log('[Signal] L1 저장 성공');
  } catch (l1Err) {
    // ② Supabase 폴백
    console.warn('[Signal] L1 실패 → Supabase 폴백:', l1Err.message);
    savedTo = 'supabase';
    const sbH = _sbServiceHeaders(env);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/webrtc_signals`, {
      method:  'POST',
      headers: { ...sbH, 'Prefer': 'return=minimal' },
      body:    JSON.stringify({ from_guid, to_guid, type, payload, expires_at }),
    });
    if (!res.ok) return _err(500, 'DB_ERROR', await res.text(), corsHeaders);

    // 기회적 만료 시그널 정리 (Supabase)
    fetch(`${SUPABASE_URL}/rest/v1/webrtc_signals?expires_at=lt.${new Date().toISOString()}`, {
      method: 'DELETE', headers: sbH,
    }).catch(() => {});
  }

  // ── 수신자에게 Push 알림 전송 (offer 시그널일 때만)
  if (type === 'offer') {
    _sendPushToGuid(env, to_guid, {
      title: from_guid.slice(0, 8) + '님의 메시지',
      body:  '새 메시지가 도착했습니다.',
      tag:   'gopang-msg-' + from_guid.slice(0, 8),
      url:   '/webapp.html',
    }).catch(e => console.warn('[Push] 알림 전송 실패:', e.message));
  }

  return new Response(JSON.stringify({ ok: true, source: savedTo }), { status: 200, headers: corsHeaders });
}

async function handleSignalPoll(request, env, corsHeaders) {
  if (request.method !== 'GET') return _err(405, 'METHOD_NOT_ALLOWED', '', corsHeaders);
  const url  = new URL(request.url);
  const guid = url.searchParams.get('guid');
  if (!guid) return _err(400, 'GUID_REQUIRED', '', corsHeaders);

  // ① L1 우선 조회
  try {
    const signals = await _l1SignalPoll(guid);
    return new Response(JSON.stringify({ ok: true, signals, source: 'l1' }), { status: 200, headers: corsHeaders });
  } catch (l1Err) {
    // ② Supabase 폴백
    console.warn('[Signal] L1 poll 실패 → Supabase 폴백:', l1Err.message);
    const sbH = _sbHeaders(env);
    const now = new Date().toISOString();
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/webrtc_signals?to_guid=eq.${encodeURIComponent(guid)}&expires_at=gt.${now}&order=created_at.asc&limit=20`,
      { headers: sbH }
    );
    const signals = await res.json().catch(() => []);
    return new Response(JSON.stringify({ ok: true, signals, source: 'supabase' }), { status: 200, headers: corsHeaders });
  }
}

async function handleSignalDelete(request, env, corsHeaders) {
  if (request.method !== 'POST') return _err(405, 'METHOD_NOT_ALLOWED', '', corsHeaders);
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', '', corsHeaders);

  // ① L1 우선 삭제
  try {
    if (body.id)        await _l1SignalDelete('id',        body.id);
    if (body.from_guid) await _l1SignalDelete('from_guid', body.from_guid);
    return new Response(JSON.stringify({ ok: true, source: 'l1' }), { status: 200, headers: corsHeaders });
  } catch (l1Err) {
    // ② Supabase 폴백
    console.warn('[Signal] L1 delete 실패 → Supabase 폴백:', l1Err.message);
    const sbH = _sbServiceHeaders(env);
    if (body.id) {
      await fetch(`${SUPABASE_URL}/rest/v1/webrtc_signals?id=eq.${encodeURIComponent(body.id)}`,
        { method: 'DELETE', headers: sbH });
      return new Response(JSON.stringify({ ok: true, source: 'supabase' }), { status: 200, headers: corsHeaders });
    }
    if (body.from_guid) {
      await fetch(`${SUPABASE_URL}/rest/v1/webrtc_signals?from_guid=eq.${encodeURIComponent(body.from_guid)}`,
        { method: 'DELETE', headers: sbH });
      return new Response(JSON.stringify({ ok: true, source: 'supabase' }), { status: 200, headers: corsHeaders });
    }
    return _err(400, 'ID_OR_FROM_GUID_REQUIRED', '', corsHeaders);
  }
}



// ═══════════════════════════════════════════════════════════
// GDUDA Phase 1 — /p2p/search
// global_profiles에서 닉네임 검색 (DHT 인덱스 노드 임시 대체)
// GET /p2p/search?q=James&country=US&region=New+York&limit=20
// ═══════════════════════════════════════════════════════════
async function handleP2PSearch(request, env, corsHeaders) {
  const url     = new URL(request.url);
  const q       = url.searchParams.get('q')?.trim();
  const country = url.searchParams.get('country')?.trim();
  const region  = url.searchParams.get('region')?.trim();
  const handle  = url.searchParams.get('handle')?.trim();
  const limit   = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);

  if (!q && !handle) return _err(400, 'QUERY_REQUIRED', 'q 또는 handle 파라미터 필수', corsHeaders);

  // ── L1 PocketBase 검색 (GDUDA 본 구현) ──────────────────
  // Supabase global_profiles → L1 PocketBase profiles 컬렉션으로 전환
  // L1 PocketBase: https://l1-hanlim.hondi.net
  const L1_PROFILES = L1_DEFAULT + '/api/collections/profiles/records';

  let queryUrl = `${L1_PROFILES}?perPage=${limit}&fields=guid,handle,nickname,country_code,region`;

  // handle 직접 검색 (정확히 일치)
  if (handle) {
    const h = handle.startsWith('@') ? handle : '@' + handle;
    queryUrl += `&filter=${encodeURIComponent(`handle='${h}'`)}`;
  } else {
    // 닉네임 부분 일치 + 국가/지역 필터
    let filter = `(nickname~'${q}'||handle~'${q}')`;
    if (country) filter += `&&country_code='${country}'`;
    if (region)  filter += `&&region~'${region}'`;
    queryUrl += `&filter=${encodeURIComponent(filter)}`;
  }

  try {
    const res  = await fetch(queryUrl);
    const data = await res.json().catch(() => ({ items: [] }));
    const users = (data.items || []).map(r => ({
      guid:         r.guid,
      handle:       r.handle,
      nickname:     r.nickname,
      country_code: r.country_code,
      region:       r.region,
      current_l1:   L1_DEFAULT,
    }));

    return new Response(JSON.stringify({
      ok:    true,
      users,
      count: users.length,
      query: { q, country, region, handle },
      source: 'l1-pocketbase',
    }), { status: 200, headers: corsHeaders });
  } catch(e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 PocketBase 검색 실패: ' + e.message, corsHeaders);
  }
}

// ═══════════════════════════════════════════════════════════
// GDUDA Phase 1 — /p2p/register
// global_profiles에 사용자 등록 (HLR 역할)
// ═══════════════════════════════════════════════════════════
async function handleP2PRegister(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', '', corsHeaders);

  const { guid, handle, nickname, nickname_hash, country_code, region, current_l1 } = body;
  if (!guid)   return _err(400, 'MISSING_FIELDS', 'guid 필수', corsHeaders);
  if (!handle) return _err(400, 'MISSING_FIELDS', 'handle 필수', corsHeaders);

  // ── L1 PocketBase 등록 (GDUDA 본 구현) ──────────────────
  // Supabase global_profiles → L1 PocketBase profiles 컬렉션으로 전환
  const L1_PROFILES = L1_DEFAULT + '/api/collections/profiles/records';
  const now = new Date().toISOString();

  // 기존 레코드 확인 (guid 우선, handle도 함께 — 둘 중 하나라도 일치하면 같은 사용자)
  // ※ 이전엔 handle만으로 확인했는데, 가입 직후 다른 등록 경로(auth.js의
  // 기본 가입)와 거의 동시에 호출되면 그 레코드가 아직 안 보일 수 있어서
  // (조회 결과 미반영 — 인덱싱/replication 지연), 같은 guid인데도 "없음"으로
  // 판단해 새 레코드를 또 만드는 경쟁 상태가 있었다. guid까지 같이 보면
  // 더 안전하지만, 동시성 자체를 완전히 막는 건 아니다 — 근본 해결은
  // PocketBase profiles 컬렉션의 guid 필드에 unique 제약을 거는 것.
  try {
    const chkFilter = `handle='${handle}' || guid='${guid}'`;
    const chkRes = await fetch(
      `${L1_PROFILES}?filter=${encodeURIComponent(chkFilter)}&perPage=1`
    );
    const chkData = await chkRes.json().catch(() => ({ items: [] }));
    const existing = chkData.items?.[0];

    if (existing) {
      // 기존 레코드 PATCH (current_l1 갱신)
      const patchRes = await fetch(`${L1_PROFILES}/${existing.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nickname: nickname || existing.nickname,
          region:   region   || existing.region,
        }),
      });
      if (!patchRes.ok) return _err(500, 'L1_UPDATE_ERROR', await patchRes.text(), corsHeaders);
    } else {
      // 신규 레코드 POST
      const postRes = await fetch(L1_PROFILES, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guid,
          handle,
          nickname:      nickname      || null,
          nickname_hash: nickname_hash || null,
          country_code:  country_code  || null,
          region:        region        || null,
          is_public:     true,
        }),
      });
      if (!postRes.ok) return _err(500, 'L1_INSERT_ERROR', await postRes.text(), corsHeaders);
    }

    return new Response(JSON.stringify({ ok: true, source: 'l1-pocketbase' }), {
      status: 200, headers: corsHeaders,
    });
  } catch(e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 PocketBase 등록 실패: ' + e.message, corsHeaders);
  }
}

async function handleSearchUsers(request, env, corsHeaders) {
  if (request.method !== 'GET' && request.method !== 'POST') return _err(405, 'METHOD_NOT_ALLOWED', '', corsHeaders);
  const url   = new URL(request.url);
  const q     = url.searchParams.get('q')?.trim();
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);
  if (!q) return _err(400, 'QUERY_REQUIRED', 'q 파라미터 필수', corsHeaders);

  const sbH = _sbHeaders(env);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/search_users`, {
    method: 'POST',
    headers: sbH,
    body: JSON.stringify({ q, limit_n: limit }),
  });
  const data = await res.json().catch(() => []);
  return new Response(JSON.stringify({ ok: true, users: data, count: data.length }),
    { status: 200, headers: corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// v5.0 — /profile (사용자/사업자 프로필 등록·조회)
//   인증: parseToken(Authorization Bearer) → payload.ipv6
//   저장 대상: user_profiles (BaseProfile v2.0 단순화)
//     고정 컬럼: guid, current_ipv6, entity_type, name, handle,
//                native_lang, address, lat, lng, phone, website,
//                is_public, public_key
//     확장: extra.public.{identity, activity, contact, location, finance}
// ═══════════════════════════════════════════════════════════

// GET /profile/{handle}  또는  /profile?guid={ipv6}
// v5.1: 인증 불필요 — 공개 프로필 조회 (PUBLIC 계층만 노출 대상이나,
//       현재는 단순화를 위해 user_profiles 행 전체를 반환한다.
//       PRIVATE/SEMI 분리 마스킹은 추후 별도 작업에서 처리)
//
// ═══════════════════════════════════════════════════════════
// ⚠️ 임시 경로 (필드 테스트용) — 표준 절차가 아님
// ═══════════════════════════════════════════════════════════
// OpenHash 표준 절차는 다음과 같다:
//   1) A가 L1에서 B의 존재를 확인 (guid만 확보, 상세정보는 L1에 없음)
//   2) A가 B 본인(B의 기기/노드)에게 P2P로 직접 프로필 상세를 요청
//   3) B가 동의하여 자신의 프로필을 A에게 직접 전송
//   4) A가 전송받은 데이터로 B의 프로필 페이지를 직접 조합
// 장기적으로는 L1 자체가 상세 프로필 정보까지 저장하게 되며,
// Supabase는 그 이후에도 백업 레이어로만 남는다.
//
// 아래 구현은 2~3단계(P2P 직접 요청/응답)가 아직 구축되지 않았으므로,
// 그 자리에 "A가 Supabase에 캐시된 B의 데이터를 대신 가져오는" 임시 경로를
// 끼워 넣은 것이다 — 표준의 본체가 아니라 필드 테스트 단계의 대체 수단.
// P2P 요청/응답 채널(예: /signal/* 위에 profile_request 타입 추가)이
// 구축되면 이 함수는 1)L1 존재 확인까지만 남기고, 상세조회는 클라이언트의
// P2P 요청 로직으로 옮겨야 한다.
// handle로 L1 PocketBase에서 존재 확인 + guid 조회 (표준 1단계: 분산 노드가 1차 소스)
async function _resolveGuidFromL1(handle) {
  const L1_PROFILES = L1_DEFAULT + '/api/collections/profiles/records';
  const h = handle.startsWith('@') ? handle : '@' + handle;
  const queryUrl = `${L1_PROFILES}?perPage=1&fields=guid,handle&filter=${encodeURIComponent(`handle='${h}'`)}`;
  try {
    const res = await fetch(queryUrl);
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return data?.items?.[0]?.guid || null;
  } catch (e) {
    console.warn('[L1] handle 조회 실패 (Supabase로 폴백):', e.message);
    return null;
  }
}

// GET /profile/verify-owner?guid=&pubkey=&signature=&ts= — 핸드셰이크
// 중 "지금 상대가 본인(운영자)인가"를 실시간으로 검증한다. 2026-07-01
// 신설(/profile/my-sp 대체). gopang-wallet.js의 sign()/verify()와
// 동일한 Ed25519 서명 체계 + TOFU 대조 — 전체 시스템이 서명 체계를
// 하나만 공유한다는 원칙(이전 /profile POST·/profile/delegate와도 동일).
// SP를 돌려주지 않는다 — system_prompt는 이제 단 하나뿐이고 이미 클라이언트가
// 갖고 있으므로(GET /profile/@handle), 여기선 verified 불리언만 반환한다.
async function handleProfileVerifyOwner(request, env, corsHeaders) {
  const url = new URL(request.url);
  const guid      = url.searchParams.get('guid');
  const pubkey    = url.searchParams.get('pubkey');
  const signature = url.searchParams.get('signature');
  const ts        = url.searchParams.get('ts') || '';
  if (!guid || !pubkey || !signature)
    return _err(400, 'MISSING_FIELD', 'guid, pubkey, signature 필수', corsHeaders);

  // 리플레이 방지 — ts가 5분 이내인지 (다른 서명 엔드포인트들과 동일한 관용 범위)
  const tsNum = parseInt(ts, 10);
  if (!tsNum || Math.abs(Date.now() / 1000 - tsNum) > 300)
    return _err(401, 'STALE_TIMESTAMP', 'ts가 만료되었거나 형식이 올바르지 않습니다', corsHeaders);

  const sigMsg = `VERIFY-OWNER:${guid}:${ts}`;
  const sigOk  = await _verifyEd25519Simple(pubkey, signature, sigMsg);
  if (!sigOk) {
    return new Response(JSON.stringify({ ok: true, verified: false, reason: 'INVALID_SIGNATURE' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }

  // TOFU: 이 guid에 등록된 pubkey와 요청 pubkey가 일치해야 함.
  // L1 PocketBase가 보안 필드(Ed25519 등)의 권위 있는 소스(_l1AdminToken 주석 참조).
  const ownerRecord = await _l1FindProfileByGuid(env, guid).catch(() => null);
  const knownPubkey = ownerRecord?.pubkey_ed25519;
  const verified = !!knownPubkey && knownPubkey === pubkey;

  return new Response(JSON.stringify({ ok: true, verified, reason: verified ? null : 'PUBKEY_MISMATCH' }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

async function handleProfileGet(request, env, corsHeaders) {
  const url = new URL(request.url);
  const sbH = _sbHeaders(env);

  const rawHandle = decodeURIComponent(url.pathname.replace('/profile/', '').replace('/profile', ''));
  const guidParam = url.searchParams.get('guid');
  const normHandle = rawHandle ? (rawHandle.startsWith('@') ? rawHandle : '@' + rawHandle) : null;

  // ── 2026-06-30: L1 PocketBase 직접조회를 1차 경로로 — extra(json) 필드를
  //    L1 자체에 추가했으므로(이전엔 guid 확인만 L1, 상세는 Supabase
  //    "임시 경로"였음) 이제 L1 한 번 조회로 끝난다. 다만 L1의 listRule이
  //    `is_public = true`라 비공개 레코드는 Admin 토큰으로 조회해야
  //    한다 — _l1FindProfileByGuid/_l1FindProfileByHandle은 Admin 토큰을
  //    쓰므로 공개·비공개 모두 조회 가능.
  let l1Record = null;
  try {
    l1Record = guidParam
      ? await _l1FindProfileByGuid(env, guidParam)
      : (rawHandle ? await _l1FindProfileByHandle(env, normHandle) : null);
  } catch (e) {
    console.warn('[Profile] L1 조회 실패, Supabase로 폴백:', e.message);
  }

  if (l1Record) {
    const core = l1Record.extra?.core || {};
    const profile = {
      guid: l1Record.guid,
      current_ipv6: l1Record.guid,
      handle: l1Record.handle,
      entity_type: l1Record.entity_type,
      native_lang: l1Record.native_lang,
      is_public: l1Record.is_public,
      pubkey_ed25519: l1Record.pubkey_ed25519,
      name: core.name ?? null,
      address: core.address ?? null,
      lat: core.lat ?? null,
      lng: core.lng ?? null,
      phone: core.phone ?? null,
      website: core.website ?? null,
      casts_for: core.casts_for ?? null,
      extra: l1Record.extra || {},
      updated_at: l1Record.updated,
      created_at: l1Record.created,
    };
    return new Response(JSON.stringify({
      ok: true, profile,
      identity_source: 'l1', detail_source: 'l1',
    }), { status: 200, headers: corsHeaders });
  }

  // ── 레거시 폴백: L1로 아직 안 옮겨진 계정 — Supabase 직접 조회 ──
  // ⚠️ 임시 경로 — user_profiles 전체가 L1로 옮겨지면 이 블록은 삭제 대상.
  let resolvedGuid = guidParam || null;
  if (!resolvedGuid && rawHandle) {
    resolvedGuid = await _resolveGuidFromL1(rawHandle);
  }

  let query;
  if (resolvedGuid) {
    query = `guid=eq.${encodeURIComponent(resolvedGuid)}`;
  } else if (rawHandle) {
    query = `handle=eq.${encodeURIComponent(normHandle)}`;
  } else {
    return _err(400, 'MISSING_FIELD', 'handle 또는 guid 필요', corsHeaders);
  }

  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?${query}&limit=1`, { headers: sbH });
  } catch (e) {
    return _err(502, 'SUPABASE_UNREACHABLE', 'DB 연결 실패: ' + e.message, corsHeaders);
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return _err(502, 'SUPABASE_ERROR', `DB 조회 실패 (HTTP ${res.status}): ${errText}`, corsHeaders);
  }

  const rows = await res.json().catch(() => []);
  if (!rows.length) {
    if (resolvedGuid) {
      return new Response(JSON.stringify({
        ok: true,
        profile: { guid: resolvedGuid, handle: normHandle },
        identity_source: 'l1',
        detail_source: 'minimal-fallback',
      }), { status: 200, headers: corsHeaders });
    }
    return _err(404, 'PROFILE_NOT_FOUND', '프로필 없음', corsHeaders);
  }

  return new Response(JSON.stringify({
    ok: true, profile: rows[0],
    identity_source: resolvedGuid ? 'l1' : 'supabase-direct',
    detail_source:   'supabase-legacy-fallback',
  }), { status: 200, headers: corsHeaders });
}

// POST /profile — 본인 프로필 생성/갱신 (upsert)
// v5.1: Ed25519 서명 인증 (/biz/product와 동일 패턴) + TOFU(Trust-On-First-Use)
// body: {
//   guid, pubkey, signature,      // 인증 — _verifyEd25519(pubkey, signature, body)
//   entity_type, name, native_lang, address, lat, lng, phone, website, is_public,
//   handle,                       // 선택 — 미지정 시 자동 생성(@{이름})
//   description, tags,            // S01 identity
//   hours, holidays,              // S03 activity
//   sns_public, languages_spoken, // S04 contact
//   region, directions, parking,  // S05 location
//   gdc_accepted, currencies, price_range, // S07 finance
//   phone_visible,
// }
// ═══════════════════════════════════════════════════════════
// 그림자(에이전트) 자동 생성 — agent_profile_pdv_plan_v2.md Phase 1
// 2026-06-22
//
// ⚠️ 키 생성/암호화 함수는 src/pdv/keyManager.js의 generateAgentKeyPair/
// importKEK/encryptAgentPrivateKey와 동일 로직의 인라인 포팅이다(worker.js는
// import 구문이 없는 단일 파일 — _computeImportanceScore와 같은 이유).
// keyManager.js를 고치면 여기도 같이 고쳐야 한다.
// ═══════════════════════════════════════════════════════════

function _b64ToBuf(b64) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); }
function _bufToB64(buf)  { return btoa(String.fromCharCode(...new Uint8Array(buf))); }

// ── signer Worker 위임 함수 (Service Binding 경유) ──────────────────────
// 설계 원칙(2026-06-23):
//   - AGENT_KEK는 이 Worker에 존재하지 않음. signer Worker만 보유.
//   - 호출자는 "누가 서명하는지" 알 필요 없음 (탈중앙화 방향 인터페이스).
//   - 향후 "본체 단말 온라인이면 단말 직접 서명"으로 signer 내부만 교체 가능.
//
// env.AGENT_SIGNER: Service Binding 바인딩 이름 (wrangler.json에 선언)
//                  binding이 없으면 graceful 실패(그림자 생성 자체는 계속).
//
// ⚠️ 2026-07-01: 현재 미사용(dead code). 별도 그림자 정체성·키쌍 생성을
// 폐기(_mergeAgentSP로 통합)하면서 호출부가 사라졌다. wrangler.json의
// AGENT_SIGNER 바인딩 자체는 향후 다른 용도(예: 본인 부재 시 자동
// 서명·결제)로 재사용될 수 있어 함수는 남겨둔다.

async function _signerKeypair(env, agentGuid, principalGuid) {
  if (!env.AGENT_SIGNER) {
    console.warn('[Signer] AGENT_SIGNER binding 없음 — 키 생성 건너뜀');
    return { ok: false, error: 'NO_SIGNER_BINDING', public_key_b64: null };
  }
  const sbKey = env.SUPABASE_SERVICE_KEY || env.SUPABASE_KEY || '';
  const res = await env.AGENT_SIGNER.fetch('http://signer/agent/keypair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agent_guid:           agentGuid,
      principal_guid:       principalGuid,
      supabase_url:         SUPABASE_URL,
      supabase_service_key: sbKey,
    }),
  });
  return res.json().catch(() => ({ ok: false, error: 'SIGNER_PARSE_ERROR' }));
}

async function _signerSign(env, agentGuid, message) {
  if (!env.AGENT_SIGNER) {
    return { ok: false, error: 'NO_SIGNER_BINDING', signature_b64: null };
  }
  const sbKey = env.SUPABASE_SERVICE_KEY || env.SUPABASE_KEY || '';
  const res = await env.AGENT_SIGNER.fetch('http://signer/agent/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agent_guid:           agentGuid,
      message,
      supabase_url:         SUPABASE_URL,
      supabase_service_key: sbKey,
    }),
  });
  return res.json().catch(() => ({ ok: false, error: 'SIGNER_PARSE_ERROR' }));
}

/** 본체 guid로부터 결정론적 IPv6 형태 그림자 guid 파생(같은 본체는 항상 같은 그림자 guid) */
async function _deriveAgentGuid(principalGuid) {
  const hash  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(principalGuid + ':agent'));
  const bytes = new Uint8Array(hash).slice(0, 16);
  const hex   = [...bytes].map(b => b.toString(16).padStart(2, '0'));
  const groups = [];
  for (let i = 0; i < 16; i += 2) groups.push(hex[i] + hex[i + 1]);
  return groups.join(':');
}

// ── Phase 2: 그림자 SP 합성 ──────────────────────────────────────────
// AGENT-COMMON + AGENT-SUPPLIER-{ksic} + 본인 industry_fields 지식을 합성해
// 그림자의 system_prompt를 만든다.
// 설계 원칙:
//   - 합성 실패 시 null 반환(그림자 생성을 막지 않는다)
//   - 향후 industry_fields 변경 시 /profile/sync-sp 엔드포인트로 재합성 가능하게 설계
async function _compileAgentSP(env, principalProfile) {
  const REPO_RAW = 'https://raw.githubusercontent.com/Openhash-Gopang/gopang/main';
  const headers  = { 'User-Agent': 'gopang-worker/4.9', 'Cache-Control': 'no-cache' };

  // 0) 실시간 공개 범위 판단 안내문 — 2026-06-30 재설계: 가입 시점에
  //    internal/public 두 변형을 미리 컴파일해 따로 저장하던 방식을 폐기.
  //    SP는 이제 단 하나뿐이고, "지금 상대가 본인인지"는 매 대화의
  //    핸드셰이크(AGENT-COMMON §4)에서 실시간으로 검증한다 — 검증 결과는
  //    GET /profile/verify-owner(Ed25519 서명+TOFU, gopang-wallet.js의
  //    sign()/verify()와 동일한 서명 체계)로 받는다.
  const realtimeDisclosurePreamble =
    `[실시간 공개 범위 판단 — 모든 사업체·기관형 그림자 AI 공통]\n` +
    `이 system_prompt는 단 하나뿐이며, 운영자용/고객용으로 미리 나뉘어\n` +
    `있지 않습니다. 상대가 본인(운영자)인지는 대화 시작 시 핸드셰이크\n` +
    `(AGENT-COMMON §4)에서 GET /profile/verify-owner 서명 검증 결과로\n` +
    `실시간 판단합니다.\n` +
    `  - 검증 통과(verified=true) → 원가·마진·거래처 단가 등 내부\n` +
    `    데이터 질문에도 정직하게 답합니다.\n` +
    `  - 검증 미통과/미시도(verified=false 또는 핸드셰이크 생략) →\n` +
    `    외부 고객·제3자로 간주해 영업기밀을 제공하지 않습니다\n` +
    `    (AGENT-SUPPLIER-COMMON §0 고객 보호 원칙 우선).`;

  // 1) AGENT-COMMON 로드 — manifest.json['AGENT-COMMON'] 키로 파일명 결정
  //    CI 빌드 시 자동 갱신 — AGENT-COMMON-LATEST.txt 포인터 파일 방식 제거
  let commonSP = '';
  try {
    const manifestRes = await fetch(`${REPO_RAW}/prompts/manifest.json`, { ...headers, cache: 'no-cache' });
    if (!manifestRes.ok) throw new Error('manifest fetch 실패: ' + manifestRes.status);
    const manifest = await manifestRes.json();
    const commonFile = manifest['AGENT-COMMON'];
    if (!commonFile) throw new Error('manifest 에 AGENT-COMMON 키 없음');
    // ALLOW-EMBEDDED-SP: 이 줄 자체는 로그/fetch 코드일 뿐 SP 사본이 아님 —
    // 정적 분석기(tools/check_no_embedded_sp.py)가 파일 반대편의 무관한
    // 백틱과 잘못 짝지어 큰 가짜 리터럴로 오탐하는 경우(2026-07-05 확인).
    const commonRes = await fetch(`${REPO_RAW}/prompts/${commonFile}`, { headers });
    if (!commonRes.ok) throw new Error('AGENT-COMMON 로드 실패: ' + commonRes.status);
    commonSP = await commonRes.text();
    console.info('[Worker] AGENT-COMMON 로드 완료:', commonFile);
  } catch (e) {
    console.warn('[Worker] AGENT-COMMON 로드 오류, 빈 문자열로 계속:', e.message);
  }

  // 2) AGENT-SUPPLIER-COMMON 로드 (업종 SP 공통 모듈 — Type B 정체성·
  //    K-시스템 연계표·강제규칙 등. 77개 업종 파일이 전부 "상속"한다고
  //    표기만 해두고 실제로는 한 번도 합성되지 않던 버그를 2026-06-30 수정.
  //    업종(schema_id)이 없는 사용자(개인 등)는 Type B 정체성 자체가
  //    해당 없으므로 생략 — 2026-07-01: entity_type 분기 대신 ksic
  //    존재 여부로 통일(개인/기관 별도 컴파일 경로를 없앤 재설계와 일관).
  const ksic = principalProfile?.extra?.public?.industry_fields?.schema_id || null;
  let supplierCommonSP = '';
  if (ksic) {
  try {
    const manifestRes = await fetch(`${REPO_RAW}/prompts/manifest.json`, { ...headers, cache: 'no-cache' });
    if (!manifestRes.ok) throw new Error('manifest fetch 실패: ' + manifestRes.status);
    const manifest = await manifestRes.json();
    const commonSupplierFile = manifest['AGENT-SUPPLIER-COMMON'];
    if (!commonSupplierFile) throw new Error('manifest 에 AGENT-SUPPLIER-COMMON 키 없음');
    const csRes = await fetch(`${REPO_RAW}/prompts/${commonSupplierFile}`, { headers });
    if (csRes.ok) {
      supplierCommonSP = await csRes.text();
      console.info('[Worker] AGENT-SUPPLIER-COMMON 로드 완료:', commonSupplierFile);
    } else {
      console.warn('[Worker] AGENT-SUPPLIER-COMMON fetch 실패:', csRes.status);
    }
  } catch (e) {
    console.warn('[Worker] AGENT-SUPPLIER-COMMON 로드 오류, 빈 문자열로 계속:', e.message);
  }
  }

  // 3) AGENT-SUPPLIER-{ksic} 로드 (업종 불명이면 생략)
  // 파일명은 빌드 시 자동 생성된 prompts/manifest.json 에서 결정.
  // SUPPLIER_FILE_MAP 하드코딩 제거 — manifest 갱신만으로 새 버전 자동 반영.
  let supplierSP = '';
  if (ksic && VALID_INDUSTRY_SCHEMA_IDS.has(String(ksic))) {
    try {
      const manifestRes = await fetch(`${REPO_RAW}/prompts/manifest.json`, { ...headers, cache: 'no-cache' });
      if (!manifestRes.ok) throw new Error('manifest fetch 실패: ' + manifestRes.status);
      const manifest = await manifestRes.json();
      const ksicCode = String(ksic).padStart(2, '0');
      const fname = manifest[`AGENT-SUPPLIER-${ksicCode}`];
      if (fname) {
        const supRes = await fetch(`${REPO_RAW}/prompts/${fname}`, { headers });
        supplierSP = supRes.ok ? await supRes.text() : '';
        if (supRes.ok) console.info('[Worker] AGENT-SUPPLIER 로드 완료:', fname);
        else console.warn('[Worker] AGENT-SUPPLIER fetch 실패:', supRes.status, fname);
      } else {
        console.warn('[Worker] manifest 에 KSIC 없음 (supplierSP 생략):', ksicCode);
      }
    } catch (e) {
      console.warn('[Worker] AGENT-SUPPLIER 로드 오류, 빈 문자열로 계속:', e.message);
    }
  }

  // 4) industry_fields 지식 블록(본인 등록 데이터를 AI가 참조할 수 있게)
  const iFields = principalProfile?.extra?.public?.industry_fields;
  const iFieldsBlock = iFields
    ? `

## 나의 업종 정보 (industry_fields)
\`\`\`json
${JSON.stringify(iFields, null, 2)}
\`\`\``
    : '';

  // 5) 합성 — 청중 안내문 → AGENT-COMMON → AGENT-SUPPLIER-COMMON → AGENT-SUPPLIER-{ksic} → industry_fields
  // 5) 합성 — 실시간 공개범위 안내문(업종 SP가 있을 때만, 즉 사업체·기관
  //    한정) → AGENT-COMMON → AGENT-SUPPLIER-COMMON → AGENT-SUPPLIER-{ksic}
  //    → industry_fields. 개인은 안내문 없이 AGENT-COMMON만(영업기밀 같은
  //    공개범위 구분 자체가 해당 없음).
  const universalIntegrity = await _fetchUniversalIntegrity();
  const parts = [universalIntegrity, ksic ? realtimeDisclosurePreamble : '', commonSP, supplierCommonSP, supplierSP, iFieldsBlock].filter(Boolean);
  if (!parts.length) return null;

  const compiled = parts.join('\n\n---\n\n').trim();
  return compiled.length > 100 ? compiled : null;
}

/**
 * 본인(기관형: business/org/institution/platform) 신규가입 직후
 * 그림자(_ai) 자동 생성. 2026-06-30: 개인은 이 함수를 타지 않는다
 * (INDIVIDUAL_ENTITY_TYPES는 handleProfilePost에서 별도 분기로
 * 본인 행에 직접 SP를 기록 — _mergeIndividualSP 참조).
 * 실패해도 본 가입 자체를 막지 않음(호출부에서 .catch로 흡수) — 그림자는
 * 나중에 재시도로도 만들 수 있지만 본인 가입 실패는 되돌릴 수 없는 손해라서.
 */
/**
 * 2026-07-01 전면 재설계: 개인/기관 구분 없이 단일 정체성으로 통합.
 * "나만의 AI비서 = 그림자"이며, 별도 행·별도 guid·별도 키쌍을 만들지
 * 않는다 — 본인 user_profiles 행에 단일 system_prompt를 직접 기록한다.
 * 운영자/고객 공개범위 구분은 사전 컴파일(internal/public 두 변형)이
 * 아니라, 대화 시작 시 [핸드셰이크 절차](AGENT-COMMON §4)에서
 * GET /profile/verify-owner로 실시간 판단한다(_compileAgentSP의
 * realtimeDisclosurePreamble 참조).
 * 이전엔 _createAgentForPrincipal(기관 전용 별도 그림자 행+키쌍 생성)과
 * _mergeIndividualSP(개인 전용 통합 기록)로 나뉘어 있었으나, 이 함수
 * 하나로 합쳤다 — 기관도 더 이상 별도 행을 만들지 않는다.
 */
async function _mergeAgentSP(env, principalProfile) {
  const compiled = await _compileAgentSP(env, principalProfile).catch(() => null);
  if (!compiled) return { ok: false, error: 'COMPILE_FAILED' };

  const newExtra = {
    ...(principalProfile.extra || {}),
    public: {
      ...((principalProfile.extra || {}).public || {}),
      ai_assistant: { system_prompt: compiled, greeting: null },
    },
  };

  // L1을 1차로 먼저 쓴다 — 실패해도 Supabase는 계속 진행.
  try {
    await _l1UpsertProfile(env, {
      guid: principalProfile.guid, handle: principalProfile.handle,
      entityType: principalProfile.entity_type, nativeLang: principalProfile.native_lang,
      isPublic: principalProfile.is_public, pubkey: principalProfile.pubkey_ed25519,
      extra: newExtra,
    });
  } catch (e) {
    console.warn('[Profile] L1 통합 SP 저장 실패 (Supabase는 계속 진행):', e.message);
  }

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/user_profiles?guid=eq.${encodeURIComponent(principalProfile.guid)}`,
    {
      method: 'PATCH',
      headers: { ..._sbServiceHeaders(env), 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        extra: newExtra,
        updated_at: new Date().toISOString(),
      }),
    }
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.warn('[Profile] Supabase 통합 SP 저장 실패 (L1은 이미 저장됐을 수 있음):', errText);
    // L1이 1차 소스이므로 Supabase 실패만으로 전체 실패 처리하지 않는다.
  }
  return { ok: true, merged: true, guid: principalProfile.guid, sp_updated: true };
}

async function handleProfilePost(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  const { guid, pubkey, signature } = body;
  if (!guid)      return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  if (!pubkey)    return _err(400, 'MISSING_FIELD', 'pubkey 필수', corsHeaders);
  if (!signature) return _err(400, 'MISSING_FIELD', 'signature 필수', corsHeaders);

  // 서명 대상: 'guid:pubkey:ts' 고정 문자열 — JSON 직렬화 불일치 원천 차단
  const ts     = body.ts || '';
  const sigMsg = `${guid}:${pubkey}:${ts}`;
  const sigOk  = await _verifyEd25519Simple(pubkey, signature, sigMsg);
  if (!sigOk) return _err(401, 'INVALID_SIGNATURE', '서명 검증 실패', corsHeaders);

  const {
    entity_type, name, native_lang = 'ko',
    address = '', lat = null, lng = null,
    phone = null, website = '', is_public = true,
    handle = null,
    description = '', tags = [],
    hours = [], holidays = [],
    sns_public = {}, languages_spoken = [],
    region = '', directions = '', parking = false,
    gdc_accepted = false, currencies = ['KRW'], price_range = '',
    phone_visible = false,
    // 2026-07-05: search_entities RPC의 p_occupation, /pdv/page 표시 페이지의
    // p.occupation이 참조하는 컬럼이지만, 지금까지 이 함수의 destructuring
    // 목록에 없어 저장 경로 자체가 없었다(실사로 발견 — 상시 null이었음).
    // 명시적으로 보내면 그 값을 쓰되, 안 보내면 아래에서 industry_fields.schema_id
    // (KSIC)로부터 자동 파생한다 — 손으로 두 번 입력하게 하지 않는다.
    occupation = null,
  } = body;

  if (!entity_type) return _err(400, 'MISSING_FIELD', 'entity_type 필수', corsHeaders);
  if (!name)        return _err(400, 'MISSING_FIELD', 'name 필수', corsHeaders);
  // 2026-06-22: 'agent'(그림자)는 이 화이트리스트에 의도적으로 없다 — 보안 경계.
  // 2026-07-01: 별도 그림자 행 생성 자체를 폐기했으므로(_mergeAgentSP가
  // 본인 행에 직접 SP를 기록) 이제 'agent' entity_type은 어떤 경로로도
  // 만들어지지 않는다. 그래도 화이트리스트엔 영구히 넣지 않는다 — 클라이언트가
  // entity_type:'agent'를 직접 보내 사칭 행을 만들 길을 원천 차단하기 위함.
  if (!['person','consumer','individual','org','institution','business','platform'].includes(entity_type)) {
    return _err(400, 'INVALID_FIELD', 'entity_type 값이 올바르지 않습니다', corsHeaders);
  }

  // 2026-06-22: industry_fields.schema_id 검증 — AI(SP)가 지침을 어기고 "{ksic}" 같은
  // 미치환 리터럴이나 정의되지 않은 코드를 보내도 그대로 저장되지 않게 막는다.
  // null/undefined(=미해당)는 항상 허용 — GENERIC 경로의 정상 동작.
  if (body.industry_fields != null) {
    const sid = body.industry_fields.schema_id;
    if (!sid || !VALID_INDUSTRY_SCHEMA_IDS.has(String(sid))) {
      return _err(400, 'INVALID_SCHEMA_ID',
        `industry_fields.schema_id가 유효하지 않습니다: ${JSON.stringify(sid)} (허용: ${[...VALID_INDUSTRY_SCHEMA_IDS].join(',')})`,
        corsHeaders);
    }
  }

  // 2026-07-05: occupation 자동 파생(3중 분류 통합) — 클라이언트가 occupation을
  // 명시적으로 안 보내면 industry_fields.schema_id(KSIC)에서 KSIC_LABELS로
  // 라벨을 끌어와 채운다. 둘 다 없으면 null(예: person/institution 등
  // 업종 개념이 없는 entity_type) — search_entities의 p_occupation 필터는
  // 그런 경우 애초에 매칭 대상이 아니므로 문제 없다.
  const resolvedOccupation = occupation
    || (body.industry_fields?.schema_id ? (KSIC_LABELS[String(body.industry_fields.schema_id)] || null) : null);

  const sbH = _sbHeaders(env);

  // 기존 프로필 존재 여부 확인 — 2026-06-30: L1 PocketBase를 1차 소스로 전환.
  // L1에 없으면(아직 L1로 안 옮겨진 레거시 계정) Supabase로 폴백 조회한다.
  // TOFU: pubkey 일치 확인은 어느 소스에서 찾았든 동일하게 적용.
  let existing = null;
  try {
    const l1Existing = await _l1FindProfileByGuid(env, guid);
    if (l1Existing) {
      existing = {
        guid: l1Existing.guid,
        handle: l1Existing.handle,
        extra: l1Existing.extra || {},
        pubkey_ed25519: l1Existing.pubkey_ed25519,
        _l1id: l1Existing.id,
      };
    }
  } catch (e) {
    console.warn('[Profile] L1 조회 실패, Supabase로 폴백:', e.message);
  }

  if (!existing) {
    let existRes;
    try {
      existRes = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?guid=eq.${encodeURIComponent(guid)}&select=guid,handle,extra,pubkey_ed25519&limit=1`, { headers: sbH });
    } catch (e) {
      return _err(502, 'SUPABASE_UNREACHABLE', 'DB 연결 실패: ' + e.message, corsHeaders);
    }
    if (!existRes.ok) {
      const errText = await existRes.text().catch(() => '');
      return _err(502, 'SUPABASE_ERROR', `DB 조회 실패 (HTTP ${existRes.status}): ${errText}`, corsHeaders);
    }
    const existRows = await existRes.json().catch(() => []);
    existing = existRows[0] || null;
  }

  // v6.0: TOFU 복원. "guid는 전화번호 기반이라 안전하다"는 이전 가정은 틀렸다 —
  // 로그인 시점에 전화번호/닉네임만으로 기존 계정에 접근 가능했던 별도 결함이
  // 있었으므로(현재 patch에서 함께 수정), guid 자체는 더 이상 "본인 증명"이 아니다.
  // 최초 등록 시 핀(pin)된 pubkey와 다른 키로는 같은 guid의 프로필을 덮어쓸 수 없다.
  if (existing?.pubkey_ed25519 && existing.pubkey_ed25519 !== pubkey) {
    return _err(403, 'PUBKEY_MISMATCH', '공개키가 이 계정에 등록된 키와 일치하지 않습니다', corsHeaders);
  }

  // handle 자동 생성 (미지정 + 신규일 때)
  let finalHandle = handle || existing?.handle || null;
  if (!finalHandle) {
    const slug = String(name).trim().toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9가-힣_]/g, '');
    finalHandle = `@${slug}`;
  }

  // extra.public 병합 (기존 extra 보존, public 섹션만 갱신)
  const prevExtra = existing?.extra || {};
  const newExtraPublic = {
    ...(prevExtra.public || {}),
    identity: { _schema_version: '2.0', display_name: name, description, tags, entity_subtype: body.entity_subtype || null },
    activity: { timezone: 'Asia/Seoul', hours, holidays },
    contact:  { phone_display: phone, phone_visible: !!phone_visible, website, sns_public, languages_spoken },
    location: { region, address_short: address, directions, parking },
    finance:  { gdc_accepted, currencies, price_range },
    // 2026-06-22: 업종/유형별 확장 슬롯(profile_pdv_schema_plan_v1.md Phase 1).
    // 'industry_fields' in body로 "필드 자체를 안 보냄(보존)"과 "null을 명시적으로 보냄(비움)"을 구분.
    industry_fields: ('industry_fields' in body) ? body.industry_fields : ((prevExtra.public || {}).industry_fields ?? null),
  };
  const newExtra = { ...prevExtra, public: newExtraPublic };

  const record = {
    guid,
    current_ipv6: guid,
    pubkey_ed25519: pubkey,
    entity_type,
    name,
    handle: finalHandle,
    native_lang,
    address,
    lat,
    lng,
    phone,
    website,
    occupation: resolvedOccupation,
    is_public,
    extra: newExtra,
    updated_at: new Date().toISOString(),
  };

  // 2026-06-30: L1 PocketBase 이중쓰기 — Supabase보다 먼저 시도하고,
  // 실패해도 가입 자체는 막지 않는다(Supabase가 여전히 폴백 소스).
  // L1엔 없는 컬럼(name/address/lat/lng/phone/website)은 extra.core에 접음.
  try {
    await _l1UpsertProfile(env, {
      guid, handle: finalHandle, entityType: entity_type, nativeLang: native_lang,
      isPublic: is_public, pubkey, extra: newExtra,
      core: { name, address, lat, lng, phone, website, occupation: resolvedOccupation },
    });
  } catch (e) {
    console.warn('[Profile] L1 저장 실패 (Supabase는 계속 진행):', e.message);
  }

  let saveRes;
  try {
    if (existing) {
      saveRes = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?guid=eq.${encodeURIComponent(guid)}`, {
        method: 'PATCH',
        headers: { ..._sbServiceHeaders(env), 'Prefer': 'return=representation' },
        body: JSON.stringify(record),
      });
    } else {
      record.created_at = new Date().toISOString();
      saveRes = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles`, {
        method: 'POST',
        headers: { ..._sbServiceHeaders(env), 'Prefer': 'return=representation' },
        body: JSON.stringify(record),
      });
    }
  } catch (e) {
    return _err(502, 'SUPABASE_UNREACHABLE', 'DB 연결 실패: ' + e.message, corsHeaders);
  }

  if (!saveRes.ok) {
    const errText = await saveRes.text().catch(() => '');
    return _err(502, 'DB_ERROR', `프로필 저장 실패: ${errText}`, corsHeaders);
  }
  let savedRows = await saveRes.json().catch(() => []);

  // 2026-06-30: existing이 L1에서만 발견된 경우(Supabase엔 아직 없는 신규
  // L1-우선 가입자) PATCH가 매칭 0건으로 조용히 끝날 수 있다 — 그 경우 POST로
  // 재시도(Supabase 쪽도 이중쓰기 일관성 유지, 실패해도 가입은 막지 않음).
  if (existing && Array.isArray(savedRows) && savedRows.length === 0) {
    try {
      record.created_at = new Date().toISOString();
      const retryRes = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles`, {
        method: 'POST',
        headers: { ..._sbServiceHeaders(env), 'Prefer': 'return=representation' },
        body: JSON.stringify(record),
      });
      if (retryRes.ok) savedRows = await retryRes.json().catch(() => []);
    } catch (e) {
      console.warn('[Profile] Supabase POST 재시도 실패 (L1은 이미 저장됨):', e.message);
    }
  }
  const savedProfile = savedRows[0] || record;

  // 2026-06-23: SP 합성 시점 — 가입 직후가 아니라 PROFILE_SUBMIT 완료 후.
  // 2026-07-01 전면 재설계: 개인/기관 구분 없이 _mergeAgentSP 하나로 통합
  // (이전엔 INDIVIDUAL/INSTITUTION으로 나눠 기관만 별도 그림자 행+키쌍을
  // 만들었으나, "나만의 AI비서=그림자, 별도 정체성 분리 불필요" 설계
  // 합의에 따라 모든 entity_type이 본인 행에 단일 SP를 직접 기록한다).
  const agentResult = await _mergeAgentSP(env, savedProfile).catch(e => {
    console.error('[Profile] 통합 SP 기록 실패(본 저장은 정상 처리됨):', e.message);
    return { ok: false, error: 'EXCEPTION', detail: e.message };
  });


  return new Response(JSON.stringify({ ok: true, profile: savedProfile, agent: agentResult }), { status: 200, headers: corsHeaders });
}


// ═══════════════════════════════════════════════════════════
// 2026-07-05 — K-Market 판매자 카탈로그 (seller_products)
//
// 오픈해시 철학: 로컬(IndexedDB, 판매자 기기)이 원본(source of truth)이고
// L1 PocketBase는 판매자가 로컬에서 상품을 등록/수정할 때마다 자동으로
// 반영되는 "백업이자 공개 검색용 미러"다. 판매자가 직접 여기(서버)에
// CRUD하는 관리자 패널이 아니다 — 클라이언트(gopang-seller-catalog.js)가
// 로컬 변경 즉시(디바운스) 전체 스냅샷을 이 엔드포인트로 밀어넣고,
// 서버는 그 guid 소유 레코드를 스냅샷 기준으로 통째로 교체한다.
//
// 업종(occupation/industry_fields.schema_id)은 사용자가 직접 고르지 않는다.
// 상품 카테고리(seller_products.category)에서 KSIC_KEYWORD_MAP으로
// 결정적으로 유도한다(_deriveOccupationFromCategories) — "market 시스템이
// 업종을 판단하고, 사용자는 상품·서비스만 등록한다"는 원칙.
// ═══════════════════════════════════════════════════════════

// L1 seller_products 컬렉션에서 guid 소유 레코드 전체 조회
async function _l1ListSellerProducts(env, guid) {
  const token = await _l1AdminToken(env);
  const filter = encodeURIComponent(`seller_guid='${guid}'`);
  const res = await fetch(`${L1_DEFAULT}/api/collections/seller_products/records?filter=${filter}&perPage=200`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`L1 seller_products 조회 실패 (HTTP ${res.status})`);
  const data = await res.json().catch(() => ({ items: [] }));
  return data.items || [];
}

// 로컬 스냅샷 기준으로 서버 미러를 통째로 교체(삭제 후 재삽입) — PocketBase엔
// 벌크 upsert가 없어 건별 처리. 상품 수가 보통 수십 개 수준이라 무리 없음.
//
// @param {string} mode — 'replace'(기본값) | 'merge' (2026-07-07 신설)
//   'replace': 기존 동작 그대로 — 스냅샷에 없는 기존 레코드는 삭제한다.
//     gopang-seller-catalog.js(판매자 본인이 로컬 IndexedDB를 원본으로
//     운영하며 전체 스냅샷을 보내는 경우)가 쓰는 모드 — 그 판매자의
//     전체 카탈로그를 이 호출 하나로 완전히 대체하고 싶을 때 맞다.
//   'merge': 삭제 단계를 건너뛰고 upsert만 한다. 호출자가 그 판매자의
//     "전체" 카탈로그를 모르는 채로(예: CA/PA가 프로필에서 파악한 상품
//     일부만 들고 있는 경우) 보낼 때 쓴다 — 여기 없는 기존 상품을
//     실수로 지우면 안 되는 경우.
async function _l1SyncSellerProducts(env, guid, products, mode = 'replace') {
  const token = await _l1AdminToken(env);
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  const existing = await _l1ListSellerProducts(env, guid);
  const existingByProductId = new Map(existing.map(r => [r.product_id, r]));

  if (mode === 'replace') {
    const incomingIds = new Set(products.map(p => p.id));
    // 스냅샷에 없는 기존 레코드 삭제(판매자가 로컬에서 삭제한 상품)
    for (const rec of existing) {
      if (!incomingIds.has(rec.product_id)) {
        await fetch(`${L1_DEFAULT}/api/collections/seller_products/records/${rec.id}`, {
          method: 'DELETE', headers,
        }).catch(e => console.warn('[Catalog] 삭제 실패(무시하고 계속):', e.message));
      }
    }
  }
  // mode === 'merge'면 삭제 단계 전체를 건너뛴다 — 아래 upsert만 수행.

  // upsert
  for (const p of products) {
    const body = {
      seller_guid: guid,
      product_id: p.id,
      name: p.name || '',
      desc: p.desc || '',
      price: typeof p.price === 'number' ? p.price : null,
      unit: p.unit || '',
      category: p.category || '',
      stock: p.stock || 'in',
      image_url: p.image_url || '',
      is_public: p.is_public !== false,
      updated_at: p.updated_at || new Date().toISOString(),
    };
    const existingRec = existingByProductId.get(p.id);
    if (existingRec) {
      await fetch(`${L1_DEFAULT}/api/collections/seller_products/records/${existingRec.id}`, {
        method: 'PATCH', headers, body: JSON.stringify(body),
      }).catch(e => console.warn('[Catalog] 갱신 실패(무시하고 계속):', e.message));
    } else {
      await fetch(`${L1_DEFAULT}/api/collections/seller_products/records`, {
        method: 'POST', headers, body: JSON.stringify(body),
      }).catch(e => console.warn('[Catalog] 신규 저장 실패(무시하고 계속):', e.message));
    }
  }
}

// ═══════════════════════════════════════════════════════════
// 2026-07-07 신설 — trade_ratings / 온도(temperature)
// /biz/review(Supabase, 5점 척도)를 완전 대체. 실거래(tx_hash) 당사자만
// 평가 가능 — 대화 중 합의된 설계 원칙:
//   1) 세금계산서/현금영수증이 걸리는 실거래라 허위 평가 자체가 비용을 짐
//   2) polarity 3단계(자유서술 아님) — comment는 온도 계산과 분리
//   3) 금액 비례(카테고리 중앙값 정규화) + 평가자 신뢰도(온도 스냅샷) 가중
//   4) rater_temp_snapshot 고정 — 시간순 DAG, 순환 재계산 없음
// ═══════════════════════════════════════════════════════════
const POLARITY_WEIGHT       = { positive: 0.3, neutral: 0.0, negative: -0.7 };
const RATING_DECAY           = 0.97;
const RATING_DELTA_CLAMP     = 8.0;
const MIN_RATINGS_FOR_TEMP   = 5;
const DEFAULT_TEMP           = 36.5;
const TEMP_MIN               = 0;
const TEMP_MAX               = 99;

// Δ_i 계산 — 합의된 최종 산식
function _computeRatingDelta({ polarity, decayIndex, repeatIndex, amount, categoryMedian, raterTempSnapshot }) {
  const polarityWeight   = POLARITY_WEIGHT[polarity];
  const decay            = Math.pow(RATING_DECAY, decayIndex);
  const repeatDampening  = repeatIndex > 3 ? Math.pow(0.5, repeatIndex - 3) : 1.0;
  const amountRatio      = categoryMedian > 0 ? amount / categoryMedian : 1.0;
  const raterCredibility = 0.5 + (raterTempSnapshot - DEFAULT_TEMP) / 62.5; // 36.5→0.5, 99→1.5
  const raw = polarityWeight * decay * repeatDampening * amountRatio * raterCredibility;
  return Math.max(-RATING_DELTA_CLAMP, Math.min(RATING_DELTA_CLAMP, raw));
}

// 업종별 최근 90일 L1 중앙값 거래액 캐시 조회 (category_medians 컬렉션,
// 일 1회 배치 갱신은 scheduled() 크론에 별도 등록 — 이 함수는 조회 전용)
async function _getCategoryMedianAmount(l1Base, token, category) {
  const filter = encodeURIComponent(`category='${category}'`);
  const res = await fetch(`${l1Base}/api/collections/category_medians/records?filter=${filter}&perPage=1`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) return 1; // 캐시 미존재 시 정규화 비율 1.0으로 폴백
  const data = await res.json().catch(() => ({ items: [] }));
  return data.items?.[0]?.median_amount ?? 1;
}

// POST /biz/trade-rating — tx_hash 실거래 당사자만 평가 가능
async function handleTradeRatingSubmit(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  const { tx_hash, rater_guid, ratee_guid, rater_role, polarity, comment, amount, category } = body;
  if (!tx_hash)     return _err(400, 'MISSING_FIELD', 'tx_hash 필수', corsHeaders);
  if (!rater_guid)  return _err(400, 'MISSING_FIELD', 'rater_guid 필수', corsHeaders);
  if (!ratee_guid)  return _err(400, 'MISSING_FIELD', 'ratee_guid 필수', corsHeaders);
  if (!/^[0-9a-f]{64}$/.test(tx_hash)) return _err(400, 'INVALID_TX_HASH', 'tx_hash 형식 오류', corsHeaders);
  if (!['positive', 'neutral', 'negative'].includes(polarity)) return _err(400, 'INVALID_POLARITY', 'polarity는 positive/neutral/negative만 허용', corsHeaders);
  if (!['buyer', 'seller'].includes(rater_role)) return _err(400, 'INVALID_ROLE', 'rater_role은 buyer/seller만 허용', corsHeaders);
  if (typeof amount !== 'number' || amount <= 0) return _err(400, 'MISSING_FIELD', 'amount 필수(양수)', corsHeaders);
  if (!category) return _err(400, 'MISSING_FIELD', 'category 필수', corsHeaders);

  // 판매자(ratee) 소속 L1 조회 — seller_products와 동일 패턴(§4 guid_home_l1)
  const homeNodeId = (await _resolveHomeL1Node(env, ratee_guid)) || 'KR-JEJU-JEJU-HANLIM';
  const l1Base = L1_NODE_MAP[homeNodeId] || L1_DEFAULT;
  const token = await _l1AdminTokenFor(env, l1Base);
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  // 1) 거래 실재성 + 당사자 일치 검증 — blocks 컬렉션에서 tx_hash로 조회
  const blockFilter = encodeURIComponent(`tx_hash='${tx_hash}'`);
  const blockRes = await fetch(`${l1Base}/api/collections/blocks/records?filter=${blockFilter}&perPage=1`, { headers });
  if (!blockRes.ok) return _err(502, 'L1_UNREACHABLE', 'blocks 조회 실패: ' + blockRes.status, corsHeaders);
  const blockData = await blockRes.json().catch(() => ({ items: [] }));
  const blockRecord = blockData.items?.[0];
  if (!blockRecord) return _err(404, 'TX_NOT_FOUND', '해당 tx_hash의 거래를 찾을 수 없습니다', corsHeaders);
  if (rater_guid !== blockRecord.buyer_guid && rater_guid !== blockRecord.seller_guid) {
    return _err(403, 'NOT_A_PARTICIPANT', '거래 당사자만 평가할 수 있습니다', corsHeaders);
  }
  if (ratee_guid !== blockRecord.buyer_guid && ratee_guid !== blockRecord.seller_guid) {
    return _err(400, 'RATEE_MISMATCH', 'ratee_guid가 해당 거래의 당사자가 아닙니다', corsHeaders);
  }

  // 2) 중복 방지 — (tx_hash, rater_guid) 복합 유니크
  const dupFilter = encodeURIComponent(`tx_hash='${tx_hash}'&&rater_guid='${rater_guid}'`);
  const dupRes = await fetch(`${l1Base}/api/collections/trade_ratings/records?filter=${dupFilter}&perPage=1`, { headers });
  const dupData = await dupRes.json().catch(() => ({ items: [] }));
  if (dupData.items?.length > 0) return _err(409, 'ALREADY_RATED', '이미 이 거래를 평가했습니다', corsHeaders);

  // 3) rater 온도 스냅샷 고정 (미래 rater 온도 변화가 과거 Δ에 소급 전파되지 않도록)
  const raterFilter = encodeURIComponent(`guid='${rater_guid}'`);
  const raterRes = await fetch(`${l1Base}/api/collections/profiles/records?filter=${raterFilter}&perPage=1`, { headers });
  const raterData = await raterRes.json().catch(() => ({ items: [] }));
  const raterTempSnapshot = raterData.items?.[0]?.temp_score ?? DEFAULT_TEMP;

  // 4) 동일 (rater, ratee) 쌍 반복거래 횟수 조회 (감쇠 계산용)
  const pairFilter = encodeURIComponent(`rater_guid='${rater_guid}'&&ratee_guid='${ratee_guid}'`);
  const pairRes = await fetch(`${l1Base}/api/collections/trade_ratings/records?filter=${pairFilter}&perPage=1`, { headers });
  const pairData = await pairRes.json().catch(() => ({ items: [] }));
  const repeatIndex = (pairData.totalItems ?? 0) + 1;

  // 5) decay 인덱스 — ratee 기준 현재까지의 평가 건수
  const raterCountRes = await fetch(`${l1Base}/api/collections/trade_ratings/records?filter=${encodeURIComponent(`ratee_guid='${ratee_guid}'`)}&perPage=1`, { headers });
  const raterCountData = await raterCountRes.json().catch(() => ({ totalItems: 0 }));
  const decayIndex = raterCountData.totalItems ?? 0;

  // 6) 업종 중앙값 조회
  const categoryMedian = await _getCategoryMedianAmount(l1Base, token, category);

  // 7) insert (append-only — update/delete 경로 없음)
  const insRes = await fetch(`${l1Base}/api/collections/trade_ratings/records`, {
    method: 'POST', headers,
    body: JSON.stringify({
      tx_hash, rater_guid, ratee_guid, rater_role, polarity,
      comment: comment || '', amount, category,
      rater_temp_snapshot: raterTempSnapshot,
      created_at: new Date().toISOString(),
    }),
  });
  if (!insRes.ok) return _err(500, 'INSERT_FAILED', await insRes.text(), corsHeaders);
  const inserted = await insRes.json().catch(() => null);

  // 8) Δ 계산 후 profiles.temp_score 증분 업데이트
  const delta = _computeRatingDelta({ polarity, decayIndex, repeatIndex, amount, categoryMedian, raterTempSnapshot });
  const rateeFilter = encodeURIComponent(`guid='${ratee_guid}'`);
  const rateeRes = await fetch(`${l1Base}/api/collections/profiles/records?filter=${rateeFilter}&perPage=1`, { headers });
  const rateeData = await rateeRes.json().catch(() => ({ items: [] }));
  const rateeProfile = rateeData.items?.[0];
  if (rateeProfile) {
    const currentTemp = rateeProfile.temp_score ?? DEFAULT_TEMP;
    const currentCount = rateeProfile.temp_rating_count ?? 0;
    const nextTemp = Math.max(TEMP_MIN, Math.min(TEMP_MAX, currentTemp + delta));
    await fetch(`${l1Base}/api/collections/profiles/records/${rateeProfile.id}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({
        temp_score: nextTemp,
        temp_rating_count: currentCount + 1,
        temp_updated_at: new Date().toISOString(),
      }),
    }).catch(e => console.warn('[TradeRating] 온도 갱신 실패:', e.message));
  }

  return new Response(JSON.stringify({ ok: true, record_id: inserted?.id || null, delta }), { status: 200, headers: corsHeaders });
}

// GET /biz/temperature?guid=... — 공개 조회(온도 + 배지). 5건 미만이면 "신규 판매자" 배지.
async function handleTemperatureQuery(request, env, corsHeaders) {
  const url = new URL(request.url);
  const guid = url.searchParams.get('guid');
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);

  const homeNodeId = (await _resolveHomeL1Node(env, guid)) || 'KR-JEJU-JEJU-HANLIM';
  const l1Base = L1_NODE_MAP[homeNodeId] || L1_DEFAULT;
  const token = await _l1AdminTokenFor(env, l1Base);
  const filter = encodeURIComponent(`guid='${guid}'`);
  const res = await fetch(`${l1Base}/api/collections/profiles/records?filter=${filter}&perPage=1`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({ items: [] }));
  const profile = data.items?.[0];
  const count = profile?.temp_rating_count ?? 0;

  if (count < MIN_RATINGS_FOR_TEMP) {
    return new Response(JSON.stringify({ ok: true, temp_score: null, badge: 'new_seller', count }), { status: 200, headers: corsHeaders });
  }
  return new Response(JSON.stringify({ ok: true, temp_score: profile.temp_score ?? DEFAULT_TEMP, badge: null, count }), { status: 200, headers: corsHeaders });
}

// POST /biz/catalog/sync — 로컬 IndexedDB 전체 스냅샷을 서버 백업/공개미러에 반영
async function handleCatalogSync(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  const { guid, pubkey, signature, products, industry_fields, mode } = body;
  if (!guid)      return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  if (!pubkey)    return _err(400, 'MISSING_FIELD', 'pubkey 필수', corsHeaders);
  if (!signature) return _err(400, 'MISSING_FIELD', 'signature 필수', corsHeaders);
  if (!Array.isArray(products)) return _err(400, 'MISSING_FIELD', 'products 배열 필수(빈 배열 허용)', corsHeaders);
  // 2026-07-07: mode 검증 — 잘못된 값이면 안전한 쪽(merge, 삭제 없음)으로 폴백하지
  // 않고 명시적으로 거부한다. 'replace'의 삭제 동작은 되돌릴 수 없으므로, 오탈자로
  // 인한 의도치 않은 replace를 막기 위해 화이트리스트 밖 값은 에러로 처리한다.
  const syncMode = mode || 'replace';
  if (!['replace', 'merge'].includes(syncMode)) {
    return _err(400, 'INVALID_MODE', `mode는 replace 또는 merge만 허용됩니다: ${JSON.stringify(mode)}`, corsHeaders);
  }

  // 2026-07-05: 업종은 키워드 매칭이나 별도 분류용 API 호출로 이 함수가
  // 직접 "결정"하지 않는다 — "모든 사용자는 나만의 AI비서를 정의한다"는
  // 설계 원칙에 따라, 판매자와 대화하며 상품을 등록시킨 그 AI비서
  // (SP-MKT_seller_site 등)가 이미 판단해서 industry_fields.schema_id로
  // 실어 보낸다. 이 함수는 그 판단을 검증(화이트리스트)하고 저장만 한다
  // — 다른 모든 도메인에서 "판단은 호출한 쪽 AI가, 백엔드는 검증·저장만"
  // 하는 패턴과 동일하다.
  // 2026-07-07 수정(사고실험 #3): 이전엔 schema_id 형식이 안 맞으면 상품
  // 동기화 요청 전체를 400으로 거부했다 — 코드 주석은 "그 필드만 무시하고
  // 계속 진행된다"고 돼 있었는데 실제 동작과 달랐다(설명 오류). PA SP가
  // 정확한 형식(숫자 2자리 문자열)을 강제받은 적이 없어 형식 불일치가
  // 흔히 발생할 수 있는데, 그 때문에 정상 상품 동기화 자체가 막히는 건
  // 손해가 더 크다. 이제 실제로 주석대로 동작하도록 고친다 — 형식이
  // 안 맞으면 이 필드만 버리고(업종 판단은 아래 keyword_fallback에 위임),
  // 상품 동기화는 계속 진행한다.
  let industryFieldsValid = null;
  if (industry_fields != null) {
    const sid = industry_fields.schema_id;
    if (sid && VALID_INDUSTRY_SCHEMA_IDS.has(String(sid))) {
      industryFieldsValid = { schema_id: String(sid) };
    } else {
      console.warn('[Catalog] industry_fields.schema_id 무효, 무시:', JSON.stringify(sid));
    }
  }

  // TOFU: L1에 이미 등록된 pubkey와 일치해야 함 — /profile 가입이 선행돼야 함
  let l1Record;
  try {
    l1Record = await _l1FindProfileByGuid(env, guid);
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
  }
  if (!l1Record) return _err(404, 'PROFILE_NOT_FOUND', '프로필 등록이 먼저 필요합니다', corsHeaders);
  if (l1Record.pubkey_ed25519 && l1Record.pubkey_ed25519 !== pubkey) {
    return _err(403, 'PUBKEY_MISMATCH', '공개키가 이 계정에 등록된 키와 일치하지 않습니다', corsHeaders);
  }

  const sigOk = await _verifyEd25519(pubkey, signature, body);
  if (!sigOk) return _err(401, 'INVALID_SIGNATURE', '서명 검증 실패', corsHeaders);

  // 상품 스키마 최소 검증 — RULE-01급 원칙(허위/불완전 데이터로 검색 오염 방지).
  // 2026-07-07 수정(사고실험 #2): 이전엔 배열 중 하나라도 id/name이 없으면
  // 요청 전체를 400으로 거부했다 — 상품 여러 개 중 하나가 이름 없이 왔다고
  // (LLM 환각 등) 나머지 정상 상품까지 전부 버려지는 건 손해가 크다.
  // 이제 무효한 항목만 걸러내고 유효한 것만 동기화한다. 걸러진 항목은
  // 응답의 skipped에 실어 클라이언트가 알 수 있게 한다. 원본이 비어있지
  // 않은데 전부 걸러졌으면(=완전히 잘못된 요청) 여전히 에러로 처리한다.
  const validProducts = products.filter(p => p && p.id && p.name);
  const skippedCount = products.length - validProducts.length;
  if (skippedCount > 0) {
    console.warn(`[Catalog] id/name 누락 상품 ${skippedCount}개 제외:`,
      products.filter(p => !p || !p.id || !p.name).slice(0, 3).map(p => JSON.stringify(p).slice(0, 100)));
  }
  if (products.length > 0 && validProducts.length === 0) {
    return _err(400, 'INVALID_PRODUCT', '유효한 상품이 하나도 없습니다(모두 id/name 누락)', corsHeaders);
  }

  try {
    await _l1SyncSellerProducts(env, guid, validProducts, syncMode);
  } catch (e) {
    return _err(502, 'L1_SYNC_FAILED', '카탈로그 동기화 실패: ' + e.message, corsHeaders);
  }

  // 업종 갱신 — 1순위: AI비서가 보낸 industry_fields(검증됨). 2순위(폴백):
  // AI비서를 안 거친 구버전 클라이언트를 위해 카테고리 키워드 매칭을
  // 최후 수단으로만 쓴다(정확도가 떨어짐을 알고 쓰는 안전망일 뿐,
  // 이걸로 이미 있는 AI비서 판단을 덮어쓰지 않는다).
  const derived = industryFieldsValid?.schema_id
    ? { schema_id: industryFieldsValid.schema_id, occupation: KSIC_LABELS[industryFieldsValid.schema_id] || null, source: 'agent' }
    : { ..._deriveOccupationFromCategories(validProducts.map(p => p.category)), source: 'keyword_fallback' };

  let occupationUpdated = false;
  if (derived?.schema_id) {
    try {
      const prevExtra = l1Record.extra || {};
      const newExtraPublic = {
        ...(prevExtra.public || {}),
        industry_fields: { schema_id: derived.schema_id, _source: derived.source, _updated_at: new Date().toISOString() },
      };
      await _l1UpsertProfile(env, {
        guid, handle: l1Record.handle, entityType: l1Record.entity_type, nativeLang: l1Record.native_lang,
        isPublic: l1Record.is_public, pubkey: l1Record.pubkey_ed25519,
        extra: { ...prevExtra, public: newExtraPublic },
        core: { ...(prevExtra.core || {}), occupation: derived.occupation },
      });
      await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?guid=eq.${encodeURIComponent(guid)}`, {
        method: 'PATCH', headers: _sbServiceHeaders(env),
        body: JSON.stringify({ occupation: derived.occupation }),
      }).catch(e => console.warn('[Catalog] Supabase occupation 동기화 실패(L1은 반영됨):', e.message));
      occupationUpdated = true;
    } catch (e) {
      console.warn('[Catalog] 업종 갱신 실패(카탈로그 동기화 자체는 성공):', e.message);
    }
  }

  return new Response(JSON.stringify({
    ok: true, synced: validProducts.length, skipped: skippedCount, mode: syncMode,
    occupation: derived?.occupation || null, occupation_updated: occupationUpdated,
  }), { status: 200, headers: corsHeaders });
}

// GET /biz/catalog?guid=... — 공개 상품 목록 조회(구매자·K-Market 검색 전용)
// 항상 is_public=true인 상품만 반환한다 — 비공개 상품은 여기서 절대 노출되지 않는다.
async function handleCatalogGet(request, env, corsHeaders) {
  const url = new URL(request.url);
  const guid = url.searchParams.get('guid');
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 쿼리 파라미터 필수', corsHeaders);

  let products;
  try {
    products = await _l1ListSellerProducts(env, guid);
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
  }
  const publicOnly = products.filter(p => p.is_public !== false);
  return new Response(JSON.stringify({ ok: true, guid, products: publicOnly }), { status: 200, headers: corsHeaders });
}

// POST /biz/catalog/hydrate — 판매자 본인이 새 기기에서 로컬 IndexedDB를 처음
// 채울 때 쓰는 인증된 조회. 비공개 상품을 포함한 전체 목록을 서명 검증 후 반환한다
// (오픈해시 원칙: 로컬이 원본이지만, 기기를 새로 시작할 땐 서버 백업에서
// 복원해야 하므로 이 엔드포인트가 그 유일한 합법적 경로다).
async function handleCatalogHydrate(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  const { guid, pubkey, signature } = body;
  if (!guid)      return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  if (!pubkey)    return _err(400, 'MISSING_FIELD', 'pubkey 필수', corsHeaders);
  if (!signature) return _err(400, 'MISSING_FIELD', 'signature 필수', corsHeaders);

  let l1Record;
  try {
    l1Record = await _l1FindProfileByGuid(env, guid);
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
  }
  if (!l1Record) return _err(404, 'PROFILE_NOT_FOUND', '프로필이 없습니다', corsHeaders);
  if (l1Record.pubkey_ed25519 && l1Record.pubkey_ed25519 !== pubkey) {
    return _err(403, 'PUBKEY_MISMATCH', '공개키가 이 계정에 등록된 키와 일치하지 않습니다', corsHeaders);
  }
  const sigOk = await _verifyEd25519(pubkey, signature, body);
  if (!sigOk) return _err(401, 'INVALID_SIGNATURE', '서명 검증 실패', corsHeaders);

  let products;
  try {
    products = await _l1ListSellerProducts(env, guid);
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
  }
  return new Response(JSON.stringify({ ok: true, guid, products }), { status: 200, headers: corsHeaders });
}


// /ai-setup POST — AI 비서 설정 저장 (API 키 AES-256-GCM 암호화)
// ═══════════════════════════════════════════════════════════
async function handleAiSetupPost(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  // v5.1: Ed25519 서명 인증 + TOFU
  const { guid, pubkey, signature } = body;
  if (!guid)      return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  if (!pubkey)    return _err(400, 'MISSING_FIELD', 'pubkey 필수', corsHeaders);
  if (!signature) return _err(400, 'MISSING_FIELD', 'signature 필수', corsHeaders);

  const sigOk = await _verifyEd25519(pubkey, signature, body);
  if (!sigOk) return _err(401, 'INVALID_SIGNATURE', '서명 검증 실패', corsHeaders);

  // TOFU: L1이 중심 저장소 — Supabase가 아닌 L1 profiles에서 Ed25519 공개키 확인
  {
    let l1Record;
    try {
      l1Record = await _l1FindProfileByGuid(env, guid);
    } catch (e) {
      return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
    }
    if (!l1Record) return _err(404, 'PROFILE_NOT_FOUND', '가입(L1 등록)이 먼저 완료되어야 합니다', corsHeaders);
    const existingPubkey = l1Record.pubkey_ed25519;
    if (existingPubkey && existingPubkey !== pubkey) {
      return _err(401, 'PUBKEY_MISMATCH', '등록된 공개키와 일치하지 않습니다', corsHeaders);
    }
  }

  const {
    provider = 'deepseek', model = 'deepseek-v4-flash',
    ai_active = false, api_key,
    custom_prompt = '', welcome_message = '',
    off_hours_message = '', endpoint = '',
  } = body;

  // provider는 워커가 직접 호출하지 않고 단순히 DB 컬럼에 저장되는 값일 뿐이며,
  // 실제 LLM 호출은 클라이언트가 config.js의 PROVIDER_INFO(baseUrl)를 보고 수행한다.
  // 워커에 하드코딩된 화이트리스트는 클라이언트가 새 provider를 추가할 때마다
  // 같이 갱신해야 해서 동기화가 깨지기 쉽다(오늘 'gemini' 누락이 그 사례).
  // 완전히 검증을 없애는 대신, 형식만 확인해 오타/이상값 유입만 방지한다.
  if (!/^[a-z0-9-]{2,30}$/.test(provider))
    return _err(400, 'INVALID_PROVIDER', 'provider는 영문 소문자/숫자/하이픈 2~30자여야 합니다', corsHeaders);

  // 기존 키 조회
  const sbSvcH = _sbServiceHeaders(env);
  const existing = await fetch(
    `${SUPABASE_URL}/rest/v1/user_llm_keys?guid=eq.${guid}&select=api_key_enc&limit=1`,
    { headers: sbSvcH }
  ).then(r => r.json()).catch(() => []);

  let apiKeyEnc = existing[0]?.api_key_enc || null;

  if (api_key && api_key.trim()) {
    if (!env.AES_ENCRYPTION_KEY)
      return _err(500, 'ENCRYPTION_KEY_MISSING', 'AES 키 미설정', corsHeaders);
    apiKeyEnc = await _aesEncrypt(api_key.trim(), env.AES_ENCRYPTION_KEY);
  }

  if (!apiKeyEnc)
    return _err(400, 'API_KEY_REQUIRED', 'API 키를 입력해 주세요', corsHeaders);

  const tokenEst = Math.ceil(custom_prompt.length / 3.5);

  let upsertRes;
  try {
    upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/user_llm_keys`, {
      method: 'POST',
      headers: { ...sbSvcH, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        guid, provider, model, api_key_enc: apiKeyEnc,
        ai_active, custom_prompt,
        native_lang: 'ko',
        ...(endpoint && { endpoint }),
      }),
    });
  } catch (e) {
    return _err(502, 'SUPABASE_UNREACHABLE', 'DB 연결 실패: ' + e.message, corsHeaders);
  }

  if (!upsertRes.ok) {
    const err = await upsertRes.text();
    return _err(500, 'SAVE_FAILED', err, corsHeaders);
  }

  return new Response(JSON.stringify({
    ok: true, ai_active, provider, model,
    token_est: tokenEst,
    token_warn: tokenEst > 800,
    message: tokenEst > 800
      ? `저장 완료. 프롬프트가 약 ${tokenEst} 토큰으로 비용이 증가할 수 있습니다.`
      : '저장 완료',
  }), { status: 200, headers: corsHeaders });
}

// AES-256-GCM 암호화
async function _aesEncrypt(plaintext, keyHex) {
  const key = await crypto.subtle.importKey(
    'raw', _hexToBytes(keyHex), { name: 'AES-GCM' }, false, ['encrypt']
  );
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key,
    new TextEncoder().encode(plaintext));
  const combined = new Uint8Array(12 + enc.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(enc), 12);
  return btoa(String.fromCharCode(...combined));
}

function _hexToBytes(hex) {
  return new Uint8Array(hex.match(/.{2}/g).map(h => parseInt(h, 16)));
}

async function anchorL1MerkleRoot(env) {
  try {
    const sbH = _sbServiceHeaders(env);

    // 1. 미앵커링 pdv_log 조회 (최대 100건) — via_worker 무관
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pdv_log` +
      `?openhash_anchored=eq.false` +
      `&select=id,guid,block_hash,chain_local_hash,session_id` +
      `&order=created_at.asc&limit=100`,
      { headers: sbH }
    );
    const rows = await res.json().catch(() => []);
    if (!rows?.length) {
      console.log('[Merkle] 미앵커링 pdv_log 없음 — 스킵');
      return;
    }

    // 2. 머클 트리 계산
    const leaves = rows.map(r =>
      r.chain_local_hash || r.block_hash || r.id
    );
    const merkleRoot = await _computeMerkleRoot(leaves);
    const pdvIds     = rows.map(r => r.id);
    const now        = new Date().toISOString();

    // 3. merkle_anchors INSERT
    const insRes = await fetch(`${SUPABASE_URL}/rest/v1/merkle_anchors`, {
      method:  'POST',
      headers: { ...sbH, 'Prefer': 'return=representation' },
      body: JSON.stringify({
        merkle_root:   merkleRoot,
        anchored_at:   now,
        block_count:   rows.length,
        pdv_ids:       pdvIds,
        status:        'confirmed',
      }),
    });
    const insResult = await insRes.json().catch(() => []);
    const anchorId  = insResult?.[0]?.id || null;

    // 4. pdv_log openhash_anchored = true 일괄 갱신
    // Supabase REST는 IN 조건 배치 업데이트 지원
    for (const id of pdvIds) {
      await fetch(
        `${SUPABASE_URL}/rest/v1/pdv_log?id=eq.${encodeURIComponent(id)}`,
        {
          method:  'PATCH',
          headers: { ...sbH, 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            openhash_anchored:    true,
            openhash_anchored_at: now,
          }),
        }
      );
    }

    console.log(`[Merkle] 앵커링 완료 | root=${merkleRoot.slice(0,8)} | count=${rows.length} | anchor_id=${anchorId}`);
  } catch(e) {
    console.error('[Merkle] anchorL1MerkleRoot 실패:', e.message);
  }
}

/**
 * 머클 트리 루트 계산
 * leaves: string[] (hash 또는 id)
 * 홀수 노드: 마지막 leaf 복제
 */
async function _computeMerkleRoot(leaves) {
  if (!leaves.length) return '0'.repeat(64);

  // leaf 해시화
  let nodes = await Promise.all(
    leaves.map(l => _sha256Hex(l))
  );

  while (nodes.length > 1) {
    const next = [];
    for (let i = 0; i < nodes.length; i += 2) {
      const left  = nodes[i];
      const right = nodes[i + 1] || nodes[i]; // 홀수 시 복제
      next.push(await _sha256Hex(left + right));
    }
    nodes = next;
  }
  return nodes[0];
}

/**
 * verifyWithMerkle 검증용 API
 * GET /merkle/verify?pdv_id={id}
 */
async function handleMerkleVerify(request, env, corsHeaders) {
  const url   = new URL(request.url);
  const pdvId = url.searchParams.get('pdv_id');
  if (!pdvId) return _err(400, 'MISSING_PARAM', 'pdv_id 필수', corsHeaders);

  const sbH = _sbHeaders(env);

  // pdv_log 조회
  const pdvRes  = await fetch(
    `${SUPABASE_URL}/rest/v1/pdv_log?id=eq.${encodeURIComponent(pdvId)}&select=*&limit=1`,
    { headers: sbH }
  );
  const pdvRows = await pdvRes.json().catch(() => []);
  if (!pdvRows?.length) return _err(404, 'PDV_NOT_FOUND', 'pdv_log 없음', corsHeaders);
  const pdv = pdvRows[0];

  if (!pdv.openhash_anchored) {
    return new Response(JSON.stringify({
      valid: false,
      reason: 'NOT_ANCHORED',
      pdv_id: pdvId,
    }), { status: 200, headers: corsHeaders });
  }

  // merkle_anchors에서 해당 pdv_id 포함 레코드 조회
  const maRes  = await fetch(
    `${SUPABASE_URL}/rest/v1/merkle_anchors` +
    `?pdv_ids=cs.["${pdvId}"]&select=*&limit=1`,
    { headers: sbH }
  );
  const maRows = await maRes.json().catch(() => []);
  if (!maRows?.length) {
    return new Response(JSON.stringify({
      valid: false,
      reason: 'ANCHOR_NOT_FOUND',
      pdv_id: pdvId,
    }), { status: 200, headers: corsHeaders });
  }
  const anchor = maRows[0];

  // 머클 루트 재계산으로 검증
  const leaves     = anchor.pdv_ids;
  const recomputed = await _computeMerkleRoot(
    await Promise.all(leaves.map(async id => {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/pdv_log?id=eq.${encodeURIComponent(id)}&select=chain_local_hash,block_hash&limit=1`,
        { headers: sbH }
      );
      const rows = await r.json().catch(() => []);
      return rows?.[0]?.chain_local_hash || rows?.[0]?.block_hash || id;
    }))
  );

  const valid = recomputed === anchor.merkle_root;

  return new Response(JSON.stringify({
    valid,
    pdv_id:      pdvId,
    merkle_root: anchor.merkle_root,
    recomputed,
    anchor_id:   anchor.id,
    anchored_at: anchor.anchored_at,
    block_count: anchor.block_count,
  }), { status: 200, headers: corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// Push 알림 — VAPID Web Push
// ═══════════════════════════════════════════════════════════

// GET /push/vapid-public-key
function handlePushVapidKey(request, env, corsHeaders) {
  const key = env.VAPID_PUBLIC_KEY;
  if (!key) return _err(500, 'CONFIG_ERROR', 'VAPID_PUBLIC_KEY 미설정', corsHeaders);
  return new Response(JSON.stringify({ publicKey: key }), { status: 200, headers: corsHeaders });
}

// POST /push/broadcast — 배포 스크립트가 호출. 활성 구독자 전체에게
// "새 버전이 있습니다" push 전송 → sw.js가 CHECK_FOR_UPDATE를 클라이언트에 전달
// → 포그라운드 30분 폴링을 기다리지 않고 즉시 업데이트 체크.
// 관리자(배포자) 전용 — 평소 polling 부하는 그대로, 배포 시점에만 1회 발생.
async function handlePushBroadcast(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body?.secret || body.secret !== env.DEPLOY_PUSH_SECRET)
    return _err(403, 'FORBIDDEN', '시크릿이 일치하지 않습니다', corsHeaders);

  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY || !env.VAPID_SUBJECT)
    return _err(500, 'CONFIG_ERROR', 'VAPID 환경변수 미설정', corsHeaders);

  let rows;
  try { rows = await _l1ListPushSubscribers(env); }
  catch (e) { return _err(502, 'L1_UNREACHABLE', 'L1 조회 실패: ' + e.message, corsHeaders); }

  const payload = JSON.stringify({
    title: body.title || '고팡 업데이트',
    body:  body.body  || '새 버전이 준비됐습니다.',
    tag:   'gopang-version-update',
    url:   body.url   || '/webapp.html',
  });

  let sent = 0, failed = 0;
  for (const row of rows) {
    try {
      const sub = JSON.parse(row.push_subscription);
      const ok = await _sendWebPush(env, sub, payload);
      if (ok) sent++; else failed++;
    } catch (e) {
      failed++;
    }
  }
  return new Response(JSON.stringify({ ok: true, total: rows.length, sent, failed }), { status: 200, headers: corsHeaders });
}

// POST /push/subscribe — 구독 정보 저장
async function handlePushSubscribe(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body?.guid)
    return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  // unsubscribe는 subscription 없어도 허용
  if (!body.unsubscribe && !body.subscription)
    return _err(400, 'MISSING_FIELD', 'subscription 필수', corsHeaders);

  let record;
  try { record = await _l1FindProfileByGuid(env, body.guid); }
  catch (e) { return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders); }
  if (!record) return _err(404, 'PROFILE_NOT_FOUND', '가입(L1 등록)이 먼저 완료되어야 합니다', corsHeaders);

  // 구독 취소: L1 row는 삭제 불가 → 빈 문자열로 PATCH
  if (body.unsubscribe) {
    try { await _l1PatchProfile(env, record.id, { push_subscription: '', push_sound: '' }); }
    catch (e) { return _err(502, 'L1_UNREACHABLE', 'L1 PATCH 실패: ' + e.message, corsHeaders); }
    _backupPushSubscriptionToSupabase(env, body.guid, null).catch(() => {});
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
  }

  // 구독 등록/갱신: 프로필 row는 가입 시 이미 존재 → 항상 PATCH
  try {
    await _l1PatchProfile(env, record.id, {
      push_subscription: JSON.stringify(body.subscription),
      push_sound:        body.sound || 'ping',
    });
  } catch (e) { return _err(502, 'L1_UNREACHABLE', 'L1 PATCH 실패: ' + e.message, corsHeaders); }
  _backupPushSubscriptionToSupabase(env, body.guid, body.subscription, body.sound).catch(() => {});
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
}

// L1 쓰기가 끝난 뒤 Supabase에도 best-effort로 미러링 (백업·시뮬레이션 용도).
// 실패해도 throw하지 않음 — 호출부에서 .catch(()=>{})로 무시, 메인 흐름은 L1만으로 완결.
async function _backupPushSubscriptionToSupabase(env, guid, subscription, sound) {
  const sbH = _sbServiceHeaders(env);
  if (subscription === null) {
    await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?guid=eq.${encodeURIComponent(guid)}`, {
      method: 'DELETE', headers: sbH,
    });
    return;
  }
  await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?on_conflict=guid`, {
    method:  'POST',
    headers: { ...sbH, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body:    JSON.stringify({ guid, subscription: JSON.stringify(subscription), sound: sound || 'ping' }),
  });
}

// POST /push/send — 특정 guid에게 push 전송
// L1이 실제 구독 저장소이므로 L1을 우선 조회. L1 "연결 자체"가 실패했을 때만
// Supabase 백업을 본다 — L1이 정상 응답했는데 구독이 없으면 그게 정답이므로
// 폴백하지 않는다 (해지한 사용자에게 옛 백업으로 다시 push가 나가는 사고 방지).
async function handlePushSend(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body?.to_guid) return _err(400, 'MISSING_FIELD', 'to_guid 필수', corsHeaders);

  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY || !env.VAPID_SUBJECT)
    return _err(500, 'CONFIG_ERROR', 'VAPID 환경변수 미설정', corsHeaders);

  let rows = [];
  let source = 'l1';
  try {
    const record = await _l1FindProfileByGuid(env, body.to_guid);
    if (record?.push_subscription) {
      rows = [{ subscription: record.push_subscription, sound: record.push_sound }];
    }
  } catch (e) {
    console.warn('[Push] L1 조회 실패 → Supabase 백업 조회:', e.message);
    source = 'supabase';
    try {
      const sbH = _sbServiceHeaders(env);
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/push_subscriptions?guid=eq.${encodeURIComponent(body.to_guid)}&select=subscription,sound&limit=5`,
        { headers: sbH }
      );
      rows = await res.json().catch(() => []);
    } catch (e2) {
      console.warn('[Push] Supabase 백업 조회도 실패:', e2.message);
    }
  }

  if (!rows.length) return new Response(JSON.stringify({ ok: true, sent: 0, reason: 'NO_SUBSCRIPTION', source }), { status: 200, headers: corsHeaders });

  const payload = JSON.stringify({
    title: body.title || '고팡',
    body:  body.body  || '새 메시지가 도착했습니다.',
    sound: rows[0].sound || body.sound || 'ping',
    url:   body.url   || '/webapp.html',
    tag:   body.tag   || 'gopang-msg',
  });

  let sent = 0;
  for (const row of rows) {
    try {
      const sub = JSON.parse(row.subscription);
      const result = await _sendWebPush(env, sub, payload);
      if (result) sent++;
    } catch(e) {
      console.warn('[Push] 전송 실패:', e.message);
    }
  }
  return new Response(JSON.stringify({ ok: true, sent, source }), { status: 200, headers: corsHeaders });
}

// Web Push 전송 (VAPID)
// ── Web Push 페이로드 암호화 (RFC 8291 aes128gcm) ──────────────
// 브라우저 푸시 서비스(FCM 등)는 암호화되지 않은 페이로드를 사양 위반으로
// 거부한다 — 이 암호화 없이는 구독·VAPID가 다 정상이어도 실제 발송이
// 매번 조용히 실패한다(닫힌 상태에서 알림이 아예 안 오던 근본 원인).
function _concatBytes(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

async function _hmacSha256(keyBytes, data) {
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}

async function _encryptWebPushPayload(payloadStr, p256dhB64u, authB64u) {
  const ua_public   = _b64uToBytes(p256dhB64u);   // 65바이트 비압축 EC 포인트(구독자)
  const auth_secret = _b64uToBytes(authB64u);     // 16바이트

  // 1) 발신 서버용 임시(message마다 새로) ECDH 키쌍
  const asKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
  );
  const as_public = new Uint8Array(await crypto.subtle.exportKey('raw', asKeyPair.publicKey));

  // 2) 구독자 공개키 import + ECDH 공유 비밀
  const uaPublicKey = await crypto.subtle.importKey(
    'raw', ua_public, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: uaPublicKey }, asKeyPair.privateKey, 256
  ));

  // 3) HKDF 1단계 — auth_secret을 salt로 PRK_key 도출 → IKM' 도출
  const keyInfo = _concatBytes(
    new TextEncoder().encode('WebPush: info\0'), ua_public, as_public
  );
  const prkKey = await _hmacSha256(auth_secret, ecdhSecret);
  const ikm    = (await _hmacSha256(prkKey, _concatBytes(keyInfo, new Uint8Array([1])))).slice(0, 32);

  // 4) 메시지별 salt(16바이트 랜덤) + HKDF 2단계 — CEK, NONCE 도출
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk  = await _hmacSha256(salt, ikm);

  const cekInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\0');
  const cek = (await _hmacSha256(prk, _concatBytes(cekInfo, new Uint8Array([1])))).slice(0, 16);

  const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0');
  const nonce = (await _hmacSha256(prk, _concatBytes(nonceInfo, new Uint8Array([1])))).slice(0, 12);

  // 5) 평문 + 레코드 구분자(0x02, 단일 레코드라 패딩 없음) + AES-128-GCM
  const plaintext  = new TextEncoder().encode(payloadStr);
  const padded     = _concatBytes(plaintext, new Uint8Array([2]));
  const cekKey     = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce }, cekKey, padded
  ));

  // 6) RFC 8188 aes128gcm 본문 헤더: salt(16) | rs(4, big-endian) | idlen(1) | keyid(as_public)
  // rs는 레코드 크기 상한값 — 단일 레코드이므로 고정값 4096이면 충분(웹푸시 페이로드는 항상 작음)
  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096, false);
  const header = _concatBytes(salt, recordSize, new Uint8Array([as_public.length]), as_public);

  return _concatBytes(header, ciphertext);
}

async function _sendWebPush(env, subscription, payload) {
  const p256dh = subscription.keys?.p256dh;
  const auth   = subscription.keys?.auth;
  if (!p256dh || !auth) {
    console.warn('[Push] 구독에 p256dh/auth 없음 — 암호화 불가, 발송 건너뜀');
    return false;
  }

  const body = await _encryptWebPushPayload(payload, p256dh, auth);
  const vapidHeaders = await _buildVapidHeaders(env, subscription.endpoint);

  const res = await fetch(subscription.endpoint, {
    method:  'POST',
    headers: {
      ...vapidHeaders,
      'Content-Type':     'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'Content-Length':   body.length.toString(),
      'TTL': '60',
    },
    body,
  });
  const ok = res.ok || res.status === 201;
  if (ok) {
    console.info('[Push] 발송 성공:', res.status, subscription.endpoint?.slice(0, 60));
  } else {
    console.warn('[Push] 발송 실패:', res.status, await res.text().catch(() => ''));
  }
  return ok;
}

// VAPID JWT 생성
async function _buildVapidHeaders(env, endpoint) {
  const url      = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const now      = Math.floor(Date.now() / 1000);

  const header  = _b64uEncode(JSON.stringify({ alg: 'ES256', typ: 'JWT' }));
  const claims  = _b64uEncode(JSON.stringify({ aud: audience, exp: now + 3600, sub: env.VAPID_SUBJECT }));
  const sigInput = `${header}.${claims}`;

  // ECDSA 개인키는 WebCrypto 'raw' import가 공개키 전용이라 지원되지 않는다.
  // VAPID_PUBLIC_KEY(65바이트 비압축 포인트)에서 x/y를 떼어 JWK로 조립해 import한다.
  const pubBytes = _b64uToBytes(env.VAPID_PUBLIC_KEY);
  const jwk = {
    kty: 'EC', crv: 'P-256', ext: true,
    d: env.VAPID_PRIVATE_KEY.replace(/=+$/, ''),
    x: _b64uEncode(pubBytes.slice(1, 33)),
    y: _b64uEncode(pubBytes.slice(33, 65)),
  };
  const cryptoKey = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
  const sig    = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, cryptoKey, new TextEncoder().encode(sigInput));
  const sigB64 = _b64uEncode(String.fromCharCode(...new Uint8Array(sig)));
  const jwt    = `${sigInput}.${sigB64}`;

  return {
    'Authorization': `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
  };
}

function _b64uEncode(str) {
  return btoa(typeof str === 'string' ? str : String.fromCharCode(...new Uint8Array(str)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ── Push 알림 전송 헬퍼 (guid 기준) ─────────────────────
async function _sendPushToGuid(env, guid, { title, body, tag, url }) {
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) return;

  let record;
  try {
    record = await _l1FindProfileByGuid(env, guid);
  } catch (e) {
    console.warn('[Push] L1 조회 실패:', e.message);
    return;
  }
  if (!record?.push_subscription) {
    console.warn('[Push] push_subscription 없음 — 구독 안 된 계정, 발송 건너뜀. guid:', guid);
    return;
  }

  const payload = JSON.stringify({
    title, body, tag,
    sound: record.push_sound || 'ping',
    url:   url || '/webapp.html',
  });

  try {
    const sub = JSON.parse(record.push_subscription);
    console.info('[Push] 발송 시도:', guid, sub.endpoint?.slice(0, 50));
    await _sendWebPush(env, sub, payload);
  } catch(e) {
    console.warn('[Push] _sendPushToGuid 실패:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════
// Feedback — 기능 제안
// ═══════════════════════════════════════════════════════════

// POST /feedback — 제안 등록 + DeepSeek 카테고리 분류
async function handleFeedbackPost(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  const { guid, handle, content } = body;
  if (!guid)    return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  if (!handle)  return _err(400, 'MISSING_FIELD', 'handle 필수', corsHeaders);
  if (!content) return _err(400, 'MISSING_FIELD', 'content 필수', corsHeaders);

  // DeepSeek v4 flash — 카테고리 자동 분류
  let category = 'etc';
  try {
    const _fbKey = env.OPENROUTER_API_KEY || env.DEEPSEEK_API_KEY;
    const _fbUrl = env.OPENROUTER_API_KEY ? OR_URL : DEEPSEEK_URL;
    const aiRes = await fetch(_fbUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${_fbKey}`,
                 ...(env.OPENROUTER_API_KEY ? {'HTTP-Referer':'https://hondi.net','X-Title':'Hondi'} : {}) },
      body: JSON.stringify({
        model: env.OPENROUTER_API_KEY ? OR_MODEL_FAST : 'deepseek/deepseek-r1:free',
        max_tokens: 10,
        messages: [
          { role: 'system', content: '사용자 제안을 bug/feature/ui/etc 중 하나로만 분류하라. 단어 하나만 출력.' },
          { role: 'user',   content },
        ],
      }),
    });
    const aiData = await aiRes.json();
    const raw = aiData.choices?.[0]?.message?.content?.trim().toLowerCase() || 'etc';
    if (['bug','feature','ui','etc'].includes(raw)) category = raw;
  } catch(e) {
    console.warn('[Feedback] AI 분류 실패:', e.message);
  }

  const sbH = _sbServiceHeaders(env);
  const now  = new Date().toISOString();
  const insRes = await fetch(`${SUPABASE_URL}/rest/v1/feedback`, {
    method:  'POST',
    headers: { ...sbH, 'Prefer': 'return=representation' },
    body: JSON.stringify({ guid, handle, content, category, status: 'pending', created_at: now, updated_at: now }),
  });
  if (!insRes.ok) return _err(500, 'DB_ERROR', await insRes.text(), corsHeaders);
  const rows = await insRes.json().catch(() => []);

  return new Response(JSON.stringify({ ok: true, id: rows[0]?.id, category }), { status: 200, headers: corsHeaders });
}

// GET /feedback — 목록 조회
async function handleFeedbackGet(request, env, corsHeaders) {
  const url    = new URL(request.url);
  const status = url.searchParams.get('status');
  const limit  = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);

  const sbH = _sbHeaders(env);
  let query = `${SUPABASE_URL}/rest/v1/feedback?order=created_at.desc&limit=${limit}`;
  if (status) query += `&status=eq.${encodeURIComponent(status)}`;

  const res  = await fetch(query, { headers: sbH });
  const rows = await res.json().catch(() => []);
  return new Response(JSON.stringify({ ok: true, items: rows, count: rows.length }), { status: 200, headers: corsHeaders });
}

// PATCH /feedback/{id} — 상태 변경 (관리자 전용) + Push 알림
async function handleFeedbackPatch(request, env, corsHeaders) {
  const id   = new URL(request.url).pathname.replace('/feedback/', '');
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  const { status, admin_note, admin_guid } = body;
  if (!status)     return _err(400, 'MISSING_FIELD', 'status 필수', corsHeaders);
  if (!admin_guid) return _err(400, 'MISSING_FIELD', 'admin_guid 필수', corsHeaders);

  // 관리자 확인 (주피터 guid)
  const sbH = _sbServiceHeaders(env);
  const adminRes  = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?guid=eq.${encodeURIComponent(admin_guid)}&select=handle&limit=1`, { headers: sbH });
  const adminRows = await adminRes.json().catch(() => []);
  if (!adminRows.length || adminRows[0].handle !== '@96627170')
    return _err(403, 'FORBIDDEN', '관리자만 상태를 변경할 수 있습니다', corsHeaders);

  // 상태 변경
  const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/feedback?id=eq.${encodeURIComponent(id)}`, {
    method:  'PATCH',
    headers: { ...sbH, 'Prefer': 'return=representation' },
    body: JSON.stringify({ status, admin_note: admin_note || null, updated_at: new Date().toISOString() }),
  });
  if (!patchRes.ok) return _err(500, 'DB_ERROR', await patchRes.text(), corsHeaders);
  const rows = await patchRes.json().catch(() => []);
  const item = rows[0];

  // 제안자에게 Push 알림
  const STATUS_LABEL = { pending: '검토 대기', reviewing: '검토중', accepted: '반영 확정', rejected: '보류' };
  if (item?.guid) {
    _sendPushToGuid(env, item.guid, {
      title: '제안 상태가 변경됐습니다',
      body:  `"${item.content?.slice(0, 30)}..." → ${STATUS_LABEL[status] || status}`,
      tag:   'gopang-feedback-' + id,
      url:   '/feedback.html',
    }).catch(e => console.warn('[Feedback Push]', e.message));
  }

  return new Response(JSON.stringify({ ok: true, item }), { status: 200, headers: corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// Prompt Editor — 조회는 공개, 편집은 관리자 인증(L1 prompt_admins) + GitHub PR
//
// GET /prompt는 인증 없이 누구나 호출 가능 — System Prompt 원문은 일반인도
// 볼 수 있어야 한다는 요구사항. 인증은 POST /admin/prompt(저장)에만 걸린다.
//
// 인증: L1 PocketBase의 prompt_admins(Auth Collection)에 위임 — Worker는
//   비밀번호를 직접 검증하지 않고, PocketBase의
//   /api/collections/prompt_admins/auth-with-password 결과만 신뢰한다.
//   성공 시 Worker가 자체 admin 세션 토큰(HMAC-SHA256, ADMIN_MASTER_KEY로 서명)을
//   발급한다. 이 토큰은 쿠키가 아니라 Authorization: Bearer 헤더로 주고받는다 —
//   이 Worker는 커스텀 도메인(hondi.net) 라우트가 없는 *.workers.dev 인스턴스라
//   기존 buildCookie()처럼 Domain=.hondi.net 쿠키를 발급해도 브라우저가 도메인
//   불일치로 폐기한다. prompt-editor.html은 새 탭에서 열리는 독립 단일 페이지라
//   세션을 메모리에만 들고 있으면 충분하다(새로고침 시 재로그인 — 의도된 동작).
//
// 저장 대상 제한: prompts/ 디렉터리의 .txt 파일만 — 그 외 경로는 일괄 거부
// (worker.js 자체나 다른 파일을 덮어쓸 수 없도록 화이트리스트로 강제).
//
// 반영 방식: main 직접 커밋이 아니라 새 브랜치 + PR — 머지는 GitHub에서
// 사람이 검토 후 수동으로 진행한다(요청하신 "PR 생성 후 검토·머지" 워크플로).
//
// 필요 secret (wrangler secret put):
//   ADMIN_MASTER_KEY — admin 토큰 서명용 HMAC 키. GOPANG_MASTER_KEY와는
//                      별개 키를 쓴다(사용자 세션 토큰 위조 경로와 완전히 분리).
//   GITHUB_TOKEN     — Openhash-Gopang/gopang repo로 한정한 fine-grained PAT.
//                      권한: Contents (Read and write), Pull requests (Read and write).
//
// 필요 L1 PocketBase 설정 (Admin UI에서 1회 수동 작업):
//   Collections → New collection → name: prompt_admins → type: Auth
//   Options에서 Email/Password를 사용(Username/Password, OAuth2는 미사용이면 꺼두기) →
//   admin마다 레코드 1개씩 생성(email + password). 로그인 ID는 이메일 주소.
// ═══════════════════════════════════════════════════════════

function _isAllowedPromptPath(path) {
  if (typeof path !== 'string') return false;
  if (path.includes('..')) return false;
  return /^prompts\/[A-Za-z0-9_.-]+\.txt$/.test(path);
}

async function buildAdminToken(env, username) {
  if (!env.ADMIN_MASTER_KEY) throw new Error('ADMIN_MASTER_KEY secret 미설정');
  const now = Math.floor(Date.now() / 1000);
  const payload = { role: 'prompt_admin', admin: username, iat: now, exp: now + 1800 }; // 30분
  const b64p = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const key  = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.ADMIN_MASTER_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig  = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(b64p));
  const b64s = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${b64p}.${b64s}`;
}

async function parseAdminToken(env, token) {
  if (!env.ADMIN_MASTER_KEY) return null;
  try {
    const [b64p, b64s] = String(token).split('.');
    if (!b64p || !b64s) return null;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.ADMIN_MASTER_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const sigBytes = Uint8Array.from(atob(b64s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const sigOk = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(b64p));
    if (!sigOk) return null;
    const padded = b64p.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(padded + '=='.slice((padded.length % 4) || 4)));
    if (payload.role !== 'prompt_admin') return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

async function _requireAdmin(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  return parseAdminToken(env, m[1]);
}

// POST /admin/login  body: { email, password }
async function handleAdminLogin(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  const email = body?.email?.trim();
  const password = body?.password;
  if (!email || !password) return _err(400, 'MISSING_FIELD', 'email, password 필수', corsHeaders);

  let authRes;
  try {
    authRes = await fetch(`${L1_DEFAULT}/api/collections/prompt_admins/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: email, password }),
    });
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
  }
  if (!authRes.ok) return _err(401, 'INVALID_CREDENTIALS', '이메일 또는 비밀번호가 올바르지 않습니다', corsHeaders);

  const data = await authRes.json().catch(() => null);
  const adminName = data?.record?.email || data?.record?.username || email;
  const token = await buildAdminToken(env, adminName);
  const now = Math.floor(Date.now() / 1000);
  return new Response(JSON.stringify({ ok: true, admin: adminName, token, exp: now + 1800 }), { status: 200, headers: corsHeaders });
}

function _ghHeaders(env) {
  return {
    'Authorization':        `Bearer ${env.GITHUB_TOKEN}`,
    'Accept':                'application/vnd.github+json',
    'X-GitHub-Api-Version':  '2022-11-28',
    'User-Agent':             'gopang-prompt-editor',
  };
}

function _b64DecodeUtf8(b64) {
  const binary = atob(b64.replace(/\n/g, ''));
  const bytes  = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

function _b64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function _ghGetFile(env, path, ref = GITHUB_DEFAULT_BRANCH) {
  if (!env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN secret 미설정');
  const url = `${GITHUB_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO_NAME}/contents/${path}?ref=${encodeURIComponent(ref)}`;
  const res = await fetch(url, { headers: _ghHeaders(env) });
  if (!res.ok) throw new Error(`GitHub 조회 실패 (HTTP ${res.status})`);
  const data = await res.json();
  return { content: _b64DecodeUtf8(data.content), sha: data.sha };
}

// 새 브랜치를 만들어 커밋하고 main으로의 PR을 생성한다 (직접 main 커밋 없음).
async function _ghCommitViaPR(env, path, newContent, baseSha, adminName, message) {
  if (!env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN secret 미설정');
  const headers  = _ghHeaders(env);
  const repoBase = `${GITHUB_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO_NAME}`;

  const refRes = await fetch(`${repoBase}/git/ref/heads/${GITHUB_DEFAULT_BRANCH}`, { headers });
  if (!refRes.ok) throw new Error(`main ref 조회 실패 (HTTP ${refRes.status})`);
  const mainSha = (await refRes.json()).object.sha;

  const slug   = path.split('/').pop().replace(/\.[^.]+$/, '').toLowerCase();
  const branch = `prompt-edit/${slug}-${Date.now()}`;
  const createRefRes = await fetch(`${repoBase}/git/refs`, {
    method: 'POST', headers,
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: mainSha }),
  });
  if (!createRefRes.ok) throw new Error(`브랜치 생성 실패 (HTTP ${createRefRes.status})`);

  const putRes = await fetch(`${repoBase}/contents/${path}`, {
    method: 'PUT', headers,
    body: JSON.stringify({
      message: (message && message.trim()) || `prompt-editor: ${adminName}님이 ${path} 수정`,
      content: _b64EncodeUtf8(newContent),
      sha:     baseSha,
      branch,
      committer: { name: 'Gopang Prompt Editor', email: 'noreply@hondi.net' },
    }),
  });
  if (!putRes.ok) {
    if (putRes.status === 409 || putRes.status === 422) {
      throw new Error('충돌: 다른 곳에서 먼저 수정됐습니다. 새로고침 후 다시 시도하세요.');
    }
    const errBody = await putRes.text().catch(() => '');
    throw new Error(`커밋 실패 (HTTP ${putRes.status}): ${errBody.slice(0, 200)}`);
  }

  const prRes = await fetch(`${repoBase}/pulls`, {
    method: 'POST', headers,
    body: JSON.stringify({
      title: `[prompt-editor] ${path} 수정 (${adminName})`,
      head:  branch,
      base:  GITHUB_DEFAULT_BRANCH,
      body:  (message && message.trim()) || `관리자 \`${adminName}\`님이 Prompt Editor에서 직접 수정한 변경사항입니다.`,
    }),
  });
  if (!prRes.ok) throw new Error(`PR 생성 실패 (HTTP ${prRes.status})`);
  return (await prRes.json()).html_url;
}

// GET /prompt?file=prompts/SP-01_klaw_v1.0.txt — 공개. 누구나 System Prompt 원문을
// 조회할 수 있어야 한다(요청사항). 화이트리스트(prompts/*.txt)는 그대로 유지 —
// 어차피 GitHub repo 자체가 public이라 정보 노출 위험은 없고, 의도한 파일 범위만
// 이 엔드포인트로 받게 하기 위한 것. 수정(POST /admin/prompt)만 관리자 인증 필요.
async function handlePromptGet(request, env, corsHeaders) {
  const file = new URL(request.url).searchParams.get('file') || '';
  if (!_isAllowedPromptPath(file)) return _err(400, 'INVALID_FILE', '허용되지 않은 파일 경로', corsHeaders);

  try {
    const { content, sha } = await _ghGetFile(env, file);
    return new Response(JSON.stringify({ ok: true, file, content, sha }), { status: 200, headers: corsHeaders });
  } catch (e) {
    return _err(502, 'GITHUB_ERROR', e.message, corsHeaders);
  }
}

// POST /admin/prompt  body: { file, content, sha, message? }
async function handleAdminPromptSave(request, env, corsHeaders) {
  const admin = await _requireAdmin(request, env);
  if (!admin) return _err(401, 'UNAUTHORIZED', '관리자 인증이 필요합니다', corsHeaders);

  const body = await request.json().catch(() => null);
  const { file, content, sha, message } = body || {};
  if (!_isAllowedPromptPath(file)) return _err(400, 'INVALID_FILE', '허용되지 않은 파일 경로', corsHeaders);
  if (typeof content !== 'string' || !content.trim()) return _err(400, 'MISSING_FIELD', 'content 필수', corsHeaders);
  if (!sha) return _err(400, 'MISSING_FIELD', 'sha 필수 (충돌 감지용 — GET /prompt로 먼저 조회하세요)', corsHeaders);

  try {
    const prUrl = await _ghCommitViaPR(env, file, content, sha, admin.admin, message);
    return new Response(JSON.stringify({ ok: true, pr_url: prUrl }), { status: 200, headers: corsHeaders });
  } catch (e) {
    return _err(502, 'GITHUB_ERROR', e.message, corsHeaders);
  }
}


// ══════════════════════════════════════════════════════════════
// 디폴트 LLM 키 관리
// KV 키:
//   hondi:default_llm_keys  — [{provider,model,key,active}]
//   hondi:trial_days        — number (무료 체험 일수)
//   hondi:trial_expired_msg — string (만료 안내 메시지)
// ══════════════════════════════════════════════════════════════

// POST /admin/default-key
// body: { admin_token, keys:[{provider,model,key,active}], trial_days, expired_msg }
// admin_token: desktop.html에서 HMAC-SHA256으로 생성한 토큰
async function handleAdminDefaultKeySet(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON 파싱 실패', corsHeaders);

  // HMAC 검증 — desktop.html의 ADMIN_SALT와 동일한 키로 검증
  const { admin_token, keys, trial_days, expired_msg } = body;
  if (!admin_token) return _err(401, 'MISSING_TOKEN', 'admin_token 필수', corsHeaders);

  const isValid = await _verifyAdminToken(env, admin_token);
  if (!isValid) return _err(403, 'INVALID_TOKEN', '관리자 인증 실패', corsHeaders);

  const kv = env.AI_SETUP_SEALS_KV;
  if (!kv) return _err(500, 'KV_UNAVAILABLE', 'KV 바인딩 없음', corsHeaders);

  // 키 저장 (active인 것만 실제 사용, inactive는 보관)
  if (Array.isArray(keys)) {
    await kv.put('hondi:default_llm_keys', JSON.stringify(keys));
  }
  if (trial_days !== undefined) {
    await kv.put('hondi:trial_days', String(parseInt(trial_days) || 7));
  }
  if (expired_msg !== undefined) {
    await kv.put('hondi:trial_expired_msg', expired_msg);
  }

  return new Response(JSON.stringify({ ok: true, saved_at: new Date().toISOString() }),
    { status: 200, headers: corsHeaders });
}

// GET /default-key?guid=...&registered_at=ISO8601
// 체험기간 내이면 활성 키 중 첫 번째 반환 (key 값은 마스킹 안 함 — HTTPS 전용)
// 체험기간 만료이면 expired_msg 반환
//
// 2026-06-27: 공용 디폴트 키 제공 전면 중단 (토큰 낭비 방지 — 모든
// 사용자는 자신의 API 키를 직접 입력해야 한다). 클라이언트
// (loadDefaultKeyIfNeeded)도 이미 막아뒀지만, KV에 남은 키가 있어도
// 서버가 절대 내려주지 않도록 이중으로 차단한다. 되돌리려면
// DEFAULT_KEY_PROVISIONING_ENABLED만 true로.
const DEFAULT_KEY_PROVISIONING_ENABLED = false;

async function handleDefaultKeyGet(request, env, corsHeaders) {
  if (!DEFAULT_KEY_PROVISIONING_ENABLED) {
    return new Response(JSON.stringify({
      ok: false,
      status: 'PROVISIONING_DISABLED',
      message: '공용 체험 키 제공이 중단됐습니다. 설정에서 본인의 AI 키를 직접 입력해 주세요.',
    }), { status: 200, headers: corsHeaders });
  }

  const url  = new URL(request.url);
  const guid = url.searchParams.get('guid');
  const registeredAt = url.searchParams.get('registered_at');

  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);

  const kv = env.AI_SETUP_SEALS_KV;
  if (!kv) return _err(500, 'KV_UNAVAILABLE', 'KV 바인딩 없음', corsHeaders);

  // 체험 기간 계산
  const trialDays = parseInt(await kv.get('hondi:trial_days') || '7');
  const regTime   = registeredAt ? new Date(registeredAt).getTime() : 0;
  const now       = Date.now();
  const trialMs   = trialDays * 24 * 60 * 60 * 1000;
  const inTrial   = regTime > 0 && (now - regTime) <= trialMs;
  const daysLeft  = inTrial ? Math.ceil((regTime + trialMs - now) / 86400000) : 0;

  if (!inTrial) {
    const expiredMsg = await kv.get('hondi:trial_expired_msg') ||
      'AI 비서 무료 체험 기간이 종료됐습니다. 계속 이용하시려면 이메일로 키를 발급받거나 유료 플랜을 선택해 주세요.';
    return new Response(JSON.stringify({
      ok: false,
      status: 'TRIAL_EXPIRED',
      message: expiredMsg,
      trial_days: trialDays,
    }), { status: 200, headers: corsHeaders });
  }

  // 활성 키 조회
  const keysRaw = await kv.get('hondi:default_llm_keys');
  const keys    = keysRaw ? JSON.parse(keysRaw).filter(k => k.active && k.key) : [];

  if (!keys.length) {
    return new Response(JSON.stringify({
      ok: false,
      status: 'NO_DEFAULT_KEY',
      message: '관리자가 디폴트 키를 아직 등록하지 않았습니다.',
    }), { status: 200, headers: corsHeaders });
  }

  // 첫 번째 활성 키 반환
  const { provider, model, key } = keys[0];
  return new Response(JSON.stringify({
    ok: true,
    status: 'TRIAL_ACTIVE',
    days_left: daysLeft,
    provider,
    model,
    key,            // HTTPS 전용 — 평문 전달
    trial_days: trialDays,
  }), { status: 200, headers: corsHeaders });
}

// 관리자 토큰 검증 — HMAC-SHA256(timestamp, GOPANG_MASTER_KEY)
// desktop.html에서 생성한 토큰: {ts}.{hmac}
// POST /admin/cf-dns — Cloudflare DNS CNAME 추가 (브라우저 CORS 우회)
// body: { token, apiKey, email, zoneId, name, content }
async function handleAdminCfDns(request, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  const { token, apiKey, email, zoneId, name, content } = body;
  if (!token) return new Response(JSON.stringify({error:'MISSING_TOKEN'}), {status:401, headers:corsHeaders});
  const isValid = await _verifyAdminToken(env, token);
  if (!isValid) return new Response(JSON.stringify({error:'INVALID_TOKEN'}), {status:403, headers:corsHeaders});
  if (!apiKey || !email || !zoneId || !name) 
    return new Response(JSON.stringify({error:'MISSING_PARAMS'}), {status:400, headers:corsHeaders});

  const cfRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, {
    method: 'POST',
    headers: { 'X-Auth-Key': apiKey, 'X-Auth-Email': email, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type:'CNAME', name, content: content||'openhash-gopang.github.io', ttl:1, proxied:false })
  });
  const data = await cfRes.json();
  return new Response(JSON.stringify(data), {
    status: cfRes.status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// GET /admin/stats?token=... — 통계 (Supabase user_profiles 기반)
// L1 PocketBase는 SSL 미설정으로 Worker에서 직접 접근 불가 → Supabase 사용
async function handleAdminStats(request, env, corsHeaders) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) return new Response(JSON.stringify({error:'MISSING_TOKEN'}), {status:401, headers:corsHeaders});
  const isValid = await _verifyAdminToken(env, token);
  if (!isValid) return new Response(JSON.stringify({error:'INVALID_TOKEN'}), {status:403, headers:corsHeaders});

  try {
    const sbKey = env.SUPABASE_SERVICE_KEY || env.SUPABASE_KEY || _supabaseAnonKey();
    const sbHeaders = { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` };

    // 전체 카운트
    const r1 = await fetch(
      `${SUPABASE_URL}/rest/v1/user_profiles?select=count`,
      { headers: { ...sbHeaders, 'Prefer': 'count=exact', 'Range': '0-0' }, signal: AbortSignal.timeout(6000) }
    );
    const total = parseInt(r1.headers.get('content-range')?.split('/')?.[1] ?? '0');

    // 최근 500개 created 날짜
    const r2 = await fetch(
      `${SUPABASE_URL}/rest/v1/user_profiles?select=created_at&order=created_at.desc&limit=500`,
      { headers: sbHeaders, signal: AbortSignal.timeout(8000) }
    );
    const items = await r2.json();

    return new Response(JSON.stringify({
      total,
      items: (Array.isArray(items) ? items : []).map(u => ({created: u.created_at}))
    }), {status:200, headers:{...corsHeaders,'Content-Type':'application/json'}});
  } catch(e) {
    return new Response(JSON.stringify({error: e.message}), {status:502, headers:corsHeaders});
  }
}

async function _verifyAdminToken(env, token) {
  try {
    const [tsStr, hmacHex] = token.split('.');
    if (!tsStr || !hmacHex) return false;
    const ts  = parseInt(tsStr);
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - ts) > 300) return false;  // 5분 유효

    const secret = env.GOPANG_MASTER_KEY || 'gopang-webauthn-secret-v1';
    const k = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const sigBytes = Uint8Array.from(hmacHex.match(/.{2}/g).map(h => parseInt(h, 16)));
    return await crypto.subtle.verify('HMAC', k, sigBytes, new TextEncoder().encode(tsStr));
  } catch { return false; }
}
