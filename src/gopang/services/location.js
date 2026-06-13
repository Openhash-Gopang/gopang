/**
 * services/location.js — GPS·역지오코딩·위치 관리
 */
import { setUserLocation, setLocationReady, setLocationPending,
         _userLocation, _locationReady, _locationPending,
         _installBannerVisible } from '../core/state.js';
import { CFG } from '../core/config.js';

// ── 위치 획득 (GPS 실제 좌표 우선) ──────────────────────────
// 원칙:
//   1순위: GPS 실제 좌표 (navigator.geolocation)
//   2순위: PDV 프로필에 저장된 주소
//   절대 금지: 임의로 도시 추정 ("서울" "역삼동" 등 가정 금지)
//
// 충돌 방지 원칙:
//   - PWA 설치 배너(beforeinstallprompt)와 GPS 권한 요청이 동시에 뜨면
//     Android Chrome이 두 번째 다이얼로그를 차단함
//   - 해결: GPS 요청을 PWA 배너 해소 후 OR 첫 메시지 전송 시로 지연

// ── GPS 지연 스케줄러 (PWA 배너와 충돌 방지) ────────────────
export function _scheduleLocation() {
  // 이미 설치된 앱(standalone)이거나 PWA 배너가 불필요한 경우
  // → 즉시 실행해도 충돌 없음
  if (_isInStandaloneMode() || localStorage.getItem(_INSTALL_DONE_KEY)) {
    _initLocation();
    return;
  }

  // beforeinstallprompt가 발생하면 배너가 표시될 수 있으므로
  // 배너 처리(설치 or 거절) 완료 신호를 기다림
  // 최대 대기: 6초 (배너가 뜨지 않는 환경 대비)
  const MAX_WAIT = 6000;
  const start = Date.now();

  function tryInit() {
    // PWA 배너 진행 중이 아니거나 대기 시간 초과 → GPS 요청
    if (!_installBannerVisible || Date.now() - start > MAX_WAIT) {
      _initLocation();
    } else {
      setTimeout(tryInit, 500);
    }
  }

  // PWA beforeinstallprompt가 없는 환경(iOS, 이미 설치 등)은
  // 1초 후 첫 시도, 이후 500ms 폴링 (최대 6초 대기)
  setTimeout(tryInit, 1000);
}

export function _initLocation() {
  if (_locationPending || _locationReady) return;
  setLocationPending(true);

  if (!navigator.geolocation) {
    _loadLocationFromPDV().finally(() => {
      setLocationPending(false);
      setLocationReady(true);
    });
    return;
  }

  let _watchId  = null;
  let _gotFirst = false;

  function _startWatch(highAccuracy) {
    if (_watchId !== null) navigator.geolocation.clearWatch(_watchId);

    _watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const newLat = pos.coords.latitude;
        const newLng = pos.coords.longitude;
        const newAcc = pos.coords.accuracy;

        // ── 좌표 변화량 계산 (50m 이상 변경 시에만 역지오코딩 재실행) ──
        const GEOCODE_THRESHOLD = 0.0005;  // 약 50m
        const coordChanged = !_userLocation?.lat ||
          Math.abs(newLat - _userLocation.lat) > GEOCODE_THRESHOLD ||
          Math.abs(newLng - _userLocation.lng) > GEOCODE_THRESHOLD;

        // 기존 address 보존 (좌표만 갱신)
        const prevAddress = _userLocation?.address || null;
        const prevRegion  = _userLocation?.region  || null;

        setUserLocation({
          lat:      newLat,
          lng:      newLng,
          accuracy: newAcc,
          source:   'GPS',
          address:  prevAddress,   // ← 기존 주소 유지
          region:   prevRegion,
        });

        _updateLocationInPrompt(coordChanged);  // 변경 여부 전달

        if (!_gotFirst) {
          _gotFirst        = true;
          setLocationPending(false);
          setLocationReady(true);
          console.log(`[Location] GPS 획득(${highAccuracy ? '고정밀' : '저정밀'}): ${newLat.toFixed(4)}, ${newLng.toFixed(4)} ±${Math.round(newAcc)}m`);
          if (!highAccuracy) _startWatch(true);
        }
      },
      (err) => {
        // PERMISSION_DENIED: 사용자가 팝업에서 거부 — 정상 경로, log만
        if (err.code === err.PERMISSION_DENIED) {
          console.log('[Location] GPS 권한 거부 — IP 폴백 사용');
        } else {
          console.warn(`[Location] GPS 실패(${highAccuracy ? '고정밀' : '저정밀'}):`, err.message);
        }
        navigator.geolocation.clearWatch(_watchId);
        _watchId = null;
        if (!highAccuracy && err.code !== err.PERMISSION_DENIED) {
          console.log('[Location] 고정밀 GPS로 재시도...');
          _startWatch(true);
        } else {
          setLocationPending(false);
          _loadLocationFromPDV().finally(() => { setLocationReady(true); });
        }
      },
      {
        enableHighAccuracy: highAccuracy,
        timeout:            highAccuracy ? 8000 : 5000,
        maximumAge:         0,
      }
    );
  }

  // ── Permission API로 현재 상태 먼저 확인 ─────────────────────
  // denied → 팝업 없이 즉시 IP 폴백 (팝업 전 오류 메시지 방지)
  // prompt → 팝업 표시 후 결과 처리
  // granted → 바로 watch 시작
  if (navigator.permissions) {
    navigator.permissions.query({ name: 'geolocation' }).then(result => {
      if (result.state === 'denied') {
        console.log('[Location] GPS 권한 이미 거부됨 — IP 폴백 사용');
        setLocationPending(false);
        _loadLocationFromPDV().finally(() => { setLocationReady(true); });
      } else {
        _startWatch(false);
      }
      result.onchange = () => {
        if (result.state === 'granted' && !_locationReady) {
          setLocationPending(false);
          setLocationReady(false);
          _initLocation();
        }
      };
    }).catch(() => { _startWatch(false); });
  } else {
    _startWatch(false);
  }
}

export async function _loadLocationFromPDV() {
  try {
    const pdvAddr = localStorage.getItem('gopang_profile_address');
    if (pdvAddr) {
      setUserLocation({ source: 'PDV', address: pdvAddr, lat: null, lng: null });
      _updateLocationInPrompt();
      console.log('[Location] PDV 주소 사용:', pdvAddr);
    } else {
      // PDV도 없으면 IP 기반 위치 시도 (무료 API, 정확도 낮음)
      await _loadLocationFromIP();
    }
  } catch {}
}

async function _loadLocationFromIP() {
  try {
    const res  = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(4000) });
    const data = await res.json();
    if (data.latitude && data.city) {
      setUserLocation({
        source:  'IP',
        address: `${data.country_name} ${data.region} ${data.city}`,
        lat:     data.latitude,
        lng:     data.longitude,
      };
      _updateLocationInPrompt();
      console.log('[Location] IP 위치 사용 (정확도 낮음):', _userLocation.address);
    } else {
      setUserLocation({ source: 'UNKNOWN', address: null, lat: null, lng: null });
    }
  } catch {
    setUserLocation({ source: 'UNKNOWN', address: null, lat: null, lng: null });
    console.warn('[Location] IP 위치도 실패 — GPS 권한을 허용하거나 PDV에 주소를 등록하세요.');
  }
}

// 위치 확인 후 시스템 프롬프트에 실제 좌표/주소 주입
export function _updateLocationInPrompt(coordChanged = false) {
  if (!_userLocation) return;
  let locStr = '';
  if (_userLocation.source === 'GPS' && _userLocation.lat) {
    locStr = `GPS좌표(${_userLocation.lat.toFixed(5)},${_userLocation.lng.toFixed(5)}) 정확도±${Math.round(_userLocation.accuracy)}m`;
    // 역지오코딩: 주소 없거나 좌표가 유의미하게 변경된 경우만 실행
    if (CFG.kakaoKey && (!_userLocation.address || coordChanged)) {
      _reverseGeocode(_userLocation.lat, _userLocation.lng).then(geo => {
        if (geo?.jibunAddress) {
          _userLocation.address = geo.jibunAddress;
          _userLocation.region  = geo.region;
          console.log('[GEO] GPS 역지오코딩 완료:', geo.jibunAddress);
          if (history.length <= 1) {
            history[0] && (history[0].content = CFG.system + _buildLocNote());
          }
        }
      }).catch(() => {});
    }
  } else if (_userLocation.source === 'PDV' && _userLocation.address) {
    locStr = `PDV주소:${_userLocation.address}`;
  } else if (_userLocation.source === 'IP' && _userLocation.address) {
    locStr = `IP기반위치(정확도낮음):${_userLocation.address}`;
  } else {
    locStr = '위치정보없음(GPS권한허용또는PDV주소등록필요)';
  }
  CFG.locationStr = locStr;

  if (history.length === 1 && history[0]?.role === 'system') {
    history[0].content = CFG.system + _buildLocNote();
    console.log('[Cache] 위치 갱신 — system 업데이트 (대화 시작 전)');
  }
}

// locNote 문자열 생성 (callAI + _updateLocationInPrompt 공용)
export function _buildLocNote() {
  if (!_userLocation) {
    return '\n\n[위치 정보 없음 — GPS 권한 미허용. 임의 추정 절대 금지.]';
  }
  const loc = _userLocation;
  let detail;
  if (loc.source === 'GPS' && loc.lat) {
    detail = `GPS좌표: ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)} (정확도 ±${Math.round(loc.accuracy||0)}m)`;
    // 역지오코딩 주소가 이미 있으면 함께 출력
    if (loc.address) detail += `\n행정구역 주소: ${loc.address}`;
    if (loc.region)  detail += `\n읍·면·동: ${loc.region.sido} ${loc.region.sigungu} ${loc.region.eupmyeon} ${loc.region.beonji}`;
  } else if (loc.source === 'PDV' && loc.address) {
    detail = `PDV등록주소: ${loc.address}`;
  } else if (loc.source === 'IP' && loc.address) {
    detail = `IP기반위치(정확도 낮음 — 시/도 수준): ${loc.address}`;
  } else {
    detail = '위치정보 없음 — 임의 추정 절대 금지.';
  }
  return `\n\n[현재 위치 — 반드시 이 정보만 사용할 것, 임의로 다른 도시 추정 절대 금지]\n${detail}`;
}



