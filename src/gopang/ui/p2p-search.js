/**
 * ui/search.js — 사용자 검색 UI (GDUDA Phase 1)
 * - 닉네임 검색 → 상세 필터 → 연결 요청
 * - CF Worker /p2p/search 경유
 */
import { PROXY, L1_URL, _USER } from '../core/state.js';

let _searchOverlay = null;
let _searchTimer   = null;

// ── 검색 패널 열기 ────────────────────────────────────────
// @param {string} [prefillQuery] — 그림자 AI [SEARCH: query=...] 태그에서 전달.
//   지정 시 입력란에 자동 채우고 즉시 검색을 실행한다(사용자 타이핑 불필요).
export function openSearch(prefillQuery) {
  if (_searchOverlay) { _searchOverlay.remove(); _searchOverlay = null; }

  const overlay = document.createElement('div');
  overlay.id = '_search-overlay';
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:9998',
    'background:rgba(0,0,0,0.4)',
    'display:flex;align-items:flex-start;justify-content:center',
    'padding:60px 16px 16px;box-sizing:border-box',
  ].join(';');

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:20px;width:100%;max-width:400px;
                box-sizing:border-box;overflow:hidden;
                box-shadow:0 8px 32px rgba(0,0,0,0.18)">

      <!-- 헤더 -->
      <div style="display:flex;align-items:center;padding:16px 20px;
                  border-bottom:1px solid #f0f0f0">
        <span style="font-size:15px;font-weight:600;color:#111827;flex:1">사용자 검색</span>
        <button id="_search-close"
          style="border:none;background:none;font-size:20px;cursor:pointer;
                 color:#9ca3af;padding:0 4px">✕</button>
      </div>

      <!-- 검색 입력 -->
      <div style="padding:16px 20px 8px">
        <div style="display:flex;align-items:center;
                    border:1px solid #e5e7eb;border-radius:12px;
                    background:#f9fafb;overflow:hidden" id="_sq-field">
          <input id="_sq-input" type="text" placeholder="닉네임 또는 @handle"
            style="flex:1;padding:0 14px;height:48px;border:none;background:transparent;
                   font-size:15px;font-family:inherit;outline:none;color:#111827;min-width:0"
            autocomplete="off"/>
          <button id="_sq-btn"
            style="padding:0 16px;height:48px;border:none;background:transparent;
                   cursor:pointer;color:#1A73E8;font-size:14px;font-weight:600">
            검색
          </button>
        </div>
      </div>

      <!-- 상세 필터 (접힘) -->
      <div style="padding:0 20px 8px">
        <button id="_sq-filter-toggle"
          style="font-size:12px;color:#6b7280;background:none;border:none;
                 cursor:pointer;padding:4px 0">
          ▶ 상세 필터
        </button>
        <div id="_sq-filters" style="display:none;margin-top:8px;
             display:none;gap:8px;flex-direction:column">
          <input id="_sq-country" type="text" placeholder="국가코드 (예: US, KR, JP)"
            style="padding:8px 12px;border:1px solid #e5e7eb;border-radius:8px;
                   font-size:13px;font-family:inherit;outline:none;width:100%;
                   box-sizing:border-box"/>
          <input id="_sq-region" type="text" placeholder="지역 (예: New York, 서울)"
            style="padding:8px 12px;border:1px solid #e5e7eb;border-radius:8px;
                   font-size:13px;font-family:inherit;outline:none;width:100%;
                   box-sizing:border-box;margin-top:6px"/>
        </div>
      </div>

      <!-- 결과 -->
      <div id="_sq-results"
        style="max-height:360px;overflow-y:auto;padding:0 0 8px">
      </div>
    </div>`;

  document.body.appendChild(overlay);
  _searchOverlay = overlay;

  const input       = document.getElementById('_sq-input');
  const field       = document.getElementById('_sq-field');
  const filterBtn   = document.getElementById('_sq-filter-toggle');
  const filtersEl   = document.getElementById('_sq-filters');
  const countryEl   = document.getElementById('_sq-country');
  const regionEl    = document.getElementById('_sq-region');
  const resultsEl   = document.getElementById('_sq-results');

  // 닫기
  document.getElementById('_search-close').onclick = _closeSearch;
  overlay.addEventListener('click', e => { if (e.target === overlay) _closeSearch(); });

  // 상세 필터 토글
  let filterOpen = false;
  filterBtn.onclick = () => {
    filterOpen = !filterOpen;
    filtersEl.style.display = filterOpen ? 'flex' : 'none';
    filterBtn.textContent   = (filterOpen ? '▼' : '▶') + ' 상세 필터';
  };

  // 포커스
  input.addEventListener('focus', () => field.style.borderColor = '#1A73E8');
  input.addEventListener('blur',  () => field.style.borderColor = '#e5e7eb');

  // 실시간 검색 (300ms debounce)
  input.addEventListener('input', () => {
    clearTimeout(_searchTimer);
    const q = input.value.trim();
    if (!q) { resultsEl.innerHTML = ''; return; }
    _searchTimer = setTimeout(() => _doSearch(q, countryEl.value.trim(), regionEl.value.trim(), resultsEl), 300);
  });

  document.getElementById('_sq-btn').onclick = () => {
    const q = input.value.trim();
    if (q) _doSearch(q, countryEl.value.trim(), regionEl.value.trim(), resultsEl);
  };

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const q = input.value.trim();
      if (q) _doSearch(q, countryEl.value.trim(), regionEl.value.trim(), resultsEl);
    }
    if (e.key === 'Escape') _closeSearch();
  });

  // ── 그림자 AI가 query를 미리 전달한 경우: 자동 입력 + 즉시 검색 ──
  if (prefillQuery && prefillQuery.trim()) {
    input.value = prefillQuery.trim();
    _doSearch(prefillQuery.trim(), '', '', resultsEl);
  } else {
    input.focus();
  }
}

// ── 검색 실행 ─────────────────────────────────────────────
async function _doSearch(q, country, region, resultsEl) {
  resultsEl.innerHTML = `
    <div style="text-align:center;padding:24px;color:#9ca3af;font-size:13px">
      검색 중...
    </div>`;

  try {
    // ── 탈중앙화 이관 ⑨: p2p/search → L1 직접 (2026-06-23) ─────────────
    // 이전: PROXY /p2p/search → Worker → L1 profiles 검색
    // 이후: L1 profiles 직접 검색 (Worker 경유 없음)
    const L1_PROFILES_BASE = L1_URL.replace('/api/collections/profiles/records', '') + '/api/collections/profiles/records';
    const isHandle = q.startsWith('@');
    let filter;
    if (isHandle) {
      const handleClean = q.replace(/^@/, '');
      filter = `handle='${handleClean}'`;
    } else {
      // 닉네임 또는 handle에서 검색 (PocketBase like 필터)
      filter = `nickname~'${q}' || handle~'${q}'`;
      if (country) filter += ` && country_code='${country}'`;
      if (region)  filter += ` && region~'${region}'`;
    }
    const l1Url = `${L1_PROFILES_BASE}?filter=${encodeURIComponent(filter)}&perPage=20&sort=handle`;
    const res  = await fetch(l1Url);
    const raw  = await res.json();
    // L1 응답 → Worker 응답 형식으로 정규화
    const data = {
      ok:    res.ok,
      users: (raw.items || []).map(u => ({
        guid:      u.guid,
        handle:    u.handle,
        nickname:  u.nickname,
        region:    u.region,
        country_code: u.country_code,
        current_l1:   u.current_l1,
      })),
      count:  raw.totalItems || 0,
      source: 'l1-direct',
    };

    if (!data.ok || !data.users?.length) {
      resultsEl.innerHTML = `
        <div style="text-align:center;padding:24px;color:#9ca3af;font-size:13px">
          검색 결과가 없습니다.
        </div>`;
      return;
    }

    // 본인 제외
    const myHandle = _USER?.handle;
    const users    = data.users.filter(u => u.handle !== myHandle);

    if (!users.length) {
      resultsEl.innerHTML = `
        <div style="text-align:center;padding:24px;color:#9ca3af;font-size:13px">
          검색 결과가 없습니다.
        </div>`;
      return;
    }

    resultsEl.innerHTML = users.map(u => _renderUserCard(u)).join('');

    // 연결 요청 버튼 이벤트
    resultsEl.querySelectorAll('[data-connect]').forEach(btn => {
      btn.onclick = () => _sendConnectRequest(JSON.parse(btn.dataset.connect));
    });

  } catch(e) {
    resultsEl.innerHTML = `
      <div style="text-align:center;padding:24px;color:#dc2626;font-size:13px">
        네트워크 오류: ${e.message}
      </div>`;
  }
}

// ── 사용자 카드 렌더 ──────────────────────────────────────
function _renderUserCard(u) {
  const flag    = _countryFlag(u.country_code);
  const handle  = u.handle || '';
  const region  = u.region  ? `<span style="color:#9ca3af">·</span> ${u.region}` : '';
  const country = u.country_code || '';
  const data    = JSON.stringify(u).replace(/"/g, '&quot;');

  return `
    <div style="display:flex;align-items:center;gap:12px;
                padding:12px 20px;border-bottom:1px solid #f9f9f9">
      <div style="font-size:28px;flex-shrink:0">${flag}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:600;color:#111827">
          ${u.nickname || handle}
        </div>
        <div style="font-size:12px;color:#6b7280;margin-top:2px">
          ${handle}
          ${region ? `<span style="margin-left:6px">${region}</span>` : ''}
        </div>
      </div>
      <button data-connect="${data}"
        style="padding:6px 14px;background:#1A73E8;color:#fff;
               border:none;border-radius:8px;font-size:13px;
               font-weight:600;cursor:pointer;flex-shrink:0">
        연결
      </button>
    </div>`;
}

// ── 국기 이모지 ───────────────────────────────────────────
function _countryFlag(code) {
  if (!code || code.length !== 2) return '🌐';
  return String.fromCodePoint(
    ...code.toUpperCase().split('').map(c => 0x1F1E6 + c.charCodeAt(0) - 65)
  );
}

// ── 연결 요청 전송 ────────────────────────────────────────
async function _sendConnectRequest(targetUser) {
  if (!_USER?.ipv6) {
    alert('로그인이 필요합니다.');
    return;
  }

  const confirmed = confirm(
    `${targetUser.nickname || targetUser.handle}님에게 연결 요청을 보내시겠습니까?`
  );
  if (!confirmed) return;

  try {
    // WebRTC offer 생성
    const { startP2PCall } = await import('./p2p-chat.js');
    await startP2PCall(targetUser);
    _closeSearch();
  } catch(e) {
    alert('연결 요청 실패: ' + e.message);
  }
}

// ── 검색 패널 닫기 ────────────────────────────────────────
function _closeSearch() {
  _searchOverlay?.remove();
  _searchOverlay = null;
  clearTimeout(_searchTimer);
}

// ── 전역 노출 ─────────────────────────────────────────────
window._openSearch = openSearch;
