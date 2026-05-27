// ══════════════════════════════════════════════════════════════════
// js/services/gwp.js — GWP (Gopang Widget Portal) 서비스 실행
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
export let gwpActive = false;
let _gwpService      = null;
let _gwpIframe       = null;

// ── 의도 → 서비스 매칭 ──────────────────────────────────────────
export function gwpMatch(text) {
  if (!text) return null;
  for (const svc of GWP_REGISTRY) {
    if (svc.triggers?.some(t => text.includes(t))) return svc;
  }
  return null;
}

// ── 서비스 실행 ──────────────────────────────────────────────────
export function gwpLaunch(service, context) {
  if (gwpActive) gwpClose(false);
  gwpActive   = true;
  _gwpService = service;

  // 1. 상단 타이틀 → 서비스명
  _setTopTitle(service.icon + ' ' + service.name);

  // 2. 상단 바 좌측에 "← 고팡" 버튼 삽입
  _insertBackButton();

  // 3. 입력독 숨김
  const dock = document.getElementById('input-dock');
  if (dock) dock.style.display = 'none';

  // 4. message-list 숨김
  document.getElementById('message-list').style.display = 'none';

  // 5. iframe URL 구성
  const user = _getUser();
  const iframeUrl = new URL(service.url);
  iframeUrl.searchParams.set('gwp',    '1');
  iframeUrl.searchParams.set('token',  user?.guid || '');
  iframeUrl.searchParams.set('origin', location.origin);
  iframeUrl.searchParams.set('ctx', encodeURIComponent(context || ''));
  const _locEl = document.getElementById('welcome-loc');
  const _locStr = _locEl ? _locEl.textContent : '';
  if (_locStr && _locStr !== '위치 확인 중…') iframeUrl.searchParams.set('gps_addr', encodeURIComponent(_locStr));

  // 6. iframe 삽입 (전체화면)
  const iframe = document.createElement('iframe');
  iframe.id    = 'gwp-iframe';
  iframe.src   = iframeUrl.toString();
  iframe.style.cssText = [
    'position:absolute',
    'top:calc(48px + var(--safe-top, 0px))',
    'left:0', 'right:0',
    'bottom:0',
    'width:100%',
    'border:none',
    'background:var(--bg, #fff)',
    'opacity:0',
    'transition:opacity 0.3s',
    'z-index:100',
  ].join(';');
  iframe.allow = 'camera; microphone; geolocation';
  iframe.onload = () => { iframe.style.opacity = '1'; };
  _gwpIframe = iframe;

  const app = document.getElementById('app');
  if (app) app.appendChild(iframe);

  console.info('[GWP] 실행:', service.id);
}

// ── 서비스 종료 → 고팡 복귀 ─────────────────────────────────────
export function gwpClose(showReturn = true) {
  if (!gwpActive) return;

  // 1. iframe 제거
  _gwpIframe?.remove();
  _gwpIframe = null;

  // 2. "← 고팡" 버튼 제거
  _removeBackButton();

  // 3. 입력독 복원
  const dock = document.getElementById('input-dock');
  if (dock) dock.style.display = '';

  // 4. message-list 복원
  document.getElementById('message-list').style.display = '';

  // 5. 상단 타이틀 복귀
  _setTopTitle('고팡');

  gwpActive   = false;
  _gwpService = null;

  if (showReturn) _appendBubble('ai', '✅ 서비스가 종료되었습니다. 고팡으로 돌아왔습니다.');
  console.info('[GWP] 종료');
}

// ── 서비스로 입력 전달 ───────────────────────────────────────────
export function gwpForwardInput(text, file) {
  if (!_gwpIframe || !_gwpService) return;
  _gwpIframe.contentWindow?.postMessage(
    { type: 'GWP_INPUT', text: text || '', file: file || null },
    new URL(_gwpService.url).origin
  );
}

// ── GWP_DONE 메시지 수신 리스너 ─────────────────────────────────
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

// ── 내부 헬퍼 ────────────────────────────────────────────────────

function _setTopTitle(text) {
  const el = document.getElementById('top-logo-text');
  if (!el) return;
  el.style.transition = 'opacity 0.2s';
  el.style.opacity    = '0';
  setTimeout(() => { el.textContent = text; el.style.opacity = '1'; }, 200);
}

function _insertBackButton() {
  if (document.getElementById('gwp-back-btn')) return;

  // top-logo-text를 "← 고팡" 버튼으로 교체
  const logoText = document.getElementById('top-logo-text');
  if (logoText) {
    logoText.dataset.prevText = logoText.textContent;
    const btn = document.createElement('button');
    btn.id = 'gwp-back-btn';
    btn.innerHTML = '&#8592; 고팡';
    btn.style.cssText = 'background:none;border:none;color:var(--accent,#3ECF8E);font-size:15px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:4px;padding:0;';
    btn.onclick = () => gwpClose(true);
    logoText.textContent = '';
    logoText.appendChild(btn);
  }
}

function _removeBackButton() {
  const logoText = document.getElementById('top-logo-text');
  if (logoText && logoText.dataset.prevText) {
    logoText.textContent = logoText.dataset.prevText;
    delete logoText.dataset.prevText;
  }
  document.getElementById('gwp-back-btn')?.remove();
}



