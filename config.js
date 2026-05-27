// ══════════════════════════════════════════════════════════════════
// config.js — 고팡 전역 상수·설정
// ⚠️  이 파일은 .gitignore에 추가하여 API 키 노출 방지
// ══════════════════════════════════════════════════════════════════

export const SUPABASE_URL = 'https://ebbecjfrwaswbdybbgiu.supabase.co';
export const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYmVjamZyd2Fzd2JkeWJiZ2l1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NjE5ODQsImV4cCI6MjA5NTEzNzk4NH0.H2ahQKtWdSke04Pdi3hDY86pdTx7UUKPUpQMlS_zciA';

export const CFG = {
  apiKey:    'sk-e4a6f005aecf43d4aa60e77bb71de14c',
  geminiKey: 'AIzaSyDiytKUg_0MJVBM3gFYzTms7mO6Y2mhLT4',
  kakaoKey:  '66648ca49f126d8752b33d542789ac56',
  endpoint:  'https://gopang-proxy.tensor-city.workers.dev',
  model:     'deepseek-v4-pro',
  system:    '',        // init() 후 채워짐
  system_base: null,
};

// ── GWP 서비스 레지스트리 ────────────────────────────────────────
// 새 서비스 추가 시 여기에만 항목 추가
export const GWP_REGISTRY = [
  {
    id:       'fiil-kcleaner',
    name:     'K-Cleaner',
    icon:     '🌊',
    url:      'https://fiil.kr/webapp.html',
    triggers: ['쓰레기','환경','해안','청소','수거','오염','해양','산림','침적'],
  },
  {
    id:       'klaw',
    name:     'K-Law',
    icon:     '⚖️',
    url:      'https://gopang.net/klaw',
    triggers: ['법률','계약서','분쟁','고소','소송','판결','법원','변호사'],
  },
];

// ── 전문가 SP 맵 ─────────────────────────────────────────────────
// 도메인 코드 → 프롬프트 파일 경로
export const EXPERT_SP_MAP = {
  JUS: 'klaw/prompts/system_prompt.txt',
  MED: 'gopang/prompts/SP-02_kmedical_v1.0.txt',
  ECO: 'gopang/prompts/SP-06_kfinance_v1.0.txt',
  MKT: 'gopang/prompts/SP-05_kcommerce_v1.0.txt',
  EDU: 'gopang/prompts/SP-07_keducation_v1.0.txt',
  GOV: 'gopang/prompts/SP-08_kgov_v1.0.txt',
  IND: 'gopang/prompts/SP-09_kindustry_v1.0.txt',
  ENV: 'gopang/prompts/SP-10_kenv_v1.0.txt',
  CLN: 'klaw/prompts/SP-14_kcleaner_v1.2.txt',
  CUL: 'gopang/prompts/SP-11_kculture_v1.0.txt',
  SOC: 'gopang/prompts/SP-13_ksocial_v1.0.txt',
  IOT: 'gopang/prompts/SP-12_kiot_v1.0.txt',
};

// ── 도메인 감지 패턴 ─────────────────────────────────────────────
export const DOMAIN_DETECT = [
  { code:'CLN', re:/쓰레기|해양쓰레기|해양오염|투기|환경오염|정화|청소|불법투기|해안쓰레기|폐기물|폐어구|기름유출|수거|신고|오염|드론수거|수중쓰레기|산림훼손|오름|탐방로|ROV/ },
  { code:'JUS', re:/계약서|소송|고소|판례|변호사|법률|고발|가상판결|법적|분쟁/ },
  { code:'MED', re:/병원|처방|증상|수술|진단|의료|건강검진|소견/ },
  { code:'ECO', re:/세금|재무|투자|대출|납부|환급|주식|재무제표/ },
  { code:'MKT', re:/시켜|주문|배달|예약|음식점|식당|짜장|짬뽕|치킨|피자|커피|카페|쇼핑|구매|찾아줘|추천|근처|계약|거래|부동산/ },
  { code:'EDU', re:/특허|논문|학습설계|교육계획|자격/ },
  { code:'GOV', re:/민원|등본|허가|면허|행정심판/ },
  { code:'TRN', re:/택시|버스|지하철|길|경로|교통|배차|차편/ },
];

export const EXPERT_KEYWORDS = /검토|분석|판단|진단|소견|전략|보고서|판결|가상판결|자문|법률|계약서|증상|처방|재무|세무|특허|민원|고소|소송|시켜|주문|배달|예약|찾아줘|추천|쓰레기|신고|해양|오염|투기|정화|청소/;

export const KLAW_COOLDOWN_MS = 30_000;
