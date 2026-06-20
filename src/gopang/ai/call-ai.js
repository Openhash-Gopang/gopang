/**
 * ai/call-ai.js — LLM API 호출·스트리밍·GWP 태그 처리
 */
import { CFG, _modelSupportsVision, PROVIDER_INFO } from '../core/config.js';
import { aiActive, history, _userLocation, _lastRouterResult,
         setLastRouterResult, _USER, USER_GUID, _locationPending, _locationReady } from '../core/state.js';
import { appendBubble, showTyping, hideTyping,
         _createStreamBubble, _updateStreamBubble } from '../ui/bubble.js';
import { _buildLocNote } from '../services/location.js';
import { runRouter, applyRouterResult } from './router.js';
import { _injectAuthConfirmButton } from '../core/auth.js';
import { _klawReview } from '../services/klaw.js';


export let history_ref = history;  // 외부 참조용

// ── 응답 생성 중지(Stop) 지원 ───────────────────────────────
// 전송 버튼이 "생성 중" 상태일 때 클릭하면 stopGeneration()이 호출되어
// 현재 진행 중인 스트리밍 fetch를 중단한다 (Claude의 정지 버튼과 동일한 동작).
let _currentAbort = null;

export function stopGeneration() {
  if (_currentAbort) {
    console.log('[AI] 사용자 요청으로 응답 생성 중지');
    _currentAbort.abort();
  }
}

function _setSendBtnGenerating(active) {
  const btn = document.getElementById('send-btn');
  if (!btn) return;
  btn.classList.toggle('generating', active);
  if (active) {
    btn.disabled = false; // 생성 중에는 항상 클릭 가능해야 중지 버튼으로 동작
  } else {
    const input = document.getElementById('msg-input');
    btn.disabled = !(input && input.value.trim());
  }
}

// callAI는 얇은 래퍼 — 실제 로직(_callAIInner)이 어떤 경로로 끝나든(정상 종료/
// 에러/중지) try/finally가 버튼 상태와 AbortController를 항상 정리한다.
export async function callAI(userText, imageFile = null, _preTab = null) {
  _currentAbort = new AbortController();
  _setSendBtnGenerating(true);
  try {
    await _callAIInner(userText, imageFile, _preTab);
  } finally {
    _setSendBtnGenerating(false);
    _currentAbort = null;
  }
}

// ── 호출 후보 목록 생성 ────────────────────────────────────
// 우선순위: 1) 고팡 프록시(기본, 무료) 2) 사용자가 등록한 BYOK provider들 (등록 순서대로)
// 한도 초과(429)·크레딧부족(402) 시 callAI()에서 다음 후보로 자동 전환
function _buildCallCandidates() {
  const candidates = [];

  // 1) 고팡 프록시 — 키 불필요, 기본 모델 사용
  if (CFG.endpoint.includes('workers.dev')) {
    candidates.push({
      provider: 'gopang-proxy',
      baseUrl:  CFG.endpoint.replace(/\/+$/, ''),
      model:    CFG.model,
      apiKey:   '',
      isProxy:  true,
    });
  }

  // 2) 사용자가 등록한 BYOK provider 목록 (순서대로)
  if (Array.isArray(CFG.providers)) {
    for (const p of CFG.providers) {
      if (!p?.apiKey || !p?.model) continue;
      const info = PROVIDER_INFO[p.provider];
      if (!info) continue;
      candidates.push({
        provider: p.provider,
        baseUrl:  (p.baseUrl || info.baseUrl).replace(/\/+$/, ''),
        model:    p.model,
        apiKey:   p.apiKey,
        isProxy:  false,
      });
    }
  }

  // 3) 하위 호환 — CFG.apiKey/geminiKey 단일 키만 있던 기존 사용자
  if (!candidates.some(c => !c.isProxy)) {
    if (CFG.apiKey && !CFG.endpoint.includes('workers.dev')) {
      candidates.push({
        provider: 'legacy', baseUrl: CFG.endpoint.replace(/\/+$/, ''),
        model: CFG.model, apiKey: CFG.apiKey, isProxy: false,
      });
    } else if (CFG.geminiKey) {
      candidates.push({
        provider: 'gemini', baseUrl: PROVIDER_INFO.gemini.baseUrl,
        model: CFG.model.startsWith('gemini') ? CFG.model : 'gemini-2.0-flash',
        apiKey: CFG.geminiKey, isProxy: false,
      });
    }
  }

  // 후보가 전혀 없으면 최소 프록시 1개는 항상 시도
  if (candidates.length === 0) {
    candidates.push({
      provider: 'gopang-proxy', baseUrl: 'https://gopang-proxy.tensor-city.workers.dev',
      model: CFG.model, apiKey: '', isProxy: true,
    });
  }

  return candidates;
}


async function _callAIInner(userText, imageFile = null, _preTab = null) {
  showTyping();

  // urgent=true → kemergency면 경고 표시 후 계속 처리
  // (고팡 비서가 추가로 응급 가이드 제공)

  // ── 위치 준비 대기 (최대 6초, race condition 방지) ──────
  if (_locationPending) {
    await new Promise(resolve => {
      const deadline = Date.now() + 6000;
      const poll = () => {
        if (_locationReady || Date.now() >= deadline) resolve();
        else setTimeout(poll, 200);
      };
      poll();
    });
  }

  // ── SP-00 v10.0: 폭포수 2단계(전문가 변신) 완전 제거 ──────
  // 모든 전문 도메인은 [GWP:id] 태그로 하위 시스템 새 탭 호출
  // AI 비서는 직접 처리 가능한 업무만 수행:
  //   정보조회·계산·번역·날씨·PDV관리·일정·일반대화·웹검색
  // 이미지 첨부 시: Gemini 범용 분석 후 SP-00에 컨텍스트로 전달
  //   (이미지 내용이 환경오염이면 LLM이 [GWP:fiil-kcleaner] 태그 출력)

  // system을 항상 base로 유지 (전문가 SP 오염 방지)
  // system_base 최초 1회 고정 — 이후 callAI 재진입 시 항상 원본으로 복원
  if (!CFG.system_base) CFG.system_base = CFG.system;
  CFG.system = CFG.system_base;

  // ── 이미지 첨부 시: Gemini 범용 분석 → SP-00 컨텍스트 주입 ──
  if (imageFile && CFG.geminiKey) {
    try {
      const _gpTimer = _showGeminiProgress();
      console.log('[IMG] Gemini 범용 이미지 분석 시작');
      const genResult = await _callGeminiGeneral(imageFile, CFG.geminiKey, userText);
      _hideGeminiProgress(_gpTimer);
      if (genResult) {
        const analysisText = _geminiResultToText(genResult, userText);
        userContent = analysisText;
        imageFile   = null;
        console.log('[IMG] Gemini 분석 완료 → SP-00 컨텍스트로 전달');
      }
    } catch(e) {
      console.warn('[IMG] Gemini 분석 실패:', e.message);
    }
  }

  // locNote는 _buildLocNote()로 분리 — 최초 1회만 system에 삽입됨

  // ── 이미지 → content 배열 변환 ──────────────────────
  let userContent;

  if (imageFile && imageFile.type.startsWith('image/')) {
    if (!_modelSupportsVision(CFG.model)) {
      // 비전 미지원 모델 — 이미지 무시, 사용자에게 안내
      hideTyping();
      appendBubble('ai',
        `⚠️ 현재 모델(${CFG.model})은 이미지를 지원하지 않습니다.\n` +
        `설정에서 "DeepSeek V4" 또는 "GPT-4o"로 변경하세요.`);
      if (userText) {
        // 텍스트만이라도 처리
        showTyping();
      } else {
        return;
      }
      userContent = userText;
    } else {
      // 비전 지원 모델 — base64 변환 후 multipart content
      // DeepSeek API: image_url 형식 미지원 → base64를 텍스트로 포함
      // OpenAI 호환 모델(gpt-4o 등): image_url 형식 사용
      try {
        const dataUrl  = await _fileToBase64(imageFile);
        const mimeType = imageFile.type;
        const base64   = dataUrl.split(',')[1];

        const isOpenAI = CFG.endpoint.includes('openai.com') ||
                         CFG.endpoint.includes('azure') ||
                         CFG.model.startsWith('gpt-');
        const isDeepSeek = CFG.endpoint.includes('deepseek') ||
                           CFG.endpoint.includes('workers.dev');

        userContent = [];
        if (userText) {
          userContent.push({ type: 'text', text: userText });
        }

        if (isOpenAI) {
          // OpenAI 형식: image_url
          userContent.push({
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${base64}` },
          });
          // 텍스트 없이 이미지만 전송 시 — 의도 자율 파악 지시
          if (!userText) {
            userContent.push({
              type: 'text',
              text: '[텍스트 없이 이미지만 전송됨]\n사용자의 의도를 이미지에서 직접 파악하여 처리하라.\n환경 오염·쓰레기 현장이면 K-Cleaner v1.2 신고·견적을 자동 실행하고,\n그 외 이미지는 내용에 맞는 적절한 도움을 제공하라.\n불명확할 때만 한 가지 확인 질문을 한다.',
            });
          }
        } else {
          // DeepSeek 형식: base64를 텍스트로 포함
          // DeepSeek API는 image_url 미지원 → base64 데이터를 직접 전달
          userContent = [];
          if (userText) userContent.push({ type: 'text', text: userText });
          // 텍스트 없이 이미지만 전송 시 — 의도 자율 파악 지시
          const imgIntentNote = userText
            ? ''
            : '\n[텍스트 없이 이미지만 전송됨] 사용자 의도를 이미지에서 직접 파악하여 처리하라. 환경 오염·쓰레기 현장이면 K-Cleaner v1.2 신고·견적 자동 실행. 그 외는 내용에 맞는 도움 제공. 불명확할 때만 한 가지 확인 질문.';
          userContent.push({
            type: 'text',
            text: `[이미지 첨부됨 — base64 데이터: data:${mimeType};base64,${base64.slice(0,100)}... (${Math.round(base64.length*0.75/1024)}KB)]\n이 이미지를 분석해 주세요.${imgIntentNote}`,
          });
        }
      } catch (e) {
        hideTyping();
        appendBubble('ai', `⚠️ 이미지 변환 오류: ${e.message}`);
        return;
      }
    }
  } else {
    // 일반 텍스트
    userContent = userText;
  }

  // ── history에 system(최초) 및 user 추가 ─────────────────
  // history 구조: [system(index 0, 고정), user, assistant, user, assistant, ...]

  // 1) system: 세션 최초 1회만 history[0]으로 삽입
  //    ★ 캐시 최적화: system은 완전 정적 — locNote/GUID 미포함
  //    DeepSeek prefix cache가 system을 캐시 prefix unit으로 인식,
  //    이후 모든 요청에서 system 토큰 90% 절감 (~95% 캐시 적중)
  if (history.length === 0) {
    history.push({ role: 'system', content: CFG.system });
    console.log('[Cache] 세션 최초 — 정적 system 삽입 (캐시 최적화)');
  }
  // history[0] system 고정 유지 — 전문가 SP 없으므로 교체 불필요

  // 2) user: messages 전송 직전에 history에 추가
  const userRecord = { role: 'user', content: typeof userContent === 'string' ? userContent : `[첨부: 이미지]` };
  history.push(userRecord);

  // 3) messages 구성
  //    ★ 캐시 구조: system(정적, 캐시됨) → ctx(동적, 매번) → 대화 → user
  //    system이 항상 동일 → DeepSeek이 prefix unit으로 캐시 유지
  //    locNote·GUID는 history 밖 별도 ctx 메시지로 주입 → 캐시 prefix 보호
  const locNote = _buildLocNote();
  const ctxParts = [];
  if (USER_GUID) ctxParts.push(`사용자:${USER_GUID.slice(-8)}`);
  if (locNote)   ctxParts.push(locNote.trim());
  const ctxMsg = ctxParts.length
    ? [{ role: 'user',      content: `[ctx]${ctxParts.join(' ')}` },
       { role: 'assistant', content: '확인.' }]
    : [];

  // history에서 system(index 0) 분리 + 최근 대화 슬라이싱
  const sysMsg   = history[0]?.role === 'system' ? [history[0]] : [];
  const dialogs  = history.slice(1);  // system 제외 대화
  const recent   = dialogs.slice(-18); // 최근 18턴 (ctx 2턴 + user 합산 20)

  const messages = [
    ...sysMsg,                                      // [0] system (정적, 캐시됨)
    ...ctxMsg,                                      // [1-2] 동적 ctx (GUID+위치)
    ...recent.slice(0, -1),                         // 대화 이력
    { role: 'user', content: userContent },         // 현재 user
  ];

  // ── 호출 후보 목록 생성 (순차 페일오버) ──────────────────
  // 1순위: 고팡 프록시(키 불필요, 기본) → 등록된 BYOK provider들 순서대로
  // 한도 초과(429) 또는 크레딧 부족(402) 시 다음 후보로 자동 전환
  const candidates = _buildCallCandidates();
  const activeModel = CFG.model;
  console.log(`[AI] 호출 후보 ${candidates.length}개 준비 — 1번부터 순차 시도`);

  // ── 스트리밍 호출 (페일오버 포함) ───────────────────────
  try {
    let res = null, usedCandidate = null, lastErr = null;

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      console.log(`[AI] 시도 ${i + 1}/${candidates.length} → ${c.baseUrl}/chat/completions | 모델: ${c.model} | ${c.isProxy ? '프록시(보안)' : 'provider: ' + c.provider}`);
      try {
        const reqBody = {
          model: c.model,
          messages,
          max_tokens:  800,
          temperature: 0.6,
          stream:      true,
        };
        // Gemini·OpenRouter 등 일부 provider는 stream_options를 거부함(400)
        // PROVIDER_INFO[provider].noStreamOptions 플래그로 일반화 처리
        if (!PROVIDER_INFO[c.provider]?.noStreamOptions) {
          reqBody.stream_options = { include_usage: true };
        }
        const attempt = await fetch(`${c.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(c.isProxy ? {} : { 'Authorization': `Bearer ${c.apiKey}` }),
          },
          body: JSON.stringify(reqBody),
          signal: _currentAbort?.signal,
        });

        if (attempt.ok) { res = attempt; usedCandidate = c; break; }

        // 실패(429/402/404/400/5xx 등 모든 상황) → 다음 후보로 항상 페일오버
        // (단종된 모델일 때도, 한도 초과도, 일시 장애도 어떻든 다음 LLM을 시도한다)
        const errBody = await attempt.text().catch(() => '');
        lastErr = new Error(`API ${attempt.status}: ${errBody.slice(0, 300) || '응답없음'}`);
        console.warn(`[AI] ${c.provider}(${c.model}) 실패(${attempt.status}) — 다음 LLM으로 전환:`, errBody.slice(0, 150));
        continue;
      } catch (fetchErr) {
        if (fetchErr.name === 'AbortError') throw fetchErr; // 사용자 중지 — 페일오버 없이 즉시 중단
        lastErr = fetchErr;
        // 네트워크 오류 등도 다음 후보가 있으면 계속 시도
        if (i < candidates.length - 1) continue;
        throw fetchErr;
      }
    }

    if (!res) throw (lastErr || new Error('모든 LLM 호출에 실패했습니다.'));
    if (usedCandidate && usedCandidate.model !== CFG.model) {
      console.info(`[AI] 페일오버로 모델 전환됨: ${CFG.model} → ${usedCandidate.model}`);
    }

    console.log(`[AI] 응답 시작 — status:${res.status}, streaming...`);

    // ── SSE 스트림 수신 + 실시간 렌더링 ─────────────────────
    hideTyping();

    const bubble = _createStreamBubble();
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   fullReply = '';
    let   buf       = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') break;
        try {
          const chunk = JSON.parse(payload);
          if (chunk.usage) {
            const u = chunk.usage;
            const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
            console.log(`[Cache] prompt=${u.prompt_tokens} cached=${cached} completion=${u.completion_tokens} (절감율 ${cached ? Math.round(cached/u.prompt_tokens*100) : 0}%)`);
          }
          const delta = chunk.choices?.[0]?.delta?.content ?? '';
          if (delta) {
            fullReply += delta;
            // CLN 신고가 아닐 때만 실시간 렌더링
            if (bubble) _updateStreamBubble(bubble, fullReply);
          }
        } catch (parseErr) {
          if (payload && payload !== '[DONE]') {
            console.warn('[Stream] 파싱 실패:', payload.slice(0, 80));
          }
        }
      }
    }

    if (!fullReply) fullReply = '(응답 없음)';
    console.log(`[AI] 응답 완료 — ${fullReply.length}자`);
    if (CFG._modelOverride) { CFG.model = CFG._modelOverride; CFG._modelOverride = null; }
    history.push({ role: 'assistant', content: fullReply });
    if (bubble) bubble.classList.remove('streaming');


    // ── GWP 태그 감지 → 하위 시스템 새 탭 오픈 (SP-00 v10.0) ──
    const gwpMatch = fullReply.match(/\[GWP:([\w-]+)\]/);
    if (gwpMatch) {
      const svcId  = gwpMatch[1];
      const svcDef = (typeof getService === 'function') ? getService(svcId) : null;
      if (svcDef) {
        console.info('[GWP] LLM 판단 → 새 탭:', svcId);
        // 버블에서 [GWP:...] 태그 제거 후 렌더링
        if (bubble) _updateStreamBubble(bubble, fullReply.replace(/\[GWP:[\w-]+\]\s*/, ''));
        _gwpLaunch(svcDef, userText, _preTab);
      } else {
        console.warn('[GWP] 알 수 없는 서비스 ID:', svcId);
        // 미등록 서비스 → 예약된 빈 탭 닫기
        if (_preTab && !_preTab.closed) { _preTab.close(); }
      }
    } else {
      // GWP 태그 없음 = 직접 처리 → 예약된 빈 탭 닫기
      if (_preTab && !_preTab.closed) {
        _preTab.close();
        console.info('[GWP] 직접 처리 — 예약 탭 닫힘');
      }
    }

    // ── AUTH 태그 감지 → 인증 요구 ──────────────────────────
    const authMatch = fullReply.match(/\[AUTH:(L[0-3])\]/);
    if (authMatch) {
      const requiredLevel = authMatch[1];
      const stored = JSON.parse(localStorage.getItem('gopang_user_v4') || 'null');
      const currentLevel = stored?.authLevel || 'L0';
      const levels = ['L0','L1','L2','L3'];
      const needsUpgrade = levels.indexOf(requiredLevel) > levels.indexOf(currentLevel);

      if (needsUpgrade) {
        // 인증 버튼 주입
        setTimeout(() => _injectAuthConfirmButton(requiredLevel), 400);
      }
    }

    // K-Law 백그라운드 감시 트리거 — 대화 내용 자동 검토 (비동기)
    setTimeout(() => _klawReview('conversation', null), 3000);


  } catch (err) {
    hideTyping();
    if (err.name === 'AbortError') {
      console.log('[AI] 응답 생성이 중지되었습니다 (사용자 요청)');
      document.querySelector('.bubble-ai.streaming')?.classList.remove('streaming');
      return;
    }
    const existingBubble = document.querySelector('.bubble-ai.streaming');
    let userMsg = `⚠️ API 오류: ${err.message}`;
    if (err.message.includes('402') || err.message.includes('Insufficient Balance')) {
      userMsg =
        '⚠️ AI 서버 크레딧이 일시적으로 부족합니다.\n\n' +
        '잠시 후 다시 시도하거나, 설정(⚙️)에서\n' +
        'BYOK(내 API 키)를 입력하면 계속 이용할 수 있습니다.';
    }
    if (existingBubble) {
      existingBubble.classList.remove('streaming');
      existingBubble.innerHTML = userMsg.replace(/\n/g, '<br>');
    } else {
      appendBubble('ai', userMsg);
    }
    console.error('[AI]', err);
  }
}


