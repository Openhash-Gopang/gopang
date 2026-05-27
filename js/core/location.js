// ══════════════════════════════════════════════════════════════════
// js/core/location.js v2.0
// GPS watchPosition 중복 호출 방지
// ══════════════════════════════════════════════════════════════════
import { CFG } from '../../config.js';

const PROXY_URL = 'https://gopang-proxy.tensor-city.workers.dev';

export let userLocation    = null;
export let locationReady   = false;
export let locationPending = false;
let _watchId              = null;
let _lastGeocodeKey       = null;  // 중복 역지오코딩 방지
let _onUpdateCallback     = null;

export function onLocationUpdate(cb) { _onUpdateCallback = cb; }
function notifyLocationUpdate()      { _onUpdateCallback?.(); }

export function buildLocNote() {
  if (!userLocation) return '위치 정보 없음';
  const parts = [];
  if (userLocation.address) parts.push(userLocation.address);
  if (userLocation.lat) parts.push('GPS('+userLocation.lat.toFixed(6)+', '+userLocation.lng.toFixed(6)+')');
  if (userLocation.accuracy) parts.push('정확도 '+Math.round(userLocation.accuracy)+'m');
  if (userLocation.source === 'ip') parts.push('(IP 기반)');
  return parts.join(' ') || '위치 정보 없음';
}

export function buildAppContext(userGuid) {
  const now = new Date();
  return {
    guid:     userGuid || '',
    datetime: now.toLocaleString('ko-KR', { timeZone:'Asia/Seoul' }),
    gps:      userLocation?.lat ? userLocation.lat.toFixed(6)+', '+userLocation.lng.toFixed(6) : null,
    address:  userLocation?.address || null,
    source:   userLocation?.source  || 'unknown',
  };
}

export function scheduleLocation(isStandalone, installBannerVisible) {
  if (isStandalone || !installBannerVisible) { setTimeout(initLocation, 1000); return; }
  const MAX_WAIT = 6000; const start = Date.now();
  function tryInit() {
    (!installBannerVisible || Date.now()-start>MAX_WAIT) ? initLocation() : setTimeout(tryInit,500);
  }
  setTimeout(tryInit, 1000);
}

export function initLocation() {
  if (locationReady || locationPending) return;
  if (!navigator.geolocation) { loadLocationFromIP(); return; }
  locationPending = true;
  console.info('[Location] GPS 요청 중…');
  navigator.geolocation.getCurrentPosition(
    pos  => { locationPending=false; locationReady=true; _startWatch(); _onGPSSuccess(pos); },
    err  => { locationPending=false; console.warn('[Location] GPS 실패:', err.code); loadLocationFromPDV(); },
    { timeout:10000, maximumAge:60000, enableHighAccuracy:true }
  );
}

function _startWatch() {
  if (_watchId != null) return;  // 이미 감시 중이면 중복 등록 방지
  _watchId = navigator.geolocation.watchPosition(
    pos => _onGPSSuccess(pos),
    err => { if (err.code !== 3) loadLocationFromPDV(); },
    { enableHighAccuracy:true, maximumAge:30000, timeout:15000 }
  );
}

async function _onGPSSuccess(pos) {
  const { latitude:lat, longitude:lng, accuracy } = pos.coords;

  // 좌표가 거의 변하지 않았으면 역지오코딩 스킵 (약 100m 단위)
  const geoKey = lat.toFixed(3)+','+lng.toFixed(3);
  const needGeocode = (_lastGeocodeKey !== geoKey);

  userLocation = { lat, lng, accuracy, source:'gps',
    address: userLocation?.address || null };  // 기존 주소 유지
  locationReady = true;

  if (needGeocode) {
    _lastGeocodeKey = geoKey;
    console.info('[Location] GPS 획득:', lat.toFixed(5), lng.toFixed(5), '정확도', Math.round(accuracy)+'m');
    const addr = await reverseGeocode(lat, lng);
    if (addr) {
      userLocation.address = addr;
      console.info('[Location] 역지오코딩:', addr);
    }
  }

  notifyLocationUpdate();
}

export async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(PROXY_URL+'/geocode?lat='+lat+'&lng='+lng);
    const data = await res.json();
    return data.documents?.[0]?.road_address?.address_name
        || data.documents?.[0]?.address?.address_name
        || null;
  } catch(e) { console.warn('[Location] 역지오코딩 실패:', e.message); return null; }
}

async function loadLocationFromPDV() {
  try {
    const log  = JSON.parse(localStorage.getItem('gopang_pdv_log')||'[]');
    const last = log.slice().reverse().find(r=>r.location?.lat);
    if (last) { userLocation={...last.location,source:'pdv_cache'}; locationReady=true; notifyLocationUpdate(); return; }
  } catch {}
  loadLocationFromIP();
}

async function loadLocationFromIP() {
  try {
    const r = await fetch('https://ipapi.co/json/', { signal:AbortSignal.timeout(5000) });
    const d = await r.json();
    if (d.latitude) {
      userLocation={ lat:d.latitude, lng:d.longitude, address:d.city+' '+d.region, source:'ip' };
      locationReady=true; notifyLocationUpdate();
      console.info('[Location] IP 기반:', userLocation.address);
    }
  } catch(e) { console.warn('[Location] IP 위치 실패:', e.message); }
}

export async function fetchWeather(lat, lng) {
  try {
    const r=await fetch('https://api.open-meteo.com/v1/forecast?latitude='+lat+'&longitude='+lng+'&current=temperature_2m,weathercode,windspeed_10m&timezone=Asia/Seoul');
    const d=await r.json(); const c=d.current;
    const desc={0:'맑음',1:'대체로맑음',2:'구름많음',3:'흐림',61:'비',80:'소나기',95:'뇌우'}[c.weathercode]||'알수없음';
    return desc+' '+c.temperature_2m+'C 바람'+c.windspeed_10m+'km/h';
  } catch { return null; }
}
