/**
 * app.js — 고팡 v2 부트스트랩 진입점
 * 의존성 순서: core → pdv/openhash → domains → ai-secretary → network/gdc/privacy → UI
 */

import { EventBus } from './core/event-bus.js';
import { PluginRegistry } from './core/plugin-registry.js';
import { EVENTS } from './core/constants.js';

// 레이어 진입점 (각 모듈의 init() 팩토리)
import { PDVLayer }     from './pdv/vault.js';
import { OpenHashLayer} from './openhash/hashChain.js';
import { AIPipeline }  from './ai-secretary/pipeline.js';
import { NetworkLayer } from './network/layerClient.js';
import { GDCLayer }     from './gdc/tokenomics.js';
import { PrivacyLayer } from './privacy/mixnet.js';

// 도메인 플러그인
import { KLawPlugin }   from './domains/k-law/index.js';
import { KHealthPlugin }from './domains/k-health/index.js';

// Shell UI
import { ShellUI }      from './shell-ui.js';

/** 부트스트랩 상태 */
const BootState = {
  IDLE: 'IDLE',
  BOOTING: 'BOOTING',
  READY: 'READY',
  ERROR: 'ERROR',
};

let _state = BootState.IDLE;
let _registry = null;

/**
 * 플랫폼 부트스트랩
 * @returns {Promise<{registry, pipeline, ui}>}
 */
export async function bootstrap() {
  if (_state === BootState.BOOTING) {
    throw new Error('bootstrap() already in progress');
  }
  if (_state === BootState.READY) {
    return { registry: _registry };
  }

  _state = BootState.BOOTING;
  const log = (msg) => console.log(`[BOOT] ${msg}`);

  try {
    // ── 1. 코어 초기화 ─────────────────────────────────────
    log('1/6 코어 초기화...');
    EventBus.init();
    _registry = new PluginRegistry(EventBus);
    await _registry.init();

    // ── 2. 코어 레이어 초기화 ──────────────────────────────
    log('2/6 PDV + OpenHash 초기화...');
    await PDVLayer.init();
    await OpenHashLayer.init();

    // ── 3. 도메인 플러그인 등록 (순서 무관) ───────────────
    log('3/6 도메인 플러그인 등록...');
    await _registry.register(new KLawPlugin());
    await _registry.register(new KHealthPlugin());
    // 추후: await _registry.register(new KMarketPlugin());

    // ── 4. AI 비서 파이프라인 초기화 ──────────────────────
    log('4/6 AI 비서 파이프라인 초기화...');
    await AIPipeline.init({ registry: _registry, eventBus: EventBus });

    // ── 5. 경제·네트워크·프라이버시 레이어 초기화 ─────────
    log('5/6 Network + GDC + Privacy 초기화...');
    await NetworkLayer.init();
    await GDCLayer.init();
    await PrivacyLayer.init();

    // ── 6. Shell UI 렌더링 ─────────────────────────────────
    log('6/6 Shell UI 렌더링...');
    const plugins = _registry.list();
    await ShellUI.render(plugins);

    _state = BootState.READY;
    EventBus.emit(EVENTS.PLATFORM_READY, { plugins: plugins.map(p => p.name) });
    log(`부트스트랩 완료 — 플러그인 ${plugins.length}개 활성화`);

    return { registry: _registry, pipeline: AIPipeline, ui: ShellUI };

  } catch (err) {
    _state = BootState.ERROR;
    console.error('[BOOT] 부트스트랩 실패:', err);
    EventBus.emit(EVENTS.PLATFORM_ERROR, { error: err.message });
    throw err;
  }
}

/** 현재 부트 상태 조회 */
export function getBootState() { return _state; }

/** 테스트·재시작용 리셋 */
export function _resetForTest() {
  _state = BootState.IDLE;
  _registry = null;
}

// 브라우저 환경에서 자동 실행
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => bootstrap());
}
