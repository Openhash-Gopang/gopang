// ══════════════════════════════════════════════════════════════════
// js/services/gwp.js — GWP v2.1
// ══════════════════════════════════════════════════════════════════
import { GWP_REGISTRY } from '../../config.js';

let _getUser      = () => null;
let _appendBubble = () => {};
let _recordPDV    = () => {};

export function initGWP({ getUser, appendBubble, recordPDV }) {
  _getUser      = getUser;
  _appendBubble = appendBubble;
  _recordPDV    = recordPDV;
}

export let gwpActive = false;
let _gwpService  = null;
let _gwpTab      = null;
let _gwpChannel  = null;
let _watchInterval = null;

export function gwpMatch(text) {
  if (!text) return null;
  for (const svc of GWP_REGISTRY) {
    if (svc.triggers?.some(t => text.includes(t))) return svc;
  }
  return null;
}

export function gwpLaunch(service, context, extra = {}) {
  if (gwpActive) gwpClose(false);
  gwpActive   = true;
  _gwpService = service;

  _setTopTitle(service.icon + ' ' + service.name);
  _insertBackButton();

  const user = _getUser();
  const url  = new URL(service.url);
  url.searchParams.set('gwp',    '1');
  url.searchParams.set('token',  user?.guid || '');
  url.searchParams.set('origin', location.origin);
  url.searchParams.set('ctx',    encodeURIComponent(context || ''));

  // GPS 주소 전달
  const locEl  = document.getElementById('welcome-loc');
  const locStr = locEl?.textContent || '';
  if (locStr && locStr !== '위치 확인 중…') {
    url.searchParams.set('gps_addr', encodeURIComponent(locStr));
  }

  // 사진 URL, 요청사항 전달
  if (extra.photoUrl) url.searchParams.set('photo_url', extra.photoUrl);
  if (extra.desc)     url.searchParams.set('desc', extra.desc);

  _gwpTab = window.open(url.toString(), 'gopang_service');
  console.info('[GWP] 실행 (새 탭):', service.id, '/ tab:', _gwpTab);

  _startChannel();

  // 탭 닫힘 감지 — 3초 후부터 시작 (탭 로딩 시간 확보)
  setTimeout(() => _watchTabClose(), 3000);

  _appendBubble('ai',
    service.icon + ' <b>' + service.name + '</b> 서비스를 새 탭에서 시작합니다.<br>' +
    '<small style="color:#8E8E93">완료 후 자동으로 고팡에 결과가 전달됩니다.</small>',
    true
  );
}

export function gwpClose(showReturn = true) {
  if (!gwpActive) return;
  if (_watchInterval) { clearInterval(_watchInterval); _watchInterval = null; }
  if (_gwpChannel)    { _gwpChannel.close(); _gwpChannel = null; }
  if (_gwpTab && !_gwpTab.closed) _gwpTab.close();
  _gwpTab = null;
  _removeBackButton();
  _setTopTitle('고팡');
  gwpActive   = false;
  _gwpService = null;
  if (showReturn) _appendBubble('ai', '✅ 서비스가 종료되었습니다. 고팡으로 돌아왔습니다.');
  console.info('[GWP] 종료');
}

export function gwpForwardInput() {}

function _startChannel() {
  if (_gwpChannel) _gwpChannel.close();
  _gwpChannel = new BroadcastChannel('gopang_gwp');
  _gwpChannel.onmessage = (e) => {
    if (e.data?.type !== 'GWP_DONE') return;
    const d = e.data.pdvData || {};
    _recordPDV({
      type:'service_task', serviceId:_gwpService?.id||'unknown',
      summary:e.data.summary||'서비스 완료',
      who:d.who, when:d.when, where:d.where,
      what:d.what, how:d.how||'text', why:d.why, data:d.data,
    });
    _appendBubble('ai','✅ <b>'+(_gwpService?.name||'서비스')+'</b> 완료: '+(e.data.summary||''),true);
    gwpClose(false);
  };
}

function _watchTabClose() {
  if (_watchInterval) clearInterval(_watchInterval);
  _watchInterval = setInterval(() => {
    if (!gwpActive) { clearInterval(_watchInterval); _watchInterval = null; return; }
    if (_gwpTab?.closed) {
      clearInterval(_watchInterval); _watchInterval = null;
      if (gwpActive) gwpClose(true);
    }
  }, 1500);
}

export function listenGWPDone() {
  window.addEventListener('message', e => {
    if (e.data?.type !== 'GWP_DONE') return;
    const d = e.data.pdvData || {};
    _recordPDV({
      type:'service_task', serviceId:_gwpService?.id||'unknown',
      summary:e.data.summary||'서비스 완료',
      who:d.who, when:d.when, where:d.where,
      what:d.what, how:d.how||'text', why:d.why, data:d.data,
    });
    gwpClose(true);
  });
}

function _setTopTitle(text) {
  const el = document.getElementById('top-logo-text'); if (!el) return;
  el.style.transition='opacity 0.2s'; el.style.opacity='0';
  setTimeout(()=>{ el.textContent=text; el.style.opacity='1'; },200);
}

function _insertBackButton() {
  if (document.getElementById('gwp-back-btn')) return;
  const logoText = document.getElementById('top-logo-text'); if (!logoText) return;
  logoText.dataset.prevText = logoText.textContent;
  const btn = document.createElement('button');
  btn.id = 'gwp-back-btn';
  btn.innerHTML = '&#8592; 고팡';
  btn.style.cssText = 'background:none;border:none;color:var(--accent,#3ECF8E);font-size:15px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:4px;padding:0;';
  btn.addEventListener('click', () => gwpClose(true));
  logoText.textContent = '';
  logoText.appendChild(btn);
}

function _removeBackButton() {
  const logoText = document.getElementById('top-logo-text');
  if (logoText?.dataset.prevText) {
    logoText.textContent = logoText.dataset.prevText;
    delete logoText.dataset.prevText;
  }
  document.getElementById('gwp-back-btn')?.remove();
}

