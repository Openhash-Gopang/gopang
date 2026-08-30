// §7 트리거 문구 ↔ 라우팅 키워드 사전 정합성 검증 (2026-07-24) — SP
// 템플릿의 §7 예시 대화("사용자: ...")가 실제로 그 도메인으로 라우팅
// 되는지 정적으로 검사한다. 오늘 발견한 버그(신체검사/경찰서/반려동물/
// 예방접종)의 재발을 막기 위한 회귀 테스트.
// 실행: node --test src/tests/national-s7-keyword-consistency.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = path.resolve(import.meta.dirname, '..', '..', 'prompts', 'gov-tree');
const ROUTER_PATH = path.resolve(import.meta.dirname, '..', 'gopang', 'gov', 'gov-router.js');

const routerSrc = fs.readFileSync(ROUTER_PATH, 'utf-8');
const dictMatch = routerSrc.match(/const _NAT_AGENCY_DOMAIN_KEYWORDS = \{([\s\S]*?)\n\};/);
assert.ok(dictMatch, '_NAT_AGENCY_DOMAIN_KEYWORDS를 gov-router.js에서 찾지 못함');
const kwMap = {};
for (const line of dictMatch[1].split('\n')) {
  // ★ 2026-08-30 수정 — 원래 정규식(`\],?\s*$`)은 줄 끝에 인라인 주석이
  // 붙은 항목(예: immigration/mma/veterans, `],  // ★ 2026-08-23 ...`)을
  // 못 파싱해 조용히 빈 배열로 취급했다 — 실제 런타임 사전은 정상인데
  // 이 테스트만 오탐하는 파서 결함이었다(직접 확인: 세 도메인 다
  // _kwMatch로는 정상 매칭됨). 줄 끝 `// ...` 주석을 선택적으로 허용한다.
  const m = line.match(/^\s*(\w+):\s*\[(.*?)\],?\s*(?:\/\/.*)?$/);
  if (m) kwMap[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map(x => x[1]);
}

const templatesDir = path.join(ROOT, '09-national', 'agencies', 'templates');
const files = fs.readdirSync(templatesDir).filter(f => /^SP-NAT-.*-TEMPLATE.*\.md$/.test(f));

for (const fname of files) {
  const content = fs.readFileSync(path.join(templatesDir, fname), 'utf-8');
  const s7 = content.match(/## §7\. PDV_REQUEST[\s\S]*?(?=\n## §8|$)/);
  if (!s7) continue; // §7이 없는 파일(Group B)은 검사 대상 아님
  const triggerMatch = s7[0].match(/> 사용자: "(.*?)"/);
  const domainMatch = s7[0].match(/requesting_sp=SP-NAT-(\w+)/);
  if (!triggerMatch || !domainMatch) continue;
  const trigger = triggerMatch[1];
  const domain = domainMatch[1].toLowerCase();

  test(`${fname}: §7 트리거 "${trigger}"가 ${domain} 도메인 키워드 사전과 매칭됨`, () => {
    const kws = kwMap[domain] || [];
    const matched = kws.some(k => trigger.includes(k));
    assert.ok(matched,
      `"${trigger}"가 ${domain} 사전(${JSON.stringify(kws)})의 어떤 키워드와도 안 맞음 — ` +
      `§7 예시 문구를 실제로 발화하면 이 도메인으로 라우팅되지 않는다는 뜻`);
  });
}
