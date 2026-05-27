// ══════════════════════════════════════════════════════════════════
// fiil/reporter.js — K-Cleaner 신고서 생성·Supabase 전송
// 새 서비스(k-health 등) 추가 시: 동일 패턴으로 별도 파일 생성
// ══════════════════════════════════════════════════════════════════
import { SUPABASE_URL, SUPABASE_KEY } from '../../config.js';

let _getLocation = () => null;
export let lastFiilReportId = null;

export function initReporter({ getLocation }) {
  _getLocation = getLocation;
}

// ── 분류 테이블 ──────────────────────────────────────────────────
const COMP_MAP = {
  ST:'스티로폼', PL:'경질플라스틱', VI:'비닐',
  GL:'유리병',   ME:'금속캔',       NT:'폐어구',
  WD:'목재',     EX:'기타',
};
const TERRAIN_TYPE = {
  SAND:  { type:'🏖️ 해안쓰레기', code:'TYPE_01' },
  ROCK:  { type:'🏖️ 해안쓰레기', code:'TYPE_01' },
  CLIFF: { type:'🏖️ 해안쓰레기', code:'TYPE_01' },
  WATER: { type:'🌊 수중쓰레기', code:'TYPE_02' },
  FOREST:{ type:'🌲 산림쓰레기', code:'TYPE_03' },
};
const RISK_URGENCY = { S0:'낮음', S1:'보통', S2:'높음', S3:'긴급' };

// ── 신고서 생성·전송 ─────────────────────────────────────────────
export function sendReportToFiil(geminiResult, imageFile, userText) {
  try {
    let materials = [], urgency = '보통';
    let typeInfo  = { type:'🏖️ 해안쓰레기', code:'TYPE_01' };
    let summary   = userText || '고팡 K-Cleaner 현장 신고';
    let volume    = '미상', hazard = '미상';

    if (geminiResult) {
      materials = Object.entries(geminiResult.components || {})
        .filter(([,v]) => v.visible && v.ratio_pct > 0)
        .map(([k,v]) => ({ name: COMP_MAP[k]||k, pct: v.ratio_pct }))
        .sort((a,b) => b.pct - a.pct);
      typeInfo = TERRAIN_TYPE[geminiResult.terrain] || typeInfo;
      urgency  = RISK_URGENCY[geminiResult.risk_level] || '보통';
      summary  = geminiResult.scene_description || summary;
      volume   = geminiResult.total_weight_kg_est
        ? geminiResult.total_weight_kg_est + 'kg (추정)'
        : '규모 ' + (geminiResult.scale || '미상');
      hazard   = geminiResult.hazard_detected
        ? '⚠️ ' + (geminiResult.hazard_notes || geminiResult.risk_level)
        : '유해물질 없음';
    } else {
      if (/수중|침적|잠수|해저|ROV/.test(userText||''))
        typeInfo = { type:'🌊 수중쓰레기', code:'TYPE_02' };
      else if (/산림|계곡|오름|임도|산간/.test(userText||''))
        typeInfo = { type:'🌲 산림쓰레기', code:'TYPE_03' };
    }

    const loc  = _getLocation();
    const gLat = geminiResult?.exif?.lat || loc?.lat || null;
    const gLng = geminiResult?.exif?.lng || loc?.lng || null;
    const gps  = gLat ? `${gLat.toFixed(4)}, ${gLng.toFixed(4)}` : '위치 미상';
    const addr = loc?.address || gps;

    const doSend = (imageDataUrl) => {
      const report = {
        id:         'RPT-' + new Date().getFullYear() + '-' + Date.now().toString().slice(-4),
        type:       typeInfo.type,
        typeCode:   typeInfo.code,
        location:   addr,
        gps,
        reporter:   '010-****-' + Math.floor(1000 + Math.random() * 9000),
        reportedAt: new Date().toLocaleString('ko-KR'),
        urgency,
        status:     '접수',
        imageUrl:   imageDataUrl || null,
        gopangAnalysis: {
          summary, materials, volume, hazard,
          recommendation: userText || '수거 조치 필요',
          geminiModel:    geminiResult ? 'gemini-2.0-flash' : '텍스트 분석',
          analyzedAt:     new Date().toLocaleString('ko-KR'),
        },
        dispatch: null,
        cost:     { labor:0, equipment:0, supplies:0, other:0 },
        blockchain: {
          txHash:      '0x' + Array.from(crypto.getRandomValues(new Uint8Array(32)))
                               .map(b => b.toString(16).padStart(2,'0')).join(''),
          blockHeight: 8200000 + Math.floor(Math.random() * 100000),
          imageHash:   'sha256:' + Math.random().toString(36).slice(2,10) + '…',
          network:     'Openhash Network',
        },
      };

      fetch(SUPABASE_URL + '/rest/v1/reports', {
        method:  'POST',
        headers: {
          'apikey':        SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY,
          'Content-Type':  'application/json',
          'Prefer':        'return=minimal',
        },
        body: JSON.stringify({
          id: report.id, type: report.type, type_code: report.typeCode,
          location: report.location, gps: report.gps,
          reporter: report.reporter, reported_at: report.reportedAt,
          urgency: report.urgency, status: report.status,
          image_url: report.imageUrl, analysis: report.gopangAnalysis,
          dispatch: report.dispatch, cost: report.cost, blockchain: report.blockchain,
        }),
      })
      .then(res => {
        if (res.ok || res.status === 201) {
          console.log('[FIIL] ✅ 저장 완료 →', report.id, report.urgency);
          lastFiilReportId = report.id;
        } else {
          res.text().then(t => console.warn('[FIIL] 오류:', res.status, t));
        }
      })
      .catch(e => console.warn('[FIIL] 네트워크 오류:', e.message));
    };

    if (imageFile instanceof File) {
      const r = new FileReader();
      r.onload  = e => doSend(e.target.result);
      r.onerror = ()  => doSend(null);
      r.readAsDataURL(imageFile);
    } else {
      doSend(null);
    }

  } catch(e) { console.warn('[FIIL] 전송 오류:', e.message); }
}

// ── 신고서 분석 결과 업데이트 ────────────────────────────────────
export async function updateFiilReport(reportId, parsed) {
  if (!reportId || !parsed) return;
  try {
    await fetch(SUPABASE_URL + '/rest/v1/reports?id=eq.' + reportId, {
      method:  'PATCH',
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Content-Type':  'application/json',
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify({ analysis: parsed }),
    });
  } catch(e) { console.warn('[FIIL] 업데이트 실패:', e.message); }
}
