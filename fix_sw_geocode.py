import re

# ── 1. sw.js — 외부 API 요청 캐시하지 않도록 수정 ────────────────
sw_path = r'C:\Users\주피터\Downloads\gopang_v2\sw.js'
with open(sw_path, 'r', encoding='utf-8') as f:
    sw = f.read()

print('sw.js 크기:', len(sw))
print('fetch 이벤트 존재:', 'fetch' in sw)

# SW가 외부 도메인 요청을 가로채지 않도록
# fetch 이벤트에서 외부 URL은 네트워크로 직접 통과
old_fetch = "self.addEventListener('fetch', e => {"
if old_fetch in sw:
    new_fetch = """self.addEventListener('fetch', e => {
  // 외부 API 요청(Worker, Supabase, Kakao 등)은 캐시하지 않고 통과
  const url = e.request.url;
  if (!url.startsWith(self.location.origin)) return;
"""
    sw = sw.replace(old_fetch, new_fetch)
    print('OK: sw.js fetch 이벤트 수정')
else:
    print('INFO: fetch 이벤트 패턴 없음 — sw.js 전체 출력:')
    print(sw[:500])

with open(sw_path, 'w', encoding='utf-8') as f:
    f.write(sw)

# ── 2. location.js — geocode 중복 호출 방지 ─────────────────────
loc_path = r'C:\Users\주피터\Downloads\gopang_v2\js\core\location.js'
with open(loc_path, 'r', encoding='utf-8') as f:
    loc = f.read()

# _onGPSSuccess에서 이미 주소가 있으면 역지오코딩 스킵
old_gps = """async function _onGPSSuccess(pos) {
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
}"""

new_gps = """let _lastGeocodeKey = null;  // 중복 역지오코딩 방지

async function _onGPSSuccess(pos) {
  const { latitude: lat, longitude: lng, accuracy } = pos.coords;
  userLocation = { lat, lng, accuracy, source: 'gps' };
  locationReady = true;
  console.info('[Location] GPS 획득:', lat.toFixed(5), lng.toFixed(5), '정확도', Math.round(accuracy) + 'm');

  // 역지오코딩 — 소수점 3자리 단위로만 재호출 (약 100m 이동 시)
  const geocodeKey = lat.toFixed(3) + ',' + lng.toFixed(3);
  if (_lastGeocodeKey !== geocodeKey) {
    _lastGeocodeKey = geocodeKey;
    const addr = await reverseGeocode(lat, lng);
    if (addr) {
      userLocation.address = addr;
      console.info('[Location] 역지오코딩:', addr);
    }
  }
  notifyLocationUpdate();
}"""

if old_gps in loc:
    loc = loc.replace(old_gps, new_gps)
    print('OK: geocode 중복 방지 수정')
else:
    print('FAIL: _onGPSSuccess 패턴 없음')
    idx = loc.find('_onGPSSuccess')
    if idx != -1:
        print(repr(loc[idx:idx+200]))

with open(loc_path, 'w', encoding='utf-8') as f:
    f.write(loc)

print('완료')
