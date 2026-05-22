/**
 * shell-ui.js — Shell UI 렌더링 엔진
 * registry.list()로 자동 탭 생성 + 메신저 + 위험 배지
 */

import { EventBus } from './core/event-bus.js';
import { EVENTS }   from './core/constants.js';

// 위험 등급 → UI 매핑
const RISK_BADGE = {
  S0: { label: 'S0 안전',   color: '#27ae60', icon: '✅' },
  S1: { label: 'S1 주의',   color: '#f39c12', icon: '⚠️' },
  S2: { label: 'S2 경고',   color: '#e67e22', icon: '🚨' },
  S3: { label: 'S3 차단',   color: '#e74c3c', icon: '🛑' },
};

/** Shell UI 상태 */
const _state = {
  activeTab: null,
  plugins: [],
  messages: [],
  riskResult: null,
  openHashRef: null,
  gdcBalance: null,
  trustLevel: 'L1',
  isBooted: false,
};

/**
 * 플러그인 목록으로 탭 + 위젯 렌더링
 * @param {Array} plugins - registry.list() 결과
 */
async function render(plugins) {
  _state.plugins = plugins;
  _state.isBooted = true;

  // 브라우저 환경에서만 DOM 조작
  if (typeof document === 'undefined') {
    _subscribeEvents();
    return;
  }

  _renderDOM(plugins);
  _subscribeEvents();
}

/** DOM 렌더링 (브라우저 전용) */
function _renderDOM(plugins) {
  const root = document.getElementById('gopang-shell');
  if (!root) return;

  root.innerHTML = `
    <div class="shell-container">
      <!-- 도메인 탭 (registry에서 자동 생성) -->
      <nav class="tab-bar" id="tab-bar">
        ${plugins.map(p => `
          <button class="tab-btn" data-plugin="${p.name}" onclick="ShellUI.switchTab('${p.name}')">
            ${p.metadata?.icon || '🔌'} ${p.metadata?.label || p.name}
          </button>
        `).join('')}
        <button class="tab-btn tab-add" disabled>➕ 추가 예정</button>
      </nav>

      <!-- 메인 영역 -->
      <main class="shell-main">
        <!-- 메신저 + AI 비서 -->
        <section class="messenger-panel">
          <div class="message-list" id="message-list"></div>

          <!-- 위험 배지 영역 -->
          <div class="risk-badges" id="risk-badges">
            <span class="risk-badge s0">✅ S0 안전</span>
          </div>

          <!-- 입력 영역 -->
          <div class="input-area">
            <textarea id="msg-input" placeholder="메시지를 입력하세요..." rows="3"></textarea>
            <div class="input-actions">
              <button onclick="ShellUI.attachDoc()">📎 문서 첨부</button>
              <button class="btn-primary" onclick="ShellUI.sendMessage()">전송 ▶</button>
            </div>
          </div>
        </section>

        <!-- 플러그인 결과 패널 -->
        <aside class="result-panel" id="result-panel">
          <div class="legal-flags" id="legal-flags"></div>
        </aside>
      </main>

      <!-- 하단 상태 바 -->
      <footer class="status-bar">
        <span>🔐 PDV 암호화</span>
        <span>⛓️ OpenHash: <code id="hash-ref">대기중</code></span>
        <span id="layer-badge">L1</span>
        <span>💰 잔액: <span id="gdc-balance">-- GDC</span></span>
        <span>신뢰 등급: <span id="trust-level">L1</span></span>
        <button class="btn-evidence" id="btn-evidence" style="display:none"
                onclick="ShellUI.downloadEvidence()">
          ⚖️ 증거 패키지 다운로드
        </button>
      </footer>
    </div>
  `;

  // 첫 번째 탭 활성화
  if (plugins.length > 0) switchTab(plugins[0].name);
}

/** 이벤트 버스 구독 */
function _subscribeEvents() {
  // AI 비서 처리 완료
  EventBus.on(EVENTS.AI_RESULT, (result) => {
    _state.riskResult = result;
    _updateRiskBadges(result);
    _updateLegalFlags(result);

    // S3 시 증거 패키지 버튼 표시
    if (result.riskLevel === 'S3') {
      _showEvidenceButton();
    }
  });

  // OpenHash 앵커링 완료
  EventBus.on(EVENTS.HASH_ANCHORED, ({ ref }) => {
    _state.openHashRef = ref;
    const el = document.getElementById?.('hash-ref');
    if (el) el.textContent = ref.slice(0, 8) + '...';
  });

  // GDC 잔액 갱신
  EventBus.on(EVENTS.GDC_BALANCE_UPDATED, ({ balance, layer }) => {
    _state.gdcBalance = balance;
    _state.trustLevel = layer;
    const balEl = document.getElementById?.('gdc-balance');
    const trustEl = document.getElementById?.('trust-level');
    const layerEl = document.getElementById?.('layer-badge');
    if (balEl) balEl.textContent = `${balance} GDC`;
    if (trustEl) trustEl.textContent = layer;
    if (layerEl) layerEl.textContent = layer;
  });

  // 새 플러그인 hot-register
  EventBus.on(EVENTS.PLUGIN_REGISTERED, ({ plugin }) => {
    _state.plugins.push(plugin);
    _addTab(plugin);
  });
}

/** 탭 전환 */
function switchTab(pluginName) {
  _state.activeTab = pluginName;

  if (typeof document === 'undefined') return;

  document.querySelectorAll?.('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.plugin === pluginName);
  });

  const panel = document.getElementById?.('result-panel');
  if (panel) {
    panel.dataset.activePlugin = pluginName;
  }
}

/** 메시지 전송 (AI 비서 파이프라인 트리거) */
async function sendMessage() {
  if (typeof document === 'undefined') return;

  const input = document.getElementById?.('msg-input');
  const text = input?.value?.trim();
  if (!text) return;

  const msg = { text, timestamp: Date.now(), from: 'user' };
  _state.messages.push(msg);
  _appendMessage(msg);

  if (input) input.value = '';

  // AI 비서 파이프라인 트리거
  EventBus.emit(EVENTS.MESSAGE_RECEIVED, {
    text,
    activePlugin: _state.activeTab,
  });
}

/** 문서 첨부 */
async function attachDoc() {
  if (typeof document === 'undefined') return;

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,.jpg,.png,.txt,.docx';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (file) {
      EventBus.emit(EVENTS.DOC_ATTACHED, { file, activePlugin: _state.activeTab });
    }
  };
  input.click();
}

/** 증거 패키지 다운로드 */
async function downloadEvidence() {
  EventBus.emit(EVENTS.EVIDENCE_DOWNLOAD_REQUESTED, {
    riskResult: _state.riskResult,
    openHashRef: _state.openHashRef,
  });
}

// ── 내부 헬퍼 ──────────────────────────────────────────────

function _updateRiskBadges(result) {
  if (typeof document === 'undefined') return;

  const container = document.getElementById?.('risk-badges');
  if (!container) return;

  const badges = result.pluginResults?.map(pr => {
    const badge = RISK_BADGE[pr.riskLevel] || RISK_BADGE.S0;
    return `<span class="risk-badge" style="background:${badge.color}">
      ${badge.icon} ${badge.label} · ${pr.plugin} ${pr.pluginIcon || ''}
    </span>`;
  }) || [];

  container.innerHTML = badges.join('') ||
    `<span class="risk-badge s0">✅ S0 안전</span>`;
}

function _updateLegalFlags(result) {
  if (typeof document === 'undefined') return;

  const panel = document.getElementById?.('legal-flags');
  if (!panel) return;

  const flags = result.legalFlags || [];
  panel.innerHTML = flags.length
    ? `<ul>${flags.map(f => `<li class="flag-item">${f}</li>`).join('')}</ul>`
    : '<p class="no-flags">법령 위반 없음</p>';
}

function _showEvidenceButton() {
  const btn = document.getElementById?.('btn-evidence');
  if (btn) btn.style.display = 'inline-block';
}

function _appendMessage(msg) {
  const list = document.getElementById?.('message-list');
  if (!list) return;

  const el = document.createElement('div');
  el.className = `message message-${msg.from}`;
  el.textContent = msg.text;
  list.appendChild(el);
  list.scrollTop = list.scrollHeight;
}

function _addTab(plugin) {
  if (typeof document === 'undefined') return;

  const tabBar = document.getElementById?.('tab-bar');
  if (!tabBar) return;

  const btn = document.createElement('button');
  btn.className = 'tab-btn';
  btn.dataset.plugin = plugin.name;
  btn.textContent = `${plugin.metadata?.icon || '🔌'} ${plugin.metadata?.label || plugin.name}`;
  btn.onclick = () => switchTab(plugin.name);
  tabBar.insertBefore(btn, tabBar.lastElementChild);
}

/** 현재 UI 상태 조회 (테스트용) */
function getState() { return { ..._state }; }

export const ShellUI = {
  render,
  switchTab,
  sendMessage,
  attachDoc,
  downloadEvidence,
  getState,
};

// 브라우저 전역 노출 (onclick 핸들러용)
if (typeof window !== 'undefined') {
  window.ShellUI = ShellUI;
}
