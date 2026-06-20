/**
 * core/state.js — 고팡 전역 상태 (단일 진실 공급원)
 * 모든 모듈이 이 파일에서 상태를 import하여 공유
 */

// ── 사용자 ───────────────────────────────────────────────
export let _USER     = null;   // 초기화 전 null, initAuth() 완료 후 설정
export let USER_GUID = '';

export function setUser(user) {
  _USER     = user;
  USER_GUID = user?.ipv6 || user?.guid || crypto.randomUUID();
}

// ── AI 상태 ──────────────────────────────────────────────
export let aiActive   = false;
export let micActive  = false;
export let attachFile = null;
export let recognition = null;
export const history  = [];   // { role, content }

export function setAiActive(v) {
  aiActive = v;
  // AI 토글 버튼은 상단 바에 항상 떠 있어 "다시 그려지는" 계기가 없는
  // 유일한 토글이라, 다른 설정 토글들과 달리 화면이 따로 동기화되지
  // 않으면 어긋난 채로 영원히 남는다. 그래서 상태가 바뀌는 이 단일
  // 지점에서 항상 버튼 화면도 같이 맞춘다 — 호출자가 매번 버튼 클래스를
  // 직접 건드릴 필요가 없고, 앞으로 추가되는 코드도 자동으로 안전하다.
  document.getElementById('btn-ai')?.classList.toggle('active', !!v);
}
export function setMicActive(v)   { micActive  = v; }
export function setAttachFile(v)  { attachFile = v; }
export function setRecognition(v) { recognition = v; }

// ── P2P 상태 ─────────────────────────────────────────────
export const PROXY      = 'https://gopang-proxy.tensor-city.workers.dev';
// RTC_CONFIG — 기본값 (STUN 전용)
// fetchRtcConfig() 호출 시 TURN credential 포함 버전으로 교체됨
export const RTC_CONFIG_STUN_ONLY = { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]};

export let RTC_CONFIG = RTC_CONFIG_STUN_ONLY;
export function setRtcConfig(v) { RTC_CONFIG = v; }

// TURN credential 캐시 (55분)
let _rtcConfigCache    = null;
let _rtcConfigCachedAt = 0;

/**
 * Worker /turn/credential 에서 TURN 포함 iceServers 취득.
 * TURN_SECRET 미설정 시 STUN 전용 자동 폴백.
 * @param {string} guid - 사용자 GUID (credential username에 포함)
 */
export async function fetchRtcConfig(guid = '') {
  const now = Date.now();
  if (_rtcConfigCache && now - _rtcConfigCachedAt < 55 * 60 * 1000) {
    return _rtcConfigCache;
  }
  try {
    const res  = await fetch(
      `${PROXY}/turn/credential?guid=${encodeURIComponent(guid)}`,
      { cache: 'no-store' }
    );
    const data = await res.json();
    if (data.ok && Array.isArray(data.iceServers)) {
      const cfg = { iceServers: data.iceServers };
      _rtcConfigCache    = cfg;
      _rtcConfigCachedAt = now;
      setRtcConfig(cfg);
      if (!data.fallback) {
        console.info('[RTC] TURN credential 적용 ✓', data.iceServers.length, 'servers');
      } else {
        console.warn('[RTC] TURN 미설정 — STUN 전용 사용');
      }
      return cfg;
    }
  } catch (e) {
    console.warn('[RTC] TURN credential 취득 실패, STUN 전용 사용:', e.message);
  }
  return RTC_CONFIG_STUN_ONLY;
}

export let _peer       = null;
export let _rtcConn    = null;
export let _rtcChannel = null;
export let _signalPoll = null;
export let _pdvChatDB  = null;

export function setPeerState(v)      { _peer       = v; }
export function setRtcConn(v)        { _rtcConn    = v; }
export function setRtcChannel(v)     { _rtcChannel = v; }
export function setSignalPoll(v)     { _signalPoll = v; }
export function setPdvChatDB(v)      { _pdvChatDB  = v; }

// ── 위치 ─────────────────────────────────────────────────
export let _userLocation    = null;
export let _locationReady   = false;
export let _locationPending = false;

export function setUserLocation(v)    { _userLocation    = v; }
export function setLocationReady(v)   { _locationReady   = v; }
export function setLocationPending(v) { _locationPending = v; }

// ── GWP ──────────────────────────────────────────────────
export let _gwpActive   = false;
export let _gwpService  = null;
export let _gwpTab      = null;
export let _gwpTabTimer = null;

export function setGwpActive(v)   { _gwpActive   = v; }
export function setGwpService(v)  { _gwpService  = v; }
export function setGwpTab(v)      { _gwpTab      = v; }
export function setGwpTabTimer(v) { _gwpTabTimer = v; }

// ── K-Law ────────────────────────────────────────────────
export let _klawBusy      = false;
export let _klawLastCheck = 0;
export const KLAW_COOLDOWN_MS = 30000;

export function setKlawBusy(v)      { _klawBusy      = v; }
export function setKlawLastCheck(v) { _klawLastCheck = v; }

// ── Supabase ─────────────────────────────────────────────
export const _SUPABASE_URL = 'https://ebbecjfrwaswbdybbgiu.supabase.co';
export const _SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYmVjamZyd2Fzd2JkeWJiZ2l1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NjE5ODQsImV4cCI6MjA5NTEzNzk4NH0.H2ahQKtWdSke04Pdi3hDY86pdTx7UUKPUpQMlS_zciA';

// ── L1 ───────────────────────────────────────────────────
export const L1_URL = 'https://l1-hanlim.gopang.net/api/collections/profiles/records';

// ── 기타 ─────────────────────────────────────────────────
export let _lastPipelineResult = null;
export let _lastRouterResult   = null;
export let _lastFiilReportId   = null;
export let _installBannerVisible = false;

export function setLastPipelineResult(v)   { _lastPipelineResult   = v; }
export function setLastRouterResult(v)     { _lastRouterResult     = v; }
export function setLastFiilReportId(v)     { _lastFiilReportId     = v; }
export function setInstallBannerVisible(v) { _installBannerVisible = v; }
