// ============================================================
// worker_signal_routes.js
// gopang-proxy Worker에 추가할 WebRTC 시그널링 엔드포인트
// 기존 handleRequest() switch문에 아래 case들을 추가
// ============================================================

// ── /signal/send — 시그널 전송 (offer/answer/ice) ─────────────
case '/signal/send': {
  if (req.method !== 'POST') return _err(405, 'METHOD_NOT_ALLOWED');
  const body = await req.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON');

  const { from_guid, to_guid, type, payload } = body;
  if (!from_guid || !to_guid || !type || !payload) {
    return _err(400, 'MISSING_FIELDS');
  }
  if (!['offer','answer','ice'].includes(type)) {
    return _err(400, 'INVALID_TYPE');
  }

  // 60초 TTL — 연결 수립 후 삭제되므로 짧게
  const expires_at = new Date(Date.now() + 60_000).toISOString();

  const res = await _sb(env).from('webrtc_signals').insert({
    from_guid, to_guid, type, payload, expires_at,
  });
  if (res.error) return _err(500, res.error.message);

  // 만료된 시그널 정리 (기회적 청소)
  _sb(env).from('webrtc_signals')
    .delete().lt('expires_at', new Date().toISOString())
    .then(() => {}).catch(() => {});

  return _ok({ ok: true });
}

// ── /signal/poll — 시그널 폴링 (Realtime 미지원 브라우저) ─────
case '/signal/poll': {
  if (req.method !== 'GET') return _err(405, 'METHOD_NOT_ALLOWED');
  const guid = url.searchParams.get('guid');
  if (!guid) return _err(400, 'GUID_REQUIRED');

  const res = await _sb(env)
    .from('webrtc_signals')
    .select('*')
    .eq('to_guid', guid)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(20);

  if (res.error) return _err(500, res.error.message);
  return _ok({ signals: res.data });
}

// ── /signal/delete — 시그널 삭제 (연결 수립 후 즉시 호출) ────
case '/signal/delete': {
  if (req.method !== 'POST') return _err(405, 'METHOD_NOT_ALLOWED');
  const body = await req.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON');

  // id 기준 삭제 (단건)
  if (body.id) {
    await _sb(env).from('webrtc_signals').delete().eq('id', body.id);
    return _ok({ ok: true });
  }
  // from_guid 기준 삭제 (연결 수립 후 내 시그널 전체 삭제)
  if (body.from_guid) {
    await _sb(env).from('webrtc_signals')
      .delete().eq('from_guid', body.from_guid);
    return _ok({ ok: true });
  }
  return _err(400, 'ID_OR_FROM_GUID_REQUIRED');
}

// ── /search/users — 사용자 검색 ──────────────────────────────
case '/search/users': {
  if (req.method !== 'GET') return _err(405, 'METHOD_NOT_ALLOWED');
  const q     = url.searchParams.get('q')?.trim();
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);
  if (!q) return _err(400, 'QUERY_REQUIRED');

  const res = await _sb(env).rpc('search_users', { q, limit_n: limit });
  if (res.error) return _err(500, res.error.message);
  return _ok({ users: res.data, count: res.data.length });
}
