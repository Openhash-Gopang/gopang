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
let _universalIntegrityCache = null;

export async function _loadManifest() {
  if (_manifestCache) return _manifestCache;
  const res = await fetch(_SP_BASE + 'sp-catalog.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('manifest fetch 실패: ' + res.status);
  _manifestCache = await res.json();
  return _manifestCache;
}

// ★ 2026-07-12 신설 — UNIVERSAL-INTEGRITY 자동 상속.
// 이 문서 자신(prompts/UNIVERSAL-INTEGRITY_v1_0.md)이 "로딩 순서는 항상
// UNIVERSAL-INTEGRITY → 트랙별 정체성 문서 → 개별 SP"라고 명시하고
// "적용 범위: 트랙 무관 전부"라고 선언하고 있었는데, 실제로는 서버 사이드
// (worker.js의 handleGovRelay/callDeepSeek, UNIVERSAL_FORCED_K_SERVICES)
// 에서만 강제 주입되고 있었고, 클라이언트가 이 _loadSpByKey()로 직접
// 로드하는 경로(AGENT-COMMON을 포함해 K-Intent/K-Compose/K-Deliver/
// K-Search/K-Bank/K-Telecom/K-Estate/profile-assistant 등 전부)에는
// 전혀 적용되지 않고 있었다 — 신규 상상 시나리오 30건 실사 중 발견된
// "안내만 하고 끝내는" 패턴의 근본 원인 중 하나로 보인다(U0 신설과
// 별개로, U0이 실제로 이 경로들에 도달하지 않으면 소용없으므로 반드시
// 함께 고쳐야 함).
async function _loadUniversalIntegrityRaw() {
  if (_universalIntegrityCache) return _universalIntegrityCache;
  try {
    const manifest = await _loadManifest();
    const fname = manifest['UNIVERSAL-INTEGRITY'];
    if (!fname) return '';
    const res = await fetch(_SP_BASE + fname);
    if (!res.ok) return '';
    _universalIntegrityCache = await res.text();
    return _universalIntegrityCache;
  } catch (e) {
    console.warn('[SP] UNIVERSAL-INTEGRITY 로드 실패(무시, 개별 SP만 적용):', e.message);
    return '';
  }
}

// ★ 2026-07-17 신설(주피터님 지시) — TASK-DELEGATION-GUIDE 자동 상속.
// UNIVERSAL-INTEGRITY U0(제1공리, "안내로 끝내지 않는다")가 이미
// "업무 대행"의 방향을 세워뒀지만, "혼디의 본래 용도는 업무 대행이고
// 문의 응답은 부차적"이라는 걸 더 명시적으로 못박고, 판단이 애매할
// 때 참조할 구체적 서비스별 대행 방법(등본 발급 등)을 별도 문서로
// 분리해 UNIVERSAL-INTEGRITY와 동일한 패턴으로 모든 SP에 강제 주입.
let _taskDelegationGuideCache = null;
async function _loadTaskDelegationGuideRaw() {
  if (_taskDelegationGuideCache) return _taskDelegationGuideCache;
  try {
    const manifest = await _loadManifest();
    const fname = manifest['TASK-DELEGATION-GUIDE'];
    if (!fname) return '';
    const res = await fetch(_SP_BASE + fname);
    if (!res.ok) return '';
    _taskDelegationGuideCache = await res.text();
    return _taskDelegationGuideCache;
  } catch (e) {
    console.warn('[SP] TASK-DELEGATION-GUIDE 로드 실패(무시, 개별 SP만 적용):', e.message);
    return '';
  }
}

export async function _loadSpByKey(manifestKey, label) {
  const manifest = await _loadManifest();
  const fname = manifest[manifestKey];
  if (!fname) throw new Error(`${label} manifest 키 없음: ${manifestKey}`);
  const res = await fetch(_SP_BASE + fname);
  if (!res.ok) throw new Error(`${label} SP 로드 실패: ${res.status} (${fname})`);
  const sp = await res.text();

  // UNIVERSAL-INTEGRITY·TASK-DELEGATION-GUIDE 자기 자신을 로드할 때는
  // 중복 결합하지 않는다(self-concat은 무의미).
  if (manifestKey === 'UNIVERSAL-INTEGRITY' || manifestKey === 'TASK-DELEGATION-GUIDE') {
    console.info(`[SP] ${label} 로드 완료: ${fname} (${sp.length} chars)`);
    return sp;
  }

  const universal = await _loadUniversalIntegrityRaw();
  const taskGuide = await _loadTaskDelegationGuideRaw();
  const parts = [universal, taskGuide, sp].filter(Boolean);
  const combined = parts.join('\n\n---\n\n');
  console.info(`[SP] ${label} 로드 완료: ${fname} (${sp.length} chars` +
    (universal ? ` + UNIVERSAL-INTEGRITY ${universal.length} chars` : '') +
    (taskGuide ? ` + TASK-DELEGATION-GUIDE ${taskGuide.length} chars` : '') +
    (!universal && !taskGuide ? ' — 공통문서 없이' : '') + `)`);
  return combined;
}

// ── 원문만 로드(자동 상위계층 결합 없음) — 2026-07-19 신설 ──────────────
// 배경: expert-session.js의 _composeExpertPrompt()가 한 번의 페르소나
// 합성 안에서 _loadSpByKey()를 여러 번(UNIVERSAL-INTEGRITY 자체·공통
// 가드레일·의료 안전모듈·페르소나 SP) 호출했는데, _loadSpByKey()가 매번
// UNIVERSAL-INTEGRITY·TASK-DELEGATION-GUIDE를 자동으로 다시 앞에 붙이는
// 바람에 최종 합성 프롬프트에 그 두 문서가 최대 4번까지 중복 삽입되고
// 있었다(실사로 확인 — UNIVERSAL-INTEGRITY 시작 문구가 3회 반복). 여러
// SP를 한 번의 합성 안에서 이어붙이는 호출부는 이 함수로 원문만 받고,
// 공유 상위 계층(UNIVERSAL-INTEGRITY·TASK-DELEGATION-GUIDE 등)은 합성부
// 코드가 정확히 한 번만 직접 배치해야 한다. 단독으로 SP 하나만 로드하는
// 기존 호출부(K-Intent 등)는 계속 _loadSpByKey()를 그대로 쓴다 — 그
// 경우는 중복이 발생하지 않는다(호출이 1회뿐이므로).
export async function _loadSpRawByKey(manifestKey, label) {
  const manifest = await _loadManifest();
  const fname = manifest[manifestKey];
  if (!fname) throw new Error(`${label} manifest 키 없음: ${manifestKey}`);
  const res = await fetch(_SP_BASE + fname);
  if (!res.ok) throw new Error(`${label} SP 로드 실패: ${res.status} (${fname})`);
  const sp = await res.text();
  console.info(`[SP] ${label} 로드 완료(원문, 상위계층 미결합): ${fname} (${sp.length} chars)`);
  return sp;
}
