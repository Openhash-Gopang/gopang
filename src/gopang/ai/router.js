/**
 * ai/router.js — SP-00 라우터 (서비스 분류)
 */
import { CFG } from '../core/config.js';
import { TOKEN_BUDGET, FAST_MODEL } from '../core/token-policy.js';
import { appendBubble } from '../ui/bubble.js';
import { _USER } from '../core/state.js';

// ── Router system prompt — manifest 기반 로드 ──────────────
// 라우터 SP 파일명은 CI 빌드 시 자동 생성된 prompts/manifest.json 에서 결정.
// manifest 키: "SP-00-ROUTER"
// SP-00-ROUTER-LATEST.txt 포인터 파일 방식 제거 — manifest 단일 체계로 통일.
const _SP_BASE = '/prompts/';

let _routerPrompt      = null;   // 로드 완료 후 캐시
let _routerPromptVer   = null;   // 버전명 (로그용)
let _routerLoadPromise = null;   // 중복 fetch 방지

export async function _loadRouterPrompt() {
  // 이미 로드됐으면 캐시 반환
  if (_routerPrompt) return _routerPrompt;

  // 동시 호출 시 하나만 fetch (Promise 공유)
  if (_routerLoadPromise) return _routerLoadPromise;

  _routerLoadPromise = (async () => {
    try {
      // manifest.json 에서 라우터 SP 파일명 결정
      const manifestRes = await fetch(_SP_BASE + 'manifest.json', { cache: 'no-cache' });
      if (!manifestRes.ok) throw new Error('manifest fetch 실패: ' + manifestRes.status);
      const manifest = await manifestRes.json();
      const fname = manifest['SP-00-ROUTER'];
      if (!fname) throw new Error('manifest 에 SP-00-ROUTER 키 없음');

      const promptRes = await fetch(_SP_BASE + fname, { cache: 'no-cache' });
      if (!promptRes.ok) throw new Error('라우터 SP 로드 실패: ' + promptRes.status);

      _routerPrompt    = await promptRes.text();
      _routerPromptVer = fname;
      console.info('[Router] 프롬프트 로드 완료:', fname, '(' + _routerPrompt.length + ' chars)');
      return _routerPrompt;

    } catch(e) {
      console.warn('[Router] manifest 로드 실패, 하드코딩 최소 프롬프트 사용:', e.message);
      // 폴백: manifest 실패 시에도 라우터 중단이 전파되지 않도록 내장 최소 프롬프트로
      _routerPrompt    = _ROUTER_MINIMAL;
      _routerPromptVer = 'minimal (내장)';
      return _routerPrompt;
    }
  })();

  return _routerLoadPromise;
}

// ── 최소 내장 프롬프트 (GitHub 완전 불통 시 최후 보루) ─────────
const _ROUTER_MINIMAL = `너는 고팡 서비스 라우터다. JSON만 출력한다.
{"category":"코드","service_id":"ID","service_url":"URL","confidence":0.0,"reason":"근거","secondary":null,"urgent":false,"gwp_ctx":null}
긴급(쓰러짐·화재·부상)→EMG·kemergency·urgent:true, 쓰레기·오염→ENV·fiil-kcleaner,
법률·소송→JUS·klaw, 주식·투자→ECO·kfinance, 배송·택배→TRN·klogistics,
교통·경로→TRN·ktransport, 건강·증상→MED·khealth, 교육→EDU·kedu,
고팡투표·안건→LEG·kdemocracy, 그 외→DIRECT·gopang-direct`;

// ── Router 캐시 (같은 입력 재호출 방지) ─────────────────────
const _routerCache = new Map();

// ── runRouter: 1단계 라우팅 실행 ────────────────────────────
export async function runRouter(userText, hasImage = false) {
  // GWP ctx/svc 파라미터 우선 처리
  const params  = new URLSearchParams(location.search);
  const gwpSvc  = params.get('svc');
  const gwpCtx  = params.get('ctx') ? decodeURIComponent(params.get('ctx')) : null;

  const GWP_SVC_MAP = {
    stock:      { category:'ECO', service_id:'kfinance',    service_url:'https://stock.hondi.net' },
    klaw:       { category:'JUS', service_id:'klaw',        service_url:'https://klaw.hondi.net' },
    school:     { category:'EDU', service_id:'kedu',        service_url:'https://school.hondi.net' },
    health:     { category:'MED', service_id:'khealth',     service_url:'https://health.hondi.net' },
    democracy:  { category:'LEG', service_id:'kdemocracy',  service_url:'https://democracy.hondi.net' },
    fiil:       { category:'ENV', service_id:'fiil-kcleaner', service_url:'https://fiil.kr' },
  };
  if (gwpSvc && GWP_SVC_MAP[gwpSvc]) {
    const r = GWP_SVC_MAP[gwpSvc];
    return { ...r, confidence:0.99, reason:`GWP svc=${gwpSvc} 파라미터 직접 라우팅.`,
             secondary:null, urgent:false, gwp_ctx:gwpCtx };
  }

  // 긴급 키워드 즉시 판단 (LLM 호출 없이)
  if (/긴급|응급|119|112|쓰러|부상|화재|불이났|구조|살려줘|심정지/.test(userText)) {
    return { category:'EMG', service_id:'kemergency',
             service_url:'https://911.hondi.net', confidence:0.99,
             reason:'긴급 상황 감지. K-Emergency 즉시 연결.',
             secondary:null, urgent:true, gwp_ctx:gwpCtx };
  }

  // 이미지+쓰레기 → 즉시 ENV
  if (hasImage && (!userText || /쓰레기|오염|투기|폐기물|해양|해안|침적/.test(userText))) {
    return { category:'ENV', service_id:'fiil-kcleaner',
             service_url:'https://fiil.kr', confidence:0.95,
             reason:'이미지 첨부 + 환경 오염 맥락. K-Cleaner 처리.',
             secondary:null, urgent:false, gwp_ctx:gwpCtx };
  }

  // 입력이 짧거나 일상 대화이면 라우터 LLM 호출 생략
  const DIRECT_RE = /^(안녕|고마워|감사|ㅋ|ㅎ|ㅇ|네|예|아니|몇시|날씨|시간|1\+1|계산|번역|요약).{0,20}$/;
  if (!userText || userText.length < 3 || DIRECT_RE.test(userText.trim())) {
    return { category:'DIRECT', service_id:'gopang-direct',
             service_url:null, confidence:0.98,
             reason:'일상 대화 또는 단순 질의. 고팡 AI 비서 직접 처리.',
             secondary:null, urgent:false, gwp_ctx:gwpCtx };
  }

  // 캐시 확인
  const cacheKey = userText.slice(0, 80);
  if (_routerCache.has(cacheKey)) {
    console.log('[Router] 캐시 히트:', cacheKey);
    return _routerCache.get(cacheKey);
  }

  // LLM 라우터 호출 (DeepSeek V3 텍스트 전용, 저렴·빠름)
  // ★ 라우터 프롬프트는 GitHub에서 동적 로드 — webapp.html 수정 불필요
  try {
    const routerSysPrompt = await _loadRouterPrompt();
    const imageNote = hasImage ? '\n[이미지 첨부됨]' : '';
    const res = await fetch(CFG.endpoint + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:       FAST_MODEL,  // 라우터는 고정 저가 모델(빠름·저렴, 분류 작업에 충분)
        max_tokens:  TOKEN_BUDGET.ROUTE_CLASSIFY,
        temperature: 0.0,               // 결정론적
        stream:      false,
        messages: [
          { role: 'system', content: routerSysPrompt },
          { role: 'user',   content: userText + imageNote },
        ],
      }),
    });
    if (!res.ok) throw new Error('Router HTTP ' + res.status);
    const data   = await res.json();
    const raw    = data.choices?.[0]?.message?.content || '{}';
    const result = JSON.parse(raw.replace(/```json|```/g, '').trim());
    result.gwp_ctx = gwpCtx;

    // 캐시 저장 (최대 50개)
    if (_routerCache.size >= 50) _routerCache.delete(_routerCache.keys().next().value);
    _routerCache.set(cacheKey, result);

    console.log('[Router] 결과:', result.category, result.service_id, result.confidence);
    return result;

  } catch(e) {
    console.warn('[Router] LLM 호출 실패, gopang-direct 폴백:', e.message);
    return { category:'DIRECT', service_id:'gopang-direct',
             service_url:null, confidence:0.5,
             reason:'라우터 오류. 고팡 AI 비서 직접 처리.',
             secondary:null, urgent:false, gwp_ctx:gwpCtx };
  }
}

// ── applyRouterResult: 라우팅 결과를 callAI에 적용 ──────────
export function applyRouterResult(result) {
  if (!result || result.service_id === 'gopang-direct') return;

  // urgent: 긴급 UI 처리
  if (result.urgent) {
    appendBubble('ai',
      '🚨 **긴급 상황 감지**\n' +
      `K-Emergency(911.hondi.net)에 연결합니다.\n` +
      '📞 119/112 자동 디스패치 준비 중...'
    );
  }

  // 서비스 배지 표시 (채팅창 상단에 작게)
  const svcBadge = document.getElementById('router-badge');
  if (svcBadge) {
    svcBadge.textContent = result.service_id !== 'gopang-direct'
      ? `▶ ${result.service_id} (${(result.confidence*100).toFixed(0)}%)`
      : '';
    svcBadge.style.display = result.service_id !== 'gopang-direct' ? 'block' : 'none';
  }

  console.log(`[Router] → [${result.category}] ${result.service_id} (${result.service_url}) conf:${result.confidence}`);
}

// ── 현재 라우팅 결과 저장 (callAI에서 참조) ────────────────
let _lastRouterResult = null;
