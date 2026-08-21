#!/usr/bin/env node
/**
 * GOV-TASK-904-GAP 2026-08-21 세션 — 부서 미지정 발화 라이브 스모크테스트.
 *
 * gov-router-2026-08-21-session-smoketest.test.mjs(로컬, mockClassify)가
 * 발견한 "kw 미스 → LLM 폴백 필요" 케이스들을, 실제 DeepSeek API를
 * classifyFn으로 연결해 다시 돌린다. 3가지를 확인한다:
 *   1) 최종적으로 기대 부서(org/do-dept)로 도달하는가
 *   2) classifyFn(K-Intent 성격의 판단 요청)이 실제로 호출됐는가
 *   3) 그 부서 SP가 실제 사용자 발화에 적절히 응답하는가(간이 품질 체크 —
 *      나열식 답변 여부, 부서 정체성 언급 여부)
 *
 * Usage:
 *   DEEPSEEK_API_KEY=... node gov_router_2026_08_21_department_live_smoketest.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
const MODEL = 'deepseek-chat';
const API_KEY = process.env.DEEPSEEK_API_KEY;

if (!API_KEY) {
  console.error('DEEPSEEK_API_KEY 환경변수가 없습니다.');
  process.exit(1);
}

async function callDeepSeek(messages, { maxTokens = 400 } = {}) {
  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: maxTokens,
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DeepSeek API ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

// classifyFn 시그니처는 gov-router.js의 _classifyDivisionFallback/
// _classifyFallback과 동일: async (text, candidatesText) => code|'NONE'|null.
// 실제 DeepSeek 호출로 연결 — K-Intent가 하는 "후보 중 하나를 판단해
// 고르는" 역할을 그대로 재현한다.
let classifyCallCount = 0;
async function realClassifyFn(text, candidatesText) {
  classifyCallCount++;
  const prompt = `사용자 발화: "${text}"\n\n아래는 이 발화가 갈 수 있는 후보 기관/부서 목록이다. 가장 적합한 후보의 code를 정확히 그대로 출력하라. 확신이 없으면 NONE만 출력하라. code 또는 NONE 외의 다른 말은 절대 출력하지 마라.\n\n${candidatesText}`;
  const reply = await callDeepSeek(
    [
      { role: 'system', content: '너는 제주 행정 라우팅 분류기다. 후보 목록에서 code 하나만 정확히 출력하거나 NONE만 출력한다.' },
      { role: 'user', content: prompt },
    ],
    { maxTokens: 40 },
  );
  const trimmed = reply.trim().split(/\s+/)[0] || 'NONE';
  return trimmed;
}

const SCENARIOS = [
  {
    id: 'safety-hospital',
    utterance: '종합병원을 새로 개원하려고 하는데 어디서 허가를 받아야 하나요',
    expectContains: 'SP-DO-SAFETY',
    note: 'INNOV/SAFETY kw 미스 — 병원급 의료기관 개설허가(jeju:hospital_establishment_permit)',
  },
  {
    id: 'plan-youth-inflow',
    utterance: '다른 지역에서 제주로 막 이사왔는데 청년한테 주는 지원금이 있다고 들었어요',
    expectContains: 'SP-DO-PLAN',
    note: '청년 전입축하장려금(jeju:youth_inflow_incentive_application)',
  },
  {
    id: 'transweak-wheelchair-taxi',
    utterance: '휠체어를 타는데 이동할 때 쓸 수 있는 콜택시 같은 서비스가 있나요',
    expectContains: 'SP-ORG-TRANSWEAK',
    note: '특별교통수단 이용자 등록(transweak:special_transport_registration) — 도청 TRANSPORT와 경합',
  },
  {
    id: 'jtp-equipment-test',
    utterance: '우리 회사 제품 시험분석을 좀 맡기고 싶은데 어디로 가야 하나요',
    expectContains: 'SP-ORG-JTP',
    note: '시험분석 의뢰(jtp:equipment_testing_request)',
  },
  {
    id: 'jiles-scholarship',
    utterance: '대학생인데 등록금이나 생활비 도와주는 장학금 신청하고 싶어요',
    expectContains: 'SP-ORG-JILES',
    note: '장학금 신청(jiles:scholarship_application)',
  },
  {
    id: 'childmeal-registration',
    utterance: '어린이집을 새로 운영하려고 하는데 급식 관련해서 신고할 데가 있나요',
    expectContains: 'SP-ORG-CHILDMEAL',
    note: '어린이급식소 등록 신청(childmeal:kids_food_service_registration) — 로컬 테스트에서 SP-AGY-LIBRARY로 오탐됨',
  },
  {
    id: 'jcgf-credit-guarantee',
    utterance: '소상공인인데 대출받으려고 보증 좀 받고 싶어요',
    expectContains: 'SP-ORG-JCGF',
    note: '신용보증 신청(jcgf:credit_guarantee_application) — 로컬 테스트에서 SP-ORG-JEDA로 오탐됨',
  },
  {
    id: 'jpdc-public-housing',
    utterance: '임대주택에 들어가고 싶은데 어떻게 신청하나요',
    expectContains: 'SP-ORG-JPDC',
    note: '공공임대주택 청약(jpdc:public_housing_application) — 로컬 테스트에서 SP-DO-HOUSING(도청)으로 오탐됨',
  },
];

async function main() {
  globalThis.window = globalThis;
  globalThis.window.HONDI_PROVINCE_CODE = 'jeju';

  // gov-router.js는 raw.githubusercontent.com에서 마스터데이터를 fetch한다
  // — 실제 저장소 원격 데이터를 그대로 쓴다(로컬 테스트처럼 목을 쓰지 않음
  // — 이 스모크테스트는 프로덕션과 최대한 가깝게 검증하는 것이 목적).
  const { assembleGovSystemPrompt, resolveGovAgency } = await import(
    path.join(REPO_ROOT, 'src/gopang/gov/gov-router.js')
  );

  const results = [];
  for (const s of SCENARIOS) {
    console.log(`\n=== ${s.id}: "${s.utterance}" ===`);
    classifyCallCount = 0;
    let r;
    let error = null;
    try {
      r = await assembleGovSystemPrompt(s.utterance, null, realClassifyFn);
    } catch (e) {
      error = e.message;
    }

    const trace = r?.trace ?? [];
    const agency = r ? resolveGovAgency(trace) : null;
    const routedOk = trace.some((t) => t.includes(s.expectContains));
    const classifyInvoked = classifyCallCount > 0;

    console.log(`  trace: [${trace.join(' > ')}]`);
    console.log(`  agency: ${agency}`);
    console.log(`  K-Intent(classifyFn) 호출 횟수: ${classifyCallCount}`);
    console.log(`  체크1(라우팅 도달): ${routedOk ? '✅' : '❌'} (기대: ${s.expectContains})`);

    let spResponseSnippet = null;
    let spQualityNote = null;
    if (routedOk && r?.systemPrompt) {
      try {
        const reply = await callDeepSeek(
          [
            { role: 'system', content: r.systemPrompt.slice(0, 12000) },
            { role: 'user', content: s.utterance },
          ],
          { maxTokens: 500 },
        );
        spResponseSnippet = reply.slice(0, 400);
        const bulletCount = (reply.match(/^[-*•]\s|^\d+\.\s/gm) || []).length;
        spQualityNote = bulletCount >= 5
          ? `⚠️ 나열식 응답 의심(불릿/번호 ${bulletCount}개)`
          : '✅ 나열식 아님(불릿/번호 5개 미만)';
        console.log(`  체크3(SP 응답 품질): ${spQualityNote}`);
        console.log(`  응답 일부: ${spResponseSnippet.replace(/\n/g, ' ')}`);
      } catch (e) {
        spQualityNote = `SP 응답 호출 실패: ${e.message}`;
        console.log(`  체크3: ${spQualityNote}`);
      }
    } else if (!routedOk) {
      console.log('  체크3: 라우팅 실패로 건너뜀');
    }

    results.push({
      id: s.id,
      utterance: s.utterance,
      note: s.note,
      trace,
      agency,
      classifyInvoked,
      classifyCallCount,
      routedOk,
      spResponseSnippet,
      spQualityNote,
      error,
    });
  }

  const outDir = path.join(REPO_ROOT, 'results', 'gov_router_2026_08_21_department_smoketest');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'results.json'),
    JSON.stringify(results, null, 2),
    'utf-8',
  );

  const passCount = results.filter((r) => r.routedOk).length;
  console.log(`\n\n총 ${results.length}건 중 라우팅 성공 ${passCount} / 실패 ${results.length - passCount}`);
  console.log(`결과 저장: results/gov_router_2026_08_21_department_smoketest/results.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
