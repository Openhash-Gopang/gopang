// gopang-gemini.js — Gemini Vision·EXIF·날씨·현장보고서
      const _preTab = (!_gwpActive) ? window.open('', '_blank') : null;
      await callAI(text, capturedFile, _preTab);
    } else {
      _runPipelineBackground(text);
      appendBubble('ai', '🔵 AI 버튼을 눌러 AI 비서를 활성화하세요.');
    }
    return;
  }

  // text 없는 경우 (이미지만) → callAI로 처리
  if (capturedFile && aiActive) {
    await callAI('', capturedFile);
  }
}

// ── 고팡 파이프라인 백그라운드 실행 ─────────────────────
// 대화 중 결과를 표시하지 않음 — 사용자 요청 시 showRiskAnalysis() 호출
let _lastPipelineResult = null;

async function _runPipelineBackground(text) {
  try {
    const { runPipeline } = await import('./src/ai-secretary/pipeline.js');
    const result = await runPipeline(
      { content: text, senderId: 'user', attachment: attachFile ?? null },
      {}
    );
    _lastPipelineResult = result;

    // OpenHash ref는 상태 바에만 조용히 업데이트
    if (result?.anchorHash) {
      const el = document.getElementById('hash-ref');
      if (el) el.textContent = result.anchorHash.slice(0, 8) + '…';
    }

    // S3 감지 시 즉시 경고 (위험 등급 S3만 예외적으로 즉시 표시)
    if (result?.riskResult?.level === 'S3') {
      const chip = riskChip('S3', result.riskResult.legalFlags ?? []);
      appendBubble('ai',
        `🛑 위험 감지 — 즉시 확인이 필요합니다. ${chip}`, true);
    }
  } catch (e) {
    // 파이프라인 오류는 콘솔에만 기록, 사용자에게 표시하지 않음
    console.warn('[Pipeline]', e.message);
  }
}

// 사용자 요청 시 분석 결과 표시 (예: "분석 결과 보여줘")
function showRiskAnalysis() {
  if (!_lastPipelineResult) {
    appendBubble('ai', '분석된 메시지가 없습니다.');
    return;
  }
  const r   = _lastPipelineResult.riskResult;
  const chip = riskChip(r?.level ?? 'S0', r?.legalFlags ?? []);
  appendBubble('ai',
    `분석 완료 ${chip}${r?.legalFlags?.length ? '<br>' + r.legalFlags.join(' · ') : ''}`,
    true);
}

// ── DeepSeek API 호출 ───────────────────────────────────
// ── 모델별 비전 지원 여부 ────────────────────────────────
// DeepSeek Vision 지원: deepseek-chat(V3)만 이미지 지원
// deepseek-v4-pro / deepseek-v4-flash 는 텍스트 전용 (이미지 불가)
const VISION_MODELS = new Set([
  'deepseek-chat',        // DeepSeek V3 — Vision 지원 (유일)
  'gpt-4o', 'gpt-4o-mini',
  'claude-sonnet-4-20250514', 'claude-opus-4-20250514',
  'gemini-2.0-flash', 'gemini-1.5-pro',
]);
function _modelSupportsVision(model) {
  return VISION_MODELS.has(model);
}

// 이미지 File → base64 data URL 변환
function _fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);   // "data:image/jpeg;base64,..."
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── EXIF GPS·시간 추출 (순수 JS, 외부 라이브러리 불필요) ────
// ── Gemini Vision 호출 — K-Cleaner 이미지 분석 전담 ─────────
// SP-14-IMG v1.0 system prompt 기반으로 구조화된 JSON 반환
// ── Gemini 분석 중 Progress Bar 헬퍼 ────────────────────────
function _showGeminiProgress() {
  const list = document.getElementById('message-list');
  const row  = document.createElement('div');
  row.className = 'msg-row ai';
  row.id = 'gemini-progress-row';

  const bubble = document.createElement('div');
  bubble.className = 'bubble bubble-ai gemini-progress-wrap';
  bubble.innerHTML = `
    <div class="gemini-progress-label">
      <div class="gp-spinner"></div>
      <span id="gemini-progress-text">📸 현장 이미지 분석 중…</span>
    </div>
    <div class="gemini-progress-bar-bg">
      <div class="gemini-progress-bar-fill" id="gemini-progress-fill"></div>
    </div>`;

  row.appendChild(bubble);
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;

  // 15초 기준 자동 진행 (실제 완료 시 _hideGeminiProgress 호출)
  let pct = 0;
  const fill = document.getElementById('gemini-progress-fill');
  const textEl = document.getElementById('gemini-progress-text');
  const STEPS = [
    { at: 10,  label: '📸 이미지 해상도 분석 중…' },
    { at: 25,  label: '🔍 폐기물 성분 식별 중…' },
    { at: 45,  label: '📊 규모 및 중량 추정 중…' },
    { at: 65,  label: '📍 지형·위험도 판단 중…' },
    { at: 80,  label: '✅ 분석 마무리 중…' },
    { at: 92,  label: '✅ 분석 완료 직전…' },
  ];

  const timer = setInterval(() => {
    pct = Math.min(pct + 1.2, 92);  // 최대 92%까지 (완료 시 100%)
    if (fill) fill.style.width = pct + '%';
    const step = STEPS.filter(s => pct >= s.at).pop();
    if (step && textEl) textEl.textContent = step.label;
    if (pct >= 92) clearInterval(timer);
  }, 180);  // ~15초에 92% 도달

  return timer;
}

function _hideGeminiProgress(timer) {
  if (timer) clearInterval(timer);
  const fill = document.getElementById('gemini-progress-fill');
  if (fill) fill.style.width = '100%';
  setTimeout(() => {
    document.getElementById('gemini-progress-row')?.remove();
  }, 400);  // 100% 도달 애니메이션 후 제거
}

async function _callGeminiVision(imageFile, geminiKey) {
  const GEMINI_VISION_SYSTEM = `당신은 환경 현장 사진을 분석하는 객관적 데이터 추출 전문가다.
사진에서 보이는 사실만 수치로 추출한다. 판단·해석·견적·보고서 작성은 절대 하지 않는다.
결과는 반드시 아래 JSON 형식으로만 출력한다. JSON 외 어떠한 텍스트도 출력하지 않는다.
8대 성분: ST=스티로폼 PL=경질플라스틱 VI=비닐 GL=유리병 ME=금속캔 NT=폐어구 WD=목재 EX=기타
(ratio_pct 합계 반드시 100. 보이지 않는 성분은 0/false)
규모: XS(<50kg모래) S(50~200kg암반) M(200~400kg) L(400~1000kg) XL(1000kg↑)
지형: SAND|ROCK|CLIFF|WATER|FOREST|UNKNOWN
위험도: S0(일반) S1(대량) S2(오염위험) S3(유해물질)
출력: JSON만. 설명·인사·부연 절대 금지.`;

  const dataUrl  = await _fileToBase64(imageFile);
  const mimeType = imageFile.type || 'image/jpeg';
  const base64   = dataUrl.split(',')[1];

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`;
  const body = {
    system_instruction: { parts: [{ text: GEMINI_VISION_SYSTEM }] },
    contents: [{
      role: 'user',
      parts: [
        { inline_data: { mime_type: mimeType, data: base64 } },
        { text: '이 이미지를 분석하여 아래 JSON 형식으로만 출력하라:\n{"analysis_version":"SP-14-IMG-v1.0","image_quality":"GOOD|FAIR|POOR","confidence":0.85,"components":{"ST":{"ratio_pct":0,"weight_kg_est":null,"visible":false},"PL":{"ratio_pct":0,"weight_kg_est":null,"visible":false},"VI":{"ratio_pct":0,"weight_kg_est":null,"visible":false},"GL":{"ratio_pct":0,"weight_kg_est":null,"visible":false},"ME":{"ratio_pct":0,"weight_kg_est":null,"visible":false},"NT":{"ratio_pct":0,"weight_kg_est":null,"visible":false},"WD":{"ratio_pct":0,"weight_kg_est":null,"visible":false},"EX":{"ratio_pct":0,"weight_kg_est":null,"visible":false}},"total_weight_kg_est":null,"scale":"S","terrain":"ROCK","risk_level":"S1","hazard_detected":false,"hazard_notes":null,"area_est_m2":null,"coastline_length_est_m":null,"notable_items":[],"exif":{"lat":null,"lng":null,"datetime":null,"altitude_m":null},"scene_description":""}' }
      ]
    }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
  };

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Gemini API ${res.status}: ${err.slice(0,200)}`);
  }

  const data  = await res.json();
  const text  = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

// ── SP-00-GEN: 전용 SP 없을 때 Gemini 범용 이미지 분석 ────
async function _callGeminiGeneral(imageFile, geminiKey, userText) {
  const systemPrompt =
    `당신은 친절하고 유능한 AI 비서다. 사용자가 보낸 이미지를 분석하고 사용자의 요청을 파악하여 도움을 제공한다.\n` +
    `반드시 아래 JSON 형식으로만 출력하라. JSON 외 텍스트 금지.\n` +
    `{\n` +
    `  "scene_type": "사진 유형",\n` +
    `  "main_subject": "주요 피사체",\n` +
    `  "objects_detected": ["감지된 물체 목록"],\n` +
    `  "user_intent": "사용자 요청/의도 파악",\n` +
    `  "response": "사용자 요청에 대한 친절한 답변 2~4문장",\n` +
    `  "actions": ["권고 또는 안내 사항 1", "권고 또는 안내 사항 2"],\n` +
    `  "urgency": "낮음|보통|높음|긴급",\n` +
    `  "scene_description": "이미지 객관적 설명 2~3문장"\n` +
    `}`;

  const dataUrl  = await _fileToBase64(imageFile);
  const mimeType = imageFile.type || 'image/jpeg';
  const base64   = dataUrl.split(',')[1];

  const url  = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`;
  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{
      role: 'user',
      parts: [
        { inline_data: { mime_type: mimeType, data: base64 } },
        { text: userText ? `사용자 메시지: "${userText}"\n이미지와 메시지를 함께 분석하여 JSON으로 응답하라.`
                         : '이미지를 분석하여 사용자의 의도를 파악하고 JSON으로 응답하라.' }
      ]
    }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 1024 }
  };

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Gemini GEN API ${res.status}`);
  const data  = await res.json();
  const text  = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  const clean = text.replace(/```json|```/g, '').trim();
  const result = JSON.parse(clean);
  result._sp_code   = 'SP-00-GEN';
  result.risk_level = { '낮음':'S0','보통':'S1','높음':'S2','긴급':'S3' }[result.urgency] || 'S0';
  return result;
}

// Gemini 분석 결과 → DeepSeek 전달용 요약 텍스트 변환
function _geminiResultToText(result, userText) {
  // SP-00-GEN: 범용 분석 결과 → 그대로 response 반환
  if (result._sp_code === 'SP-00-GEN') {
    const intentGuide = userText
      ? `사용자원문: ${userText}`
      : `(텍스트 없음 — 이미지만 전송)`;
    return `[Gemini 범용 이미지 분석 결과 — SP-00-GEN]\n` +
      `사진유형: ${result.scene_type||'미상'}\n` +
      `주요피사체: ${result.main_subject||'미상'}\n` +
      `감지물체: ${(result.objects_detected||[]).join(', ')||'없음'}\n` +
      `사용자의도: ${result.user_intent||'미상'}\n` +
      `AI응답: ${result.response||'없음'}\n` +
      `권고사항: ${(result.actions||[]).join(' / ')||'없음'}\n` +
      `설명: ${result.scene_description||''}\n` +
      `---\n${intentGuide}\n` +
      `위 분석을 바탕으로 사용자의 요청에 맞는 친절하고 실용적인 답변을 제공하라.`;
  }

  // SP-14-IMG: 해양쓰레기 분석 결과
  const c     = result.components || {};
  const parts = Object.entries(c)
    .filter(([, v]) => v.visible && v.ratio_pct > 0)
    .map(([k, v]) => `${k}(${v.ratio_pct}%·${v.weight_kg_est||'?'}kg)`)
    .join(', ');

  // 사용자가 텍스트를 입력하지 않은 경우 — 이미지만으로 의도 자율 파악
  const intentGuide = userText
    ? `사용자원문: ${userText}\n위 Gemini 분석 결과를 바탕으로 K-Cleaner v1.2 방법론에 따라 수거견적서와 환경신고서를 작성하라.`
    : `사용자원문: (없음 — 텍스트 없이 이미지만 전송됨)\n\n[자율 의도 파악 지시]\n사용자가 별도 설명 없이 이미지만 전송했다. 아래 순서로 처리하라:\n① 이미지 내용에서 사용자의 목적·요구를 스스로 판단한다.\n② 환경 오염·쓰레기 현장 사진이면 → K-Cleaner v1.2 신고·견적 절차를 자동 실행한다.\n③ 환경 외 사진(음식·문서·사람·사물 등)이면 → 사진에서 파악한 맥락에 맞는 적절한 도움을 제공한다.\n④ 불명확한 경우에만 한 가지 확인 질문을 한다. 단, 환경 신고 가능성이 조금이라도 있으면 먼저 신고·견적을 진행하고 추가 확인은 이후에 한다.`;

  return `[Gemini Vision 현장 분석 결과 — SP-14-IMG-v1.0]
신뢰도: ${Math.round((result.confidence||0)*100)}% | 이미지품질: ${result.image_quality||'?'}
규모: ${result.scale} | 지형: ${result.terrain} | 위험도: ${result.risk_level}
추정중량: ${result.total_weight_kg_est||'?'}kg | 면적: ${result.area_est_m2||'?'}㎡ | 해안선: ${result.coastline_length_est_m||'?'}m
성분구성: ${parts||'분석불가'}
주목항목: ${result.notable_items?.join(', ')||'없음'}
현장설명: ${result.scene_description||''}
위험물감지: ${result.hazard_detected ? '⚠️ '+result.risk_level : '없음'}
GPS(EXIF): ${result.exif?.lat ? result.exif.lat+', '+result.exif.lng : '없음'}
---
${intentGuide}`;
}

async function _extractExif(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const buf  = e.target.result;
        const view = new DataView(buf);
        const result = { lat: null, lng: null, datetime: null, altitude: null };

        // JPEG 확인 (FFD8)
        if (view.getUint16(0) !== 0xFFD8) { resolve(result); return; }

        let offset = 2;
        while (offset < buf.byteLength - 2) {
          const marker = view.getUint16(offset);
          offset += 2;
          if (marker === 0xFFE1) { // APP1 (EXIF)
            const segLen = view.getUint16(offset);
            const exifHeader = String.fromCharCode(
              view.getUint8(offset+2), view.getUint8(offset+3),
              view.getUint8(offset+4), view.getUint8(offset+5)
            );
            if (exifHeader === 'Exif') {
              const tiffStart = offset + 8;
              const littleEndian = view.getUint16(tiffStart) === 0x4949;
              const getUint = (o, s=2) => s===4
                ? (littleEndian ? view.getUint32(tiffStart+o, true) : view.getUint32(tiffStart+o, false))
                : (littleEndian ? view.getUint16(tiffStart+o, true) : view.getUint16(tiffStart+o, false));

              const ifd0 = getUint(4, 4);
              const entries = getUint(ifd0);
              let gpsIfdPtr = null;

              for (let i = 0; i < entries; i++) {
                const e0 = ifd0 + 2 + i * 12;
                const tag = getUint(e0);
                if (tag === 0x8825) gpsIfdPtr = getUint(e0+8, 4); // GPSInfo
                if (tag === 0x9003 || tag === 0x0132) { // DateTimeOriginal / DateTime
                  const strOff = getUint(e0+8, 4);
                  let dt = '';
                  for (let j = 0; j < 19; j++)
                    dt += String.fromCharCode(view.getUint8(tiffStart + strOff + j));
                  result.datetime = dt; // "2026:05:23 14:30:22"
                }
              }

              if (gpsIfdPtr) {
                const gpsEntries = getUint(gpsIfdPtr);
                const gpsData = {};
                for (let i = 0; i < gpsEntries; i++) {
                  const ge = gpsIfdPtr + 2 + i * 12;
                  const gtag = getUint(ge);
                  const goff = getUint(ge+8, 4);
                  const readRat = (o) => {
                    const num = getUint(o, 4);
                    const den = getUint(o+4, 4);
                    return den ? num / den : 0;
                  };
                  if ([1,2,3,4,5,6].includes(gtag)) gpsData[gtag] = { off: goff, type: getUint(ge+2) };
                }
                const toDD = (ratOff) => {
                  const d = readRat(tiffStart + ratOff);
                  const m = readRat(tiffStart + ratOff + 8);
                  const s2 = readRat(tiffStart + ratOff + 16);
                  return d + m/60 + s2/3600;
                };
                const readRat = (o) => {
                  const num = view.getUint32(tiffStart + o, littleEndian);
                  const den = view.getUint32(tiffStart + o + 4, littleEndian);
                  return den ? num / den : 0;
                };
                if (gpsData[2]) {
                  const lat = toDD(gpsData[2].off);
                  const latRef = view.getUint8(tiffStart + (gpsData[1]?.off || 0));
                  result.lat = (latRef === 83) ? -lat : lat; // 'S' = 83
                }
                if (gpsData[4]) {
                  const lng = toDD(gpsData[4].off);
                  const lngRef = view.getUint8(tiffStart + (gpsData[3]?.off || 0));
                  result.lng = (lngRef === 87) ? -lng : lng; // 'W' = 87
                }
                if (gpsData[6]) result.altitude = readRat(gpsData[6].off);
              }
            }
            break;
          }
          if ((marker & 0xFF00) !== 0xFF00) break;
          offset += view.getUint16(offset);
        }
        resolve(result);
      } catch { resolve({ lat: null, lng: null, datetime: null, altitude: null }); }
    };
    reader.onerror = () => resolve({ lat: null, lng: null, datetime: null, altitude: null });
    reader.readAsArrayBuffer(file);
  });
}

// ── 카카오 역지오코딩 — GPS 좌표 → 행정구역 주소 변환 ──────────
// API: https://dapi.kakao.com/v2/local/geo/coord2address.json
// 반환: { roadAddress, jibunAddress, region } 또는 null
async function _reverseGeocode(lat, lng) {
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
async function _fetchWeather(lat, lng) {
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
async function _fetchMarineWeather(lat, lng) {
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
async function _buildFieldReport(lat, lng, exif, isMarine = false) {
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




// ════════════════════════════════════════════════════════════════
// SP-00-ROUTER v3.0 — 1단계 서비스 라우팅
// 역할: 사용자 입력을 분석 → 어느 하위 서비스로 보낼지 결정
// 호출: callAI() 진입 직전에 runRouter()를 실행
// 출력: { category, service_id, service_url, confidence,
//         reason, secondary, urgent, gwp_ctx }
// ════════════════════════════════════════════════════════════════

// ── Router system prompt — GitHub 동적 로드 ──────────────────
// prompts/SP-00-ROUTER-LATEST.txt 에 현재 버전 파일명이 기재됨
// 파일명이 바뀌면 webapp.html 수정 없이 자동 반영
const _RAW_BASE    = 'https://raw.githubusercontent.com/Openhash-Gopang/gopang/main/';
const _ROUTER_PTR  = _RAW_BASE + 'prompts/SP-00-ROUTER-LATEST.txt';
const _ROUTER_FALLBACK = _RAW_BASE + 'prompts/SP-00-ROUTER-v3.0.txt';

let _routerPrompt      = null;   // 로드 완료 후 캐시
let _routerPromptVer   = null;   // 버전명 (로그용)
let _routerLoadPromise = null;   // 중복 fetch 방지
