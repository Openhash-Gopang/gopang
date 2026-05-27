/**
 * gwp-sdk.js — Gopang Widget Protocol SDK v1.0
 * 
 * 서비스 webapp 개발자가 고팡과 통신하기 위한 클라이언트 라이브러리.
 * 
 * 사용법:
 *   <script src="https://gopang.net/gwp-sdk.js"></script>
 *   <script>
 *     const gwp = new GopangWidget({
 *       onInit(ctx) { /* 고팡에서 받은 컨텍스트로 서비스 초기화 */ },
 *       onInput(text, file) { /* 고팡 입력창에서 들어온 입력 처리 */ },
 *     });
 *     gwp.ready({ placeholder: '사진을 찍어 전송하세요', title: 'K-Cleaner' });
 *     gwp.message('분석이 완료됐습니다.');
 *     gwp.done({ summary: '신고 완료', pdvData: { action: 'k-cleaner', result: '...' } });
 *   </script>
 * 
 * 메시지 타입 (고팡 → 서비스):
 *   GWP_INIT    { token, user, context }
 *   GWP_INPUT   { text, file }
 * 
 * 메시지 타입 (서비스 → 고팡):
 *   GWP_READY   { placeholder, title, accept }
 *   GWP_MESSAGE { role, text, html, data }
 *   GWP_INPUT_CTRL { placeholder, accept, disabled }
 *   GWP_DONE    { summary, pdvData: { who, when, where, what, how, why, data } }
 *   GWP_ERROR   { message }
 */

(function (global) {
  'use strict';

  // ── 위젯 모드 여부 판단 ─────────────────────────────────────
  const params  = new URLSearchParams(location.search);
  const IS_WIDGET = params.get('gwp') === '1';
  const GOPANG_ORIGIN = params.get('origin') || 'https://gopang.net';

  class GopangWidget {
    constructor(handlers = {}) {
      this._handlers    = handlers;
      this._isWidget    = IS_WIDGET;
      this._token       = params.get('token') || null;
      this._context     = decodeURIComponent(params.get('ctx') || '');
      this._ready       = false;
      this._queue       = [];   // ready 전에 쌓인 메시지

      if (!IS_WIDGET) {
        console.info('[GWP] 독립 모드 — 고팡 위젯 기능 비활성');
        return;
      }

      // 고팡으로부터 메시지 수신
      window.addEventListener('message', (e) => {
        if (e.origin !== GOPANG_ORIGIN) return;
        const msg = e.data;
        if (!msg || !msg.type) return;

        switch (msg.type) {
          case 'GWP_INIT':
            this._token = msg.token;
            if (this._handlers.onInit) this._handlers.onInit({
              token:   msg.token,
              user:    msg.user,
              context: msg.context || this._context,
            });
            break;

          case 'GWP_INPUT':
            if (this._handlers.onInput) this._handlers.onInput(msg.text || '', msg.file || null);
            break;

          default:
            console.warn('[GWP] 알 수 없는 메시지:', msg.type);
        }
      });

      console.info('[GWP] 위젯 모드 초기화 완료. origin:', GOPANG_ORIGIN);
    }

    // ── 준비 완료 신호 ──────────────────────────────────────────
    ready({ placeholder = '메시지를 입력하세요…', title = '', accept = '*', showCamera = true } = {}) {
      if (!this._isWidget) return;
      this._postToGopang({
        type: 'GWP_READY',
        placeholder,
        title,
        accept,
        showCamera,
      });
      this._ready = true;
      // 큐에 쌓인 메시지 flush
      this._queue.forEach(m => this._postToGopang(m));
      this._queue = [];
    }

    // ── 채팅창에 메시지 출력 ────────────────────────────────────
    message(text, { role = 'ai', html = null, data = null } = {}) {
      const msg = { type: 'GWP_MESSAGE', role, text, html, data };
      if (this._isWidget) {
        this._ready ? this._postToGopang(msg) : this._queue.push(msg);
      }
    }

    // ── 입력창 제어 ────────────────────────────────────────────
    inputCtrl({ placeholder, accept, disabled = false } = {}) {
      if (!this._isWidget) return;
      this._postToGopang({ type: 'GWP_INPUT_CTRL', placeholder, accept, disabled });
    }

    // ── 작업 완료 — 고팡에 제어권 반환 ─────────────────────────
    // pdvData는 6하 원칙을 따릅니다:
    //   who:   사용자 식별자 (전화번호 마스킹 또는 토큰)
    //   when:  ISO 8601 타임스탬프 (생략 시 자동 설정)
    //   where: GPS 좌표 또는 주소 문자열
    //   what:  처리 결과 요약 (summary와 동일하거나 상세)
    //   how:   입력 방식 'text'|'image'|'voice'|'file'
    //   why:   서비스 이용 목적
    //   data:  서비스별 원본 데이터 (자유 형식)
    done({ summary = '', pdvData = null } = {}) {
      if (!this._isWidget) return;

      // 6하 원칙 필드 자동 보완 — 서비스가 채우지 않은 항목을 기본값으로 채움
      const enriched = pdvData ? {
        who:   pdvData.who   || this._token || 'anonymous',
        when:  pdvData.when  || new Date().toISOString(),
        where: pdvData.where || null,
        what:  pdvData.what  || summary,
        how:   pdvData.how   || 'text',
        why:   pdvData.why   || null,
        data:  pdvData.data  || pdvData,   // 원본 데이터 보존
      } : null;

      this._postToGopang({ type: 'GWP_DONE', summary, pdvData: enriched });
    }

    // ── 오류 신호 ──────────────────────────────────────────────
    error(message) {
      if (!this._isWidget) return;
      this._postToGopang({ type: 'GWP_ERROR', message });
    }

    // ── 내부: postMessage ──────────────────────────────────────
    _postToGopang(msg) {
      window.parent.postMessage(msg, GOPANG_ORIGIN);
    }

    // ── 유틸: 토큰/유저 정보 ──────────────────────────────────
    get token()   { return this._token; }
    get context() { return this._context; }
    get isWidget(){ return this._isWidget; }

    // ── Supabase 세션 복원 헬퍼 ────────────────────────────────
    // 토큰을 가지고 Supabase 클라이언트 세션을 복원할 때 사용
    getAuthHeader() {
      return this._token
        ? { Authorization: `Bearer ${this._token}` }
        : {};
    }
  }

  // ── 독립 모드일 때 위젯 UI 숨기기 헬퍼 ──────────────────────
  GopangWidget.isWidget = IS_WIDGET;
  GopangWidget.hideShellElements = function (selectors = []) {
    if (IS_WIDGET) {
      selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => el.style.display = 'none');
      });
    }
  };

  global.GopangWidget = GopangWidget;
})(window);
