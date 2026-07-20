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

  const res = await fetch(`${l1Base}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identity: env.L1_ADMIN_EMAIL,
      password: env.L1_ADMIN_PASSWORD,
    }),
  });
  if (!res.ok) {
    throw new Error(`L1 admin 인증 실패 (${l1Base}): ${res.status}`);
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
