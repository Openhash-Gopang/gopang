/**
 * gwp/engine.js — Gopang Widget Protocol 엔진 (새 탭 방식)
 */
import { _gwpActive, _gwpService, _gwpTab, _gwpTabTimer,
         setGwpActive, setGwpService, setGwpTab, setGwpTabTimer,
         _USER } from '../core/state.js';
import { appendBubble } from '../ui/bubble.js';
import { _recordPDV } from '../pdv/record.js';
import { _patchL1LedgerUserHash, _patchPdvChainHeight,
         _markPdvAnchored } from '../pdv/record.js';
import { summarizeTranscript6W } from '../ai/report-utils.js';

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


// ── 의도 → 서비스 매칭 ─────────────────────────────────────────
export function _gwpMatch(text) {
  if (!text) return null;
  if (typeof GWP_REGISTRY === 'undefined') return null;
  for (const svc of GWP_REGISTRY) {
    if (svc.triggers.some(t => text.includes(t))) return svc;
  }
  return null;
}

// ── 서비스 실행 (새 탭) ─────────────────────────────────────────
export function _gwpLaunch(service, context, _preTab = null) {
  // 기존 탭이 열려있으면 닫고 새 ctx로 재시작
  if (_gwpTab && !_gwpTab.closed) {
    _gwpTab.close();
    _gwpTab = null;
  }
  if (_gwpTabTimer) {
    clearInterval(_gwpTabTimer);
    _gwpTabTimer = null;
  }
  _gwpActive  = false;
  _gwpService = null;

  _gwpActive  = true;
  _gwpService = service;
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

  const svc      = _gwpService;
  const reported = _gwpReported;
  const svcName  = _gwpService?.name || 'K-서비스';
  const svcIcon  = _gwpService?.icon || '🤖';

  _gwpActive  = false;
  _gwpService = null;

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

  await _recordPDV({
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
  _gwpTabTimer = null;

  if (_gwpTab && !_gwpTab.closed) {
    _gwpTab.close();
  }
  _gwpTab = null;

  const svc      = _gwpService;
  const reported = _gwpReported;
  const svcName  = _gwpService?.name || 'K-서비스';
  const svcIcon  = _gwpService?.icon || '🤖';

  _gwpActive  = false;
  _gwpService = null;

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

// ── postMessage 수신 (서비스 새 탭 → 고팡) ─────────────────────
// 새 탭에서 작업 완료·오류·서명 요청 시 고팡에 결과 전달
window.addEventListener('message', (e) => {
  const msg = e.data;
  if (!msg?.type?.startsWith('GWP_')) return;

  // ── GWP_SIGN_REQUEST: 서명 요청은 _gwpActive 무관하게 처리 ──
  // market 탭이 구매자 서명을 고팡에 위임. gopang-wallet.js가 서명 수행.
  // origin: market.hondi.net 또는 hondi.net 계열만 허용
  if (msg.type === 'GWP_SIGN_REQUEST') {
    const ALLOWED_ORIGINS = [
      'https://market.hondi.net',
      'https://users.hondi.net',
      'https://hondi.net',
      'https://openhash-gopang.github.io',
      location.origin,  // 개발 환경 (localhost 등)
    ];
    if (!ALLOWED_ORIGINS.includes(e.origin)) {
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
            _recordPDV({
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
              ts:               new Date().toISOString(),
            }).then(() => _markPdvAnchored(chainRec.height));
          } else {
            // market 등 하위 시스템이 이미 PDV 기록 → chain_height 소급
            console.info('[GWP_DONE] PDV 중복 방지 — reporter_svc:', reporterSvc,
              '| chain_height 소급:', chainRec.height);
            _patchPdvChainHeight(sessionId, chainRec.height, chainRec.local_hash);
          }
        }).catch(err => console.warn('[GWP_DONE] redeemClaim 실패:', err.message));
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

