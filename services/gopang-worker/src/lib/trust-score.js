/**
 * lib/trust-score.js — 순수 평판 지표(trust_level) 계산
 *
 * 🔒 범위 경계 (2026-08-20, 대출/채권/이자율 논의 이후 확정):
 *   이 파일은 ledger_entries(재무제표 원장) 이력을 바탕으로 "이 계정을
 *   얼마나 신뢰할 수 있는가"에 대한 평판 점수만 계산한다.
 *
 *   금지 사항 — 이 파일에 절대 추가하지 않을 것:
 *     - 대출 한도(LTV, 여신한도) 계산
 *     - 채권 이자율/가격 산정
 *     - "current_score/trust_level을 입력으로 받아 금리·한도를 반환"하는
 *       모든 형태의 함수
 *   이런 기능이 필요해지면 이 파일이 아니라 js/gdc-credit.js의
 *   LEGAL-HOLD(2026-07-18)를 먼저 해제할지부터 별도로 검토해야 한다.
 *   trust_level은 K-Market 판매자 노출 순위, 분쟁 시 우선순위 조정 등
 *   비금전적 용도로만 소비되어야 한다.
 *
 * 점수 산식(v1, 투명성 원칙 — K-Market_Architecture_Master 항목 24와 동일
 * 기조로, 가중치를 코드에 그대로 노출한다. "비공개 가중치"로 바꾸지 말 것):
 *   - tenure(계정 나이, ledger_entries 최초 seq 시각 기준)      최대 30점
 *   - volume(누적 거래 건수, 최대 40건까지 선형)                최대 30점
 *   - consistency(최근 90일 내 활동 유무)                        최대 20점
 *   - penalty(fraud override로 이미 낮아진 상태면 가산 없이 유지) 최대 20점
 *   fraud.js의 step_up_required=true 오버라이드가 있는 계정은 이 배치가
 *   점수를 올리지 않는다(사기 탐지가 신뢰 점수보다 우선).
 */

import { pbFetch } from './pb-admin.js';
import { buildFilter } from './pb-filter.js';
import { resolveGuidToL1 } from '../routes/ledger.js';
import { getAccountRisk, upsertAccountRisk } from './account-risk.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function scoreToLevel(score) {
  if (score >= 80) return 'L4';
  if (score >= 60) return 'L3';
  if (score >= 35) return 'L2';
  if (score >= 15) return 'L1';
  return 'L0';
}

/**
 * ledger_entries에서 해당 guid의 이력을 조회해 평판 점수를 계산한다.
 * 이미 사기 탐지 오버라이드(step_up_required)가 걸려있으면 그대로 유지하고
 * 배치 계산 결과로 덮어쓰지 않는다.
 */
const RECOMPUTE_THROTTLE_MS = 5 * 60 * 1000; // 5분

export async function computeTrustScore(env, guid, l1Base) {
  const existing = await getAccountRisk(env, guid, l1Base);
  if (existing?.step_up_required) {
    return { skipped: true, reason: 'FRAUD_OVERRIDE_ACTIVE', existing };
  }
  // [2026-08-20] handleInternalLedgerEntry가 거래마다 이 함수를 호출하므로,
  // 고빈도 계정이 PocketBase를 과도하게 재조회하지 않도록 최소 간격을 둔다.
  // (배치/수동 재계산 경로에서는 이 스킵을 우회하고 싶을 수 있으니, 필요해지면
  //  force 파라미터를 추가할 것 — 지금은 이벤트 트리거 단일 경로라 불필요.)
  if (existing?.last_computed_at) {
    const elapsed = Date.now() - new Date(existing.last_computed_at).getTime();
    if (elapsed < RECOMPUTE_THROTTLE_MS) {
      return { skipped: true, reason: 'THROTTLED', existing };
    }
  }

  if (!l1Base) {
    ({ l1Base } = await resolveGuidToL1(env, guid));
  }
  const filter = buildFilter([['guid', '=', guid]]);
  const res = await pbFetch(
    env,
    l1Base,
    `/api/collections/ledger_entries/records?${new URLSearchParams({
      filter,
      sort: 'seq',
      perPage: '500',
    })}`
  );
  const data = await res.json();
  const entries = data.items || [];

  if (!entries.length) {
    const basis = { tenure: 0, volume: 0, consistency: 0, note: 'NO_LEDGER_HISTORY' };
    await upsertAccountRisk(env, l1Base, guid, {
      current_score: 0,
      trust_level: 'L0',
      score_basis: basis,
      computed_by: 'batch',
    });
    return { skipped: false, current_score: 0, trust_level: 'L0', basis };
  }

  const firstTxAt = new Date(entries[0].tx_at || entries[0].created);
  const lastTxAt = new Date(entries[entries.length - 1].tx_at || entries[entries.length - 1].created);
  const now = Date.now();

  const tenureDays = Math.max(0, (now - firstTxAt.getTime()) / MS_PER_DAY);
  const tenureScore = Math.min(30, Math.round((tenureDays / 180) * 30)); // 180일=만점

  const volumeScore = Math.min(30, Math.round((entries.length / 40) * 30)); // 40건=만점

  const daysSinceLastTx = (now - lastTxAt.getTime()) / MS_PER_DAY;
  const consistencyScore = daysSinceLastTx <= 90 ? 20 : Math.max(0, 20 - Math.round(daysSinceLastTx - 90));

  const currentScore = Math.min(100, tenureScore + volumeScore + consistencyScore);
  const trustLevel = scoreToLevel(currentScore);
  const basis = {
    tenure_days: Math.round(tenureDays),
    tenure_score: tenureScore,
    ledger_entry_count: entries.length,
    volume_score: volumeScore,
    days_since_last_tx: Math.round(daysSinceLastTx),
    consistency_score: consistencyScore,
  };

  await upsertAccountRisk(env, l1Base, guid, {
    current_score: currentScore,
    trust_level: trustLevel,
    score_basis: basis,
    computed_by: 'batch',
  });

  return { skipped: false, current_score: currentScore, trust_level: trustLevel, basis };
}

/**
 * 배치 재계산 진입점. 단일 guid 재계산 요청(예: 거래 직후) 또는
 * cron이 넘겨준 guid 목록을 순차 처리한다. 대량 스캔(전체 profiles)은
 * 아직 없음 — 필요해지면 listActiveL1Nodes로 L1별 순회하는 별도 함수로
 * 분리할 것(이 파일 범위를 넘어서므로 지금은 만들지 않는다).
 */
export async function computeTrustScoreBatch(env, guids) {
  const results = [];
  for (const guid of guids) {
    try {
      results.push({ guid, ...(await computeTrustScore(env, guid)) });
    } catch (e) {
      results.push({ guid, error: e.message });
    }
  }
  return results;
}
