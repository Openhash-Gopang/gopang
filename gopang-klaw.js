// gopang-klaw.js — K-Law·Fiil·현장보고서·PDV보고
function _parseKCleanerReply(text) {
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
async function _updateFiilReport(reportId, parsed) {
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


// ══════════════════════════════════════════════════════════════════════
// K-Law 백그라운드 감시 파이프라인 v1.0
//
// 역할: 사용자가 요청하지 않아도 모든 대화·서비스 결과를
//       자동으로 검토하여 법적/분쟁 리스크를 감지합니다.
//
// 트리거:
//   1. callAI() 완료 후 → 대화 내용 자동 검토
//   2. _recordPDV() 호출 후 → 서비스 결과 자동 검토
//
// 결과:
//   - RISK_HIGH/RISK_CRITICAL → 채팅창에 경고 버블 즉시 표시
//   - RISK_LOW/RISK_MEDIUM   → PDV에만 조용히 기록
//   - RISK_NONE              → 무시
// ══════════════════════════════════════════════════════════════════════

// ── K-Law 감시 상태 ────────────────────────────────────────────────
let _klawBusy          = false;   // 중복 실행 방지
let _klawLastCheck     = 0;       // 마지막 검토 시각 (ms)
const KLAW_COOLDOWN_MS = 30000;   // 30초 쿨다운 (과도한 API 호출 방지)

// K-Law Monitor 프롬프트 캐시 (감시용 경량 프롬프트 — v15.1 판결예측과 별개)
let _klawMonitorPrompt = null;
async function _getKlawPrompt() {
  if (_klawMonitorPrompt) return _klawMonitorPrompt;
  try {
    const res = await fetch('/klaw/prompts/monitor_prompt.txt');
    if (res.ok) {
      _klawMonitorPrompt = await res.text();
      console.info('[K-Law Monitor] 프롬프트 로드 완료');
      return _klawMonitorPrompt;
    }
  } catch(e) { console.warn('[K-Law Monitor] 프롬프트 로드 실패:', e.message); }
  return null;
}

// ── 리스크 레벨 정의 ────────────────────────────────────────────────
const KLAW_RISK = {
  NONE:     { label: null,              show: false },
  LOW:      { label: '🟢 낮음',         show: false },  // PDV만 기록
  MEDIUM:   { label: '🟡 검토 권고',    show: false },  // PDV만 기록
  HIGH:     { label: '🟠 주의 필요',    show: true  },  // 채팅창 경고
  CRITICAL: { label: '🔴 법적 리스크',  show: true  },  // 채팅창 즉시 경고
};

// ── 메인: K-Law 백그라운드 검토 ────────────────────────────────────
// source: 'conversation' | 'service'
// payload: 검토할 텍스트 또는 서비스 데이터
async function _klawReview(source, payload) {
  // 쿨다운 및 중복 실행 방지
  const now = Date.now();
  if (_klawBusy) return;
  if (now - _klawLastCheck < KLAW_COOLDOWN_MS) return;

  // K-Law 프롬프트 로드
  const klawPrompt = await _getKlawPrompt();
  if (!klawPrompt) return;

  _klawBusy      = true;
  _klawLastCheck = now;

  try {
    // ── 검토 대상 텍스트 구성 ────────────────────────────────
    let reviewText = '';

    if (source === 'conversation') {
      // 최근 대화 5턴 추출 (system 제외)
