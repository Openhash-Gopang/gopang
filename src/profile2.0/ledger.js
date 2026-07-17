/**
 * M10 — 원장(Ledger) 모듈
 *
 * K-Market 거래 1건을 구매자(차변)/판매자(대변)/플랫폼(대변, 수수료) 3행의
 * 복식부기로 분해해 기록하고, 그 원장으로부터 각 사용자의 잔액을 역산해
 * 프로필에 캐시된 재무상태(extra.fs)와 대조·검증한다.
 *
 * BIVM(Σ차변=Σ대변 잔액 불변식)은 src/openhash/bivm.js의 거래 검증과 같은
 * 원칙을 원장 행 단위에 적용한 것 — 파일/구현은 완전히 별개(재사용 아님).
 *
 * 의존하는 쪽: M11(Audit, audit.js 헤더 주석에 "의존: M10" 명시)
 */

const PLATFORM_FEE_RATE  = 0.03; // 플랫폼 수수료 3%
const ALLOWED_SOURCES    = new Set(['market']);
const ALLOWED_DIRECTIONS = new Set(['debit', 'credit']);

// ── 단건 원장 항목 검증 ─────────────────────────────────────────────
// DB(Supabase) CHECK 제약과 동일한 규칙을 클라이언트 쪽에서 선제 검증한다.
export function validateLedgerEntry({ amount, source, direction } = {}) {
  if (typeof amount !== 'number' || !(amount > 0)) {
    return { error: 'INVALID_AMOUNT' };
  }
  if (!ALLOWED_SOURCES.has(source) || !ALLOWED_DIRECTIONS.has(direction)) {
    return { error: 'CHECK_VIOLATION' };
  }
  return null;
}

// ── 마켓 구매 1건 → 3행 복식부기 ─────────────────────────────────────
// 수수료는 "전체 금액 - 반올림한 수수료"로 판매자 몫을 역산해서 만든다.
// (수수료·판매자 몫을 각각 독립적으로 반올림하면 부동소수점 오차로
//  Σ차변≠Σ대변이 될 수 있어, 항상 정확히 상쇄되도록 보수 계산한다.)
export function buildMarketPurchaseRows({ buyerGuid, sellerGuid, platformGuid, amount, blockHash, txId }) {
  if (!(amount > 0)) {
    throw new Error('buildMarketPurchaseRows: amount는 0보다 커야 합니다');
  }
  const platformFee  = Math.round(amount * PLATFORM_FEE_RATE);
  const sellerAmount = amount - platformFee;

  const base = { source: 'market', blockHash, txId };
  return [
    { ...base, guid: buyerGuid,    direction: 'debit',  amount },
    { ...base, guid: sellerGuid,   direction: 'credit', amount: sellerAmount },
    { ...base, guid: platformGuid, direction: 'credit', amount: platformFee },
  ].filter((row) => row.amount > 0); // 극소액 등 수수료가 0으로 반올림되면 그 행은 생략(0원 원장 행 방지)
}

// ── 잔액 불변식(Σ차변 = Σ대변) 검증 ───────────────────────────────────
export function verifyBIVM(rows) {
  let totalDebit = 0, totalCredit = 0;
  for (const r of rows) {
    if (r.direction === 'debit') totalDebit += r.amount;
    else if (r.direction === 'credit') totalCredit += r.amount;
  }
  return { balanced: totalDebit === totalCredit, totalDebit, totalCredit };
}

// ── 원장 전체에서 특정 사용자의 잔액을 역산 ──────────────────────────
// plPurchase: 손익계산서성 누적 구매액(그 guid가 차변으로 기록된 금액의 합)
// bsCash    : 재무상태표성 현금(대변 합 - 차변 합)
export function reconstructBalances(rows, guid) {
  let plPurchase = 0, bsCash = 0;
  for (const r of rows) {
    if (r.guid !== guid) continue;
    if (r.direction === 'debit') {
      plPurchase += r.amount;
      bsCash     -= r.amount;
    } else if (r.direction === 'credit') {
      bsCash += r.amount;
    }
  }
  return { plPurchase, bsCash };
}

// ── 거래 확정 후 프로필 extra.fs에 기록해야 할 값 ────────────────────
export function computeSettledFs(rows, guid) {
  const bal = reconstructBalances(rows, guid);
  let plRevenue = 0;
  for (const r of rows) {
    if (r.guid === guid && r.direction === 'credit') plRevenue += r.amount;
  }
  return {
    'bs-cash':     bal.bsCash,
    'pl-purchase': bal.plPurchase,
    'pl-revenue':  plRevenue,
  };
}

// ── 프로필 캐시(extra.fs) vs 원장 역산 결과 대조 ─────────────────────
// 캐시된 값이 실제 원장에서 역산한 값과 어긋나면(조작·버그·동기화 누락)
// 이상 항목으로 보고한다.
export function detectBalanceAnomalies(rows, profiles) {
  const anomalies = [];
  for (const p of profiles) {
    const expected = computeSettledFs(rows, p.guid);
    const actual   = p?.extra?.fs || {};
    const mismatched = Object.keys(expected).some(
      (k) => Number(actual[k] ?? NaN) !== expected[k],
    );
    if (mismatched) anomalies.push({ guid: p.guid, expected, actual });
  }
  return anomalies;
}

// ── Supabase 헬퍼(community.js/audit.js와 동일한 관례) ───────────────
function sbHeaders(env) {
  return {
    'Content-Type': 'application/json',
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
  };
}

// ── 마켓 구매 원장 기록(Supabase RPC) ────────────────────────────────
// DB 함수(insert_market_purchase_rows)가 서버 쪽에서도 동일한 CHECK
// 제약을 강제하므로, 클라이언트 검증을 우회해도 23514(check_violation)
// SQLSTATE로 최종 방어된다 — 그 코드를 CHECK_VIOLATION 에러로 변환한다.
export async function marketPurchaseRPC(env, params) {
  const rows = buildMarketPurchaseRows(params);
  for (const row of rows) {
    const invalid = validateLedgerEntry(row);
    if (invalid) throw new Error(`marketPurchaseRPC: ${invalid.error}`);
  }

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/insert_market_purchase_rows`, {
    method: 'POST',
    headers: sbHeaders(env),
    body: JSON.stringify({ rows }),
  });

  if (!res.ok) {
    const bodyText = await res.text();
    if (bodyText.includes('23514')) {
      throw new Error(`marketPurchaseRPC: CHECK_VIOLATION (${bodyText})`);
    }
    throw new Error(`marketPurchaseRPC: HTTP ${res.status} ${bodyText}`);
  }
  return res.json();
}
