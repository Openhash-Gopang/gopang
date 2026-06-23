/**
 * pdv/record.js — PDV 기록·체인·Supabase 연동
 */
import { _SUPABASE_URL, _SUPABASE_KEY, USER_GUID, _USER } from '../core/state.js';
import { CFG } from '../core/config.js';

// ── recordPDV — 하위 시스템 공통 PDV 표준 함수 (STEP 20) ────────
// 설계 원칙 P2: 모든 하위 시스템 PDV는 Worker /pdv/report 경유 필수
// 하위 시스템(market, gdc 등)이 window.recordPDV()를 호출하면
// Worker가 수신 → Supabase pdv_log INSERT + OpenHash 앵커링 처리
//
// @param {Object} report — 6하 원칙 포함 PDV 리포트 객체
//   필수: report.who.ipv6, report.what, report.why, report.svc
//   선택: report.block_hash (동기 앵커링 시 포함)
//         report.session_id (중복 방지용, STEP 11)
//         report.reporter_svc (보고 주체 서비스 ID)
// @returns {Promise<Response>}
export async function recordPDV({ report }) {
  if (!report) {
    console.warn('[recordPDV] report 객체 누락 — 호출 무시');
    return;
  }
  try {
    const res = await fetch(CFG.endpoint + '/pdv/report', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ report }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => res.status);
      console.warn('[recordPDV] Worker 오류:', res.status, err);
    } else {
      console.info('[recordPDV] Worker 전송 완료 | svc:', report.svc,
                   '| reporter_svc:', report.reporter_svc || '-',
                   '| session_id:', report.session_id || '-');
    }
    return res;
  } catch(e) {
    console.warn('[recordPDV] 네트워크 오류 (무시):', e.message);
  }
}
// 전역 노출 — 하위 시스템(market, gdc, kinsurance 등) window.recordPDV()로 접근
window.recordPDV = recordPDV;

// ── PDV 최근 요약 — 동적 ctx 주입용 (call-ai.js _buildLocNote와 동일 위치에 삽입) ──
// 그림자가 "PDV에서 인출"한다고 말해도 실제로 LLM은 IndexedDB/localStorage에
// 접근할 수 없으므로, 매 턴 최근 PDV 항목을 텍스트로 압축해 [ctx]에 동봉한다.
// 정적 system 프롬프트에는 절대 굽지 않는다(PDV는 계속 자라므로 캐시 prefix를
// 깨뜨리고, 오래된 정보가 영구 고정되는 문제가 생긴다 — 동적 주입만 사용).
const _PDV_NOTE_MAX_ITEMS = 8;
const _PDV_NOTE_MAX_CHARS = 500;

export function _buildPDVNote() {
  let log;
  try { log = JSON.parse(localStorage.getItem('gopang_pdv_log') || '[]'); }
  catch { return ''; }
  if (!Array.isArray(log) || !log.length) return '';

  const recent = log.slice(-_PDV_NOTE_MAX_ITEMS).reverse(); // 최신순
  const lines = [];
  let used = 0;
  for (const r of recent) {
    const summary = (r.summary || r.what || r.data?.location || '').toString().slice(0, 60);
    if (!summary) continue;
    const line = `· ${summary}`;
    if (used + line.length > _PDV_NOTE_MAX_CHARS) break;
    lines.push(line);
    used += line.length;
  }
  if (!lines.length) return '';
  return `\n\n[PDV 최근 기록 — 참고용, 추측 금지]\n` + lines.join('\n');
}


// 고팡 내부 전용. 직접 Supabase INSERT. 하위 시스템은 위 recordPDV() 사용.
export async function _recordPDV(record) {
  try {
    // ── 로컬 PDV 캐시 (localStorage) ──────────────────────
    const log = JSON.parse(localStorage.getItem('gopang_pdv_log') || '[]');
    log.push(record);
    if (log.length > 1000) log.splice(0, log.length - 1000);
    localStorage.setItem('gopang_pdv_log', JSON.stringify(log));

    // ── 6하 원칙 필드 구성 ─────────────────────────────────
    // 누가 (Who) — P17: guid 방어코드
    const _effectiveGuid = _USER?.guid || _USER?.ipv6 || null;
    const whoName = _USER?.phone
      ? _USER.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
      : 'GUID:' + (_effectiveGuid?.slice(0, 8) ?? 'unknown');

    // 어디서 (Where) — GPS 우선, 주소 fallback
    const locStr = _userLocation
      ? (_userLocation.address ||
         (_userLocation.lat
           ? `${_userLocation.lat.toFixed(5)},${_userLocation.lng.toFixed(5)}`
           : null))
      : (record.data?.location || null);

    // 어떻게 (How) — 입력 방식 추론
    const howStr = record.how
      || (record.data?.reportId  ? 'image'
        : record.type === 'klaw_monitor' ? 'auto'
        : 'text');

    // 왜 (Why) — 서비스명 또는 직접 기록된 의도
    const whyStr = record.why
      || (record.service ? record.service + ' 서비스 이용'
        : record.type === 'klaw_monitor' ? '법적 리스크 자동 감시'
        : record.type === 'service_task' ? '서비스 작업 완료'
        : '대화');

    // ── Supabase pdv_log 저장 ──────────────────────────────
    // 실제 컬럼명: guid(user_guid), type(record_type), summary_6w(6하원칙 요약)
    const res = await fetch(_SUPABASE_URL + '/rest/v1/pdv_log', {
      method: 'POST',
      headers: {
        'apikey': _SUPABASE_KEY, 'Authorization': 'Bearer ' + _SUPABASE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal,resolution=ignore-duplicates',
      },
      body: JSON.stringify({
        guid:              _effectiveGuid,
        source:            'gopang',
        type:              record.type,
        summary:           record.summary || null,
        summary_6w:        record.what    || record.summary || null,
        // 위치
        // (pdv_log에 location 컬럼 없음 — summary_6w에 포함)
        // Hash Chain 연동 (v3.0)
        session_id:        record.session_id        ?? null,
        chain_height:      record.chain_height       ?? null,
        chain_local_hash:  record.chain_local_hash   ?? null,
        openhash_anchored: false,
        via_worker:        false,
        reporter_svc:      null,
        block_hash:        record.block_hash         ?? null,
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.status);
      console.warn('[PDV] Supabase 오류:', res.status, err);
    } else {
      console.info('[PDV] 기록 완료:', record.type,
        '| session_id:', record.session_id?.slice(0, 8) || '-',
        '| chain_height:', record.chain_height ?? '-');
    }
  } catch(e) { console.warn('[PDV] 기록 실패:', e.message); }

  // K-Law 백그라운드 감시 트리거 — 서비스 완료 결과 자동 검토
  if (record.type === 'service_task' && record.serviceId !== 'klaw') {
    setTimeout(() => _klawReview('service', record), 2000);
  }
}

// ── PDV Chain 연동 유틸 (v3.0) ─────────────────────────────────────────────

/**
 * l1_ledger.user_hash를 클라이언트 local_hash로 교정
 * Worker의 단순화 공식과 클라이언트 h_i 공식이 달라 불일치 발생
 * → 클라이언트가 redeemClaim 직후 PATCH로 덮어씀
 */
export async function _patchL1LedgerUserHash(blockHash, localHash) {
  if (!blockHash || !localHash) return;
  try {
    const res = await fetch(
      _SUPABASE_URL + '/rest/v1/l1_ledger'
        + '?block_hash=eq.' + encodeURIComponent(blockHash),
      {
        method: 'PATCH',
        headers: {
          'apikey':        _SUPABASE_KEY,
          'Authorization': 'Bearer ' + _SUPABASE_KEY,
          'Content-Type':  'application/json',
          'Prefer':        'return=minimal',
        },
        body: JSON.stringify({ user_hash: localHash }),
      }
    );
    if (res.ok) {
      console.info('[PDV] l1_ledger.user_hash 교정 완료 | block_hash:',
        blockHash.slice(0, 8), '| user_hash:', localHash.slice(0, 8));
    } else {
      console.warn('[PDV] l1_ledger.user_hash PATCH 실패 | status:', res.status);
    }
  } catch(e) {
    console.warn('[PDV] _patchL1LedgerUserHash 오류:', e.message);
  }
}

/**
 * B-3: market 등 하위 시스템이 이미 INSERT한 pdv_log 레코드에
 *      chain_height / chain_local_hash 소급 기록
 * 타이밍 경쟁 조건 대응: 실패 시 300ms 후 1회 재시도 (설계서 E2 수정)
 */
export async function _patchPdvChainHeight(sessionId, chainHeight, chainLocalHash, retry = true) {
  if (!sessionId || chainHeight == null) return;
  try {
    const res = await fetch(
      _SUPABASE_URL + '/rest/v1/pdv_log'
        + '?session_id=eq.' + encodeURIComponent(sessionId)
        + '&chain_height=is.null',
      {
        method: 'PATCH',
        headers: {
          'apikey':        _SUPABASE_KEY,
          'Authorization': 'Bearer ' + _SUPABASE_KEY,
          'Content-Type':  'application/json',
          'Prefer':        'return=minimal',
        },
        body: JSON.stringify({
          chain_height:     chainHeight,
          chain_local_hash: chainLocalHash,
        }),
      }
    );
    if (res.ok) {
      console.info('[PDV] chain_height 소급 완료 | session_id:',
        sessionId.slice(0, 8), '| height:', chainHeight);
    } else if (retry) {
      console.warn('[PDV] chain_height PATCH 실패 — 300ms 후 재시도 | status:', res.status);
      setTimeout(() =>
        _patchPdvChainHeight(sessionId, chainHeight, chainLocalHash, false),
        300
      );
    } else {
      console.warn('[PDV] chain_height PATCH 최종 실패 | status:', res.status);
    }
  } catch(e) {
    console.warn('[PDV] _patchPdvChainHeight 오류:', e.message);
  }
}

/**
 * B-4: Supabase INSERT 완료 후 IDB hash_chain 레코드의 pdv_anchored를 true로 갱신
 */
export async function _markPdvAnchored(height) {
  try {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('gopang-wallet');
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
    const tx    = db.transaction('hash_chain', 'readwrite');
    const store = tx.objectStore('hash_chain');
    const rec   = await new Promise((resolve, reject) => {
      const r = store.get(height);
      r.onsuccess = e => resolve(e.target.result);
      r.onerror   = e => reject(e.target.error);
    });
    if (rec) {
      rec.pdv_anchored = true;
      store.put(rec);
      console.info('[PDV] pdv_anchored 갱신 | height:', height);
    }
  } catch(e) {
    console.warn('[PDV] pdv_anchored 갱신 실패:', e.message);
  }
}

