/**
 * core/session.js — 세션 대화 저장 (앱 숨김 시 1회)
 */
import { history } from './state.js';
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

function _saveSessionOnce() {
  if (history.length < 2) return;
  const domainCount = {};
  for (const msg of history) {
    const d = _classifyDomain(String(msg.content));
    domainCount[d] = (domainCount[d] || 0) + 1;
  }
  const primaryDomain = Object.entries(domainCount).sort((a,b)=>b[1]-a[1])[0][0];
  const today = new Date().toISOString().slice(0,10);
  const key   = `gopang_history_${USER_GUID}_${today}`;
  try {
    const existing = JSON.parse(localStorage.getItem(key) || '[]');
    existing.push({
      ts: new Date().toISOString(),
      domain: primaryDomain,
      turns:  history.length,
      summary: history.slice(-4),
    });
    localStorage.setItem(key, JSON.stringify(existing));
    console.log(`[Session] 저장 완료 — 영역: ${primaryDomain}, 턴: ${history.length}`);
  } catch(e) {
    console.warn('[Session] 저장 실패:', e.message);
  }
}

let _sessionSaved = false;
export function _saveOnce() {
  if (_sessionSaved) return;
  _sessionSaved = true;
  _saveSessionOnce();
}
