/**
 * services/klaw.js — K-Law 백그라운드 감시 파이프라인
 */
import { _klawBusy, _klawLastCheck, KLAW_COOLDOWN_MS,
         setKlawBusy, setKlawLastCheck } from '../core/state.js';
import { CFG } from '../core/config.js';
import { appendBubble } from '../ui/bubble.js';
import { _recordPDV } from '../pdv/record.js';

// ══════════════════════════════════════════════════════════════════════
// K-Law 백그라운드 감시 파이프라인 v1.0
//
// 역할: 사용자가 요청하지 않아도 모든 대화·서비스 결과를
//       자동으로 검토하여 법적/분쟁 리스크를 감지합니다.
//
// 트리거:
//   1. callAI() 완료 후 → 대화 내용 자동 검토
//   2. _recordPDV() 호출 후 → 서비스 결과 자동 검토
//
// 결과:
//   - RISK_HIGH/RISK_CRITICAL → 채팅창에 경고 버블 즉시 표시
//   - RISK_LOW/RISK_MEDIUM   → PDV에만 조용히 기록
//   - RISK_NONE              → 무시
// ══════════════════════════════════════════════════════════════════════

// ── K-Law 감시 상태 ────────────────────────────────────────────────

// K-Law Monitor 프롬프트 캐시 (감시용 경량 프롬프트 — v15.1 판결예측과 별개)
let _klawMonitorPrompt = null;
async function _getKlawPrompt() {
  if (_klawMonitorPrompt) return _klawMonitorPrompt;
  try {
    const res = await fetch('/klaw/prompts/monitor_prompt.txt');
    if (res.ok) {
      _klawMonitorPrompt = await res.text();
      console.info('[K-Law Monitor] 프롬프트 로드 완료');
      return _klawMonitorPrompt;
    }
  } catch(e) { console.warn('[K-Law Monitor] 프롬프트 로드 실패:', e.message); }
  return null;
}

// ── 리스크 레벨 정의 ────────────────────────────────────────────────
const KLAW_RISK = {
  NONE:     { label: null,              show: false },
  LOW:      { label: '🟢 낮음',         show: false },  // PDV만 기록
  MEDIUM:   { label: '🟡 검토 권고',    show: false },  // PDV만 기록
  HIGH:     { label: '🟠 주의 필요',    show: true  },  // 채팅창 경고
  CRITICAL: { label: '🔴 법적 리스크',  show: true  },  // 채팅창 즉시 경고
};

// ── 메인: K-Law 백그라운드 검토 ────────────────────────────────────
// source: 'conversation' | 'service'
// payload: 검토할 텍스트 또는 서비스 데이터
export async function _klawReview(source, payload) {
  // 쿨다운 및 중복 실행 방지
  const now = Date.now();
  if (_klawBusy) return;
  if (now - _klawLastCheck < KLAW_COOLDOWN_MS) return;

  // K-Law 프롬프트 로드
  const klawPrompt = await _getKlawPrompt();
  if (!klawPrompt) return;

  setKlawBusy(true);
  setKlawLastCheck(now);

  try {
    // ── 검토 대상 텍스트 구성 ────────────────────────────────
    let reviewText = '';

    if (source === 'conversation') {
      // 최근 대화 5턴 추출 (system 제외)
      const recent = (window._gopangHistory || [])
        .filter(m => m.role !== 'system')
        .slice(-10)
        .map(m => `[${m.role === 'user' ? '사용자' : 'AI'}] ${m.content}`)
        .join('\n');
      if (!recent || recent.length < 50) { setKlawBusy(false); return; }
      reviewText = `## 검토 대상: 고팡 대화 내용\n\n${recent}`;

    } else if (source === 'service') {
      // 서비스 완료 결과 (pdvData)
      reviewText = `## 검토 대상: ${payload.service || '서비스'} 처리 결과\n\n` +
        `서비스: ${payload.serviceId}\n` +
        `요약: ${payload.summary}\n` +
        `데이터: ${JSON.stringify(payload.data || {}, null, 2)}`;
    }

    if (!reviewText) { setKlawBusy(false); return; }

    // ── K-Law API 호출 (백그라운드) ──────────────────────────
    // monitor_prompt.txt가 출력 형식을 완전히 정의하므로 추가 지시 불필요
    const klawSystemPrompt = klawPrompt;

    const res = await fetch(CFG.endpoint + '/deepseek', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:       CFG.model,
        max_tokens:  512,
        temperature: 0.1,   // 일관된 법적 판단을 위해 낮게 설정
        messages: [
          { role: 'system',  content: klawSystemPrompt },
          { role: 'user',    content: reviewText },
        ],
      }),
    });

    if (!res.ok) { setKlawBusy(false); return; }
    const data = await res.json();
    const raw  = data.choices?.[0]?.message?.content || '{}';
    const clean = raw.replace(/```json|```/g, '').trim();

    let result;
    try { result = JSON.parse(clean); }
    catch { setKlawBusy(false); return; }

    const level = result.risk_level || 'NONE';
    const risk  = KLAW_RISK[level] || KLAW_RISK.NONE;

    console.info(`[K-Law Monitor] 감시 완료 — ${level}: ${result.summary || '이상 없음'}`);

    // ── PDV에 감시 결과 기록 (모든 레벨) ────────────────────
    if (level !== 'NONE') {
      _recordPDV({
        type:       'klaw_monitor',
        serviceId:  'klaw',
        service:    'K-Law',
        summary:    `[${level}] ${result.summary || ''}`,
        data:       result,
        source:     source,
        ts:         new Date().toISOString(),
      });
    }

    // ── HIGH/CRITICAL: 채팅창에 경고 버블 표시 ──────────────
    if (risk.show && result.summary) {
      const icon  = level === 'CRITICAL' ? '🔴' : '🟠';
      const html  =
        `<div style="border-left:3px solid ${level==='CRITICAL'?'#C01C28':'#e37400'};` +
        `padding:10px 12px;border-radius:4px;background:${level==='CRITICAL'?'#FEE2E2':'#FFF7ED'}">` +
        `<div style="font-size:11px;font-weight:700;color:${level==='CRITICAL'?'#C01C28':'#e37400'};` +
        `letter-spacing:.5px;margin-bottom:6px">` +
        `${icon} K-Law 자동 감지 — ${risk.label}</div>` +
        `<div style="font-size:14px;color:#1A202C;margin-bottom:${result.detail?'8px':'0'}">${result.summary}</div>` +
        (result.detail  ? `<div style="font-size:12px;color:#4A5568;margin-bottom:6px">${result.detail}</div>` : '') +
        (result.action  ? `<div style="font-size:12px;font-weight:600;color:#0057A8">💡 ${result.action}</div>` : '') +
        `</div>`;
      appendBubble('ai', html, true);
    }

  } catch(e) {
    console.warn('[K-Law] 감시 오류 (무시):', e.message);
  } finally {
    setKlawBusy(false);
  }
}

// ── 대화 히스토리 전역 노출 (K-Law 감시용) ──────────────────────────
// callAI() 내부의 history를 K-Law가 읽을 수 있도록
Object.defineProperty(window, '_gopangHistory', {
  get: () => typeof history !== 'undefined' ? history : [],
  configurable: true,
});

// ══════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════
