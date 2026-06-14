# 고팡 인증 구현 확정 계획서
> 작성일: 2026-06-14  
> 버전: v2.0 (사고실험 2회 반영)  
> 기준 문서: GOPANG_AUTH_DESIGN.md v1.1

---

## 사고실험 발견 사항

| 실험 | 발견 | 조치 |
|------|------|------|
| 실험 6 | 로그아웃만 하고 중고 판매 시 타인이 전 소유자로 로그인 가능 | `gopangLogout()`에 L1 fpHex null 처리 추가 |
| 실험 7 | 기존 사용자 L1에 fpHex 없음 → 타 브라우저 복원 불가 | `initAuth()` 자동 로그인 성공 시 fpHex 동기화 |
| 실험 1~5,8 | 나머지 시나리오 모두 정상 | 계획대로 진행 |

---

## 구현 의존성 그래프

```
6-A L1 fpHex 필드 추가
  ├─→ 2-C _registerToL1 POST에 fpHex 포함
  │     ├─→ 2-B fpHex 중복 검증
  │     └─→ 7-A initAuth 자동 마이그레이션 (fpHexSynced)
  ├─→ 1-B initAuth L1 fpHex 조회 복원 팝업
  └─→ L-A gopangLogout L1 fpHex null 처리
```

---

## Phase 6-A. L1 스키마 변경 [선행 필수]
**대상:** L1 PocketBase Admin (`l1-hanlim.gopang.net/_/`)  
**컬렉션:** `profiles`

### 추가 필드
| 필드명 | 타입 | 옵션 |
|--------|------|------|
| `fpHex` | text | nullable, 인덱스 추가 |

### 작업
- PocketBase Admin UI → Collections → profiles → + New field
- 필드명: `fpHex`, 타입: `Plain text`, Required: off

---

## Phase 2-C. _registerToL1() POST에 fpHex 포함
**파일:** `src/gopang/core/auth.js`  
**함수:** `_registerToL1(name)`

### 수정
```javascript
// 현재
body: JSON.stringify({ guid, nickname_hash, handle, native_lang, is_public })

// 수정
body: JSON.stringify({ guid, nickname_hash, handle, fpHex: user.fpHex, native_lang, is_public })
```

---

## Phase 2-B. _registerToL1() fpHex 중복 검증
**파일:** `src/gopang/core/auth.js`  
**함수:** `_registerToL1(name)`

### 수정 위치: POST 전에 추가
```javascript
// fpHex 중복 검증
const filter = encodeURIComponent(`fpHex='${user.fpHex}'`);
const chkRes = await fetch(`${L1_URL}?filter=${filter}&perPage=1`);
if (chkRes.ok) {
  const chkData = await chkRes.json();
  const existing = chkData.items?.[0];
  if (existing?.handle && existing.handle !== user.handle) {
    alert('이 기기는 이미 다른 사용자에게 등록된 기기입니다.\n고팡 아이디는 기기당 1개만 등록할 수 있습니다.');
    return null;
  }
}
```

---

## Phase L-A. gopangLogout() L1 fpHex null 처리
**파일:** `webapp.html`  
**함수:** `gopangLogout()`

### 수정
```javascript
// 현재
async function gopangLogout() {
  if (!confirm('로그아웃 하시겠습니까?\n(아이디·설정이 초기화됩니다)')) return;
  localStorage.clear();
  sessionStorage.clear();
  caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
    .finally(() => location.reload());
}

// 수정
async function gopangLogout() {
  if (!confirm('로그아웃 하시겠습니까?\n(아이디·설정이 초기화됩니다)')) return;
  // L1에서 fpHex 무효화 (타인 도용 방지)
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
}
```

---

## Phase 1-B. initAuth() L1 fpHex 조회 복원 팝업
**파일:** `src/gopang/core/auth.js`  
**함수:** `initAuth()`

### 수정 위치: localStorage 없을 때 (신규 게스트 생성 전)
```javascript
// localStorage 없음 → L1에서 fpHex로 기존 등록 여부 조회
try {
  const filter = encodeURIComponent(`fpHex='${fpHex}'`);
  const res = await fetch(`${L1_URL}?filter=${filter}&perPage=1`);
  if (res.ok) {
    const data = await res.json();
    const found = data.items?.[0];
    if (found?.handle) {
      // 동일 기기, 타 브라우저 → 기존 아이디 발견 → 복원 팝업
      return new Promise((resolve) => {
        // 팝업 UI 생성
        const overlay = document.createElement('div');
        overlay.style.cssText = '...';
        overlay.innerHTML = `
          <p>이 기기의 고팡 아이디</p>
          <strong>${found.handle}</strong>
          <button id="_l1-confirm">로그인</button>
          <button id="_l1-cancel">Guest로 계속</button>`;
        document.body.appendChild(overlay);

        document.getElementById('_l1-confirm').onclick = () => {
          overlay.remove();
          const restored = {
            ipv6, fpHex,
            handle: found.handle,
            name: found.handle.replace(/@(.+)#.+/, '$1'),
            isGuest: false, isTemp: false,
            registeredAt: found.created
          };
          setUser(restored);
          localStorage.setItem('gopang_user_v3', JSON.stringify(restored));
          resolve(restored);
        };

        document.getElementById('_l1-cancel').onclick = () => {
          overlay.remove();
          const guest = { ipv6, fpHex, isTemp: true, isGuest: true,
                          registeredAt: new Date().toISOString() };
          setUser(guest);
          localStorage.setItem('gopang_user_v3', JSON.stringify(guest));
          resolve(guest);
        };
      });
    }
  }
} catch(e) {
  console.warn('[Auth] L1 fpHex 조회 실패 (오프라인?):', e.message);
}
// L1 조회 결과 없음 → 신규 게스트
```

---

## Phase 7-A. initAuth() 기존 사용자 fpHex 자동 동기화
**파일:** `src/gopang/core/auth.js`  
**함수:** `initAuth()`

### 수정 위치: 자동 로그인 성공 후 (24~28번 줄)
```javascript
if (stored?.ipv6 && stored?.fpHex === fpHex) {
  console.info('[Auth] L0 자동 로그인 ✅', stored.ipv6);
  setUser(stored);

  // [추가] fpHex L1 동기화 (기존 사용자 마이그레이션)
  if (stored.handle && !stored.fpHexSynced) {
    _patchFpHexToL1(stored, fpHex).then(() => {
      stored.fpHexSynced = true;
      localStorage.setItem('gopang_user_v3', JSON.stringify(stored));
    });
  }

  return stored;
}
```

### 신규 함수 추가
```javascript
// src/gopang/core/auth.js 하단에 추가
async function _patchFpHexToL1(stored, fpHex) {
  try {
    const filter = encodeURIComponent(`guid='${stored.ipv6}'`);
    const res = await fetch(`${L1_URL}?filter=${filter}&perPage=1`);
    if (!res.ok) return;
    const data = await res.json();
    const id = data.items?.[0]?.id;
    if (!id) return;
    await fetch(`${L1_URL}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fpHex })
    });
    console.info('[Auth] L1 fpHex 동기화 완료');
  } catch(e) {
    console.warn('[Auth] L1 fpHex 동기화 실패:', e.message);
  }
}
```

---

## Phase 3-B+C. 설정 창 재구성 + AI 설정 슬라이드 패널
**파일:** `webapp.html`, `src/gopang/ui/settings.js`

### 3-B. webapp.html 구조 변경
```html
<!-- 현재: llm-settings-section이 설정 패널 안에 인라인 -->
<div id="llm-settings-section" style="display:none"> ... </div>

<!-- 수정: AI 설정 별도 슬라이드 패널로 분리 -->
<div id="ai-settings-overlay">          ← 새 오버레이
  <div id="ai-settings-sheet">          ← 슬라이드 패널
    <div class="sheet-title">
      <span>AI 설정</span>
      <button onclick="closeAISettings()">✕</button>
    </div>
    <div class="ai-settings-body">
      <!-- 기존 llm-settings-section 내용 이동 -->
      LLM 모델 선택
      API 엔드포인트
      API Key
      Gemini API Key
      System Prompt
      [저장] 버튼
    </div>
  </div>
</div>

<!-- 등록 사용자 설정 창에 AI 설정 버튼 추가 -->
<button id="btn-ai-settings" onclick="openAISettings()"
  style="...green 스타일...">
  ⚙️ AI 설정
</button>
```

### 3-C. settings.js 함수 추가
```javascript
// src/gopang/ui/settings.js에 추가
export function openAISettings() {
  // 현재 CFG값을 AI 설정 패널 입력창에 채움
  const apiEl   = document.getElementById('ai-setting-apikey');
  const gKeyEl  = document.getElementById('ai-setting-gemini-key');
  const sysEl   = document.getElementById('ai-setting-system');
  const modelEl = document.getElementById('ai-setting-model');
  const epEl    = document.getElementById('ai-setting-endpoint');
  if (apiEl)   apiEl.value   = CFG.apiKey    ? '••••••••••••••••' : '';
  if (gKeyEl)  gKeyEl.value  = CFG.geminiKey ? '••••••••••••••••' : '';
  if (sysEl)   sysEl.value   = CFG.system;
  if (modelEl) modelEl.value = CFG.model;
  if (epEl)    epEl.value    = CFG.endpoint;
  document.getElementById('ai-settings-overlay')?.classList.add('open');
}

export function closeAISettings() {
  document.getElementById('ai-settings-overlay')?.classList.remove('open');
}
```

### openSettings() 수정
```javascript
// 등록 사용자일 때 AI 설정 버튼 표시
const aiBtn = document.getElementById('btn-ai-settings');
if (aiBtn) aiBtn.style.display = registered ? 'block' : 'none';

// llm-settings-section은 항상 숨김 (AI 설정 패널로 이동했으므로)
const llmSec = document.getElementById('llm-settings-section');
if (llmSec) llmSec.style.display = 'none';
```

---

## Phase 4. 기기 완전 초기화
**파일:** `src/gopang/core/auth.js` (신규), `webapp.html`, `src/gopang/ui/settings.js`

### 4-A. _deviceFullReset() 신규 함수
```javascript
// src/gopang/core/auth.js에 추가
export async function _deviceFullReset() {
  if (!confirm('기기를 완전 초기화합니다.\n판매·양도 전 실행하세요.\n\n⚠️ 이 기기의 모든 고팡 데이터가 삭제됩니다.')) return;

  try {
    const stored = JSON.parse(localStorage.getItem('gopang_user_v3') || 'null');
    if (stored?.fpHex) {
      // L1에서 해당 기기 레코드 삭제
      const filter = encodeURIComponent(`fpHex='${stored.fpHex}'`);
      const res = await fetch(`${L1_URL}?filter=${filter}&perPage=1`);
      if (res.ok) {
        const data = await res.json();
        const id = data.items?.[0]?.id;
        if (id) await fetch(`${L1_URL}/${id}`, { method: 'DELETE' });
      }
    }
  } catch(e) { console.warn('[Reset] L1 삭제 실패:', e.message); }

  // 로컬 전체 삭제
  localStorage.clear();
  sessionStorage.clear();

  // IndexedDB 삭제
  const dbs = await indexedDB.databases?.() || [];
  for (const db of dbs) indexedDB.deleteDatabase(db.name);

  // SW 캐시 삭제
  const keys = await caches.keys();
  await Promise.all(keys.map(k => caches.delete(k)));
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.map(r => r.unregister()));

  location.reload();
}
```

### 4-B. 설정 창에 버튼 추가 (webapp.html)
```html
<!-- 등록 사용자 설정 창 최하단 -->
<button id="btn-device-reset" onclick="_deviceFullReset()"
  style="width:calc(100% - 32px);margin:0 16px 16px;padding:12px;
         background:transparent;border:1px solid #fca5a5;border-radius:10px;
         color:#9ca3af;font-size:12px;font-family:inherit;cursor:pointer">
  ⚠️ 기기 완전 초기화 (판매·양도 전 실행)
</button>
```

---

## Phase 5. GDC 사용자 판별
**파일:** `src/gopang/core/auth.js`, `src/gopang/ui/settings.js`, `webapp.html`

### 5-A. _isGDCUser() 신규 함수
```javascript
// src/gopang/core/auth.js에 추가
export function _isGDCUser() {
  try {
    const s = JSON.parse(localStorage.getItem('gopang_user_v3') || 'null');
    return !!(s?.gdcEnabled && s?.walletPubKey);
  } catch { return false; }
}
```

### 5-B. openSettings()에 GDC Wallet 섹션 조건부 표시
```javascript
// settings.js openSettings()에 추가
const { _isGDCUser } = await import('../core/auth.js');
const gdcSec = document.getElementById('gdc-wallet-section');
if (gdcSec) gdcSec.style.display = _isGDCUser() ? 'block' : 'none';
```

---

## 최종 구현 순서

| 순서 | Phase | 파일 | 작업 | 선행 조건 |
|------|-------|------|------|----------|
| 1 | 6-A | L1 PocketBase | fpHex 필드 추가 | 없음 |
| 2 | 2-C | auth.js | POST body에 fpHex 포함 | 6-A |
| 3 | 2-B | auth.js | fpHex 중복 검증 | 6-A |
| 4 | L-A | webapp.html | gopangLogout L1 fpHex null | 6-A |
| 5 | 7-A | auth.js | 기존 사용자 fpHex 자동 동기화 | 6-A |
| 6 | 1-B | auth.js | L1 fpHex 조회 복원 팝업 | 6-A, 2-C |
| 7 | 3-B | webapp.html | AI 설정 슬라이드 패널 HTML | 없음 |
| 8 | 3-C | settings.js | openAISettings / closeAISettings | 3-B |
| 9 | 3-B | settings.js | openSettings llm 숨김 + AI 버튼 | 3-C |
| 10 | 4-A | auth.js | _deviceFullReset() | 없음 |
| 11 | 4-B | webapp.html | 기기 초기화 버튼 | 4-A |
| 12 | 5-A | auth.js | _isGDCUser() | 없음 |
| 13 | 5-B | settings.js | GDC Wallet 섹션 | 5-A |

---

## 수정 파일 최종 요약

| 파일 | 수정 함수 | 추가 함수 |
|------|----------|----------|
| `src/gopang/core/auth.js` | `initAuth()`, `_registerToL1()` | `_patchFpHexToL1()`, `_deviceFullReset()`, `_isGDCUser()` |
| `src/gopang/ui/settings.js` | `openSettings()` | `openAISettings()`, `closeAISettings()` |
| `webapp.html` | `gopangLogout()` | AI 설정 슬라이드 패널 HTML, 기기 초기화 버튼 |
| L1 PocketBase | profiles 컬렉션 | fpHex 필드 추가 |

---

## 완료 체크리스트

### 이미 완료 ✅
- [x] 1-A: Guest localStorage 저장
- [x] 2-A: _registerToL1 _USER 전체 저장
- [x] 3-A: Guest 설정 창 정리 (로그아웃 버튼 숨김)
- [x] 3-D: 등록 완료 후 UI 즉시 갱신
- [x] 3-E: 미등록 문구 삭제

### 미완료 ⬜
- [ ] 6-A: L1 fpHex 필드 추가
- [ ] 2-C: POST body fpHex 포함
- [ ] 2-B: fpHex 중복 검증
- [ ] L-A: gopangLogout L1 fpHex null
- [ ] 7-A: 기존 사용자 fpHex 자동 동기화
- [ ] 1-B: L1 fpHex 조회 복원 팝업
- [ ] 3-B+C: AI 설정 슬라이드 패널
- [ ] 4-A+B: 기기 완전 초기화
- [ ] 5-A+B: GDC 사용자 판별
