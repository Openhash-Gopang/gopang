// ═══════════════════════════════════════════════════════════
// gwp-registry.js v2.0 — 혼디 서비스 레지스트리
//
// v2.0 변경사항:
//   - type 필드 추가: 'inline' | 'tab' | 'tool'
//   - sp_url 필드: Agent 전용 SP 파일 경로
//   - status 필드: 'active' | 'pending' (임시등록)
//   - threshold 필드: 서비스별 매칭 임계값
//   - pending_agents: L1에서 로드한 임시등록 항목 동적 병합
// ═══════════════════════════════════════════════════════════

const _RAW = 'https://raw.githubusercontent.com/Openhash-Gopang/gopang/main/prompts/';

const GWP_REGISTRY = [

  // ── 긴급·재난 (EMG) — tab: 사용자 명시적 확인 필요 ────────
  {
    id: 'kemergency', name: 'K-Emergency', category: 'EMG',
    type: 'tab',      // 긴급은 반드시 새 탭 — 사용자가 직접 확인
    url: 'https://911.gopang.net/webapp.html',
    sp_url: _RAW + 'SP-02_k119_v2.0.txt',
    status: 'active', priority: 0, threshold: 0.60,
    description: '긴급 구조·재난 대응. 119·112 연계.',
    triggers: [
      '긴급','응급','119','112','살려줘','화재','불났어','구조','사고',
      '쓰러졌어','다쳤어','심정지','익사','지진','홍수','가스 누출','위험해',
    ],
  },

  // ── 법률 (JUS) — inline: 대화 맥락 필요 ───────────────────
  {
    id: 'klaw', name: 'K-Law', category: 'JUS',
    type: 'inline',
    url: 'https://klaw.gopang.net/webapp.html',
    sp_url: _RAW + 'SP-01_klaw_v1.0.txt',
    status: 'active', priority: 1, threshold: 0.70,
    description: 'AI 가상 판결문. K-Law v20.0. 1초·1,000원.',
    triggers: [
      '소송','고소','고발','판결','재판','법원','계약서','손해배상',
      '위법','불법','형사','민사','이혼','상속','부당해고','명예훼손',
      '저작권','사기','횡령','배임','변호사','법률','판례','헌법소원',
      '임금체불','산재','내용증명','고소장','형량','처벌',
    ],
  },

  {
    id: 'kpolice', name: 'K-Police', category: 'JUS',
    type: 'inline',
    url: 'https://police.gopang.net/webapp.html',
    sp_url: _RAW + 'SP-03_kpolice_v2.0.txt',
    status: 'active', priority: 1, threshold: 0.65,
    description: '실시간 범죄 예측·대응. 경찰청 연동.',
    triggers: [
      '경찰','112 신고','범죄','절도','폭행','성범죄','스토킹',
      '협박','납치','강도','가정폭력','수사','증거',
    ],
  },

  {
    id: 'ksecurity', name: 'K-Security', category: 'JUS',
    type: 'inline',
    url: 'https://security.gopang.net/webapp.html',
    sp_url: _RAW + 'SP-15_ksecurity_v1.0.txt', // ⚠️ 2026-06-28 확인: 이 파일이 prompts/에 존재하지 않음(SP-15는 vision 프롬프트뿐). SP 작성 전까지 pending 유지.
    status: 'pending', priority: 2, threshold: 0.70,
    description: '사이버 보안·개인정보 침해 대응.',
    triggers: [
      '해킹','피싱','스미싱','보이스피싱','계정 탈취','랜섬웨어',
      '악성코드','개인정보 유출','사이버 범죄','비밀번호 유출',
    ],
  },

  // ── 의료 (MED) — inline ────────────────────────────────────
  {
    id: 'khealth', name: 'K-Health', category: 'MED',
    type: 'inline',
    url: 'https://health.gopang.net/webapp.html',
    sp_url: _RAW + 'SP-04_khealth_v2.0.txt',
    status: 'active', priority: 3, threshold: 0.70,
    description: '실거래 기반 건강 위험도 산정. 병원 연동.',
    triggers: [
      '아파요','병원','증상','처방','진단','의사','수술','약',
      '건강','검진','통증','열','기침','두통','복통','혈압','당뇨',
      '암','응급실','입원','처방전','예방접종','우울증','불면증',
    ],
  },

  // ── 교육 (EDU) — inline ────────────────────────────────────
  {
    id: 'kedu', name: 'K-School', category: 'EDU',
    type: 'inline',
    url: 'https://school.gopang.net/webapp.html',
    sp_url: _RAW + 'SP-09_kschool_v2.0.txt',
    status: 'active', priority: 4, threshold: 0.70,
    description: 'AI 교수. 유치원~대학원 166개 과목.',
    triggers: [
      '공부','학습','교육','과목','진로','시험','강의','자격증',
      '논문','입학','졸업','취업','숙제','과제','수능','학점',
    ],
  },

  // ── 금융 (ECO) — inline (조회) / tab (결제) ────────────────
  {
    id: 'kgdc', name: 'GDC', category: 'ECO',
    type: 'tab',   // 결제·송금은 반드시 새 탭
    url: 'https://gdc.gopang.net/webapp.html',
    sp_url: _RAW + 'SP-08_gdc_v3.0.txt',
    status: 'active', priority: 5, threshold: 0.75,
    description: '무위험 자산 담보 디지털 화폐.',
    triggers: [
      'GDC','결제','송금','환전','이체','잔고','대출',
      '고팡 화폐','디지털 화폐','GDC 충전','글로벌 결제',
    ],
  },

  {
    id: 'kfinance', name: 'K-Stock', category: 'ECO',
    type: 'inline',
    url: 'https://stock.gopang.net/webapp.html',
    sp_url: _RAW + 'SP-11_kstock_v2.0.txt',
    status: 'active', priority: 5, threshold: 0.75,
    description: '89개 자산군 실시간 분석. 포트폴리오.',
    triggers: [
      '주식','투자','포트폴리오','ETF','자산','펀드','채권',
      '암호화폐','비트코인','환율','리밸런싱','절세','IRP','ISA',
      '배당주','공모주','수익률','재테크',
    ],
  },

  {
    id: 'kinsurance', name: 'K-Insurance', category: 'ECO',
    type: 'inline',
    url: 'https://insurance.gopang.net/webapp.html',
    sp_url: _RAW + 'SP-14_kinsurance_v1.0.txt',
    status: 'active', priority: 6, threshold: 0.70,
    description: '개인화 보험료 산정. 청구·심사 자동화.',
    triggers: [
      '보험','보장','청구','보험료','실손','자동차보험',
      '보험금','생명보험','화재보험','보험 가입','보험 해지',
    ],
  },

  {
    id: 'ktax', name: 'K-Tax', category: 'ECO',
    type: 'inline',
    url: 'https://tax.gopang.net/webapp.html',
    sp_url: _RAW + 'SP-07_ktax_v2.0.txt',
    status: 'active', priority: 6, threshold: 0.75,
    description: '재무제표 실시간 자동 생성·신고.',
    triggers: [
      '세금','부가세','종합소득세','세무','신고','납부',
      '연말정산','환급','세무조사','관세','재산세','증여세','상속세',
      '국세청','홈택스','전자세금계산서',
    ],
  },

  // ── 시장·거래 (MKT) — tab: 주문·결제 트랜잭션 ────────────
  {
    id: 'kcommerce', name: 'K-Market', category: 'MKT',
    type: 'tab',
    url: 'https://market.gopang.net/webapp.html',
    sp_url: _RAW + 'SP-05_kmarket_v2.0.txt', // 2026-06-24 K-Law v15.1 기반 전면 재작성판 (구 SP-05_kcommerce_v2.2.txt는 6/10 구버전 — 누락돼 있었음)
    status: 'active', priority: 7, threshold: 0.75,
    description: '판매자 이력 전용 수요 예측·주문.',
    triggers: [
      '주문','배달','음식','쇼핑','구매','상점','시장','시켜','맛집',
      '식당','상품','가격','예약','반품','교환','거래','마켓',
    ],
  },

  // ── 교통·물류 (TRN) — inline ───────────────────────────────
  {
    id: 'ktransport', name: 'K-Traffic', category: 'TRN',
    type: 'inline',
    url: 'https://traffic.gopang.net/webapp.html',
    sp_url: _RAW + 'SP-06_ktraffic_v2.0.txt',
    status: 'active', priority: 8, threshold: 0.75,
    description: '실시간 교통 흐름 예측·우회 경로.',
    triggers: [
      '택시','교통','차량','배차','길찾기','막히다','정체',
      '우회','도로','내비게이션','버스','지하철','주차',
    ],
  },

  {
    id: 'klogistics', name: 'K-Logistics', category: 'TRN',
    type: 'inline',
    url: 'https://logistics.gopang.net/webapp.html',
    sp_url: _RAW + 'SP-13_klogistics_v1.0.txt',
    status: 'active', priority: 8, threshold: 0.70,
    description: '주문-출고-배송-반품 전 과정 자동화.',
    triggers: [
      '배송','물류','택배','운송','창고','재고','통관',
      '반품','배송 추적','배송 지연','국제 배송','관세',
    ],
  },

  // ── 행정 (GOV) — inline ────────────────────────────────────
  {
    id: 'kgov', name: 'K-Public', category: 'GOV',
    type: 'inline',
    url: 'https://public.gopang.net/webapp.html',
    sp_url: _RAW + 'SP-10_kpublic_v2.0.txt',
    status: 'active', priority: 9, threshold: 0.70,
    description: '민원·행정·허가 AI 자동 처리.',
    triggers: [
      '민원','등본','주민등록','복지','행정','공공','허가',
      '시청','도청','구청','발급','증명서','전입신고','사업자 등록',
      '운전면허','여권','국민연금','고용보험',
    ],
  },

  {
    id: 'kdemocracy', name: 'K-Democracy', category: 'LEG',
    type: 'inline',
    url: 'https://democracy.gopang.net/webapp.html',
    sp_url: _RAW + 'SP-12_kdemocracy_v2.0.txt',
    status: 'active', priority: 10, threshold: 0.70,
    description: '고팡 직접 민주주의 플랫폼 (DAWN).',
    triggers: [
      '투표','안건','민주주의','정책','DAWN','의결',
      '안건 제안','고팡 운영','배심원','찬성','반대','발의',
    ],
  },

  // ── 환경 (ENV) — inline (신고) ────────────────────────────
  {
    id: 'fiil-kcleaner', name: 'K-Cleaner', category: 'ENV',
    type: 'inline',
    url: 'https://fiil.kr/webapp.html',
    sp_url: _RAW + 'SP-14_kcleaner_v1.2.txt',
    status: 'active', priority: 11, threshold: 0.65,
    description: '해안·도심 쓰레기 AI 자동 분석·신고.',
    triggers: [
      '쓰레기','환경','해안','분리수거','청소','오염','폐기물',
      '불법 투기','해변','해양 오염','폐수','불법 배출',
    ],
  },

  // ── Tool 목록 ──────────────────────────────────────────────
  // type: 'tool' — function calling 방식, url 없음
  {
    id: 'tool-web-search',
    name: '웹 검색',
    category: 'TOOL',
    type: 'tool',
    url: null,
    sp_url: null,
    status: 'active',
    priority: 20,
    threshold: 0.60,
    description: '실시간 웹 검색. SP 자동생성 시 의무 사용.',
    fn: null,  // routing-engine.js의 _webSearch로 연결 (런타임 주입)
    triggers: [
      '검색해줘','찾아줘','최신','뉴스','오늘','지금','실시간',
      '날씨','환율','주가','시세','최근',
    ],
  },

  {
    id: 'tool-calculator',
    name: '계산기',
    category: 'TOOL',
    type: 'tool',
    url: null,
    sp_url: null,
    status: 'active',
    priority: 21,
    threshold: 0.70,
    description: '수식 계산. function calling.',
    fn: null,
    triggers: ['계산','얼마','합계','퍼센트','%','환산'],
  },

];

// ── L1 pending_agents 동적 로드 (앱 시작 시 1회) ───────────────
// 다른 사용자가 임시 등록한 항목을 로드하여 GWP_REGISTRY에 병합
async function loadPendingAgents() {
  try {
    const L1_BASE = (typeof L1_URL !== 'undefined' ? L1_URL : '')
      .replace('/api/collections/profiles/records', '');
    if (!L1_BASE) return;

    const res = await fetch(
      `${L1_BASE}/api/collections/pending_agents/records?perPage=100`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return;

    const data = await res.json();
    const items = data.items || [];
    let added = 0;

    for (const item of items) {
      // 이미 있으면 건너뜀
      if (GWP_REGISTRY.find(s => s.id === item.id)) continue;
      GWP_REGISTRY.push({ ...item, type: item.type || 'inline' });
      added++;
    }

    if (added > 0) {
      console.info(`[Registry] pending_agents ${added}개 로드 완료`);
    }
  } catch (e) {
    console.warn('[Registry] pending_agents 로드 실패 (무시):', e.message);
  }
}

// ── Tool fn 런타임 주입 ────────────────────────────────────────
// routing-engine.js 로드 후 _webSearch 함수를 tool에 연결
function injectToolFns({ webSearch, calculator }) {
  const ws = GWP_REGISTRY.find(s => s.id === 'tool-web-search');
  if (ws && webSearch) ws.fn = webSearch;

  const calc = GWP_REGISTRY.find(s => s.id === 'tool-calculator');
  if (calc && calculator) calc.fn = calculator;
}

// ── 조회 함수 ──────────────────────────────────────────────────
function getService(id) {
  return GWP_REGISTRY.find(s => s.id === id) || null;
}
function getByCategory(cat) {
  return GWP_REGISTRY.filter(s => s.category === cat);
}
function matchService(text) {
  if (!text) return null;
  for (const svc of GWP_REGISTRY) {
    if ((svc.triggers || []).some(t => text.includes(t))) return svc;
  }
  return null;
}

// ── 전역 노출 ──────────────────────────────────────────────────
window.GWP_REGISTRY    = GWP_REGISTRY;
window.getService      = getService;
window.getByCategory   = getByCategory;
window.gwpMatch        = matchService;
window.matchService    = matchService;
window.loadPendingAgents = loadPendingAgents;
window.injectToolFns     = injectToolFns;
