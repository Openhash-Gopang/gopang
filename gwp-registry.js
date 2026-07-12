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
//   - 빌드 시 자동 생성되는 prompts/sp-catalog.json 을 런타임에 fetch
//   - resolveSpUrls() 로 레지스트리 초기화 (앱 시작 시 1회)
// v2.2 변경사항 (2026-06-29, manifest.json 정합화 점검 반영):
//   (2026-07-09: prompts/manifest.json → prompts/sp-catalog.json 개명, W-16)
//   - kinsurance.sp_key: 'SP-14_kinsurance' → 'SP-16_kinsurance'
//     (K-Insurance가 K-Cleaner와의 SP-14 번호 충돌로 SP-16 재배정됨에 따라
//      manifest.json(현 sp-catalog.json) 키가 바뀌었고, 이 파일의 sp_key가 그 변경을 따라가지
//      못해 깨져 있었음 — resolveSpUrls() 호출 시 sp_url이 null이 되는 버그)
// ═══════════════════════════════════════════════════════════

const _RAW = 'https://raw.githubusercontent.com/Openhash-Gopang/gopang/main/prompts/';

// ── manifest 기반 SP URL resolver ──────────────────────────
// prompts/sp-catalog.json 은 CI 빌드 시 tools/build_manifest.py 가 자동 생성.
// 키 형식: "SP-NN_slug" (예: "SP-05_kmarket", "SP-14_kcleaner")
let _manifest = null;

async function _loadManifest() {
  if (_manifest) return _manifest;
  try {
    const res = await fetch('/prompts/sp-catalog.json', { cache: 'no-cache' });
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

  // ── 2026-07-12 신설 — 250건 사고실험에서 발견된 커버리지 갭 해소
  // (SP-Author 프로세스 대행, 주피터님 지시). 은행상품(예적금·대출·
  // 카드·펀드상담)과 통신(요금제·인터넷·유심)을 다루는 SP가 21개
  // 목록 어디에도 없었다 — K-Stock(kfinance)은 투자·주식만,
  // GDC(kgdc)는 결제·송금만 담당. status: pending_review — 실제
  // 배포 저장소(bank.hondi.net/telecom.hondi.net)가 아직 없으므로
  // url은 예정 도메인만 적어두고, getService()가 이 status를 보고
  // 실제 라우팅에는 쓰지 않도록 해야 한다(AGENT-COMMON §3-0 ③ 원칙
  // — 승인·배포 전까지 이용자에게 서빙되지 않음). SP 초안은
  // prompts/SP-22_kbank_v1_0.md, prompts/SP-23_ktelecom_v1_0.md 참조.
  {
    id: 'kbank', name: 'K-Bank', category: 'ECO',
    type: 'inline',
    url: 'https://bank.hondi.net/webapp.html',  // ★ 미배포 — 저장소 없음
    sp_key: 'SP-22_kbank',
    status: 'pending_review', priority: 6, threshold: 0.70,
    description: '은행상품 안내(예적금·대출·신용카드·자동이체·청약) — 증권 매매체결은 kfinance 소관.',
    triggers: [
      '적금','예금','대출','신용카드','체크카드','자동이체',
      '청약통장','환전','인증서','한도','상환','펀드 상담',
    ],
  },
  {
    id: 'ktelecom', name: 'K-Telecom', category: 'UTL',
    type: 'inline',
    url: 'https://telecom.hondi.net/webapp.html',  // ★ 미배포 — 저장소 없음
    sp_key: 'SP-23_ktelecom',
    status: 'pending_review', priority: 6, threshold: 0.70,
    description: '통신 서비스 안내(요금제·인터넷·유심·로밍·결합상품·분실신고) — 단말기 자체 구매는 kcommerce 소관.',
    triggers: [
      '요금제','인터넷 설치','유심','로밍','결합상품','통신사',
      '휴대폰 분실','기기변경','와이파이','공유기','IPTV',
    ],
  },

  // ── 2026-07-12(2차) 신설 — 부동산 커버리지 갭(250건 사고실험 105-117번
  // 구간에서 발견). klaw(계약서 법률검토)·ktax(취득세)·kgov(전입신고·
  // 확정일자·등기부등본)·kbank(자동이체 설정)와 겹치지 않도록 범위를
  // 매물 탐색·중개연결·임대차관리로 좁힘. SP 초안은
  // prompts/SP-24_kestate_v1_0.md 참조.
  {
    id: 'kestate', name: 'K-Estate', category: 'ECO',
    type: 'inline',
    url: 'https://estate.hondi.net/webapp.html',  // ★ 미배포 — 저장소 없음
    sp_key: 'SP-24_kestate',
    status: 'pending_review', priority: 6, threshold: 0.70,
    description: '부동산 매물 탐색·등록·중개연결·임대차 계약관리 — 계약서 법률검토(klaw)·세금(ktax)·전입신고 등 행정(kgov)·자동이체 설정(kbank)은 각 소관 서비스로.',
    triggers: [
      '전세','월세','매매 매물','부동산','공인중개사','임대차',
      '계약 갱신','재건축','조합원','매물 등록','이사 갈 집',
    ],
  },

  // ── 2026-07-12 신설 — "판매자로 등록하고 싶다"(중고거래 매물 등록,
  // 서비스 제공자 등록 등)는 kcommerce(구매자용 webapp.html)로 보내면
  // 안 된다 — 250건 사고실험(#48/#57)에서 발견. 조사 결과 판매자 등록
  // 기능 자체는 이미 완비돼 있었다(desktop.html#seller — 서술형 입력→
  // SP-MKT_seller_site_v3.1이 구조화→/biz/catalog/sync로 TOFU+Ed25519
  // 서명 검증 후 라이브 등록). 빠진 건 AC가 이 경로로 갈 방법뿐이었다
  // — 별도 GWP id로 등록해 방향(구매 vs 판매)에 따라 다른 URL로 가게
  // 한다.
  {
    id: 'kcommerce_seller', name: 'K-Market(판매자 등록)', category: 'MKT',
    type: 'tab',
    url: 'https://market.hondi.net/desktop.html#seller',
    sp_key: null,  // AI가 아니라 desktop.html 자체의 서술형 입력폼 UI — GWP는 탭 오픈까지만
    status: 'active', priority: 7, threshold: 0.70,
    description: '판매자 등록(중고물품·서비스 판매 시작) — 구매가 아니라 "내가 판매자가 되고 싶다"는 요청 전용. 일반 구매/탐색은 kcommerce로.',
    triggers: [
      '판매자로 등록','물건을 팔고','매물로 등록','팔고 싶어',
      '중고 거래로 등록','판매 시작','내 상품 올리기','셀러 등록',
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
    // 직접 fetch한다(현재 SP-KMARKET-v2_7.txt). 진짜 SP는 market 레포가
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
    // ★ 2026-07-12 정정 — 이전 설명("실시간 교통 흐름 예측·우회 경로")은
    // 실제 SP(traffic.hondi.net webapp.html의 AGENCY_PROMPT)와 완전히
    // 달랐다. 실제로는 /gov/relay(agency='traffic')를 쓰는 교통행정
    // 민원 대화형 안내 AI다 — 내비게이션·경로탐색이 아니라 "도로·대중
    // 교통·주정차 단속·과태료·운전면허 행정" 민원을 인터뷰 방식으로
    // 파악해 절차를 안내한다(250건 사고실험 재개 중 발견).
    description: '교통행정 민원 안내(대중교통 노선·도로 공사통제 정보·주정차 단속 및 과태료·운전면허 행정) — 실시간 길찾기/내비게이션이 아님.',
    triggers: [
      '과태료','단속','주정차','운전면허','대중교통','노선',
      '도로 공사','도로 통제','교통 민원','교통사고 신고',
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

  // ── profile-assistant — 앱 사용법 튜토리얼 + 프로필 작성 (2026-07-11 신설) ──
  // AC(§0-1)가 첫 인사 뒤 사용자가 준비됐다고 하면, 또는(§0-E) 자연스러운
  // 시점에 프로필 작성을 제안해 사용자가 동의하면 [GWP: profile-assistant]를
  // 낸다 — 다른 GWP 서비스와 동일한 새 탭 방식(구 CALL_PROFILE_ASSISTANT
  // 같은 창 전환 방식에서 이관, 튜토리얼이 AC 자신의 대본과 섞여 실제
  // 사용자 지시를 가로채던 문제 해결). threshold를 의도적으로 높게 잡아
  // 애매한 발화로 오발동하지 않게 하고, AC의 명시적 판단(§0-1/§0-E)에
  // 주로 의존한다.
  {
    id: 'profile-assistant', name: '혼디 안내(튜토리얼·프로필)', category: 'ONB',
    type: 'tab',
    url: '/pages/profile-assistant.html',
    status: 'active', priority: 5, threshold: 0.85,
    description: '앱 사용법 튜토리얼(PHASE -1) 및 프로필 작성/수정(PHASE 0/1). 중단해도 다음 호출 시 이어서 진행.',
    triggers: [
      '프로필 작성', '프로필 수정', '사용법 알려줘', '앱 사용법',
      '튜토리얼', '튜토리얼 다시', '이용법 안내',
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

  // ── 플랫폼 유틸리티 (UTL) — 2026-07-08 신설 ────────────────
  // ★ 표준 [GWP: id] 새 탭 방식이 아니라 [KSEARCH_HANDOFF]로 동일
  // 스레드 안에서 system을 전환하는 방식(call-ai.js _switchToKSearchSP)
  // — 다른 항목과 달리 _gwpLaunch()가 이 id로 새 탭을 열 일은 없다.
  // 여기 등록하는 목적은 트리거 키워드 참고·문서 일관성용이며, status는
  // RULE-03 후반부(미청구 프로필 생성)가 아직 미구현이라 'pending'으로
  // 둔다(RULE-02는 2026-07-08부로 배선 완료 — SP-18_ksearch_v1.0.txt 참조).
  {
    id: 'ksearch', name: 'K-Search', category: 'UTL',
    type: 'inline',
    url: null,
    sp_key: 'SP-18_ksearch',
    status: 'pending', priority: 9, threshold: 0.70,
    // v1.1(2026-07-08): "검색은 K-Search만 전담" 원칙이 K-Market 등
    // 생태계 전체로 확정 — 다만 이 항목은 AC→K-Search 직접 위임(RULE-06
    // 6-A, [KSEARCH_HANDOFF])만을 위한 것이고, K-Market의 nested 위임
    // (RULE-06 6-B, [CALL_KSEARCH])은 market 레포 자체 구현이라 여기
    // 등록과 무관하다. AC 자신의 라우팅(예: [GWP: kcommerce])은 이
    // 변경으로 바뀌지 않는다 — AGENT-COMMON v3.34 참조.
    description: '혼디 생태계 전체의 유일한 검색 실행 에이전트 — 사람·AI비서 식별은 물론 K-Market 등 타 SP가 위임하는 판매자·상품 탐색까지 전담. 모호하면 되묻고, 없으면 솔직히 안내.',
    triggers: [
      '찾아줘','연결해줘','불러줘','아는 사람','그분','그 사람',
      '누구였지','아이디 찾','핸들 찾','프로필 찾',
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
