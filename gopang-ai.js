// gopang-ai.js — callAI·poll·스트리밍
async function callAI(userText, imageFile = null, _preTab = null) {
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
  if (CFG.system_base) CFG.system = CFG.system_base;

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
  if (history.length === 0) {
    // 세션 최초 — system + locNote 고정
    const locNote = _buildLocNote();
    history.push({ role: 'system', content: CFG.system + locNote });
    console.log('[Cache] 세션 최초 — system 1회 삽입');
  }
  // history[0] system 고정 유지 — 전문가 SP 없으므로 교체 불필요

  // 2) user: messages 전송 직전에 history에 추가
  const userRecord = { role: 'user', content: typeof userContent === 'string' ? userContent : `[첨부: 이미지]` };
  history.push(userRecord);

  // 3) messages: history 전체 (system + 대화 누적 + 현재 user)
  //    단, 이미지가 있을 경우 마지막 user content는 multipart로 교체
  const messages = [
    ...history.slice(0, -1),                        // system + 이전 대화
    { role: 'user', content: userContent },         // 현재 user (이미지 포함 가능)
  ];

  // ── 엔드포인트 + API Key 결정 ────────────────────────────
  const epSel   = document.getElementById('setting-endpoint');
  const savedKey = document.getElementById('setting-apikey')?.value?.trim();
  // Worker 프록시 사용 시: API 키 불필요 (Worker 환경변수에서 관리)
  // 직접 API 사용 시: 설정 키 또는 CFG.apiKey 사용
  const isProxy = CFG.endpoint.includes('workers.dev');
  const apiKey  = isProxy ? '' : ((savedKey && savedKey.startsWith('sk-')) ? savedKey : CFG.apiKey);

  let baseUrl = CFG.endpoint;
  if (document.getElementById('setting-endpoint')?.value === 'custom') {
    const customUrl = document.getElementById('custom-endpoint-url')?.value?.trim();
    if (customUrl) baseUrl = customUrl;
  }
  // 끝 슬래시 제거
  baseUrl = baseUrl.replace(/\/+$/, '');

  const activeModel = CFG.model;
  console.log(`[AI] 호출 → ${baseUrl}/chat/completions | 모델: ${activeModel} | ${isProxy ? '프록시(보안)' : 'Key: ' + apiKey.slice(0,8) + '...'}`);

  // ── 스트리밍 호출 ─────────────────────────────────────────
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        // 프록시 사용 시: Authorization 헤더 미전송 (Worker가 자체 키 사용)
        // 직접 API 사용 시: Bearer 키 전송
        ...(isProxy ? {} : { 'Authorization': `Bearer ${apiKey}` }),
      },
      body: JSON.stringify({
        model: CFG.model,
        messages,
        max_tokens:  2000,
        temperature: 0.6,
        stream:      true,
        stream_options: { include_usage: true },  // 캐시 히트 토큰 수 확인용
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`API ${res.status}: ${errBody.slice(0, 300) || '응답없음'}`);
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
      }
    }

    // ── AUTH 태그 감지 → 인증 요구 ──────────────────────────
    const authMatch = fullReply.match(/\[AUTH:(L[0-3])\]/);
    if (authMatch) {
      const requiredLevel = authMatch[1];
      const stored = JSON.parse(localStorage.getItem('gopang_user_v3') || 'null');
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

// ── 스트리밍 버블 헬퍼 ───────────────────────────────────────
function _createStreamBubble() {
  const list   = document.getElementById('message-list');
  const row    = document.createElement('div');
  row.className = 'msg-row ai';
  const bubble = document.createElement('div');
  bubble.className = 'bubble bubble-ai streaming';
  row.appendChild(bubble);
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;
  return bubble;
}

function _updateStreamBubble(bubble, text) {
  // 마크다운 굵게(**text**) → <b> 간단 변환 + 줄바꿈 처리
  bubble.innerHTML = text
    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
    .replace(/\n/g, '<br>');
  const list = document.getElementById('message-list');
  list.scrollTop = list.scrollHeight;
}

// ── 버블 렌더링 ─────────────────────────────────────────
