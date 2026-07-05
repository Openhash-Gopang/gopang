// ═══════════════════════════════════════════════════════════
// gwp-registry.js v2.2 — 혼디 서비스 레지스트리
//
// v2.0 변경사항:
//   - type 필드 추가: 'inline' | 'tab' | 'tool'
//   - sp_url 필드: Agent 전용 SP 파일 경로
//   - status 필드: 'active' | 'pending' (임시등록)
//   - threshold 필드: 서비스별 매칭 임계값
//   - pending_agents: L1에서 로드한 임시등록 항목 동적 병합
// v2.1 변경사항:
//   - sp_url 하드코딩 제거 → sp_key 필드로 대체
//   - 빌드 시 자동 생성되는 prompts/manifest.json 을 런타임에 fetch
//   - resolveSpUrls() 로 레지스트리 초기화 (앱 시작 시 1회)
// v2.2 변경사항 (2026-06-29, manifest.json 정합화 점검 반영):
//   - kinsurance.sp_key: 'SP-14_kinsurance' → 'SP-16_kinsurance'
//     (K-Insurance가 K-Cleaner와의 SP-14 번호 충돌로 SP-16 재배정됨에 따라
//      manifest.json 키가 바뀌었고, 이 파일의 sp_key가 그 변경을 따라가지
//      못해 깨져 있었음 — resolveSpUrls() 호출 시 sp_url이 null이 되는 버그)
// ═══════════════════════════════════════════════════════════

const _RAW = 'https://raw.githubusercontent.com/Openhash-Gopang/gopang/main/prompts/';

// ── manifest 기반 SP URL resolver ──────────────────────────
// prompts/manifest.json 은 CI 빌드 시 tools/build_manifest.py 가 자동 생성.
// 키 형식: "SP-NN_slug" (예: "SP-05_kmarket", "SP-14_kcleaner")
let _manifest = null;

async function _loadManifest() {
  if (_manifest) return _manifest;
  try {
    const res = await fetch('/prompts/manifest.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('manifest fetch 실패: ' + res.status);
    _manifest = await res.json();
    console.info('[Registry] manifest 로드 완료 (' + Object.keys(_manifest).length + '개 항목)');
  } catch (e) {
    console.warn('[Registry] manifest 로드 실패, sp_url 은 null 유지:', e.message);
    _manifest = {};
  }
  return _manifest;
}

// 레지스트리의 sp_key → sp_url 를 manifest 기준으로 채운다.
// 앱 초기화 시 한 번만 호출하면 됨 (loadPendingAgents 와 함께 호출 권장).
async function resolveSpUrls() {
  const manifest = await _loadManifest();
  for (const entry of GWP_REGISTRY) {
    if (!entry.sp_key) continue;
    const fname = manifest[entry.sp_key];
    entry.sp_url = fname ? _RAW + fname : null;
    if (!fname) {
      console.warn('[Registry] manifest 에 키 없음 (sp_url=null):', entry.sp_key);
    }
  }
}

const GWP_REGISTRY = [

  // ── 긴급·재난 (EMG) — tab: 사용자 명시적 확인 필요 ────────
  {
    id: 'kemergency', name: 'K-Emergency', category: 'EMG',
    type: 'tab',      // 긴급은 반드시 새 탭 — 사용자가 직접 확인
    url: 'https://911.hondi.net/webapp.html',
    sp_key: 'SP-02_k119',
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
    url: 'https://klaw.hondi.net/webapp.html',
    sp_key: 'SP-01_klaw',
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
    url: 'https://police.hondi.net/webapp.html',
    sp_key: 'SP-03_kpolice',
    status: 'active', priority: 1, threshold: 0.65,
    description: '실시간 범죄 예측·대응. 경찰청 연동.',
    triggers: [
      '경찰','112 신고','범죄','절도','폭행','성범죄','스토킹',
      // ⚠ '강도'는 '운동 강도'·'필라테스 강도'(세기/intensity 의미)와 동음이의어
      // 충돌 위험이 실측 확인됨(2026-07-05, 300건 사고실험). 제거하면 실제
      // 강도 신고("강도예요 도와주세요") recall이 떨어지므로 남기되, 이 필드를
      // 다시 프로그램적 매칭에 쓸 경우(현재는 미사용) 문맥 없이 단독 매칭하지
      // 않도록 주의할 것.
      '협박','납치','강도','가정폭력','수사','증거',
    ],
  },

  {
    id: 'ksecurity', name: 'K-Security', category: 'JUS',
    type: 'inline',
    url: 'https://security.hondi.net/webapp.html',
    sp_key: 'SP-15_ksecurity',
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
    url: 'https://health.hondi.net/webapp.html',
    sp_key: 'SP-04_khealth',
    status: 'active', priority: 3, threshold: 0.70,
    description: '실거래 기반 건강 위험도 산정. 병원 연동.',
    triggers: [
      '아파요','병원','증상','처방','진단','의사','수술','약',
      '건강','검진','통증','열이 나','기침','두통','복통','혈압','당뇨',
      '암','응급실','입원','처방전','예방접종','우울증','불면증',
    ],
  },

  // ── 교육 (EDU) — inline ────────────────────────────────────
  {
    id: 'kedu', name: 'K-School', category: 'EDU',
    type: 'inline',
    url: 'https://school.hondi.net/webapp.html',
    sp_key: 'SP-09_kschool',
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
    url: 'https://gdc.hondi.net/webapp.html',
    sp_key: 'SP-08_gdc',
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
    url: 'https://stock.hondi.net/webapp.html',
    sp_key: 'SP-11_kstock',
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
    url: 'https://insurance.hondi.net/webapp.html',
    sp_key: 'SP-16_kinsurance',  // v2.2 — SP-14에서 재배정됨 (K-Cleaner 번호충돌 해소)
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
    url: 'https://tax.hondi.net/webapp.html',
    sp_key: 'SP-07_ktax',
    status: 'active', priority: 6, threshold: 0.75,
    description: '재무제표 실시간 자동 생성·신고.',
    triggers: [
      '세금','부가세','종합소득세','세무','납부',
      '연말정산','환급','세무조사','관세','재산세','증여세','상속세',
      '국세청','홈택스','전자세금계산서',
    ],
  },

  // ── 시장·거래 (MKT) — tab: 주문·결제 트랜잭션 ────────────
  {
    id: 'kcommerce', name: 'K-Market', category: 'MKT',
    type: 'tab',
    url: 'https://market.hondi.net/webapp.html',
    // sp_key: 'SP-05_kmarket' — 2026-07-05 실사 결과 죽은 참조로 확인됨.
    // resolveSpUrls()/entry.sp_url을 실제로 읽는 호출부가 코드베이스
    // 어디에도 없고(엔진 주석 언급뿐), market/webapp.html은 이 레지스트리를
    // 거치지 않고 market 레포 자체의 raw.githubusercontent.com URL을
    // 직접 fetch한다(현재 SP-KMARKET-v2_6.txt). 진짜 SP는 market 레포가
    // 정본이며, gopang의 SP-05_kmarket_*.txt/SP-05_kcommerce_*.txt는
    // 전부 사용되지 않는 레거시 문서로 정리됨(DEPRECATED_SP-05_kmarket-kcommerce.txt
    // 참조). sp_key 필드 자체는 하위호환을 위해 남겨두되 신뢰하지 말 것.
    sp_key: 'SP-05_kmarket',
    status: 'active', priority: 7, threshold: 0.75,
    description: '자율 구매대행 에이전트 — 판매자 탐색·비교·거래·환불/반품/예약 처리 전담.',
    triggers: [
      '주문','배달','음식','쇼핑','구매','상점','시장','시켜','맛집',
      '식당','상품','가격','예약','반품','교환','거래','마켓',
    ],
  },

  // ── 교통·물류 (TRN) — inline ───────────────────────────────
  {
    id: 'ktransport', name: 'K-Traffic', category: 'TRN',
    type: 'inline',
    url: 'https://traffic.hondi.net/webapp.html',
    sp_key: 'SP-06_ktraffic',
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
    url: 'https://logistics.hondi.net/webapp.html',
    sp_key: 'SP-13_klogistics',
    status: 'active', priority: 8, threshold: 0.70,
    description: '주문-출고-배송-반품 전 과정 자동화.',
    triggers: [
      '배송','물류','택배','운송','창고','재고','통관',
      '반품','배송 추적','배송 지연','국제 배송','관세',
    ],
  },

  // ── 제주 지방행정 (GOV-JEJU) — tab: 자체 4단계 SP 체인 라우터 ──
  // sp_key 없음 — jeju.hondi.net이 jeju-router.js로 요청마다 SP를 동적 조립.
  {
    id: 'jeju', name: '제주도청 AI', category: 'GOV',
    type: 'tab',
    url: 'https://jeju.hondi.net/webapp.html',
    status: 'active', priority: 8, threshold: 0.70,
    description: '제주도청·시청·읍면동 행정 안내. JEJU-GOV-COMMON SP 트리 자체 라우팅.',
    triggers: [
      '제주도청','제주특별자치도청','제주시청','서귀포시청','제주특별자치도',
      '제주 행정','도지사','제주콜센터',
      '애월읍','조천읍','구좌읍','한경면','추자면','우도면',
      '대정읍','남원읍','성산읍','안덕면','표선면',
      '일도1동','일도2동','이도1동','이도2동','삼도1동','삼도2동',
      '용담1동','용담2동','건입동','화북동','삼양동','봉개동',
      '아라동','오라동','연동','노형동','외도동','이호동','도두동',
      '송산동','정방동','중앙동','천지동','효돈동','영천동','동홍동',
      '서홍동','대륜동','대천동','중문동','예래동','한림읍',
    ],
  },

  // ── 행정 (GOV) — inline ────────────────────────────────────
  {
    id: 'kgov', name: 'K-Public', category: 'GOV',
    type: 'inline',
    url: 'https://public.hondi.net/webapp.html',
    sp_key: 'SP-10_kpublic',
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
    url: 'https://democracy.hondi.net/webapp.html',
    sp_key: 'SP-12_kdemocracy',
    status: 'active', priority: 10, threshold: 0.70,
    description: '고팡 직접 민주주의 플랫폼 (DAWN).',
    triggers: [
      '투표','안건','민주주의','정책','DAWN','의결',
      '안건 제안','고팡 운영','배심원','찬성','반대','발의',
    ],
  },

  // ── 사업체 지원 (BIZ) — tab: K-Market 관리자 대시보드 내 어드바이저 ──
  // 2026-07-05 신설. k-business(글로벌 표준)+business-kr(한국모듈) 상속.
  // sp_key 없음 — /business/relay(worker.js)가 UNIVERSAL-INTEGRITY+
  // UNIVERSAL-common+k-business+business-kr을 서버에서 직접 조립한다
  // (jeju와 동일하게 manifest 방식이 아닌 자체 relay 엔드포인트 방식).
  // 이 항목이 없으면 "재무제표 작성해줘" 같은 발화가 라우터에서 매칭될
  // 서비스가 없어 gopang-direct로만 빠지는 사각지대가 있었음(실사로 확인).
  {
    id: 'kbusiness', name: 'K-Business', category: 'BIZ',
    type: 'tab',
    url: 'https://market.hondi.net/kmarket_admin_dashboard.html',
    status: 'active', priority: 9, threshold: 0.70,
    description: '사업체 재무제표·세금·고용(4대보험) 보조. K-Market 판매자 연동.',
    triggers: [
      '재무제표','손익계산서','대차대조표','사업자 세금','부가세 신고',
      '사업자 세무','법인세','4대보험','급여 계산','직원 급여',
      '고용보험 신고','인건비','경영 분석','매출 분석','사업 자금',
      '노란우산공제','사업자 회계','원천세','판매자 정산',
    ],
  },

  // ── 환경 (ENV) — inline (신고) ────────────────────────────
  {
    id: 'fiil-kcleaner', name: 'K-Cleaner', category: 'ENV',
    type: 'inline',
    url: 'https://fiil.kr/webapp.html',
    sp_key: 'SP-14_kcleaner',
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
// BUG-FIX(2026-07-03): AGENT-COMMON SP §9는 실제로 [GWP: klaw]/[GWP: ktax]
// 두 개만 정확한 id로 가르치고, 세 번째 예시([GWP: kmarket])조차 실제
// 레지스트리 id(kcommerce)와 다르다. 나머지 13개 서비스는 SP가 id를 아예
// 가르치지 않아 모델이 추측해야 하는데, 레지스트리 id 절반가량(kedu, kgdc,
// kfinance, ktransport, kgov, kemergency 등)이 표시명과 다른 이름이라
// 추측이 구조적으로 틀리기 쉽다. getService()가 정확히 일치하는 id만
// 받아주면 이 경우 탭이 열렸다가 조용히 닫히므로(_parseAgentTags의 else
// 분기), 흔히 나올 법한 오표기를 정답으로 되돌리는 별칭 해석을 안전망으로
// 추가한다. worker.js의 SVC_ALIAS(레지스트리id→저장소slug, 백엔드 PDV
// 라우팅용)와는 방향이 반대다 — 이건 "모델이 낼 법한 오표기→레지스트리id".
const SVC_ID_ALIAS = {
  kmarket:     'kcommerce',   // SP §9 예시 자체가 이렇게 잘못 가르침(확인됨)
  kschool:     'kedu',
  gdc:         'kgdc',
  kstock:      'kfinance',
  ktraffic:    'ktransport',
  kpublic:     'kgov',
  k119:        'kemergency',
  kcleaner:    'fiil-kcleaner',
  'k-cleaner': 'fiil-kcleaner',
  // 하이픈형 표기(모델이 종종 "K-Law" 표시명을 그대로 슬러그화할 때)
  'k-law':       'klaw',
  'k-tax':       'ktax',
  'k-police':    'kpolice',
  'k-security':  'ksecurity',
  'k-health':    'khealth',
  'k-insurance': 'kinsurance',
  'k-logistics': 'klogistics',
  'k-democracy': 'kdemocracy',
  'k-market':    'kcommerce',
  'k-traffic':   'ktransport',
  'k-public':    'kgov',
  'k-119':       'kemergency',
  'k-emergency': 'kemergency',
  'k-business':  'kbusiness',
  'business':    'kbusiness',
};

function getService(id) {
  if (!id) return null;
  return GWP_REGISTRY.find(s => s.id === id)
      || GWP_REGISTRY.find(s => s.id === SVC_ID_ALIAS[id])
      || null;
}
function getByCategory(cat) {
  return GWP_REGISTRY.filter(s => s.category === cat);
}
// ※ matchService()(구 window.gwpMatch/window.matchService)는 2026-07-05
// 제거됨 — 호출부 0건 확인(SP-00-ROUTER와 함께 죽은 코드였음). 실제
// 라우팅은 AGENT-COMMON이 [GWP:]/[EXPERT:] 태그로 직접 수행한다.
// 자세한 경위는 prompts/archive/SP-00-ROUTER-DEPRECATED.md 참조.

// ── 전역 노출 ──────────────────────────────────────────────────
window.GWP_REGISTRY    = GWP_REGISTRY;
window.getService      = getService;
window.getByCategory   = getByCategory;
window.loadPendingAgents = loadPendingAgents;
window.resolveSpUrls     = resolveSpUrls;
window.injectToolFns     = injectToolFns;
