import { SUPABASE_URL, SUPABASE_KEY } from '../../config.js';

const STORE_KEY = 'gopang_user_v2';

export async function buildDeviceFingerprint() {
  const raw = [
    navigator.userAgent, navigator.language,
    screen.width + 'x' + screen.height,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.hardwareConcurrency || '',
  ].join('|');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

export async function tryWebOTP() {
  if (!('OTPCredential' in window)) return null;
  try {
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 60_000);
    const cred = await navigator.credentials.get({ otp:{ transport:['sms'] }, signal:abort.signal });
    return cred?.code || null;
  } catch { return null; }
}

export async function initUser() {
  const stored = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
  const fp     = await buildDeviceFingerprint();

  if (stored?.guid && stored?.fp === fp) {
    console.info('[Auth] 자동 로그인', stored.guid.slice(0,8));
    return stored;
  }
  if (stored?.guid && stored?.fp !== fp) {
    console.warn('[Auth] 기기 변경 감지');
    _showDeviceChangedBanner();
  }

  const guid = stored?.guid || crypto.randomUUID();
  const user = {
    guid, fp,
    phone:        stored?.phone || null,
    registeredAt: stored?.registeredAt || new Date().toISOString(),
    lastSeenAt:   new Date().toISOString(),
  };
  localStorage.setItem(STORE_KEY, JSON.stringify(user));
  upsertUserRecord(user);
  if (!user.phone) tryWebOTP().then(otp => { if (otp) console.info('[Auth] WebOTP:', otp); });
  console.info('[Auth] 신규 등록', guid.slice(0,8));
  return user;
}

export async function upsertUserRecord(user) {
  try {
    await fetch(SUPABASE_URL + '/rest/v1/users', {
      method: 'POST',
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Content-Type':  'application/json',
        'Prefer':        'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        guid:          user.guid,
        device_fp:     user.fp,
        phone:         user.phone,
        registered_at: user.registeredAt,
        last_seen_at:  user.lastSeenAt,
      }),
    });
  } catch(e) { console.warn('[Auth] upsert 실패:', e.message); }
}

function _showDeviceChangedBanner() {
  const b = document.createElement('div');
  b.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#FF9F0A;color:#000;padding:10px 20px;border-radius:20px;z-index:9998;font-size:14px;font-weight:600;';
  b.textContent = '새 기기에서 접속됨. 전화번호 재확인이 필요할 수 있습니다.';
  document.body.appendChild(b);
  setTimeout(() => b.remove(), 6000);
}
