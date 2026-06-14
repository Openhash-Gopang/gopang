import re, pathlib

html = pathlib.Path('webapp.html').read_text(encoding='utf-8')

# ── CSS 교체 ──────────────────────────────────────────────
OLD_CSS = '''.settings-panel,.settings-overlay-wrap{
  position:fixed;inset:0;z-index:999;display:flex;justify-content:flex-end;
  visibility:hidden;
}
.settings-panel.open,.settings-overlay-wrap.open{visibility:visible}
/* 반투명 배경 */
.settings-bg,.settings-overlay{
  flex:1;background:rgba(0,0,0,.3);
  opacity:0;transition:opacity .25s;cursor:pointer;
}
.settings-panel.open .settings-bg,
.settings-overlay-wrap.open .settings-overlay{opacity:1}
/* 드로어 */
.settings-drawer,.settings-sheet{
  width:88%;max-width:340px;background:#fff;height:100%;
  display:flex;flex-direction:column;
  transform:translateX(100%);transition:transform .25s;
  box-shadow:-4px 0 24px rgba(0,0,0,.12);overflow-y:auto;
}
.settings-panel.open .settings-drawer,
.settings-overlay-wrap.open .settings-sheet{transform:translateX(0)}
/* 헤더 */
.settings-head,.sheet-title{
  display:flex;align-items:center;justify-content:space-between;
  padding:calc(var(--safe-t)+14px) 16px 14px;
  border-bottom:1px solid var(--border);flex-shrink:0;
  font-size:15px;font-weight:800;color:#111;
}
.sheet-title{padding:16px;font-size:15px;font-weight:800}
.sheet-handle{width:36px;height:4px;background:var(--border);border-radius:2px;
  margin:10px auto 4px;}
.settings-close{background:none;border:none;cursor:pointer;padding:4px;
  display:flex;align-items:center;justify-content:center;border-radius:6px}
.settings-close:hover{background:var(--chip-bg)}
.settings-close svg{width:18px;height:18px;stroke:#6b7280;stroke-width:2;fill:none;
  stroke-linecap:round;stroke-linejoin:round}
/* 바디 */
.settings-body{flex:1;overflow-y:auto;padding:12px 0}
.settings-section,.setting-group{padding:8px 16px 12px}
.settings-section-title,.setting-label{
  font-size:11px;font-weight:700;color:var(--txt3);
  text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;display:block;
}'''

NEW_CSS = '''.settings-panel,.settings-overlay-wrap{
  position:fixed;inset:0;z-index:999;display:flex;justify-content:flex-end;
  visibility:hidden;
}
.settings-panel.open,.settings-overlay-wrap.open{visibility:visible}
.settings-bg,.settings-overlay{
  flex:1;background:rgba(0,0,0,.25);
  opacity:0;transition:opacity .25s;cursor:pointer;
}
.settings-panel.open .settings-bg,
.settings-overlay-wrap.open .settings-overlay{opacity:1}
.settings-drawer,.settings-sheet{
  width:92%;max-width:360px;background:#fff;height:100%;
  display:flex;flex-direction:column;
  transform:translateX(100%);transition:transform .28s cubic-bezier(.4,0,.2,1);
  overflow-y:auto;
}
.settings-panel.open .settings-drawer,
.settings-overlay-wrap.open .settings-sheet{transform:translateX(0)}
.settings-head,.sheet-title{
  display:flex;align-items:center;justify-content:space-between;
  padding:calc(var(--safe-t)+18px) 20px 18px;
  border-bottom:1px solid #f3f4f6;flex-shrink:0;
  font-size:16px;font-weight:700;color:#111827;letter-spacing:-0.3px;
}
.sheet-title{padding:20px;font-size:16px;font-weight:700;color:#111827}
.sheet-handle{width:32px;height:3px;background:#e5e7eb;border-radius:2px;
  margin:12px auto 2px;}
.settings-close{background:none;border:none;cursor:pointer;padding:4px;
  display:flex;align-items:center;justify-content:center;border-radius:6px}
.settings-close svg{width:18px;height:18px;stroke:#9ca3af;stroke-width:2;fill:none;
  stroke-linecap:round;stroke-linejoin:round}
.settings-body{flex:1;overflow-y:auto;padding:8px 0 32px}
.settings-section,.setting-group{padding:8px 20px 14px}
.settings-section-title,.setting-label{
  font-size:11px;font-weight:600;color:#9ca3af;
  text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px;display:block;
}'''

if OLD_CSS in html:
    html = html.replace(OLD_CSS, NEW_CSS, 1)
    print('✅ CSS 교체 완료')
else:
    print('❌ CSS 패턴 불일치')

# ── 설정 HTML 교체 ────────────────────────────────────────
OLD_HTML = '''<div class="settings-overlay" id="settings-overlay" onclick="handleOverlayClick(event)">
  <div class="settings-sheet">
    <div class="sheet-handle"></div>
    <div class="sheet-title">설정</div>

    <div id="perm-guide">
      <div style="font-weight:700;font-size:13px;margin-bottom:10px">📱 스마트폰 권한 설정 안내</div>
      <details style="margin-bottom:10px">
        <summary style="cursor:pointer;font-weight:600;color:var(--green-dk);outline:none">🤖 Android (크롬 브라우저)</summary>
        <div style="margin-top:8px;padding-left:4px;color:var(--txt2);font-size:12px;line-height:1.7">
          <b style="color:#111">① 크롬에서 접속 시</b><br>상단 우측 ⋮ 터치 → 아래로 스크롤 → <b>사이트 설정</b> 터치<br>→ <b>위치·카메라·마이크</b> 각각 → <b>허용</b><br><br>
          <b style="color:#111">② 고팡 앱(홈 화면) 사용 시</b><br>Android 설정 → 앱 → Chrome → 권한 → 위치: <b>앱 사용 중 허용</b>
        </div>
      </details>
      <details>
        <summary style="cursor:pointer;font-weight:600;color:var(--green-dk);outline:none">🍎 iPhone / iPad (Safari)</summary>
        <div style="margin-top:8px;padding-left:4px;color:var(--txt2);font-size:12px;line-height:1.7">
          <b style="color:#111">① Safari에서 접속 시</b><br>주소창 왼쪽 <b>AA 아이콘</b> 탭 → 웹사이트 설정 → 위치·마이크: <b>허용</b><br><br>
          <b style="color:#f59e0b">⚠️ 음성 입력 안내</b><br>iOS Safari는 Web Speech API 미지원. 마이크 녹음 후 자동 변환 방식으로 동작합니다.
        </div>
      </details>
    </div>

    <div id="llm-settings-section" style="display:none">
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
    </div><!-- /llm-settings-section -->

    <!-- 고팡 아이디 — Guest/등록 사용자 모두 표시 -->
    <div class="setting-group" id="gopang-id-section" style="margin-top:4px">
      <label class="setting-label">👤 고팡 아이디</label>
      <div id="gopang-id-status" style="margin-bottom:10px;font-size:13px;color:var(--txt2)">로딩 중…</div>
      <div id="gopang-id-register-box">
        <input class="setting-field" id="gopang-id-input" type="text" maxlength="20"
          placeholder="표시될 이름" style="margin-bottom:8px">
        <button id="gopang-id-register-btn" onclick="_settingsRegisterHandle()"
          style="width:100%;padding:11px;border-radius:10px;background:var(--green,#16a34a);color:#fff;border:none;font-size:14px;font-weight:600;cursor:pointer">
          아이디 등록
        </button>
      </div>
    </div>

    <div class="setting-group" style="margin-top:8px" id="security-section">
      <label class="setting-label">🔐 보안 · 인증</label>

      <div id="gopang-id-display" style="font-size:10px;color:var(--txt3);font-family:monospace;word-break:break-all;padding:8px 0"></div>
    </div>

    <!-- GDC Wallet 섹션 (GDC 사용자만) -->
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
</div>'''

NEW_HTML = '''<div class="settings-overlay" id="settings-overlay" onclick="handleOverlayClick(event)">
  <div class="settings-sheet">
    <div class="sheet-handle"></div>
    <div class="sheet-title">설정</div>

    <!-- 고팡 아이디 -->
    <div id="gopang-id-section" style="padding:20px;border-bottom:1px solid #f3f4f6">
      <div style="font-size:11px;font-weight:600;color:#9ca3af;letter-spacing:.6px;
                  text-transform:uppercase;margin-bottom:12px">계정</div>
      <div id="gopang-id-status" style="font-size:14px;color:#111827;margin-bottom:12px">로딩 중…</div>
      <div id="gopang-id-register-box">
        <input class="setting-field" id="gopang-id-input" type="text" maxlength="20"
          placeholder="표시될 이름"
          style="margin-bottom:10px;border-radius:8px;border:1px solid #e5e7eb;
                 padding:10px 12px;font-size:14px;width:100%;box-sizing:border-box;
                 font-family:inherit;outline:none">
        <button id="gopang-id-register-btn" onclick="_settingsRegisterHandle()"
          style="width:100%;padding:11px;border-radius:8px;background:#16a34a;
                 color:#fff;border:none;font-size:14px;font-weight:600;
                 cursor:pointer;font-family:inherit">
          아이디 등록
        </button>
      </div>
      <div id="gopang-id-display" style="font-size:11px;color:#9ca3af;
           font-family:monospace;word-break:break-all;margin-top:4px"></div>
    </div>

    <!-- GDC Wallet (GDC 사용자만) -->
    <div id="gdc-wallet-section" style="display:none;padding:20px;border-bottom:1px solid #f3f4f6">
      <div style="font-size:11px;font-weight:600;color:#9ca3af;letter-spacing:.6px;
                  text-transform:uppercase;margin-bottom:12px">GDC Wallet</div>
      <div id="gdc-balance-display" style="font-size:20px;font-weight:600;
           color:#111827;margin-bottom:12px">— GDC</div>
      <button onclick="_openGDCWallet()"
        style="width:100%;padding:10px;border-radius:8px;background:transparent;
               border:1px solid #16a34a;color:#16a34a;font-size:14px;
               font-family:inherit;cursor:pointer;font-weight:500">
        Wallet 관리
      </button>
    </div>

    <!-- 권한 안내 -->
    <div id="perm-guide" style="padding:20px;border-bottom:1px solid #f3f4f6">
      <div style="font-size:11px;font-weight:600;color:#9ca3af;letter-spacing:.6px;
                  text-transform:uppercase;margin-bottom:12px">권한 설정</div>
      <details style="margin-bottom:8px">
        <summary style="cursor:pointer;font-size:13px;font-weight:500;
                        color:#374151;outline:none;list-style:none;
                        display:flex;align-items:center;gap:6px">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="5" y="2" width="14" height="20" rx="2"/>
            <line x1="12" y1="18" x2="12" y2="18"/>
          </svg>
          Android
        </summary>
        <div style="margin-top:10px;padding:12px;background:#f9fafb;border-radius:8px;
                    color:#6b7280;font-size:12px;line-height:1.7">
          크롬 ⋮ → 사이트 설정 → <b style="color:#111827">위치·카메라·마이크 허용</b>
        </div>
      </details>
      <details>
        <summary style="cursor:pointer;font-size:13px;font-weight:500;
                        color:#374151;outline:none;list-style:none;
                        display:flex;align-items:center;gap:6px">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="5" y="2" width="14" height="20" rx="2"/>
            <line x1="12" y1="18" x2="12" y2="18"/>
          </svg>
          iPhone / iPad
        </summary>
        <div style="margin-top:10px;padding:12px;background:#f9fafb;border-radius:8px;
                    color:#6b7280;font-size:12px;line-height:1.7">
          AA 아이콘 → 웹사이트 설정 → <b style="color:#111827">위치·마이크 허용</b><br>
          <span style="color:#9ca3af">iOS Safari는 Web Speech API 미지원 — 녹음 후 자동 변환</span>
        </div>
      </details>
    </div>

    <!-- 액션 버튼 그룹 -->
    <div style="padding:20px;display:flex;flex-direction:column;gap:8px">

      <!-- AI 설정 (등록 사용자만) -->
      <button id="btn-ai-settings" onclick="openAISettings()"
        style="display:none;width:100%;padding:12px;border-radius:8px;
               background:#16a34a;border:none;color:#fff;
               font-size:14px;font-weight:600;font-family:inherit;
               cursor:pointer;text-align:left;display:none;
               align-items:center;gap:8px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
        </svg>
        AI 설정
      </button>

      <!-- 로그아웃 (등록 사용자만) -->
      <button id="btn-logout-or-login" onclick="_settingsLogoutOrLogin()"
        style="display:none;width:100%;padding:12px;border-radius:8px;
               background:transparent;border:1px solid #fecaca;
               color:#dc2626;font-size:14px;font-family:inherit;cursor:pointer;
               text-align:left;display:none;align-items:center;gap:8px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
          <polyline points="16 17 21 12 16 7"/>
          <line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
        로그아웃
      </button>

      <!-- 기기 완전 초기화 (등록 사용자만) -->
      <button id="btn-device-reset" onclick="_deviceFullReset()"
        style="display:none;width:100%;padding:12px;border-radius:8px;
               background:transparent;border:1px solid #f3f4f6;
               color:#9ca3af;font-size:12px;font-family:inherit;cursor:pointer;
               text-align:left;display:none;align-items:center;gap:8px">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14H6L5 6"/>
          <path d="M10 11v6M14 11v6"/>
        </svg>
        기기 완전 초기화 (판매·양도 전 실행)
      </button>

      <!-- 앱 캐시 초기화 (항상) -->
      <button onclick="clearSWCache()"
        style="width:100%;padding:12px;border-radius:8px;
               background:transparent;border:1px solid #f3f4f6;
               color:#9ca3af;font-size:13px;font-family:inherit;cursor:pointer;
               text-align:left;display:flex;align-items:center;gap:8px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14H6L5 6"/>
        </svg>
        앱 캐시 초기화
      </button>

    </div>

    <!-- llm-settings-section (숨김 유지, AI 설정 패널로 이동) -->
    <div id="llm-settings-section" style="display:none"></div>
    <div id="security-section" style="display:none"></div>

  </div>
</div>'''

if OLD_HTML in html:
    html = html.replace(OLD_HTML, NEW_HTML, 1)
    print('✅ 설정 HTML 교체 완료')
else:
    print('❌ 설정 HTML 패턴 불일치')

pathlib.Path('webapp.html').write_text(html, encoding='utf-8')
print('✅ webapp.html 저장 완료')
