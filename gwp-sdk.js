/**
 * gwp-sdk.js - Gopang Widget Protocol SDK v1.1
 * 서비스 webapp에서 고팡과 통신하기 위한 클라이언트 라이브러리
 */

(function(global) {
  'use strict';

  class GopangWidget {
    constructor(handlers) {
      this._handlers = handlers || {};
      this._gopangOrigin = null;
      this._ready = false;

      var params = new URLSearchParams(location.search);
      var originParam = params.get('origin');
      if (originParam) {
        try { this._gopangOrigin = new URL(originParam).origin; }
        catch(e) { this._gopangOrigin = originParam; }
      }

      var self = this;
      window.addEventListener('message', function(e) { self._onMessage(e); });
      this._autoRegister();
    }

    ready(options) {
      options = options || {};
      this._ready = true;
      this._post('GWP_READY', {
        title: options.title || document.title || '서비스',
        placeholder: options.placeholder || '메시지를 입력하세요.',
      });
    }

    message(text) {
      this._post('GWP_MESSAGE', { text: text });
    }

    done(data) {
      data = data || {};
      var pdv = data.pdvData || {};
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

    _onMessage(e) {
      if (this._gopangOrigin && e.origin !== this._gopangOrigin) return;
      var msg = e.data || {};
      var type = msg.type;
      if (!type) return;
      if (type === 'GWP_INIT' && this._handlers.onInit) this._handlers.onInit(msg);
      if (type === 'GWP_INPUT' && this._handlers.onInput) this._handlers.onInput(msg.text, msg.file);
    }

    _post(type, data) {
      var target = this._gopangOrigin || '*';
      var payload = Object.assign({ type: type }, data);
      try { parent.postMessage(payload, target); }
      catch(e) { console.warn('[GWP-SDK] postMessage 실패:', e.message); }
    }

    _autoRegister() {
      var self = this;
      fetch('/manifest.json').then(function(r) {
        return r.ok ? r.json() : null;
      }).then(function(manifest) {
        if (manifest && manifest.id && manifest.triggers) {
          self._post('GWP_REGISTER', { manifest: manifest });
          console.info('[GWP-SDK] 서비스 등록:', manifest.id);
        }
      }).catch(function() {});
    }
  }

  global.GopangWidget = GopangWidget;

})(window);
