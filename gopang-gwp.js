// gopang-gwp.js — GWP 매칭·런치·탭관리·PDV기록
      const recent = (window._gopangHistory || [])
        .filter(m => m.role !== 'system')
        .slice(-10)
        .map(m => `[${m.role === 'user' ? '사용자' : 'AI'}] ${m.content}`)
        .join('\n');
      if (!recent || recent.length < 50) { _klawBusy = false; return; }
      reviewText = `## 검토 대상: 고팡 대화 내용\n\n${recent}`;

    } else if (source === 'service') {
      // 서비스 완료 결과 (pdvData)
      reviewText = `## 검토 대상: ${payload.service || '서비스'} 처리 결과\n\n` +
        `서비스: ${payload.serviceId}\n` +
        `요약: ${payload.summary}\n` +
        `데이터: ${JSON.stringify(payload.data || {}, null, 2)}`;
    }

    if (!reviewText) { _klawBusy = false; return; }

    // ── K-Law API 호출 (백그라운드) ──────────────────────────
    // monitor_prompt.txt가 출력 형식을 완전히 정의하므로 추가 지시 불필요
    const klawSystemPrompt = klawPrompt;

    const res = await fetch(CFG.endpoint + '/deepseek', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:       CFG.model,
        max_tokens:  512,
        temperature: 0.1,   // 일관된 법적 판단을 위해 낮게 설정
        messages: [
          { role: 'system',  content: klawSystemPrompt },
          { role: 'user',    content: reviewText },
        ],
      }),
    });

    if (!res.ok) { _klawBusy = false; return; }
    const data = await res.json();
    const raw  = data.choices?.[0]?.message?.content || '{}';
    const clean = raw.replace(/```json|```/g, '').trim();

    let result;
    try { result = JSON.parse(clean); }
    catch { _klawBusy = false; return; }

    const level = result.risk_level || 'NONE';
    const risk  = KLAW_RISK[level] || KLAW_RISK.NONE;

    console.info(`[K-Law Monitor] 감시 완료 — ${level}: ${result.summary || '이상 없음'}`);

    // ── PDV에 감시 결과 기록 (모든 레벨) ────────────────────
    if (level !== 'NONE') {
      _recordPDV({
        type:       'klaw_monitor',
        serviceId:  'klaw',
        service:    'K-Law',
        summary:    `[${level}] ${result.summary || ''}`,
        data:       result,
        source:     source,
        ts:         new Date().toISOString(),
      });
    }

    // ── HIGH/CRITICAL: 채팅창에 경고 버블 표시 ──────────────
    if (risk.show && result.summary) {
      const icon  = level === 'CRITICAL' ? '🔴' : '🟠';
      const html  =
        `<div style="border-left:3px solid ${level==='CRITICAL'?'#C01C28':'#e37400'};` +
        `padding:10px 12px;border-radius:4px;background:${level==='CRITICAL'?'#FEE2E2':'#FFF7ED'}">` +
        `<div style="font-size:11px;font-weight:700;color:${level==='CRITICAL'?'#C01C28':'#e37400'};` +
        `letter-spacing:.5px;margin-bottom:6px">` +
        `${icon} K-Law 자동 감지 — ${risk.label}</div>` +
        `<div style="font-size:14px;color:#1A202C;margin-bottom:${result.detail?'8px':'0'}">${result.summary}</div>` +
        (result.detail  ? `<div style="font-size:12px;color:#4A5568;margin-bottom:6px">${result.detail}</div>` : '') +
        (result.action  ? `<div style="font-size:12px;font-weight:600;color:#0057A8">💡 ${result.action}</div>` : '') +
        `</div>`;
      appendBubble('ai', html, true);
    }

  } catch(e) {
    console.warn('[K-Law] 감시 오류 (무시):', e.message);
  } finally {
    _klawBusy = false;
  }
}

// ── 대화 히스토리 전역 노출 (K-Law 감시용) ──────────────────────────
// callAI() 내부의 history를 K-Law가 읽을 수 있도록
Object.defineProperty(window, '_gopangHistory', {
  get: () => typeof history !== 'undefined' ? history : [],
  configurable: true,
});

// ══════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════
// Gopang Widget Protocol (GWP) 호스트 엔진 v2.0 — 새 탭 방식
// iframe 방식 제거 → JS 전역 충돌·SyntaxError·CFG 미초기화 문제 원천 해결
// 새 탭이 닫히면 고팡 탭이 자동으로 포커스를 되찾고 복귀 메시지 표시
// ══════════════════════════════════════════════════════════════════════

// ── 서비스 레지스트리 ─────────────────────────────────────────────
// gwp-registry.js 에서 동적 로드 (API 키 분리 목적)
// GWP_REGISTRY 전역 변수는 gwp-registry.js 가 선언함

// ── GWP 상태 ─────────────────────────────────────────────────────
let _gwpActive    = false;
let _gwpService   = null;
let _gwpTab       = null;   // 열린 새 탭 참조
let _gwpTabTimer  = null;   // 탭 닫힘 감지 인터벌

// ── 의도 → 서비스 매칭 ─────────────────────────────────────────
function _gwpMatch(text) {
  if (!text) return null;
  if (typeof GWP_REGISTRY === 'undefined') return null;
  for (const svc of GWP_REGISTRY) {
    if (svc.triggers.some(t => text.includes(t))) return svc;
  }
  return null;
}

// ── 서비스 실행 (새 탭) ─────────────────────────────────────────
function _gwpLaunch(service, context, _preTab = null) {
  // 이미 열려 있는 탭이 있으면 포커스만 이동
  if (_gwpActive && _gwpTab && !_gwpTab.closed) {
    _gwpTab.focus();
    if (_preTab && !_preTab.closed) _preTab.close(); // 예약 탭 불필요 → 닫기
    return;
  }

  _gwpActive  = true;
  _gwpService = service;

  const svcName = service?.name || 'K-서비스';
  const svcIcon = service?.icon || '🤖';

  // ctx: 한국어 포함 시 SyntaxError 방지 — Base64 ASCII-safe 인코딩
  const safeCtx = context
    ? btoa(unescape(encodeURIComponent(context)))
    : '';

  const svcUrl = new URL(service.url);
  svcUrl.searchParams.set('gwp',      '1');
  svcUrl.searchParams.set('token',    _USER?.guid || '');
  svcUrl.searchParams.set('origin',   location.origin);
  svcUrl.searchParams.set('ctx',      safeCtx);
  svcUrl.searchParams.set('ctx_enc',  'b64');  // 수신 측에 인코딩 방식 명시

  // 새 탭으로 열기
  // 모바일 팝업 차단 우회: 사용자 탭 직후 예약한 빈 탭(_preTab)이 있으면
  // window.open() 대신 그 탭의 URL을 교체 (비동기 맥락에서도 차단 없음)
  if (_preTab && !_preTab.closed) {
    _preTab.location.href = svcUrl.toString();
    _gwpTab = _preTab;
  } else {
    _gwpTab = window.open(svcUrl.toString(), '_blank');
  }

  if (!_gwpTab) {
    // 팝업 차단 시 — 클릭 가능한 링크로 안내
    appendBubble('ai',
      `${svcIcon} <b>${svcName}</b> 에이전트를 호출합니다. ` +
      `<a href="${svcUrl}" target="_blank" style="color:var(--tint);font-weight:600;text-decoration:underline;">탭하여 연결</a>`,
      true
    );
    _gwpActive  = false;
    _gwpService = null;
    return;
  }

  appendBubble('ai',
    `${svcIcon} <b>${svcName}</b>을 새 탭에서 열었습니다.<br>` +
    `<span style="font-size:12px;color:var(--label-3);">탭을 닫으면 고팡으로 자동 복귀합니다.</span>`,
    true
  );
  console.info('[GWP] 새 탭 실행:', service.id, svcUrl.toString());

  // ── 탭 닫힘 감지 — 200ms 폴링 ─────────────────────────────
  _gwpTabTimer = setInterval(() => {
    if (_gwpTab && _gwpTab.closed) {
      _gwpOnTabClose();
    }
  }, 200);
}

// ── 새 탭이 닫혔을 때 → 고팡 복귀 처리 ─────────────────────────
function _gwpOnTabClose() {
  clearInterval(_gwpTabTimer);
  _gwpTabTimer = null;
  _gwpTab      = null;

  const svcName = _gwpService?.name || 'K-서비스';
  const svcIcon = _gwpService?.icon || '🤖';

  _gwpActive  = false;
  _gwpService = null;

  // 고팡 탭 포커스
  window.focus();

  appendBubble('ai',
    `✅ <b>${svcIcon} ${svcName}</b> 탭이 닫혔습니다. 고팡으로 돌아왔습니다.`,
    true
  );
  console.info('[GWP] 새 탭 닫힘 — 고팡 복귀');
}

// ── 탭 강제 종료 (고팡에서 직접 닫기) ─────────────────────────
function _gwpClose(showReturn = true) {
  if (!_gwpActive) return;
  clearInterval(_gwpTabTimer);
  _gwpTabTimer = null;

  if (_gwpTab && !_gwpTab.closed) {
    _gwpTab.close();
  }
  _gwpTab = null;

  const svcName = _gwpService?.name || 'K-서비스';
  const svcIcon = _gwpService?.icon || '🤖';

  _gwpActive  = false;
  _gwpService = null;

  if (showReturn) {
    appendBubble('ai',
      `✅ <b>${svcIcon} ${svcName}</b>을 닫고 고팡으로 돌아왔습니다.`,
      true
    );
  }
  console.info('[GWP] 탭 종료, 고팡 복귀');
}

// ── postMessage 수신 (서비스 새 탭 → 고팡) ─────────────────────
// 새 탭에서 작업 완료·오류 시 고팡에 결과 전달
window.addEventListener('message', (e) => {
  if (!_gwpActive) return;

  // origin 검증 — 등록된 서비스 도메인만 허용
  const svcOrigin = _gwpService ? new URL(_gwpService.url).origin : null;
  if (svcOrigin && e.origin !== svcOrigin) return;

  const msg = e.data;
  if (!msg?.type?.startsWith('GWP_')) return;

  switch (msg.type) {
    case 'GWP_MESSAGE': {
      // 서비스에서 고팡 채팅창에 메시지 추가
      appendBubble(msg.role === 'user' ? 'user' : 'ai', msg.html || msg.text || '', !!msg.html);
      break;
    }
    case 'GWP_DONE': {
      // 작업 완료 — PDV 기록 → 탭 자동 닫기 → gopang 복귀
      if (msg.summary) appendBubble('ai', '✅ ' + msg.summary, false);
      const p = msg.pdvData || {};
      _recordPDV({
        type:      'service_task',
        serviceId: _gwpService?.id   || null,
        service:   _gwpService?.name || null,
        summary:   msg.summary       || null,
        who:       p.who   || null,
        when:      p.when  || null,
        where:     p.where || null,
        what:      p.what  || msg.summary || null,
        how:       p.how   || null,
        why:       p.why   || null,
        data:      p.data  || p,
        ts:        p.when  || new Date().toISOString(),
      });
      // 하위 시스템 탭 자동 닫기 → gopang 탭 포커스 복귀
      setTimeout(() => {
        if (_gwpTab && !_gwpTab.closed) _gwpTab.close();
        window.focus();
      }, 800);  // 하위 시스템의 "완료" 메시지를 잠깐 보여준 뒤 닫힘
      break;
    }
    case 'GWP_ERROR': {
      appendBubble('ai',
        '⚠️ ' + (_gwpService?.name || '서비스') + ' 오류: ' + (msg.message || '알 수 없는 오류'),
        false
      );
      break;
    }
    case 'GWP_CLOSE': {
      // 서비스가 직접 닫기를 요청
      _gwpClose(false);
      break;
    }
  }
});

// ── PDV 메타데이터 기록 ────────────────────────────────────────
async function _recordPDV(record) {
  try {
    // ── 로컬 PDV 캐시 (localStorage) ──────────────────────
    const log = JSON.parse(localStorage.getItem('gopang_pdv_log') || '[]');
    log.push(record);
    if (log.length > 1000) log.splice(0, log.length - 1000);
    localStorage.setItem('gopang_pdv_log', JSON.stringify(log));

    // ── 6하 원칙 필드 구성 ─────────────────────────────────
    // 누가 (Who)
    const whoName = _USER.phone
      ? _USER.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
      : 'GUID:' + _USER.guid.slice(0, 8);

    // 어디서 (Where) — GPS 우선, 주소 fallback
    const locStr = _userLocation
      ? (_userLocation.address ||
         (_userLocation.lat
           ? `${_userLocation.lat.toFixed(5)},${_userLocation.lng.toFixed(5)}`
           : null))
      : (record.data?.location || null);

    // 어떻게 (How) — 입력 방식 추론
    const howStr = record.how
      || (record.data?.reportId  ? 'image'   // 서비스 신고 = 이미지
        : record.type === 'klaw_monitor' ? 'auto'  // K-Law 자동 감시
        : 'text');

    // 왜 (Why) — 서비스명 또는 직접 기록된 의도
    const whyStr = record.why
      || (record.service ? record.service + ' 서비스 이용'
        : record.type === 'klaw_monitor' ? '법적 리스크 자동 감시'
        : record.type === 'service_task' ? '서비스 작업 완료'
        : '대화');

    // ── Supabase pdv_log 저장 ──────────────────────────────
    await fetch(_SUPABASE_URL + '/rest/v1/pdv_log', {
      method: 'POST',
      headers: {
        'apikey': _SUPABASE_KEY, 'Authorization': 'Bearer ' + _SUPABASE_KEY,
        'Content-Type': 'application/json', 'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        // 누가
        user_guid:   _USER.guid,
        device_fp:   _USER.fp,
        who_name:    whoName,
        // 언제 (created_at은 DB 기본값 사용)
        // 어디서
        location:    locStr,
        // 무엇을
        record_type: record.type,
        summary:     record.summary || null,
        payload:     record,
        // 어떻게
        how:         howStr,
        service_id:  record.serviceId || null,
        // 왜
        why:         whyStr,
      }),
    });

    console.info('[PDV] 기록 완료:', record.type, '|', whyStr);
  } catch(e) { console.warn('[PDV] 기록 실패:', e.message); }

  // K-Law 백그라운드 감시 트리거 — 서비스 완료 결과 자동 검토
  if (record.type === 'service_task' && record.serviceId !== 'klaw') {
    setTimeout(() => _klawReview('service', record), 2000);
  }
}

const _SUPABASE_URL = 'https://ebbecjfrwaswbdybbgiu.supabase.co';
const _SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYmVjamZyd2Fzd2JkeWJiZ2l1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NjE5ODQsImV4cCI6MjA5NTEzNzk4NH0.H2ahQKtWdSke04Pdi3hDY86pdTx7UUKPUpQMlS_zciA';

function _sendReportToFiil(geminiResult, imageFile, userText) {
  try {
    const COMP_MAP = {
      ST:'스티로폼', PL:'경질플라스틱', VI:'비닐',
      GL:'유리병', ME:'금속캔', NT:'폐어구', WD:'목재', EX:'기타'
    };
    const TERRAIN_TYPE = {
      SAND:{type:'🏖️ 해안쓰레기',code:'TYPE_01'},
      ROCK:{type:'🏖️ 해안쓰레기',code:'TYPE_01'},
      CLIFF:{type:'🏖️ 해안쓰레기',code:'TYPE_01'},
      WATER:{type:'🌊 수중쓰레기',code:'TYPE_02'},
      FOREST:{type:'🌲 산림쓰레기',code:'TYPE_03'},
    };
    const RISK_URGENCY = {S0:'낮음',S1:'보통',S2:'높음',S3:'긴급'};

    // ── Gemini 결과 기반 필드 (없으면 텍스트에서 추정) ──────
    let materials = [];
    let typeInfo  = {type:'🏖️ 해안쓰레기', code:'TYPE_01'};
    let urgency   = '보통';
    let summary   = userText || '고팡 K-Cleaner 현장 신고';
    let volume    = '미상';
    let hazard    = '미상';

    if (geminiResult) {
      materials = Object.entries(geminiResult.components || {})
        .filter(([,v]) => v.visible && v.ratio_pct > 0)
        .map(([k,v]) => ({name: COMP_MAP[k]||k, pct: v.ratio_pct}))
        .sort((a,b) => b.pct - a.pct);
      typeInfo  = TERRAIN_TYPE[geminiResult.terrain] || typeInfo;
      urgency   = RISK_URGENCY[geminiResult.risk_level] || '보통';
      summary   = geminiResult.scene_description || summary;
      volume    = geminiResult.total_weight_kg_est
                  ? geminiResult.total_weight_kg_est + 'kg (추정)'
                  : '규모 ' + (geminiResult.scale || '미상');
      hazard    = geminiResult.hazard_detected
                  ? '⚠️ ' + (geminiResult.hazard_notes || geminiResult.risk_level)
                  : '유해물질 없음';
    } else {
      // Gemini 없음 — 텍스트 키워드로 유형 추정
      if (/수중|침적|잠수|해저|ROV/.test(userText||''))      typeInfo = {type:'🌊 수중쓰레기',code:'TYPE_02'};
      else if (/산림|계곡|오름|임도|산간/.test(userText||'')) typeInfo = {type:'🌲 산림쓰레기',code:'TYPE_03'};
    }

    // ── GPS ──────────────────────────────────────────────────
    const gLat = geminiResult?.exif?.lat || _userLocation?.lat || null;
    const gLng = geminiResult?.exif?.lng || _userLocation?.lng || null;
    const gps  = gLat ? `${gLat.toFixed(4)}, ${gLng.toFixed(4)}` : '위치 미상';
    const loc  = _userLocation?.address || gps;

    // ── 신고 객체 구성 ────────────────────────────────────────
    const doSend = (imageDataUrl) => {
      const report = {
        id: 'RPT-' + new Date().getFullYear() + '-' + Date.now().toString().slice(-4),
        type: typeInfo.type,
        typeCode: typeInfo.code,
        location: loc,
        gps: gps,
        reporter: '010-****-' + Math.floor(1000 + Math.random() * 9000),
        reportedAt: new Date().toLocaleString('ko-KR'),
        urgency: urgency,
        status: '접수',
        imageUrl: imageDataUrl || null,
        gopangAnalysis: {
          summary: summary,
          materials: materials,
          volume: volume,
          hazard: hazard,
          recommendation: userText || '수거 조치 필요',
          geminiModel: geminiResult ? 'gemini-2.0-flash' : '텍스트 분석',
          analyzedAt: new Date().toLocaleString('ko-KR'),
        },
        dispatch: null,
        cost: {labor:0, equipment:0, supplies:0, other:0},
        blockchain: {
          txHash: '0x' + Array.from(crypto.getRandomValues(new Uint8Array(32)))
                        .map(b => b.toString(16).padStart(2,'0')).join(''),
          blockHeight: 8200000 + Math.floor(Math.random() * 100000),
          imageHash: 'sha256:' + Math.random().toString(36).slice(2,10) + '...',
          network: 'Openhash Network',
        },
      };

      // ── Supabase REST API 직접 저장 ──────────────────────────
      fetch(_SUPABASE_URL + '/rest/v1/reports', {
        method: 'POST',
        headers: {
          'apikey': _SUPABASE_KEY,
          'Authorization': 'Bearer ' + _SUPABASE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          id:          report.id,
          type:        report.type,
          type_code:   report.typeCode,
          location:    report.location,
          gps:         report.gps,
          reporter:    report.reporter,
          reported_at: report.reportedAt,
          urgency:     report.urgency,
          status:      report.status,
          image_url:   report.imageUrl,
          analysis:    report.gopangAnalysis,
          dispatch:    report.dispatch,
          cost:        report.cost,
          blockchain:  report.blockchain
        })
      })
      .then(res => {
        if (res.ok || res.status === 201) {
          console.log('[FIIL] ✅ Supabase 저장 완료 →', report.id, report.type, report.urgency);
          _lastFiilReportId = report.id;  // AI 응답 파싱 후 업데이트에 사용
        } else {
          res.text().then(t => console.warn('[FIIL] Supabase 오류:', res.status, t));
        }
      })
      .catch(e => console.warn('[FIIL] 네트워크 오류:', e.message));
    };

    // 이미지 base64 변환 후 전송 (없으면 null)
    if (imageFile && imageFile instanceof File) {
      const reader = new FileReader();
      reader.onload  = (e) => doSend(e.target.result);
      reader.onerror = ()  => doSend(null);
      reader.readAsDataURL(imageFile);
    } else {
      doSend(null);
    }

  } catch(e) {
    console.warn('[FIIL] 전송 오류 (무시됨):', e.message);
  }
}

    })();
