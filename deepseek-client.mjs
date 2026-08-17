// deepseek-client.js
// ═══════════════════════════════════════════════════
// DeepSeek API 호출 래퍼 — regulation-classifier-extractor.js의
// callClaudeFn 인터페이스(문자열 프롬프트 → 문자열 응답)에 맞춘 어댑터.
// OpenAI 호환 API라 /chat/completions 엔드포인트를 그대로 쓴다.
// ═══════════════════════════════════════════════════

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

/**
 * @param {string} apiKey - DEEPSEEK_API_KEY (GitHub Actions secret에서 주입)
 * @returns {function(string): Promise<string>} callClaudeFn 호환 함수
 */
export function createDeepSeekCaller(apiKey) {
  return async function callDeepSeek(prompt) {
    const res = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: '너는 한국 행정규칙 원문에서 절차적 의무 항목을 정확히 추출하는 법률 보조 도구다. 반드시 지시된 JSON 형식으로만 답하고, 원문에 없는 내용을 지어내지 않는다.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1, // 추출 작업이라 낮게(창작성 최소화)
        // ★ 2026-08-17 수정 ★ max_tokens: 2000이었을 때 실측(로컬 실행)
        // 에서 "공익신고 처리 및 신고자 보호 등에 관한 규정" 추출 시
        // "Unterminated string in JSON" 오류로 응답이 중간에 잘렸다 —
        // 항목이 여러 개고 legal_basis·division_type_guess 등 필드가
        // 많은 규정에서는 2000 토큰이 부족했다. 8000으로 확대.
        max_tokens: 8000,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`DeepSeek API 호출 실패: HTTP ${res.status} ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('DeepSeek 응답에 content가 없음: ' + JSON.stringify(data).slice(0, 300));
    // 모델이 코드블록(```json ... ```)으로 감싸는 경우가 흔해서 벗겨낸다
    return content.replace(/^```json\s*|\s*```$/g, '').trim();
  };
}
