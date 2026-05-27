import re

# ── 1. sw.js 인코딩 자동 감지 ────────────────────────────────────
sw_path = r'C:\Users\주피터\Downloads\gopang_v2\sw.js'

for enc in ['utf-8', 'utf-8-sig', 'cp949', 'euc-kr', 'latin-1']:
    try:
        with open(sw_path, 'r', encoding=enc) as f:
            sw = f.read()
        print(f'OK: sw.js 읽기 성공 ({enc})')
        break
    except:
        continue

print('fetch 이벤트 존재:', 'fetch' in sw)
print('sw.js 첫 200자:', repr(sw[:200]))

# fetch 이벤트에 외부 URL 통과 처리 추가
old_fetch = "self.addEventListener('fetch', e => {"
if old_fetch in sw:
    new_fetch = """self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (!url.startsWith(self.location.origin)) return;
"""
    sw = sw.replace(old_fetch, new_fetch, 1)
    print('OK: sw.js fetch 이벤트 수정')
else:
    print('fetch 패턴 없음 — sw.js 내용:')
    print(sw[:1000])

with open(sw_path, 'w', encoding='utf-8') as f:
    f.write(sw)

# ── 2. location.js — geocode 중복 방지 ──────────────────────────
loc_path = r'C:\Users\주피터\Downloads\gopang_v2\js\core\location.js'
with open(loc_path, 'r', encoding='utf-8') as f:
    loc = f.read()

# _onGPSSuccess 함수 찾기
idx = loc.find('async function _onGPSSuccess')
if idx != -1:
    print('\n_onGPSSuccess 위치:', idx)
    print(repr(loc[idx:idx+300]))

    # notifyLocationUpdate() 직전에 geocode 중복 방지 추가
    old = """  userLocation = { lat, lng, accuracy, source: 'gps' };
  locationReady = true;
  console.info('[Location] GPS 획득:', lat.toFixed(5), lng.toFixed(5), '정확도', Math.round(accuracy) + 'm');

  // 역지오코딩 — Worker /geocode 엔드포인트 (fiil과 동일)
  const addr = await reverseGeocode(lat, lng);
  if (addr) {
    userLocation.address = addr;
    console.info('[Location] 역지오코딩:', addr);
  }
  notifyLocationUpdate();"""

    new = """  userLocation = { lat, lng, accuracy, source: 'gps' };
  locationReady = true;
  console.info('[Location] GPS 획득:', lat.toFixed(5), lng.toFixed(5), '정확도', Math.round(accuracy) + 'm');

  // 역지오코딩 — 100m 이동 시만 재호출 (중복 방지)
  const geoKey = lat.toFixed(3) + ',' + lng.toFixed(3);
  if (!_onGPSSuccess._lastKey || _onGPSSuccess._lastKey !== geoKey) {
    _onGPSSuccess._lastKey = geoKey;
    const addr = await reverseGeocode(lat, lng);
    if (addr) {
      userLocation.address = addr;
      console.info('[Location] 역지오코딩:', addr);
    }
  }
  notifyLocationUpdate();"""

    if old in loc:
        loc = loc.replace(old, new)
        print('OK: geocode 중복 방지 수정')
    else:
        print('FAIL: 패턴 없음')
else:
    print('FAIL: _onGPSSuccess 없음')

with open(loc_path, 'w', encoding='utf-8') as f:
    f.write(loc)

print('\n완료')
