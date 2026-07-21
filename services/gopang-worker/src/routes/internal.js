/**
 * routes/internal.js — 서비스 간(hondi-proxy PocketBase 훅 → market-proxy) 전용 엔드포인트
 *
 * [2026-07 통합] hondi-proxy의 pb_hooks/main.pb.js가 GDC 송금/발행/AI과금 시
 * ledger_entries에 직접 $app.dao().saveRecord()로 쓰던 걸 이 엔드포인트 호출로
 * 대체한다 — 원장/재무제표(fs, financial statement) 관련 쓰기를 market-proxy가
 * 전담하도록 통합(사용자 승인 사항). 이렇게 하면:
 *   1) LedgerWriter DO(guid 단위 직렬화)를 거치므로 hondi-proxy·market-proxy
 *      양쪽에서 동시에 같은 guid에 쓰는 경합이 사라진다
 *   2) fs_ledger.pb.js의 해시체인 훅(entry_hash/seq 계산)이 정상적으로
 *      HTTP 요청 경로를 타므로 항상 발동한다(내부 DAO 직접 호출 시 훅을
 *      건너뛰는 문제가 해소됨 — 2026-07-21 로컬 재현으로 실증됨)
 *
 * 공인 URL로 노출되는 엔드포인트이므로 반드시 공유 시크릿으로 보호한다.
 * (Cloudflare Service Binding은 호출자가 PocketBase VM — Cloudflare 밖의
 * 일반 서버 — 이라 적용 불가함을 확인함. 기존 코드베이스 관례
 * BRIDGE_SECRET/MINT_SECRET/AI_CHARGE_SECRET과 동일하게 body 필드로
 * 공유 시크릿을 전달하는 방식을 그대로 따른다.)
 */

import { insertFsLedger } from './ledger.js';
import { resolveL1Base } from '../lib/l1-registry.js';
import { jsonResponse } from '../lib/http.js';

/** 상수시간 문자열 비교 — 타이밍 공격 방지 */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * POST /internal/ledger-entries
 * body: {
 *   l1_node: string,        // 호출한 PocketBase 노드의 l1_node 코드 (예: "KR-JEJU-JEJU-HANLIM")
 *   guid, direction, amount, fs_account, source, block_hash, tx_id, tx_at,
 *   ledger_write_secret: string,
 * }
 */
export async function handleInternalLedgerEntry(request, env) {
  const body = await request.json();
  const { l1_node, ledger_write_secret, ...entry } = body;

  const expected = env.LEDGER_WRITE_SECRET;
  if (!expected) {
    return jsonResponse({ ok: false, reason: 'LEDGER_WRITE_SECRET_UNCONFIGURED' }, 500);
  }
  // [2026-07-21 수정] PowerShell의 `"값" | wrangler secret put`이 문자열 끝에
  // 개행을 붙이는 경우가 실제로 확인됨(HTTP 401 UNAUTHORIZED로 재현) — 양쪽
  // 다 trim해서 비교. 시크릿 값 자체에 의미있는 선행/후행 공백이 올 일은
  // 없으므로 보안상 문제 없음.
  if (!timingSafeEqual(String(ledger_write_secret || '').trim(), String(expected).trim())) {
    return jsonResponse({ ok: false, reason: 'UNAUTHORIZED' }, 401);
  }

  if (!l1_node) return jsonResponse({ ok: false, reason: 'MISSING_L1_NODE' }, 400);
  if (!entry.guid) return jsonResponse({ ok: false, reason: 'MISSING_GUID' }, 400);

  const l1Base = await resolveL1Base(env, l1_node);
  if (!l1Base) return jsonResponse({ ok: false, reason: 'UNKNOWN_L1_NODE' }, 400);

  try {
    const result = await insertFsLedger(env, l1Base, entry.guid, entry);
    if (!result.ok) {
      return jsonResponse({ ok: false, reason: 'LEDGER_WRITE_FAILED', detail: result.error }, 502);
    }
    return jsonResponse({ ok: true, record: result.record });
  } catch (e) {
    // 호출자(main.pb.js)는 이미 "실패해도 정산/발행 자체는 안 막는다"는
    // try/catch로 감싸서 호출하므로, 여기서도 500만 반환하고 그대로 끝낸다.
    return jsonResponse({ ok: false, reason: 'LEDGER_WRITE_FAILED', detail: e.message }, 500);
  }
}
