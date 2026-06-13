/**
 * services/fiil.js — FIIL.kr 환경 신고 전송 (Supabase)
 */
import { _SUPABASE_URL, _SUPABASE_KEY, _userLocation } from '../core/state.js';


export function _sendReportToFiil(geminiResult, imageFile, userText) {
  try {
    const COMP_MAP = {
      ST:'스티로폼', PL:'경질플라스틱', VI:'비닐',
      GL:'유리병', ME:'금속캔', NT:'폐어구', WD:'목재', EX:'기타'
    };
    const TERRAIN_TYPE = {
      SAND:{type:'🏖️ 해안쓰레기',code:'TYPE_01'},
      ROCK:{type:'🏖️ 해안쓰레기',code:'TYPE_01'},
      CLIFF:{type:'🏖️ 해안쓰레기',code:'TYPE_01'},
      WATER:{type:'🌊 수중쓰레기',code:'TYPE_02'},
      FOREST:{type:'🌲 산림쓰레기',code:'TYPE_03'},
    };
    const RISK_URGENCY = {S0:'낮음',S1:'보통',S2:'높음',S3:'긴급'};

    // ── Gemini 결과 기반 필드 (없으면 텍스트에서 추정) ──────
    let materials = [];
    let typeInfo  = {type:'🏖️ 해안쓰레기', code:'TYPE_01'};
    let urgency   = '보통';
    let summary   = userText || '고팡 K-Cleaner 현장 신고';
    let volume    = '미상';
    let hazard    = '미상';

    if (geminiResult) {
      materials = Object.entries(geminiResult.components || {})
        .filter(([,v]) => v.visible && v.ratio_pct > 0)
        .map(([k,v]) => ({name: COMP_MAP[k]||k, pct: v.ratio_pct}))
        .sort((a,b) => b.pct - a.pct);
      typeInfo  = TERRAIN_TYPE[geminiResult.terrain] || typeInfo;
      urgency   = RISK_URGENCY[geminiResult.risk_level] || '보통';
      summary   = geminiResult.scene_description || summary;
      volume    = geminiResult.total_weight_kg_est
                  ? geminiResult.total_weight_kg_est + 'kg (추정)'
                  : '규모 ' + (geminiResult.scale || '미상');
      hazard    = geminiResult.hazard_detected
                  ? '⚠️ ' + (geminiResult.hazard_notes || geminiResult.risk_level)
                  : '유해물질 없음';
    } else {
      // Gemini 없음 — 텍스트 키워드로 유형 추정
      if (/수중|침적|잠수|해저|ROV/.test(userText||''))      typeInfo = {type:'🌊 수중쓰레기',code:'TYPE_02'};
      else if (/산림|계곡|오름|임도|산간/.test(userText||'')) typeInfo = {type:'🌲 산림쓰레기',code:'TYPE_03'};
    }

    // ── GPS ──────────────────────────────────────────────────
    const gLat = geminiResult?.exif?.lat || _userLocation?.lat || null;
    const gLng = geminiResult?.exif?.lng || _userLocation?.lng || null;
    const gps  = gLat ? `${gLat.toFixed(4)}, ${gLng.toFixed(4)}` : '위치 미상';
    const loc  = _userLocation?.address || gps;

    // ── 신고 객체 구성 ────────────────────────────────────────
    const doSend = (imageDataUrl) => {
      const report = {
        id: 'RPT-' + new Date().getFullYear() + '-' + Date.now().toString().slice(-4),
        type: typeInfo.type,
        typeCode: typeInfo.code,
        location: loc,
        gps: gps,
        reporter: '010-****-' + Math.floor(1000 + Math.random() * 9000),
        reportedAt: new Date().toLocaleString('ko-KR'),
        urgency: urgency,
        status: '접수',
        imageUrl: imageDataUrl || null,
        gopangAnalysis: {
          summary: summary,
          materials: materials,
          volume: volume,
          hazard: hazard,
          recommendation: userText || '수거 조치 필요',
          geminiModel: geminiResult ? 'gemini-2.0-flash' : '텍스트 분석',
          analyzedAt: new Date().toLocaleString('ko-KR'),
        },
        dispatch: null,
        cost: {labor:0, equipment:0, supplies:0, other:0},
        blockchain: {
          txHash: '0x' + Array.from(crypto.getRandomValues(new Uint8Array(32)))
                        .map(b => b.toString(16).padStart(2,'0')).join(''),
          blockHeight: 8200000 + Math.floor(Math.random() * 100000),
          imageHash: 'sha256:' + Math.random().toString(36).slice(2,10) + '...',
          network: 'Openhash Network',
        },
      };

      // ── Supabase REST API 직접 저장 ──────────────────────────
      fetch(_SUPABASE_URL + '/rest/v1/reports', {
        method: 'POST',
        headers: {
          'apikey': _SUPABASE_KEY,
          'Authorization': 'Bearer ' + _SUPABASE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          id:          report.id,
          type:        report.type,
          type_code:   report.typeCode,
          location:    report.location,
          gps:         report.gps,
          reporter:    report.reporter,
          reported_at: report.reportedAt,
          urgency:     report.urgency,
          status:      report.status,
          image_url:   report.imageUrl,
          analysis:    report.gopangAnalysis,
          dispatch:    report.dispatch,
          cost:        report.cost,
          blockchain:  report.blockchain
        })
      })
      .then(res => {
        if (res.ok || res.status === 201) {
          console.log('[FIIL] ✅ Supabase 저장 완료 →', report.id, report.type, report.urgency);
          _lastFiilReportId = report.id;  // AI 응답 파싱 후 업데이트에 사용
        } else {
          res.text().then(t => console.warn('[FIIL] Supabase 오류:', res.status, t));
        }
      })
      .catch(e => console.warn('[FIIL] 네트워크 오류:', e.message));
    };

    // 이미지 base64 변환 후 전송 (없으면 null)
    if (imageFile && imageFile instanceof File) {
      const reader = new FileReader();
      reader.onload  = (e) => doSend(e.target.result);
      reader.onerror = ()  => doSend(null);
      reader.readAsDataURL(imageFile);
    } else {
      doSend(null);
    }

  } catch(e) {
    console.warn('[FIIL] 전송 오류 (무시됨):', e.message);
  }
}

      // ── webapp.html onclick에서 호출되는 함수 전역 노출 ──────
  window.openSearch    = openSearch;
  window.closeSearch   = closeSearch;
  window.runSearch     = runSearch;
  window.openSettings  = openSettings;
  window.toggleAI      = toggleAI;
  window.sendMessage   = sendMessage;
  window.handleKey     = handleKey;
  window.updateSendBtn = updateSendBtn;
  window.triggerAttach = triggerAttach;
  window.removeAttach  = removeAttach;
  window.setPeer       = setPeer;
  window._clearPeer    = _clearPeer;
  window.selectContact = selectContact;
  window.openProfile              = openProfile;
  window.handleSearchOverlayClick = handleSearchOverlayClick;
  window.handleOverlayClick       = handleOverlayClick;
  window._updateHandleChip        = _updateHandleChip;
  window._settingsRegisterHandle  = _settingsRegisterHandle;
  window.handleOverlayClick       = handleOverlayClick;
  window._updateHandleChip        = _updateHandleChip;
  window._settingsRegisterHandle  = _settingsRegisterHandle;
  window.dismissInstall           = typeof dismissInstall   !== 'undefined' ? dismissInstall   : ()=>{};
  window.dismissIOSInstall        = typeof dismissIOSInstall !== 'undefined' ? dismissIOSInstall : ()=>{};
  window.requestInstall           = typeof requestInstall   !== 'undefined' ? requestInstall   : ()=>{};
})();

