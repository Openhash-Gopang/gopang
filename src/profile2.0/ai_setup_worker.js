/**
 * Worker /ai-setup 엔드포인트
 * GET  /ai-setup          → 현재 설정 조회
 * POST /ai-setup          → 설정 저장 (API 키 AES 암호화)
 */

// ── AES-256-GCM 암호화 ────────────────────────────────────────
async function aesEncrypt(plaintext, keyHex) {
  const key = await crypto.subtle.importKey(
    'raw', hexToBytes(keyHex),
    { name: 'AES-GCM' }, false, ['encrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  // iv(12B) + ciphertext → base64
  const combined = new Uint8Array(12 + enc.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(enc), 12);
  return btoa(String.fromCharCode(...combined));
}

async function aesDecrypt(b64, keyHex) {
  const combined = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const iv       = combined.slice(0, 12);
  const data     = combined.slice(12);
  const key = await crypto.subtle.importKey(
    'raw', hexToBytes(keyHex),
    { name: 'AES-GCM' }, false, ['decrypt']
  );
  const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(dec);
}

function hexToBytes(hex) {
  return new Uint8Array(hex.match(/.{2}/g).map(h => parseInt(h, 16)));
}

// ── GET /ai-setup — 현재 설정 조회 ──────────────────────────
export async function handleAiSetupGet(request, env, guid) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/user_llm_keys?guid=eq.${guid}&select=provider,model,ai_active,custom_prompt,native_lang`,
    { headers: {
      'apikey': env.SUPABASE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_KEY}`,
    }}
  );

  if (!res.ok) return jsonResp({ error: 'DB_ERROR' }, 502);
  const rows = await res.json();

  if (!rows.length) {
    return jsonResp({
      ai_active: false,
      provider:  'deepseek',
      model:     'deepseek-chat',
      has_key:   false,
      custom_prompt: '',
    });
  }

  const row = rows[0];
  return jsonResp({
    ai_active:         row.ai_active,
    provider:          row.provider,
    model:             row.model,
    has_key:           row.api_key_enc !== null && row.api_key_enc !== '',
    custom_prompt:     row.custom_prompt || '',
    native_lang:       row.native_lang || 'ko',
    // api_key_enc 원문은 절대 반환하지 않음
  });
}

// ── POST /ai-setup — 설정 저장 ──────────────────────────────
export async function handleAiSetupPost(request, env, guid) {
  const body = await request.json();
  const {
    provider         = 'deepseek',
    model            = 'deepseek-chat',
    ai_active        = false,
    api_key,                    // 새 키 (없으면 기존 유지)
    custom_prompt    = '',
    welcome_message  = '',
    off_hours_message = '',
    endpoint         = '',      // 커스텀 엔드포인트
  } = body;

  // 유효성 검사
  const validProviders = ['deepseek', 'anthropic', 'openai', 'custom'];
  if (!validProviders.includes(provider)) {
    return jsonResp({ error: 'INVALID_PROVIDER' }, 400);
  }

  // 토큰 절약: system prompt 800토큰 상한 경고 (차단은 아님)
  const tokenEst = Math.ceil(custom_prompt.length / 3.5);
  const tokenWarn = tokenEst > 800;

  // 기존 레코드 조회
  const existing = await fetch(
    `${env.SUPABASE_URL}/rest/v1/user_llm_keys?guid=eq.${guid}&select=api_key_enc`,
    { headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    }}
  ).then(r => r.json());

  // API 키 암호화
  let apiKeyEnc = existing[0]?.api_key_enc || null;

  if (api_key && api_key.trim()) {
    // 새 키 입력 시 암호화
    if (!env.AES_ENCRYPTION_KEY) {
      return jsonResp({ error: 'ENCRYPTION_KEY_MISSING' }, 500);
    }
    apiKeyEnc = await aesEncrypt(api_key.trim(), env.AES_ENCRYPTION_KEY);
  }

  if (!apiKeyEnc) {
    // 키가 없고 새로 입력도 없으면 오류
    return jsonResp({
      error: 'API_KEY_REQUIRED',
      message: 'API 키를 입력해 주세요'
    }, 400);
  }

  // extra.preference.ai 업데이트 (user_profiles)
  const extraPatch = {
    ai: {
      ai_active,
      welcome_message,
      off_hours_message,
      escalate_to:       null,
      escalate_delay_s:  30,
    }
  };

  // user_profiles extra.private.preference.ai 갱신
  await fetch(
    `${env.SUPABASE_URL}/rest/v1/user_profiles?guid=eq.${guid}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        extra: `jsonb_set(extra, '{private,preference,ai}', '${JSON.stringify(extraPatch.ai)}'::jsonb)`,
      }),
    }
  );

  // user_llm_keys UPSERT
  const upsertData = {
    guid,
    provider,
    model,
    api_key_enc:    apiKeyEnc,
    ai_active,
    custom_prompt,
    native_lang:    'ko',
    ...(endpoint && { endpoint }),
  };

  const upsertRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/user_llm_keys`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Prefer': 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(upsertData),
    }
  );

  if (!upsertRes.ok) {
    const err = await upsertRes.text();
    return jsonResp({ error: 'SAVE_FAILED', detail: err }, 500);
  }

  return jsonResp({
    ok: true,
    ai_active,
    provider,
    model,
    token_est:  tokenEst,
    token_warn: tokenWarn,
    message:    tokenWarn
      ? `저장 완료. System prompt가 약 ${tokenEst} 토큰으로 길어 비용이 증가할 수 있습니다.`
      : '저장 완료',
  });
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
