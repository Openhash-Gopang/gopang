/**
 * M11 — PDV Hash Chain 감사 모듈 (Audit)
 * GET /merkle/verify?pdv_id=...
 * Cron: anchorL1MerkleRoot()
 *
 * 감사 원칙 P1~P6 View 관리 (Supabase에서 실행, 여기서는 로직 검증용)
 * 의존: M10 (Ledger)
 */

// ── SHA-256 해시 ───────────────────────────────────────────────────
export async function sha256hex(data) {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── 머클 트리 계산 ─────────────────────────────────────────────────
export async function computeMerkleRoot(hashes) {
  if (hashes.length === 0) return null;
  if (hashes.length === 1) return hashes[0];

  let level = [...hashes];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left  = level[i];
      const right = level[i + 1] ?? left;  // 홀수 개 → 마지막 복제
      next.push(await sha256hex(left + right));
    }
    level = next;
  }
  return level[0];
}

// ── pdv_log INSERT 파라미터 빌더 ──────────────────────────────────
// Prefer: resolution=ignore-duplicates 헤더 필수 (T09)
export function buildPdvLogInsert(env, entry) {
  return {
    url: `${env.SUPABASE_URL}/rest/v1/pdv_log`,
    headers: {
      'Content-Type': 'application/json',
      'apikey': env.SUPABASE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_KEY}`,
      'Prefer': 'resolution=ignore-duplicates',  // T09 중복 방지
    },
    body: JSON.stringify(entry),
  };
}

// ── anchorL1MerkleRoot — Cron 함수 ────────────────────────────────
export async function anchorL1MerkleRoot(env) {
  // 미앵커링 pdv_log 조회 (via_worker 조건 없이 — T10 E4 수정)
  const resp = await fetch(
    `${env.SUPABASE_URL}/rest/v1/pdv_log?anchored=eq.false&select=id,chain_local_hash&order=chain_height.asc`,
    {
      headers: {
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
    }
  );

  if (!resp.ok) throw new Error(`pdv_log fetch failed: ${resp.status}`);
  const rows = await resp.json();

  if (rows.length === 0) return { skipped: true, reason: 'no_unanchored' };

  const hashes     = rows.map(r => r.chain_local_hash ?? r.id);
  const merkleRoot = await computeMerkleRoot(hashes);
  const anchoredAt = new Date().toISOString();

  // merkle_anchors INSERT
  const insertResp = await fetch(`${env.SUPABASE_URL}/rest/v1/merkle_anchors`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({
      merkle_root:  merkleRoot,
      pdv_count:    rows.length,
      anchored_at:  anchoredAt,
      status:       'confirmed',
    }),
  });

  if (!insertResp.ok) throw new Error(`merkle_anchors INSERT failed: ${insertResp.status}`);

  // pdv_log.anchored = true 일괄 UPDATE
  const ids = rows.map(r => r.id);
  await fetch(
    `${env.SUPABASE_URL}/rest/v1/pdv_log?id=in.(${ids.join(',')})`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ anchored: true }),
    }
  );

  return { ok: true, merkle_root: merkleRoot, pdv_count: rows.length, anchored_at: anchoredAt };
}

// ── GET /merkle/verify ─────────────────────────────────────────────
export async function handleMerkleVerify(request, env) {
  const pdvId = new URL(request.url).searchParams.get('pdv_id');
  if (!pdvId) {
    return jsonResp({ error: 'MISSING_PDV_ID' }, 400);
  }

  // pdv_log에서 해당 항목 조회
  const pdvResp = await fetch(
    `${env.SUPABASE_URL}/rest/v1/pdv_log?id=eq.${encodeURIComponent(pdvId)}&select=id,chain_local_hash,anchored`,
    {
      headers: {
        'apikey': env.SUPABASE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_KEY}`,
      },
    }
  );
  if (!pdvResp.ok) return jsonResp({ error: 'DB_ERROR' }, 502);
  const pdvRows = await pdvResp.json();
  if (!pdvRows.length) return jsonResp({ error: 'PDV_NOT_FOUND' }, 404);
  const pdv = pdvRows[0];

  if (!pdv.anchored) {
    return jsonResp({ valid: false, reason: 'NOT_ANCHORED', pdv_id: pdvId });
  }

  // 해당 pdv가 포함된 앵커 배치 재계산
  const batchResp = await fetch(
    `${env.SUPABASE_URL}/rest/v1/pdv_log?anchored=eq.true&select=id,chain_local_hash&order=chain_height.asc`,
    {
      headers: {
        'apikey': env.SUPABASE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_KEY}`,
      },
    }
  );
  const batchRows = await batchResp.json();
  const hashes    = batchRows.map(r => r.chain_local_hash ?? r.id);
  const recomputed = await computeMerkleRoot(hashes);

  // 가장 최근 merkle_anchors의 root와 비교
  const anchorResp = await fetch(
    `${env.SUPABASE_URL}/rest/v1/merkle_anchors?status=eq.confirmed&select=merkle_root&order=anchored_at.desc&limit=1`,
    {
      headers: {
        'apikey': env.SUPABASE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_KEY}`,
      },
    }
  );
  const anchors = await anchorResp.json();
  const storedRoot = anchors[0]?.merkle_root;

  const valid = storedRoot === recomputed && batchRows.some(r => r.id === pdvId);

  return jsonResp({
    valid,
    pdv_id:        pdvId,
    merkle_root:   recomputed,
    stored_root:   storedRoot,
    pdv_included:  batchRows.some(r => r.id === pdvId),
  });
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
