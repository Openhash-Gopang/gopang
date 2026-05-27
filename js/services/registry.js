// ══════════════════════════════════════════════════════════════════
// js/services/registry.js — 고팡 서비스 레지스트리
//
// 서비스 등록 방법:
//   1. 정적: /services/{id}/manifest.json 파일 배포
//   2. 동적: postMessage { type:'GWP_REGISTER', manifest:{...} }
//
// manifest 표준 스펙:
//   id, name, icon, version, url, category, triggers[], description
//   sp_path (선택): 전문가 프롬프트 경로
// ══════════════════════════════════════════════════════════════════

// ── 빌트인 서비스 목록 (manifest.json 경로) ─────────────────────
// 새 서비스 추가 시 이 배열에만 경로 추가
const BUILTIN_MANIFESTS = [
  '/services/fiil-kcleaner/manifest.json',
  '/services/klaw/manifest.json',
];

// ── 런타임 레지스트리 ────────────────────────────────────────────
let _registry = [];

// ── 초기화: 모든 manifest 로드 ───────────────────────────────────
export async function loadRegistry() {
  const results = await Promise.allSettled(
    BUILTIN_MANIFESTS.map(path =>
      fetch(path).then(r => r.ok ? r.json() : null)
    )
  );

  _registry = results
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value);

  console.info('[Registry] 로드 완료:', _registry.map(s => s.id).join(', '));
  return _registry;
}

// ── 동적 등록 (postMessage GWP_REGISTER) ─────────────────────────
export function registerService(manifest) {
  if (!manifest?.id || !manifest?.url) return false;
  const idx = _registry.findIndex(s => s.id === manifest.id);
  if (idx >= 0) _registry[idx] = manifest;  // 업데이트
  else          _registry.push(manifest);   // 신규 등록
  console.info('[Registry] 서비스 등록:', manifest.id, manifest.version || '');
  return true;
}

// ── 의도 → 서비스 매칭 ──────────────────────────────────────────
export function matchService(text) {
  if (!text) return null;
  for (const svc of _registry) {
    if (svc.triggers?.some(t => text.includes(t))) return svc;
  }
  return null;
}

// ── 전체 레지스트리 반환 ─────────────────────────────────────────
export function getRegistry() { return [..._registry]; }

// ── GWP_REGISTER 메시지 리스너 ───────────────────────────────────
export function listenServiceRegister() {
  window.addEventListener('message', e => {
    if (e.data?.type === 'GWP_REGISTER' && e.data?.manifest) {
      registerService(e.data.manifest);
    }
  });
}
