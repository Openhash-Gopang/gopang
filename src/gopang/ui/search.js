// search.js — stub (기존 UI 호환용)
export function openSearch() {}
export function closeSearch() { document.getElementById('search-overlay')?.classList.remove('open'); }
export function handleSearchOverlayClick(e) { if(e.target.id==='search-overlay') closeSearch(); }
export function runSearch() {}
export function selectContact() {}
export function openProfile() {}
