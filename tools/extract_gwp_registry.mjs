// tools/extract_gwp_registry.mjs
// ─────────────────────────────────────────────────────────────
// gwp-registry.js는 ESM이 아니라 브라우저 전역 스크립트(window.X=X)라
// Node import/require로 직접 읽을 수 없다. 정규식으로 재파싱하면
// check_service_table_sync.py와 같은 버그(entry 경계를 못 지키는 문제)가
// 재발할 위험이 있으므로, vm 모듈로 실제 JS 엔진에서 격리 실행해
// window를 최소 스텁으로 채워주고 실제 배열/함수를 그대로 뽑아낸다.
// 원본 파일은 전혀 수정하지 않는다(읽기 전용 실행).
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = fs.readFileSync(path.join(ROOT, 'gwp-registry.js'), 'utf-8');

// fetch()를 쓰는 loadPendingAgents/resolveSpUrls는 브라우저 네트워크
// 의존 함수라 이 추출 목적(정적 표 생성)엔 필요 없다 — 스텁만 준다.
const sandboxWindow = {};
const context = {
  window: sandboxWindow,
  fetch: async () => { throw new Error('fetch는 이 추출 스크립트에서 사용되지 않음'); },
  console,
};
vm.createContext(context);
vm.runInContext(src, context, { filename: 'gwp-registry.js' });

// window.GWP_REGISTRY에 실제 배열이 그대로 실렸는지 확인 후 JSON 출력.
if (!Array.isArray(sandboxWindow.GWP_REGISTRY)) {
  console.error('추출 실패 — window.GWP_REGISTRY가 배열이 아님');
  process.exit(1);
}
console.log(JSON.stringify(sandboxWindow.GWP_REGISTRY, null, 2));
