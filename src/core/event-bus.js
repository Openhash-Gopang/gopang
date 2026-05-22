/**
 * @file event-bus.js
 * @description 플러그인 간 이벤트 발행·구독·오류 격리
 * @version 1.0.0
 * @author AI City Inc.
 *
 * ⚠️  이 파일은 레지스트리 모듈을 절대 import하지 않는다.
 *     순환 참조 방지 원칙 — registry → event-bus 단방향만 허용.
 *
 * 사용법:
 *   import { EventBus, EVENTS } from './event-bus.js'
 *   EventBus.on(EVENTS.MSG_RECEIVED, handler, 'k-law')
 *   EventBus.emit(EVENTS.MSG_RECEIVED, { ... })
 */

import { EVENTS } from './constants.js'

class GopangEventBus {

  constructor() {
    /** @type {Map<string, Array<{handler: Function, pluginName: string}>>} */
    this._listeners = new Map()

    /** @type {Array<{event:string, data:any, ts:number, pluginName:string}>} */
    this._history = []

    /** @type {number} 이력 보관 최대 건수 */
    this._maxHistory = 500
  }

  /**
   * 이벤트 핸들러 등록
   * @param {string}   event      - 이벤트명 (EVENTS 상수 사용 권장)
   * @param {Function} handler    - 핸들러 함수
   * @param {string}   pluginName - 등록 주체 (디버깅용)
   */
  on(event, handler, pluginName = 'unknown') {
    if (typeof handler !== 'function') {
      throw new TypeError(`[EventBus] on(): handler는 함수여야 합니다 (${pluginName}, ${event})`)
    }
    if (!this._listeners.has(event)) {
      this._listeners.set(event, [])
    }
    this._listeners.get(event).push({ handler, pluginName })
  }

  /**
   * 이벤트 핸들러 제거 (플러그인 언로드 시 사용)
   * @param {string}   event      - 이벤트명
   * @param {Function} handler    - 제거할 핸들러
   */
  off(event, handler) {
    if (!this._listeners.has(event)) return
    const filtered = this._listeners.get(event)
      .filter(entry => entry.handler !== handler)
    this._listeners.set(event, filtered)
  }

  /**
   * 이벤트 발행
   * 핵심 원칙: 한 핸들러의 오류가 다른 핸들러에 전파되지 않는다.
   *
   * @param {string} event      - 이벤트명
   * @param {any}    data       - 전달 데이터
   * @param {string} emitterName - 발행 주체 (디버깅용)
   */
  emit(event, data = null, emitterName = 'core') {
    // 이력 기록
    this._addHistory(event, data, emitterName)

    const handlers = this._listeners.get(event) ?? []

    for (const { handler, pluginName } of handlers) {
      try {
        handler(data)
      } catch (err) {
        // ★ 오류 격리: 이 플러그인의 오류가 다른 핸들러로 전파되지 않음
        console.error(`[EventBus] ${pluginName} 핸들러 오류 (이벤트: ${event}):`, err)

        // PLUGIN_ERROR 이벤트는 무한 루프 방지를 위해 별도 처리
        if (event !== EVENTS.PLUGIN_ERROR) {
          this._addHistory(EVENTS.PLUGIN_ERROR, { pluginName, event, err: err.message }, 'event-bus')
          const errorHandlers = this._listeners.get(EVENTS.PLUGIN_ERROR) ?? []
          for (const { handler: eh } of errorHandlers) {
            try { eh({ pluginName, event, err }) } catch (_) { /* 무시 */ }
          }
        }
      }
    }
  }

  /**
   * 등록된 핸들러 수 조회 (테스트·디버깅용)
   * @param {string} event
   * @returns {number}
   */
  listenerCount(event) {
    return (this._listeners.get(event) ?? []).length
  }

  /**
   * 이벤트 이력 조회 (디버깅·버그 추적용)
   * @param {number} n - 최근 N개
   * @returns {Array}
   */
  getHistory(n = 50) {
    return this._history.slice(-n)
  }

  /**
   * 특정 이벤트 이력만 조회
   * @param {string} event
   * @returns {Array}
   */
  getHistoryByEvent(event) {
    return this._history.filter(h => h.event === event)
  }

  /**
   * 이력 초기화 (테스트용)
   */
  clearHistory() {
    this._history = []
  }

  /**
   * 모든 핸들러 제거 (테스트용)
   */
  clearAll() {
    this._listeners.clear()
    this._history = []
  }

  // ── Private ─────────────────────────────────────────────────────────────

  _addHistory(event, data, emitterName) {
    this._history.push({ event, data, ts: Date.now(), emitterName })
    // 최대 이력 초과 시 오래된 것부터 제거
    if (this._history.length > this._maxHistory) {
      this._history.shift()
    }
  }
}

// 싱글톤 인스턴스 — 플랫폼 전체에서 공유
export const EventBus = new GopangEventBus()

// EVENTS 재내보내기 (편의)
export { EVENTS }
