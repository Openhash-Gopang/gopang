/**
 * routes/fraud.js — 11번 항목: 사기·이상거래 탐지
 *
 * 통합 지점(다른 파일에서 호출):
 *   escrow.js afterOrderConfirmed() 이전 → realtimeFraudCheck()
 *   escrow.js handleOpenDispute()        → checkDisputeAbuse()
 * 엔드포인트:
 *   POST /biz/fraud-case/appeal   오탐 이의신청
 * 크론:
 *   scheduledWashTradingDetection()  매일 — fs_ledger 순환거래 그래프 분석
 *   scheduledClusterDetection()       매일 — 공유속성(대표자/디바이스/계좌) 클러스터링
 */

import { listActiveL1Nodes, resolveL1Base } from '../lib/l1-registry.js';
import { pbFetch } from '../lib/pb-admin.js';
import { buildFilter } from '../lib/pb-filter.js';
import { persistSignals, createFraudCase, levelFromScore, decideAction } from '../lib/fraud-signals.js';
import { getAccountRisk, upsertAccountRisk } from '../lib/account-risk.js';
import { getLinkedAccounts, listAttrKeysByPrefix } from '../lib/shared-attr-index.js';
import { getRecentVelocity } from '../lib/velocity.js';
import { getDisputeHistory } from '../lib/dispute-history.js';
import { flagOpsAlert } from '../lib/ops-alerts.js';
import { jsonResponse } from '../lib/http.js';

// ── 실시간 경량 체크 (escrow.js가 홀드 생성 직전 호출) ───────────────
export async function realtimeFraudCheck(env, { buyerGuid, sellerGuid, amount, deviceFp, l1Base }) {
  const signals = [];

  // ① 속도 규칙 — 최근 1시간 내 동일 buyer_guid 거래
  // [수정] 기존에는 활성 L1 노드 전체를 fan-out 조회(countRecentHoldsByBuyer)했으나,
  // 실시간 경로에서 노드 수에 비례해 지연이 늘어나는 문제가 있었다. 홀드 생성 시점에
  // recordTxEvent()로 KV에 누적해두고 여기서는 O(1) 조회만 한다 (lib/velocity.js 참조).
  const recentCount = await getRecentVelocity(env, buyerGuid);
  if (recentCount.count > 10 || recentCount.sum > 5_000_000) {
    signals.push({ type: 'velocity', score: 40, detail: recentCount, subjectId: buyerGuid, subjectType: 'account' });
  }

  // ② 계정 위험도 캐시(배치가 매일 갱신) — 이미 step_up 대상으로 마크된 계정인지
  const buyerRisk = await getAccountRisk(env, buyerGuid);
  if (buyerRisk?.step_up_required) {
    signals.push({ type: 'blacklist_flag', score: 60, detail: { guid: buyerGuid }, subjectId: buyerGuid, subjectType: 'account' });
  }

  // ③ 자전거래 즉시 체크 — 동일 디바이스로 구매자·판매자가 실제로는 같은 사람인지
  if (deviceFp) {
    const linked = await getLinkedAccounts(env, 'device', deviceFp);
    if (linked.includes(buyerGuid) && linked.includes(sellerGuid)) {
      signals.push({ type: 'self_dealing', score: 80, detail: { deviceFp }, subjectId: buyerGuid, subjectType: 'account' });
    }
  }

  const totalScore = signals.reduce((s, x) => Math.max(s, x.score), 0);
  const level = levelFromScore(totalScore);
  const action = decideAction(level);

  if (signals.length) {
    const signalIds = await persistSignals(env, l1Base, signals, { buyerGuid, sellerGuid });
    if (action === 'hold_for_review') {
      await createFraudCase(env, l1Base, {
        riskLevel: level, signalIds, subjectGuids: [buyerGuid, sellerGuid],
        detail: { amount, reason: 'realtime_check' },
      });
    }
  }

  return { level, action };
}

// ── 에스크로 분쟁 남용 탐지 (escrow.js handleOpenDispute가 호출) ───────
// [수정] 이의제기 시점마다 활성 L1 노드 전체를 fan-out 조회하던 것을,
// escrow.js가 recordDisputeEvent()로 미리 KV에 누적한 이력을 읽는 방식으로 교체.
export async function checkDisputeAbuse(env, buyerGuid) {
  const history = await getDisputeHistory(env, buyerGuid);
  const uniqueSellers = new Set(history.map((h) => h.sellerGuid));

  if (history.length >= 3 && uniqueSellers.size >= 3) {
    const { l1Base } = await safeResolveL1(env, buyerGuid);
    await persistSignals(env, l1Base, [{
      type: 'dispute_abuse', score: 65,
      detail: { disputeCount: history.length, uniqueSellers: uniqueSellers.size },
      subjectId: buyerGuid, subjectType: 'account',
    }], { buyerGuid });
    // 자동조치 없음 — K-Law 중재 담당자 참고정보로만 제공 (12번 dispute_cases에서 조회)
  }
}

async function safeResolveL1(env, guid) {
  try {
    const { resolveGuidToL1 } = await import('./ledger.js');
    return await resolveGuidToL1(env, guid);
  } catch {
    const [first] = await listActiveL1Nodes(env);
    return { l1Node: first?.[0], l1Base: first?.[1]?.base_url };
  }
}

// ── 순환 자금흐름(wash trading) 배치 (매일 크론) ───────────────────
export async function scheduledWashTradingDetection(env) {
  for (const [l1Node, meta] of await listActiveL1Nodes(env)) {
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const filter = buildFilter([['tx_at', '>=', since]]);
    // [2026-07-21 수정 — 사고실험 시나리오5에서 발견] fs_ledger는 원장 통합
    // 커밋에서 ledger_entries로 합쳐지고 더 이상 존재하지 않는 컬렉션이 됐는데
    // 이 쿼리만 갱신이 안 돼 있었다 — 이 크론이 매번 빈 배열만 받아 사기탐지가
    // 완전히 무력화된 상태였을 것.
    const res = await pbFetch(env, meta.base_url, `/api/collections/ledger_entries/records?${new URLSearchParams({ filter, perPage: '2000' })}`);
    const { items: ledger = [] } = await res.json();
    if (!ledger.length) continue;

    const graph = buildTxGraph(ledger);
    const cycles = findShortCycles(graph, 4);

    for (const cycle of cycles) {
      if (isSuspiciousCycle(cycle, { maxSpanHours: 72, amountSimilarity: 0.9 })) {
        await persistSignals(env, meta.base_url, [{
          type: 'wash_trading_cycle', score: 70, detail: cycle, detector: 'batch_graph',
          subjectId: cycle.nodes.join(','), subjectType: 'account',
        }], { subjectGuids: cycle.nodes });
        await createFraudCase(env, meta.base_url, {
          riskLevel: 'S2', subjectGuids: cycle.nodes, detail: { l1Node, cycle },
        });
      }
    }
  }
}

function buildTxGraph(ledgerRows) {
  // fs_ledger는 개별 사업자(guid) 소유 레코드라 counterpart가 상대방 식별자로 쓰인다는
  // 전제. counterpart가 guid가 아닌 'market.hondi.net' 고정값인 레코드는 그래프에서 제외.
  const graph = {};
  for (const row of ledgerRows) {
    if (!row.counterpart || row.counterpart === 'market.hondi.net') continue;
    const from = row.direction === 'debit' ? row.guid : row.counterpart;
    const to = row.direction === 'debit' ? row.counterpart : row.guid;
    (graph[from] ||= []).push({ to, amount: row.amount, at: row.tx_at });
  }
  return graph;
}

function findShortCycles(graph, maxLength) {
  const cycles = [];
  const nodes = Object.keys(graph);
  for (const start of nodes) {
    const stack = [[start, [start], [], 0]]; // [current, path, edges, depth]
    while (stack.length) {
      const [current, path, edges, depth] = stack.pop();
      if (depth >= maxLength) continue;
      for (const edge of graph[current] || []) {
        if (edge.to === start && path.length >= 2) {
          cycles.push({ nodes: path, edges: [...edges, edge] });
        } else if (!path.includes(edge.to)) {
          stack.push([edge.to, [...path, edge.to], [...edges, edge], depth + 1]);
        }
      }
    }
  }
  return cycles;
}

function isSuspiciousCycle(cycle, { maxSpanHours, amountSimilarity }) {
  const times = cycle.edges.map((e) => new Date(e.at).getTime());
  const spanHours = (Math.max(...times) - Math.min(...times)) / 3600000;
  if (spanHours > maxSpanHours) return false;
  const amounts = cycle.edges.map((e) => e.amount);
  const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  const maxDiff = Math.max(...amounts.map((a) => Math.abs(a - avg) / avg));
  return maxDiff <= 1 - amountSimilarity;
}

// ── 계정 클러스터링 배치 (매일 크론) — 대표자명/디바이스/계좌 공유 ──────────
export async function scheduledClusterDetection(env) {
  for (const attrType of ['rep', 'device', 'bank']) {
    const keys = await listAttrKeysByPrefix(env, attrType);
    for (const key of keys) {
      const raw = await env.SHARED_ATTR_INDEX.get(key);
      const guids = raw ? JSON.parse(raw) : [];
      if (guids.length < 3) continue; // 3개 이상 공유해야 검토 대상

      const { l1Base } = await safeResolveL1(env, guids[0]);
      await createFraudCase(env, l1Base, {
        riskLevel: 'S2', // 오탐 위험이 커서 S3까지는 올리지 않음(설계 원칙)
        subjectGuids: guids,
        detail: { cluster_key: key, attr_type: attrType, note: `동일 ${attrType} 속성 공유 계정 ${guids.length}개` },
      });
    }
  }
}

// ── 이의신청 (오탐 방어 경로) ────────────────────────────────────
export async function handleFraudAppeal(request, env) {
  const { case_id, guid, explanation, l1_base } = await request.json();
  await pbFetch(env, l1_base, `/api/collections/fraud_cases/records/${case_id}`, {
    method: 'PATCH',
    body: { case_status: 'reviewing' },
  });
  await flagOpsAlert(env, `fraud-appeal:${case_id}`, { case_id, guid, explanation });
  return jsonResponse({ ok: true, message: '이의신청이 접수되었습니다. 검토 후 연락드립니다.' });
}

// ── 관리자 케이스 처리 (confirmed_fraud / false_positive / dismissed) ──
export async function handleResolveFraudCase(request, env) {
  const { case_id, l1_base, resolution, resolvedBy } = await request.json();
  if (!['confirmed_fraud', 'false_positive', 'dismissed'].includes(resolution)) {
    return jsonResponse({ ok: false, reason: 'INVALID_RESOLUTION' }, 400);
  }
  const caseRes = await pbFetch(env, l1_base, `/api/collections/fraud_cases/records/${case_id}`);
  const fraudCase = await caseRes.json();

  await pbFetch(env, l1_base, `/api/collections/fraud_cases/records/${case_id}`, {
    method: 'PATCH',
    body: { case_status: resolution, assigned_to: resolvedBy, resolution, resolved_at: new Date().toISOString() },
  });

  if (resolution === 'confirmed_fraud') {
    for (const guid of fraudCase.subject_guids || []) {
      await upsertAccountRisk(env, l1_base, guid, { step_up_required: true, current_score: 90, trust_level: 'L0' });
    }
  }
  return jsonResponse({ ok: true });
}
