/**
 * lib/account-risk.js — account_risk_score 컬렉션 조회/갱신
 * 실시간 체크에서 매번 재계산하지 않도록 배치가 캐시해둔 값을 읽는 용도.
 */

import { pbFetch } from './pb-admin.js';
import { buildFilter } from './pb-filter.js';
import { resolveGuidToL1 } from '../routes/ledger.js';

export async function getAccountRisk(env, guid) {
  try {
    const { l1Base } = await resolveGuidToL1(env, guid);
    const filter = buildFilter([['guid', '=', guid]]);
    const res = await pbFetch(env, l1Base, `/api/collections/account_risk_score/records?${new URLSearchParams({ filter, perPage: '1' })}`);
    const data = await res.json();
    return data.items?.[0] || null;
  } catch (e) {
    return null; // 프로필을 아직 못 찾은 신규 계정 등 — 위험도 없음으로 취급
  }
}

export async function upsertAccountRisk(env, l1Base, guid, patch) {
  const filter = buildFilter([['guid', '=', guid]]);
  const res = await pbFetch(env, l1Base, `/api/collections/account_risk_score/records?${new URLSearchParams({ filter, perPage: '1' })}`);
  const data = await res.json();
  const existing = data.items?.[0];
  const body = { guid, last_computed_at: new Date().toISOString(), ...patch };
  if (existing) {
    await pbFetch(env, l1Base, `/api/collections/account_risk_score/records/${existing.id}`, { method: 'PATCH', body });
  } else {
    await pbFetch(env, l1Base, '/api/collections/account_risk_score/records', { method: 'POST', body: { current_score: 0, open_case_count: 0, step_up_required: false, ...body } });
  }
}
