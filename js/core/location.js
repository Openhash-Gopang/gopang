// ══════════════════════════════════════════════════════════════════
// core/location.js — 위치 획득·역지오코딩·날씨
// ══════════════════════════════════════════════════════════════════
import { CFG } from '../../config.js';

// ── 상태 ─────────────────────────────────────────────────────────
export let userLocation   = null;
export let locationReady  = false;
export let locationPending = false;
let _watchId = null;

// ── 진입점 — PWA 배너 충돌 방지 스케줄링 ────────────────────────
export function scheduleLocation(isStandalone, installBannerVisible) {
  if (isStandalone || !installBannerVisible) { setTimeout(initLocation, 1000); return; }
  const MAX_WAIT = 6000; const start = Date.now();
  function tryInit() {
    (!installBannerVisible || Date.now() - start > MAX_WAIT) ? initLocation() : setTimeout(tryInit, 500);
  }
  setTimeout(tryInit, 1000);
}

// ── GPS 요청 ─────────────────────────────────────────────────────
export function initLocation() {
  if (locationReady || locationPending) return;
  if (!navigator.geolocation) { loadLocationFromIP(); return; }
  locationPending = true;
  navigator.geolocation.getCurrentPosition(
    pos  => { locationPending = false; locationReady = true; startWatch(true); onGPSSuccess(pos); },
    ()   => { locationPending = false; loadLocationFromPDV(); },
    { timeout:10000, maximumAge:60000 }
  );
}

function startWatch(highAccuracy) {
  if (_watchId != null) return;
  _watchId = navigator.geolocation.watchPosition(
    pos => onGPSSuccess(pos),
    err => { if (err.code !== 3) loadLocationFromPDV(); },
    { enableHighAccuracy:highAccuracy, maximumAge:30000, timeout:15000 }
  );
}

async function onGPSSuccess(pos) {
  const { latitude:lat, longitude:lng, accuracy } = pos.coords;
  userLocation = { lat, lng, accuracy };
  locationReady = true;
  const addr = await reverseGeocode(lat, lng);
  if (addr) userLocation.address = addr;
  notifyLocationUpdate();
}

// ── PDV 캐시 → IP 폴백 ──────────────────────────────────────────
async function loadLocationFromPDV() {
  try {
    const log  = JSON.parse(localStorage.getItem('gopang_pdv_log') || '[]');
    const last = log.slice().reverse().find(r => r.location?.lat);
    if (last) { userLocation = last.location; locationReady = true; notifyLocationUpdate(); return; }
  } catch {}
  loadLocationFromIP();
}

async function loadLocationFromIP() {
  try {
    const r = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    if (d.latitude) {
      userLocation = { lat:d.latitude, lng:d.longitude, address:d.city+' '+d.region, source:'ip' };
      locationReady = true;
      notifyLocationUpdate();
    }
  } catch {}
}

// ── 역지오코딩 (카카오) ──────────────────────────────────────────
export async function reverseGeocode(lat, lng) {
  try {
    const r = await fetch(
      `https://dapi.kakao.com/v2/local/geo/coord2address.json?x=${lng}&y=${lat}`,
      { headers:{ 'Authorization':'KakaoAK ' + CFG.kakaoKey } }
    );
    const d = await r.json();
    return d.documents?.[0]?.address?.address_name || null;
  } catch { return null; }
}

// ── 날씨 ─────────────────────────────────────────────────────────
export async function fetchWeather(lat, lng) {
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weathercode,windspeed_10m&timezone=Asia/Seoul`);
    const d = await r.json(); const c = d.current;
    const desc = {0:'맑음',1:'대체로맑음',2:'구름많음',3:'흐림',61:'비',80:'소나기',95:'뇌우'}[c.weathercode] || '알수없음';
    return `${desc} ${c.temperature_2m}°C 바람${c.windspeed_10m}km/h`;
  } catch { return null; }
}

export async function fetchMarineWeather(lat, lng) {
  try {
    const r = await fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}&current=wave_height,wave_period&timezone=Asia/Seoul`);
    const d = await r.json(); const c = d.current;
    return `파고${c.wave_height}m 주기${c.wave_period}s`;
  } catch { return null; }
}

// ── 위치 문자열 조합 ─────────────────────────────────────────────
export function buildLocNote() {
  if (!userLocation) return '위치 정보 없음';
  const parts = [];
  if (userLocation.address) parts.push(userLocation.address);
  if (userLocation.lat) parts.push(`GPS(${userLocation.lat.toFixed(4)},${userLocation.lng.toFixed(4)})`);
  if (userLocation.source === 'ip') parts.push('(IP 기반)');
  return parts.join(' ') || '위치 정보 없음';
}

// ── 위치 갱신 이벤트 (CFG.system 업데이트) ──────────────────────
// index.html의 init()에서 콜백 등록
let _onUpdateCallback = null;
export function onLocationUpdate(cb) { _onUpdateCallback = cb; }
function notifyLocationUpdate()      { _onUpdateCallback?.(); }
