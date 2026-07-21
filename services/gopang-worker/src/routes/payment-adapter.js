/**
 * routes/payment-adapter.js — 8번 항목 요약 구현
 * (전체 설계는 마스터 문서 §4 · 대화기록 8번 절 참조. 여기서는 escrow.js가
 *  레일 무관 공통 함수를 쓸 수 있도록 최소 인터페이스만 채워둔다.)
 *
 * [2026-07-21 수정 — 사고실험 시나리오2에서 발견] verifyWebhook(HMAC 서명 검증)을
 * 제거했다. 토스페이먼츠 공식 문서(docs.tosspayments.com/reference/using-api/
 * webhook-events) 확인 결과, tosspayments-webhook-signature 헤더는
 * payout.changed/seller.changed(지급대행) 웹훅에만 포함되고, 우리가 실제로
 * 받는 PAYMENT_STATUS_CHANGED엔 서명 자체가 없다 — 즉 기존 구현은 존재하지
 * 않는 헤더를 검증하려다 항상 실패해, 실제 결제 웹훅이 전부 401로 거부됐을
 * 것이다. 대신 getPayment()로 결제조회 API를 직접 재호출해 신뢰 가능한 값을
 * 확보하는 방식으로 대체(호출부: routes/payment.js handlePgWebhook).
 */

class PaymentAdapter {
  async createOrder(_params) { throw new Error('not implemented'); }
  async getPayment(_paymentKey) { throw new Error('not implemented'); }
  async releaseToSeller(_params) { throw new Error('not implemented'); }
  async refundToBuyer(_params) { throw new Error('not implemented'); }
}

class TossPaymentsAdapter extends PaymentAdapter {
  constructor(env) { super(); this.env = env; }

  async createOrder({ orderId, amount, itemName, successUrl, failUrl }) {
    return {
      clientKey: this.env.TOSS_CLIENT_KEY,
      orderId, amount, successUrl, failUrl,
      useEscrow: true,
      escrowProducts: [{ id: 'escrow-p1', name: itemName }],
    };
  }

  /**
   * 결제 조회 API — 웹훅 body를 그대로 믿지 않고, 이 응답을 신뢰 가능한
   * 소스로 쓴다. 응답 필드: paymentKey, orderId, status('DONE' 등), totalAmount 등.
   */
  async getPayment(paymentKey) {
    const res = await fetch(`https://api.tosspayments.com/v1/payments/${paymentKey}`, {
      method: 'GET',
      headers: { Authorization: `Basic ${btoa(this.env.TOSS_SECRET_KEY + ':')}` },
    });
    if (!res.ok) throw new Error(`TOSS_PAYMENT_LOOKUP_FAILED:${res.status}`);
    return res.json();
  }

  async releaseToSeller({ paymentKey, amount }) {
    const res = await fetch(`https://api.tosspayments.com/v1/escrow/${paymentKey}/confirm`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(this.env.TOSS_SECRET_KEY + ':')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount }),
    });
    if (!res.ok) throw new Error('TOSS_RELEASE_FAILED');
    return res.json();
  }

  async refundToBuyer({ paymentKey, amount, reason = '구매자 요청' }) {
    const res = await fetch(`https://api.tosspayments.com/v1/payments/${paymentKey}/cancel`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(this.env.TOSS_SECRET_KEY + ':')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cancelReason: reason, cancelAmount: amount }),
    });
    if (!res.ok) throw new Error('TOSS_REFUND_FAILED');
    return res.json();
  }
}

export function getAdapter(env, provider) {
  const map = { toss: TossPaymentsAdapter };
  const Cls = map[provider];
  if (!Cls) throw new Error(`UNKNOWN_PG_PROVIDER:${provider}`);
  return new Cls(env);
}
