import { setUserLocation, setLocationReady, setLocationPending, _userLocation, _locationReady, _locationPending, _installBannerVisible } from '../core/state.js';
import { CFG } from '../core/config.js';

export function _scheduleLocation() {
  const start = Date.now();
  function tryInit() {
    if (!_installBannerVisible || Date.now() - start > 6000) _initLocation();
    else setTimeout(tryInit, 500);
  }
  setTimeout(tryInit, 1000);
}

export function _initLocation() {
  if (_locationPending || _locationReady) return;
  setLocationPending(true);
  if (!navigator.geolocation) {
    _loadLocationFromPDV().finally(() => { setLocationPending(false); setLocationReady(true); });
    return;
  }
  let watchId = null, gotFirst = false;
  function startWatch(hi) {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude, lng = pos.coords.longitude, acc = pos.coords.accuracy;
        setUserLocation({ lat, lng, accuracy: acc, source: 'GPS', address: _userLocation ? _userLocation.address : null, region: _userLocation ? _userLocation.region : null });
        _updateLocationInPrompt();
        if (!gotFirst) { gotFirst = true; setLocationPending(false); setLocationReady(true); if (!hi) startWatch(true); }
      },
      (err) => {
        navigator.geolocation.clearWatch(watchId); watchId = null;
        if (!hi && err.code !== err.PERMISSION_DENIED) startWatch(true);
        else { setLocationPending(false); _loadLocationFromPDV().finally(() => setLocationReady(true)); }
      },
      { enableHighAccuracy: hi, timeout: hi ? 8000 : 5000, maximumAge: 0 }
    );
  }
  startWatch(false);
}

export async function _loadLocationFromPDV() {
  const addr = localStorage.getItem('gopang_profile_address');
  if (addr) setUserLocation({ source: 'PDV', address: addr, lat: null, lng: null });
  else {
    try {
      const d = await fetch('https://ipapi.co/json/').then(r => r.json());
      setUserLocation(d.latitude ? { source: 'IP', address: d.city, lat: d.latitude, lng: d.longitude } : { source: 'UNKNOWN', address: null, lat: null, lng: null });
    } catch { setUserLocation({ source: 'UNKNOWN', address: null, lat: null, lng: null }); }
  }
}

export function _updateLocationInPrompt() {
  if (!_userLocation) return;
  CFG.locationStr = _userLocation.address || (_userLocation.lat ? _userLocation.lat.toFixed(4) + ',' + _userLocation.lng.toFixed(4) : '위치없음');
}

export function _buildLocNote() {
  if (!_userLocation || !_userLocation.source) return '';
  const loc = _userLocation;
  const detail = loc.lat ? 'GPS: ' + loc.lat.toFixed(5) + ', ' + loc.lng.toFixed(5) + (loc.address ? ' (' + loc.address + ')' : '') : (loc.address || '위치정보없음');
  return `\n\n[현재 위치]\n` + detail;
}

// ── _buildRoutingFacts (2026-07-05 신설) ─────────────────────────
// GWP로 서브시스템(jeju 등) 새 탭을 열 때, 그쪽 라우터가 GPS 재감지·
// 키워드 매칭만으로 위치·의도를 다시 추론하지 않도록 메인 AI 비서가
// 이미 확보한 정보를 구조화해 미리 건네주는 용도.
//
// 중요(설계 원칙): 이 객체는 _gwpLaunch()를 통해 URL 쿼리 파라미터로
// 새 탭에 전달된다 — 즉 대상 서버 접근 로그·브라우저 히스토리에
// 그대로 남는 채널이다. PDV(사용자의 모든 것을 기록한 private data
// vault)의 민감한 이력(나이 등 사용자가 과거 언급한 개인정보)은
// 절대 여기 담지 않는다. 그런 데이터가 실제로 필요하면 서브시스템이
// 착지 후 기존 PDV_HISTORY_REQUEST/consent.html 동의 흐름으로 직접
// 요청해야 한다 — 이 함수는 그 요청조차 필요 없는, 이미 공개된 수준의
// 정보(현재 위치, 이번 발화)만 담는다.
//
// 주의: 사용자 발화 원문은 이미 _gwpLaunch()의 context 인자(→ URL의 ctx
// 파라미터)가 그대로 전달하므로 이 함수는 중복해서 담지 않는다. facts는
// ctx만으로는 알 수 없는, "메인 비서가 이미 확보한 부가 정보"만 최소한으로
// 싣는 확장 가능한 객체다. 현재는 currentLocation 하나뿐이지만, 이후 항목이
// 추가되더라도 위 민감도 원칙(비 민감 정보만)은 그대로 유지해야 한다.
//
// @returns {object|null} — 실을 정보가 전혀 없으면 null
export function _buildRoutingFacts() {
  const loc = _userLocation;
  const currentLocation = loc
    ? (loc.address || (loc.lat != null ? loc.lat.toFixed(5) + ',' + loc.lng.toFixed(5) : null))
    : null;

  if (!currentLocation) return null;

  return { currentLocation };
}
