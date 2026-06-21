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
import { requestPushSubscription } from '../services/push.js';

const STORE_KEY = 'gopang_user_v4';
const DEFAULT_COUNTRY = 'KR';

// ── 모바일 기기 판별 (보수적: 확실한 모바일 키워드가 없으면 PC로 간주) ──
// 목적: 암호키(GDC Wallet) 생성은 휴대폰에서만 — PC가 먼저 키를 만들어
//       가입 시점의 진짜 키와 어긋나는 사고(부록 A-1)를 원천 차단.
// 애매한 UA(태블릿, 알 수 없는 기기 등)는 안전한 쪽으로 "PC"로 판정한다.
function _isMobileDevice() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
}

// ── PC로 판별된 기기에서 신규가입 시도 시 확인 다이얼로그 ──────
// "예"를 누르면 그 자리에서 가입 진행, "아니요"/닫기는 가입 자체를 막는다.
function _confirmMobileRegistration() {
  return new Promise((resolve) => {
    document.getElementById('_mobile-confirm-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = '_mobile-confirm-overlay';
    overlay.style.cssText = [
      'position:fixed;inset:0;z-index:10002',
      'background:rgba(0,0,0,0.5)',
      'display:flex;align-items:center;justify-content:center',
      'padding:24px;box-sizing:border-box',
    ].join(';');

    overlay.innerHTML = `
      <div style="background:#fff;border-radius:20px;padding:28px 22px;
                  width:100%;max-width:360px;box-sizing:border-box;">
        <p style="font-weight:700;font-size:16px;margin:0 0 10px;color:#111827">
          첫 방문이시군요
        </p>
        <p style="font-size:13px;color:#374151;line-height:1.6;margin:0 0 20px">
          고팡의 암호키(GDC Wallet)는 보안을 위해 <b>오직 스마트폰에서만</b> 생성할 수 있습니다.<br><br>
          지금 접속하신 기기가 <b>스마트폰</b>인가요?
        </p>
        <div style="display:flex;gap:8px">
          <button id="_mc_no"
            style="flex:1;padding:13px;border:1px solid #e5e7eb;border-radius:10px;
                   background:none;cursor:pointer;font-size:14px;font-family:inherit">
            아니요, PC입니다
          </button>
          <button id="_mc_yes"
            style="flex:1;padding:13px;border:none;border-radius:10px;
                   background:#16a34a;color:#fff;cursor:pointer;
                   font-size:14px;font-weight:700;font-family:inherit">
            예, 스마트폰입니다
          </button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#_mc_yes').onclick = () => { overlay.remove(); resolve(true); };
    overlay.querySelector('#_mc_no').onclick  = () => { overlay.remove(); resolve(false); };
  });
}

// ── PC 확인 후 "아니요"를 선택했을 때 보여줄 안내 ───────────
function _showPcRegisterBlockedNotice() {
  document.getElementById('_mobile-confirm-overlay')?.remove();
  document.getElementById('_pc-blocked-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = '_pc-blocked-overlay';
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:10002',
    'background:rgba(0,0,0,0.5)',
    'display:flex;align-items:center;justify-content:center',
    'padding:24px;box-sizing:border-box',
  ].join(';');

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:20px;padding:28px 22px;
                width:100%;max-width:360px;box-sizing:border-box;text-align:center">
      <p style="font-weight:700;font-size:16px;margin:0 0 10px;color:#111827">
        스마트폰으로 등록해 주세요
      </p>
      <p style="font-size:13px;color:#374151;line-height:1.6;margin:0 0 20px">
        사용자 등록(암호키 생성)은 스마트폰에서만 가능합니다.<br>
        스마트폰으로 <b>gopang.net</b>에 접속해 등록해 주세요.<br><br>
        등록을 마친 후에는 PC에서도 로그인할 수 있습니다.
      </p>
      <button id="_pc_blocked_close"
        style="width:100%;padding:13px;border:none;border-radius:10px;
               background:#16a34a;color:#fff;cursor:pointer;
               font-size:14px;font-weight:700;font-family:inherit">
        확인
      </button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#_pc_blocked_close').onclick = () => overlay.remove();
}

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

// ── window.gopangWallet 준비 대기 ────────────────────────
// gopang-wallet.js의 싱글턴 초기화는 비동기(IIFE)라서, 이 모듈이 먼저 실행되면
// window.gopangWallet이 아직 null/undefined일 수 있다. 최대 5초 폴링.
function _waitForWallet(timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (window.gopangWallet) { resolve(window.gopangWallet); return; }
    const start = Date.now();
    const t = setInterval(() => {
      if (window.gopangWallet) {
        clearInterval(t);
        resolve(window.gopangWallet);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(t);
        resolve(null);
      }
    }, 100);
  });
}

// ── _issueSession — Ed25519 챌린지 서명 → Worker /auth/issue 검증 ───────
// v6.0: 로그인(또는 가입 직후 세션 수립)은 "전화번호/닉네임을 안다"가 아니라
// "그 guid에 핀(pin)된 Ed25519 개인키를 갖고 있다"로만 증명되어야 한다.
// 서버가 TOFU 핀과 다른 공개키를 보면 PUBKEY_MISMATCH를 반환 — 이 기기가
// 그 계정의 정당한 기기가 아니라는 뜻이므로, 호출부는 절대 로그인으로
// 폴백하지 말고 reason을 그대로 사용자에게 보여줘야 한다.
async function _issueSession(guid, svc = 'gopang', level = 'L0') {
  const wallet = await _waitForWallet();
  if (!wallet?.publicKeyB64u || typeof wallet.signPayload !== 'function') {
    return { ok: false, reason: 'wallet_not_ready' };
  }
  const ts = Date.now();
  const sigMsg = `auth-issue:${guid}:${wallet.publicKeyB64u}:${svc}:${ts}`;
  let signature;
  try {
    signature = await wallet.signPayload(sigMsg);
  } catch (e) {
    return { ok: false, reason: 'sign_failed' };
  }
  try {
    const res = await fetch(`${PROXY_URL}/auth/issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guid, pubkey: wallet.publicKeyB64u, signature, ts, level, svc }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, reason: data?.code || data?.detail || `http_${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'network' };
  }
}

// ── 백업 키 확인 여부(이 기기) ────────────────────────────
const BACKUP_CONFIRMED_KEY = 'gopang_backup_confirmed_v1';
export function _hasConfirmedBackup() {
  try { return localStorage.getItem(BACKUP_CONFIRMED_KEY) === '1'; }
  catch { return false; }
}

// ── 백업 키를 본인 이메일로 — mailto (서버를 거치지 않음) ──
// 서버가 개인키를 보거나 보관하지 않도록, 발송은 전적으로 사용자 기기의
// 메일 앱이 처리한다(mailto:). 키는 기기 → 사용자 본인 메일함으로만 이동한다.
function _mailtoBackupKey(key, handle) {
  const subject = encodeURIComponent('[혼디] 내 백업 키 — 안전하게 보관하세요');
  const body = encodeURIComponent(
    `혼디(Hondi) 계정 백업 키입니다.\n` +
    (handle ? `계정: ${handle}\n` : '') +
    `\n${key}\n\n` +
    `이 키를 아는 사람은 누구나 이 계정이 될 수 있습니다.\n` +
    `이 메일을 다른 사람에게 전달하거나 공개된 곳에 저장하지 마세요.\n` +
    `기기를 분실했을 때, 새 기기의 설정 → 백업 키 화면에서 이 키를 입력하면 계정을 복구할 수 있습니다.`
  );
  window.location.href = `mailto:?subject=${subject}&body=${body}`;
}

// ── 가입 직후 필수 백업 확인 단계 ─────────────────────────
// v6.0: 이 단계를 건너뛸 방법이 없다(닫기/배경클릭 없음, _showPhonePopup과 동일
// 패턴) — resolve()가 호출돼야만 _register()가 끝나고 가입이 "완료"된다.
// 개인키는 서버 어디에도 사본이 없으므로, 사용자가 직접 백업해두지 않으면
// 기기 분실 시 영구히 그 계정을 잃는다 — 이 위험을 가입 완료 조건으로 만든다.
function _showMandatoryBackupStep(key, handle) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = '_backup-mandatory-overlay';
    overlay.style.cssText = [
      'position:fixed;inset:0;z-index:10004',
      'background:rgba(0,0,0,0.6)',
      'display:flex;align-items:center;justify-content:center',
      'padding:24px;box-sizing:border-box',
    ].join(';');

    overlay.innerHTML = `
      <div style="background:#fff;border-radius:20px;padding:28px 22px;
                  width:100%;max-width:380px;box-sizing:border-box">
        <p style="font-weight:700;font-size:17px;margin:0 0 8px;color:#111827;text-align:center">
          백업 키를 저장하세요
        </p>
        <p style="font-size:13px;color:#374151;line-height:1.6;margin:0 0 16px;text-align:center">
          이 키는 이 기기에만 있고, 혼디 서버에는 사본이 없습니다.<br>
          <b>지금 저장하지 않으면, 이 기기를 잃었을 때 계정을 되찾을 방법이 없습니다.</b>
        </p>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;
             padding:12px;font-family:monospace;font-size:12px;word-break:break-all;
             color:#111827;margin-bottom:12px">${key}</div>
        <div style="display:flex;gap:8px;margin-bottom:16px">
          <button id="_bm_copy" style="flex:1;padding:11px;border:1px solid #e5e7eb;border-radius:8px;
                  background:none;color:#16a34a;font-weight:600;cursor:pointer;font-size:13px">
            복사
          </button>
          <button id="_bm_mail" style="flex:1;padding:11px;border:1px solid #e5e7eb;border-radius:8px;
                  background:none;color:#16a34a;font-weight:600;cursor:pointer;font-size:13px">
            이메일로 보내기
          </button>
        </div>
        <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;margin-bottom:16px">
          <input type="checkbox" id="_bm_chk" style="width:16px;height:16px;margin-top:1px;accent-color:#16a34a;flex-shrink:0">
          <span style="font-size:13px;color:#374151;line-height:1.5">이 키를 안전한 곳에 저장했습니다. 분실 시 계정을 복구할 수 없다는 점을 이해했습니다.</span>
        </label>
        <button id="_bm_continue" disabled
          style="width:100%;padding:13px;border:none;border-radius:10px;
                 background:#d1d5db;color:#fff;cursor:not-allowed;
                 font-size:14px;font-weight:700;font-family:inherit;transition:background .15s">
          계속하기
        </button>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#_bm_copy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(key);
        const btn = overlay.querySelector('#_bm_copy');
        btn.textContent = '복사됨';
        setTimeout(() => { btn.textContent = '복사'; }, 1500);
      } catch { alert('복사에 실패했습니다. 직접 길게 눌러 선택해 주세요.'); }
    };
    overlay.querySelector('#_bm_mail').onclick = () => _mailtoBackupKey(key, handle);

    const chk = overlay.querySelector('#_bm_chk');
    const continueBtn = overlay.querySelector('#_bm_continue');
    chk.addEventListener('change', () => {
      continueBtn.disabled = !chk.checked;
      continueBtn.style.background = chk.checked ? '#16a34a' : '#d1d5db';
      continueBtn.style.cursor = chk.checked ? 'pointer' : 'not-allowed';
    });
    continueBtn.onclick = () => {
      if (!chk.checked) return;
      try { localStorage.setItem(BACKUP_CONFIRMED_KEY, '1'); } catch {}
      overlay.remove();
      resolve();
    };
    // 의도적으로 닫기/배경클릭 핸들러를 두지 않음 — 확인 없이는 빠져나갈 수 없다.
  });
}

// ── 백업 키 내보내기 (설정 화면에서 사용) ────────────────
export async function _exportBackupKey() {
  const wallet = await _waitForWallet();
  if (!wallet || typeof wallet.exportPrivateKey !== 'function') return null;
  return wallet.exportPrivateKey();
}

// ── 백업 키로 이 기기의 지갑을 교체 + 서버 검증 ──────────
// 성공하면 window.gopangWallet이 복원된 키로 교체되어, 이후 모든 서명이
// 그 키로 이뤄진다. guid가 주어지면 그 guid에 대해 즉시 /auth/issue로
// 검증까지 시도한다(로그인 복구 흐름용). guid 없이 호출(설정 화면에서의
// 단순 키 교체)도 가능하다.
export async function _restoreFromBackupKey(privKeyB64u, guid = null, svc = 'gopang') {
  if (typeof window.GopangWallet === 'undefined') return { ok: false, reason: 'wallet_module_not_loaded' };
  let wallet;
  try {
    wallet = await window.GopangWallet.restoreFromPrivateKey(privKeyB64u);
  } catch (e) {
    return { ok: false, reason: e.message || 'invalid_key' };
  }
  if (guid) wallet.setIdentity({ guid, handle: null });
  window.gopangWallet = wallet; // 싱글턴 교체 — 이후 서명은 전부 복원된 키로

  // 백업 키를 직접 입력했다는 것 자체가 "이미 어딘가에 저장해 뒀다"는 증거다 —
  // 이 기기에서 다시 백업 안내로 귀찮게 하지 않는다.
  try { localStorage.setItem(BACKUP_CONFIRMED_KEY, '1'); } catch {}

  if (!guid) return { ok: true };

  const session = await _issueSession(guid, svc);
  if (!session.ok) return { ok: false, reason: session.reason };
  return { ok: true };
}

// ── 기기 불일치 안내 + 백업 키 복구 폼 ───────────────────
// found: L1에서 찾은 기존 계정 레코드, resolve: initAuth류의 원래 resolve 콜백
function _showDeviceMismatchNotice(found, resolve) {
  document.getElementById('_device-mismatch-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = '_device-mismatch-overlay';
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:10003',
    'background:rgba(0,0,0,0.5)',
    'display:flex;align-items:center;justify-content:center',
    'padding:24px;box-sizing:border-box',
  ].join(';');

  const _renderNotice = () => {
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:20px;padding:28px 22px;
                  width:100%;max-width:360px;box-sizing:border-box;text-align:center">
        <p style="font-weight:700;font-size:16px;margin:0 0 10px;color:#111827">
          이 기기는 등록된 기기가 아닙니다
        </p>
        <p style="font-size:13px;color:#374151;line-height:1.6;margin:0 0 20px">
          입력하신 번호(또는 닉네임)로 가입된 계정이 이미 있지만,<br>
          이 계정의 암호키(GDC Wallet)는 이 기기에 없습니다.<br><br>
          본인 계정이라면 백업 키로 이 기기를 등록할 수 있습니다.<br>
          본인 계정이 아니라면 다른 번호로 가입해 주세요.
        </p>
        <button id="_dm_restore"
          style="width:100%;padding:13px;border:none;border-radius:10px;
                 background:#16a34a;color:#fff;cursor:pointer;margin-bottom:8px;
                 font-size:14px;font-weight:700;font-family:inherit">
          백업 키로 복구
        </button>
        <button id="_dm_close"
          style="width:100%;padding:13px;border:1px solid #e5e7eb;border-radius:10px;
                 background:none;color:#6b7280;cursor:pointer;
                 font-size:14px;font-family:inherit">
          닫기
        </button>
      </div>`;
    overlay.querySelector('#_dm_restore').onclick = _renderRestoreForm;
    overlay.querySelector('#_dm_close').onclick = () => { overlay.remove(); resolve?.(null); };
  };

  const _renderRestoreForm = () => {
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:20px;padding:28px 22px;
                  width:100%;max-width:360px;box-sizing:border-box">
        <p style="font-weight:700;font-size:16px;margin:0 0 10px;color:#111827;text-align:center">
          백업 키 입력
        </p>
        <p style="font-size:13px;color:#374151;line-height:1.6;margin:0 0 16px;text-align:center">
          가입 시 또는 설정 → 백업 키에서 내보낸<br>키 문자열을 붙여넣어 주세요.
        </p>
        <textarea id="_dm_key_input" rows="3" placeholder="백업 키 붙여넣기"
          style="width:100%;border:1px solid #e5e7eb;border-radius:10px;padding:12px;
                 font-size:13px;font-family:monospace;resize:none;box-sizing:border-box;
                 margin-bottom:8px" autocomplete="off" autocorrect="off" spellcheck="false"></textarea>
        <div id="_dm_err" style="display:none;font-size:12px;color:#dc2626;margin-bottom:8px"></div>
        <button id="_dm_submit"
          style="width:100%;padding:13px;border:none;border-radius:10px;
                 background:#16a34a;color:#fff;cursor:pointer;margin-bottom:8px;
                 font-size:14px;font-weight:700;font-family:inherit">
          복구
        </button>
        <button id="_dm_back"
          style="width:100%;padding:13px;border:1px solid #e5e7eb;border-radius:10px;
                 background:none;color:#6b7280;cursor:pointer;
                 font-size:14px;font-family:inherit">
          뒤로
        </button>
      </div>`;
    const input  = overlay.querySelector('#_dm_key_input');
    const errEl  = overlay.querySelector('#_dm_err');
    const subBtn = overlay.querySelector('#_dm_submit');
    input.focus();

    overlay.querySelector('#_dm_back').onclick = _renderNotice;
    subBtn.onclick = async () => {
      const val = input.value.trim();
      if (!val) { errEl.textContent = '백업 키를 입력해 주세요.'; errEl.style.display = 'block'; return; }
      subBtn.disabled = true; subBtn.textContent = '확인 중…'; errEl.style.display = 'none';

      const result = await _restoreFromBackupKey(val, found.guid, 'gopang');
      if (!result.ok) {
        const msg = result.reason === 'PUBKEY_MISMATCH'
          ? '이 백업 키는 이 계정의 키가 아닙니다.'
          : result.reason === 'invalid_key'
            ? '키 형식이 올바르지 않습니다.'
            : '복구에 실패했습니다 (' + result.reason + ').';
        errEl.textContent = msg;
        errEl.style.display = 'block';
        subBtn.disabled = false; subBtn.textContent = '복구';
        return;
      }

      // 복구 + 서버 검증 통과 → 로그인 완료
      const user = {
        ipv6: found.guid, handle: found.handle,
        e164: found.e164 || '',
        country_code: found.country_code || DEFAULT_COUNTRY,
        nickname: found.nickname || '',
        region: found.region || '',
        name: found.handle, isGuest: false, isTemp: false,
        registeredAt: found.created,
      };
      localStorage.setItem(STORE_KEY, JSON.stringify(user));
      setUser(user);
      console.info('[Auth] 백업 키 복구 완료:', found.handle);
      overlay.remove();
      resolve?.(user);
    };
  };

  document.body.appendChild(overlay);
  _renderNotice();
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

// ── 번호를 직접 받아 처리 (통합 팝업용) ─────────────────
export async function initAuthWithPhone(digits, countryKey = 'KR') {
  const stored = _loadStored();
  if (stored?.ipv6) {
    setUser(stored);
    return stored;
  }
  return new Promise(async (resolve) => {
    const e164   = buildE164(digits, countryKey);
    const handle = buildHandle(digits, countryKey);
    try {
      const filter = encodeURIComponent(`handle='${handle}'`);
      const res    = await fetch(`${L1_URL}?filter=${filter}&perPage=1`);
      const data   = await res.json();
      const found  = data.items?.[0];

      if (found) {
        // v6.0: handle 일치만으로 더 이상 즉시 로그인하지 않는다 — 이 기기가
        // 그 guid에 핀(pin)된 Ed25519 키를 실제로 갖고 있다는 서명 증거가 있어야
        // 한다. 다른 사람의 번호/닉네임을 알았다고 해서 그 계정이 되어선 안 된다.
        const session = await _issueSession(found.guid, 'gopang');
        if (!session.ok) {
          console.warn('[Auth] 세션 검증 실패(통합팝업):', session.reason);
          _showDeviceMismatchNotice(found, resolve);
          return;
        }
        const user = {
          ipv6: found.guid, handle: found.handle,
          e164: found.e164 || '',
          country_code: found.country_code || countryKey,
          nickname: found.nickname || '',
          region: found.region || '',
          name: digits, isGuest: false, isTemp: false,
          registeredAt: found.created,
        };
        console.info('[Auth] 로그인 (통합팝업):', found.handle);
        localStorage.setItem(STORE_KEY, JSON.stringify(user));
        setUser(user);
        resolve(user);
      } else {
        // 신규 사용자 → 모바일 기기 확인 (암호키 생성은 휴대폰 전용)
        if (!_isMobileDevice()) {
          const ok = await _confirmMobileRegistration();
          if (!ok) {
            _showPcRegisterBlockedNotice();
            resolve(null);
            return;
          }
        }
        // 신규 사용자 → 닉네임 입력 단계 (더미 overlay 생성)
        const ipv6 = await _e164ToIPv6(e164);
        const dummyOverlay = document.createElement('div');
        dummyOverlay.style.cssText = 'position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:24px';
        const dummyCard = document.createElement('div');
        dummyCard.style.cssText = 'background:#fff;border-radius:20px;padding:28px 20px;width:100%;max-width:340px;box-sizing:border-box';
        dummyOverlay.appendChild(dummyCard);
        document.body.appendChild(dummyOverlay);
        // _showNicknameStep은 overlay.querySelector('div')로 card를 찾으므로
        // DOM 삽입 완료 후 다음 틱에 호출
        await new Promise(r => setTimeout(r, 0));
        _showNicknameStep({ ipv6, handle, e164, selectedCountry: countryKey, val: digits, overlay: dummyOverlay, resolve });
      }
    } catch(e) {
      console.warn('[Auth] initAuthWithPhone 실패:', e.message);
      resolve(null);
    }
  });
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
        전화번호 또는 닉네임
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
    // 닉네임 입력 시 숫자 제한 해제
    const v = input.value;
    if (!/^\d/.test(v) && v.length > 0) {
      // 닉네임 모드 — 자유 입력
    } else {
      input.value = v.replace(/\D/g, '').slice(0, COUNTRIES[selectedCountry].digits);
    }
    errEl.style.display = 'none';
  });

  const _submit = async () => {
    const val    = input.value.trim();
    const digits = COUNTRIES[selectedCountry].digits;
    const isNickname = val.length > 0 && !/^\d+$/.test(val);

    if (!isNickname && !new RegExp(`^\\d{${digits}}$`).test(val)) {
      errEl.textContent = `전화번호(${digits}자리) 또는 닉네임을 입력해 주세요.`;
      errEl.style.display = 'block';
      input.focus();
      return;
    }

    const btn = document.getElementById('_phone-btn');
    btn.style.opacity = '0.4';
    btn.style.pointerEvents = 'none';
    errEl.style.display = 'none';

    try {
      let found;

      if (isNickname) {
        // ── 닉네임으로 L1 PocketBase 검색 (정확 일치, 대소문자 무시) ──
        // PocketBase = 연산자는 대소문자 구분 → 저장값과 동일한 케이스로 시도
        // 1차: 입력값 그대로, 2차: toLowerCase(), 3차: 첫 글자 대문자
        const nickLower = val.toLowerCase();
        const nickTitle = val.charAt(0).toUpperCase() + val.slice(1).toLowerCase();
        let found3 = null;
        for (const nick of [val, nickLower, nickTitle]) {
          const f = encodeURIComponent(`nickname='${nick}'`);
          const r = await fetch(`${L1_URL}?filter=${f}&perPage=1`);
          const d = await r.json();
          if (d.items?.[0]) { found3 = d.items[0]; break; }
        }
        found = found3;

        if (!found) {
          errEl.textContent = `닉네임 '${val}'을(를) 찾을 수 없습니다. 전화번호로 로그인해 주세요.`;
          errEl.style.display = 'block';
          btn.style.opacity = '1';
          btn.style.pointerEvents = '';
          return;
        }
      } else {
        // ── 전화번호로 검색 (기존 로직) ────────────────
        const e164   = buildE164(val, selectedCountry);
        const handle = buildHandle(val, selectedCountry);
        const filter = encodeURIComponent(`handle='${handle}'`);
        const res    = await fetch(`${L1_URL}?filter=${filter}&perPage=1`);
        const data   = await res.json();
        found = data.items?.[0];

        if (!found) {
          // 신규 사용자 → 모바일 기기 확인 (암호키 생성은 휴대폰 전용)
          if (!_isMobileDevice()) {
            btn.style.opacity = '1';
            btn.style.pointerEvents = '';
            const ok = await _confirmMobileRegistration();
            if (!ok) {
              _showPcRegisterBlockedNotice();
              overlay.remove();
              resolve(null);
              return;
            }
            btn.style.opacity = '0.4';
            btn.style.pointerEvents = 'none';
          }
          // 신규 사용자 → 닉네임 입력 단계
          const ipv6 = await _e164ToIPv6(e164);
          btn.style.opacity = '1';
          btn.style.pointerEvents = '';
          _showNicknameStep({ ipv6, handle, e164, selectedCountry, val, overlay, resolve });
          return;
        }
      }

      // v6.0: handle/닉네임 일치만으로 더 이상 즉시 로그인하지 않는다 —
      // 이 기기가 그 guid에 핀(pin)된 Ed25519 키를 실제로 갖고 있다는 서명
      // 증거가 있어야 한다. 전화번호나 닉네임은 비밀이 아니다(누구나 알 수 있음).
      const session = await _issueSession(found.guid, 'gopang');
      if (!session.ok) {
        console.warn('[Auth] 세션 검증 실패:', session.reason);
        btn.style.opacity = '1';
        btn.style.pointerEvents = '';
        overlay.remove();
        _showDeviceMismatchNotice(found, resolve);
        return;
      }

      // 기존 사용자 → 로그인 (서명 검증 통과)
      const user = {
        ipv6: found.guid, handle: found.handle,
        e164: found.e164 || '',
        country_code: found.country_code || selectedCountry,
        nickname: found.nickname || '',
        region: found.region || '',
        name: val, isGuest: false, isTemp: false,
        registeredAt: found.created,
      };
      console.info('[Auth] 로그인:', found.handle, '(닉네임:', isNickname, ')');
      localStorage.setItem(STORE_KEY, JSON.stringify(user));
      setUser(user);
      overlay.remove();
      resolve(user);

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
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
      <div style="flex:1;display:flex;align-items:center;
                  border:1px solid #e5e7eb;border-radius:12px;
                  background:#f9fafb;overflow:hidden"
           id="_region-field">
        <input id="_region-input" type="text" maxlength="60"
          placeholder="예: 서울, New York"
          style="flex:1;padding:0 14px;height:48px;border:none;background:transparent;
                 font-size:14px;font-family:inherit;outline:none;color:#111827;min-width:0"
          autocomplete="off"/>
      </div>
      <button id="_region-loc-btn"
        style="height:48px;padding:0 12px;border:1px solid #e5e7eb;border-radius:12px;
               background:#f9fafb;font-size:12px;color:#374151;cursor:pointer;
               font-family:inherit;white-space:nowrap;flex-shrink:0">내 위치</button>
    </div>

    <!-- 프로필 공개 여부 -->
    <div style="display:flex;align-items:center;justify-content:space-between;
                padding:10px 14px;border:1px solid #e5e7eb;border-radius:12px;
                background:#f9fafb;margin-bottom:8px">
      <span style="font-size:14px;color:#374151">프로필 공개</span>
      <label style="position:relative;display:inline-block;width:44px;height:26px">
        <input type="checkbox" id="_is-public-chk" checked
               style="opacity:0;width:0;height:0">
        <span id="_is-public-slider"
              style="position:absolute;inset:0;background:#16a34a;border-radius:13px;
                     cursor:pointer;transition:background .2s"
              onclick="this.style.background=document.getElementById('_is-public-chk').checked?'#d1d5db':'#16a34a'">
          <span style="position:absolute;width:20px;height:20px;border-radius:50%;
                       background:#fff;left:3px;top:3px;transition:transform .2s;
                       box-shadow:0 1px 3px rgba(0,0,0,.2);
                       transform:translateX(18px)" id="_is-public-knob"></span>
        </span>
      </label>
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
  const nickField   = document.getElementById('_nick-field');
  const nickErr     = document.getElementById('_nick-error');

  nickInput.focus();
  nickInput.addEventListener('focus', () => nickField.style.borderColor = '#16a34a');
  nickInput.addEventListener('blur',  () => nickField.style.borderColor = '#e5e7eb');

  const regionInput  = document.getElementById('_region-input');
  const regionLocBtn = document.getElementById('_region-loc-btn');

  const _autoRegion = () => {
    if (!navigator.geolocation) return;
    regionLocBtn.textContent = '확인 중…'; regionLocBtn.disabled = true;
    navigator.geolocation.getCurrentPosition(async pos => {
      const { latitude: lat, longitude: lng } = pos.coords;
      try {
        const res  = await fetch(PROXY_URL + '/geocode?lat=' + lat + '&lng=' + lng);
        const data = await res.json();
        const doc  = data && data.documents && data.documents[0];
        const addr = (doc && doc.road_address && doc.road_address.address_name)
                  || (doc && doc.address && doc.address.address_name)
                  || (lat.toFixed(5) + ', ' + lng.toFixed(5));
        regionInput.value = addr;
      } catch(e) {
        regionInput.value = lat.toFixed(5) + ', ' + lng.toFixed(5);
      }
      regionLocBtn.textContent = '재검색'; regionLocBtn.disabled = false;
    }, () => { regionLocBtn.textContent = '내 위치'; regionLocBtn.disabled = false; });
  };
  regionLocBtn.onclick = _autoRegion;
  _autoRegion();

  // ── 닉네임 실시간 동명이인 안내 ─────────────────────────
  let _nickTimer = null;
  nickInput.addEventListener('input', () => {
    nickErr.style.display = 'none';
    const nick = nickInput.value.trim();
    clearTimeout(_nickTimer);

    // 힌트 초기화
    let hintEl = document.getElementById('_nick-hint');
    if (!hintEl) {
      hintEl = document.createElement('div');
      hintEl.id = '_nick-hint';
      hintEl.style.cssText = 'font-size:12px;color:#9ca3af;padding:0 4px;margin-bottom:6px;line-height:1.6;min-height:18px';
      nickErr.insertAdjacentElement('afterend', hintEl);
    }

    if (nick.length < 2) { hintEl.innerHTML = ''; return; }

    hintEl.innerHTML = '<span style="color:#9ca3af">확인 중…</span>';

    _nickTimer = setTimeout(async () => {
      try {
        // L1 PocketBase에서 동명이인 수 조회
        const nickLower = encodeURIComponent(`nickname='${nick}'`);
        const r = await fetch(`${L1_URL}?filter=${nickLower}&perPage=1`);
        const d = await r.json();
        const total = d.totalItems ?? d.items?.length ?? 0;

        if (total === 0) {
          hintEl.innerHTML =
            `<span style="color:#16a34a">✓ 처음 사용하는 닉네임입니다.</span>`;
        } else {
          hintEl.innerHTML =
            `<span style="color:#f59e0b">⚠ 이미 ${total}명이 사용 중입니다.</span> ` +
            `<span style="color:#9ca3af">handle <b style="color:#16a34a">${handle}</b>로 구분됩니다.</span>`;
        }
      } catch {
        hintEl.innerHTML = '';
      }
    }, 400);
  });

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

      // ── 암호키 등록 + 프로필 생성 (가입의 일부 — resolve 전 완료) ─────────
      // 정책: 가입 즉시 Ed25519·X25519 키가 L1에 등록 완료되어야 한다.
      // _createMinimalProfile: Supabase user_profiles에 Ed25519 공개키 등록
      // ensureX25519Synced:    L1 profiles에 X25519 공개키 등록
      // 두 단계 모두 await — 실패 시 3초 후 1회 재시도, 이후에도 가입은 진행(UX 차단 방지)
      try {
        await _createMinimalProfile({ ipv6, handle, nickname, e164, isPublic:
          document.getElementById('_is-public-chk')?.checked ?? true
        });
        console.info('[가입] 프로필 생성 완료');
      } catch(e) {
        console.warn('[가입] 프로필 생성 실패 (무시):', e.message);
      }

      // 가입 직후 세션 수립 — /profile이 방금 핀(pin)한 pubkey와 같은 지갑이므로
      // 항상 성공해야 정상이다. 실패해도 가입 자체는 막지 않는다(다음 진입 시
      // 다시 시도됨) — 단, 실패를 조용히 묻지 않고 로그로 남겨 추적 가능하게 한다.
      const _session = await _issueSession(ipv6, 'gopang');
      if (!_session.ok) console.warn('[가입] 세션 수립 실패 (무시):', _session.reason);

      // PDV 초기 레코드 (비동기 — 가입 흐름 차단 불필요)
      _recordRegisterPdv({ ipv6, handle, nickname, e164, selectedCountry }).catch(
        e => console.warn('[PDV] 가입 초기 레코드 실패 (무시):', e.message)
      );

      // X25519 키 생성 + L1 등록 — 가입 완료 전 동기 처리
      let syncResult = await ensureX25519Synced(ipv6).catch(e => {
        console.error('[가입][X25519] 예외:', e.message); return { ok: false };
      });
      if (!syncResult?.ok) {
        console.warn('[가입][X25519] 1차 실패:', syncResult?.reason, '— 3초 후 재시도');
        await new Promise(r => setTimeout(r, 3000));
        syncResult = await ensureX25519Synced(ipv6).catch(e => {
          console.error('[가입][X25519] 재시도 예외:', e.message); return { ok: false };
        });
        if (syncResult?.ok) {
          console.info('[가입][X25519] 재시도 성공');
        } else {
          console.error('[가입][X25519] 재시도도 실패:', syncResult?.reason, '— 가입은 계속 진행');
        }
      } else {
        console.info('[가입][X25519] 키 등록 완료:', syncResult.publicKeyB64u?.slice(0, 16) + '...');
      }

      // 필수 백업 확인 — 체크박스를 누르기 전까지 가입이 "완료"되지 않는다.
      // 개인키는 서버에 사본이 없으므로, 이 단계가 사실상 마지막 안전망이다.
      const backupKey = await _exportBackupKey();
      if (backupKey) {
        await _showMandatoryBackupStep(backupKey, handle);
      } else {
        console.warn('[가입] 백업 키를 내보내지 못함 — 지갑 준비 지연 가능성. 확인 단계 생략.');
      }

      resolve(user);

      // 가입 완료 시점에 푸시 알림 권한 요청 — 결과를 채팅에 안내
      // (가입 완료를 막지 않도록 resolve 이후 비동기로 처리)
      requestPushSubscription(ipv6).then(pushResult => {
        if (!document.getElementById('message-list')) return; // 화면 전환 전이면 조용히 스킵
        if (pushResult.ok) {
          appendBubble('ai', '🔔 알림이 활성화되었습니다. PC에서 AI 키를 보내면 실시간으로 알려드릴게요.');
        } else if (pushResult.reason === 'permission_denied') {
          appendBubble('ai', '🔔 알림 권한이 꺼져 있어요. PC에서 보낸 메시지를 실시간으로 받으려면 브라우저 설정 → 알림에서 고팡을 허용해 주세요.');
        }
        // unsupported/guid_missing 등은 사용자가 할 수 있는 게 없으므로 조용히 무시
      }).catch(() => {});

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
// ── 로컬 데이터만 초기화 (L1 레코드 유지 → 재접속 시 복원 가능) ──
export async function _deviceLocalReset() {
  if (!confirm('이 기기의 고팡 데이터를 초기화합니다.\n\n계정 정보는 서버에 유지되므로\n같은 번호로 재접속하면 복원됩니다.')) return;
  await _clearLocalData();
}

// ── 계정 완전 삭제 (L1 레코드 + 로컬 모두 삭제, 판매·양도용) ──
export async function _deviceFullReset() {
  if (!confirm(
    '계정을 완전히 삭제합니다.\n' +
    '\n' +
    '⚠️ L1 서버, Supabase, 이 기기의 모든 기록이 삭제됩니다.\n' +
    '복원이 불가능합니다. 계속하시겠습니까?'
  )) return;

  const stored = _loadStored();
  const guid   = stored?.ipv6;

  if (guid) {
    // 서버 전체 삭제 — Worker가 L1·Supabase·KV 일괄 처리
    try {
      let resetBody = { guid };
      if (typeof window.GopangWallet !== 'undefined') {
        const wallet = await window.GopangWallet.load().catch(() => null);
        if (wallet?.publicKeyB64u && typeof wallet.signPayload === 'function') {
          const ts  = Date.now();
          const sig = await wallet.signPayload(`full-reset:${guid}:${ts}`);
          resetBody = { guid, ed25519_pubkey: wallet.publicKeyB64u, signature: sig, ts };
        }
      }
      const res  = await fetch(`${PROXY_URL}/account/full-reset`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(resetBody),
      });
      const data = await res.json().catch(() => ({}));
      console.info('[Reset] 서버 삭제 완료:', data.results || data);
    } catch(e) {
      console.warn('[Reset] 서버 삭제 실패 (로컬은 계속 진행):', e.message);
    }
  }

  // 스마트폰/PC 로컬 전체 삭제
  // localStorage, sessionStorage, IndexedDB(지갑 포함), SW 캐시, PWA 캐시
  await _clearLocalData();
}

// ── 공통: 로컬 데이터 삭제 + 페이지 리로드 ─────────────────
async function _clearLocalData() {
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
      // v6.0: 전화번호 재입력은 증명이 아니다(전화번호는 비밀이 아님 — 아는 사람
      // 누구나 통과할 수 있었다). 대신 이 기기의 Ed25519 키가 실제로 이 계정에
      // 핀(pin)된 키인지 서버가 서명으로 검증한다(_issueSession과 동일 경로,
      // level만 L3).
      appendBubble('ai', '🔑 보안키 인증이 필요합니다.', true);
      const session = await _issueSession(stored.ipv6, 'gopang', 'L3');
      if (!session.ok) {
        appendBubble('ai', `❌ 인증 실패 (${session.reason === 'PUBKEY_MISMATCH' ? '이 기기는 등록된 기기가 아닙니다' : session.reason}).`, true);
        return false;
      }
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

// ── ensureX25519Synced — X25519 키 보장 + 서버 등록 (가입 완료 / AI 설정 화면 공통) ──
// PC(ai-setup.html)가 이 사용자의 핸들을 검색해 공개키를 얻어 LLM Key를
// 암호화해 보낼 수 있도록, 가입 직후부터 키를 준비해 둔다.
// 반환: { ok, publicKeyB64u } — 실패해도 가입 흐름을 막지 않도록 호출부에서 catch 처리.
export async function ensureX25519Synced(guid) {
  if (!guid) return { ok: false, reason: 'guid_missing' };
  if (typeof window.GopangWallet === 'undefined') return { ok: false, reason: 'wallet_module_not_loaded' };

  const wallet = await window.GopangWallet.load();
  if (!wallet) return { ok: false, reason: 'wallet_not_found' };

  const { publicKeyB64u } = await wallet.ensureX25519Key();

  // 로컬에 키가 있다는 사실과 "서버에 등록되어 있다"는 사실은 별개이므로
  // (네트워크 오류, user_profiles 미생성 등으로 서버 등록이 실패할 수 있음),
  // 매번 서버 상태를 직접 조회해 확인한다.
  let serverOk = false;
  try {
    const checkRes = await fetch(`${PROXY_URL}/wallet/x25519?guid=${encodeURIComponent(guid)}`);
    const checkData = await checkRes.json();
    serverOk = !!(checkData.ok && checkData.registered && checkData.x25519_pubkey === publicKeyB64u);
  } catch {}

  if (!serverOk) {
    const ts = Math.floor(Date.now() / 1000);
    const sigMsg = `${guid}:${publicKeyB64u}:${ts}`;
    const signature = await wallet.signPayload(sigMsg);

    const regRes = await fetch(`${PROXY_URL}/wallet/x25519`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guid, x25519_pubkey: publicKeyB64u,
        ed25519_pubkey: wallet.publicKeyB64u,
        signature, ts,
      }),
    }).catch(e => { console.warn('[X25519] 공개키 등록 요청 실패:', e.message); return null; });

    if (!regRes) return { ok: false, reason: 'network' };
    const regData = await regRes.json().catch(() => null);
    if (!regRes.ok || !regData?.ok) return { ok: false, reason: regData?.detail || 'server_error' };
  }

  return { ok: true, publicKeyB64u, wallet };
}

// ── _createMinimalProfile — 가입 완료 시 최소 프로필 자동 생성 ───────────────
async function _createMinimalProfile({ ipv6, handle, nickname, e164, isPublic }) {
  try {
    const wallet = window.gopangWallet;
    if (!wallet) throw new Error('gopangWallet 없음');

    // wallet에 guid 반영 (setIdentity가 아직 안 된 경우 대비)
    if (!wallet.guid && wallet.setIdentity) {
      wallet.setIdentity({ guid: ipv6, handle });
    }

    const ts = Date.now().toString();
    const sigMsg = `${ipv6}:${wallet.publicKeyB64u}:${ts}`;
    const signature = await wallet.signPayload(sigMsg);

    const payload = {
      guid:        ipv6,
      pubkey:      wallet.publicKeyB64u,
      signature,
      ts,
      entity_type: 'person',
      name:        nickname,
      handle,
      phone:       e164 || null,
      is_public:   isPublic,
      native_lang: navigator.language?.slice(0, 2) || 'ko',
    };

    const { PROXY } = await import('./state.js');
    const res = await fetch(`${PROXY}/profile`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.info('[Profile] 최소 프로필 생성 완료 | handle:', handle, '| is_public:', isPublic);
  } catch(e) {
    console.warn('[Profile] 최소 프로필 생성 실패:', e.message);
  }
}

// ── _recordRegisterPdv — 가입 완료 시 PDV 초기 레코드 + OpenHash 앵커링 ─────
// 목적:
//   1. 가입 원본 데이터 구성 → SHA-256(원본) = contentHash
//   2. gopangWallet.sign(contentHash) → userSig (Ed25519 서명)
//   3. hashChain.anchor(contentHash, [userSig], sessionId) → entryHash
//      entryHash = SHA-256(prevHash + contentHash + userSig + blockHeight)
//      prevHash: 이전 체인 상태 (위변조 방지 핵심)
//      userSig:  "나는 이 가입 데이터가 정확함을 서명한다"
//   4. pdv_log INSERT (openhash_anchored: true)
//   5. extra.fs 초기화
//      { bs-cash:0, pl-purchase:0, pl-revenue:0,
//        last_tx_id:null, last_block_hash:null }
//      bs-cash = wallet 잔액 (재무제표 현금 계정 = wallet)
//
// 설계:
//   - 원본은 호출자(auth.js)가 보관 — OpenHash에는 contentHash만 기록
//   - fire-and-forget — 실패해도 가입 흐름 차단 안 함
async function _recordRegisterPdv({ ipv6, handle, nickname, e164, selectedCountry }) {
  const now       = new Date().toISOString();
  const sessionId = `REG-${ipv6.replace(/:/g, '').slice(0, 12)}-${Date.now()}`;

  // ① 가입 원본 데이터 구성
  const regPayload = JSON.stringify({
    type: 'user_register', guid: ipv6, handle, nickname, e164,
    country_code: selectedCountry, ts: now,
  });

  // ② contentHash = SHA-256(원본)
  const buf         = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(regPayload));
  const contentHash = Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');

  // ③ Ed25519 서명 — "나는 이 가입 데이터가 정확함을 서명한다"
  //    _recordRegisterPdv 호출 시점에 gopangWallet은 아직 guid 미반영
  //    (wallet은 모듈 로드 시 1회만 localStorage를 읽음)
  //    → setIdentity()로 직접 guid를 주입한 후 서명
  let userSig = ipv6;  // fallback
  try {
    if (window.gopangWallet) {
      // guid 직접 주입
      if (typeof window.gopangWallet.setIdentity === 'function') {
        window.gopangWallet.setIdentity({ guid: ipv6, handle: null });
      }
      if (typeof window.gopangWallet.sign === 'function') {
        userSig = await window.gopangWallet.sign(contentHash);
      }
    }
  } catch (e) {
    console.warn('[Auth] Ed25519 서명 실패, guid로 대체:', e.message);
  }

  // ④ OpenHash 앵커링
  //    anchor(contentHash, [userSig], sessionId)
  //    entryHash = SHA-256(prevHash + contentHash + userSig + blockHeight)
  let entryHash = null;
  let layer     = null;
  try {
    const { anchor } = await import('../../openhash/hashChain.js');
    const result  = await anchor(contentHash, [userSig], sessionId);
    entryHash     = result.entryHash;
    layer         = result.layer;
    console.info('[Auth] OpenHash 앵커링 완료',
      '| contentHash:', contentHash.slice(0, 16),
      '| entryHash:', entryHash.slice(0, 16),
      '| layer:', layer);
  } catch (e) {
    console.warn('[Auth] OpenHash 앵커링 실패 (무시):', e.message);
  }

  // ⑤ pdv_log 기록
  const report = {
    svc:          'gopang',
    type:         'user_register',
    reporter_svc: 'gopang-auth',
    session_id:   sessionId,
    block_hash:   entryHash,
    who:  { ipv6, handle },
    when: now,
    where: 'https://gopang.net',
    what: `신규 사용자 가입: ${nickname} (${handle})`,
    how:  '전화번호 입력 → 즉시 등록 (테스트 모드, 상용화 시 SMS 2FA)',
    why:  '고팡 서비스 최초 가입',
  };

  await fetch(`${PROXY_URL}/pdv/report`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ report }),
  }).catch(e => console.warn('[PDV] report 전송 실패:', e.message));

  // ⑥ extra.fs 초기화
  //    bs-cash          = wallet 잔액 (재무제표 현금 계정)
  //    last_tx_id       = 마지막 거래 식별자 (null: 거래 없음)
  //    last_block_hash  = 마지막 거래 OpenHash 앵커
  //    last_updated_at  = 마지막 갱신 시각
  const fsInit = {
    'bs-cash':          0,
    'pl-purchase':      0,
    'pl-revenue':       0,
    'last_tx_id':       null,
    'last_block_hash':  null,
    'last_updated_at':  now,
  };

  // PATCH /profile은 worker.js 미지원 — Supabase 직접 접근
  {
    const { _SUPABASE_URL, _SUPABASE_KEY } = await import('./state.js');
    if (_SUPABASE_URL && _SUPABASE_KEY) {
      await fetch(
        `${_SUPABASE_URL}/rest/v1/user_profiles?guid=eq.${encodeURIComponent(ipv6)}`,
        {
          method:  'PATCH',
          headers: {
            'apikey':        _SUPABASE_KEY,
            'Authorization': `Bearer ${_SUPABASE_KEY}`,
            'Content-Type':  'application/json',
            'Prefer':        'return=minimal',
          },
          body: JSON.stringify({
            extra: { public: { finance: { fs: fsInit } } },
          }),
        }
      ).catch(e => console.warn('[PDV] fs 초기화 Supabase fallback 실패:', e.message));
    }
  }

  console.info('[Auth] 가입 PDV + OpenHash 앵커링 + fs 초기화 완료',
    '| handle:', handle,
    '| contentHash:', contentHash.slice(0, 16),
    '| entryHash:', entryHash?.slice(0, 16) ?? 'none',
    '| layer:', layer ?? 'none');
}

