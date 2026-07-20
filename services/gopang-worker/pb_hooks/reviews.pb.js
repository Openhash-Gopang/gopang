/// <reference path="../pb_data/types.d.ts" />
/**
 * pb_hooks/reviews.pb.js — 10번 항목: 리뷰 작성 기능 + 구매인증 기반 조작 방지
 *
 * 핵심: 리뷰는 escrow_holds.status='released'인 거래(tx_id) 하나당
 * 정확히 1개까지만 파생 가능하다. 이 제약을 API 훅에서 강제한다.
 */

onRecordBeforeCreateRequest((e) => {
  const dao = $app.dao();
  const record = e.record;
  const txId = record.getString("tx_id");
  const buyerGuid = record.getString("buyer_guid");

  let hold;
  try {
    hold = dao.findFirstRecordByData("escrow_holds", "tx_id", txId);
  } catch (_) {
    throw new BadRequestError("존재하지 않는 거래입니다.");
  }
  if (hold.getString("status") !== "released") {
    throw new BadRequestError("완료된 거래에 대해서만 리뷰를 작성할 수 있습니다.");
  }
  if (hold.getString("buyer_guid") !== buyerGuid) {
    throw new BadRequestError("본인의 거래에 대해서만 리뷰를 작성할 수 있습니다.");
  }

  try {
    dao.findFirstRecordByData("reviews", "tx_id", txId);
    throw new BadRequestError("이미 이 거래에 대한 리뷰가 작성되었습니다.");
  } catch (e2) {
    if (e2 instanceof BadRequestError) throw e2;
    // not found — 정상 진행 (아직 리뷰 없음)
  }

  if ((record.getString("text") || "").trim().length < 10) {
    throw new BadRequestError("리뷰 내용을 10자 이상 입력해주세요.");
  }

  record.set("seller_guid", hold.getString("seller_guid"));
  record.set("status", "visible");
  record.set("edit_count", 0);
  record.set("created_at", new Date().toISOString());
  record.set("edit_locked_at", new Date(Date.now() + 72 * 3600 * 1000).toISOString());

  e.next();
}, "reviews");

// 수정: 72시간 잠금 전까지, rating/text만 (buyer_guid·tx_id 변조 방지)
// + 판매자 공개 답글(seller_reply)은 별도 예외 경로
onRecordBeforeUpdateRequest((e) => {
  const record = e.record;
  const changedFields = Object.keys(e.data || {});

  const isSellerReplyOnly = changedFields.every((f) =>
    ["seller_reply", "seller_replied_at"].includes(f)
  );
  if (isSellerReplyOnly) {
    // Worker가 요청 헤더/컨텍스트로 검증한 인증 guid와 seller_guid 일치 여부는
    // Worker 레벨(routes/reviews.js handleSellerReply)에서 이미 확인하고 admin
    // 토큰으로 PATCH하므로, 훅에서는 필드 화이트리스트만 재확인한다.
    e.next();
    return;
  }

  if (new Date(record.getString("edit_locked_at")) < new Date()) {
    throw new BadRequestError("작성 후 72시간이 지나 수정할 수 없습니다.");
  }
  const allowed = new Set(["rating", "text"]);
  for (const f of changedFields) {
    if (!allowed.has(f)) throw new BadRequestError(`${f}는 수정할 수 없습니다.`);
  }
  record.set("edit_count", record.getInt("edit_count") + 1);
  e.next();
}, "reviews");

// 판매자를 포함해 누구도 직접 삭제 불가 — 모더레이션 절차(관리자 전용 별도 엔드포인트)로만
onRecordDeleteRequest((e) => {
  throw new BadRequestError("리뷰는 직접 삭제할 수 없습니다. 신고 후 검토를 거쳐야 합니다.");
}, "reviews");

// 도움돼요 투표 중복 방지의 최종 저지선 (unique 인덱스와 이중 방어)
onRecordBeforeCreateRequest((e) => {
  const dao = $app.dao();
  const reviewId = e.record.getString("review_id");
  const voterGuid = e.record.getString("voter_guid");
  try {
    const rows = dao.findRecordsByFilter(
      "review_helpful_votes",
      "review_id = {:r} && voter_guid = {:v}",
      "",
      1, 0,
      { r: reviewId, v: voterGuid }
    );
    if (rows.length) throw new BadRequestError("이미 투표하셨습니다.");
  } catch (err) {
    if (err instanceof BadRequestError) throw err;
  }
  e.next();
}, "review_helpful_votes");
