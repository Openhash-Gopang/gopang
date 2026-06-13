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
  return '

[현재 위치]
' + detail;
}
