/**
 * SHARED_ATTR_INDEX KV 역색인
 * key: `${attrType}:${sha256(attrValueNormalized)}`  value: JSON string[] (guid 목록)
 * — KYC(1번) 대표자명, 디바이스 핑거프린트, PG 결제수단(카드/계좌 해시) 등을
 *   여기에 누적해두면 11번 배치가 노드 경계를 넘어 공유 속성을 찾을 수 있다.
 */

async function sha256Hex(input) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function normalize(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

export async function recordAttrLink(env, attrType, attrValue, guid) {
  if (!attrValue) return;
  const key = `${attrType}:${await sha256Hex(normalize(attrValue))}`;
  const raw = await env.SHARED_ATTR_INDEX.get(key);
  const guids = raw ? JSON.parse(raw) : [];
  if (!guids.includes(guid)) {
    guids.push(guid);
    await env.SHARED_ATTR_INDEX.put(key, JSON.stringify(guids));
  }
  return { key, guids };
}

export async function getLinkedAccounts(env, attrType, attrValue) {
  const key = `${attrType}:${await sha256Hex(normalize(attrValue))}`;
  const raw = await env.SHARED_ATTR_INDEX.get(key);
  return raw ? JSON.parse(raw) : [];
}

export async function listAttrKeysByPrefix(env, attrType) {
  const list = await env.SHARED_ATTR_INDEX.list({ prefix: `${attrType}:` });
  return list.keys.map((k) => k.name);
}
