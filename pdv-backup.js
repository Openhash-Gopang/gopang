/* ─────────────────────────────────────────────────────────────────────
   pdv-backup.js — PDV 로컬 저장소 + 백업(Layer A)/무결성 앵커(Layer B)

   SP_PDV_v1_1.md 반영 사항:
   - C1: 원문(source_ref 대상)은 백업하지 않는다. 이 파일은 6하원칙
     "요약" 레코드만 다룬다. 원문 자체를 이 모듈에 절대 넣지 말 것.
   - §3: backup_tier(summary_only|none), counterpart_ref 필드 처리.
   - §2-보론: counterpart_ref 충돌(키 회전) 시 자동 병합 금지 — 병합
     후보로만 표시(reconciliation_pending).

   TODO(연동 필요 — 실제 프로젝트 값으로 교체):
   - SUPABASE_URL / SUPABASE_ANON_KEY: 기존 gopang-app.js가 이미 초기화한
     supabase 클라이언트가 있다면(window.supabaseClient) 그것을 우선 쓰고,
     없을 때만 아래 REST 폴백을 쓴다.
   - anchorToPdvLog(): 기존 pdv_log 해시 앵커 함수가 gopang-app.js에 이미
     있다면 그걸 호출하도록 아래 스텁을 교체할 것. 지금은 존재 여부만
     확인하고, 없으면 조용히 건너뛴다(Layer B 미가동 상태를 조용히
     삼키지 않도록 콘솔 경고는 남긴다).
   ───────────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  const DB_NAME = 'gopang_pdv';
  const DB_VERSION = 1;
  const STORE = 'records';

  const SUPABASE_URL = (global.GOPANG_SUPABASE_URL) || 'https://ebbecjfrwaswbdybbgiu.supabase.co';
  const SUPABASE_ANON_KEY = global.GOPANG_SUPABASE_ANON_KEY || null; // TODO: 실제 anon key 주입

  // ── IndexedDB ─────────────────────────────────────────────────────
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: 'record_id' });
          os.createIndex('when', 'when', { unique: false });
          os.createIndex('counterpart_ref', 'counterpart_ref', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllRecords() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function putRecords(records) {
    if (!records || !records.length) return;
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const os = tx.objectStore(STORE);
      records.forEach(r => os.put(r));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function upsertRecord(record) {
    // 로컬 기록 시 기본값 채움 — Recorder가 호출하는 진입점.
    if (!record.backup_tier) record.backup_tier = 'summary_only';
    if (record.counterpart_ref === undefined) record.counterpart_ref = null;
    await putRecords([record]);
  }

  // ── 4-word seed → HKDF → AES-256-GCM 키 ─────────────────────────────
  async function deriveKeyFromSeed(seedPhrase, salt) {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
      'raw', enc.encode(seedPhrase.trim().toLowerCase()), 'HKDF', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: enc.encode(salt || 'gopang-pdv-backup-v1'), info: enc.encode('pdv-layer-a') },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  function bufToB64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
  function b64ToBuf(b64) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); }

  async function encryptJSON(obj, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(JSON.stringify(obj));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
    return { iv: bufToB64(iv), ciphertext: bufToB64(ciphertext) };
  }

  async function decryptJSON(blob, key) {
    const iv = b64ToBuf(blob.iv);
    const ciphertext = b64ToBuf(blob.ciphertext);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(plain));
  }

  async function sha256Hex(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ── Supabase REST 폴백 (기존 supabaseClient 있으면 그걸 우선 사용) ──
  async function supabaseUpsert(table, row, conflictCol) {
    if (global.supabaseClient && typeof global.supabaseClient.from === 'function') {
      const { error } = await global.supabaseClient.from(table).upsert(row, { onConflict: conflictCol });
      if (error) throw error;
      return;
    }
    if (!SUPABASE_ANON_KEY) {
      console.warn('[pdv-backup] SUPABASE_ANON_KEY 미설정 — 백업 업로드를 건너뜁니다. (TODO: 연동 필요)');
      return;
    }
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${conflictCol}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) throw new Error(`[pdv-backup] 업로드 실패: ${res.status}`);
  }

  async function supabaseSelectOne(table, matchCol, matchVal) {
    if (global.supabaseClient && typeof global.supabaseClient.from === 'function') {
      const { data, error } = await global.supabaseClient.from(table).select('*').eq(matchCol, matchVal).maybeSingle();
      if (error) throw error;
      return data;
    }
    if (!SUPABASE_ANON_KEY) {
      console.warn('[pdv-backup] SUPABASE_ANON_KEY 미설정 — 백업 조회를 건너뜁니다. (TODO: 연동 필요)');
      return null;
    }
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${matchCol}=eq.${encodeURIComponent(matchVal)}&limit=1`, {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
    });
    if (!res.ok) throw new Error(`[pdv-backup] 조회 실패: ${res.status}`);
    const rows = await res.json();
    return rows[0] || null;
  }

  // Layer B — 기존 pdv_log 해시 앵커. 실제 함수가 이미 gopang-app.js에
  // 있다면 그걸 그대로 쓴다(연동 지점). 없으면 경고만 남기고 통과.
  async function anchorToPdvLog(hashHex) {
    if (typeof global.anchorPdvLog === 'function') {
      return global.anchorPdvLog(hashHex);
    }
    console.warn('[pdv-backup] anchorPdvLog()가 없어 Layer B 앵커를 건너뜁니다. (TODO: gopang-app.js 연동)');
  }

  // ── 백업 (Layer A) ───────────────────────────────────────────────
  // backup_tier === 'summary_only'인 레코드만 대상 — 'none'(향후 예외
  // 처리용)은 제외. source_ref가 가리키는 원문은 애초에 이 객체에 없다.
  async function backupNow(guid, seedPhrase) {
    if (!guid || !seedPhrase) throw new Error('[pdv-backup] guid/seedPhrase가 필요합니다.');
    const all = await getAllRecords();
    const targets = all.filter(r => (r.backup_tier || 'summary_only') === 'summary_only');
    const key = await deriveKeyFromSeed(seedPhrase, guid);
    const payload = { version: 1, exported_at: new Date().toISOString(), records: targets };
    const blob = await encryptJSON(payload, key);
    const hash = await sha256Hex(blob.ciphertext);

    await supabaseUpsert('pdv_backup', {
      guid,
      iv: blob.iv,
      ciphertext: blob.ciphertext,
      record_count: targets.length,
      updated_at: new Date().toISOString(),
    }, 'guid');

    await anchorToPdvLog(hash);
    return { count: targets.length, hash };
  }

  // ── 복원 ─────────────────────────────────────────────────────────
  // 기존 로컬 레코드는 record_id 기준으로 덮어쓰지 않는다(로컬이 항상
  // 최신 원본에 가깝다는 가정) — 로컬에 없는 것만 채워 넣는다.
  // counterpart_ref가 로컬의 다른 counterpart_id와 겹치면(§2-보론, 키
  // 회전 케이스) 자동 병합하지 않고 reconciliation_pending 플래그만
  // 세워 사용자 확인을 기다린다(C2, 교차 매칭 금지 원칙 적용).
  async function restoreFromBackup(guid, seedPhrase) {
    const row = await supabaseSelectOne('pdv_backup', 'guid', guid);
    if (!row) return { restored: 0, pending: 0 };

    const key = await deriveKeyFromSeed(seedPhrase, guid);
    const payload = await decryptJSON({ iv: row.iv, ciphertext: row.ciphertext }, key);
    const local = await getAllRecords();
    const localIds = new Set(local.map(r => r.record_id));
    const localRefs = new Map(local.filter(r => r.counterpart_ref).map(r => [r.counterpart_ref, r.counterpart_id]));

    let restored = 0, pending = 0;
    const toInsert = [];

    for (const rec of (payload.records || [])) {
      if (localIds.has(rec.record_id)) continue; // 이미 로컬에 존재

      const knownCounterpartId = rec.counterpart_ref ? localRefs.get(rec.counterpart_ref) : null;
      if (knownCounterpartId && knownCounterpartId !== rec.counterpart_id) {
        rec.reconciliation_pending = true; // 키가 바뀐 것으로 추정되는 케이스 — 자동 병합 금지
        pending++;
      } else {
        restored++;
      }
      toInsert.push(rec);
    }

    await putRecords(toInsert);
    return { restored, pending };
  }

  // ── 재등록 직후 자동 복원 훅 ─────────────────────────────────────
  // 로컬 저장소가 비어있고 4-word seed를 쓸 수 있을 때만 조용히 시도한다.
  // seed 입력 UI/보관 로직은 이 파일의 책임이 아니다 — 호출부(예:
  // 온보딩 플로우)에서 guid/seedPhrase를 넘겨줘야 한다.
  async function autoRestoreIfEmpty(guid, seedPhrase) {
    const local = await getAllRecords();
    if (local.length > 0) return { skipped: true };
    if (!seedPhrase) return { skipped: true, reason: 'no-seed' };
    return restoreFromBackup(guid, seedPhrase);
  }

  global.GopangPDV = {
    list: getAllRecords,
    upsert: upsertRecord,
    backupNow,
    restoreFromBackup,
    autoRestoreIfEmpty,
  };
})(window);
