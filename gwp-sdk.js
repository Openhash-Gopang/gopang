/**
 * gwp-sdk.js — Gopang Widget Protocol SDK v1.1
 *
 * 서비스 webapp에서 고팡과 통신하기 위한 클라이언트 라이브러리
 *
 * 사용법:
 *   <script src="https://gopang.net/gwp-sdk.js"></script>
 *   <script>
 *     const gwp = new GopangWidget({
 *       onInit(ctx) { /* 고팡에서 전달받은 컨텍스트로 서비스 초기화 */ },
 *       onInput(text, file) { /* 고팡 입력창에서 전달된 입력 처리 */ },
 *     });
 *     gwp.ready({ title: 'K-Cleaner' });
 *     gwp.message('신고가 완료됐습니다.');
 *     gwp.done({ summary: '신고 완료', pdvData: { action: 'k-cleaner', result: '...' } });
 *   </script>
 *
 * 메시지 타입 (고팡 → 서비스):
 *   GWP_INIT    { token, user, context }
 *   GWP_INPUT   { text, file }
 *
 * 메시지 타입 (서비스 → 고팡):
 *   GWP_READY   { title, placeholder }
 *   GWP_MESSAGE { text }
 *   GWP_DONE    { summary, pdvData }
 *   GWP_REGISTER { manifest }
 */

(function(global) {
  'use strict';

  class GopangWidget {
    constructor(handlers = {}) {
      this._handlers   = handlers;
      this._gopangOrigin = null;
      this._ready      = false;

      // URL 파라미터에서 origin 추출
      const params = new URLSearchParams(location.search);
      const originParam = params.get('origin');
      if (originParam) {
        try { this._gopangOrigin = new URL(originParam).origin; }
        catch { this._gopangOrigin = originParam; }
      }

      // 고팡으로부터 메시지 수신
      window.addEventListener('message', (e) => this._onMessage(e));

      // 자동 등록: manifest.json이 있으면 고팡에 등록
      this._autoRegister();
    }

    // ── 고팡에 서비스 준비 완료 알림 ─────────────────────────────
    ready(options = {}) {
      this._ready = true;
      this._post('GWP_READY', {
        title:       options.title       || document.title || '서비스',
        placeholder: options.placeholder || '메시지를 입력하세요…',
      });
    }

    // ── 고팡 채팅창에 메시지 표시 ────────────────────────────────
    message(text) {
      this._post('GWP_MESSAGE', { text });
    }

    // ── 서비스 완료 — 6하 원칙 PDV 보고 ─────────────────────────
    done(data = {}) {
      const pdv = data.pdvData || {};
      this._post('GWP_DONE', {
        summary: data.summary || '서비스 완료',
        pdvData: {
          who:   pdv.who   || null,
          when:  pdv.when  || new Date().toISOString(),
          where: pdv.where || null,
          what:  pdv.what  || data.summary || null,
          how:   pdv.how   || 'text',
          why:   pdv.why   || null,
          data:  pdv.data  || pdv,
        },
      });
    }

    // ── 내부: 메시지 수신 처리 ───────────────────────────────────
    _onMessage(e) {
      // origin 검증
      if (this._gopangOrigin && e.origin !== this._gopangOrigin) return;

      const { type, ...payload } = e.data || {};
      if (!type) return;

      switch (type) {
        case 'GWP_INIT':
          if (this._handlers.onInit) this._handlers.onInit(payload);
          break;
        case 'GWP_INPUT':
          if (this._handlers.onInput) this._handlers.onInput(payload.text, payload.file);
          break;
      }
    }

    // ── 내부: 고팡으로 postMessage 전송 ─────────────────────────
    _post(type, data = {}) {
      const target = this._gopangOrigin || '*';
      try {
        parent.postMessage({ type, ...data }, target);
      } catch(e) {
        console.warn('[GWP-SDK] postMessage 실패:', e.message);
      }
    }

    // ── 내부: manifest.json 자동 등록 ───────────────────────────
    async _autoRegister() {
      try {
        const r = await fetch('/manifest.json');
        if (!r.ok) return;
        const manifest = await r.json();
        if (manifest.id && manifest.triggers) {
          this._post('GWP_REGISTER', { manifest });
          console.info('[GWP-SDK] 서비스 등록:', manifest.id);
        }
      } catch {}
    }
  }

  global.GopangWidget = GopangWidget;

})(window);
