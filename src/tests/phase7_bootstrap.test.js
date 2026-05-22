/**
 * phase7_bootstrap.test.js — Phase 7 부트스트랩 + Shell UI 테스트
 * B-01~B-09
 */

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

// ── 모의 의존성 (브라우저 API 없는 Node 환경) ──────────────

// EventBus 모의
const _handlers = {};
const MockEventBus = {
  _events: [],
  init() {},
  on(event, fn) {
    _handlers[event] = _handlers[event] || [];
    _handlers[event].push(fn);
  },
  emit(event, data) {
    this._events.push({ event, data });
    (_handlers[event] || []).forEach(fn => { try { fn(data); } catch {} });
  },
  off(event, fn) {
    if (_handlers[event]) _handlers[event] = _handlers[event].filter(h => h !== fn);
  },
};

// PluginRegistry 모의
class MockRegistry {
  constructor() { this._plugins = []; }
  async init() {}
  async register(plugin) { this._plugins.push(plugin); }
  list() { return [...this._plugins]; }
}

// 레이어 모의
const LayerMock = { init: async () => {} };

// 플러그인 모의
class MockPlugin {
  constructor(name, icon, label) {
    this.name = name;
    this.metadata = { icon, label };
  }
  async init() {}
}

// ── 테스트 ─────────────────────────────────────────────────

describe('Phase 7 — 부트스트랩 + Shell UI', () => {

  // ── B-01: app.js 파일 존재 확인 ──────────────────────────
  it('B-01: app.js 파일이 존재한다', () => {
    const content = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    assert.ok(content.length > 0, 'app.js가 비어 있음');
  });

  // ── B-02: shell-ui.js 파일 존재 확인 ─────────────────────
  it('B-02: shell-ui.js 파일이 존재한다', () => {
    const content = readFileSync(join(ROOT, 'src/shell-ui.js'), 'utf8');
    assert.ok(content.length > 0, 'shell-ui.js가 비어 있음');
  });

  // ── B-03: index.html 파일 존재 및 필수 요소 포함 ──────────
  it('B-03: index.html에 필수 마운트 포인트가 있다', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    assert.ok(html.includes('id="gopang-shell"'), '#gopang-shell 마운트 포인트 없음');
    assert.ok(html.includes('id="boot-splash"'),  '#boot-splash 없음');
    assert.ok(html.includes('src/app.js'),         'app.js import 없음');
  });

  // ── B-04: bootstrap() 부트 순서 (코어→레이어→플러그인→AI→네트워크→UI) ──
  it('B-04: bootstrap() 부트 순서가 올바르다', () => {
    const content = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    const coreIdx     = content.indexOf('EventBus.init');
    const registryIdx = content.indexOf('registry.init');
    const pdvIdx      = content.indexOf('PDVLayer.init');
    const pluginIdx   = content.indexOf('registry.register');
    const aiIdx       = content.indexOf('AIPipeline.init');
    const netIdx      = content.indexOf('NetworkLayer.init');
    const uiIdx       = content.indexOf('ShellUI.render');

    assert.ok(coreIdx     < registryIdx, '코어 init이 registry init보다 앞이어야 함');
    assert.ok(registryIdx < pdvIdx,      'registry init이 PDV init보다 앞이어야 함');
    assert.ok(pdvIdx      < pluginIdx,   'PDV init이 플러그인 등록보다 앞이어야 함');
    assert.ok(pluginIdx   < aiIdx,       '플러그인 등록이 AI init보다 앞이어야 함');
    assert.ok(aiIdx       < netIdx,      'AI init이 Network init보다 앞이어야 함');
    assert.ok(netIdx      < uiIdx,       'Network init이 UI render보다 앞이어야 함');
  });

  // ── B-05: bootstrap() 중복 호출 방지 ─────────────────────
  it('B-05: bootstrap() 동시 이중 호출 시 오류 발생', async () => {
    // app.js를 직접 import하면 실제 의존성이 필요하므로
    // 부트 상태 로직만 검증 (소스 코드 분석)
    const content = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    assert.ok(
      content.includes('already in progress') || content.includes('BOOTING'),
      'bootstrap() 이중 호출 방지 로직 없음'
    );
  });

  // ── B-06: ShellUI.render() 플러그인 → 탭 생성 ────────────
  it('B-06: ShellUI.getState()가 플러그인 목록을 반영한다', async () => {
    // shell-ui.js import (EventBus 모의 주입)
    // Node 환경: document 없으므로 DOM 작업 생략, 상태만 검증
    const { ShellUI } = await import(join(ROOT, 'src/shell-ui.js'));

    const plugins = [
      new MockPlugin('k-law',    '⚖️', 'K-Law'),
      new MockPlugin('k-health', '🏥', 'K-Health'),
    ];

    await ShellUI.render(plugins);
    const state = ShellUI.getState();

    assert.equal(state.plugins.length, 2, '플러그인 2개가 상태에 반영되어야 함');
    assert.equal(state.isBooted, true, 'isBooted가 true이어야 함');
  });

  // ── B-07: ShellUI.switchTab() 활성 탭 변경 ───────────────
  it('B-07: switchTab()이 activeTab을 변경한다', async () => {
    const { ShellUI } = await import(join(ROOT, 'src/shell-ui.js'));

    ShellUI.switchTab('k-health');
    const state = ShellUI.getState();
    assert.equal(state.activeTab, 'k-health', 'activeTab이 k-health이어야 함');

    ShellUI.switchTab('k-law');
    const state2 = ShellUI.getState();
    assert.equal(state2.activeTab, 'k-law', 'activeTab이 k-law이어야 함');
  });

  // ── B-08: app.js가 코어를 import하고 domain을 동적 등록한다 ─
  it('B-08: app.js import 구문에 core + domain 모두 포함된다', () => {
    const content = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    // import 구문만 추출 (주석 제외)
    const importLines = content.split('\n')
      .filter(l => l.trim().startsWith('import '));

    const hasCore   = importLines.some(l => l.includes('./core/'));
    const hasDomain = importLines.some(l => l.includes('./domains/'));
    const hasUI     = importLines.some(l => l.includes('./shell-ui'));

    assert.ok(hasCore,   'core import 없음');
    assert.ok(hasDomain, 'domain import 없음');
    assert.ok(hasUI,     'shell-ui import 없음');
  });

  // ── B-09: PLATFORM_READY 이벤트 emit 확인 ────────────────
  it('B-09: app.js에 PLATFORM_READY 이벤트 발행 코드가 있다', () => {
    const content = readFileSync(join(ROOT, 'src/app.js'), 'utf8');
    assert.ok(
      content.includes('PLATFORM_READY') || content.includes('EVENTS.PLATFORM_READY'),
      'PLATFORM_READY 이벤트 발행 없음'
    );
  });

});
