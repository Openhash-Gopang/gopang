// ══════════════════════════════════════════════════════════════════
// services/ai.js — AI 호출·Gemini 이미지 분석·도메인 감지
// ══════════════════════════════════════════════════════════════════
import { EXPERT_SP_MAP, DOMAIN_DETECT, EXPERT_KEYWORDS } from '../../config.js';

// 런타임 주입
let _getCFG          = () => ({});
let _getLocation     = () => null;
let _appendBubble    = () => {};
let _createStreamBubble  = () => null;
let _updateStreamBubble  = () => {};
let _showTyping      = () => {};
let _hideTyping      = () => {};
let _showGeminiProgress  = () => 0;
let _hideGeminiProgress  = () => {};
let _progressStart   = () => {};
let _progressNext    = () => {};
let _topLogoSetProgress = () => {};
let _onAIComplete    = () => {};   // klawReview 트리거용 콜백

export function initAI(deps) {
  _getCFG              = deps.getCFG;
  _getLocation         = deps.getLocation;
  _appendBubble        = deps.appendBubble;
  _createStreamBubble  = deps.createStreamBubble;
  _updateStreamBubble  = deps.updateStreamBubble;
  _showTyping          = deps.showTyping;
  _hideTyping          = deps.hideTyping;
  _showGeminiProgress  = deps.showGeminiProgress;
  _hideGeminiProgress  = deps.hideGeminiProgress;
  _progressStart       = deps.progressStart;
  _progressNext        = deps.progressNext;
  _topLogoSetProgress  = deps.topLogoSetProgress;
  _onAIComplete        = deps.onAIComplete;
}

export let history = [];

// ── 메인 AI 호출 ─────────────────────────────────────────────────
export async function callAI(userText, imageFile = null) {
  _showTyping();
  const cfg = _getCFG();

  // 위치 준비 대기 (최대 6초)
  if (cfg._locationPending) {
    await new Promise(resolve => {
      const deadline = Date.now() + 6000;
      const poll = () => (cfg._locationReady || Date.now() >= deadline) ? resolve() : setTimeout(poll, 200);
      poll();
    });
  }

  if (!cfg.system_base) cfg.system_base = cfg.system;

  // ── 2단계: 전문가 변신 ──────────────────────────────────────────
  let expertLoaded = false, detectedCode = null;

  if (userText && EXPERT_KEYWORDS.test(userText)) {
    for (const { code, re } of DOMAIN_DETECT) {
      if (re.test(userText)) { detectedCode = code; break; }
    }
    if (detectedCode && EXPERT_SP_MAP[detectedCode]) {
      try {
        const sp = await Promise.race([fetch('/' + EXPERT_SP_MAP[detectedCode]).then(r => r.text()), new Promise((_,r) => setTimeout(() => r(new Error('timeout')), 2000))]);
        cfg.system = cfg.system_base + '\n\n---\n' + sp;
        expertLoaded = true;
      } catch {}
    }
  }
  if (!expertLoaded) cfg.system = cfg.system_base;

  // ── K-Cleaner 이미지 분석 ────────────────────────────────────
  let geminiResult = null;

  if (imageFile && detectedCode === 'CLN' && cfg.geminiKey) {
    _topLogoSetProgress(true);
    _progressStart(userText, _getLocation()?.address || '위치 확인 중…', null);
    const timer = _showGeminiProgress();
    try {
      geminiResult = await callGeminiVision(imageFile, cfg.geminiKey);
      _progressNext();
    } catch {}
    _hideGeminiProgress(timer);
    _topLogoSetProgress(false);
    if (geminiResult) { _progressNext(); _onAIComplete({ type:'gemini', geminiResult, imageFile, userText }); }

  } else if (imageFile && cfg.geminiKey && !modelSupportsVision(cfg.model)) {
    const timer = _showGeminiProgress();
    try {
      const desc = await callGeminiGeneral(imageFile, cfg.geminiKey, userText);
      if (desc) userText = (userText ? userText + '\n\n[이미지 분석]\n' : '[이미지 분석]\n') + desc;
    } catch {}
    _hideGeminiProgress(timer);
  }

  history.push({ role:'user', content: userText || '[이미지]' });

  // ── DeepSeek 스트리밍 호출 ───────────────────────────────────
  try {
    const res = await fetch(cfg.endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:      cfg.model,
        max_tokens: 2048,
        system:     cfg.system,
        messages:   [{ role:'user', content: userText || '[이미지]' }],
        stream:     false,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    _hideTyping();
    const bubble = _createStreamBubble();
    const d = await res.json();
    const fullText = d.choices?.[0]?.message?.content || '';
    _updateStreamBubble(bubble, fullText);
    bubble.classList.remove('streaming');
    history.push({ role:'assistant', content: fullText });

    // K-Law 감시 트리거 (3초 후)
    setTimeout(() => _onAIComplete({ type:'chat', userText, aiText: fullText }), 3000);

  } catch(err) {
    _hideTyping();
    _appendBubble('ai', `⚠️ 오류: ${err.message}`);
    console.error('[AI]', err);
  }
}

// ── Gemini Vision (K-Cleaner) ────────────────────────────────────
export async function callGeminiVision(imageFile, geminiKey) {
  const base64 = await fileToBase64(imageFile);
  const prompt = await fetch('/prompts/SP-14-IMG_kcleaner_vision_prompt_v1.0.txt').then(r => r.text())
    .catch(() => 'Analyze this image for waste detection.');
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
    { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ contents:[{ parts:[
        { inline_data:{ mime_type: imageFile.type, data: base64 } },
        { text: prompt },
      ]}] }) }
  );
  const d = await r.json();
  return parseKCleanerReply(d.candidates?.[0]?.content?.parts?.[0]?.text || '');
}

export async function callGeminiGeneral(imageFile, geminiKey, userText) {
  const base64 = await fileToBase64(imageFile);
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
    { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ contents:[{ parts:[
        { inline_data:{ mime_type: imageFile.type, data: base64 } },
        { text: userText || '이 이미지를 분석해주세요.' },
      ]}] }) }
  );
  const d = await r.json();
  return d.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ── K-Cleaner JSON 파싱 ──────────────────────────────────────────
export function parseKCleanerReply(text) {
  if (!text) return null;
  try { return JSON.parse(text.replace(/```json|```/g, '').trim()); }
  catch {
    const r = {};
    const rm = text.match(/risk_level["\s:]+([S][0-3])/); if (rm) r.risk_level = rm[1];
    const dm = text.match(/scene_description["\s:]+["']?([^"'\n,}]+)/); if (dm) r.scene_description = dm[1].trim();
    return Object.keys(r).length ? r : null;
  }
}

// ── 유틸 ─────────────────────────────────────────────────────────
export function modelSupportsVision(model) { return /gemini|vision|claude/.test(model); }

export function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

export function classifyDomain(text) {
  const patterns = {
    JUS:/계약|소송|고소|판례|변호사|법률|법원|법적|분쟁|고발|판결/,
    MED:/병원|처방|증상|수술|진단|의료|건강|소견/,
    ECO:/세금|재무|투자|대출|납부|환급|주식/,
    ENV:/쓰레기|환경|청소|수거|오염|해양|산림/,
  };
  for (const [code, re] of Object.entries(patterns)) { if (re.test(text)) return code; }
  return 'ETC';
}





