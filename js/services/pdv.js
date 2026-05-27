// ══════════════════════════════════════════════════════════════════
// services/pdv.js — PDV (Private Data Vault) 기록
// ══════════════════════════════════════════════════════════════════
import { SUPABASE_URL, SUPABASE_KEY } from '../../config.js';

// 런타임에 init()에서 주입
let _getUser     = () => null;
let _getLocation = () => null;
let _onAfterRecord = null;  // K-Law 감시 트리거용 콜백

export function initPDV({ getUser, getLocation, onAfterRecord }) {
  _getUser       = getUser;
  _getLocation   = getLocation;
  _onAfterRecord = onAfterRecord;
}

// ── PDV 기록 (로컬 + Supabase) ──────────────────────────────────
export async function recordPDV(record) {
  // 1. 로컬 캐시
  const log = JSON.parse(localStorage.getItem('gopang_pdv_log') || '[]');
  log.push({ ...record, ts: Date.now() });
  if (log.length > 1000) log.splice(0, log.length - 1000);
  localStorage.setItem('gopang_pdv_log', JSON.stringify(log));

  const user = _getUser();
  if (!user) return;  // 미초기화 시 로컬만 저장

  // 2. 6하 원칙 필드 구성
  const loc = _getLocation();

  const whoName = user.phone
    ? user.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
    : 'GUID:' + user.guid.slice(0, 8);

  const locStr = loc
    ? (loc.address || (loc.lat ? `${loc.lat.toFixed(5)},${loc.lng.toFixed(5)}` : null))
    : (record.where || record.data?.location || null);

  const howStr = record.how
    || (record.data?.reportId       ? 'image'
      : record.type === 'klaw_monitor' ? 'auto'
      : 'text');

  const whyStr = record.why
    || (record.serviceId ? record.serviceId + ' 서비스 이용'
      : record.type === 'klaw_monitor' ? '법적 리스크 자동 감시'
      : record.type === 'service_task' ? '서비스 작업 완료'
      : '대화');

  // 3. Supabase 저장
  try {
    await fetch(SUPABASE_URL + '/rest/v1/pdv_log', {
      method: 'POST',
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Content-Type':  'application/json',
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify({
        user_guid:   user.guid,
        device_fp:   user.fp,
        who_name:    whoName,
        location:    locStr,
        record_type: record.type,
        summary:     record.summary || null,
        payload:     record,
        how:         howStr,
        service_id:  record.serviceId || null,
        why:         whyStr,
      }),
    });
    console.info('[PDV] 기록 완료:', record.type);
  } catch(e) { console.warn('[PDV] 기록 실패:', e.message); }

  // 4. K-Law 감시 트리거 (서비스 완료 시)
  if (record.type === 'service_task' && record.serviceId !== 'klaw') {
    setTimeout(() => _onAfterRecord?.(record), 2000);
  }
}

// ── 세션 종료 시 1회 저장 ────────────────────────────────────────
let _sessionSaved = false;

export function saveSessionOnce(history, classifyDomain) {
  if (_sessionSaved || history.length < 2) return;
  _sessionSaved = true;
  const dc = {};
  for (const m of history) {
    const d = classifyDomain(String(m.content));
    dc[d] = (dc[d] || 0) + 1;
  }
  const dominant = Object.entries(dc).sort((a,b) => b[1]-a[1])[0]?.[0] || 'ETC';
  recordPDV({
    type:      'session',
    serviceId: dominant,
    summary:   `대화 세션 (${history.length}턴, 도메인: ${dominant})`,
    why:       '세션 자동 저장',
  });
}
