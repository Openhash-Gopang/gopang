/**
 * gwp/engine.js — Gopang Widget Protocol 엔진 (새 탭 방식)
 */
import { _gwpActive, _gwpService, _gwpTab, _gwpTabTimer,
         setGwpActive, setGwpService, setGwpTab, setGwpTabTimer,
         _USER, PROXY, _userLocation } from '../core/state.js';
import { appendBubble } from '../ui/bubble.js';
import { _recordPDV } from '../pdv/record.js';
import { _patchL1LedgerUserHash, _patchPdvChainHeight,
         _markPdvAnchored } from '../pdv/record.js';
import { summarizeTranscript6W } from '../ai/report-utils.js';
import { _handleGwpSignRequest } from './sign.js';
import { GWP_ALLOWED_ORIGINS } from './allowed-origins.js';

// ★ 2026-07-11 Phase 0 신설(파이프라인 사고실험 미비점4) — PDV 기록과
// 함께 gwp_registry.call_count_30d를 증분한다. 정기 갱신 방법론
// (docs/SP-AUTHOR-AUTOMATION_v1_0.md §2)의 데이터 소스가 지금까지
// 비어 있었던 걸 채운다. 증분 실패가 PDV 기록 자체를 막으면 안 되므로
// _recordPDV를 먼저 기다리고, 증분은 fire-and-forget으로 뒤에 붙인다.
async function _recordPDVAndBumpRegistry(record) {
  const result = await _recordPDV(record);
  const svcId = record?.serviceId;
  if (svcId) {
    fetch(`${PROXY}/gwp-registry/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gwp_id: svcId, increment_call_count: true }),
    }).catch((e) => {
      console.warn('[gwp-registry] call_count_30d 증분 실패(PDV 기록은 정상 완료됨):', e.message);
    });
  }
  return result;
}

// Gopang Widget Protocol (GWP) 호스트 엔진 v2.0 — 새 탭 방식
// iframe 방식 제거 → JS 전역 충돌·SyntaxError·CFG 미초기화 문제 원천 해결
// 새 탭이 닫히면 고팡 탭이 자동으로 포커스를 되찾고 복귀 메시지 표시
// ══════════════════════════════════════════════════════════════════════

// ── 서비스 레지스트리 ─────────────────────────────────────────────
// gwp-registry.js 에서 동적 로드 (API 키 분리 목적)
// GWP_REGISTRY 전역 변수는 gwp-registry.js 가 선언함

// ── "예외 없이 보고" 추적용 상태 ────────────────────────────────
// GWP_DONE을 한 번도 못 받고 탭이 닫히는 경우를 위한 폴백 요약 자료.
let _gwpReported    = false;  // GWP_DONE 수신 여부 (true면 폴백 불필요)
let _gwpMessageLog  = [];     // GWP_MESSAGE로 중계된 대화만 누적(전체 탭 내용은 알 수 없음)


// ※ _gwpMatch()는 2026-07-05 제거됨 — 호출부 0건(죽은 코드). 실제
// 라우팅은 AGENT-COMMON의 [GWP:]/[EXPERT:] 태그가 직접 수행한다.

// ── 서비스 실행 (새 탭) ─────────────────────────────────────────
// @param {object|null} facts — services/location.js의 _buildRoutingFacts()
//   결과. 민감 정보(PDV 이력 등)를 담지 않는다는 전제로 URL에 실린다 —
//   호출부에서 이 계약을 위반하는 값을 넣지 않도록 주의.
export function _gwpLaunch(service, context, _preTab = null, facts = null) {
  // 기존 탭이 열려있으면 닫고 새 ctx로 재시작
  if (_gwpTab && !_gwpTab.closed) {
    _gwpTab.close();
    setGwpTab(null);
  }
  if (_gwpTabTimer) {
    clearInterval(_gwpTabTimer);
    setGwpTabTimer(null);
  }
  setGwpActive(false);
  setGwpService(null);

  setGwpActive(true);
  setGwpService(service);
  _gwpReported   = false;   // 새 세션 — 보고 수신 여부 초기화
  _gwpMessageLog = [];       // 새 세션 — 대화 로그 초기화

  const svcName = service?.name || 'K-서비스';
  const svcIcon = service?.icon || '🤖';

  // ctx: 한국어 포함 시 SyntaxError 방지 — Base64 ASCII-safe 인코딩
  const safeCtx = context
    ? btoa(unescape(encodeURIComponent(context)))
    : '';

  const svcUrl = new URL(service.url);
  svcUrl.searchParams.set('gwp',      '1');
  svcUrl.searchParams.set('token',    _USER?.ipv6 || _USER?.guid || '');
  svcUrl.searchParams.set('origin',   location.origin);
  svcUrl.searchParams.set('ctx',      safeCtx);
  svcUrl.searchParams.set('ctx_enc',  'b64');  // 수신 측에 인코딩 방식 명시

  // facts: 메인 비서가 이미 확보한 부가 정보(현재는 currentLocation만) —
  // ctx와 동일한 이유로 base64 인코딩. null/빈 객체면 아예 파라미터를
  // 생략해 URL을 불필요하게 늘리지 않는다.
  if (facts && Object.keys(facts).length) {
    try {
      const safeFacts = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
      svcUrl.searchParams.set('facts',     safeFacts);
      svcUrl.searchParams.set('facts_enc', 'b64');
    } catch (e) {
      console.warn('[GWP] facts 인코딩 실패 (무시하고 계속):', e.message);
    }
  }

  // 새 탭으로 열기
  // 모바일 팝업 차단 우회: 사용자 탭 직후 예약한 빈 탭(_preTab)이 있으면
  // window.open() 대신 그 탭의 URL을 교체 (비동기 맥락에서도 차단 없음)
  if (_preTab && !_preTab.closed) {
    _preTab.location.href = svcUrl.toString();
    setGwpTab(_preTab);
  } else {
    setGwpTab(window.open(svcUrl.toString(), '_blank'));
  }

  if (!_gwpTab) {
    // 팝업 차단 시 — 클릭 가능한 링크로 안내
    appendBubble('ai',
      `${svcIcon} <b>${svcName}</b> 에이전트를 호출합니다. ` +
      `<a href="${svcUrl}" target="_blank" style="color:var(--tint);font-weight:600;text-decoration:underline;">탭하여 연결</a>`,
      true
    );
    setGwpActive(false);
    setGwpService(null);
    return;
  }

  appendBubble('ai',
    `${svcIcon} <b>${svcName}</b>을 새 탭에서 열었습니다.<br>` +
    `<span style="font-size:12px;color:var(--label-3);">탭을 닫으면 고팡으로 자동 복귀합니다.</span>`,
    true
  );
  console.info('[GWP] 새 탭 실행:', service.id, svcUrl.toString());

  // ── 탭 닫힘 감지 — 200ms 폴링 ─────────────────────────────
  setGwpTabTimer(setInterval(() => {
    if (_gwpTab && _gwpTab.closed) {
      _gwpOnTabClose();
    }
  }, 200));
}

// ── 새 탭이 닫혔을 때 → 고팡 복귀 처리 ─────────────────────────
function _gwpOnTabClose() {
  clearInterval(_gwpTabTimer);
  setGwpTabTimer(null);
  setGwpTab(null);

  const svc      = _gwpService;
  const reported = _gwpReported;
  const svcName  = _gwpService?.name || 'K-서비스';
  const svcIcon  = _gwpService?.icon || '🤖';

  setGwpActive(false);
  setGwpService(null);

  // 고팡 탭 포커스
  window.focus();

  if (reported) {
    appendBubble('ai',
      `✅ <b>${svcIcon} ${svcName}</b> 탭이 닫혔습니다. 고팡으로 돌아왔습니다.`,
      true
    );
    console.info('[GWP] 새 탭 닫힘 — 고팡 복귀(보고 수신됨)');
  } else {
    // ── "예외 없이 보고" 원칙 — GWP_DONE 없이 닫힌 경우 강제 폴백 ──
    _gwpFallbackReport(svc).catch(e =>
      console.warn('[GWP] 폴백 보고 실패(무시):', e.message)
    );
    console.info('[GWP] 새 탭 닫힘 — 보고 미수신, 폴백 처리 중');
  }
}

// ── 보고 없이 종료된 경우의 강제 요약·PDV 기록 ───────────────────
// GWP_MESSAGE로 중계된 대화가 있으면 LLM에게 6하원칙 요약을 강제 요청하고,
// 중계된 내용이 전혀 없으면("탭 안에서 무슨 일이 있었는지 알 수 없음") 그
// 사실 자체를 최소 기록으로 남긴다 — 어느 경우든 PDV 기록은 예외 없이 남는다.
async function _gwpFallbackReport(svc) {
  const svcName = svc?.name || 'K-서비스';
  const log     = _gwpMessageLog.slice();
  _gwpMessageLog = [];

  const hasLog = log.length > 0;
  let report6w = null;

  if (hasLog) {
    const transcript = log
      .map(m => `[${m.role === 'user' ? '사용자' : svcName}] ${m.text}`)
      .join('\n');
    report6w = await summarizeTranscript6W(transcript);
  }

  const summaryText = report6w?.what || report6w?.result ||
    (hasLog
      ? `${svcName} 이용 중 탭이 보고 없이 종료됨(중계된 대화 ${log.length}건 — 요약 실패)`
      : `${svcName} 탭이 보고 없이 종료되어 상세 대화 내용을 확인할 수 없습니다.`);

  await _recordPDVAndBumpRegistry({
    type:      'agent_report_fallback',
    serviceId: svc?.id   || null,
    service:   svcName,
    summary:   summaryText,
    who:       report6w?.who   || _USER?.nickname || _USER?.ipv6 || null,
    when:      report6w?.when  || new Date().toISOString(),
    where:     report6w?.where || '혼디',
    what:      report6w?.what  || summaryText,
    how:       report6w?.how   || (hasLog ? 'gwp_tab_closed_llm_summary' : 'gwp_tab_closed_no_report'),
    why:       report6w?.why   || '',
    ts:        new Date().toISOString(),
  });

  appendBubble('ai',
    hasLog
      ? `📋 <b>${svcName}</b> 탭이 보고 없이 닫혀, 중계된 대화를 요약해 PDV에 기록했습니다.`
      : `⚠️ <b>${svcName}</b> 탭이 보고 없이 닫혔습니다. 상세 내용 없이 이용 사실만 PDV에 기록했습니다.`,
    true
  );
  console.info('[GWP] 폴백 보고 완료 | hasLog:', hasLog, '| 요약:', summaryText);
}

// ── 탭 강제 종료 (고팡에서 직접 닫기) ─────────────────────────
export function _gwpClose(showReturn = true) {
  if (!_gwpActive) return;
  clearInterval(_gwpTabTimer);
  setGwpTabTimer(null);

  if (_gwpTab && !_gwpTab.closed) {
    _gwpTab.close();
  }
  setGwpTab(null);

  const svc      = _gwpService;
  const reported = _gwpReported;
  const svcName  = _gwpService?.name || 'K-서비스';
  const svcIcon  = _gwpService?.icon || '🤖';

  setGwpActive(false);
  setGwpService(null);

  if (!reported) {
    // "예외 없이 보고" 원칙 — 직접 닫기에도 동일하게 적용
    _gwpFallbackReport(svc).catch(e =>
      console.warn('[GWP] 폴백 보고 실패(무시):', e.message)
    );
  }

  if (showReturn) {
    appendBubble('ai',
      `✅ <b>${svcIcon} ${svcName}</b>을 닫고 고팡으로 돌아왔습니다.`,
      true
    );
  }
  console.info('[GWP] 탭 종료, 고팡 복귀 | 보고수신:', reported);
}

// ── PDV 중개 접근 (JEJU-GOV-COMMON §13) ─────────────────────────
// PDV는 나만의 AI 비서(이 탭, hondi.net)만 직접 읽는다. 다른 GWP 서비스 탭이
// GWP_PDV_REQUEST로 필드를 요청하면, 사용자에게 승인/거부를 확인한 뒤에만
// 응답한다. PDV에 실제로 없는 필드는 지어내지 않고 not_in_pdv로 답한다.

// 지금 PDV(localStorage 프로필)에 실제로 존재하는 필드만 매핑한다.
// 가구원수/월소득/재산 등은 PDV 스키마 자체에 아직 없다(§13-4) — 정직하게
// not_in_pdv로 응답해야지, 빈 문자열이나 추정치로 채우면 안 된다.
function _readPdvField(field) {
  try {
    const user = JSON.parse(localStorage.getItem('gopang_user_v4') || 'null');
    // ★ 2026-07-24 수정 — localStorage의 'gopang_profile_address'는 어디서도
    // 써진 적 없는 죽은 키였다(location.js 쪽에서 이미 확인됨). 대신
    // location.js가 앱 시작 시 이미 해석해둔 _userLocation.address(①프로필
    // 서버값 우선 ②없으면 GPS+Kakao 역지오코딩)를 그대로 읽는다 — 이 값은
    // 이미 계산 완료된 상태라 여기서 새로 네트워크 호출을 할 필요가 없고,
    // 이 함수를 동기로 유지할 수 있다(호출부가 버튼 클릭 핸들러 안이라
    // 비동기로 바꿔도 문제는 없었겠지만, 이미 있는 값을 재사용하는 쪽이
    // 더 간단하고 빠르다).
    const addr = _userLocation?.address || null;
    const KNOWN = {
      '주소': addr || null,
      '이름': user?.name || null,
      '연락처': user?.phone || null,
      '유형': user?.type || null,
      '업종': user?.industry || null,
    };
    if (field in KNOWN && KNOWN[field] != null) return KNOWN[field];

    // 2026-07-13 확장 — gopang_pdv_log(welcome.js _recordProfileToPDV가
    // { data: { field, value } } 형태로 이미 기록해두고 있던 실제 활동
    // 이력)에서 필드명이 일치하는 최신 값을 찾는다. KNOWN에 없는 필드
    // (예: "취급 상품·서비스")는 여기서만 찾을 수 있다 — 새 저장 경로를
    // 만들지 않고 이미 쌓이고 있던 데이터를 조회만 가능하게 한다.
    try {
      const log = JSON.parse(localStorage.getItem('gopang_pdv_log') || '[]');
      if (Array.isArray(log)) {
        for (let i = log.length - 1; i >= 0; i--) {
          const r = log[i];
          if (r?.data?.field === field && r.data.value != null) return r.data.value;
        }
      }
    } catch {}

    return { not_in_pdv: true };
  } catch {
    return { not_in_pdv: true };
  }
}

function _handlePdvRequest(msg, source, origin) {
  const { request_id, requesting_sp, fields = [], reason } = msg;
  const svcName = _gwpService?.name || origin;

  const bubbleId = 'pdv-req-' + request_id;
  appendBubble('ai',
    `<div id="${bubbleId}">` +
    `🔒 <b>${svcName}</b>이(가) 다음 정보를 요청합니다: <b>${fields.join(', ')}</b><br>` +
    `<span style="color:var(--sub,#6b7280);font-size:13px">사유: ${reason || '(사유 미제공)'}</span><br><br>` +
    `<button onclick="window._pdvRequestRespond('${request_id}', true)" style="margin-right:8px">제공하기</button>` +
    `<button onclick="window._pdvRequestRespond('${request_id}', false)">거부하기</button>` +
    `</div>`,
    true
  );

  window._pdvRequestRespond = (reqId, approved) => {
    if (reqId !== request_id) return; // 다른 요청의 버튼 오클릭 방지
    const el = document.getElementById(bubbleId);
    if (el) el.innerHTML = approved
      ? `✅ ${fields.join(', ')} 정보를 제공했습니다.`
      : `🚫 정보 제공을 거부했습니다.`;

    let values = null;
    if (approved) {
      values = {};
      for (const f of fields) values[f] = _readPdvField(f);
    }
    source.postMessage({
      type: 'GWP_PDV_RESPONSE',
      request_id,
      approved,
      values, // approved=false면 null
    }, origin);
  };
}

// ── G19(HUMAN-AUTHORITY-GATE-SCHEMA) — 외부 발급 서류 획득·전달 ────────
// PDV 요청과 구조는 같지만(오프너 탭이 사용자 승인을 받아 요청 탭에
// 응답), 값이 아니라 "사용자가 방금 첨부한 파일"이라는 점이 다르다 —
// 오프너가 대신 값을 채워줄 수 없고, 반드시 사용자의 실제 액션(파일
// 선택)을 기다려야 한다. 5MB 상한은 postMessage 페이로드 비대화·악성
// 대용량 첨부를 막기 위함(문서 G19 참고) — 실제 서류(PDF/이미지)는
// 보통 이 이내다.
const _DOC_ACQUIRE_MAX_BYTES = 5 * 1024 * 1024; // 5MB

function _readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // data:<mime>;base64,<data> 형식에서 data 부분만 분리
      const result = String(reader.result || '');
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('파일 읽기 실패'));
    reader.readAsDataURL(file);
  });
}

function _handleDocAcquireRequest(msg, source, origin) {
  const { request_id, requesting_sp, doc_type, reason } = msg;
  const svcName = _gwpService?.name || origin;
  const bubbleId = 'doc-acq-' + request_id;

  appendBubble('ai',
    `<div id="${bubbleId}">` +
    `📄 <b>${svcName}</b>이(가) 서류를 요청합니다: <b>${doc_type}</b><br>` +
    `<span style="color:var(--sub,#6b7280);font-size:13px">사유: ${reason || '(사유 미제공)'}</span><br>` +
    `<span style="color:var(--sub,#6b7280);font-size:13px">정부24 앱에서 발급받은 파일을 아래로 첨부해주세요(PDF·이미지, 5MB 이내).</span><br><br>` +
    `<input type="file" id="doc-acq-file-${request_id}" accept="application/pdf,image/*" style="margin-right:8px">` +
    `<button onclick="window._docAcquireRespond('${request_id}', true)" style="margin-right:8px">첨부 제출</button>` +
    `<button onclick="window._docAcquireRespond('${request_id}', false)">건너뛰기</button>` +
    `</div>`,
    true
  );

  window._docAcquireRespond = async (reqId, approved) => {
    if (reqId !== request_id) return; // 다른 요청의 버튼 오클릭 방지
    const el = document.getElementById(bubbleId);
    const fileInput = document.getElementById(`doc-acq-file-${request_id}`);
    const file = fileInput?.files?.[0] || null;

    if (approved && !file) {
      // 첨부 없이 "제출" 눌렀을 때 — 조용히 무시하지 않고 재안내
      if (el) {
        const warn = document.createElement('div');
        warn.style.cssText = 'color:#dc2626;font-size:12px;margin-top:4px';
        warn.textContent = '먼저 파일을 선택해주세요.';
        el.appendChild(warn);
      }
      return;
    }
    if (approved && file.size > _DOC_ACQUIRE_MAX_BYTES) {
      if (el) el.innerHTML += `<div style="color:#dc2626;font-size:12px;margin-top:4px">파일이 5MB를 초과합니다 — 담당부서에 직접 제출해주세요.</div>`;
      source.postMessage({
        type: 'GWP_DOC_RESPONSE', request_id, approved: false, reason: 'file_too_large', file: null,
      }, origin);
      return;
    }

    let filePayload = null;
    if (approved && file) {
      try {
        const data_b64 = await _readFileAsBase64(file);
        filePayload = { name: file.name, mime: file.type || 'application/octet-stream', size: file.size, data_b64 };
      } catch (e) {
        console.warn('[GWP_DOC] 파일 읽기 실패:', e.message);
        if (el) el.innerHTML += `<div style="color:#dc2626;font-size:12px;margin-top:4px">파일을 읽는 데 실패했습니다 — 다시 시도해주세요.</div>`;
        return;
      }
    }

    if (el) el.innerHTML = (approved && filePayload)
      ? `✅ ${doc_type} 서류(${filePayload.name})를 전달했습니다.`
      : `🚫 서류 제출을 건너뛰었습니다.`;

    source.postMessage({
      type: 'GWP_DOC_RESPONSE',
      request_id,
      approved: !!(approved && filePayload),
      file: filePayload, // approved=false면 null
    }, origin);
  };
}

// ── postMessage 수신 (서비스 새 탭 → 고팡) ─────────────────────
// 새 탭에서 작업 완료·오류·서명 요청 시 고팡에 결과 전달
window.addEventListener('message', (e) => {
  const msg = e.data;
  if (!msg?.type?.startsWith('GWP_')) return;

  // ── GWP_SIGN_REQUEST: 서명 요청은 _gwpActive 무관하게 처리 ──
  // market 탭이 구매자 서명을 고팡에 위임. gopang-wallet.js가 서명 수행.
  // origin: market.gopang.net 또는 gopang.net 계열만 허용
  if (msg.type === 'GWP_SIGN_REQUEST') {
    if (!GWP_ALLOWED_ORIGINS.includes(e.origin)) {
      console.warn('[GWP_SIGN] 허용되지 않은 origin 차단:', e.origin);
      return;
    }
    _handleGwpSignRequest(msg, e.source, e.origin);
    return;
  }

  // ── 나머지 GWP 메시지: _gwpActive 세션 내에서만 처리 ──────
  if (!_gwpActive) return;

  // origin 검증 — 등록된 서비스 도메인만 허용
  const svcOrigin = _gwpService ? new URL(_gwpService.url).origin : null;
  if (svcOrigin && e.origin !== svcOrigin) return;

  switch (msg.type) {
    case 'GWP_PDV_REQUEST': {
      // JEJU-GOV-COMMON §13 — PDV는 나만의 AI 비서만 읽는다. 다른 SP(새 탭)는
      // 이 메시지로 필드를 요청하고, 사용자 승인 후에만 값을 돌려받는다.
      _handlePdvRequest(msg, e.source, e.origin);
      break;
    }
    case 'GWP_DOC_REQUEST': {
      // HUMAN-AUTHORITY-GATE-SCHEMA G19 — 정부24 등 외부 발급 서류는
      // 기관 SP가 직접 확보할 수 없다. 오프너(사용자 그림자 AI)가 실제
      // 파일 첨부를 받아 요청 탭으로 중계한다.
      _handleDocAcquireRequest(msg, e.source, e.origin);
      break;
    }
    case 'GWP_MESSAGE': {
      // 서비스에서 고팡 채팅창에 메시지 추가
      appendBubble(msg.role === 'user' ? 'user' : 'ai', msg.html || msg.text || '', !!msg.html);
      // 보고 없이 탭이 닫힐 경우의 폴백 요약 재료로 누적
      _gwpMessageLog.push({
        role: msg.role === 'user' ? 'user' : 'ai',
        text: msg.text || (msg.html ? msg.html.replace(/<[^>]+>/g, ' ').trim() : ''),
      });
      break;
    }
    case 'GWP_DONE': {
      // 작업 완료 — sessionId 확정 → redeemClaim → PDV 기록/소급 → 탭 자동 닫기
      _gwpReported = true;  // 정식 보고 수신 — _gwpOnTabClose의 폴백을 막는다
      window._lastGwpDone = msg;  // T08 디버그
      if (msg.summary) appendBubble('ai', msg.summary, false);

      // sessionId: reporter_svc 무관하게 항상 확정 (PDV 연동 키)
      const sessionId   = msg.session_id || msg.pdvData?.session_id || crypto.randomUUID();
      const reporterSvc = msg.reporter_svc || msg.pdvData?.reporter_svc || null;

      if (msg.block_hash && window.gopangWallet?.redeemClaim) {
        const claims = msg.claims?.length
          ? msg.claims
          : (msg.buyer_claim ? [msg.buyer_claim] : []);

        window.gopangWallet.redeemClaim({
          block_hash:     msg.block_hash,
          block_id:       msg.block_id  || null,
          tx_hash:        msg.tx_hash   || null,
          claims,
          pdv_session_id: sessionId,
          pdv_type:       'service_task',
        }).then(({ fs, chainRec, applied }) => {
          console.info('[GWP_DONE] redeemClaim 완료',
            '| block_hash:', msg.block_hash.slice(0, 8),
            '| height:', chainRec.height,
            '| session_id:', sessionId.slice(0, 8),
            '| bs-cash:', fs['bs-cash']);
          appendBubble('ai', `거래 완료. 잔액 ₩${fs['bs-cash']?.toLocaleString()}`, false);

          // l1_ledger.user_hash를 클라이언트 local_hash로 교정
          // Worker의 단순화 공식(block∥tx∥height)과 클라이언트 공식(h_{i-1}∥tx∥block∥height)이 다르므로
          // 클라이언트가 직접 PATCH — pdv_chain_integrity JOIN 일치 보장
          _patchL1LedgerUserHash(msg.block_hash, chainRec.local_hash);

          if (!reporterSvc) {
            // 고팡이 직접 PDV 기록
            const p = msg.pdvData || {};
            _recordPDVAndBumpRegistry({
              type:             'service_task',
              serviceId:        _gwpService?.id   || null,
              service:          _gwpService?.name || null,
              summary:          msg.summary       || null,
              who:              p.who   || _USER?.ipv6 || null,
              when:             p.when  || null,
              where:            p.where || null,
              what:             p.what  || msg.summary || null,
              how:              p.how   || 'gwp',
              why:              p.why   || ((_gwpService?.name || '') + ' 서비스 이용'),
              session_id:       sessionId,
              chain_height:     chainRec.height,
              chain_local_hash: chainRec.local_hash,
              block_hash:       msg.block_hash    || null,
              attachedDocs:     msg.attachedDocs || null, // G18 산출물 번들 — 2026-07-19 연결
              ts:               new Date().toISOString(),
            }).then(() => _markPdvAnchored(chainRec.height));
          } else {
            // market 등 하위 시스템이 이미 PDV 기록 → chain_height 소급
            console.info('[GWP_DONE] PDV 중복 방지 — reporter_svc:', reporterSvc,
              '| chain_height 소급:', chainRec.height);
            _patchPdvChainHeight(sessionId, chainRec.height, chainRec.local_hash);
          }
        }).catch(err => console.warn('[GWP_DONE] redeemClaim 실패:', err.message));
      } else if (msg.pdvData) {
        // ★ 신설(2026-07-03) — 결제(block_hash)가 없는 서비스(K-Law, K-Public
        // 계열 등)도 사용자 PDV에 기록한다. 지금까지는 이 분기가 없어서
        // 비결제 서비스가 GWP_DONE을 정상적으로 보내도 gopang이 아무것도
        // 기록하지 않는 조용한 누락이 있었다.
        const p = msg.pdvData;
        _recordPDVAndBumpRegistry({
          type:       'service_task',
          serviceId:  _gwpService?.id   || null,
          service:    _gwpService?.name || null,
          summary:    msg.summary       || null,
          who:        p.who   || _USER?.ipv6 || null,
          when:       p.when  || null,
          where:      p.where || null,
          what:       p.what  || msg.summary || null,
          how:        p.how   || 'gwp',
          why:        p.why   || ((_gwpService?.name || '') + ' 서비스 이용'),
          session_id: sessionId,
          reporter_svc: reporterSvc || null,
          // G18(STAFF_REVIEW_GATE) 산출물 번들 — 2026-07-19 연결. 담당부서
          // 확인·승인 시 "이 세션에서 어떤 서류가 확보됐는지" 조회할 수
          // 있도록 메타데이터만 남긴다. 전용 결재함 UI는 아직 없음(다음
          // 단계) — 지금은 PDV 레코드 조회로만 확인 가능.
          attachedDocs: msg.attachedDocs || null,
          ts:         new Date().toISOString(),
        }).catch(err => console.warn('[GWP_DONE] 비결제 PDV 기록 실패(무시):', err.message));
      }

      // 하위 시스템 탭 자동 닫기 → gopang 탭 포커스 복귀
      setTimeout(() => {
        if (_gwpTab && !_gwpTab.closed) _gwpTab.close();
        window.focus();
      }, 800);
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

