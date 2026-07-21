/// <reference path="../pb_data/types.d.ts" />
/**
 * pb_hooks/fs_ledger.pb.js
 * L1 PocketBase(main.pb.js와 나란히 로드되는 훅 파일 — 기존 거래검증 훅과
 * 같은 pb_hooks 디렉토리에 위치)에 배치한다.
 *
 * [2026-07 통합] 이 훅은 이제 자체 컬렉션이 아니라 hondi-proxy가 이미 쓰던
 * ledger_entries 컬렉션에 해시체인 규칙(append-only + seq/entry_hash 계산)을
 * 적용한다. 파일명(fs_ledger.pb.js)은 하위 파일들과의 연속성을 위해 유지.
 *
 * 원칙:
 *  1) ledger_entries는 절대 UPDATE/DELETE 불가 (Worker admin 토큰 요청도 예외 없음)
 *  2) CREATE 시 seq/prev_entry_hash/entry_hash를 서버가 직접 계산
 *  3) "정정"은 오직 상쇄전표+신규전표(둘 다 CREATE)로만 — routes/ledger.js 참조
 *
 * [2026-07-21 수정 — 로컬 PocketBase 0.22.14 재현으로 실증된 버그 2건]
 *  1) onRecordUpdateRequest/onRecordDeleteRequest(Before 없이)는 v0.23+ 전용
 *     이름이라, 실제 0.22.14에서 이 파일이 ReferenceError로 로드 자체에
 *     실패했을 가능성이 높았다 — onRecordBeforeUpdateRequest/
 *     onRecordBeforeDeleteRequest(Before 포함)로 수정.
 *  2) e.next() 호출도 v0.23+ 전용 API라 TypeError가 났다 — 0.22.x는 핸들러가
 *     예외 없이 정상 종료되면 자동으로 다음 단계(실제 저장)로 진행되므로 삭제.
 *
 * [2026-07-21 통합] main.pb.js의 내부 $app.dao().saveRecord() 직접 쓰기는
 * 이 요청 훅(onRecordBeforeCreateRequest)을 타지 않는다는 것도 로컬 재현으로
 * 실증했다 — 이 문제는 원장(fs) 쓰기 자체를 market-proxy로 전담 이관해서
 * 해결했다(POST /internal/ledger-entries 경유, main.pb.js 쪽 상세는 그쪽
 * 파일 주석 참조). 즉 지금부터 ledger_entries에 대한 모든 쓰기는 HTTP 요청
 * 경로(market-proxy → 이 PocketBase의 공개 API)로만 들어오므로, 아래 훅이
 * 항상 정상적으로 발동한다.
 */

onRecordBeforeUpdateRequest((e) => {
  throw new BadRequestError(
    "ledger_entries는 수정할 수 없습니다. /biz/ledger-correction API로 정정 전표를 발행하세요."
  );
}, "ledger_entries");

onRecordBeforeDeleteRequest((e) => {
  throw new BadRequestError("ledger_entries는 삭제할 수 없습니다.");
}, "ledger_entries");

onRecordBeforeCreateRequest((e) => {
  const dao = $app.dao();
  const record = e.record;
  const guid = record.getString("guid");

  let prevHash = "GENESIS";
  let nextSeq = 0;
  try {
    const latest = dao.findRecordsByFilter(
      "ledger_entries",
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
}, "ledger_entries");

// ── fs_ledger_anchor_flags: anchored 표시는 이 별도 컬렉션에서만 갱신 가능 ──
// (ledger_entries 자체는 위 훅으로 영구 잠겨있으므로, 앵커링 배치가 "어느
//  배치에 포함됐는지"를 표시할 곳이 필요해 원장 레코드 밖으로 분리했다.)
// 별도 검증 로직이 없으므로 훅 자체가 필요 없음 — 자유 생성 허용(기본 동작).

// ── fs_ledger_corrections: 정정 이력은 CREATE만 허용, 수정/삭제 금지 (감사 로그 성격) ──
onRecordBeforeUpdateRequest((e) => {
  throw new BadRequestError("정정 이력은 수정할 수 없습니다.");
}, "fs_ledger_corrections");

onRecordBeforeDeleteRequest((e) => {
  throw new BadRequestError("정정 이력은 삭제할 수 없습니다.");
}, "fs_ledger_corrections");
