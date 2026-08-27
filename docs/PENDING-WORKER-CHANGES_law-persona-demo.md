# worker.js 반영 대기 변경사항 — 법률 전문가 페르소나 라이브 데모

> **상태: 대기 중 (worker.js에 아직 미반영)**
> personas/law.html의 체험 시뮬레이션이 실제 DeepSeek 호출로 동작하려면
> 아래 내용을 worker.js에 한 번에 반영해야 합니다. `/health/demo-consult`
> (2026-08-27 신설, domains/medical.html용)와 동일한 원칙을 그대로 따릅니다:
> - 클라이언트 코드에 DEEPSEEK_API_KEY를 절대 넣지 않는다 — 키는 항상
>   Worker env를 통해 서버 사이드에서만 사용
> - 공개 데모 엔드포인트라 별도 인증이 없으므로, 입력 길이 제한과 낮은
>   max_tokens으로 1차 남용 방지. 본격적인 IP 레이트리밋은 후속 작업(TODO)
> - DEEPSEEK_URL / DEEPSEEK_MODEL 상수는 이미 worker.js:933,942에 정의돼
>   있어 재사용(중복 정의 금지)

## 1. 추가할 핸들러 (worker.js 아무 곳에나, 기존 handleHealthDemoConsult 근처 권장)

```js
// ═══════════════════════════════════════════════════════════
// 법률 전문가 페르소나 데모 상담 — personas/law.html의 체험 시뮬레이션에서 호출.
// handleHealthDemoConsult와 동일한 원칙(클라이언트에 키 없음, 공개 엔드포인트라
// 입력 길이·max_tokens 제한, 정식 IP 레이트리밋은 후속 TODO)을 그대로 따른다.
//
// 각 시스템 프롬프트는 실제 운영 SP(prompts/SP_*.md)의 "핵심 경계"(법정 업무
// 대행 불가, 초안/설명까지만) 원칙을 그대로 반영한 축약판이다 — 운영 SP 원문은
// SP-COMMON-02 등 공용 계층을 전제로 하므로 이 독립 데모에는 그대로 옮기지 않고,
// 하드룰만 뽑아 재작성했다(_HEALTH_DEMO_TRIAGE_SYSTEM과 동일한 접근).
// ═══════════════════════════════════════════════════════════

const _LAW_DEMO_SYSTEM = {
  'judicial-scrivener': `당신은 K-Law AI 법무사 자문가입니다. 등기·경매·개인파산 절차와
서류 구성을 설명하고 초안 작성을 돕되, 실제 등기신청서류의 확정·제출 대행은
하지 않습니다 — 이는 등록 법무사의 법정 업무입니다.
핵심 경계: "절차를 설명하고 초안을 함께 정리"하는 것과 "서류를 확정해 실제
제출을 대행"하는 것은 다릅니다. 이 페르소나는 항상 전자에 머뭅니다.
사용자의 상황(부동산 매매/상속/경매 등)을 확인한 뒤, 필요한 서류 목록과
일반적 절차, 등록면허세 등 대략적 비용 항목을 안내하십시오. 구체적 세액·서식은
등기소·법무사 확인이 필요하다는 점을 답변 끝에 명시하십시오.`,

  appraiser: `당신은 K-Law AI 감정평가사 자문가입니다. 부동산·동산·무형자산 가치평가
원리와 절차, 공시지가 체계를 설명하되, 실제 법정 감정평가서 작성·서명·발급은
하지 않습니다 — 이는 등록 감정평가사가 감정평가법에 따라서만 할 수 있는
법정 업무입니다.
핵심 경계: "평가 방법론과 대략적 참고치를 설명"하는 것과 "법적 효력을 갖는
감정평가액을 확정"하는 것은 다릅니다. 이 페르소나는 항상 전자에 머뭅니다.
사용자의 평가 목적(담보/경매/보상/일반 참고)을 먼저 확인한 뒤 그에 맞는
평가 기준과 절차를 안내하십시오.`,

  'loss-adjuster': `당신은 K-Law AI 손해사정사 자문가입니다. 보험금 산정 절차·손해액
평가 원리·보험사와의 이견 대응 절차를 설명하되, 실제 손해사정서 작성·서명,
보험사와의 최종 합의 대리는 하지 않습니다 — 이는 등록 손해사정사의 법정
업무입니다.
핵심 경계: "손해사정 절차와 산정 원리를 설명"하는 것과 "실제 보험금 액수를
확정"하는 것은 다릅니다. 보험사 측 손해사정과 독립 손해사정의 이해관계
차이가 있을 수 있다는 점을 인식하고, 한쪽 입장만 강화하지 않습니다.`,

  'labor-attorney': `당신은 K-Law AI 공인노무사 자문가입니다. 임금·근로시간·해고·
산업재해·노동위원회 구제신청 절차를 자문하되, 실제 노동위원회 대리 출석,
진정서·구제신청서 제출 대행은 하지 않습니다 — 등록 공인노무사의 위임
업무입니다.
핵심 경계: "노동관계법 해석과 절차를 설명"하는 것과 "실제 사건을 대리"하는
것은 다릅니다. 근로자·사용자 어느 쪽 입장으로도 치우치지 않습니다.`,

  'customs-broker': `당신은 K-Law AI 관세사 자문가입니다. 수출입 통관 절차,
관세율표(HS Code) 분류 원리, FTA 원산지 증명 개념을 설명하되, 실제
수출입신고서 작성·제출, 관세청 통관 대리는 하지 않습니다 — 등록 관세사
전속 업무입니다.
핵심 경계: "통관 절차·세율 구조를 설명"하는 것과 "실제 관세액을 확정"하는
것은 다릅니다. 정확한 세율·품목분류는 관세청 사전심사를 통해서만
확정된다는 점을 답변에 포함하십시오.`,
};

const _LAW_DEMO_COMMON_SUFFIX = `

반드시 아래 JSON 스키마로만 답하십시오(설명 텍스트 금지):
{
  "situation_summary": "사용자 상황을 1~2문장으로 요약",
  "guidance": "절차·원리에 대한 일반적 안내(3~5문장, 결론을 확정하지 않는 톤)",
  "needed_items": ["다음 단계에서 필요한 서류·정보 1~4개"],
  "final_authority_note": "확정·서명·대행은 등록 전문가 전속이라는 안내 문장"
}`;

async function _lawDemoCallDeepseek(env, systemPrompt, userMsg) {
  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}` },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: systemPrompt + _LAW_DEMO_COMMON_SUFFIX },
        { role: 'user', content: userMsg },
      ],
      max_tokens: 500,
      stream: false,
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek 호출 실패(HTTP ${res.status})`);
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || '{}';
  const cleaned = raw.replace(/^```json\s*|```\s*$/g, '').trim();
  return JSON.parse(cleaned);
}

// POST /law/demo-consult  body: { persona: "judicial-scrivener"|"appraiser"|"loss-adjuster"|"labor-attorney"|"customs-broker", message: "..." }
async function handleLawDemoConsult(request, env, corsHeaders) {
  if (request.method !== 'POST') return _err(405, 'METHOD_NOT_ALLOWED', 'POST만 허용', corsHeaders);
  if (!env.DEEPSEEK_API_KEY) return _err(500, 'DEEPSEEK_KEY_MISSING', 'DEEPSEEK_API_KEY secret 미설정', corsHeaders);

  let body;
  try { body = await request.json(); } catch (e) { return _err(400, 'BAD_JSON', '요청 본문 파싱 실패', corsHeaders); }

  const persona = (body?.persona || '').trim();
  const message = (body?.message || '').trim();
  if (!_LAW_DEMO_SYSTEM[persona]) return _err(400, 'UNKNOWN_PERSONA', '지원하지 않는 persona', corsHeaders);
  if (!message) return _err(400, 'MISSING_MESSAGE', 'message 필드 필수', corsHeaders);
  if (message.length > 500) return _err(400, 'MESSAGE_TOO_LONG', '상담 내용은 500자 이내로 입력해 주세요', corsHeaders);

  let result;
  try {
    result = await _lawDemoCallDeepseek(env, _LAW_DEMO_SYSTEM[persona], message);
  } catch (e) {
    return new Response(
      JSON.stringify({ status: 'upstream_error', message: '상담 생성 중 오류', detail: e.message }),
      { status: 502, headers: corsHeaders }
    );
  }

  return new Response(JSON.stringify({ source: 'live', persona, result }), { headers: corsHeaders });
}
```

## 2. 라우트 등록 (기존 `/health/demo-consult` 등록 줄 근처, worker.js:11632 부근)

```js
    // ── 법률 전문가 페르소나 데모 상담 (personas/law.html 체험 시뮬레이션) ──
    if (pathname === '/law/demo-consult') return handleLawDemoConsult(request, env, corsHeaders);
```

## 3. 프런트엔드 호출 규약 (참고용 — personas/law.html 쪽에서 이미 이 규약으로 작성됨)

```
POST https://hondi-proxy.tensor-city.workers.dev/law/demo-consult
Content-Type: application/json

{ "persona": "judicial-scrivener", "message": "<사용자가 입력한 상황 설명>" }
```

응답 성공 시:
```
{ "source": "live", "persona": "judicial-scrivener", "result": { situation_summary, guidance, needed_items, final_authority_note } }
```

## 체크리스트 (반영 시)

- [ ] `_LAW_DEMO_SYSTEM` / `_LAW_DEMO_COMMON_SUFFIX` / `_lawDemoCallDeepseek` / `handleLawDemoConsult` 추가
- [ ] `/law/demo-consult` 라우트 등록
- [ ] `DEEPSEEK_URL`/`DEEPSEEK_MODEL` 중복 정의 없는지 확인(이미 933/942줄에 존재)
- [ ] 배포 후 5개 persona 모두 curl로 스모크테스트
- [ ] (후속 TODO) IP 레이트리밋 — `_checkRateLimitN` 재사용 검토
