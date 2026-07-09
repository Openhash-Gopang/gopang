/**
 * ai/manifest-loader.js — sp-catalog.json 기반 SP 로더 (2026-07-09 신설,
 * 2026-07-09 파일명 개명: manifest.json → sp-catalog.json, W-16)
 *
 * call-ai.js에 있던 _loadManifest()/_loadSpByKey()를 이 파일로 옮겼다.
 * 이유: expert-registry.js·expert-session.js(하드코딩된 파일 경로 방식)를
 * sp-catalog.json 체계로 통합하면서, expert-session.js가 이 로더를 써야
 * 했는데 call-ai.js에서 직접 import하면 call-ai.js → expert-session.js →
 * call-ai.js 순환 참조가 생긴다(call-ai.js가 이미 expert-session.js를
 * import하고 있음). 순환을 피하기 위해 로더 자체를 독립 모듈로 분리했다.
 *
 * 이 분리 전까지 두 SP 로딩 체계(sp-catalog.json 기반 vs expert-registry.js
 * 하드코딩)가 따로 있었고, 하드코딩 쪽은 새 버전이 나와도 수동으로 안 고치면
 * 조용히 구버전을 계속 쓰는 문제가 실제로 있었다(SP_lawyer가 v3.2에 몇 주간
 * 고정돼 있었던 사례, 2026-07-09 실사로 발견·수정). 이 파일이 그 재발을
 * 막는 근본 수정이다.
 */

const _SP_BASE = '/prompts/';
let _manifestCache = null;

export async function _loadManifest() {
  if (_manifestCache) return _manifestCache;
  const res = await fetch(_SP_BASE + 'sp-catalog.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('manifest fetch 실패: ' + res.status);
  _manifestCache = await res.json();
  return _manifestCache;
}

export async function _loadSpByKey(manifestKey, label) {
  const manifest = await _loadManifest();
  const fname = manifest[manifestKey];
  if (!fname) throw new Error(`${label} manifest 키 없음: ${manifestKey}`);
  const res = await fetch(_SP_BASE + fname);
  if (!res.ok) throw new Error(`${label} SP 로드 실패: ${res.status} (${fname})`);
  const sp = await res.text();
  console.info(`[SP] ${label} 로드 완료: ${fname} (${sp.length} chars)`);
  return sp;
}
