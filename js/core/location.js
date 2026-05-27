// ══════════════════════════════════════════════════════════════════
// js/core/location.js — 위치 획득·역지오코딩·날씨
// 역지오코딩: gopang-proxy Worker /geocode 엔드포인트 사용 (fiil 동일 방식)
// ══════════════════════════════════════════════════════════════════

const PROXY_URL = 'https://gopang-proxy.tensor-city.workers.dev';

// ── 상태 ─────────────────────────────────────────────────────────
export let userLocation    = null;   // { lat, lng, accuracy, address, source }
export let locationReady   = false;
export let locationPending = false;
let _watchId = null;
let _onUpdateCallback = null;

export function onLocationUpdate(cb) { _onUpdateCallback = cb; }
function notifyLocationUpdate()      { _onUpdateCallback?.(); }

// ── 앱 컨텍스트 빌더 ─────────────────────────────────────────────
// 앱 시작·서비스 호출 시 위치+시각+UUID를 묶어서 반환
export function buildAppContext(userGuid) {
  const now = new Date();
  return {
    guid:     userGuid || '',
    datetime: now.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
    gps:      userLocation?.lat
                ? `${userLocation.lat.toFixed(6)}, ${userLocation.lng.toFixed(6)}`
                : null,
    address:  userLocation?.address || null,
    source:   userLocation?.source  || 'unknown',
  };
}

// ── 위치 노트 (프롬프트 삽입용) ──────────────────────────────────
export function buildLocNote() {
  if (!userLocation) return '위치 정보 없음';
  const parts = [];
  if (userLocation.address) parts.push(userLocation.address);
  if (userLocation.lat) {
    parts.push('GPS(' + userLocation.lat.toFixed(6) + ', ' + userLocation.lng.toFixed(6) + ')');
  }
  if (userLocation.accuracy) parts.push('정확도 ' + Math.round(userLocation.accuracy) + 'm');
  if (userLocation.source === 'ip') parts.push('(IP 기반)');
  return parts.join(' ') || '위치 정보 없음';
}

// ── 진입점 — PWA 배너 충돌 방지 스케줄링 ────────────────────────
export function scheduleLocation(isStandalone, installBannerVisible) {
  if (isStandalone || !installBannerVisible) {
    setTimeout(initLocation, 1000);
    return;
  }
  const MAX_WAIT = 6000;
  const start = Date.now();
  function tryInit() {
    (!installBannerVisible || Date.now() - start > MAX_WAIT)
      ? initLocation()
      : setTimeout(tryInit, 500);
  }
  setTimeout(tryInit, 1000);
}

// ── GPS 요청 ─────────────────────────────────────────────────────
export function initLocation() {
  if (locationReady || locationPending) return;
  if (!navigator.geolocation) {
    console.info('[Location] GPS 미지원 → IP 기반 위치');
    loadLocationFromIP();
    return;
  }
  locationPending = true;
  console.info('[Location] GPS 요청 중…');
  navigator.geolocation.getCurrentPosition(
    pos  => { locationPending = false; locationReady = true; _startWatch(true); _onGPSSuccess(pos); },
    err  => { locationPending = false; console.warn('[Location] GPS 실패:', err.code); loadLocationFromPDV(); },
    { timeout: 10000, maximumAge: 60000, enableHighAccuracy: true }
  );
}

function _startWatch(highAccuracy) {
  if (_watchId != null) return;
  _watchId = navigator.geolocation.watchPosition(
    pos => _onGPSSuccess(pos),
    err => { if (err.code !== 3) loadLocationFromPDV(); },
    { enableHighAccuracy: highAccuracy, maximumAge: 30000, timeout: 15000 }
  );
}

async function _onGPSSuccess(pos) {
  const { latitude: lat, longitude: lng, accuracy } = pos.coords;
  userLocation = { lat, lng, accuracy, source: 'gps' };
  locationReady = true;
  console.info('[Location] GPS 획득:', lat.toFixed(5), lng.toFixed(5), '정확도', Math.round(accuracy) + 'm');

  // 역지오코딩 — Worker /geocode 엔드포인트 (fiil과 동일)
  const addr = await reverseGeocode(lat, lng);
  if (addr) {
    userLocation.address = addr;
    console.info('[Location] 역지오코딩:', addr);
  }
  notifyLocationUpdate();
}

// ── 역지오코딩 — Worker 프록시 경유 (fiil 동일 방식) ─────────────
export async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(
      PROXY_URL + '/geocode?lat=' + lat + '&lng=' + lng
    );
    const data = await res.json();
    return data.documents?.[0]?.road_address?.address_name
        || data.documents?.[0]?.address?.address_name
        || null;
  } catch(e) {
    console.warn('[Location] 역지오코딩 실패:', e.message);
    return null;
  }
}

// ── PDV 캐시 → IP 폴백 ──────────────────────────────────────────
async function loadLocationFromPDV() {
  try {
    const log  = JSON.parse(localStorage.getItem('gopang_pdv_log') || '[]');
    const last = log.slice().reverse().find(r => r.location?.lat);
    if (last) {
      userLocation = { ...last.location, source: 'pdv_cache' };
      locationReady = true;
      console.info('[Location] PDV 캐시 위치 사용:', userLocation.address || userLocation.lat);
      notifyLocationUpdate();
      return;
    }
  } catch {}
  loadLocationFromIP();
}

async function loadLocationFromIP() {
  try {
    const r = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    if (d.latitude) {
      userLocation = {
        lat:     d.latitude,
        lng:     d.longitude,
        address: d.city + ' ' + d.region,
        source:  'ip',
      };
      locationReady = true;
      console.info('[Location] IP 기반 위치:', userLocation.address);
      notifyLocationUpdate();
    }
  } catch(e) {
    console.warn('[Location] IP 위치도 실패:', e.message);
  }
}

// ── 날씨 (선택적) ────────────────────────────────────────────────
export async function fetchWeather(lat, lng) {
  try {
    const r = await fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=' + lat +
      '&longitude=' + lng + '&current=temperature_2m,weathercode,windspeed_10m&timezone=Asia/Seoul'
    );
    const d = await r.json();
    const c = d.current;
    const desc = {
      0:'맑음', 1:'대체로맑음', 2:'구름많음', 3:'흐림',
      61:'비', 80:'소나기', 95:'뇌우',
    }[c.weathercode] || '알수없음';
    return desc + ' ' + c.temperature_2m + 'C 바람' + c.windspeed_10m + 'km/h';
  } catch { return null; }
}

export async function fetchMarineWeather(lat, lng) {
  try {
    const r = await fetch(
      'https://marine-api.open-meteo.com/v1/marine?latitude=' + lat +
      '&longitude=' + lng + '&current=wave_height,wave_period&timezone=Asia/Seoul'
    );
    const d = await r.json();
    const c = d.current;
    return '파고' + c.wave_height + 'm 주기' + c.wave_period + 's';
  } catch { return null; }
}
