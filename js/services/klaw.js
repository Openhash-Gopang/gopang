// ══════════════════════════════════════════════════════════════════
// services/klaw.js — K-Law 백그라운드 법적 리스크 감시
// ══════════════════════════════════════════════════════════════════
import { KLAW_COOLDOWN_MS } from '../../config.js';

// 런타임에 init()에서 주입
let _getCFG       = () => ({});
let _appendBubble = () => {};
let _recordPDV    = () => {};

export function initKlaw({ getCFG, appendBubble, recordPDV }) {
  _getCFG       = getCFG;
  _appendBubble = appendBubble;
  _recordPDV    = recordPDV;
}

let _lastCheck = 0;
let _busy      = false;

// ── monitor_prompt.txt 로드 ──────────────────────────────────────
async function getMonitorPrompt() {
  try {
    const r = await fetch('/klaw/prompts/monitor_prompt.txt');
    if (r.ok) return await r.text();
  } catch {}
  // 폴백: 인라인 최소 프롬프트
  return '당신은 법적 리스크 감지 AI입니다. 아래 내용에서 법적 리스크를 JSON으로만 반환하세요: {"level":"NONE|LOW|MEDIUM|HIGH|CRITICAL","summary":"","basis":"","action":""}';
}

// ── 메인 감시 함수 ───────────────────────────────────────────────
// source: 'chat' | 'service'
// payload: { userText, aiText } | PDV record
export async function klawReview(source, payload) {
  if (_busy || Date.now() - _lastCheck < KLAW_COOLDOWN_MS) return;
  _busy = true;
  _lastCheck = Date.now();

  try {
    const cfg    = _getCFG();
    const prompt = await getMonitorPrompt();
    const text   = typeof payload === 'string' ? payload
      : (payload.userText || '') + '\n' + (payload.aiText || '') + '\n' + (payload.summary || '');

    if (!text.trim() || text.length < 20) return;

    const res = await fetch(cfg.endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:      cfg.model,
        max_tokens: 300,
        system:     prompt,
        messages:   [{ role:'user', content:`[검토 대상]\n${text.slice(0, 2000)}` }],
        stream:     false,
      }),
    });

    const d      = await res.json();
    const raw    = d.choices?.[0]?.message?.content || d.content?.[0]?.text || '';
    const result = JSON.parse(raw.replace(/```json|```/g, '').trim());
    const level  = result.level || 'NONE';

    // PDV 기록 (모든 레벨)
    _recordPDV({
      type:      'klaw_monitor',
      serviceId: 'klaw',
      summary:   `K-Law 감시: ${level} — ${result.summary || ''}`,
      how:       'auto',
      why:       '법적 리스크 자동 감시',
    });

    // HIGH/CRITICAL만 채팅창에 경고 버블 표시
    if (level === 'HIGH' || level === 'CRITICAL') {
      const icon = level === 'CRITICAL' ? '🔴' : '🟠';
      _appendBubble('ai',
        `${icon} <b>K-Law 자동 감지 — ${level}</b><br>` +
        `${result.summary || ''}<br>` +
        `<small style="color:#8E8E93">근거: ${result.basis || ''}</small><br>` +
        `💡 ${result.action || '법률 전문가 상담 권고'}`,
        true
      );
    }

  } catch(e) { console.warn('[K-Law]', e.message); }
  finally    { _busy = false; }
}
