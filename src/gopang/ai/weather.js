/**
 * ai/weather.js — 날씨·해양기상·역지오코딩·현장보고서
 */
import { CFG } from '../core/config.js';

export async function _reverseGeocode(lat, lng) {
  if (!CFG.kakaoKey || !lat || !lng) return null;
  try {
    const url = `https://dapi.kakao.com/v2/local/geo/coord2address.json` +
                `?x=${lng}&y=${lat}&input_coord=WGS84`;
    const res = await fetch(url, {
      headers: { 'Authorization': `KakaoAK ${CFG.kakaoKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.warn('[GEO] 카카오 역지오코딩 오류:', res.status);
      return null;
    }
    const data = await res.json();
    const doc  = data.documents?.[0];
    if (!doc) return null;

    // 도로명 주소 (있으면 우선)
    const road   = doc.road_address;
    const jibun  = doc.address;

    // 행정구역 상세 (읍·면·동·번지)
    const region = jibun ? {
      sido:     jibun.region_1depth_name,   // 시·도 (예: 제주특별자치도)
      sigungu:  jibun.region_2depth_name,   // 시·군·구 (예: 서귀포시)
      eupmyeon: jibun.region_3depth_name,   // 읍·면·동 (예: 대정읍)
      beonji:   jibun.main_address_no + (jibun.sub_address_no ? '-' + jibun.sub_address_no : ''), // 번지
      full:     jibun.address_name,         // 전체 지번 주소
    } : null;

    return {
      roadAddress:  road  ? road.address_name  : null,
      jibunAddress: jibun ? jibun.address_name : null,
      region,
    };
  } catch (e) {
    console.warn('[GEO] 역지오코딩 실패:', e.message);
    return null;
  }
}

// ── 날씨 정보 수집 (Open-Meteo 무료 API) ─────────────────────
export async function _fetchWeather(lat, lng) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?` +
      `latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
      `&current=temperature_2m,wind_speed_10m,wind_direction_10m,` +
      `precipitation,weather_code,visibility` +
      `&hourly=temperature_2m,wind_speed_10m,precipitation_probability` +
      `&forecast_days=1&timezone=Asia%2FSeoul`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const d = await res.json();
    const c = d.current;
    // 기상 코드 → 한국어 설명
    const WMO = {
      0:'맑음', 1:'대체로 맑음', 2:'구름 조금', 3:'흐림',
      45:'안개', 48:'안개(착빙)', 51:'이슬비(약)', 53:'이슬비', 55:'이슬비(강)',
      61:'비(약)', 63:'비', 65:'비(강)', 71:'눈(약)', 73:'눈', 75:'눈(강)',
      80:'소나기(약)', 81:'소나기', 82:'소나기(강)', 95:'뇌우', 99:'뇌우(우박)'
    };
    return {
      temp:      c.temperature_2m,
      wind:      c.wind_speed_10m,         // km/h
      windDir:   c.wind_direction_10m,      // 도
      precip:    c.precipitation,           // mm
      condition: WMO[c.weather_code] || '알 수 없음',
      visibility: c.visibility,             // m
      windMs:    (c.wind_speed_10m / 3.6).toFixed(1),  // m/s 변환
    };
  } catch { return null; }
}

// ── 해양 기상 (파고·조류) — 기상청 해양 예보 RSS ────────────
// 기상청 해양 특보·예보는 공개 RSS로 제공됨
// 제주 해역: 제주도남쪽먼바다 / 제주도해협 구분
export async function _fetchMarineWeather(lat, lng) {
  try {
    // Open-Meteo Marine API (파고·조류 무료 제공)
    const url = `https://marine-api.open-meteo.com/v1/marine?` +
      `latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
      `&current=wave_height,wave_direction,wave_period,` +
      `wind_wave_height,swell_wave_height` +
      `&hourly=wave_height,wave_direction,ocean_current_velocity,ocean_current_direction` +
      `&forecast_days=1&timezone=Asia%2FSeoul`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const d = await res.json();
    const c = d.current;
    // 시간별 조류 정보 (첫 6시간)
    const hours = d.hourly?.time?.slice(0,6).map((t, i) => ({
      time:      t.slice(11,16),
      current_v: d.hourly.ocean_current_velocity?.[i]?.toFixed(2),
      current_d: d.hourly.ocean_current_direction?.[i],
      wave_h:    d.hourly.wave_height?.[i]?.toFixed(2),
    })) || [];
    // 작업 가능 여부 판단
    const waveH    = c.wave_height ?? 0;
    const windMs   = 0; // 별도 날씨 API에서 가져옴
    const operable = waveH < 1.5; // 1.5m 초과 시 드론 작업 주의
    return {
      waveHeight:   c.wave_height?.toFixed(2),      // m
      waveDir:      c.wave_direction,                // 도
      wavePeriod:   c.wave_period?.toFixed(1),       // 초
      swellHeight:  c.swell_wave_height?.toFixed(2), // m
      windWave:     c.wind_wave_height?.toFixed(2),  // m
      operable,
      hours,
    };
  } catch { return null; }
}

// ── 현장 기상 종합 보고서 생성 ────────────────────────────────
export async function _buildFieldReport(lat, lng, exif, isMarine = false) {
  const [weather, marine, geoAddr] = await Promise.all([
    _fetchWeather(lat, lng),
    isMarine ? _fetchMarineWeather(lat, lng) : Promise.resolve(null),
    _reverseGeocode(lat, lng),   // ★ 역지오코딩 병렬 실행
  ]);

  const dirLabel = (deg) => {
    if (deg == null) return '알 수 없음';
    const dirs = ['북','북동','동','남동','남','남서','서','북서'];
    return dirs[Math.round(deg / 45) % 8];
  };

  let report = `\n\n[현장 기상 정보 — 수거 계획 반영 필수]\n`;
  report += `위치: ${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E\n`;

  // ── 역지오코딩 주소 출력 ──────────────────────────────────
  if (geoAddr) {
    if (geoAddr.roadAddress) {
      report += `도로명: ${geoAddr.roadAddress}\n`;
    }
    if (geoAddr.jibunAddress) {
      report += `지번: ${geoAddr.jibunAddress}\n`;
    }
    if (geoAddr.region) {
      const r = geoAddr.region;
      report += `행정구역: ${r.sido} ${r.sigungu} ${r.eupmyeon} ${r.beonji}\n`;
      // _userLocation에도 주소 반영 (AI 위치 주입용)
      if (_userLocation) _userLocation.address = geoAddr.jibunAddress || geoAddr.roadAddress;
    }
  }

  if (exif?.datetime) {
    const dt = exif.datetime.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
    report += `촬영시각: ${dt}\n`;
  }
  if (exif?.altitude != null) report += `고도: ${exif.altitude.toFixed(0)}m\n`;

  if (weather) {
    report += `\n[기상 현황]\n`;
    report += `날씨: ${weather.condition}\n`;
    report += `기온: ${weather.temp}°C\n`;
    report += `풍속: ${weather.windMs}m/s (${weather.wind}km/h) — ${dirLabel(weather.windDir)}풍\n`;
    report += `가시거리: ${(weather.visibility/1000).toFixed(1)}km\n`;
    report += `강수: ${weather.precip}mm\n`;
    // 드론 운용 기준
    const wMs = parseFloat(weather.windMs);
    const flyOk = wMs < 12;
    report += `드론 가동: ${flyOk ? '✅ 가능' : '⛔ 불가 (초속 12m/s 초과 — 자동 차단)'}\n`;
  }

  if (marine) {
    report += `\n[해양 기상 — 수중 작업 판단 기준]\n`;
    report += `파고(합산): ${marine.waveHeight}m / 너울: ${marine.swellHeight}m\n`;
    report += `파향: ${dirLabel(marine.waveDir)} / 파주기: ${marine.wavePeriod}초\n`;
    report += `수중 작업: ${marine.operable
      ? '✅ 가능 (파고 1.5m 미만)'
      : '⚠️ 주의 (파고 1.5m 이상 — 잠수부 안전 확인 필요)'}\n`;
    if (marine.hours.length > 0) {
      report += `\n[향후 6시간 조류·파고]\n`;
      for (const h of marine.hours) {
        report += `  ${h.time} | 파고:${h.wave_h}m | 조류:${h.current_v}m/s ${dirLabel(h.current_d)}향\n`;
      }
    }
  }
  return report;
}



// ※ 여기 있던 "SP-00-ROUTER 1단계 라우팅" 설계 메모는 2026-07-05 제거됨 —
// 실제로 구현되지 않은 채 router.js가 죽은 코드로 방치됐던 설계였다.
// 실제 라우팅은 AGENT-COMMON이 담당한다(prompts/archive/SP-00-ROUTER-DEPRECATED.md 참조).
