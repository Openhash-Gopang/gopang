/**
 * ui/search.js — 검색 (사용자·업체·PDV)
 */
import { _sha256, _isRegistered } from '../core/auth.js';
import { L1_URL } from '../core/state.js';
import { appendBubble } from './bubble.js';
import { _showRegisterFlowThenPeer } from './register-flow.js';

export function openSearch() {
  document.getElementById('search-overlay')?.classList.add('open');
  setTimeout(() => document.getElementById('search-input')?.focus(), 300);
}

export function closeSearch() {
  document.getElementById('search-overlay')?.classList.remove('open');
}

export function handleSearchOverlayClick(e) {
  if (e.target.id === 'search-overlay') closeSearch();
}

// ── 메인 검색 ────────────────────────────────────────────
export async function runSearch() {
  const q       = document.getElementById('search-input')?.value?.trim() || '';
  const resultEl = document.getElementById('search-result');
  if (!q) { if (resultEl) resultEl.innerHTML = ''; return; }

  resultEl.innerHTML = `<div style="text-align:center;padding:16px;color:var(--label-3);font-size:13px">🔍 검색 중…</div>`;

  const contactMatches = _searchContacts(q);

  // L1 검색
  let serverUsers = [];
  try {
    const nickHash = await _sha256('ko:' + q);
    const safeQ    = q.replace(/'/g, "\\'").replace(/"/g, '\\"');
    const filter   = encodeURIComponent(`(nickname_hash='${nickHash}' || handle~'${safeQ}') && is_public=true`);
    const res  = await fetch(`${L1_URL}?filter=${filter}&perPage=20`);
    const data = await res.json();
    serverUsers = (data.items || []).map(u => ({
      guid:         u.guid,
      name:         u.handle?.split('#')[0]?.replace('@','') || u.handle,
      handle:       u.handle,
      entity_type:  u.entity_type || 'person',
      avatar_emoji: u.entity_type === 'business'   ? '🏪'
                  : u.entity_type === 'institution' ? '🏛️' : '🙂',
    }));
  } catch(e) { console.warn('[Search] L1 검색 실패:', e.message); }

  const pdvMatches = _searchPDV(q);
  const isGuest    = !_isRegistered();
  let html = '';

  // 로컬 연락처
  if (contactMatches.length > 0) {
    html += _sectionHeader('👤 연락처');
    contactMatches.forEach(c => {
      html += `<div class="search-item" onclick="window.selectContact('${c.id}')">
        <span class="search-avatar">🙂</span>
        <div class="search-item-body">
          <span class="search-item-name">${_highlight(c.name, q)}</span>
          <span class="search-item-sub">${c.guid ? c.guid.slice(0,8)+'…' : ''}</span>
        </div>
      </div>`;
    });
  }

  // L1 사람
  const persons    = serverUsers.filter(u => u.entity_type === 'person');
  const businesses = serverUsers.filter(u => ['business','org','institution'].includes(u.entity_type));

  if (persons.length > 0) {
    html += _sectionHeader('🌐 고팡 사용자', contactMatches.length > 0);
    persons.forEach(u => {
      const peerJson = JSON.stringify(u).replace(/'/g, "\\'");
      const badge    = isGuest
        ? `<span class="search-item-badge" style="background:#fef3c7;color:#92400e">🔒 채팅</span>`
        : `<span class="search-item-badge">채팅</span>`;
      html += `<div class="search-item" onclick="window.selectContact(null, ${peerJson})">
        <span class="search-avatar">${u.avatar_emoji}</span>
        <div class="search-item-body">
          <span class="search-item-name">${_highlight(u.name, q)}</span>
          <span class="search-item-sub">${u.handle || ''}</span>
        </div>${badge}
      </div>`;
    });
  }

  // L1 업체·기관
  if (businesses.length > 0) {
    html += _sectionHeader('🏪 업체·기관', persons.length > 0 || contactMatches.length > 0);
    businesses.forEach(u => {
      const peerJson = JSON.stringify(u).replace(/'/g, "\\'");
      html += `<div class="search-item">
        <span class="search-avatar">${u.avatar_emoji}</span>
        <div class="search-item-body">
          <span class="search-item-name">${_highlight(u.name, q)}</span>
          <span class="search-item-sub">${u.handle || ''}</span>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          <span class="search-item-badge" style="cursor:pointer"
            onclick="window.openProfile('${u.handle || u.guid}')">프로필</span>
          ${isGuest
            ? `<span class="search-item-badge" style="background:#fef3c7;color:#92400e;cursor:pointer"
                onclick="window.selectContact(null,${peerJson})">🔒 채팅</span>`
            : `<span class="search-item-badge" style="cursor:pointer"
                onclick="window.selectContact(null,${peerJson})">채팅</span>`}
        </div>
      </div>`;
    });
  }

  // Guest 안내
  if (isGuest && (persons.length + businesses.length) > 0) {
    html += `<div style="margin-top:10px;padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;
                          border-radius:10px;font-size:12px;color:#92400e;line-height:1.6">
      🔒 <b>채팅하려면 고팡 아이디가 필요합니다.</b><br>
      <span style="color:#78350f">상단 <b>AI</b> 버튼 또는 ⚙️ 설정에서 등록하세요.</span>
    </div>`;
  }

  // PDV
  if (pdvMatches.length > 0) {
    html += _sectionHeader('🔐 PDV 데이터', !!(contactMatches.length + serverUsers.length));
    pdvMatches.forEach(p => {
      html += `<div class="search-item">
        <span class="search-avatar">🔐</span>
        <div class="search-item-body">
          <span class="search-item-name">${_highlight(p.key, q)}</span>
          <span class="search-item-sub">${p.date}</span>
        </div>
      </div>`;
    });
  }

  if (!html) {
    html = `<div style="color:var(--label-3);font-size:13px;text-align:center;padding:20px 0">
      검색 결과 없음
      <div style="font-size:11px;margin-top:6px">웹 검색은 AI 비서에게 직접 지시하세요.</div>
    </div>`;
  }

  resultEl.innerHTML = html;
}

// ── 연락처 선택 ──────────────────────────────────────────
export async function selectContact(id, serverUser = null) {
  const peer = serverUser || (() => {
    try {
      const contacts = JSON.parse(localStorage.getItem('gopang_contacts') || '[]');
      const c = contacts.find(x => x.id === id);
      return c ? { guid: c.guid, name: c.name, handle: c.handle || '', avatar_emoji: '🙂' } : null;
    } catch { return null; }
  })();

  if (!peer) return;
  closeSearch();

  if (!_isRegistered()) {
    _showRegisterFlowThenPeer(peer);
    return;
  }

  const { setPeer } = await import('../p2p/webrtc.js');
  await setPeer(peer);
}

export function openProfile(handleOrGuid) {
  closeSearch();
  window.open(`https://users.gopang.net/profile.html?handle=${encodeURIComponent(handleOrGuid)}`, '_blank');
}

// ── 내부 헬퍼 ───────────────────────────────────────────
function _sectionHeader(label, hasMargin = false) {
  return `<div style="font-size:11px;font-weight:600;color:var(--label-3);
    letter-spacing:.05em;text-transform:uppercase;
    margin:${hasMargin ? '12px' : '0'} 0 6px">${label}</div>`;
}

function _searchContacts(q) {
  const results = [];
  const lq = q.toLowerCase();
  try {
    const contacts = JSON.parse(localStorage.getItem('gopang_contacts') || '[]');
    contacts.forEach(c => {
      if (c.name?.toLowerCase().includes(lq) || c.guid?.toLowerCase().includes(lq)) {
        results.push(c);
      }
    });
  } catch {}
  return results;
}

function _searchPDV(q) {
  const results = [];
  const lq = q.toLowerCase();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith('gopang_')) continue;
      if (['gopang_user_v4','gopang_cfg','gopang_contacts'].includes(key)) continue;
      if (key.toLowerCase().includes(lq)) {
        const val = localStorage.getItem(key);
        let date = '';
        try { date = JSON.parse(val)?.ts ?? ''; } catch {}
        results.push({ key: key.replace('gopang_',''), date });
      }
    }
  } catch {}
  return results.slice(0, 10);
}

function _highlight(text, q) {
  if (!text) return '';
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
  return text.replace(re, '<span style="color:var(--tint);font-weight:600">$1</span>');
}
