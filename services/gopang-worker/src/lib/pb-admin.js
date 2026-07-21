/**
 * L1 PocketBase admin 인증 토큰 캐싱
 * — 모든 L1 컬렉션은 API 규칙이 전부 비어있어(admin-only) 이 토큰 없이는
 *   어떤 CRUD도 불가능하다 (seller_products_pocketbase_schema.md 컨벤션).
 * — L1_ADMIN_EMAIL/L1_ADMIN_PASSWORD는 Worker secret, 노드별로 동일 계정 사용.
 */

const _tokenCache = new Map(); // l1Base -> { token, expiresAt }
const TOKEN_TTL_MS = 55 * 60 * 1000; // PocketBase 기본 토큰 수명(1시간)보다 여유있게

export async function l1AdminToken(env, l1Base) {
  const cached = _tokenCache.get(l1Base);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  // [2026-07-21 수정] /api/collections/_superusers/auth-with-password는
  // PocketBase v0.23+ 전용 경로 — 실제 L1 서버는 0.22.14라 이 경로가 404난다
  // (worker.js의 _l1AdminTokenFor에 이미 있던 동일 경고를 놓쳤던 것, 실제
  // 배포 후 재현·확인됨). 구버전 경로로 수정.
  //
  // [2026-07-21 추가 수정] LEDGER_WRITE_SECRET에서 실제로 재현된 것과 같은
  // 문제 — PowerShell의 `"값" | wrangler secret put`이 문자열 끝에 개행을
  // 붙이는 경우가 있어, L1_ADMIN_EMAIL/PASSWORD도 동일 위험이 있다(400
  // 응답으로 재현 의심). 여기서 보내는 값은 항상 trim해서 방어한다 —
  // 이메일/비밀번호에 의미있는 선행·후행 공백이 올 일은 없으므로 안전하다.
  const identity = String(env.L1_ADMIN_EMAIL || '').trim();
  const password = String(env.L1_ADMIN_PASSWORD || '').trim();

  const res = await fetch(`${l1Base}/api/admins/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity, password }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`L1 admin 인증 실패 (${l1Base}): ${res.status} ${detail}`);
  }
  const data = await res.json();
  const token = `Bearer ${data.token}`;
  _tokenCache.set(l1Base, { token, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

/** PocketBase REST 호출 공통 래퍼 (admin 토큰 자동 첨부) */
export async function pbFetch(env, l1Base, path, { method = 'GET', body } = {}) {
  const token = await l1AdminToken(env, l1Base);
  const res = await fetch(`${l1Base}${path}`, {
    method,
    headers: {
      Authorization: token,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}
