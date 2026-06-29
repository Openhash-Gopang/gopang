/**
 * search.js — 고팡 통합 검색 UI
 * 검색 대상: 사용자(handle/이름) + 프로필(태그/소개/상품) + 위치 기반
 */
import { PROXY, _userLocation } from '../core/state.js';

const ENTITY_LABELS = {
  person: '개인', business: '사업자',
  institution: '공공기관', org: '협회/단체', platform: '플랫폼',
};
const ENTITY_ICONS = {
  person: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`,
  business: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>`,
  institution: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 2 7 22 7"/></svg>`,
  org: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/></svg>`,
  platform: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
};

// ── 상태 ─────────────────────────────────────────────────────
let _activeFilter = 'all';   // 'all' | 'person' | 'business' | 'nearby'
let _searchTimer  = null;
let _lastQuery    = '';

// ── 오버레이 열기 ─────────────────────────────────────────────
export function openSearch() {
  const overlay = document.getElementById('search-overlay');
  if (!overlay) return;
  overlay.classList.add('open');
  // 필터 칩 렌더링 (최초 1회)
  _renderFilterChips();
  // 인풋 포커스
  setTimeout(() => {
    const inp = document.getElementById('search-input');
    if (inp) { inp.value = ''; inp.focus(); }
    // 위치 기반 추천 (기본)
    _loadNearby();
  }, 150);
}

export function closeSearch() {
  document.getElementById('search-overlay')?.classList.remove('open');
}

export function handleSearchOverlayClick(e) {
  const sheet = document.querySelector('#search-overlay .settings-sheet');
  if (sheet && !sheet.contains(e.target)) closeSearch();
}

// ── 필터 칩 ──────────────────────────────────────────────────
function _renderFilterChips() {
  const wrap = document.getElementById('search-filter-chips');
  if (!wrap || wrap.dataset.rendered) return;
  wrap.dataset.rendered = '1';

  const filters = [
    { key: 'all',         label: '전체' },
    { key: 'person',      label: '개인' },
    { key: 'business',    label: '사업자' },
    { key: 'institution', label: '공공기관' },
    { key: 'org',         label: '단체' },
    { key: 'nearby',      label: '📍 내 주변' },
  ];
  wrap.innerHTML = filters.map(f =>
    `<button class="search-chip${f.key === 'all' ? ' active' : ''}"
       data-filter="${f.key}" onclick="window._setSearchFilter('${f.key}')"
       style="padding:5px 12px;border-radius:20px;border:1.5px solid ${f.key==='all'?'#1A73E8':'#e5e7eb'};
              background:${f.key==='all'?'#EEF4FF':'#fff'};color:${f.key==='all'?'#1557B0':'#374151'};
              font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap">
       ${f.label}
     </button>`
  ).join('');
}

// 전역 노출 (onclick에서 사용)
window._setSearchFilter = function(key) {
  _activeFilter = key;
  // 칩 스타일 갱신
  document.querySelectorAll('.search-chip').forEach(c => {
    const active = c.dataset.filter === key;
    c.style.borderColor  = active ? '#1A73E8' : '#e5e7eb';
    c.style.background   = active ? '#EEF4FF' : '#fff';
    c.style.color        = active ? '#1557B0' : '#374151';
  });
  if (key === 'nearby') {
    _loadNearby();
  } else {
    const q = document.getElementById('search-input')?.value?.trim();
    if (q) runSearch(); else _loadNearby();
  }
};

// ── 실시간 검색 (디바운스 300ms) ─────────────────────────────
export function runSearch() {
  const q = document.getElementById('search-input')?.value?.trim() || '';
  clearTimeout(_searchTimer);
  if (!q) { _loadNearby(); return; }
  if (q === _lastQuery) return;
  _searchTimer = setTimeout(() => _doSearch(q), 300);
}

async function _doSearch(q) {
  _lastQuery = q;
  _setResultState('loading');

  try {
    const etype = (_activeFilter !== 'all' && _activeFilter !== 'nearby')
      ? _activeFilter : null;

    // 위치 정보 (있으면 거리 정렬)
    const loc = _userLocation;

    const body = { q, lim: 20, ofst: 0 };
    if (etype)    body.etype = etype;
    if (loc?.lat) { body.lat = loc.lat; body.lng = loc.lng; }

    const res  = await fetch(`${PROXY}/search`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const data = await res.json().catch(() => []);
    const results = Array.isArray(data) ? data : [];
    _renderResults(results, q);
  } catch(e) {
    _setResultState('error');
  }
}

// ── 위치 기반 추천 ───────────────────────────────────────────
async function _loadNearby() {
  const loc = _userLocation;
  if (!loc?.lat || !loc?.lng) {
    _setResultState('empty', '위치 정보가 없습니다.\n앱 권한 설정에서 위치를 허용해주세요.');
    return;
  }
  _setResultState('loading');
  try {
    const etype = (_activeFilter !== 'all' && _activeFilter !== 'nearby')
      ? _activeFilter : null;
    const body = { lat: loc.lat, lng: loc.lng, lim: 20 };
    if (etype) body.etype = etype;

    const res  = await fetch(`${PROXY}/search`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const data = await res.json().catch(() => []);
    const results = Array.isArray(data) ? data : [];
    _renderResults(results, '', true);
  } catch(e) {
    _setResultState('error');
  }
}

// ── 결과 렌더링 ──────────────────────────────────────────────
function _renderResults(results, q, isNearby = false) {
  const el = document.getElementById('search-result');
  if (!el) return;

  if (!results.length) {
    el.innerHTML = `
      <div style="text-align:center;padding:24px 0;color:#9ca3af">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:0 auto 10px"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <div style="font-size:14px">${isNearby ? '주변에 등록된 프로필이 없습니다' : `"${q}"에 대한 결과가 없습니다`}</div>
      </div>`;
    return;
  }

  const header = isNearby
    ? `<div style="font-size:11px;color:#9ca3af;margin-bottom:10px;font-weight:600">📍 내 주변 ${results.length}건</div>`
    : `<div style="font-size:11px;color:#9ca3af;margin-bottom:10px;font-weight:600">검색결과 ${results.length}건</div>`;

  el.innerHTML = header + results.map(r => _profileCard(r, q)).join('');
}

function _profileCard(r, q) {
  const tags  = (r.search_tags || []).slice(0, 3);
  const icon  = ENTITY_ICONS[r.entity_type] || ENTITY_ICONS.person;
  const label = ENTITY_LABELS[r.entity_type] || '';
  const dist  = r.distance_km != null
    ? `<span style="font-size:11px;color:#9ca3af;margin-left:6px">📍 ${r.distance_km < 1 ? Math.round(r.distance_km*1000)+'m' : r.distance_km.toFixed(1)+'km'}</span>`
    : '';
  // 검색어 하이라이트
  const name = q ? r.name?.replace(new RegExp(`(${q})`, 'gi'), '<mark style="background:#fef08a;border-radius:2px">$1</mark>') : r.name;

  return `
    <div onclick="window._openProfile('${r.handle}')"
         style="display:flex;align-items:center;gap:12px;padding:10px 0;
                border-bottom:1px solid #f3f4f6;cursor:pointer;
                transition:background .15s;border-radius:8px"
         onmouseenter="this.style.background='#f9fafb'"
         onmouseleave="this.style.background=''">
      <!-- 아바타 -->
      <div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#3B7FD4,#93C4F9);
                  display:flex;align-items:center;justify-content:center;
                  font-size:18px;font-weight:700;color:#fff;flex-shrink:0">
        ${(r.name||'?')[0]}
      </div>
      <!-- 정보 -->
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
          <span style="font-size:15px;font-weight:600;color:#111827">${name||''}</span>
          ${dist}
        </div>
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
          <span style="font-size:12px;color:#9ca3af">${r.handle||''}</span>
          ${label ? `<span style="display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:600;color:#1A73E8;background:#EEF4FF;padding:2px 7px;border-radius:10px">${icon}${label}</span>` : ''}
        </div>
        ${tags.length ? `<div style="display:flex;gap:4px;flex-wrap:wrap">${tags.map(t=>`<span style="font-size:11px;background:#f3f4f6;color:#6b7280;padding:2px 7px;border-radius:10px">#${t}</span>`).join('')}</div>` : ''}
        ${r.address ? `<div style="font-size:11px;color:#9ca3af;margin-top:3px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${r.address}</div>` : ''}
      </div>
      <!-- 화살표 -->
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#c7c7cc" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><polyline points="9 18 15 12 9 6"/></svg>
    </div>`;
}

// 프로필 페이지 이동 (전역)
window._openProfile = function(handle) {
  if (!handle) return;
  closeSearch();
  window.open(`/profile/${handle}`, '_blank');
};

// ── UI 상태 관리 ─────────────────────────────────────────────
function _setResultState(state, msg = '') {
  const el = document.getElementById('search-result');
  if (!el) return;
  if (state === 'loading') {
    el.innerHTML = `
      <div style="display:flex;gap:6px;align-items:center;padding:20px 0;justify-content:center">
        ${[0,1,2].map(i=>`<div style="width:7px;height:7px;border-radius:50%;background:#1A73E8;animation:sb .8s ${i*.2}s infinite alternate"></div>`).join('')}
      </div>
      <style>@keyframes sb{from{transform:translateY(0)}to{transform:translateY(-6px)}}</style>`;
  } else if (state === 'error') {
    el.innerHTML = `<div style="text-align:center;padding:20px;color:#9ca3af;font-size:13px">검색 중 오류가 발생했습니다.</div>`;
  } else {
    el.innerHTML = `<div style="text-align:center;padding:20px;color:#9ca3af;font-size:13px;white-space:pre-line">${msg}</div>`;
  }
}

// ── 하위 호환 stub ────────────────────────────────────────────
export function selectContact() {}
export function openProfile() {}
