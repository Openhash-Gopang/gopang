// 국가기관 서비스 요청 100건 사고실험 (2026-07-24, 주피터 지시) —
// 전국 임의 지역 × 임의 국가기관 도메인 조합. 실제 마스터데이터
// (national-agency-master-data.json)로부터 ground truth를 계산해서
// "정적 인스턴스가 있으면 정확히 그 인스턴스가, 없으면 안전한 폴백(LAZY
// 실시간 검색 또는 정직한 정보없음 안내)이" 걸리는지 검증한다. 시나리오
// 자체는 fixtures/nat-100-scenarios.json에 고정돼 있다
// (gen_nat_100_scenarios.py로 재생성 가능, seed=42로 결정적).
//
// ★ 2026-08-30 수정 — 애초 이 테스트는 "정적 인스턴스 없으면 반드시
// SP-NATIONAL-LAZY(실시간 검색)로 가야 한다"고 단언했으나, 2026-08-08
// gov-router.js에 안전조치가 추가되며 그 전제가 바뀌었다: LAZY 실시간
// 검색이 대전·세종·경북·경기·대구의 해양경찰 문의를 전부 무관한
// "완도해양경찰서"로 잘못 매칭하는 사고가 실측 확인되어, 제주 외 도의
// 34개 국가기관 도메인은 이제 의도적으로 LAZY를 우회하고
// _NAT_NO_INFO_FALLBACK의 정직한 "[정보 없음] ... 정부24(gov.kr) 또는
// 110" 안내로 폴백한다(_makeGenericNationalEntries, gov-router.js
// 3599~3614줄 주석 참고). trace에는 여전히 SP-NAT-{DOMAIN}이 찍히지만
// 틀린 지사를 확신에 차서 말하는 것보다 안전한 설계이므로, 이 테스트도
// "LAZY 아니면 실패"가 아니라 "LAZY 또는 정직한 정보없음 안내"를
// 통과 조건으로 갱신한다(주피터님 확인, 2026-08-30).
// 실행: node --test src/tests/national-agency-100-scenarios.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis;

const ROOT = path.resolve(import.meta.dirname, '..', '..', 'prompts');
const SRC_ROOT = path.resolve(import.meta.dirname, '..', '..', 'src');

function readLocal(u) {
  const govTreeIdx = u.indexOf('prompts/gov-tree/');
  const promptsIdx = u.indexOf('prompts/');
  const srcIdx = u.indexOf('src/gopang/gov/');
  let p;
  if (govTreeIdx !== -1) p = path.join(ROOT, 'gov-tree', u.slice(govTreeIdx + 'prompts/gov-tree/'.length));
  else if (promptsIdx !== -1) p = path.join(ROOT, u.slice(promptsIdx + 'prompts/'.length));
  else if (srcIdx !== -1) p = path.join(SRC_ROOT, 'gopang/gov', u.slice(srcIdx + 'src/gopang/gov/'.length));
  else return null;
  p = p.split('?')[0];
  try { return fs.readFileSync(p, 'utf-8'); } catch { return null; }
}

globalThis.fetch = async (url) => {
  const content = readLocal(String(url));
  if (content === null) return { ok: true, text: async () => '{}', json: async () => ({}) };
  return { ok: true, text: async () => content, json: async () => JSON.parse(content) };
};

const { assembleGovSystemPrompt } = await import('../gopang/gov/gov-router.js');

const scenarios = JSON.parse(fs.readFileSync(
  path.join(import.meta.dirname, 'fixtures', 'nat-100-scenarios.json'), 'utf-8'));
const natMaster = JSON.parse(readLocal(
  'prompts/gov-tree/09-national/agencies/templates/national-agency-master-data.json'));
const staticCoverage = new Set(natMaster.기관목록.map(r => `${r.도코드}:${r.domain}`));

// 2026-07-24 발견 — "고소장 접수"처럼 police/prosecution 둘 다 정당하게
// 받는 자연어 중의성이 1건 있다(busan 기장군 사례) — 실패가 아니라
// 언어적 중의성이므로 알려진 예외로 명시한다(과잉 엄격화로 인한 향후
// 오탐 방지).
const KNOWN_AMBIGUOUS = new Set(['busan:prosecution:기장군 고소장 접수 어떻게 하나요']);

let pass = 0, fail = 0;
for (const s of scenarios) {
  test(`[${s.loc_code}/${s.domain}] ${s.text}`, async () => {
    const key = `${s.loc_code}:${s.domain}:${s.text}`;
    if (KNOWN_AMBIGUOUS.has(key)) return; // 알려진 언어적 중의성 — 스킵
    const r = await assembleGovSystemPrompt(s.text);
    const hasStatic = staticCoverage.has(`${s.loc_code}:${s.domain}`);
    const staticCode = `SP-NAT-${s.domain.toUpperCase()}`;
    const hitStatic = r.trace.includes(staticCode);
    const hitLazy = r.trace.some(t => t.startsWith('SP-NATIONAL-LAZY'));
    // 2026-08-08 안전조치(_makeGenericNationalEntries) 이후: 정적 데이터가
    // 없는 도에서도 도메인 자체는 SP-NAT-{DOMAIN}으로 매칭되지만, 실제
    // 레코드가 없으면 _NAT_NO_INFO_FALLBACK의 정직한 "[정보 없음]" 안내로
    // 내용이 대체된다. trace만 보면 hitStatic=true지만, 이는 확정 응답이
    // 아니라 안전한 폴백이므로 hasStatic=false 케이스의 정상 통과 경로로
    // 인정한다.
    const hitHonestFallback = hitStatic && !hasStatic && r.systemPrompt.includes('[정보 없음]');
    if (hasStatic) {
      assert.ok(hitStatic, `정적 인스턴스(${staticCode})가 있는데 안 잡힘 — trace: ${r.trace.join(' > ')}`);
    } else {
      assert.ok(hitLazy || hitHonestFallback,
        `정적 인스턴스 없는데 LAZY도 정직한 정보없음 안내도 안 잡힘 — trace: ${r.trace.join(' > ')}`);
    }
  });
}
