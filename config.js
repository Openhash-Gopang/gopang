// ══════════════════════════════════════════════════════════════════
// config.js — 고팡 전역 상수·설정
// ⚠️  .gitignore에 추가하여 API 키 노출 방지
// ══════════════════════════════════════════════════════════════════

export const SUPABASE_URL = 'https://ebbecjfrwaswbdybbgiu.supabase.co';
export const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYmVjamZyd2Fzd2JkeWJiZ2l1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NjE5ODQsImV4cCI6MjA5NTEzNzk4NH0.H2ahQKtWdSke04Pdi3hDY86pdTx7UUKPUpQMlS_zciA';

export const CFG = {
  apiKey:      'sk-e4a6f005aecf43d4aa60e77bb71de14c',
  geminiKey:   'AIzaSyDiytKUg_0MJVBM3gFYzTms7mO6Y2mhLT4',
  kakaoKey:    '66648ca49f126d8752b33d542789ac56',
  endpoint:    'https://gopang-proxy.tensor-city.workers.dev/deepseek',
  model:       'deepseek-chat',
  system:      '',
  system_base: null,
};

export const GWP_REGISTRY = [
  {
    id:       'fiil-kcleaner',
    name:     'K-Cleaner',
    icon:     '\uD83C\uDF0A',
    url: location.hostname === 'localhost' ? 'http://localhost:8001/webapp.html' : 'https://fiil.kr/webapp.html',
    triggers: ['\uC4F0\uB808\uAE30','\uD658\uACBD','\uD574\uC548','\uCCAD\uC18C','\uC218\uAC70','\uC624\uC5FC','\uD574\uC591','\uC0B0\uB9BC','\uCE68\uC801'],
  },
  {
    id:       'klaw',
    name:     'K-Law',
    icon:     '\u2696\uFE0F',
    url:      'https://gopang.net/klaw',
    triggers: ['\uBC95\uB960','\uACC4\uC57D\uC11C','\uBD84\uC7C1','\uACE0\uC18C','\uC18C\uC1A1','\uD310\uACB0','\uBC95\uC6D0','\uBCC0\uD638\uC0AC'],
  },
];

export const EXPERT_SP_MAP = {
  JUS: 'klaw/prompts/system_prompt.txt',
  MED: 'gopang/prompts/SP-02_kmedical_v1.0.txt',
  ECO: 'gopang/prompts/SP-06_kfinance_v1.0.txt',
  MKT: 'gopang/prompts/SP-05_kcommerce_v1.0.txt',
  EDU: 'gopang/prompts/SP-07_keducation_v1.0.txt',
  GOV: 'gopang/prompts/SP-08_kgov_v1.0.txt',
  IND: 'gopang/prompts/SP-09_kindustry_v1.0.txt',
  ENV: 'gopang/prompts/SP-10_kenv_v1.0.txt',
  CLN: 'prompts/SP-14_kcleaner_v1.2.txt',
  CUL: 'gopang/prompts/SP-11_kculture_v1.0.txt',
  SOC: 'gopang/prompts/SP-13_ksocial_v1.0.txt',
  IOT: 'gopang/prompts/SP-12_kiot_v1.0.txt',
};

export const DOMAIN_DETECT = [
  { code: 'CLN', re: /\uC4F0\uB808\uAE30|\uD574\uC591\uC4F0\uB808\uAE30|\uD574\uC591\uC624\uC5FC|\uD22C\uAE30|\uD658\uACBD\uC624\uC5FC|\uC815\uD654|\uCCAD\uC18C|\uBD88\uBC95\uD22C\uAE30|\uD574\uC548\uC4F0\uB808\uAE30|\uD3D0\uAE30\uBB3C|\uD3D0\uC5B4\uAD6C|\uAE30\uB984\uC720\uCD9C|\uC218\uAC70|\uC2E0\uACE0|\uC624\uC5FC|\uC218\uC911\uC4F0\uB808\uAE30|\uC0B0\uB9BC\uD6FC\uC190|\uC624\uB984|\uD0D0\uBC29\uB85C|ROV/ },
  { code: 'JUS', re: /\uACC4\uC57D\uC11C|\uC18C\uC1A1|\uACE0\uC18C|\uD310\uB840|\uBCC0\uD638\uC0AC|\uBC95\uB960|\uACE0\uBC1C|\uAC00\uC0C1\uD310\uACB0|\uBC95\uC801|\uBD84\uC7C1/ },
  { code: 'MED', re: /\uBCD1\uC6D0|\uCC98\uBC29|\uC99D\uC0C1|\uC218\uC220|\uC9C4\uB2E8|\uC758\uB8CC|\uAC74\uAC15\uAC80\uC9C4|\uC18C\uACAC/ },
  { code: 'ECO', re: /\uC138\uAE08|\uC7AC\uBB34|\uD22C\uC790|\uB300\uCD9C|\uB0A9\uBD80|\uD658\uAE09|\uC8FC\uC2DD|\uC7AC\uBB34\uC81C\uD45C/ },
  { code: 'MKT', re: /\uC2DC\uCF1C|\uC8FC\uBB38|\uBC30\uB2EC|\uC608\uC57D|\uC74C\uC2DD\uC810|\uC2DD\uB2F9|\uC9DC\uC7A5|\uC9DC\uBB55|\uCE58\uD0A8|\uD53C\uC790|\uCEE4\uD53C|\uCE74\uD398|\uC1FC\uD551|\uAD6C\uB9E4|\uCC3E\uC544\uC918|\uCD94\uCC9C|\uADFC\uCC98|\uACC4\uC57D|\uAC70\uB798|\uBD80\uB3D9\uC0B0/ },
  { code: 'EDU', re: /\uD2B9\uD5C8|\uB17C\uBB38|\uD559\uC2B5\uC124\uACC4|\uAD50\uC721\uACC4\uD68D|\uC790\uACA9/ },
  { code: 'GOV', re: /\uBBFC\uC6D0|\uB4F1\uBCF8|\uD5C8\uAC00|\uBA74\uD5C8|\uD589\uC815\uC2EC\uD310/ },
  { code: 'TRN', re: /\uD0DD\uC2DC|\uBC84\uC2A4|\uC9C0\uD558\uCCA0|\uAE38|\uACBD\uB85C|\uAD50\uD1B5|\uBC30\uCC28|\uCC28\uD3B8/ },
];

export const EXPERT_KEYWORDS = /\uAC80\uD1A0|\uBD84\uC11D|\uD310\uB2E8|\uC9C4\uB2E8|\uC18C\uACAC|\uC804\uB7B5|\uBCF4\uACE0\uC11C|\uD310\uACB0|\uAC00\uC0C1\uD310\uACB0|\uC790\uBB38|\uBC95\uB960|\uACC4\uC57D\uC11C|\uC99D\uC0C1|\uCC98\uBC29|\uC7AC\uBB34|\uC138\uBB34|\uD2B9\uD5C8|\uBBFC\uC6D0|\uACE0\uC18C|\uC18C\uC1A1|\uC2DC\uCF1C|\uC8FC\uBB38|\uBC30\uB2EC|\uC608\uC57D|\uCC3E\uC544\uC918|\uCD94\uCC9C|\uC4F0\uB808\uAE30|\uC2E0\uACE0|\uD574\uC591|\uC624\uC5FC|\uD22C\uAE30|\uC815\uD654|\uCCAD\uC18C/;

export const KLAW_COOLDOWN_MS = 30_000;

