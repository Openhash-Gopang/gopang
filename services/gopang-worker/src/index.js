/**
 * Worker 진입점 — market-proxy (독립 Cloudflare Worker)
 *
 * [2026-07 정정] 최초 설계 시 "gopang-proxy Worker에 라우트를 추가"한다고
 * 가정했으나, gopang-proxy는 hondi-proxy(루트 worker.js)로 통합·폐지 중임을
 * 확인해 별도 독립 Worker(market-proxy)로 배치를 확정했다. hondi-proxy의
 * /deepseek, /geocode, /pdv/report, /sso 등과는 별개의 배포 단위이며, 서로
 * HTTP 호출로만 연동한다(공유 코드는 저장소 루트 src/openhash/를 통해서만).
 */

import { handleLedgerCorrection, handleLedgerVerify, scheduledLedgerAnchoring, scheduledLedgerIntegrityAudit } from './routes/ledger.js';
import { handleBuyerConfirm, handleOpenDispute, handleDisputeResolution, scheduledEscrowAutoRelease } from './routes/escrow.js';
import { handleCreateReview, handleHelpfulVote, handleSellerReply, handleReportReview, scheduledReviewAnomalyDetection } from './routes/reviews.js';
import { handleVerifyNts, scheduledKycRecheck } from './routes/kyc.js';
import { handleResolveL1 } from './routes/l1-resolve.js';
import { handleCreatePayment, handlePgWebhook, scheduledPgReconciliation } from './routes/payment.js';
import { handleFraudAppeal, handleResolveFraudCase, scheduledWashTradingDetection, scheduledClusterDetection } from './routes/fraud.js';
import { jsonResponse } from './lib/http.js';

const ROUTES = {
  'POST /biz/ledger-correction': handleLedgerCorrection,
  'GET /biz/ledger-verify': handleLedgerVerify,

  'POST /biz/escrow/confirm': handleBuyerConfirm,
  'POST /biz/escrow/dispute': handleOpenDispute,
  'POST /biz/escrow/dispute-resolve': handleDisputeResolution,

  'POST /biz/review/create': handleCreateReview,
  'POST /biz/review/helpful': handleHelpfulVote,
  'POST /biz/review/seller-reply': handleSellerReply,
  'POST /biz/review/report': handleReportReview,

  'POST /biz/verify-nts': handleVerifyNts,
  'POST /biz/resolve-l1': handleResolveL1,

  'POST /biz/pay/create': handleCreatePayment,

  'POST /biz/fraud-case/appeal': handleFraudAppeal,
  'POST /biz/fraud-case/resolve': handleResolveFraudCase,
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // /biz/pay/webhook/{provider}는 provider가 가변이라 별도 처리
    const webhookMatch = url.pathname.match(/^\/biz\/pay\/webhook\/([a-z0-9_-]+)$/);
    if (webhookMatch && request.method === 'POST') {
      try {
        return await handlePgWebhook(request, env, webhookMatch[1]);
      } catch (e) {
        console.error('[Worker] PG webhook 처리 오류:', e);
        return jsonResponse({ ok: false, reason: 'INTERNAL_ERROR' }, 500);
      }
    }

    const key = `${request.method} ${url.pathname}`;
    const handler = ROUTES[key];
    if (!handler) return jsonResponse({ ok: false, reason: 'NOT_FOUND' }, 404);

    try {
      return await handler(request, env, ctx);
    } catch (e) {
      console.error(`[Worker] ${key} 처리 중 오류:`, e);
      return jsonResponse({ ok: false, reason: 'INTERNAL_ERROR', message: e.message }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    // wrangler.toml의 cron 표현식과 1:1 매핑 — event.cron으로 분기
    switch (event.cron) {
      case '0 * * * *': // 매시 정각
        ctx.waitUntil(scheduledLedgerAnchoring(env));
        break;
      case '0 18 * * *': // 매일 03:00 KST (UTC 18:00)
        ctx.waitUntil(Promise.all([
          scheduledLedgerIntegrityAudit(env),
          scheduledEscrowAutoRelease(env),
          scheduledReviewAnomalyDetection(env),
          scheduledKycRecheck(env),
          scheduledPgReconciliation(env),
          scheduledWashTradingDetection(env),
          scheduledClusterDetection(env),
        ]));
        break;
      default:
        console.warn('[scheduled] 미등록 cron:', event.cron);
    }
  },
};

export { EscrowSigner } from './do/escrow-signer.js';
export { LedgerWriter } from './do/ledger-writer.js';
