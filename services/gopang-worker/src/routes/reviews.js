/**
 * routes/reviews.js — 10번 항목: 리뷰 작성 기능 + 구매인증 기반 조작 방지
 */

import { listActiveL1Nodes } from '../lib/l1-registry.js';
import { pbFetch } from '../lib/pb-admin.js';
import { buildFilter } from '../lib/pb-filter.js';
import { flagOpsAlert } from '../lib/ops-alerts.js';
import { jsonResponse } from '../lib/http.js';

const DAILY_REWARD_LIMIT = 3;
const REWARD_AMOUNT_GDC = 10;

// ── 작성 ───────────────────────────────────────────────────
export async function handleCreateReview(request, env) {
  const { tx_id, buyer_guid, rating, text, product_id, l1_base } = await request.json();

  // [수정] 이전 구현은 profiles.extra.kyc_status(판매자 사업자인증 필드)를 구매자 guid에
  // 조회하고 있었다 — 구매자는 KYC 대상이 아니므로 이 필드는 항상 비어 모든 구매자가
  // 사실상 L0으로 분류되고, 11번의 NEW_ACCOUNT_CONCENTRATION 탐지가 상시 발동할
  // 위험이 있었다. 구매자의 실제 SSO 인증레벨(extra.sso_level)을 조회하도록 정정한다.
  const reviewerSso = await getBuyerSsoLevel(env, l1_base, buyer_guid);

  const res = await pbFetch(env, l1_base, '/api/collections/reviews/records', {
    method: 'POST',
    body: { tx_id, buyer_guid, product_id, rating, text, reviewer_sso_level: reviewerSso },
  });
  const data = await res.json();
  if (!res.ok) return jsonResponse({ ok: false, error: data }, res.status);

  await maybeGrantReviewReward(env, buyer_guid, tx_id);
  await syncSearchIndexRating(env, l1_base, data.seller_guid);

  return jsonResponse({ ok: true, review: data });
}

async function getBuyerSsoLevel(env, l1Base, buyerGuid) {
  const filter = buildFilter([['guid', '=', buyerGuid]]);
  const res = await pbFetch(env, l1Base, `/api/collections/profiles/records?${new URLSearchParams({ filter, perPage: '1' })}`);
  const data = await res.json();
  // profiles.extra.sso_level: 'L0'(비회원/최소인증) ~ 'L3'(본인인증 완료) 등
  // hondi.net SSO 체계의 실제 필드명. kyc_status는 사업자(판매자) 전용이라 여기선 쓰지 않는다.
  return data.items?.[0]?.extra?.sso_level || 'L0';
}

async function maybeGrantReviewReward(env, buyerGuid, txId) {
  const todayKey = `review-reward:${buyerGuid}:${new Date().toISOString().slice(0, 10)}`;
  const countRaw = await env.REWARD_COUNTER_KV.get(todayKey);
  const count = countRaw ? Number(countRaw) : 0;
  if (count >= DAILY_REWARD_LIMIT) {
    console.warn(`[ReviewReward] 일일한도 초과 — 보상 스킵: ${buyerGuid}`);
    return;
  }
  await env.REWARD_COUNTER_KV.put(todayKey, String(count + 1), { expirationTtl: 90000 });
  await gdcTransfer(env, { to: buyerGuid, amount: REWARD_AMOUNT_GDC, memo: `리뷰 작성 보상 (tx:${txId})` });
}

async function gdcTransfer(env, { to, amount, memo }) {
  // 실제 GDC 이체는 gopang-wallet.js UTXO 경로를 Worker 대리서명으로 수행하거나
  // 별도 GDC 발행 계정(gopang-rewards) 서명을 필요로 한다 — EscrowSigner와 동일 패턴.
  // 여기서는 인터페이스만 고정하고 상세 서명 로직은 7번 EscrowSigner를 참고해 이식한다.
  console.log(`[GDC Reward] ${to} +${amount} (${memo})`);
}

async function syncSearchIndexRating(env, l1Base, sellerGuid) {
  if (!sellerGuid) return;
  const filter = buildFilter([['seller_guid', '=', sellerGuid], ['status', '=', 'visible']]);
  const res = await pbFetch(env, l1Base, `/api/collections/reviews/records?${new URLSearchParams({ filter, perPage: '1000' })}`);
  const { items = [] } = await res.json();
  const ratingAvg = items.length ? items.reduce((s, r) => s + r.rating, 0) / items.length : 0;

  const idxFilter = buildFilter([['guid', '=', sellerGuid]]);
  const idxRes = await pbFetch(env, l1Base, `/api/collections/search_index/records?${new URLSearchParams({ filter: idxFilter, perPage: '1' })}`);
  const idxData = await idxRes.json();
  const idx = idxData.items?.[0];
  if (!idx) return;
  await pbFetch(env, l1Base, `/api/collections/search_index/records/${idx.id}`, {
    method: 'PATCH',
    body: { rating_avg: Number(ratingAvg.toFixed(1)), review_count: items.length },
  });
}

// ── 도움돼요 투표 ────────────────────────────────────────────
export async function handleHelpfulVote(request, env) {
  const { review_id, voter_guid, l1_base } = await request.json();
  const res = await pbFetch(env, l1_base, '/api/collections/review_helpful_votes/records', {
    method: 'POST',
    body: { review_id, voter_guid, voted_at: new Date().toISOString() },
  });
  if (res.status === 400) return jsonResponse({ ok: true, already_voted: true }); // 훅이 중복을 이미 거부함

  const reviewRes = await pbFetch(env, l1_base, `/api/collections/reviews/records/${review_id}`);
  const review = await reviewRes.json();
  await pbFetch(env, l1_base, `/api/collections/reviews/records/${review_id}`, {
    method: 'PATCH',
    body: { helpful_count: (review.helpful_count || 0) + 1 },
  });
  return jsonResponse({ ok: true });
}

// ── 판매자 공개 답글 ──────────────────────────────────────────
export async function handleSellerReply(request, env) {
  const { review_id, seller_guid, reply, l1_base } = await request.json();
  const reviewRes = await pbFetch(env, l1_base, `/api/collections/reviews/records/${review_id}`);
  const review = await reviewRes.json();
  if (review.seller_guid !== seller_guid) return jsonResponse({ ok: false, reason: 'NOT_OWNER' }, 403);

  await pbFetch(env, l1_base, `/api/collections/reviews/records/${review_id}`, {
    method: 'PATCH',
    body: { seller_reply: reply, seller_replied_at: new Date().toISOString() },
  });
  return jsonResponse({ ok: true });
}

// ── 신고(공동체 모더레이션) ────────────────────────────────────
export async function handleReportReview(request, env) {
  const { review_id, reporter_guid, reason, l1_base } = await request.json();
  await pbFetch(env, l1_base, '/api/collections/review_moderation_log/records', {
    method: 'POST',
    body: { review_id, event: 'reported_by_user', reason, actor: reporter_guid, created_at: new Date().toISOString() },
  });

  const filter = buildFilter([['review_id', '=', review_id], ['event', '=', 'reported_by_user']]);
  const res = await pbFetch(env, l1_base, `/api/collections/review_moderation_log/records?${new URLSearchParams({ filter, perPage: '100' })}`);
  const { items = [] } = await res.json();
  if (items.length >= 5) {
    await pbFetch(env, l1_base, `/api/collections/reviews/records/${review_id}`, { method: 'PATCH', body: { status: 'flagged' } });
    await pbFetch(env, l1_base, '/api/collections/review_moderation_log/records', {
      method: 'POST',
      body: { review_id, event: 'auto_flagged', reason: 'CROWD_REPORTED', actor: 'system', created_at: new Date().toISOString() },
    });
  }
  return jsonResponse({ ok: true });
}

// ── 이상탐지 (매일 크론) — 급증/유사텍스트/신규계정 집중 ──────────────
export async function scheduledReviewAnomalyDetection(env) {
  for (const [l1Node, meta] of await listActiveL1Nodes(env)) {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const filter = buildFilter([['created_at', '>=', since]]);
    const res = await pbFetch(env, meta.base_url, `/api/collections/reviews/records?${new URLSearchParams({ filter, perPage: '500' })}`);
    const { items: recent = [] } = await res.json();
    if (!recent.length) continue;

    // (1) 판매자별 급증
    const bySeller = groupBy(recent, 'seller_guid');
    for (const [seller, reviews] of Object.entries(bySeller)) {
      const baseline = await getSellerReviewBaseline(env, meta.base_url, seller);
      if (reviews.length > Math.max(5, baseline * 4)) {
        await flagReviews(env, meta.base_url, reviews.map((r) => r.id), 'BURST_ANOMALY');
      }
    }

    // (2) 신규계정(L0) 집중
    const newAccountReviews = recent.filter((r) => r.reviewer_sso_level === 'L0');
    if (recent.length > 10 && newAccountReviews.length / recent.length > 0.7) {
      await flagReviews(env, meta.base_url, newAccountReviews.map((r) => r.id), 'NEW_ACCOUNT_CONCENTRATION');
    }

    // (3) 문구 유사도 클러스터 — 경량 자카드 유사도(상세 알고리즘은 별도 모듈로 대체 가능)
    const clusters = clusterBySimilarText(recent, 0.85);
    for (const cluster of clusters.filter((c) => c.length >= 3)) {
      await flagReviews(env, meta.base_url, cluster.map((r) => r.id), 'TEXT_SIMILARITY_CLUSTER');
    }
  }
}

async function flagReviews(env, l1Base, reviewIds, reasonCode) {
  for (const id of reviewIds) {
    await pbFetch(env, l1Base, `/api/collections/reviews/records/${id}`, { method: 'PATCH', body: { status: 'flagged' } });
    await pbFetch(env, l1Base, '/api/collections/review_moderation_log/records', {
      method: 'POST',
      body: { review_id: id, event: 'auto_flagged', reason: reasonCode, actor: 'system', created_at: new Date().toISOString() },
    });
  }
  await flagOpsAlert(env, `review-anomaly:${l1Base}:${reasonCode}:${Date.now()}`, { reviewIds, reasonCode });
}

async function getSellerReviewBaseline(env, l1Base, sellerGuid) {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const filter = buildFilter([['seller_guid', '=', sellerGuid], ['created_at', '>=', since]]);
  const res = await pbFetch(env, l1Base, `/api/collections/reviews/records?${new URLSearchParams({ filter, perPage: '1000' })}`);
  const { items = [] } = await res.json();
  return items.length / 30;
}

function groupBy(arr, key) {
  return arr.reduce((acc, x) => {
    (acc[x[key]] ||= []).push(x);
    return acc;
  }, {});
}

function jaccardSimilarity(a, b) {
  const setA = new Set(a.toLowerCase().split(/\s+/));
  const setB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union ? intersection / union : 0;
}

function clusterBySimilarText(reviews, threshold) {
  const clusters = [];
  const used = new Set();
  for (let i = 0; i < reviews.length; i++) {
    if (used.has(i)) continue;
    const cluster = [reviews[i]];
    used.add(i);
    for (let j = i + 1; j < reviews.length; j++) {
      if (used.has(j)) continue;
      if (jaccardSimilarity(reviews[i].text, reviews[j].text) >= threshold) {
        cluster.push(reviews[j]);
        used.add(j);
      }
    }
    if (cluster.length > 1) clusters.push(cluster);
  }
  return clusters;
}
