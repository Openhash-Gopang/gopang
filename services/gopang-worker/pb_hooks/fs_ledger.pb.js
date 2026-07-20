/// <reference path="../pb_data/types.d.ts" />
/**
 * pb_hooks/fs_ledger.pb.js
 * L1 PocketBase(main.pb.js와 나란히 로드되는 훅 파일 — 기존 거래검증 훅과
 * 같은 pb_hooks 디렉토리에 위치)에 배치한다.
 *
 * 원칙:
 *  1) fs_ledger는 절대 UPDATE/DELETE 불가 (Worker admin 토큰 요청도 예외 없음)
 *  2) CREATE 시 seq/prev_entry_hash/entry_hash를 서버가 직접 계산
 *  3) "정정"은 오직 상쇄전표+신규전표(둘 다 CREATE)로만 — routes/ledger.js 참조
 */

onRecordUpdateRequest((e) => {
  throw new BadRequestError(
    "fs_ledger는 수정할 수 없습니다. /biz/ledger-correction API로 정정 전표를 발행하세요."
  );
}, "fs_ledger");

onRecordDeleteRequest((e) => {
  throw new BadRequestError("fs_ledger는 삭제할 수 없습니다.");
}, "fs_ledger");

onRecordBeforeCreateRequest((e) => {
  const dao = $app.dao();
  const record = e.record;
  const guid = record.getString("guid");

  let prevHash = "GENESIS";
  let nextSeq = 0;
  try {
    const latest = dao.findRecordsByFilter(
      "fs_ledger",
      `guid = {:guid}`,
      "-seq",
      1,
      0,
      { guid }
    )[0];
    if (latest) {
      prevHash = latest.getString("entry_hash");
      nextSeq = latest.getInt("seq") + 1;
    }
  } catch (_) {
    // 최초 레코드 — GENESIS 유지
  }

  record.set("seq", nextSeq);
  record.set("prev_entry_hash", prevHash);
  record.set("anchored", false);

  const canonical = JSON.stringify({
    guid,
    seq: nextSeq,
    prevHash,
    tx_id: record.getString("tx_id"),
    direction: record.getString("direction"),
    amount: record.getFloat("amount"),
    fs_account: record.getString("fs_account"),
    tx_at: record.getString("tx_at"),
  });
  record.set("entry_hash", $security.sha256(canonical));

  e.next();
}, "fs_ledger");

// ── fs_ledger_anchor_flags: anchored 표시는 이 별도 컬렉션에서만 갱신 가능 ──
// (fs_ledger 자체는 위 훅으로 영구 잠겨있으므로, 앵커링 배치가 "어느 배치에
//  포함됐는지"를 표시할 곳이 필요해 원장 레코드 밖으로 분리했다.)
onRecordBeforeCreateRequest((e) => {
  // fs_ledger_anchor_flags는 자유롭게 생성 가능 (Worker 배치가 매시간 기록)
  e.next();
}, "fs_ledger_anchor_flags");

// ── fs_ledger_corrections: 정정 이력은 CREATE만 허용, 수정/삭제 금지 (감사 로그 성격) ──
onRecordUpdateRequest((e) => {
  throw new BadRequestError("정정 이력은 수정할 수 없습니다.");
}, "fs_ledger_corrections");

onRecordDeleteRequest((e) => {
  throw new BadRequestError("정정 이력은 삭제할 수 없습니다.");
}, "fs_ledger_corrections");
