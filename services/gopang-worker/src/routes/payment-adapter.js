/**
 * routes/payment-adapter.js — 8번 항목 요약 구현
 * (전체 설계는 마스터 문서 §4 · 대화기록 8번 절 참조. 여기서는 escrow.js가
 *  레일 무관 공통 함수를 쓸 수 있도록 최소 인터페이스만 채워둔다.)
 */

class PaymentAdapter {
  async createOrder(_params) { throw new Error('not implemented'); }
  async verifyWebhook(_request, _secret) { throw new Error('not implemented'); }
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

  async verifyWebhook(request, secret) {
    const sig = request.headers.get('TossPayments-Signature');
    const body = await request.text();
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const macBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
    const computed = Array.from(new Uint8Array(macBuf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    if (sig !== computed) throw new Error('INVALID_WEBHOOK_SIGNATURE');
    return JSON.parse(body);
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
