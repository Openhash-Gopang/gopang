/**
 * services/kcleaner.js — K-Cleaner 이미지 분석·진행상황
 */
import { _userLocation } from '../core/state.js';
import { appendBubble } from '../ui/bubble.js';

export function _showGeminiProgress() {
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

export function _hideGeminiProgress(timer) {
  if (timer) clearInterval(timer);
  const fill = document.getElementById('gemini-progress-fill');
  if (fill) fill.style.width = '100%';
  setTimeout(() => {
    document.getElementById('gemini-progress-row')?.remove();
  }, 400);  // 100% 도달 애니메이션 후 제거
}

async function _callGeminiVision(imageFile, geminiKey) {
  const GEMINI_VISION_SYSTEM = `당신은 환경 현장 사진을 분석하는 객관적 데이터 추출 전문가다.

// ── FIIL.kr 신고 전송 — Supabase 직접 저장 ─────────────────
// localStorage/postMessage 방식 폐기 → Supabase REST API 사용
// 어떤 브라우저에서도 동일한 DB에 저장/조회 가능
// ── K-Cleaner AI 응답 텍스트 파싱 — 전체 데이터 추출 ────────
export function _parseKCleanerReply(text) {
  const R = {
    materials: [], volume: '', summary: '', terrain: '',
    drone: false, flights: 0, workHours: 0,
    disposal_site: '', disposal_gps: '',
    recycling_kg: 0, landfill_kg: 0, special_kg: 0,
    timeline: [], weather: {},
    gcs_points: 0, openhash_block_id: '',
    cost_detail: {
      labor_personnel: 0, drone_transport: 0,
      vehicle: 0, supplies: 0,
      collection_subtotal: 0, processing_subtotal: 0,
      total: 0,
    },
    processing_items: [],  // 처리비 세부
  };

  // ── 1. 성분 분석 ────────────────────────────────────────────
  const matRe = /[|│]\s*(ST|PL|VI|GL|ME|NT|WD|EX)\s+([^|│\n]+?)\s*[|│]\s*(\d+)%\s*[|│]\s*([\d.]+)\s*kg\s*[|│]\s*([^|│\n]+)/gm;
  let m;
  while ((m = matRe.exec(text)) !== null) {
    const pct = parseInt(m[3]);
    if (pct > 0) {
      R.materials.push({
        code: m[1].trim(),
        name: m[2].trim(),
        pct,
        weight_kg: parseFloat(m[4]),
        disposal: m[5].trim(),
      });
    }
  }
  // fallback: 중량 없는 형식
  if (!R.materials.length) {
    const matRe2 = /[|│]\s*(ST|PL|VI|GL|ME|NT|WD|EX)\s+([^|│\n]+?)\s*[|│]\s*(\d+)%/gm;
    while ((m = matRe2.exec(text)) !== null) {
      if (parseInt(m[3]) > 0) {
        R.materials.push({ code:m[1].trim(), name:m[2].trim(), pct:parseInt(m[3]), weight_kg:0, disposal:'' });
      }
    }
  }

  // ── 2. 총 중량 ────────────────────────────────────────────
  const wt = text.match(/총\s*추정\s*중량[:\s]*약?\s*([\d.]+)\s*kg/);
  if (wt) R.volume = wt[1] + 'kg';

  // ── 3. 지형 ─────────────────────────────────────────────
  const ter = text.match(/지형[:\s]*([^\n(（]{2,30})/);
  if (ter) R.terrain = ter[1].trim();

  // ── 4. 드론·비행횟수·작업시간 ──────────────────────────────
  R.drone = /드론.*필요|HeDRA|DJI/.test(text);
  const fl = text.match(/비행\s*횟수[:\s]*(\d+)회/);
  if (fl) R.flights = parseInt(fl[1]);
  const wh = text.match(/작업\s*시간[:\s]*(\d+)시간/);
  if (wh) R.workHours = parseInt(wh[1]);

  // ── 5. 처리 소계 ────────────────────────────────────────
  const rec = text.match(/재활용\s*가능[:\s]*([\d.]+)kg/);
  const lan = text.match(/매립\s*필요[:\s]*([\d.]+)kg/);
  const spe = text.match(/전문처리[:\s]*([\d.]+)kg/);
  if (rec) R.recycling_kg = parseFloat(rec[1]);
  if (lan) R.landfill_kg  = parseFloat(lan[1]);
  if (spe) R.special_kg   = parseFloat(spe[1]);

  // ── 6. 배출처 ────────────────────────────────────────────
  const ds = text.match(/[→]\s*([^\n(（]+환경적치장[^\n]*)/);
  if (ds) R.disposal_site = ds[1].trim();
  const dg = text.match(/GPS[:\s]*([\d.]+°[NS][,\s]*[\d.]+°[EW])/);
  if (dg) R.disposal_gps = dg[1];

  // ── 7. 예산 세부 ────────────────────────────────────────
  const costMap = [
    ['인건비',         'labor_personnel'],
    ['드론 운반비',    'drone_transport'],
    ['드론운반비',     'drone_transport'],
    ['차량 임차비',    'vehicle'],
    ['차량임차비',     'vehicle'],
    ['소모품비',       'supplies'],
    ['수거비 소계',    'collection_subtotal'],
    ['수거비소계',     'collection_subtotal'],
    ['처리비 소계',    'processing_subtotal'],
    ['처리비소계',     'processing_subtotal'],
  ];
  for (const [label, key] of costMap) {
    const re = new RegExp(label + '[\\s│]*([\\d,]+)원');
    const mc = text.match(re);
    if (mc) R.cost_detail[key] = parseInt(mc[1].replace(/,/g,''));
  }
  // 합계
  const tot = text.match(/합\s*계\s*[\s│]*([0-9,]{5,})원/);
  if (tot) R.cost_detail.total = parseInt(tot[1].replace(/,/g,''));

  // 처리비 항목별
  const procRe = /(ST[^│\n]*|PL[^│\n]*|VI[^│\n]*|NT[^│\n]*|GL[^│\n]*|ME[^│\n]*)\s+([\d,]+)원\s+\(([^)]+)\)/g;
  while ((m = procRe.exec(text)) !== null) {
    R.processing_items.push({ name: m[1].trim(), amount: parseInt(m[2].replace(/,/g,'')), note: m[3] });
  }

  // ── 8. 타임라인 ─────────────────────────────────────────
  const tlRe = /(\d+\.\d+h~\d+\.\d+h)[:\s]*([^\n]+)/g;
  while ((m = tlRe.exec(text)) !== null) {
    R.timeline.push({ time: m[1], desc: m[2].trim() });
  }

  // ── 9. 기상 ─────────────────────────────────────────────
  const wx_weather = text.match(/날씨[:\s]*([^\n\/,]+)/);
  const wx_temp    = text.match(/기온[:\s]*([\d.]+)°C/);
  const wx_wind    = text.match(/풍속[:\s]*([\d.]+)m\/s/);
  const wx_drone   = /드론 가동.*가능/.test(text);
  if (wx_weather) R.weather.condition = wx_weather[1].trim();
  if (wx_temp)    R.weather.temp_c    = parseFloat(wx_temp[1]);
  if (wx_wind)    R.weather.wind_ms   = parseFloat(wx_wind[1]);
  R.weather.drone_ok = wx_drone;

  // ── 10. GCS·블록ID ──────────────────────────────────────
  const gcs = text.match(/GCS.*?[+＋]([\d]+)P/);
  if (gcs) R.gcs_points = parseInt(gcs[1]);
  const blk = text.match(/KC-[\d]+-[\w]+/);
  if (blk) R.openhash_block_id = blk[0];

  console.log('[FIIL] 파싱 완료 — 성분', R.materials.length, '개, 합계 ₩' + R.cost_detail.total,
              '타임라인', R.timeline.length, '단계');
  return R;
}

// ── Supabase reports 행 업데이트 — 전체 파싱 데이터 저장 ──────
export async function _updateFiilReport(reportId, parsed) {
  try {
    const res = await fetch(
      _SUPABASE_URL + '/rest/v1/reports?id=eq.' + reportId + '&select=analysis,cost&limit=1',
      { headers: { 'apikey': _SUPABASE_KEY, 'Authorization': 'Bearer ' + _SUPABASE_KEY } }
    );
    const rows = await res.json();
    const existing = rows[0] || {};
    const analysis = existing.analysis || {};

    // 성분 (중량·처리경로 포함)
    if (parsed.materials.length > 0) analysis.materials = parsed.materials;
    if (parsed.volume)               analysis.volume    = parsed.volume;
    if (parsed.terrain)              analysis.terrain   = parsed.terrain;
    if (parsed.drone)                analysis.drone     = parsed.drone;
    if (parsed.flights)              analysis.flights   = parsed.flights;
    if (parsed.workHours)            analysis.work_hours= parsed.workHours;
    if (parsed.recycling_kg)         analysis.recycling_kg  = parsed.recycling_kg;
    if (parsed.landfill_kg)          analysis.landfill_kg   = parsed.landfill_kg;
    if (parsed.special_kg)           analysis.special_kg    = parsed.special_kg;
    if (parsed.disposal_site)        analysis.disposal_site = parsed.disposal_site;
    if (parsed.disposal_gps)         analysis.disposal_gps  = parsed.disposal_gps;
    if (parsed.timeline.length)      analysis.timeline      = parsed.timeline;
    if (parsed.weather.condition)    analysis.weather       = parsed.weather;
    if (parsed.gcs_points)           analysis.gcs_points    = parsed.gcs_points;
    if (parsed.openhash_block_id)    analysis.openhash_block_id = parsed.openhash_block_id;
    if (parsed.cost_detail.total)    analysis.cost_detail   = parsed.cost_detail;
    if (parsed.processing_items.length) analysis.processing_items = parsed.processing_items;

    // 비용 (Supabase cost 컬럼 — report.html 비용 섹션에 사용)
    const cd = parsed.cost_detail;
    const cost = {
      labor:     cd.labor_personnel || existing.cost?.labor     || 0,
      equipment: (cd.drone_transport || 0) + (cd.vehicle || 0) || existing.cost?.equipment || 0,
      supplies:  cd.processing_subtotal || existing.cost?.supplies || 0,
      other:     cd.supplies || 0,
    };

    const patchRes = await fetch(
      _SUPABASE_URL + '/rest/v1/reports?id=eq.' + reportId,
      {
        method: 'PATCH',
        headers: {
          'apikey': _SUPABASE_KEY,
          'Authorization': 'Bearer ' + _SUPABASE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ analysis, cost })
      }
    );
    if (patchRes.ok) {
      console.log('[FIIL] ✅ 전체 데이터 업데이트 완료 →', reportId,
        '성분', parsed.materials.length, '개 / 타임라인', parsed.timeline.length,
        '단계 / 합계 ₩' + cd.total);
    } else {
      const errText = await patchRes.text();
      console.warn('[FIIL] PATCH 오류:', patchRes.status, errText);
    }
  } catch(e) {
    console.warn('[FIIL] 업데이트 오류:', e.message);
  }
}


let _lastFiilReportId = null;  // 가장 최근 FIIL 신고 ID (AI 응답 파싱 업데이트용)


