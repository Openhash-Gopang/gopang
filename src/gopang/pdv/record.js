/**
 * pdv/record.js — PDV 기록·체인·Supabase 연동
 */
import { _SUPABASE_URL, _SUPABASE_KEY, USER_GUID, _USER } from '../core/state.js';
import { CFG } from '../core/config.js';

// ── PDV 일상/업무 영역 모드 — AC-EVOLUTION_v1_1.md §PDV-SPLIT ──────────
// 시간대 기반 자동전환은 쓰지 않는다(AC-EVOLUTION-GAPS #13 — 자동전환은
// 근무시간이 불규칙한 대부분의 직종에서 틀리기 쉽고, 조용히 틀리면
// 사고(#12류 정보 혼입)로 이어진다). 오직 명시적 전환만 인정 —
// AGENT-COMMON이 사용자의 "업무 시작"/"퇴근했어요" 류 발화를 감지해
// [PDV_DOMAIN_SET: mode=work|personal] 태그로 알려주면 그때만 바뀐다.
// 세션을 새로 열면 항상 personal로 리셋(다음 세션에 이전 업무모드가
// 새어나가지 않도록 — 과소분류가 과다노출보다 안전하다는 원칙 재적용).
const _PDV_DOMAIN_KEY = 'gopang_pdv_domain_mode'; // sessionStorage — 세션 종료 시 자동 초기화

export function getPdvDomain() {
  try { return sessionStorage.getItem(_PDV_DOMAIN_KEY) === 'work' ? 'work' : 'personal'; }
  catch { return 'personal'; }
}

export function setPdvDomain(mode, affiliationOrgId = null) {
  const m = mode === 'work' ? 'work' : 'personal';
  try {
    sessionStorage.setItem(_PDV_DOMAIN_KEY, m);
    sessionStorage.setItem(_PDV_DOMAIN_KEY + '_org', m === 'work' ? (affiliationOrgId || '') : '');
  } catch (e) { console.warn('[PDV] 도메인 모드 저장 실패:', e.message); }
}

function _currentAffiliationOrgId() {
  try { return sessionStorage.getItem(_PDV_DOMAIN_KEY + '_org') || null; }
  catch { return null; }
}

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
  // AC-EVOLUTION_v1_1.md §PDV-SPLIT — 호출부가 명시하지 않으면 현재
  // 세션 모드를 그대로 태깅한다(하위 시스템이 매번 신경 쓰지 않아도
  // 되도록 기본값을 여기서 채움).
  if (!report.domain) report.domain = getPdvDomain();
  if (report.domain === 'work' && !report.affiliation_org_id) {
    report.affiliation_org_id = _currentAffiliationOrgId();
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

  // AC-EVOLUTION-GAPS #12 패치 — 현재 모드와 다른 도메인의 기록은 애초에
  // 이 턴의 컨텍스트에 넣지 않는다. domain 미기재 항목(패치 이전 기록)은
  // 'personal'로 취급 — 과거 데이터가 업무모드에 새어 들어가는 것보다
  // 개인모드에 남는 쪽이 안전하다.
  const mode = getPdvDomain();
  const curOrg = mode === 'work' ? _currentAffiliationOrgId() : null;
  const scoped = log.filter(r => {
    const d = r.domain === 'work' ? 'work' : 'personal';
    if (d !== mode) return false;
    // 업무모드에서도 "지금 이 소속" 기록만 보여준다 — 겸직 시 다른
    // 소속의 업무 기록이 섞여 들어가는 것도 막는다(AC-EVOLUTION §1 겸직 지원).
    if (mode === 'work' && curOrg && r.affiliation_org_id && r.affiliation_org_id !== curOrg) return false;
    return true;
  });

  const recent = scoped.slice(-_PDV_NOTE_MAX_ITEMS).reverse(); // 최신순
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
  const domainLabel = mode === 'work' ? '업무' : '일상';
  return `\n\n[PDV 최근 기록(${domainLabel} 영역) — 참고용, 추측 금지]\n` + lines.join('\n');
}


// 고팡 내부 전용. 직접 Supabase INSERT. 하위 시스템은 위 recordPDV() 사용.
export async function _recordPDV(record) {
  try {
    // AC-EVOLUTION_v1_1.md §PDV-SPLIT — 호출부가 명시 안 하면 현재 모드로.
    if (!record.domain) record.domain = getPdvDomain();
    if (record.domain === 'work' && !record.affiliation_org_id) {
      record.affiliation_org_id = _currentAffiliationOrgId();
    }
    // ── 로컬 PDV 캐시 (localStorage) ──────────────────────
    const log = JSON.parse(localStorage.getItem('gopang_pdv_log') || '[]');
    log.push(record);
    if (log.length > 1000) log.splice(0, log.length - 1000);
    localStorage.setItem('gopang_pdv_log', JSON.stringify(log));

    // ── IndexedDB 미러 갱신 트리거 (2026-07-02) ─────────────
    // pdv-store.js가 이 이벤트를 받아 gopang_pdv_store(IndexedDB)에 반영한다.
    // webapp.html에서만 의미 있음(그쪽에만 실제 record 이벤트가 흐름) —
    // pdv-store.js 쪽 리스너는 이미 구현돼 있었고 발행부만 빠져 있었음.
    try {
      window.dispatchEvent(new CustomEvent('gopang:pdv-recorded', { detail: record }));
    } catch (e) {
      console.warn('[PDV] gopang:pdv-recorded 이벤트 발행 실패:', e.message);
    }

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
        domain:            record.domain             ?? 'personal',
        affiliation_org_id: record.affiliation_org_id ?? null,
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

// ── project_state 저장/조회 (2026-07-17 신설 — mode=project human_action
// 일시정지·재개, SP-19 v1.2/SP-20 v1.6/SP-22 v1.1). worker.js
// /orchestration/project-state/* 경유 — L1 PocketBase project_states
// 컬렉션 직접 사용(일반 recordPDV의 pdv_records와는 별도 컬렉션).
export async function _saveProjectState(state) {
  if (!state?.project_id || !state?.goal || !state?.status) {
    console.warn('[ProjectState] 저장 무시 — project_id/goal/status 누락');
    return null;
  }
  try {
    const guid = _USER?.guid || _USER?.ipv6 || null;
    if (!guid) { console.warn('[ProjectState] guid 없음 — 저장 불가'); return null; }
    const res = await fetch(CFG.endpoint + '/orchestration/project-state/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...state, guid }),
    });
    if (!res.ok) {
      console.warn('[ProjectState] 저장 실패:', res.status);
      return null;
    }
    console.info('[ProjectState] 저장 완료:', state.project_id, '| status:', state.status);
    return await res.json();
  } catch (e) {
    console.warn('[ProjectState] 저장 오류(무시):', e.message);
    return null;
  }
}

// AGENT-COMMON §0-H [재개 판별]이 매 턴 시작 시 호출 — 열려있는(멈춰있는)
// 프로젝트가 있는지 확인. 없으면 빈 배열(평소처럼 §ROUTER-CONFIDENCE로).
export async function _loadOpenProjectStates() {
  try {
    const guid = _USER?.guid || _USER?.ipv6 || null;
    if (!guid) return [];
    const res = await fetch(
      CFG.endpoint + '/orchestration/project-state/query'
        + `?guid=${encodeURIComponent(guid)}&status=awaiting_human_action`
    );
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({ items: [] }));
    return data.items || [];
  } catch (e) {
    console.warn('[ProjectState] 조회 오류(무시):', e.message);
    return [];
  }
}



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

