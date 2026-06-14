import re, pathlib

html = pathlib.Path('webapp.html').read_text(encoding='utf-8')

# ── L-A. gopangLogout() 교체 ─────────────────────────────
OLD_LOGOUT = """function gopangLogout() {
  if (!confirm('로그아웃 하시겠습니까?\\n(아이디·설정이 초기화됩니다)')) return;
  localStorage.clear();
  sessionStorage.clear();
  caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
    .finally(() => location.reload());
}"""

NEW_LOGOUT = """async function gopangLogout() {
  if (!confirm('로그아웃 하시겠습니까?\\n(아이디·설정이 초기화됩니다)')) return;
  // [L-A] L1에서 fpHex 무효화 (타인 도용 방지)
  try {
    const stored = JSON.parse(localStorage.getItem('gopang_user_v3') || 'null');
    if (stored?.fpHex) {
      const L1_URL = 'https://l1-hanlim.gopang.net/api/collections/profiles/records';
      const filter = encodeURIComponent(`fpHex='${stored.fpHex}'`);
      const res = await fetch(`${L1_URL}?filter=${filter}&perPage=1`);
      if (res.ok) {
        const data = await res.json();
        const id = data.items?.[0]?.id;
        if (id) {
          await fetch(`${L1_URL}/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fpHex: null })
          });
        }
      }
    }
  } catch(e) { console.warn('[Logout] L1 fpHex 무효화 실패:', e.message); }
  localStorage.clear();
  sessionStorage.clear();
  caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
    .finally(() => location.reload());
}"""

if OLD_LOGOUT in html:
    html = html.replace(OLD_LOGOUT, NEW_LOGOUT, 1)
    print('✅ gopangLogout() 교체 완료')
else:
    print('❌ gopangLogout() 패턴 불일치 — 수동 확인 필요')

# ── 3-B/4-B/5-B. 설정 패널 HTML 교체 ────────────────────
OLD_SETTINGS = """    <button id="btn-logout-or-login" onclick="_settingsLogoutOrLogin()"
      style="width:calc(100% - 32px);margin:0 16px 8px;padding:12px;background:transparent;border:1px solid #fca5a5;border-radius:10px;color:#dc2626;font-size:14px;font-family:inherit;cursor:pointer">
      🚪 로그아웃
    </button>
    <button onclick="clearSWCache()"
      style="width:calc(100% - 32px);margin:0 16px 16px;padding:12px;background:transparent;border:1px solid #e5e7eb;border-radius:10px;color:#9ca3af;font-size:13px;font-family:inherit;cursor:pointer">
      🗑 앱 캐시 초기화
    </button>
  </div>
</div>"""

NEW_SETTINGS = """    <!-- GDC Wallet 섹션 (GDC 사용자만) -->
    <div class="setting-group" id="gdc-wallet-section" style="display:none;margin-top:8px">
      <label class="setting-label">💰 GDC Wallet</label>
      <div id="gdc-balance-display" style="font-size:14px;color:var(--green,#16a34a);margin-bottom:8px">잔액: — GDC</div>
      <button onclick="_openGDCWallet()"
        style="width:100%;padding:10px;border-radius:10px;background:transparent;border:1px solid var(--green,#16a34a);color:var(--green,#16a34a);font-size:13px;font-family:inherit;cursor:pointer">
        Wallet 관리 →
      </button>
    </div>

    <!-- AI 설정 버튼 (등록 사용자만) -->
    <button id="btn-ai-settings" onclick="openAISettings()"
      style="display:none;width:calc(100% - 32px);margin:8px 16px 0;padding:12px;background:var(--green,#16a34a);border:none;border-radius:10px;color:#fff;font-size:14px;font-weight:600;font-family:inherit;cursor:pointer">
      ⚙️ AI 설정
    </button>

    <!-- 로그아웃 (등록 사용자만) -->
    <button id="btn-logout-or-login" onclick="_settingsLogoutOrLogin()"
      style="display:none;width:calc(100% - 32px);margin:8px 16px 0;padding:12px;background:transparent;border:1px solid #fca5a5;border-radius:10px;color:#dc2626;font-size:14px;font-family:inherit;cursor:pointer">
      🚪 로그아웃
    </button>

    <!-- 기기 완전 초기화 (등록 사용자만) -->
    <button id="btn-device-reset" onclick="_deviceFullReset()"
      style="display:none;width:calc(100% - 32px);margin:8px 16px 0;padding:12px;background:transparent;border:1px solid #fca5a5;border-radius:10px;color:#9ca3af;font-size:12px;font-family:inherit;cursor:pointer">
      ⚠️ 기기 완전 초기화 (판매·양도 전 실행)
    </button>

    <!-- 앱 캐시 초기화 (항상) -->
    <button onclick="clearSWCache()"
      style="width:calc(100% - 32px);margin:8px 16px 16px;padding:12px;background:transparent;border:1px solid #e5e7eb;border-radius:10px;color:#9ca3af;font-size:13px;font-family:inherit;cursor:pointer">
      🗑 앱 캐시 초기화
    </button>
  </div>
</div>

<!-- AI 설정 슬라이드 패널 -->
<div class="settings-overlay" id="ai-settings-overlay" onclick="handleAISettingsOverlayClick(event)">
  <div class="settings-sheet">
    <div class="sheet-handle"></div>
    <div class="sheet-title" style="display:flex;align-items:center;gap:8px">
      <button onclick="closeAISettings()"
        style="background:none;border:none;font-size:20px;cursor:pointer;padding:0;line-height:1">←</button>
      <span>AI 설정</span>
    </div>
    <div class="setting-group">
      <label class="setting-label">LLM 모델</label>
      <select class="setting-field" id="setting-model">
        <option value="deepseek-v4-pro" selected>DeepSeek V4 Pro ✦ 이미지 지원</option>
        <option value="deepseek-v4-flash">DeepSeek V4 Flash ✦ 이미지 지원 (빠름)</option>
        <option value="deepseek-chat">DeepSeek V3 (텍스트 전용)</option>
        <option value="deepseek-reasoner">DeepSeek R1 (추론)</option>
        <option value="gpt-4o">GPT-4o ✦ 이미지 지원</option>
        <option value="claude-sonnet-4-20250514">Claude Sonnet 4 ✦ 이미지 지원</option>
        <option value="gemini-2.0-flash">Gemini 2.0 Flash ✦ 이미지 지원</option>
      </select>
    </div>
    <div class="setting-group">
      <label class="setting-label">API 엔드포인트</label>
      <select class="setting-field" id="setting-endpoint">
        <option value="https://gopang-proxy.tensor-city.workers.dev" selected>고팡 프록시 (보안 권장)</option>
        <option value="https://api.deepseek.com/v1">DeepSeek API (직접)</option>
        <option value="https://api.openai.com/v1">OpenAI API</option>
        <option value="https://api.anthropic.com/v1">Anthropic API</option>
        <option value="custom">직접 입력</option>
      </select>
    </div>
    <div class="setting-group" id="custom-endpoint-group" style="display:none">
      <label class="setting-label">커스텀 엔드포인트 URL</label>
      <input class="setting-field setting-field-mono" id="custom-endpoint-url" type="text" placeholder="https://...">
    </div>
    <div class="setting-group">
      <label class="setting-label">API Key (DeepSeek 직접 사용 시)</label>
      <input class="setting-field setting-field-mono" id="setting-apikey" type="password" placeholder="sk-…" autocomplete="off" spellcheck="false">
    </div>
    <div class="setting-group">
      <label class="setting-label">Gemini API Key (이미지 분석용)</label>
      <input class="setting-field setting-field-mono" id="setting-gemini-key" type="password" placeholder="AIza…" autocomplete="off" spellcheck="false">
      <div style="font-size:11px;color:var(--txt3);margin-top:4px">K-Cleaner 이미지 분석에 사용 · <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color:var(--green-dk)">무료 발급 →</a></div>
    </div>
    <div class="setting-group">
      <label class="setting-label">시스템 프롬프트</label>
      <textarea class="setting-field" id="setting-system" rows="4" style="resize:vertical;font-size:13px;line-height:1.5" placeholder="AI 비서의 역할과 동작 방식을 정의하세요…"></textarea>
    </div>
    <div class="settings-sep"></div>
    <button class="sheet-save" onclick="saveSettings()">저장</button>
  </div>
</div>"""

if OLD_SETTINGS in html:
    html = html.replace(OLD_SETTINGS, NEW_SETTINGS, 1)
    print('✅ 설정 패널 HTML 교체 완료')
else:
    print('❌ 설정 패널 HTML 패턴 불일치 — 수동 확인 필요')

pathlib.Path('webapp.html').write_text(html, encoding='utf-8')
print('✅ webapp.html 저장 완료')
