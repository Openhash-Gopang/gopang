import pathlib

html = pathlib.Path('webapp.html').read_text(encoding='utf-8')

OLD_POPUP = '''  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:40px 28px;
                width:100%;max-width:360px;box-sizing:border-box;text-align:center;">
      <svg width="36" height="36" viewBox="0 0 36 36" fill="none"
           style="margin-bottom:20px" xmlns="http://www.w3.org/2000/svg">
        <circle cx="18" cy="18" r="17" stroke="#16a34a" stroke-width="2"/>
        <text x="18" y="23" text-anchor="middle"
              font-size="14" font-weight="700" fill="#16a34a">고팡</text>
      </svg>
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#111827;
                 letter-spacing:-0.5px">고팡에 오신 것을<br>환영합니다</h2>
      <p style="margin:0 0 28px;font-size:14px;color:#6b7280;line-height:1.6">
        시작 방법을 선택해 주세요
      </p>

      <!-- Sign-in: 아이디 입력 -->
      <div style="margin-bottom:10px">
        <div style="display:flex;gap:8px">
          <input id="_signin-handle" type="text"
            placeholder="고팡 아이디 (예: @금능#0996)"
            style="flex:1;padding:12px 14px;border:1px solid #e5e7eb;border-radius:10px;
                   font-size:14px;font-family:inherit;outline:none;box-sizing:border-box"
            autocomplete="off" autocorrect="off" spellcheck="false"/>
          <button id="_signin-btn"
            style="padding:12px 16px;border-radius:10px;background:#16a34a;
                   color:#fff;border:none;font-size:14px;font-weight:600;
                   font-family:inherit;cursor:pointer;white-space:nowrap">
            로그인
          </button>
        </div>
        <div id="_signin-error" style="display:none;font-size:12px;color:#dc2626;
             margin-top:6px;text-align:left"></div>
      </div>

      <div style="display:flex;align-items:center;gap:10px;margin:16px 0">
        <div style="flex:1;height:1px;background:#e5e7eb"></div>
        <span style="font-size:12px;color:#9ca3af">또는</span>
        <div style="flex:1;height:1px;background:#e5e7eb"></div>
      </div>

      <!-- Sign-up -->
      <button id="_signup-btn"
        style="width:100%;padding:13px;border-radius:10px;
               background:#f9fafb;border:1px solid #e5e7eb;
               color:#111827;font-size:15px;font-weight:500;
               font-family:inherit;cursor:pointer;margin-bottom:10px">
        새 아이디 만들기
      </button>

      <!-- 익명 모드 -->
      <button id="_anon-btn"
        style="width:100%;padding:12px;border-radius:10px;
               background:transparent;border:none;
               color:#9ca3af;font-size:14px;font-family:inherit;cursor:pointer">
        익명 모드
      </button>
      <p style="margin:12px 0 0;font-size:11px;color:#9ca3af;line-height:1.5">
        익명 모드는 기록이 저장되지 않습니다
      </p>
    </div>`;'''

NEW_POPUP = '''  overlay.innerHTML = `
    <div style="background:#fff;border-radius:20px;padding:32px 24px;
                width:100%;max-width:340px;box-sizing:border-box;">

      <!-- Sign-in: 아이디 입력 -->
      <div style="margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:0;
                    border:1px solid #e5e7eb;border-radius:12px;
                    background:#f9fafb;overflow:hidden">
          <div style="padding:0 14px;display:flex;align-items:center;
                      border-right:1px solid #e5e7eb;height:48px;flex-shrink:0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                 stroke="#9ca3af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          </div>
          <input id="_signin-handle" type="text"
            placeholder="고팡 아이디  예: @금능#0996"
            style="flex:1;padding:0 12px;height:48px;border:none;background:transparent;
                   font-size:14px;font-family:inherit;outline:none;color:#111827;
                   min-width:0"
            autocomplete="off" autocorrect="off" spellcheck="false"/>
          <button id="_signin-mic"
            style="padding:0 12px;height:48px;border:none;background:transparent;
                   cursor:pointer;display:flex;align-items:center;
                   border-left:1px solid #e5e7eb;flex-shrink:0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="#9ca3af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="2" width="6" height="11" rx="3"/>
              <path d="M5 10a7 7 0 0 0 14 0"/>
              <line x1="12" y1="19" x2="12" y2="22"/>
              <line x1="8" y1="22" x2="16" y2="22"/>
            </svg>
          </button>
          <button id="_signin-btn"
            style="padding:0 14px;height:48px;border:none;background:transparent;
                   cursor:pointer;display:flex;align-items:center;
                   border-left:1px solid #e5e7eb;flex-shrink:0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                 stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
        <div id="_signin-error" style="display:none;font-size:12px;color:#dc2626;
             margin-top:6px;padding:0 4px"></div>
      </div>

      <!-- 구분선 -->
      <div style="display:flex;align-items:center;gap:10px;margin:16px 0">
        <div style="flex:1;height:1px;background:#f3f4f6"></div>
        <span style="font-size:12px;color:#d1d5db">또는</span>
        <div style="flex:1;height:1px;background:#f3f4f6"></div>
      </div>

      <!-- Sign-up -->
      <button id="_signup-btn"
        style="width:100%;padding:13px;border-radius:12px;
               background:#16a34a;border:none;
               color:#fff;font-size:15px;font-weight:600;
               font-family:inherit;cursor:pointer;margin-bottom:10px;
               display:flex;align-items:center;justify-content:center;gap:8px">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <line x1="19" y1="8" x2="19" y2="14"/>
          <line x1="22" y1="11" x2="16" y2="11"/>
        </svg>
        새 아이디 만들기
      </button>

      <!-- 익명 모드 -->
      <button id="_anon-btn"
        style="width:100%;padding:12px;border-radius:12px;
               background:transparent;border:1px solid #e5e7eb;
               color:#6b7280;font-size:14px;font-family:inherit;cursor:pointer;
               display:flex;align-items:center;justify-content:center;gap:8px">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
          <line x1="1" y1="1" x2="23" y2="23"/>
        </svg>
        익명 모드
      </button>

    </div>`;'''

if OLD_POPUP in html:
    html = html.replace(OLD_POPUP, NEW_POPUP, 1)
    print('✅ Sign-in 팝업 UI 교체 완료')
else:
    print('❌ 패턴 불일치')

pathlib.Path('webapp.html').write_text(html, encoding='utf-8')
print('✅ webapp.html 저장 완료')
