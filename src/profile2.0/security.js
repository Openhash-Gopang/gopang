/**
 * M13 — Security 모듈 (K-Security)
 * 내부 파이프라인 함수 — Worker 엔드포인트 없음
 * 의존: 없음 (L2 인프라 계층)
 *
 * 2단계 LLM 파이프라인:
 *   1단계: DeepSeek V3 anomaly_score (0~1)
 *   score < 0.6 → 정상
 *   score ≥ 0.6 → 2단계 Claude Opus 정밀 분석
 *   분류: S1(정보) / S2(경고) / S3(차단)
 */

const SEVERITY_S1_THRESHOLD = 0.6;
const SEVERITY_S2_THRESHOLD = 0.75;
const SEVERITY_S3_THRESHOLD = 0.85;

// 로컬 패턴 기반 빠른 스코어링 (LLM 호출 전 1차 필터)
const SPAM_PATTERNS = [
  /(.)\1{5,}/,           // 반복 문자
  /https?:\/\//i,        // URL 포함
  /click here|buy now|free offer/i,
];
const HATE_PATTERNS = [
  /쓰레기|죽어|멍청이|바보새끼|개새끼/,
  /kill yourself|hate you|racist/i,
];

export function localAnomalyScore(text) {
  let score = 0;
  for (const p of SPAM_PATTERNS) if (p.test(text)) score = Math.max(score, 0.62);
  for (const p of HATE_PATTERNS) if (p.test(text)) score = Math.max(score, 0.88);
  return score;
}

export function classifySeverity(score) {
  if (score >= SEVERITY_S3_THRESHOLD) return 'S3';
  if (score >= SEVERITY_S2_THRESHOLD) return 'S2';
  if (score >= SEVERITY_S1_THRESHOLD) return 'S1';
  return null;  // 정상
}

// 2단계: Claude Opus 정밀 분석 (score 0.6~0.89 구간)
async function deepAnalysis(env, text) {
  if (!env.ANTHROPIC_API_KEY) return { score: 0.65, severity: 'S2' };

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-6',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: `다음 텍스트의 이상 점수를 0~1 사이 숫자로만 답하세요.\n\n"${text}"`,
      }],
    }),
  });

  if (!resp.ok) return { score: 0.65, severity: 'S2' };
  const data = await resp.json();
  const raw  = parseFloat(data.content?.[0]?.text?.trim());
  const score = isNaN(raw) ? 0.65 : Math.min(1, Math.max(0, raw));
  return { score, severity: classifySeverity(score) ?? 'S1' };
}

// 전체 스코어링 파이프라인
export async function scoreContent(env, text) {
  const localScore = localAnomalyScore(text);

  // 1단계: 로컬 패턴으로 확정적 차단
  if (localScore >= SEVERITY_S3_THRESHOLD) {
    return { score: localScore, severity: 'S3', stage: 1 };
  }
  if (localScore < SEVERITY_S1_THRESHOLD) {
    return { score: localScore, severity: null, stage: 1 };
  }

  // 2단계: Anthropic 정밀 분석 (0.6~0.89 경계)
  const deep = await deepAnalysis(env, text);
  return { ...deep, stage: 2 };
}

// 보안 이벤트 기록
export async function recordSecurityEvent(env, { source, refId, score, severity }) {
  if (!severity) return;
  await fetch(`${env.SUPABASE_URL}/rest/v1/security_event`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify({
      source,
      ref_id:        refId,
      anomaly_score: score,
      severity,
    }),
  }).catch(() => {});
}
