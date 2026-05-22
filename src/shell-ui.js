/**
 * shell-ui.js — Shell UI 렌더링 엔진 v3
 *
 * BUG-011 수정: 실제 EVENTS 키(MSG_RISK_ASSESSED 등)로 전면 교체
 */

import { EventBus, EVENTS } from './core/event-bus.js'

const RISK_BADGE = {
  S0: { label: 'S0 안전', color: '#27ae60', icon: '✅' },
  S1: { label: 'S1 주의', color: '#f39c12', icon: '⚠️' },
  S2: { label: 'S2 경고', color: '#e67e22', icon: '🚨' },
  S3: { label: 'S3 차단', color: '#e74c3c', icon: '🛑' },
}

const _state = {
  activeTab: null,
  plugins: [],
  messages: [],
  lastResult: null,
  openHashRef: null,
  isBooted: false,
}

// ── 렌더링 ───────────────────────────────────────────────────

async function render(plugins) {
  _state.plugins = plugins || []
  _state.isBooted = true
  if (typeof document !== 'undefined') _renderDOM(_state.plugins)
  _subscribeEvents()
}

function _renderDOM(plugins) {
  const root = document.getElementById('gopang-shell')
  if (!root) return

  root.innerHTML = `
    <div class="shell-container">
      <nav class="tab-bar" id="tab-bar">
        ${plugins.map(p => `
          <button class="tab-btn" data-plugin="${p.name}"
                  onclick="ShellUI.switchTab('${p.name}')">
            ${p.icon || '🔌'} ${p.displayName || p.name}
          </button>
        `).join('')}
        <button class="tab-btn tab-add" disabled>➕ 추가 예정</button>
      </nav>

      <main class="shell-main">
        <section class="messenger-panel">
          <div class="message-list" id="message-list"></div>

          <div class="risk-badges" id="risk-badges">
            <span class="risk-badge" style="background:#27ae60">✅ S0 안전</span>
          </div>

          <div class="input-area">
            <textarea id="msg-input" placeholder="메시지를 입력하세요..." rows="3"></textarea>
            <div class="input-actions">
              <button onclick="ShellUI.attachDoc()">📎 문서 첨부</button>
              <button class="btn-primary" onclick="ShellUI.sendMessage()">전송 ▶</button>
            </div>
          </div>
        </section>

        <aside class="result-panel" id="result-panel">
          <h3>법령 플래그</h3>
          <div class="legal-flags" id="legal-flags">
            <p class="no-flags">법령 위반 없음</p>
          </div>
        </aside>
      </main>

      <footer class="status-bar">
        <span>🔐 PDV 암호화</span>
        <span>⛓️ OpenHash: <code id="hash-ref">대기중</code></span>
        <span id="layer-badge">L1</span>
        <span>💰 잔액: <span id="gdc-balance">-- GDC</span></span>
        <button class="btn-evidence" id="btn-evidence" style="display:none"
                onclick="ShellUI.downloadEvidence()">
          ⚖️ 증거 패키지 다운로드
        </button>
      </footer>
    </div>
  `

  if (plugins.length > 0) switchTab(plugins[0].name)
}

// ── 이벤트 구독 ──────────────────────────────────────────────

function _subscribeEvents() {
  // AI 파이프라인 결과 수신 (실제 이벤트 키: MSG_RISK_ASSESSED)
  EventBus.on(EVENTS.MSG_RISK_ASSESSED, (data) => {
    if (!data?.riskResult) return
    _state.lastResult = data

    // OpenHash ref 표시
    if (data.anchorHash) {
      _state.openHashRef = data.anchorHash
      const el = document.getElementById?.('hash-ref')
      if (el) el.textContent = data.anchorHash.slice(0, 8) + '...'
    }

    // 레이어 표시
    if (data.layer) {
      const el = document.getElementById?.('layer-badge')
      if (el) el.textContent = data.layer
    }

    _updateRiskBadges(data.riskResult)
    _updateLegalFlags(data.riskResult)

    if (data.riskResult.level === 'S3') _showEvidenceButton()
  }, 'shell-ui')

  // 새 플러그인 hot-register
  EventBus.on(EVENTS.PLUGIN_REGISTERED, (data) => {
    if (!data?.name) return
    const pluginMeta = { name: data.name, displayName: data.displayName, icon: '🔌' }
    _state.plugins.push(pluginMeta)
    _addTab(pluginMeta)
  }, 'shell-ui')

  // S3 차단 이벤트
  EventBus.on(EVENTS.MSG_BLOCKED, (data) => {
    _showEvidenceButton()
    const list = document.getElementById?.('message-list')
    if (list && data?.reason) {
      const el = document.createElement('div')
      el.className = 'message message-blocked'
      el.textContent = `🛑 차단: ${data.reason}`
      list.appendChild(el)
    }
  }, 'shell-ui')
}

// ── 사용자 액션 ──────────────────────────────────────────────

function switchTab(pluginName) {
  _state.activeTab = pluginName
  if (typeof document === 'undefined') return
  document.querySelectorAll?.('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.plugin === pluginName)
  })
}

async function sendMessage() {
  if (typeof document === 'undefined') return
  const input = document.getElementById?.('msg-input')
  const text  = input?.value?.trim()
  if (!text) return

  _appendMessage({ text, from: 'user' })
  if (input) input.value = ''

  // 실제 이벤트 키: MSG_RECEIVED (pipeline.js가 구독)
  EventBus.emit(EVENTS.MSG_RECEIVED, {
    text,
    activePlugin: _state.activeTab,
    senderId: 'user',
  }, 'shell-ui')
}

async function attachDoc() {
  if (typeof document === 'undefined') return
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.pdf,.jpg,.png,.txt,.docx'
  input.onchange = (e) => {
    const file = e.target.files[0]
    if (file) {
      EventBus.emit(EVENTS.MSG_RECEIVED, {
        text: `[첨부파일: ${file.name}]`,
        file,
        activePlugin: _state.activeTab,
        senderId: 'user',
      }, 'shell-ui')
    }
  }
  input.click()
}

async function downloadEvidence() {
  const result = _state.lastResult
  if (!result) return

  const pkg = {
    msgId:      result.msgId,
    anchorHash: result.anchorHash,
    layer:      result.layer,
    riskResult: result.riskResult,
    exportedAt: new Date().toISOString(),
  }

  const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `evidence_${result.msgId?.slice(0, 8) ?? 'gopang'}.json`
  a.click()
  URL.revokeObjectURL(url)
}

// ── 내부 헬퍼 ────────────────────────────────────────────────

function _updateRiskBadges(riskResult) {
  const container = document.getElementById?.('risk-badges')
  if (!container) return

  const level = riskResult.level || 'S0'
  const badge = RISK_BADGE[level] || RISK_BADGE.S0
  const flags = (riskResult.legalFlags || []).join(', ')

  container.innerHTML = `
    <span class="risk-badge" style="background:${badge.color}">
      ${badge.icon} ${badge.label}${flags ? ' · ' + flags : ''}
    </span>
  `
}

function _updateLegalFlags(riskResult) {
  const panel = document.getElementById?.('legal-flags')
  if (!panel) return
  const flags = riskResult.legalFlags || []
  panel.innerHTML = flags.length
    ? `<ul>${flags.map(f => `<li class="flag-item">${f}</li>`).join('')}</ul>`
    : '<p class="no-flags">법령 위반 없음</p>'
}

function _showEvidenceButton() {
  const btn = document.getElementById?.('btn-evidence')
  if (btn) btn.style.display = 'inline-block'
}

function _appendMessage(msg) {
  const list = document.getElementById?.('message-list')
  if (!list) return
  const el = document.createElement('div')
  el.className = `message message-${msg.from}`
  el.textContent = msg.text
  list.appendChild(el)
  list.scrollTop = list.scrollHeight
}

function _addTab(plugin) {
  const tabBar = document.getElementById?.('tab-bar')
  if (!tabBar) return
  const btn = document.createElement('button')
  btn.className = 'tab-btn'
  btn.dataset.plugin = plugin.name
  btn.textContent = `${plugin.icon || '🔌'} ${plugin.displayName || plugin.name}`
  btn.onclick = () => switchTab(plugin.name)
  tabBar.insertBefore(btn, tabBar.lastElementChild)
}

function getState() { return { ..._state } }

export const ShellUI = { render, switchTab, sendMessage, attachDoc, downloadEvidence, getState }

if (typeof window !== 'undefined') window.ShellUI = ShellUI
