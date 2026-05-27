// ══════════════════════════════════════════════════════════════════
// services/gwp.js — GWP (Gopang Widget Portal) 서비스 실행
// 새 서비스 추가 시: config.js의 GWP_REGISTRY에만 항목 추가
// ══════════════════════════════════════════════════════════════════
import { GWP_REGISTRY } from '../../config.js';

// 런타임 주입
let _getUser      = () => null;
let _appendBubble = () => {};
let _recordPDV    = () => {};

export function initGWP({ getUser, appendBubble, recordPDV }) {
  _getUser      = getUser;
  _appendBubble = appendBubble;
  _recordPDV    = recordPDV;
}

// ── 상태 ─────────────────────────────────────────────────────────
export let gwpActive  = false;
let _gwpService        = null;
let _gwpIframe         = null;
let _gwpSavedPlaceholder = '메시지를 입력하세요…';

// ── 의도 → 서비스 매칭 ──────────────────────────────────────────
export function gwpMatch(text) {
  if (!text) return null;
  for (const svc of GWP_REGISTRY) {
    if (svc.triggers.some(t => text.includes(t))) return svc;
  }
  return null;
}

// ── 서비스 실행 ──────────────────────────────────────────────────
export function gwpLaunch(service, context) {
  if (gwpActive) gwpClose(false);
  gwpActive   = true;
  _gwpService = service;

  // 상단 타이틀 전환: "고팡" → 서비스명
  _setTopTitle(service.icon + ' ' + service.name);

  // iframe URL 구성
  const user = _getUser();
  const iframeUrl = new URL(service.url);
  iframeUrl.searchParams.set('gwp',    '1');
  iframeUrl.searchParams.set('token',  user?.guid || '');
  iframeUrl.searchParams.set('origin', location.origin);
  iframeUrl.searchParams.set('ctx',    encodeURIComponent(context || ''));

  const iframe = document.createElement('iframe');
  iframe.id    = 'gwp-iframe';
  iframe.src   = iframeUrl.toString();
  iframe.style.cssText = 'width:100%;height:100%;border:none;background:var(--bg);opacity:0;transition:opacity 0.3s';
  iframe.allow = 'camera; microphone; geolocation';
  iframe.onload = () => { iframe.style.opacity = '1'; };
  _gwpIframe = iframe;

  // message-list 숨기고 iframe 삽입
  document.getElementById('message-list').style.display = 'none';
  const wrap = document.createElement('div');
  wrap.id = 'gwp-wrap';
  wrap.style.cssText = 'position:absolute;top:calc(44px + var(--safe-top));left:0;right:0;bottom:80px;overflow:hidden;';
  wrap.appendChild(iframe);
  document.getElementById('app').appendChild(wrap);

  const inp = document.getElementById('msg-input');
  _gwpSavedPlaceholder = inp?.placeholder || '메시지를 입력하세요…';
  if (inp) inp.placeholder = '로딩 중…';

  _appendBubble('ai', service.icon + ' <b>' + service.name + '</b> 서비스를 시작합니다.', true);
  console.info('[GWP] 실행:', service.id);
}

// ── 서비스 종료 → 고팡 복귀 ─────────────────────────────────────
export function gwpClose(showReturn = true) {
  if (!gwpActive) return;
  document.getElementById('gwp-wrap')?.remove();
  _gwpIframe = null;
  document.getElementById('message-list').style.display = '';
  _setTopTitle('고팡');

  const inp = document.getElementById('msg-input');
  if (inp) inp.placeholder = _gwpSavedPlaceholder;

  gwpActive   = false;
  _gwpService = null;

  if (showReturn) _appendBubble('ai', '✅ 서비스가 종료되었습니다. 고팡으로 돌아왔습니다.');
  console.info('[GWP] 종료');
}

// ── 서비스로 입력 전달 ───────────────────────────────────────────
export function gwpForwardInput(text, file) {
  if (!_gwpIframe || !_gwpService) return;
  _gwpIframe.contentWindow.postMessage(
    { type:'GWP_INPUT', text: text || '', file: file || null },
    new URL(_gwpService.url).origin
  );
}

// ── GWP_DONE 메시지 수신 리스너 ─────────────────────────────────
// index.html의 init()에서 호출
export function listenGWPDone() {
  window.addEventListener('message', e => {
    if (e.data?.type !== 'GWP_DONE') return;
    const d = e.data.pdvData || {};
    _recordPDV({
      type:      'service_task',
      serviceId: _gwpService?.id || 'unknown',
      summary:   e.data.summary || '서비스 완료',
      who:  d.who,  when: d.when, where: d.where,
      what: d.what, how:  d.how || 'text', why: d.why,
      data: d.data,
    });
    gwpClose(true);
  });
}

// ── 내부 헬퍼: 상단 타이틀 전환 ─────────────────────────────────
function _setTopTitle(text) {
  const el = document.getElementById('top-logo-text');
  if (!el) return;
  el.style.transition = 'opacity 0.2s';
  el.style.opacity    = '0';
  setTimeout(() => { el.textContent = text; el.style.opacity = '1'; }, 200);
}
