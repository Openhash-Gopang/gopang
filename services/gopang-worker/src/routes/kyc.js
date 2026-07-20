/**
 * routes/kyc.js — 1번 항목: 사업자 진위검증(KYC)
 *
 * 엔드포인트:
 *   POST /biz/verify-nts   등록 시 1회 진위검증 (validate API)
 * 크론:
 *   scheduledKycRecheck()  매일 — 검증된 사업자의 폐업/휴업 여부 재확인 (status API)
 */

import { resolveL1Base, listActiveL1Nodes } from '../lib/l1-registry.js';
import { pbFetch } from '../lib/pb-admin.js';
import { buildFilter } from '../lib/pb-filter.js';
import { flagOpsAlert } from '../lib/ops-alerts.js';
import { notifyOwner } from '../lib/notify-owner.js';
import { recordAttrLink } from '../lib/shared-attr-index.js';
import { jsonResponse } from '../lib/http.js';

// ── 등록 시 1회 검증 ──────────────────────────────────────────
export async function handleVerifyNts(request, env) {
  const { guid, b_no, start_dt, representative_name, l1_node } = await request.json();

  const cleanBno = (b_no || '').replace(/-/g, '');
  if (!/^\d{10}$/.test(cleanBno)) return jsonResponse({ ok: false, reason: 'INVALID_FORMAT' }, 400);
  if (!/^\d{8}$/.test(start_dt || '')) return jsonResponse({ ok: false, reason: 'INVALID_START_DT' }, 400);
  if (!l1_node || l1_node === 'PENDING') return jsonResponse({ ok: false, reason: 'MISSING_L1_NODE' }, 400);

  const l1Base = await resolveL1Base(env, l1_node);
  if (!l1Base) return jsonResponse({ ok: false, reason: 'UNKNOWN_L1_NODE' }, 400);

  const ntsRes = await fetch(
    `https://api.odcloud.kr/api/nts-businessman/v1/validate?serviceKey=${env.NTS_SERVICE_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businesses: [{ b_no: cleanBno, start_dt, p_nm: representative_name }] }),
    }
  );

  if (!ntsRes.ok) {
    await logVerification(env, l1Base, guid, 'initial_check', null, 'error', { http_status: ntsRes.status });
    return jsonResponse({ ok: false, reason: 'NTS_API_ERROR' }, 502);
  }
  const ntsData = await ntsRes.json();
  const result = ntsData?.data?.[0];
  const status = result?.valid === '01' ? 'verified' : result?.valid === '02' ? 'mismatch' : 'not_found';

  const existing = await findVerification(env, l1Base, guid);
  const payload = {
    guid, b_no: cleanBno, start_dt, representative_name,
    verify_status: status,
    nts_b_stt: result?.valid_msg || null,
    last_verified_at: new Date().toISOString(),
    raw_response: ntsData,
  };

  if (existing) {
    await pbFetch(env, l1Base, `/api/collections/business_verifications/records/${existing.id}`, { method: 'PATCH', body: payload });
  } else {
    await pbFetch(env, l1Base, '/api/collections/business_verifications/records', { method: 'POST', body: payload });
  }

  await patchProfileKycStatus(env, l1Base, guid, status);
  await logVerification(env, l1Base, guid, 'initial_check', existing?.verify_status || null, status, ntsData);

  // 11번(사기탐지) 연동: 동일 대표자명으로 여러 사업자가 등록되는지 추적할 수 있도록
  // 공유 속성 역색인에 반영 (자동조치는 없음 — 11번 배치가 임계치 넘을 때만 사람 검토로)
  if (representative_name) {
    await recordAttrLink(env, 'rep', representative_name, guid);
  }

  if (status === 'mismatch' || status === 'not_found') {
    return jsonResponse({ ok: true, status, message: '사업자등록정보가 국세청 기록과 일치하지 않습니다.' });
  }
  return jsonResponse({ ok: true, status });
}

// ── 재검증 (매일 크론) — 폐업/휴업 감지 ─────────────────────────
export async function scheduledKycRecheck(env) {
  for (const [l1Node, meta] of await listActiveL1Nodes(env)) {
    const filter = buildFilter([['verify_status', '=', 'verified']]);
    const res = await pbFetch(env, meta.base_url, `/api/collections/business_verifications/records?${new URLSearchParams({ filter, perPage: '500' })}`);
    const { items: targets = [] } = await res.json();
    if (!targets.length) continue;

    const chunks = chunkArray(targets, 100); // 국세청 status API 배치 한도 고려
    for (const batch of chunks) {
      const statusRes = await fetch(
        `https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=${env.NTS_SERVICE_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ b_no: batch.map((t) => t.b_no) }),
        }
      );
      if (!statusRes.ok) {
        await flagOpsAlert(env, `kyc-recheck-fail:${l1Node}:${Date.now()}`, { l1Node, status: statusRes.status });
        continue;
      }
      const statusData = await statusRes.json();

      for (const item of statusData?.data || []) {
        if (item.b_stt_cd === '01') continue; // 계속사업자 — 정상
        const target = batch.find((t) => t.b_no === item.b_no);
        if (!target) continue;

        await pbFetch(env, meta.base_url, `/api/collections/business_verifications/records/${target.id}`, {
          method: 'PATCH',
          body: { verify_status: 'suspended', nts_b_stt: item.b_stt, last_checked_at: new Date().toISOString() },
        });
        await patchProfileKycStatus(env, meta.base_url, target.guid, 'suspended');
        await logVerification(env, meta.base_url, target.guid, 'periodic_recheck', 'verified', 'suspended', item);
        await notifyOwner(env, meta.base_url, target.guid, {
          eventType: 'kyc_status',
          severity: 'critical',
          payload: { msg: '사업자등록 상태가 휴업/폐업으로 확인되어 검색 노출이 중단되었습니다.' },
        });
      }
    }
  }
}

// ── 헬퍼 ────────────────────────────────────────────────────
async function findVerification(env, l1Base, guid) {
  const filter = buildFilter([['guid', '=', guid]]);
  const res = await pbFetch(env, l1Base, `/api/collections/business_verifications/records?${new URLSearchParams({ filter, perPage: '1' })}`);
  const data = await res.json();
  return data.items?.[0] || null;
}

async function patchProfileKycStatus(env, l1Base, guid, status) {
  const filter = buildFilter([['guid', '=', guid]]);
  const res = await pbFetch(env, l1Base, `/api/collections/profiles/records?${new URLSearchParams({ filter, perPage: '1' })}`);
  const data = await res.json();
  const prof = data.items?.[0];
  if (!prof) return; // 프로필이 아직 없으면 등록 흐름 순서상 오류 — 상위 호출자가 처리

  const mergedExtra = { ...(prof.extra || {}), kyc_status: status, kyc_verified_at: new Date().toISOString() };
  await pbFetch(env, l1Base, `/api/collections/profiles/records/${prof.id}`, { method: 'PATCH', body: { extra: mergedExtra } });

  // search_index 동기화 (C절 검색 최적화 컬렉션과의 연동)
  const idxRes = await pbFetch(env, l1Base, `/api/collections/search_index/records?${new URLSearchParams({ filter, perPage: '1' })}`);
  const idxData = await idxRes.json();
  if (idxData.items?.[0]) {
    await pbFetch(env, l1Base, `/api/collections/search_index/records/${idxData.items[0].id}`, { method: 'PATCH', body: { kyc_status: status } });
  }
}

async function logVerification(env, l1Base, guid, event, prevStatus, newStatus, detail) {
  await pbFetch(env, l1Base, '/api/collections/business_verification_log/records', {
    method: 'POST',
    body: { guid, event, prev_status: prevStatus, new_status: newStatus, detail, checked_at: new Date().toISOString() },
  });
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
