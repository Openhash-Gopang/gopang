/**
 * ui/send-message.js — 메시지 전송 라우팅
 */
import { aiActive, _peer, attachFile, setAttachFile } from '../core/state.js';
import { _isRegistered } from '../core/auth.js';
import { appendBubble } from './bubble.js';
import { activateAI } from '../ai/toggle.js';
import { _sendP2P } from '../p2p/webrtc.js';
import { callAI } from '../ai/call-ai.js';
import { _showRegisterFlow } from './register-flow.js';

export function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}
export function updateSendBtn() {
  const v = document.getElementById('msg-input').value.trim();
  const hasInput = !!(v || attachFile);
  document.getElementById('send-btn').disabled = !hasInput;

  // 등록 사용자 + 대화 상대 없음 + AI 비활성 → 입력 시작 시 AI 자동 활성화
  if (hasInput && !aiActive && !_peer && _isRegistered()) {
    activateAI(true);
  }
}
export function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

// ── 메시지 전송 ─────────────────────────────────────────

export async function sendMessage() {
  const inp  = document.getElementById('msg-input');
  const text = inp.value.trim();
  if (!text && !attachFile) return;

  // 첫 메시지 전송 시 GPS 요청 — PWA 배너가 이미 처리된 후이므로 충돌 없음
  if (!_locationReady && !_locationPending) _initLocation();

  const capturedFile = attachFile;   // 전송 전에 캡처 (removeAttach 전)

  // 사용자 버블 — 이미지 첨부 시 미리보기 포함
  if (capturedFile && capturedFile.type.startsWith('image/')) {
    const objUrl = URL.createObjectURL(capturedFile);
    const imgId  = 'img-' + Date.now();
    appendBubble('user',
      `${text ? text + '<br>' : ''}<img id="${imgId}" src="${objUrl}"
        style="max-width:220px;max-height:180px;border-radius:10px;
               margin-top:${text?'6px':'0'};display:block">`, true);
    // CSP 친화적: 인라인 onload 대신 JS 이벤트 리스너
    requestAnimationFrame(() => {
      const imgEl = document.getElementById(imgId);
      if (imgEl) imgEl.addEventListener('load', () => URL.revokeObjectURL(objUrl), { once: true });
    });
  } else {
    if (text) appendBubble('user', text);
    if (capturedFile) appendBubble('user', `📎 ${capturedFile.name}`, false);
  }

  // ★ history.push(user)는 callAI 내부에서 처리
  //   (callAI 진입 전에 push하면 isFirstTurn 감지 오작동)
  inp.value = '';
  inp.style.height = 'auto';
  updateSendBtn();
  removeAttach();

  // ── 대화 상대 분기 ─────────────────────────────────────
  if (text) {
    if (_peer) {
      // 사람과 대화 → WebRTC P2P 전송 (등록/비등록 모두 가능)
      await _sendP2P(text);
    } else if (aiActive) {
      // AI와 대화
      await callAI(text, capturedFile, null);
    } else if (_isRegistered()) {
      // 등록 사용자 + 대화 상대 없음 → AI 자동 활성 후 전달
      activateAI(true);
      await callAI(text, capturedFile, null);
    } else {
      // 미등록(Guest) → 등록 유도
      appendBubble('ai',
        '<b>고팡 아이디를 등록</b>하면 AI 비서와 대화할 수 있습니다.<br>' +
        '<span style="font-size:12px;color:var(--txt3)">상단 <b>AI</b> 버튼을 탭하여 등록하세요.</span>',
        true
      );
    }
    return;
  }

  // text 없는 경우 (이미지만) → callAI로 처리
  if (capturedFile && aiActive) {
    await callAI('', capturedFile);
  }
}

// ── 고팡 파이프라인 백그라운드 실행 ─────────────────────
// 대화 중 결과를 표시하지 않음 — 사용자 요청 시 showRiskAnalysis() 호출
let _lastPipelineResult = null;

async function _runPipelineBackground(text) {
  try {
    const { runPipeline } = await import('./src/ai-secretary/pipeline.js');
    const result = await runPipeline(
      { content: text, senderId: 'user', attachment: attachFile ?? null },
      {}
    );
    _lastPipelineResult = result;

    // OpenHash ref는 상태 바에만 조용히 업데이트
    if (result?.anchorHash) {
      const el = document.getElementById('hash-ref');
      if (el) el.textContent = result.anchorHash.slice(0, 8) + '…';
    }

    // S3 감지 시 즉시 경고 (위험 등급 S3만 예외적으로 즉시 표시)
    if (result?.riskResult?.level === 'S3') {
      const chip = riskChip('S3', result.riskResult.legalFlags ?? []);
      appendBubble('ai',
        `🛑 위험 감지 — 즉시 확인이 필요합니다. ${chip}`, true);
    }
  } catch (e) {
    // 파이프라인 오류는 콘솔에만 기록, 사용자에게 표시하지 않음
    console.warn('[Pipeline]', e.message);
  }
}

// 사용자 요청 시 분석 결과 표시 (예: "분석 결과 보여줘")
function showRiskAnalysis() {
  if (!_lastPipelineResult) {
    appendBubble('ai', '분석된 메시지가 없습니다.');
    return;
  }
  const r   = _lastPipelineResult.riskResult;
  const chip = riskChip(r?.level ?? 'S0', r?.legalFlags ?? []);
  appendBubble('ai',
    `분석 완료 ${chip}${r?.legalFlags?.length ? '<br>' + r.legalFlags.join(' · ') : ''}`,
    true);
}

