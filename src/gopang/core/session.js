/**
 * core/session.js — 세션 대화 저장 + OpenHash 앵커링 (앱 숨김 시 1회)
 *
 * 설계 원칙:
 *   - 세션 단위 = 앱 진입 ~ 앱 종료(visibilitychange / pagehide)
 *   - 세션 안의 모든 대화 + 거래를 하나의 데이터 뭉치로 묶어
 *     SHA-256 → hashChain.anchor() 1회 기록
 *   - 원문은 localStorage에 보존, OpenHash에는 해시만 기록
 */
import { history, PROXY } from './state.js';
import { USER_GUID } from './state.js';

const DOMAIN_PATTERNS = {
  ECO: /금융|투자|세금|결제|송금|보험|연금|대출|환율|주식|가계부/,
  MED: /병원|의사|약|진료|처방|응급|건강|수술|의료|코로나|백신/,
  EDU: /학교|강의|시험|특허|논문|학습|교육|수업|입학|졸업/,
  TRN: /배달|택배|교통|버스|지하철|택시|운전|물류|배송|주차/,
  MKT: /구매|쇼핑|거래|계약|부동산|임대|판매|상품|가격|주문/,
  GOV: /민원|등본|신고|행정|정부|공공|허가|면허|신청|공무원/,
  JUS: /법|소송|재판|경찰|변호사|판결|고소|계약서|법원|범죄/,
  IND: /제조|건설|농업|공장|생산|설비|작업|현장|제품|원자재/,
  ENV: /환경|에너지|재활용|기후|탄소|오염|태양광|전기|가스|수도/,
  CUL: /여행|관광|스포츠|영화|음악|게임|식당|카페|취미|문화/,
  SOC: /복지|고용|실업|육아|노인|장애|사회보험|지원금|봉사/,
  IOT: /냉장고|세탁기|에어컨|차량|스마트홈|IoT|사물|기기|센서/,
};

function _classifyDomain(text) {
  for (const [code, re] of Object.entries(DOMAIN_PATTERNS)) {
    if (re.test(text)) return code;
  }
  return 'ETC';
}

async function _saveSessionOnce() {
  if (history.length < 2) return;

  // ── 도메인 분류 ──────────────────────────────────────
  const domainCount = {};
  for (const msg of history) {
    const d = _classifyDomain(String(msg.content));
    domainCount[d] = (domainCount[d] || 0) + 1;
  }
  const primaryDomain = Object.entries(domainCount).sort((a,b)=>b[1]-a[1])[0][0];
  const now   = new Date().toISOString();
  const today = now.slice(0, 10);
  const key   = `gopang_history_${USER_GUID}_${today}`;

  // ── 세션 데이터 구성 ─────────────────────────────────
  // system 메시지 제외 — 사용자/AI 발화 + 거래만 포함
  const sessionMessages = history.filter(m => m.role !== 'system');
  const sessionId = `SES-${(USER_GUID || 'anon').replace(/:/g,'').slice(0,12)}-${Date.now()}`;

  const sessionData = {
    sessionId,
    guid:      USER_GUID || null,
    startedAt: history.find(m => m.role !== 'system')?.ts || now,
    endedAt:   now,
    domain:    primaryDomain,
    turns:     sessionMessages.length,
    messages:  sessionMessages,   // 대화 + 거래 전체 원문
  };

  // ── localStorage 저장 (원문 보존) ────────────────────
  try {
    const existing = JSON.parse(localStorage.getItem(key) || '[]');
    existing.push({
      ts:      now,
      domain:  primaryDomain,
      turns:   sessionMessages.length,
      summary: sessionMessages.slice(-4),
      sessionId,
    });
    localStorage.setItem(key, JSON.stringify(existing));
    console.log(`[Session] localStorage 저장 완료 — 영역: ${primaryDomain}, 턴: ${sessionMessages.length}`);
  } catch(e) {
    console.warn('[Session] localStorage 저장 실패:', e.message);
  }

  // ── OpenHash 앵커링 ───────────────────────────────────
  // 설계 원칙:
  //   - 세션 원본 → vault.js IndexedDB (AES-256-GCM, 기기 내 보관)
  //   - contentHash = SHA-256(sessionRaw) → OpenHash에만 기록
  //   - userSig = gopangWallet.sign(contentHash) → 신원 증명
  //     "나는 이 세션 데이터가 정확함을 서명한다"
  //   - anchor(contentHash, [userSig], sessionId)
  //     entryHash = SHA-256(prevHash + contentHash + userSig + blockHeight)
  //   - prevHash: 이전 세션 체인 상태 (위변조 방지 핵심)
  try {
    const { anchor }       = await import('../../openhash/hashChain.js');
    const { storeMessage } = await import('../../pdv/vault.js');

    // 세션 원문 직렬화
    const sessionRaw = JSON.stringify(sessionData);

    // ① vault.js — 원본 저장 (IndexedDB AES-256-GCM)
    //    원본 보관 주체 = 사용자 기기
    //    검증 시: vault에서 원본 꺼냄 → SHA-256 재계산 → entryHash 대조
    await storeMessage({
      msgId:     sessionId,
      senderId:  USER_GUID || 'anon',
      role:      'session',
      content:   sessionRaw,
      timestamp: now,
      riskLevel: 'S0',
      sessionId,
    }).catch(e => console.warn('[Session] vault 저장 실패 (무시):', e.message));

    // ② contentHash = SHA-256(sessionRaw)
    const buf         = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sessionRaw));
    const sessionHash = Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');

    // ③ Ed25519 서명 — gopangWallet.sign()이 없으면 guid로 fallback
    let userSig = USER_GUID || 'anon';
    try {
      if (window.gopangWallet?.sign) {
        userSig = await window.gopangWallet.sign(sessionHash);
      }
    } catch (e) {
      console.warn('[Session] Ed25519 서명 실패, guid로 대체:', e.message);
    }

    // ④ anchor(contentHash, [userSig], sessionId)
    const result = await anchor(sessionHash, [userSig], sessionId);

    console.log(`[Session] OpenHash 앵커링 완료`,
      '| sessionId:', sessionId,
      '| domain:', primaryDomain,
      '| turns:', sessionMessages.length,
      '| sessionHash:', sessionHash.slice(0,16) + '...',
      '| entryHash:', result.entryHash.slice(0,16) + '...',
      '| layer:', result.layer);

    // ── pdv_log 기록 (block_hash = entryHash → openhash_anchored: true)
    if (PROXY) {
      fetch(`${PROXY}/pdv/report`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          report: {
            svc:          'gopang',
            type:         'session_end',
            reporter_svc: 'gopang-session',
            session_id:   sessionId,
            block_hash:   result.entryHash,
            who:   { ipv6: USER_GUID },
            when:  now,
            where: 'https://gopang.net',
            what:  `세션 종료 — ${primaryDomain} 영역, ${sessionMessages.length}턴`,
            how:   '앱 종료(visibilitychange / pagehide)',
            why:   '세션 데이터 PDV 기록',
          },
        }),
      }).catch(e => console.warn('[Session] pdv_log 전송 실패 (무시):', e.message));
    }

  } catch(e) {
    console.warn('[Session] OpenHash 앵커링 실패 (무시):', e.message);
  }
}

let _sessionSaved = false;
export function _saveOnce() {
  if (_sessionSaved) return;
  _sessionSaved = true;
  // async — fire-and-forget (visibilitychange/pagehide 핸들러가 await 불가)
  _saveSessionOnce().catch(e => console.warn('[Session] _saveOnce 오류:', e.message));
}
