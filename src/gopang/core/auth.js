/**
 * core/auth.js — 사용자 인증·등록 v3.4
 * - 내부: E.164 풀번호 기반 GUID/nickname_hash
 * - UI:   한국 기본(뒷 8자리), 비KR은 국가prefix handle (@US-XXXXXXXX)
 *         UN 가입국 194개 + 실시간 검색
 * - 익명 모드 없음
 */
import { setUser, _USER, USER_GUID, L1_URL, PROXY } from './state.js';
const PROXY_URL = PROXY;
import { appendBubble } from '../ui/bubble.js';

const STORE_KEY = 'gopang_user_v4';
const DEFAULT_COUNTRY = 'KR';

// 194개국
const COUNTRIES = {
  AF: { flag: "🇦🇫", name: "Afghanistan", code: "+93", prefix: "", digits: 9 },
  AL: { flag: "🇦🇱", name: "Albania", code: "+355", prefix: "0", digits: 9 },
  DZ: { flag: "🇩🇿", name: "Algeria", code: "+213", prefix: "0", digits: 9 },
  AD: { flag: "🇦🇩", name: "Andorra", code: "+376", prefix: "", digits: 6 },
  AO: { flag: "🇦🇴", name: "Angola", code: "+244", prefix: "", digits: 9 },
  AG: { flag: "🇦🇬", name: "Antigua & Barbuda", code: "+1268", prefix: "", digits: 7 },
  AR: { flag: "🇦🇷", name: "Argentina", code: "+54", prefix: "0", digits: 10 },
  AM: { flag: "🇦🇲", name: "Armenia", code: "+374", prefix: "0", digits: 8 },
  AU: { flag: "🇦🇺", name: "Australia", code: "+61", prefix: "0", digits: 9 },
  AT: { flag: "🇦🇹", name: "Austria", code: "+43", prefix: "0", digits: 10 },
  AZ: { flag: "🇦🇿", name: "Azerbaijan", code: "+994", prefix: "0", digits: 9 },
  BS: { flag: "🇧🇸", name: "Bahamas", code: "+1242", prefix: "", digits: 7 },
  BH: { flag: "🇧🇭", name: "Bahrain", code: "+973", prefix: "", digits: 8 },
  BD: { flag: "🇧🇩", name: "Bangladesh", code: "+880", prefix: "0", digits: 10 },
  BB: { flag: "🇧🇧", name: "Barbados", code: "+1246", prefix: "", digits: 7 },
  BY: { flag: "🇧🇾", name: "Belarus", code: "+375", prefix: "0", digits: 9 },
  BE: { flag: "🇧🇪", name: "Belgium", code: "+32", prefix: "0", digits: 9 },
  BZ: { flag: "🇧🇿", name: "Belize", code: "+501", prefix: "", digits: 7 },
  BJ: { flag: "🇧🇯", name: "Benin", code: "+229", prefix: "", digits: 8 },
  BT: { flag: "🇧🇹", name: "Bhutan", code: "+975", prefix: "", digits: 8 },
  BO: { flag: "🇧🇴", name: "Bolivia", code: "+591", prefix: "0", digits: 8 },
  BA: { flag: "🇧🇦", name: "Bosnia & Herzegovina", code: "+387", prefix: "0", digits: 8 },
  BW: { flag: "🇧🇼", name: "Botswana", code: "+267", prefix: "", digits: 8 },
  BR: { flag: "🇧🇷", name: "Brazil", code: "+55", prefix: "0", digits: 11 },
  BN: { flag: "🇧🇳", name: "Brunei", code: "+673", prefix: "", digits: 7 },
  BG: { flag: "🇧🇬", name: "Bulgaria", code: "+359", prefix: "0", digits: 9 },
  BF: { flag: "🇧🇫", name: "Burkina Faso", code: "+226", prefix: "", digits: 8 },
  BI: { flag: "🇧🇮", name: "Burundi", code: "+257", prefix: "", digits: 8 },
  CV: { flag: "🇨🇻", name: "Cabo Verde", code: "+238", prefix: "", digits: 7 },
  KH: { flag: "🇰🇭", name: "Cambodia", code: "+855", prefix: "0", digits: 9 },
  CM: { flag: "🇨🇲", name: "Cameroon", code: "+237", prefix: "", digits: 9 },
  CA: { flag: "🇨🇦", name: "Canada", code: "+1", prefix: "", digits: 10 },
  CF: { flag: "🇨🇫", name: "Central African Rep.", code: "+236", prefix: "", digits: 8 },
  TD: { flag: "🇹🇩", name: "Chad", code: "+235", prefix: "", digits: 8 },
  CL: { flag: "🇨🇱", name: "Chile", code: "+56", prefix: "0", digits: 9 },
  CN: { flag: "🇨🇳", name: "China", code: "+86", prefix: "", digits: 11 },
  CO: { flag: "🇨🇴", name: "Colombia", code: "+57", prefix: "0", digits: 10 },
  KM: { flag: "🇰🇲", name: "Comoros", code: "+269", prefix: "", digits: 7 },
  CG: { flag: "🇨🇬", name: "Congo", code: "+242", prefix: "", digits: 9 },
  CD: { flag: "🇨🇩", name: "Congo (DR)", code: "+243", prefix: "0", digits: 9 },
  CR: { flag: "🇨🇷", name: "Costa Rica", code: "+506", prefix: "", digits: 8 },
  CI: { flag: "🇨🇮", name: "Côte d'Ivoire", code: "+225", prefix: "", digits: 10 },
  HR: { flag: "🇭🇷", name: "Croatia", code: "+385", prefix: "0", digits: 9 },
  CU: { flag: "🇨🇺", name: "Cuba", code: "+53", prefix: "0", digits: 8 },
  CY: { flag: "🇨🇾", name: "Cyprus", code: "+357", prefix: "", digits: 8 },
  CZ: { flag: "🇨🇿", name: "Czech Republic", code: "+420", prefix: "", digits: 9 },
  DK: { flag: "🇩🇰", name: "Denmark", code: "+45", prefix: "", digits: 8 },
  DJ: { flag: "🇩🇯", name: "Djibouti", code: "+253", prefix: "", digits: 8 },
  DM: { flag: "🇩🇲", name: "Dominica", code: "+1767", prefix: "", digits: 7 },
  DO: { flag: "🇩🇴", name: "Dominican Republic", code: "+1809", prefix: "", digits: 7 },
  EC: { flag: "🇪🇨", name: "Ecuador", code: "+593", prefix: "0", digits: 9 },
  EG: { flag: "🇪🇬", name: "Egypt", code: "+20", prefix: "0", digits: 10 },
  SV: { flag: "🇸🇻", name: "El Salvador", code: "+503", prefix: "", digits: 8 },
  GQ: { flag: "🇬🇶", name: "Equatorial Guinea", code: "+240", prefix: "", digits: 9 },
  ER: { flag: "🇪🇷", name: "Eritrea", code: "+291", prefix: "0", digits: 7 },
  EE: { flag: "🇪🇪", name: "Estonia", code: "+372", prefix: "", digits: 8 },
  SZ: { flag: "🇸🇿", name: "Eswatini", code: "+268", prefix: "", digits: 8 },
  ET: { flag: "🇪🇹", name: "Ethiopia", code: "+251", prefix: "0", digits: 9 },
  FJ: { flag: "🇫🇯", name: "Fiji", code: "+679", prefix: "", digits: 7 },
  FI: { flag: "🇫🇮", name: "Finland", code: "+358", prefix: "0", digits: 9 },
  FR: { flag: "🇫🇷", name: "France", code: "+33", prefix: "0", digits: 9 },
  GA: { flag: "🇬🇦", name: "Gabon", code: "+241", prefix: "0", digits: 8 },
  GM: { flag: "🇬🇲", name: "Gambia", code: "+220", prefix: "", digits: 7 },
  GE: { flag: "🇬🇪", name: "Georgia", code: "+995", prefix: "0", digits: 9 },
  DE: { flag: "🇩🇪", name: "Germany", code: "+49", prefix: "0", digits: 11 },
  GH: { flag: "🇬🇭", name: "Ghana", code: "+233", prefix: "0", digits: 9 },
  GR: { flag: "🇬🇷", name: "Greece", code: "+30", prefix: "", digits: 10 },
  GD: { flag: "🇬🇩", name: "Grenada", code: "+1473", prefix: "", digits: 7 },
  GT: { flag: "🇬🇹", name: "Guatemala", code: "+502", prefix: "", digits: 8 },
  GN: { flag: "🇬🇳", name: "Guinea", code: "+224", prefix: "", digits: 9 },
  GW: { flag: "🇬🇼", name: "Guinea-Bissau", code: "+245", prefix: "", digits: 9 },
  GY: { flag: "🇬🇾", name: "Guyana", code: "+592", prefix: "", digits: 7 },
  HT: { flag: "🇭🇹", name: "Haiti", code: "+509", prefix: "", digits: 8 },
  HN: { flag: "🇭🇳", name: "Honduras", code: "+504", prefix: "", digits: 8 },
  HU: { flag: "🇭🇺", name: "Hungary", code: "+36", prefix: "06", digits: 8 },
  IS: { flag: "🇮🇸", name: "Iceland", code: "+354", prefix: "", digits: 7 },
  IN: { flag: "🇮🇳", name: "India", code: "+91", prefix: "0", digits: 10 },
  ID: { flag: "🇮🇩", name: "Indonesia", code: "+62", prefix: "0", digits: 11 },
  IR: { flag: "🇮🇷", name: "Iran", code: "+98", prefix: "0", digits: 10 },
  IQ: { flag: "🇮🇶", name: "Iraq", code: "+964", prefix: "0", digits: 10 },
  IE: { flag: "🇮🇪", name: "Ireland", code: "+353", prefix: "0", digits: 9 },
  IL: { flag: "🇮🇱", name: "Israel", code: "+972", prefix: "0", digits: 9 },
  IT: { flag: "🇮🇹", name: "Italy", code: "+39", prefix: "0", digits: 10 },
  JM: { flag: "🇯🇲", name: "Jamaica", code: "+1876", prefix: "", digits: 7 },
  JP: { flag: "🇯🇵", name: "Japan", code: "+81", prefix: "0", digits: 10 },
  JO: { flag: "🇯🇴", name: "Jordan", code: "+962", prefix: "0", digits: 9 },
  KZ: { flag: "🇰🇿", name: "Kazakhstan", code: "+7", prefix: "8", digits: 10 },
  KE: { flag: "🇰🇪", name: "Kenya", code: "+254", prefix: "0", digits: 9 },
  KI: { flag: "🇰🇮", name: "Kiribati", code: "+686", prefix: "", digits: 5 },
  KP: { flag: "🇰🇵", name: "Korea (North)", code: "+850", prefix: "0", digits: 10 },
  KR: { flag: "🇰🇷", name: "Korea (South)", code: "+82", prefix: "010", digits: 8 },
  KW: { flag: "🇰🇼", name: "Kuwait", code: "+965", prefix: "", digits: 8 },
  KG: { flag: "🇰🇬", name: "Kyrgyzstan", code: "+996", prefix: "0", digits: 9 },
  LA: { flag: "🇱🇦", name: "Laos", code: "+856", prefix: "0", digits: 9 },
  LV: { flag: "🇱🇻", name: "Latvia", code: "+371", prefix: "", digits: 8 },
  LB: { flag: "🇱🇧", name: "Lebanon", code: "+961", prefix: "0", digits: 8 },
  LS: { flag: "🇱🇸", name: "Lesotho", code: "+266", prefix: "", digits: 8 },
  LR: { flag: "🇱🇷", name: "Liberia", code: "+231", prefix: "0", digits: 8 },
  LY: { flag: "🇱🇾", name: "Libya", code: "+218", prefix: "0", digits: 9 },
  LI: { flag: "🇱🇮", name: "Liechtenstein", code: "+423", prefix: "", digits: 7 },
  LT: { flag: "🇱🇹", name: "Lithuania", code: "+370", prefix: "8", digits: 8 },
  LU: { flag: "🇱🇺", name: "Luxembourg", code: "+352", prefix: "", digits: 9 },
  MG: { flag: "🇲🇬", name: "Madagascar", code: "+261", prefix: "0", digits: 9 },
  MW: { flag: "🇲🇼", name: "Malawi", code: "+265", prefix: "0", digits: 9 },
  MY: { flag: "🇲🇾", name: "Malaysia", code: "+60", prefix: "0", digits: 9 },
  MV: { flag: "🇲🇻", name: "Maldives", code: "+960", prefix: "", digits: 7 },
  ML: { flag: "🇲🇱", name: "Mali", code: "+223", prefix: "", digits: 8 },
  MT: { flag: "🇲🇹", name: "Malta", code: "+356", prefix: "", digits: 8 },
  MH: { flag: "🇲🇭", name: "Marshall Islands", code: "+692", prefix: "", digits: 7 },
  MR: { flag: "🇲🇷", name: "Mauritania", code: "+222", prefix: "", digits: 8 },
  MU: { flag: "🇲🇺", name: "Mauritius", code: "+230", prefix: "", digits: 8 },
  MX: { flag: "🇲🇽", name: "Mexico", code: "+52", prefix: "01", digits: 10 },
  FM: { flag: "🇫🇲", name: "Micronesia", code: "+691", prefix: "", digits: 7 },
  MD: { flag: "🇲🇩", name: "Moldova", code: "+373", prefix: "0", digits: 8 },
  MC: { flag: "🇲🇨", name: "Monaco", code: "+377", prefix: "", digits: 8 },
  MN: { flag: "🇲🇳", name: "Mongolia", code: "+976", prefix: "0", digits: 8 },
  ME: { flag: "🇲🇪", name: "Montenegro", code: "+382", prefix: "0", digits: 8 },
  MA: { flag: "🇲🇦", name: "Morocco", code: "+212", prefix: "0", digits: 9 },
  MZ: { flag: "🇲🇿", name: "Mozambique", code: "+258", prefix: "0", digits: 9 },
  MM: { flag: "🇲🇲", name: "Myanmar", code: "+95", prefix: "0", digits: 9 },
  NA: { flag: "🇳🇦", name: "Namibia", code: "+264", prefix: "0", digits: 9 },
  NR: { flag: "🇳🇷", name: "Nauru", code: "+674", prefix: "", digits: 7 },
  NP: { flag: "🇳🇵", name: "Nepal", code: "+977", prefix: "0", digits: 10 },
  NL: { flag: "🇳🇱", name: "Netherlands", code: "+31", prefix: "0", digits: 9 },
  NZ: { flag: "🇳🇿", name: "New Zealand", code: "+64", prefix: "0", digits: 9 },
  NI: { flag: "🇳🇮", name: "Nicaragua", code: "+505", prefix: "", digits: 8 },
  NE: { flag: "🇳🇪", name: "Niger", code: "+227", prefix: "", digits: 8 },
  NG: { flag: "🇳🇬", name: "Nigeria", code: "+234", prefix: "0", digits: 10 },
  MK: { flag: "🇲🇰", name: "North Macedonia", code: "+389", prefix: "0", digits: 8 },
  NO: { flag: "🇳🇴", name: "Norway", code: "+47", prefix: "", digits: 8 },
  OM: { flag: "🇴🇲", name: "Oman", code: "+968", prefix: "", digits: 8 },
  PK: { flag: "🇵🇰", name: "Pakistan", code: "+92", prefix: "0", digits: 10 },
  PW: { flag: "🇵🇼", name: "Palau", code: "+680", prefix: "", digits: 7 },
  PA: { flag: "🇵🇦", name: "Panama", code: "+507", prefix: "", digits: 8 },
  PG: { flag: "🇵🇬", name: "Papua New Guinea", code: "+675", prefix: "", digits: 8 },
  PY: { flag: "🇵🇾", name: "Paraguay", code: "+595", prefix: "0", digits: 9 },
  PE: { flag: "🇵🇪", name: "Peru", code: "+51", prefix: "0", digits: 9 },
  PH: { flag: "🇵🇭", name: "Philippines", code: "+63", prefix: "0", digits: 10 },
  PL: { flag: "🇵🇱", name: "Poland", code: "+48", prefix: "0", digits: 9 },
  PT: { flag: "🇵🇹", name: "Portugal", code: "+351", prefix: "", digits: 9 },
  QA: { flag: "🇶🇦", name: "Qatar", code: "+974", prefix: "", digits: 8 },
  RO: { flag: "🇷🇴", name: "Romania", code: "+40", prefix: "0", digits: 9 },
  RU: { flag: "🇷🇺", name: "Russia", code: "+7", prefix: "8", digits: 10 },
  RW: { flag: "🇷🇼", name: "Rwanda", code: "+250", prefix: "0", digits: 9 },
  KN: { flag: "🇰🇳", name: "Saint Kitts & Nevis", code: "+1869", prefix: "", digits: 7 },
  LC: { flag: "🇱🇨", name: "Saint Lucia", code: "+1758", prefix: "", digits: 7 },
  VC: { flag: "🇻🇨", name: "Saint Vincent", code: "+1784", prefix: "", digits: 7 },
  WS: { flag: "🇼🇸", name: "Samoa", code: "+685", prefix: "", digits: 7 },
  SM: { flag: "🇸🇲", name: "San Marino", code: "+378", prefix: "", digits: 10 },
  ST: { flag: "🇸🇹", name: "São Tomé & Príncipe", code: "+239", prefix: "", digits: 7 },
  SA: { flag: "🇸🇦", name: "Saudi Arabia", code: "+966", prefix: "0", digits: 9 },
  SN: { flag: "🇸🇳", name: "Senegal", code: "+221", prefix: "", digits: 9 },
  RS: { flag: "🇷🇸", name: "Serbia", code: "+381", prefix: "0", digits: 9 },
  SC: { flag: "🇸🇨", name: "Seychelles", code: "+248", prefix: "", digits: 7 },
  SL: { flag: "🇸🇱", name: "Sierra Leone", code: "+232", prefix: "0", digits: 8 },
  SG: { flag: "🇸🇬", name: "Singapore", code: "+65", prefix: "", digits: 8 },
  SK: { flag: "🇸🇰", name: "Slovakia", code: "+421", prefix: "0", digits: 9 },
  SI: { flag: "🇸🇮", name: "Slovenia", code: "+386", prefix: "0", digits: 8 },
  SB: { flag: "🇸🇧", name: "Solomon Islands", code: "+677", prefix: "", digits: 7 },
  SO: { flag: "🇸🇴", name: "Somalia", code: "+252", prefix: "0", digits: 9 },
  ZA: { flag: "🇿🇦", name: "South Africa", code: "+27", prefix: "0", digits: 9 },
  SS: { flag: "🇸🇸", name: "South Sudan", code: "+211", prefix: "0", digits: 9 },
  ES: { flag: "🇪🇸", name: "Spain", code: "+34", prefix: "", digits: 9 },
  LK: { flag: "🇱🇰", name: "Sri Lanka", code: "+94", prefix: "0", digits: 9 },
  SD: { flag: "🇸🇩", name: "Sudan", code: "+249", prefix: "0", digits: 9 },
  SR: { flag: "🇸🇷", name: "Suriname", code: "+597", prefix: "", digits: 7 },
  SE: { flag: "🇸🇪", name: "Sweden", code: "+46", prefix: "0", digits: 9 },
  CH: { flag: "🇨🇭", name: "Switzerland", code: "+41", prefix: "0", digits: 9 },
  SY: { flag: "🇸🇾", name: "Syria", code: "+963", prefix: "0", digits: 9 },
  TW: { flag: "🇹🇼", name: "Taiwan", code: "+886", prefix: "0", digits: 9 },
  TJ: { flag: "🇹🇯", name: "Tajikistan", code: "+992", prefix: "0", digits: 9 },
  TZ: { flag: "🇹🇿", name: "Tanzania", code: "+255", prefix: "0", digits: 9 },
  TH: { flag: "🇹🇭", name: "Thailand", code: "+66", prefix: "0", digits: 9 },
  TL: { flag: "🇹🇱", name: "Timor-Leste", code: "+670", prefix: "", digits: 8 },
  TG: { flag: "🇹🇬", name: "Togo", code: "+228", prefix: "", digits: 8 },
  TO: { flag: "🇹🇴", name: "Tonga", code: "+676", prefix: "", digits: 7 },
  TT: { flag: "🇹🇹", name: "Trinidad & Tobago", code: "+1868", prefix: "", digits: 7 },
  TN: { flag: "🇹🇳", name: "Tunisia", code: "+216", prefix: "", digits: 8 },
  TR: { flag: "🇹🇷", name: "Turkey", code: "+90", prefix: "0", digits: 10 },
  TM: { flag: "🇹🇲", name: "Turkmenistan", code: "+993", prefix: "8", digits: 8 },
  TV: { flag: "🇹🇻", name: "Tuvalu", code: "+688", prefix: "", digits: 5 },
  UG: { flag: "🇺🇬", name: "Uganda", code: "+256", prefix: "0", digits: 9 },
  UA: { flag: "🇺🇦", name: "Ukraine", code: "+380", prefix: "0", digits: 9 },
  AE: { flag: "🇦🇪", name: "UAE", code: "+971", prefix: "0", digits: 9 },
  GB: { flag: "🇬🇧", name: "United Kingdom", code: "+44", prefix: "0", digits: 10 },
  US: { flag: "🇺🇸", name: "United States", code: "+1", prefix: "", digits: 10 },
  UY: { flag: "🇺🇾", name: "Uruguay", code: "+598", prefix: "0", digits: 9 },
  UZ: { flag: "🇺🇿", name: "Uzbekistan", code: "+998", prefix: "8", digits: 9 },
  VU: { flag: "🇻🇺", name: "Vanuatu", code: "+678", prefix: "", digits: 7 },
  VE: { flag: "🇻🇪", name: "Venezuela", code: "+58", prefix: "0", digits: 10 },
  VN: { flag: "🇻🇳", name: "Vietnam", code: "+84", prefix: "0", digits: 9 },
  YE: { flag: "🇾🇪", name: "Yemen", code: "+967", prefix: "0", digits: 9 },
  ZM: { flag: "🇿🇲", name: "Zambia", code: "+260", prefix: "0", digits: 9 },
  ZW: { flag: "🇿🇼", name: "Zimbabwe", code: "+263", prefix: "0", digits: 9 },
};

// ── E.164 / Handle / GUID 빌더 ────────────────────────────
export function buildE164(phoneDigits, countryKey = DEFAULT_COUNTRY) {
  const c = COUNTRIES[countryKey] || COUNTRIES[DEFAULT_COUNTRY];
  return c.code + c.prefix + phoneDigits;
}

export function buildHandle(phoneDigits, countryKey = DEFAULT_COUNTRY) {
  return countryKey === DEFAULT_COUNTRY
    ? `@${phoneDigits}`
    : `@${countryKey}-${phoneDigits}`;
}

// ── SHA-256 헬퍼 ─────────────────────────────────────────
export async function _sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ── E.164 → IPv6 형식 GUID ───────────────────────────────
async function _e164ToIPv6(e164) {
  const hash = await _sha256('gopang-phone:' + e164);
  const groups = [];
  for (let i = 0; i < 8; i++) groups.push(hash.slice(i*4, i*4+4));
  groups[0] = '2601';
  groups[1] = 'db80';
  return groups.join(':');
}

// ── 저장소 읽기 ──────────────────────────────────────────
function _loadStored() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || 'null') ||
           JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null');
  } catch { return null; }
}

// ── 사용자 초기화 (앱 시작 시 1회) ──────────────────────
export async function initAuth() {
  const stored = _loadStored();
  if (stored?.ipv6) {
    console.info('[Auth] 자동 로그인 ✅', stored.ipv6);
    setUser(stored);
    return stored;
  }
  return new Promise((resolve) => { _showPhonePopup(resolve); });
}

// ── 전화번호 입력 팝업 ───────────────────────────────────
function _showPhonePopup(resolve) {
  let selectedCountry = DEFAULT_COUNTRY;

  const overlay = document.createElement('div');
  overlay.id = '_phone-overlay';
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:9999',
    'background:rgba(0,0,0,0.4)',
    'display:flex;align-items:center;justify-content:center',
    'padding:24px;box-sizing:border-box',
  ].join(';');

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:20px;padding:28px 20px;
                width:100%;max-width:340px;box-sizing:border-box;">

      <!-- 국가 드롭다운 패널 -->
      <div id="_country-panel" style="display:none;margin-bottom:10px;
           border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;
           background:#fff;box-shadow:0 4px 16px rgba(0,0,0,0.12)">

        <!-- 검색 입력 -->
        <div style="padding:10px 12px;border-bottom:1px solid #f0f0f0">
          <input id="_country-search" type="text" placeholder="국가 검색..."
            style="width:100%;border:1px solid #e5e7eb;border-radius:8px;
                   padding:8px 12px;font-size:14px;outline:none;
                   box-sizing:border-box;font-family:inherit"
            autocomplete="off"/>
        </div>

        <!-- 국가 목록 -->
        <div id="_country-list"
          style="max-height:220px;overflow-y:auto;overscroll-behavior:contain">
        </div>
      </div>

      <!-- 전화번호 입력 행 -->
      <div style="display:flex;align-items:center;
                  border:1px solid #e5e7eb;border-radius:12px;
                  background:#f9fafb;overflow:hidden;margin-bottom:8px"
           id="_phone-field">

        <!-- 국기 버튼 -->
        <button id="_country-btn"
          style="padding:0 10px;height:52px;border:none;background:transparent;
                 cursor:pointer;border-right:1px solid #e5e7eb;
                 flex-shrink:0;display:flex;align-items:center;gap:3px">
          <span id="_flag-icon" style="font-size:20px">🇰🇷</span>
          <span id="_dial-code" style="font-size:11px;color:#6b7280">+82</span>
          <span style="font-size:9px;color:#9ca3af">▼</span>
        </button>

        <input id="_phone-input" type="tel" maxlength="8"
          placeholder="뒷 8자리"
          style="flex:1;padding:0 12px;height:52px;border:none;background:transparent;
                 font-size:16px;font-family:inherit;outline:none;color:#111827;
                 min-width:0;letter-spacing:2px"
          autocomplete="off" inputmode="numeric"/>

        <button id="_phone-btn"
          style="padding:0 14px;height:52px;border:none;background:transparent;
                 cursor:pointer;display:flex;align-items:center;
                 border-left:1px solid #e5e7eb;flex-shrink:0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
               stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>

      <div id="_phone-error" style="display:none;font-size:12px;color:#dc2626;
           padding:0 4px;margin-bottom:4px"></div>
      <div id="_phone-hint" style="font-size:12px;color:#9ca3af;padding:0 4px">
        예: 010-9662-7170 → 96627170
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const input      = document.getElementById('_phone-input');
  const field      = document.getElementById('_phone-field');
  const errEl      = document.getElementById('_phone-error');
  const panel      = document.getElementById('_country-panel');
  const listEl     = document.getElementById('_country-list');
  const searchEl   = document.getElementById('_country-search');
  const flagIcon   = document.getElementById('_flag-icon');
  const dialCode   = document.getElementById('_dial-code');
  const hintEl     = document.getElementById('_phone-hint');

  // ── 국가 목록 렌더 ──────────────────────────────────────
  function _renderList(query = '') {
    const q = query.toLowerCase();
    const allEntries = Object.entries(COUNTRIES);
    const entries = !q ? allEntries : [
      // 1순위: 국가코드 완전/전방 일치 (US, KR, JP)
      ...allEntries.filter(([key]) => key.toLowerCase() === q),
      ...allEntries.filter(([key]) => key.toLowerCase() !== q && key.toLowerCase().startsWith(q)),
      // 2순위: 국가명 부분 일치
      ...allEntries.filter(([key, c]) =>
        !key.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q)
      ),
      // 3순위: 전화코드 일치 (+1, +82)
      ...allEntries.filter(([key, c]) =>
        !key.toLowerCase().startsWith(q) && !c.name.toLowerCase().includes(q) && c.code.includes(q)
      ),
    ];
    listEl.innerHTML = entries.map(([key, c]) => `
      <div data-country="${key}"
           style="padding:10px 14px;cursor:pointer;
                  display:flex;align-items:center;gap:10px;
                  border-bottom:1px solid #f9f9f9;
                  ${key === selectedCountry ? 'background:#f0fdf4;' : ''}">
        <span style="font-size:20px;flex-shrink:0;width:28px;text-align:center">${c.flag}</span>
        <span style="flex:1;color:#111827;font-size:14px">${c.name}</span>
        <span style="color:#6b7280;font-size:12px;margin-right:4px">${key}</span>
        <span style="color:#9ca3af;font-size:14px">${c.code}</span>
      </div>`).join('');

    listEl.querySelectorAll('[data-country]').forEach(el => {
      el.onmouseenter = () => el.style.background = '#f0fdf4';
      el.onmouseleave = () => el.style.background = el.dataset.country === selectedCountry ? '#f0fdf4' : '';
      el.onclick = () => _selectCountry(el.dataset.country);
    });
  }

  function _selectCountry(key) {
    selectedCountry = key;
    const c = COUNTRIES[key];
    flagIcon.textContent = c.flag;
    dialCode.textContent = c.code;
    input.maxLength = c.digits;
    input.value = '';
    input.placeholder = key === DEFAULT_COUNTRY ? '뒷 8자리' : `전화번호 (${c.digits}자리)`;
    hintEl.textContent = key === DEFAULT_COUNTRY
      ? '예: 010-9662-7170 → 96627170'
      : `handle: @${key}-${'X'.repeat(Math.min(c.digits, 8))}...`;
    panel.style.display = 'none';
    searchEl.value = '';
    input.focus();
  }

  // 초기 렌더
  _renderList();

  // 국가 버튼 토글
  document.getElementById('_country-btn').onclick = (e) => {
    e.stopPropagation();
    const isOpen = panel.style.display !== 'none';
    panel.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) {
      _renderList();
      setTimeout(() => searchEl.focus(), 50);
    }
  };

  // 실시간 검색
  searchEl.addEventListener('input', () => _renderList(searchEl.value));
  searchEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') panel.style.display = 'none';
    if (e.key === 'Enter') {
      const first = listEl.querySelector('[data-country]');
      if (first) _selectCountry(first.dataset.country);
    }
  });

  // 바깥 클릭 시 패널 닫기
  overlay.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && e.target.id !== '_country-btn') {
      panel.style.display = 'none';
    }
  });

  input.focus();
  input.addEventListener('focus', () => field.style.borderColor = '#16a34a');
  input.addEventListener('blur',  () => field.style.borderColor = '#e5e7eb');
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '').slice(0, COUNTRIES[selectedCountry].digits);
    errEl.style.display = 'none';
  });

  const _submit = async () => {
    const val    = input.value.trim();
    const digits = COUNTRIES[selectedCountry].digits;

    if (!new RegExp(`^\\d{${digits}}$`).test(val)) {
      errEl.textContent = `숫자 ${digits}자리를 입력해 주세요.`;
      errEl.style.display = 'block';
      input.focus();
      return;
    }

    const btn = document.getElementById('_phone-btn');
    btn.style.opacity = '0.4';
    btn.style.pointerEvents = 'none';
    errEl.style.display = 'none';

    try {
      const e164   = buildE164(val, selectedCountry);
      const handle = buildHandle(val, selectedCountry);
      const ipv6   = await _e164ToIPv6(e164);

      const filter = encodeURIComponent(`handle='${handle}'`);
      const res    = await fetch(`${L1_URL}?filter=${filter}&perPage=1`);
      const data   = await res.json();
      const found  = data.items?.[0];

      let user;
      if (found?.guid) {
        // 기존 사용자 → 바로 로그인
        user = {
          ipv6: found.guid, handle: found.handle,
          e164: found.e164 || e164,
          country_code: found.country_code || selectedCountry,
          nickname: found.nickname || '',
          region: found.region || '',
          name: val, isGuest: false, isTemp: false,
          registeredAt: found.created
        };
        console.info('[Auth] 로그인:', handle);
        localStorage.setItem(STORE_KEY, JSON.stringify(user));
        setUser(user);
        overlay.remove();
        resolve(user);
      } else {
        // 신규 사용자 → 닉네임 입력 단계로 전환
        btn.style.opacity = '1';
        btn.style.pointerEvents = '';
        _showNicknameStep({ ipv6, handle, e164, selectedCountry, val, overlay, resolve });
      }

    } catch(e) {
      errEl.textContent = '네트워크 오류. 다시 시도해 주세요.';
      errEl.style.display = 'block';
      btn.style.opacity = '1';
      btn.style.pointerEvents = '';
    }
  };

  document.getElementById('_phone-btn').onclick = _submit;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') _submit(); });
}

// ── 닉네임 입력 단계 ─────────────────────────────────────
function _showNicknameStep({ ipv6, handle, e164, selectedCountry, val, overlay, resolve }) {
  const card = overlay.querySelector('div');
  card.innerHTML = `
    <div style="margin-bottom:20px">
      <div style="font-size:16px;font-weight:600;color:#111827;margin-bottom:4px">닉네임 설정</div>
      <div style="font-size:13px;color:#6b7280">다른 사용자가 검색할 때 사용됩니다</div>
    </div>

    <!-- 닉네임 입력 -->
    <div style="display:flex;align-items:center;
                border:1px solid #e5e7eb;border-radius:12px;
                background:#f9fafb;overflow:hidden;margin-bottom:10px"
         id="_nick-field">
      <input id="_nick-input" type="text" maxlength="20"
        placeholder="닉네임 (예: 홍길동, James)"
        style="flex:1;padding:0 14px;height:52px;border:none;background:transparent;
               font-size:15px;font-family:inherit;outline:none;color:#111827;min-width:0"
        autocomplete="off"/>
    </div>

    <!-- 지역 입력 (선택) -->
    <div style="display:flex;align-items:center;
                border:1px solid #e5e7eb;border-radius:12px;
                background:#f9fafb;overflow:hidden;margin-bottom:8px"
         id="_region-field">
      <input id="_region-input" type="text" maxlength="30"
        placeholder="지역 (선택, 예: 서울, New York)"
        style="flex:1;padding:0 14px;height:48px;border:none;background:transparent;
               font-size:14px;font-family:inherit;outline:none;color:#111827;min-width:0"
        autocomplete="off"/>
    </div>

    <div id="_nick-error" style="display:none;font-size:12px;color:#dc2626;padding:0 4px;margin-bottom:8px"></div>

    <!-- 완료 버튼 -->
    <button id="_nick-btn"
      style="width:100%;height:52px;background:#16a34a;color:#fff;
             border:none;border-radius:12px;font-size:16px;font-weight:600;
             cursor:pointer;font-family:inherit">
      가입 완료
    </button>
    <div style="font-size:12px;color:#9ca3af;text-align:center;margin-top:10px">
      handle: <span style="color:#16a34a">${handle}</span>
    </div>`;

  const nickInput   = document.getElementById('_nick-input');
  const regionInput = document.getElementById('_region-input');
  const nickField   = document.getElementById('_nick-field');
  const nickErr     = document.getElementById('_nick-error');

  nickInput.focus();
  nickInput.addEventListener('focus', () => nickField.style.borderColor = '#16a34a');
  nickInput.addEventListener('blur',  () => nickField.style.borderColor = '#e5e7eb');
  nickInput.addEventListener('input', () => { nickErr.style.display = 'none'; });

  const _register = async () => {
    const nickname = nickInput.value.trim();
    const region   = regionInput.value.trim();

    if (!nickname) {
      nickErr.textContent = '닉네임을 입력해 주세요.';
      nickErr.style.display = 'block';
      nickInput.focus();
      return;
    }

    const btn = document.getElementById('_nick-btn');
    btn.textContent = '등록 중...';
    btn.style.opacity = '0.6';
    btn.style.pointerEvents = 'none';

    try {
      const nickname_hash = await _sha256('phone:' + e164);
      const user = {
        ipv6, handle, e164, country_code: selectedCountry,
        nickname, region,
        name: val, isGuest: false, isTemp: false,
        registeredAt: new Date().toISOString()
      };

      await fetch(L1_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guid: ipv6, nickname_hash, handle, nickname, region,
          e164, country_code: selectedCountry,
          native_lang: navigator.language?.slice(0,2) || 'ko',
          is_public: true
        })
      });
      console.info('[Auth] 신규 등록:', handle, nickname);

      // L5 글로벌 디렉토리 등록 (GDUDA Phase 1 — HLR)
      const nickLang = (navigator.language?.slice(0,2) || 'ko') + ':' + nickname;
      const nickHash = await _sha256(nickLang);
      fetch(`${PROXY_URL}/p2p/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guid:          ipv6,
          handle,
          nickname,
          nickname_hash: nickHash,
          country_code:  selectedCountry,
          region,
          current_l1:    L1_URL.replace('/api/collections/profiles/records', ''),
        })
      }).catch(e => console.warn('[P2P] global_profiles 등록 실패:', e.message));

      localStorage.setItem(STORE_KEY, JSON.stringify(user));
      setUser(user);
      overlay.remove();
      resolve(user);

    } catch(e) {
      nickErr.textContent = '네트워크 오류. 다시 시도해 주세요.';
      nickErr.style.display = 'block';
      btn.textContent = '가입 완료';
      btn.style.opacity = '1';
      btn.style.pointerEvents = '';
    }
  };

  document.getElementById('_nick-btn').onclick = _register;
  nickInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') regionInput.focus(); });
  regionInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') _register(); });
}

// ── 등록 여부 판별 ────────────────────────────────────────
export function _isRegistered() {
  try { return !!(_loadStored()?.handle); } catch { return false; }
}

export function _isTypeBorC() {
  try {
    const s = _loadStored();
    if (!s) return false;
    return !!(s.seedHex || s.faceVec || s.webauthn?.credentialId || s.handle);
  } catch { return false; }
}

export function _isGDCUser() {
  try {
    const s = _loadStored();
    return !!(s?.gdcEnabled && s?.walletPubKey);
  } catch { return false; }
}

// ── L1 PocketBase 등록 ────────────────────────────────────
export async function _registerToL1(name) {
  const user = _USER;
  if (!user) return null;
  const countryKey    = user.country_code || DEFAULT_COUNTRY;
  const e164          = user.e164 || buildE164(name, countryKey);
  const guid          = user.ipv6 || USER_GUID;
  const nickname_hash = await _sha256('phone:' + e164);
  const handle        = buildHandle(name, countryKey);

  try {
    const postRes = await fetch(L1_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guid, nickname_hash, handle,
        e164, country_code: countryKey,
        native_lang: navigator.language?.slice(0,2) || 'ko',
        is_public: true
      }),
    });

    if (!postRes.ok) {
      const filter     = encodeURIComponent(`guid='${guid.replace(/'/g, "\\'")}'`);
      const getRes     = await fetch(`${L1_URL}?filter=${filter}&perPage=1`);
      const getData    = await getRes.json();
      const existingId = getData.items?.[0]?.id;
      if (existingId) {
        await fetch(`${L1_URL}/${existingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guid, nickname_hash, handle, e164, country_code: countryKey, is_public: true }),
        });
      }
    }

    user.handle = handle; user.name = name;
    user.e164 = e164; user.country_code = countryKey;
    user.isGuest = false; user.isTemp = false;
    localStorage.setItem(STORE_KEY, JSON.stringify(user));
    console.info('[L1] 등록 완료:', handle, e164);
    return handle;
  } catch(e) {
    console.warn('[L1] 등록 실패:', e.message);
    return null;
  }
}

// ── 기기 완전 초기화 ─────────────────────────────────────
export async function _deviceFullReset() {
  if (!confirm('기기를 완전 초기화합니다.\n판매·양도 전 실행하세요.\n\n⚠️ 이 기기의 모든 고팡 데이터가 삭제됩니다.')) return;
  try {
    const stored = _loadStored();
    if (stored?.ipv6) {
      const filter = encodeURIComponent(`guid='${stored.ipv6}'`);
      const res    = await fetch(`${L1_URL}?filter=${filter}&perPage=1`);
      if (res.ok) {
        const data = await res.json();
        const id   = data.items?.[0]?.id;
        if (id) await fetch(`${L1_URL}/${id}`, { method: 'DELETE' });
      }
    }
  } catch(e) { console.warn('[Reset] L1 삭제 실패:', e.message); }
  localStorage.clear(); sessionStorage.clear();
  const dbs = await indexedDB.databases?.() || [];
  for (const db of dbs) indexedDB.deleteDatabase(db.name);
  const keys = await caches.keys();
  await Promise.all(keys.map(k => caches.delete(k)));
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.map(r => r.unregister()));
  location.reload();
}

// ── gopangAuth — 레벨별 인증 요구 ────────────────────────
export const gopangAuth = {
  async require(level = 'L0') {
    const stored = _loadStored();
    if (!stored?.ipv6) return false;
    const levels  = ['L0','L1','L2','L3'];
    const current = levels.indexOf(stored.authLevel || 'L0');
    const needed  = levels.indexOf(level);
    if (current >= needed) return true;

    if (needed >= 1) {
      if (!stored.faceVec) { appendBubble('ai', '⚠️ 얼굴을 먼저 등록해 주세요. (설정 → 보안)', true); return false; }
      appendBubble('ai', '📷 얼굴 인증이 필요합니다.', true);
      const vec = await _captureFaceVector();
      if (!vec) return false;
      const sim = _cosineSim(vec, stored.faceVec);
      if (sim < 0.90) { appendBubble('ai', `❌ 얼굴 인증 실패 (유사도 ${(sim*100).toFixed(1)}%)`, true); return false; }
      if (needed === 1) return true;
    }

    if (needed >= 2) {
      const credId = stored.webauthn?.credentialId;
      if (!credId) { appendBubble('ai', '⚠️ 지문을 먼저 등록해 주세요. (설정 → 보안)', true); return false; }
      try {
        appendBubble('ai', '🔐 지문 인증이 필요합니다.', true);
        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const assertion = await navigator.credentials.get({
          publicKey: {
            challenge, timeout: 30000, userVerification: 'required',
            allowCredentials: [{ id: Uint8Array.from(atob(credId.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0)), type: 'public-key' }],
          },
        });
        if (!assertion) return false;
        if (needed === 2) { appendBubble('ai', '✅ 지문 인증 완료.', true); return true; }
      } catch(e) { appendBubble('ai', '지문 인증이 취소됐습니다.', true); return false; }
    }

    if (needed >= 3) {
      const countryKey = stored.country_code || DEFAULT_COUNTRY;
      const phone = prompt('전화번호를 입력하세요:');
      if (!phone) return false;
      const inputGUID = await _e164ToIPv6(buildE164(phone.trim(), countryKey));
      if (inputGUID !== stored.ipv6) { appendBubble('ai', '❌ 번호가 일치하지 않습니다.', true); return false; }
      appendBubble('ai', '✅ L3 인증 완료.', true);
      return true;
    }
    return false;
  }
};

// ── 인증 확인 버튼 ───────────────────────────────────────
export function _injectAuthConfirmButton(level) {
  const list = document.getElementById('message-list');
  if (!list) return;
  const labels = { L1:'얼굴 인증', L2:'지문 인증', L3:'번호 인증' };
  const row = document.createElement('div');
  row.className = 'msg-row ai';
  row.id = '_auth-confirm-row';
  row.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;padding:4px 0;">
      <button onclick="window._executeAuthAndProceed('${level}')"
        style="background:var(--tint);color:#fff;border:none;border-radius:8px;
               padding:10px 20px;font-size:14px;font-weight:600;cursor:pointer;">
        🔐 ${labels[level]||'추가 인증'} 후 진행
      </button>
      <button onclick="window._cancelAuthRequest()"
        style="background:var(--bg-subtle);color:var(--label-2);border:1px solid var(--sep);
               border-radius:8px;padding:10px 16px;font-size:13px;cursor:pointer;">취소</button>
    </div>`;
  list.appendChild(row);
  list.scrollTop = list.scrollHeight;
}

window._executeAuthAndProceed = async function(level) {
  document.getElementById('_auth-confirm-row')?.remove();
  const { callAI } = await import('../ai/call-ai.js');
  const ok = await gopangAuth.require(level);
  if (!ok) { appendBubble('ai', '인증이 취소됐습니다.', true); return; }
  appendBubble('user', `[인증완료:${level}] 인증이 완료됐습니다.`, false);
  await callAI(`[AUTH_CONFIRMED:${level}] 사용자가 ${level} 인증을 완료했습니다. 이전 요청을 즉시 실행하세요.`);
};

window._cancelAuthRequest = function() {
  document.getElementById('_auth-confirm-row')?.remove();
  appendBubble('ai', '거래가 취소됐습니다.', true);
};
