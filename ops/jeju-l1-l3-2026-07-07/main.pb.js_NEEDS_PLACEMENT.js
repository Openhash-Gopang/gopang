/// <reference path="../pb_data/types.d.ts" />

const NODE_ID = "KR-JEJU-JEJU-HANLIM";

routerAdd("POST", "/api/tx", (c) => {
  const body = $apis.requestInfo(c).data;
  const { tx, tx_hash, buyer_sig, buyer_public_key } = body;

  if (!tx || !tx_hash || !buyer_sig || !buyer_public_key) {
    return c.json(400, { ok: false, error: "MISSING_FIELD" });
  }
  if (!/^[0-9a-f]{64}$/.test(tx_hash)) {
    return c.json(400, { ok: false, error: "INVALID_SIGNATURE", detail: "tx_hash 형식 오류" });
  }

  const { input, outputs } = tx;
  const { owner_guid, prev_settle_hash, balance_claimed } = input;

  // ── 2026-07-07 신설(제주 L1~L3 필드 테스트): 크로스-L1 브릿지 ──────────
  // Worker가 §4 레지스트리(L3의 guid_home_l1)로 판매자 소속 L1을 미리
  // 조회해 seller_home_node로 넘겨준다. 이 L1(자기 자신)과 다르면, 판매자
  // 몫 output의 recipient_guid를 sentinel("bridge-out:{target}")로 바꿔
  // 로컬 총량 보존식(발행==잔액합, sentinel도 guid 취급)을 그대로 유지한
  // 채, 실제 판매자 크레딧은 bridge_out 레코드를 통해 대상 L1으로 넘긴다
  // (jeju-l1-l3-field-test-plan-2026-07-07.md §5 참고).
  const { seller_home_node } = body;

  // 2단계: 공개키 확인
  let keyRecord = null;
  try {
    const allKeys = $app.dao().findRecordsByFilter("gdc_keys", "public_key != ''", "", 1000, 0);
    keyRecord = allKeys.find(r => r.getString("public_key") === buyer_public_key) || null;
  } catch(e) { console.log("[TX] 2단계 예외:", e.message); }
  if (!keyRecord) return c.json(403, { ok: false, error: "UNREGISTERED_KEY" });

  // 3단계: 블록 조회
  let latestBlock = null;
  try {
    const allBlocks = $app.dao().findRecordsByFilter("blocks", "block_type != ''", "-height", 1000, 0);
    const buyerBlocks = allBlocks.filter(r => r.getString("buyer_guid") === owner_guid);
    if (buyerBlocks.length > 0) latestBlock = buyerBlocks[0];
  } catch(e) { console.log("[TX] 3단계 예외:", e.message); }

  if (latestBlock) {
    const expectedHash = latestBlock.getString("content_hash");
    if (!prev_settle_hash || prev_settle_hash !== expectedHash) {
      return c.json(409, { ok: false, error: "STALE_STATE" });
    }
    // 이중 지불 확인
    try {
      const allBlocksForDup = $app.dao().findRecordsByFilter("blocks", "block_type != ''", "", 1000, 0);
      const dup = allBlocksForDup.find(r => r.getString("prev_settle_hash") === prev_settle_hash);
      if (dup) return c.json(409, { ok: false, error: "STALE_STATE", detail: "이중 지불 감지" });
    } catch(e) { /* 중복 없음 */ }
  }

  const totalOutput = outputs.reduce((sum, o) => sum + (o.amount || 0), 0);

  // 4단계: 잔액 확인 — 2026-07-07 수정. 이전엔 balance_claimed(클라이언트
  // 자체 신고값)만 outputs 합계와 비교했다 — 지갑이 뭘 보내든 그대로
  // 믿었다는 뜻이다(진짜 UTXO 검증이 아니었음). 이제 L1이 자기 원장
  // (blocks)을 재생해서 직접 잔액을 계산하고, 그 값으로만 판단한다.
  // computeBalance는 이 콜백 안에 선언한다 — 이 프로젝트의 PocketBase
  // Goja 엔진은 콜백 바깥의 전역 함수 선언을 조용히 무시하는 제약이
  // 있어(main.pb.js 기존 sha256hex도 같은 이유로 콜백 내부에 있다),
  // 최상위에 선언하면 실제로는 실행되지 않을 위험이 있다.
  function computeBalance(guid) {
    const allBlocks = $app.dao().findRecordsByFilter("blocks", "block_type != ''", "", 10000, 0);
    let balance = 0;
    for (const b of allBlocks) {
      let blkOutputs;
      try { blkOutputs = JSON.parse(b.getString("outputs") || "[]"); } catch (e) { continue; }
      for (const o of blkOutputs) {
        if (o.recipient_guid === guid) balance += (o.amount || 0);   // 이 guid가 수취인
      }
      if (b.getString("buyer_guid") === guid) {
        const total = blkOutputs.reduce((s, o) => s + (o.amount || 0), 0);
        balance -= total;                                            // 이 guid가 지불자
      }
    }
    return balance;
  }

  // 이 노드가 43개 L1 중 어디인지 자기 인식(폴더명 기준) — 콜백 내부 선언
  // (Goja 콜백 바깥 최상위 선언 제약, 파일 상단 기존 주석 참고)
const NODE_CONFIG = {
  "hanlim": { id: "KR-JEJU-JEJU-HANLIM", layer: 1, port: 8091, parentUrl: "http://127.0.0.1:8092" },
  "l1-aewol": { id: "KR-JEJU-JEJU-AEWOL", layer: 1, port: 8101, parentUrl: "http://127.0.0.1:8092" },
  "l1-jocheon": { id: "KR-JEJU-JEJU-JOCHEON", layer: 1, port: 8102, parentUrl: "http://127.0.0.1:8092" },
  "l1-gujwa": { id: "KR-JEJU-JEJU-GUJWA", layer: 1, port: 8103, parentUrl: "http://127.0.0.1:8092" },
  "l1-hangyeong": { id: "KR-JEJU-JEJU-HANGYEONG", layer: 1, port: 8104, parentUrl: "http://127.0.0.1:8092" },
  "l1-chuja": { id: "KR-JEJU-JEJU-CHUJA", layer: 1, port: 8105, parentUrl: "http://127.0.0.1:8092" },
  "l1-udo": { id: "KR-JEJU-JEJU-UDO", layer: 1, port: 8106, parentUrl: "http://127.0.0.1:8092" },
  "l1-ildo1": { id: "KR-JEJU-JEJU-ILDO1", layer: 1, port: 8107, parentUrl: "http://127.0.0.1:8092" },
  "l1-ildo2": { id: "KR-JEJU-JEJU-ILDO2", layer: 1, port: 8108, parentUrl: "http://127.0.0.1:8092" },
  "l1-ido1": { id: "KR-JEJU-JEJU-IDO1", layer: 1, port: 8109, parentUrl: "http://127.0.0.1:8092" },
  "l1-ido2": { id: "KR-JEJU-JEJU-IDO2", layer: 1, port: 8110, parentUrl: "http://127.0.0.1:8092" },
  "l1-samdo1": { id: "KR-JEJU-JEJU-SAMDO1", layer: 1, port: 8111, parentUrl: "http://127.0.0.1:8092" },
  "l1-samdo2": { id: "KR-JEJU-JEJU-SAMDO2", layer: 1, port: 8112, parentUrl: "http://127.0.0.1:8092" },
  "l1-yongdam1": { id: "KR-JEJU-JEJU-YONGDAM1", layer: 1, port: 8113, parentUrl: "http://127.0.0.1:8092" },
  "l1-yongdam2": { id: "KR-JEJU-JEJU-YONGDAM2", layer: 1, port: 8114, parentUrl: "http://127.0.0.1:8092" },
  "l1-geonip": { id: "KR-JEJU-JEJU-GEONIP", layer: 1, port: 8115, parentUrl: "http://127.0.0.1:8092" },
  "l1-hwabuk": { id: "KR-JEJU-JEJU-HWABUK", layer: 1, port: 8116, parentUrl: "http://127.0.0.1:8092" },
  "l1-samyang": { id: "KR-JEJU-JEJU-SAMYANG", layer: 1, port: 8117, parentUrl: "http://127.0.0.1:8092" },
  "l1-bonggae": { id: "KR-JEJU-JEJU-BONGGAE", layer: 1, port: 8118, parentUrl: "http://127.0.0.1:8092" },
  "l1-ara": { id: "KR-JEJU-JEJU-ARA", layer: 1, port: 8119, parentUrl: "http://127.0.0.1:8092" },
  "l1-ora": { id: "KR-JEJU-JEJU-ORA", layer: 1, port: 8120, parentUrl: "http://127.0.0.1:8092" },
  "l1-yeondong": { id: "KR-JEJU-JEJU-YEONDONG", layer: 1, port: 8121, parentUrl: "http://127.0.0.1:8092" },
  "l1-nohyeong": { id: "KR-JEJU-JEJU-NOHYEONG", layer: 1, port: 8122, parentUrl: "http://127.0.0.1:8092" },
  "l1-oedo": { id: "KR-JEJU-JEJU-OEDO", layer: 1, port: 8123, parentUrl: "http://127.0.0.1:8092" },
  "l1-iho": { id: "KR-JEJU-JEJU-IHO", layer: 1, port: 8124, parentUrl: "http://127.0.0.1:8092" },
  "l1-dodu": { id: "KR-JEJU-JEJU-DODU", layer: 1, port: 8125, parentUrl: "http://127.0.0.1:8092" },
  "l1-daejeong": { id: "KR-JEJU-SGP-DAEJEONG", layer: 1, port: 8126, parentUrl: "http://127.0.0.1:8093" },
  "l1-namwon": { id: "KR-JEJU-SGP-NAMWON", layer: 1, port: 8127, parentUrl: "http://127.0.0.1:8093" },
  "l1-seongsan": { id: "KR-JEJU-SGP-SEONGSAN", layer: 1, port: 8128, parentUrl: "http://127.0.0.1:8093" },
  "l1-andeok": { id: "KR-JEJU-SGP-ANDEOK", layer: 1, port: 8129, parentUrl: "http://127.0.0.1:8093" },
  "l1-pyoseon": { id: "KR-JEJU-SGP-PYOSEON", layer: 1, port: 8130, parentUrl: "http://127.0.0.1:8093" },
  "l1-songsan": { id: "KR-JEJU-SGP-SONGSAN", layer: 1, port: 8131, parentUrl: "http://127.0.0.1:8093" },
  "l1-jeongbang": { id: "KR-JEJU-SGP-JEONGBANG", layer: 1, port: 8132, parentUrl: "http://127.0.0.1:8093" },
  "l1-jungang-sgp": { id: "KR-JEJU-SGP-JUNGANG-SGP", layer: 1, port: 8133, parentUrl: "http://127.0.0.1:8093" },
  "l1-cheonji": { id: "KR-JEJU-SGP-CHEONJI", layer: 1, port: 8134, parentUrl: "http://127.0.0.1:8093" },
  "l1-hyodon": { id: "KR-JEJU-SGP-HYODON", layer: 1, port: 8135, parentUrl: "http://127.0.0.1:8093" },
  "l1-yeongcheon": { id: "KR-JEJU-SGP-YEONGCHEON", layer: 1, port: 8136, parentUrl: "http://127.0.0.1:8093" },
  "l1-donghong": { id: "KR-JEJU-SGP-DONGHONG", layer: 1, port: 8137, parentUrl: "http://127.0.0.1:8093" },
  "l1-seohong": { id: "KR-JEJU-SGP-SEOHONG", layer: 1, port: 8138, parentUrl: "http://127.0.0.1:8093" },
  "l1-daeryun": { id: "KR-JEJU-SGP-DAERYUN", layer: 1, port: 8139, parentUrl: "http://127.0.0.1:8093" },
  "l1-daecheon": { id: "KR-JEJU-SGP-DAECHEON", layer: 1, port: 8140, parentUrl: "http://127.0.0.1:8093" },
  "l1-jungmun": { id: "KR-JEJU-SGP-JUNGMUN", layer: 1, port: 8141, parentUrl: "http://127.0.0.1:8093" },
  "l1-yerae": { id: "KR-JEJU-SGP-YERAE", layer: 1, port: 8142, parentUrl: "http://127.0.0.1:8093" },
  "l2-jeju": { id: "KR-JEJU-JEJU-SI", layer: 2, port: 8092, parentUrl: "http://127.0.0.1:8094" },
  "l2-seogwipo": { id: "KR-JEJU-SGP-SI", layer: 2, port: 8093, parentUrl: "http://127.0.0.1:8094" },
  "l3-jejudo": { id: "KR-JEJU", layer: 3, port: 8094, parentUrl: "http://127.0.0.1:8095" },
  "l4-kr": { id: "KR", layer: 4, port: 8095, parentUrl: "http://127.0.0.1:8096" },
  "l5-global": { id: "GLOBAL", layer: 5, port: 8096, parentUrl: null },
};
  const _selfFolder = $app.dataDir().split("/").pop();
  const _self = NODE_CONFIG[_selfFolder] || NODE_CONFIG["hanlim"];
  const NODE_ID_SELF = _self.id;

  const actualBalance = computeBalance(owner_guid);
  if (actualBalance < totalOutput) {
    return c.json(400, { ok: false, error: "INSUFFICIENT_BALANCE",
      detail: `실제 잔액 ${actualBalance} < 필요 ${totalOutput}` });
  }
  if (balance_claimed != null && Math.abs(balance_claimed - actualBalance) > 0.01) {
    // 신뢰하진 않지만, 클라이언트 로컬 상태가 실제 원장과 얼마나 어긋나
    // 있는지는 로그로 남겨둔다 — 재대사(reconcile) 기능을 붙일 때 근거자료.
    console.log(`[TX] 잔액 불일치(참고용, 차단 아님): claimed=${balance_claimed} actual=${actualBalance}`);
  }

  // 블록 생성
  const prevBlockHash = latestBlock ? latestBlock.getString("content_hash") : "GENESIS";
  const currentHeight = latestBlock ? (latestBlock.getFloat("height") + 1) : 1;
  // 2026-07-07 수정: seller_guid를 outputs[0](순서 가정)이 아니라, 청구권
  // 생성에도 쓰는 것과 동일한 방식(플랫폼이 아닌 첫 수취인)으로 통일한다.
  const sellerOutput = outputs.find(o => o.recipient_guid !== "gopang-platform");

  // ── 브릿지 판단: 판매자가 이 L1 소속이 아니면 sentinel로 리디렉션 ──────
  let bridgeTarget = null;
  let effectiveOutputs = outputs;
  if (seller_home_node && sellerOutput && seller_home_node !== NODE_ID_SELF) {
    bridgeTarget = seller_home_node;
    effectiveOutputs = outputs.map(o =>
      o === sellerOutput
        ? { recipient_guid: "bridge-out:" + seller_home_node, amount: o.amount }
        : o
    );
  }
  // sha256 계산
  function sha256hex(str) {
    const mathPow = Math.pow;
    const maxWord = mathPow(2, 32);
    let result = '';
    const words = [];
    const asciiBitLength = str.length * 8;
    let hash = [], k = [];
    let primeCounter = 0;
    const isComposite = {};
    for (let candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
        hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
        k[primeCounter++] = (mathPow(candidate, 1/3) * maxWord) | 0;
      }
    }
    let s = str + '\x80';
    while (s.length % 64 - 56) s += '\x00';
    for (let i = 0; i < s.length; i++) {
      const j = s.charCodeAt(i);
      if (j >> 8) return '';
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = ((asciiBitLength / maxWord) | 0);
    words[words.length] = (asciiBitLength | 0);
    for (let j = 0; j < words.length;) {
      const w = words.slice(j, j += 16);
      const oldHash = hash.slice(0);
      for (let i = 0; i < 64; i++) {
        const w15 = w[i-15], w2 = w[i-2];
        const a = hash[0], e = hash[4];
        const temp1 = hash[7]
          + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7))
          + ((e & hash[5]) ^ (~e & hash[6]))
          + k[i]
          + (w[i] = (i < 16) ? w[i] : (
            w[i-16]
            + ((w15 >>> 7 | w15 << 25) ^ (w15 >>> 18 | w15 << 14) ^ (w15 >>> 3))
            + w[i-7]
            + ((w2 >>> 17 | w2 << 15) ^ (w2 >>> 19 | w2 << 13) ^ (w2 >>> 10))
          ) | 0);
        const temp2 = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10))
          + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1+temp2)|0].concat(hash);
        hash[4] = (hash[4]+temp1)|0;
        hash.length = 8;
      }
      hash = hash.map((v,i) => (v+oldHash[i])|0);
    }
    hash.forEach(val => {
      for (let i = 3; i+1; i--) {
        const byte = (val>>(i*8))&255;
        result += ((byte<16)?'0':'') + byte.toString(16);
      }
    });
    return result;
  }
  const contentHash = sha256hex(tx_hash + buyer_sig + prevBlockHash + Date.now().toString());
  console.log("[TX] sha256 완료:", contentHash.slice(0,8));

  let blockRecord;
  try {
    const col = $app.dao().findCollectionByNameOrId("blocks");
    blockRecord = new Record(col);
    blockRecord.set("block_type",       "tx_2party");
    blockRecord.set("tx_hash",          tx_hash);
    blockRecord.set("buyer_guid",       owner_guid);
    blockRecord.set("seller_guid",      sellerOutput ? sellerOutput.recipient_guid : "");
    blockRecord.set("buyer_sig",        buyer_sig);
    blockRecord.set("outputs",          JSON.stringify(effectiveOutputs));
    blockRecord.set("prev_block_hash",  prevBlockHash);
    blockRecord.set("content_hash",     contentHash);
    blockRecord.set("height",           currentHeight);
    blockRecord.set("prev_settle_hash", prev_settle_hash || "");
    $app.dao().saveRecord(blockRecord);
    console.log("[TX] 블록 저장 완료");
  } catch(e) {
    console.log("[TX] BLOCK_SAVE_FAILED:", e.message);
    return c.json(500, { ok: false, error: "BLOCK_SAVE_FAILED", detail: e.message });
  }

  // ── 브릿지 아웃박스 기록 — outbox 패턴(§5). Worker가 이 레코드를 폴링해
  // 대상 L1의 /api/bridge-in을 호출하고, 성공 시 /api/bridge-out/complete로
  // 되돌려 status를 갱신한다. L1은 다른 L1을 직접 호출하지 않는다(P1).
  if (bridgeTarget) {
    try {
      const boCol = $app.dao().findCollectionByNameOrId("bridge_out");
      const boRec = new Record(boCol);
      boRec.set("tx_hash",     tx_hash);
      boRec.set("target_node", bridgeTarget);
      boRec.set("guid",        sellerOutput.recipient_guid);
      boRec.set("amount",      sellerOutput.amount);
      boRec.set("status",      "pending");
      boRec.set("created_at",  new Date().toISOString());
      $app.dao().saveRecord(boRec);
      console.log("[TX] bridge_out 기록 완료 →", bridgeTarget);
    } catch(e) { console.log("[TX] bridge_out 기록 실패(치명적, 감사 필요):", e.message); }
  }

  const blockId   = blockRecord.getId();
  const blockHash = contentHash;

  // 청구권 생성 (sellerOutput은 위에서 이미 계산됨)
  const buyerClaim = {
    claim_id:   sha256hex("buyer-" + tx_hash + blockId).substring(0, 32),
    tx_id:      tx_hash,
    claimant:   owner_guid,
    direction:  "debit",
    amount:     totalOutput,
    // 2026-07-07 수정: "bs-cash"였던 걸 "pl-purchase"로 고친다.
    // gopang-wallet.js의 redeemClaim()은 fs_account==='pl-purchase'일
    // 때만 pl-purchase(누적 지출)와 bs-cash(실잔액) 둘 다 갱신한다 —
    // "bs-cash"로 오면 bs-cash만 깎이고 pl-purchase는 영영 안 늘어난다.
    // 지금까지는 Worker가 이 claim을 무시하고 자체 생성한(올바른 값의)
    // claim을 썼어서 이 결함이 가려져 있었는데, 이제 Worker가 L1의
    // claim을 그대로 신뢰하므로 여기서 고쳐야 한다.
    fs_account: "pl-purchase",
    balance_after: actualBalance - totalOutput,
    block_id:   blockId,
    block_hash: blockHash,
    issued_by:  NODE_ID_SELF,
    expires_at: new Date(Date.now() + 72*60*60*1000).toISOString()
  };
  const sellerClaim = sellerOutput ? {
    claim_id:   sha256hex("seller-" + tx_hash + blockId).substring(0, 32),
    tx_id:      tx_hash,
    claimant:   sellerOutput.recipient_guid,
    direction:  "credit",
    amount:     sellerOutput.amount,
    fs_account: "pl-revenue",
    // computeBalance는 블록 저장 후에 호출되므로(위 saveRecord 참고) 이번
    // 거래의 대변 반영분이 이미 재생 결과에 포함돼 있다 — 여기 또 더하면
    // 이중계산이라 그대로 쓴다. 단, 브릿지 중이면 판매자가 이 L1 소속이
    // 아니므로 로컬 잔액은 의미가 없다(항상 0) — null로 명시한다.
    balance_after: bridgeTarget ? null : computeBalance(sellerOutput.recipient_guid),
    block_id:   blockId,
    block_hash: blockHash,
    issued_by:  NODE_ID_SELF,
    expires_at: new Date(Date.now() + 72*60*60*1000).toISOString()
  } : null;
  console.log("[TX] 청구권 생성 완료");

  // l1_ledger 앵커링
  try {
    const ledgerCol = $app.dao().findCollectionByNameOrId("l1_ledger");
    const ledgerRec = new Record(ledgerCol);
    ledgerRec.set("tx_id",       tx_hash);
    ledgerRec.set("tx_type",     "tx_2party");
    ledgerRec.set("from_guid",   owner_guid);
    ledgerRec.set("leaf_hash",   blockHash);
    ledgerRec.set("signature",   buyer_sig);
    ledgerRec.set("pubkey",      buyer_public_key);
    ledgerRec.set("l1_node",     NODE_ID_SELF);
    ledgerRec.set("parent_root", "");
    $app.dao().saveRecord(ledgerRec);
    console.log("[TX] ledger 저장 완료");

    // Merkle 계산
    const allLedger = $app.dao().findRecordsByFilter("l1_ledger", "tx_id != ''", "-created", 10000, 0);
    let layer = allLedger.map(r => r.getString("leaf_hash")).filter(Boolean);
    while (layer.length > 1) {
      const next = [];
      for (let i = 0; i < layer.length; i += 2)
        next.push($security.md5(layer[i] + (layer[i+1] || layer[i])));
      layer = next;
    }
    const merkleRoot = layer[0] || blockHash;
    console.log("[TX] Merkle 완료:", merkleRoot.slice(0,8));

    // L2 전파 — 상위 노드 URL도 자기 인식 결과(_self.parentUrl)로 동적화
    if (_self.parentUrl) {
      try {
        const resp = $http.send({
          url: _self.parentUrl + "/push_root",
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ child_node: NODE_ID_SELF, child_root: merkleRoot }),
        });
        console.log("[TX] 상위 전파 완료");
      } catch(e) { console.log("[TX] 상위 전파 실패:", e.message); }
    }

  } catch(e) { console.log("[TX] 앵커링 실패:", e.message); }

  console.log("[TX] 최종 응답 반환");
  return c.json(200, {
    ok:          true,
    block_id:    blockId,
    block_hash:  blockHash,
    height:      currentHeight,
    buyer_claim: buyerClaim,
    seller_claim: sellerClaim,
    balance_after: actualBalance - totalOutput,
    bridge: bridgeTarget ? { target_node: bridgeTarget, status: "pending" } : null,
  });
});

// ── 2026-07-07 신설: 초기 GDC 지급(개발 전용) ──────────────────────────
// Supabase gdc_deposit.sql이 하던 "발행" 역할의 L1 대응물. block_type을
// "deposit"으로 두고 buyer_guid를 비워서(지불자 없음), 수취인의 실제
// 구매 체인(prev_settle_hash 연쇄, buyer_guid 기준 조회)과 완전히
// 분리한다 — computeBalance는 block_type을 가리지 않고 outputs만
// 합산하므로 별도 로직 추가 없이 그대로 반영된다.
//
// ⚠️ 아래 MINT_SECRET은 실서비스 전환 전 반드시 제거하거나 진짜 인증(관리자
// 토큰 검증 등)으로 교체해야 한다 — 지금은 사용자가 없는 개발 단계라
// 임시로 공유 비밀 문자열 하나로만 막아둔다. (2026-07-07: 처음엔 이걸
// 최상위 const로 선언했다가 "MINT_SECRET is not defined" 예외를 만났다
// — computeBalance와 같은 이유(Goja가 콜백 바깥 최상위 선언을 실행 시점에
// 못 찾음)라, 아래처럼 콜백 안에 직접 넣는다.)

routerAdd("POST", "/api/mint", (c) => {
  // 2026-07-07 진단용 강화: 원인 미상의 400 "Something went wrong"을 잡기
  // 위해 핸들러 전체를 하나의 try/catch로 감싼다. PocketBase Goja 바인딩이
  // dao().saveRecord()의 스키마 검증 에러를 JS에서 못 잡는 경우가 있어
  // (이 프로젝트에 이미 알려진 "콜백 바깥 전역 함수 무시" 류의 다른
  // Goja 특이 동작과 비슷한 계열) — 원인을 찾을 때까지 이 형태로 둔다.
  //
  // 2026-07-07 추가: 발행 환율 공식화 — KRW 1,000원당 GDC 1T.
  // krw_amount(원화 입금액)를 정본 입력으로 받아 gdc_amount를 서버가
  // 직접 계산한다(클라이언트가 gdc_amount를 임의로 우기지 못하게).
  // 개발 초기 테스트에서 쓰던 amount(=GDC 직접 지정)는 하위호환으로
  // 남기되, 감사 추적을 위해 블록에 "어느 방식으로 발행했는지"와 환율을
  // 반드시 같이 남긴다 — 나중에 실거래 발행과 테스트 발행을 구분할 수
  // 있어야 한다.
  const EXCHANGE_RATE_KRW_PER_GDC = 1000; // KRW 1,000 = GDC 1

  try {
    console.log("[MINT] 진입");
    const body = $apis.requestInfo(c).data;
    console.log("[MINT] body 파싱 완료:", JSON.stringify(body));
    const { guid, amount, krw_amount, secret, memo } = body;

    const MINT_SECRET = "hondi-dev-mint-2026"; // 콜백 내부 선언 — 위 주석 참고
    if (secret !== MINT_SECRET) {
      console.log("[MINT] secret 불일치");
      return c.json(403, { ok: false, error: "FORBIDDEN" });
    }

    let gdcAmount, krwAmount, mintMethod;
    if (krw_amount != null) {
      if (!(Number(krw_amount) > 0)) {
        return c.json(400, { ok: false, error: "INVALID_AMOUNT", detail: "krw_amount는 0보다 커야 합니다" });
      }
      krwAmount  = Number(krw_amount);
      gdcAmount  = krwAmount / EXCHANGE_RATE_KRW_PER_GDC;
      mintMethod = "krw_exchange";
    } else if (amount != null) {
      // 하위호환(개발 테스트 전용) — GDC 금액을 직접 지정. 실거래 발행이
      // 아니라는 걸 블록에 명시해서 나중에 구분할 수 있게 한다.
      if (!(Number(amount) > 0)) {
        return c.json(400, { ok: false, error: "MISSING_FIELD", detail: "guid, amount(>0) 필수" });
      }
      gdcAmount  = Number(amount);
      krwAmount  = null;
      mintMethod = "dev_direct";
    } else {
      return c.json(400, { ok: false, error: "MISSING_FIELD", detail: "krw_amount 또는 amount(하위호환) 필수" });
    }
    if (!guid) {
      return c.json(400, { ok: false, error: "MISSING_FIELD", detail: "guid 필수" });
    }
    console.log("[MINT] 검증 통과, guid:", guid, "gdc:", gdcAmount, "krw:", krwAmount, "method:", mintMethod);

    function sha256hex(str) {
      const mathPow = Math.pow;
      const maxWord = mathPow(2, 32);
      let result = '';
      const words = [];
      const asciiBitLength = str.length * 8;
      let hash = [], k = [];
      let primeCounter = 0;
      const isComposite = {};
      for (let candidate = 2; primeCounter < 64; candidate++) {
        if (!isComposite[candidate]) {
          for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
          hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
          k[primeCounter++] = (mathPow(candidate, 1/3) * maxWord) | 0;
        }
      }
      let s = str + '\x80';
      while (s.length % 64 - 56) s += '\x00';
      for (let i = 0; i < s.length; i++) {
        const j = s.charCodeAt(i);
        if (j >> 8) return '';
        words[i >> 2] |= j << ((3 - i) % 4) * 8;
      }
      words[words.length] = ((asciiBitLength / maxWord) | 0);
      words[words.length] = (asciiBitLength | 0);
      for (let j = 0; j < words.length;) {
        const w = words.slice(j, j += 16);
        const oldHash = hash.slice(0);
        for (let i = 0; i < 64; i++) {
          const w15 = w[i-15], w2 = w[i-2];
          const a = hash[0], e = hash[4];
          const temp1 = hash[7]
            + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7))
            + ((e & hash[5]) ^ (~e & hash[6]))
            + k[i]
            + (w[i] = (i < 16) ? w[i] : (
              w[i-16]
              + ((w15 >>> 7 | w15 << 25) ^ (w15 >>> 18 | w15 << 14) ^ (w15 >>> 3))
              + w[i-7]
              + ((w2 >>> 17 | w2 << 15) ^ (w2 >>> 19 | w2 << 13) ^ (w2 >>> 10))
            ) | 0);
          const temp2 = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10))
            + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
          hash = [(temp1+temp2)|0].concat(hash);
          hash[4] = (hash[4]+temp1)|0;
          hash.length = 8;
        }
        hash = hash.map((v,i) => (v+oldHash[i])|0);
      }
      hash.forEach(val => {
        for (let i = 3; i+1; i--) {
          const byte = (val>>(i*8))&255;
          result += ((byte<16)?'0':'') + byte.toString(16);
        }
      });
      return result;
    }

    const contentHash = sha256hex("mint:" + guid + ":" + gdcAmount + ":" + Date.now());
    console.log("[MINT] contentHash:", contentHash, "| length:", contentHash.length);

    const col = $app.dao().findCollectionByNameOrId("blocks");
    console.log("[MINT] 컬렉션 조회 완료:", col ? col.id : "NULL");

    // 2026-07-07: krw_amount/exchange_rate/mint_method을 outputs 안에 같이
    // 남긴다 — blocks 스키마에 새 필드를 안 늘려도 되고(변경 최소화),
    // "발행 원장"이 블록 자체에 자기완결적으로 남는다(별도 감사 테이블 불요).
    const blockRecord = new Record(col);
    blockRecord.set("block_type",       "deposit");
    blockRecord.set("tx_hash",          contentHash);
    blockRecord.set("buyer_guid",       "gdc-mint");
    blockRecord.set("seller_guid",      guid);
    blockRecord.set("buyer_sig",        "");
    blockRecord.set("outputs", JSON.stringify([{
      recipient_guid: guid,
      amount: gdcAmount,
      krw_amount: krwAmount,
      exchange_rate: EXCHANGE_RATE_KRW_PER_GDC,
      mint_method: mintMethod,
    }]));
    blockRecord.set("prev_block_hash",  "");
    blockRecord.set("content_hash",     contentHash);
    blockRecord.set("height",           0);
    blockRecord.set("prev_settle_hash", "");
    console.log("[MINT] Record 필드 설정 완료, 저장 시도");

    $app.dao().saveRecord(blockRecord);
    console.log("[MINT] 저장 완료, id:", blockRecord.getId());

    console.log("[MINT]", guid, "+" + gdcAmount + "T", "(krw:" + krwAmount + ")", memo ? "(" + memo + ")" : "");
    return c.json(200, {
      ok: true,
      block_id: blockRecord.getId(),
      content_hash: contentHash,
      guid,
      amount: gdcAmount,
      krw_amount: krwAmount,
      exchange_rate: EXCHANGE_RATE_KRW_PER_GDC,
    });
  } catch (e) {
    console.log("[MINT] 예외 발생:", e.message, "| stack:", e.stack || "(no stack)");
    return c.json(500, { ok: false, error: "MINT_EXCEPTION", detail: e.message || String(e) });
  }
});
// ── 2026-07-07 신설: 재대사(reconcile) 지원 — guid의 실제 잔액 +
// 다음 거래에 쓸 prev_settle_hash를 서버(L1)에서 직접 조회한다.
// 클라이언트(gopang-wallet.js)의 로컬 IndexedDB가 새 기기·스토리지
// 초기화 등으로 서버 원장과 어긋나는 경우, 이 엔드포인트로 복구한다.
routerAdd("GET", "/api/balance", (c) => {
  try {
    const guid = $apis.requestInfo(c).query.guid;
    console.log("[BALANCE] 진입, guid:", guid);
    if (!guid) return c.json(400, { ok: false, error: "MISSING_FIELD", detail: "guid 쿼리 파라미터 필수" });

    // computeBalance — /api/tx와 동일 로직(콜백마다 따로 선언, Goja 제약)
    function computeBalance(g) {
      const allBlocks = $app.dao().findRecordsByFilter("blocks", "block_type != ''", "", 10000, 0);
      let balance = 0;
      for (const b of allBlocks) {
        let blkOutputs;
        try { blkOutputs = JSON.parse(b.getString("outputs") || "[]"); } catch (e) { continue; }
        for (const o of blkOutputs) {
          if (o.recipient_guid === g) balance += (o.amount || 0);
        }
        if (b.getString("buyer_guid") === g) {
          const total = blkOutputs.reduce((s, o) => s + (o.amount || 0), 0);
          balance -= total;
        }
      }
      return balance;
    }

    const balance = computeBalance(guid);

    // 이 guid가 buyer(지불자)로 등장한 가장 최근 블록 — 다음 거래의
    // prev_settle_hash 기준. 지불 이력이 없으면(발행만 받았거나 첫
    // 거래 전) null — 그 경우 클라이언트는 prev_settle_hash:null로
    // 첫 거래를 시도하면 된다(main.pb.js 3단계가 이미 그렇게 처리함).
    let latestBlockHash = null;
    let height = 0;
    try {
      const buyerBlocks = $app.dao().findRecordsByFilter("blocks", "block_type != ''", "-height", 1000, 0)
        .filter(r => r.getString("buyer_guid") === guid);
      if (buyerBlocks.length > 0) {
        latestBlockHash = buyerBlocks[0].getString("content_hash");
        height = buyerBlocks[0].getFloat("height");
      }
    } catch (e) { /* 이력 없음 */ }

    return c.json(200, {
      ok: true,
      guid,
      balance,
      latest_block_hash: latestBlockHash,
      height,
    });
  } catch (e) {
    return c.json(500, { ok: false, error: "BALANCE_QUERY_FAILED", detail: e.message });
  }
});

// ── 2026-07-07 신설: GDC 발행 총량 보존 검증 ──────────────────────────
// 불변식: 이 L1에서 지금까지 발행(mint)된 GDC 총량 == 이 L1에 등장한
// 모든 guid(구매자·판매자·gopang-platform 포함)의 잔액 합. 발행만이
// 총량을 늘리는 유일한 사건이고, 그 외 모든 거래(구매 등)는 이 L1
// 내부에서 제로섬이어야 하므로, 두 값이 항상 같아야 한다. 다르면
// 어딘가에서 GDC가 생기거나 사라진 것 — 감사해야 할 상황이다.
//
// L1→L2→...→L5 계층 간 제로섬 전파(다른 L1 소속 판매자와 거래 시,
// 개별 L1 총량은 변하지만 상위 L2에서는 제로섬이어야 한다는 것)는
// 별도로 설계했으나, 지금 이 L1(hanlim) 외에 실제로 살아있는 L1이
// 확인되지 않아 이 엔드포인트는 "이 L1 하나"에 대한 보존만 검증한다.
routerAdd("GET", "/api/supply/verify", (c) => {
  // ── 2026-07-07 신설(제주 L1~L3 필드 테스트): 계층 인식 ─────────────────
  // 이 엔드포인트가 이제 43개 L1 + 2개 L2 + 1개 L3가 전부 공유하는 훅
  // 파일에서 실행되므로, 폴더명으로 자기 층위를 먼저 확인한다. L2/L3는
  // 자체 blocks 원장이 없으므로(§2.1), 하위 노드들의 /api/supply/verify를
  // HTTP로 재귀 호출해 합산한다. 각 L1이 로컬에서 이미 발행==잔액합을
  // 만족하므로(브릿지도 sentinel 계정으로 로컬에서 항상 제로섬 —
  // jeju-l1-l3-field-test-plan-2026-07-07.md §5/§6 참고), 그 합도 자동으로
  // 일치한다 — 별도의 "브릿지 진행 중 유예시간" 로직이 필요 없다(당초
  // 계획서 §6.4가 우려했던 오탐은, sentinel 계정 설계로 근본적으로
  // 발생하지 않는다).
const NODE_CONFIG = {
  "hanlim": { id: "KR-JEJU-JEJU-HANLIM", layer: 1, port: 8091, parentUrl: "http://127.0.0.1:8092" },
  "l1-aewol": { id: "KR-JEJU-JEJU-AEWOL", layer: 1, port: 8101, parentUrl: "http://127.0.0.1:8092" },
  "l1-jocheon": { id: "KR-JEJU-JEJU-JOCHEON", layer: 1, port: 8102, parentUrl: "http://127.0.0.1:8092" },
  "l1-gujwa": { id: "KR-JEJU-JEJU-GUJWA", layer: 1, port: 8103, parentUrl: "http://127.0.0.1:8092" },
  "l1-hangyeong": { id: "KR-JEJU-JEJU-HANGYEONG", layer: 1, port: 8104, parentUrl: "http://127.0.0.1:8092" },
  "l1-chuja": { id: "KR-JEJU-JEJU-CHUJA", layer: 1, port: 8105, parentUrl: "http://127.0.0.1:8092" },
  "l1-udo": { id: "KR-JEJU-JEJU-UDO", layer: 1, port: 8106, parentUrl: "http://127.0.0.1:8092" },
  "l1-ildo1": { id: "KR-JEJU-JEJU-ILDO1", layer: 1, port: 8107, parentUrl: "http://127.0.0.1:8092" },
  "l1-ildo2": { id: "KR-JEJU-JEJU-ILDO2", layer: 1, port: 8108, parentUrl: "http://127.0.0.1:8092" },
  "l1-ido1": { id: "KR-JEJU-JEJU-IDO1", layer: 1, port: 8109, parentUrl: "http://127.0.0.1:8092" },
  "l1-ido2": { id: "KR-JEJU-JEJU-IDO2", layer: 1, port: 8110, parentUrl: "http://127.0.0.1:8092" },
  "l1-samdo1": { id: "KR-JEJU-JEJU-SAMDO1", layer: 1, port: 8111, parentUrl: "http://127.0.0.1:8092" },
  "l1-samdo2": { id: "KR-JEJU-JEJU-SAMDO2", layer: 1, port: 8112, parentUrl: "http://127.0.0.1:8092" },
  "l1-yongdam1": { id: "KR-JEJU-JEJU-YONGDAM1", layer: 1, port: 8113, parentUrl: "http://127.0.0.1:8092" },
  "l1-yongdam2": { id: "KR-JEJU-JEJU-YONGDAM2", layer: 1, port: 8114, parentUrl: "http://127.0.0.1:8092" },
  "l1-geonip": { id: "KR-JEJU-JEJU-GEONIP", layer: 1, port: 8115, parentUrl: "http://127.0.0.1:8092" },
  "l1-hwabuk": { id: "KR-JEJU-JEJU-HWABUK", layer: 1, port: 8116, parentUrl: "http://127.0.0.1:8092" },
  "l1-samyang": { id: "KR-JEJU-JEJU-SAMYANG", layer: 1, port: 8117, parentUrl: "http://127.0.0.1:8092" },
  "l1-bonggae": { id: "KR-JEJU-JEJU-BONGGAE", layer: 1, port: 8118, parentUrl: "http://127.0.0.1:8092" },
  "l1-ara": { id: "KR-JEJU-JEJU-ARA", layer: 1, port: 8119, parentUrl: "http://127.0.0.1:8092" },
  "l1-ora": { id: "KR-JEJU-JEJU-ORA", layer: 1, port: 8120, parentUrl: "http://127.0.0.1:8092" },
  "l1-yeondong": { id: "KR-JEJU-JEJU-YEONDONG", layer: 1, port: 8121, parentUrl: "http://127.0.0.1:8092" },
  "l1-nohyeong": { id: "KR-JEJU-JEJU-NOHYEONG", layer: 1, port: 8122, parentUrl: "http://127.0.0.1:8092" },
  "l1-oedo": { id: "KR-JEJU-JEJU-OEDO", layer: 1, port: 8123, parentUrl: "http://127.0.0.1:8092" },
  "l1-iho": { id: "KR-JEJU-JEJU-IHO", layer: 1, port: 8124, parentUrl: "http://127.0.0.1:8092" },
  "l1-dodu": { id: "KR-JEJU-JEJU-DODU", layer: 1, port: 8125, parentUrl: "http://127.0.0.1:8092" },
  "l1-daejeong": { id: "KR-JEJU-SGP-DAEJEONG", layer: 1, port: 8126, parentUrl: "http://127.0.0.1:8093" },
  "l1-namwon": { id: "KR-JEJU-SGP-NAMWON", layer: 1, port: 8127, parentUrl: "http://127.0.0.1:8093" },
  "l1-seongsan": { id: "KR-JEJU-SGP-SEONGSAN", layer: 1, port: 8128, parentUrl: "http://127.0.0.1:8093" },
  "l1-andeok": { id: "KR-JEJU-SGP-ANDEOK", layer: 1, port: 8129, parentUrl: "http://127.0.0.1:8093" },
  "l1-pyoseon": { id: "KR-JEJU-SGP-PYOSEON", layer: 1, port: 8130, parentUrl: "http://127.0.0.1:8093" },
  "l1-songsan": { id: "KR-JEJU-SGP-SONGSAN", layer: 1, port: 8131, parentUrl: "http://127.0.0.1:8093" },
  "l1-jeongbang": { id: "KR-JEJU-SGP-JEONGBANG", layer: 1, port: 8132, parentUrl: "http://127.0.0.1:8093" },
  "l1-jungang-sgp": { id: "KR-JEJU-SGP-JUNGANG-SGP", layer: 1, port: 8133, parentUrl: "http://127.0.0.1:8093" },
  "l1-cheonji": { id: "KR-JEJU-SGP-CHEONJI", layer: 1, port: 8134, parentUrl: "http://127.0.0.1:8093" },
  "l1-hyodon": { id: "KR-JEJU-SGP-HYODON", layer: 1, port: 8135, parentUrl: "http://127.0.0.1:8093" },
  "l1-yeongcheon": { id: "KR-JEJU-SGP-YEONGCHEON", layer: 1, port: 8136, parentUrl: "http://127.0.0.1:8093" },
  "l1-donghong": { id: "KR-JEJU-SGP-DONGHONG", layer: 1, port: 8137, parentUrl: "http://127.0.0.1:8093" },
  "l1-seohong": { id: "KR-JEJU-SGP-SEOHONG", layer: 1, port: 8138, parentUrl: "http://127.0.0.1:8093" },
  "l1-daeryun": { id: "KR-JEJU-SGP-DAERYUN", layer: 1, port: 8139, parentUrl: "http://127.0.0.1:8093" },
  "l1-daecheon": { id: "KR-JEJU-SGP-DAECHEON", layer: 1, port: 8140, parentUrl: "http://127.0.0.1:8093" },
  "l1-jungmun": { id: "KR-JEJU-SGP-JUNGMUN", layer: 1, port: 8141, parentUrl: "http://127.0.0.1:8093" },
  "l1-yerae": { id: "KR-JEJU-SGP-YERAE", layer: 1, port: 8142, parentUrl: "http://127.0.0.1:8093" },
  "l2-jeju": { id: "KR-JEJU-JEJU-SI", layer: 2, port: 8092, parentUrl: "http://127.0.0.1:8094" },
  "l2-seogwipo": { id: "KR-JEJU-SGP-SI", layer: 2, port: 8093, parentUrl: "http://127.0.0.1:8094" },
  "l3-jejudo": { id: "KR-JEJU", layer: 3, port: 8094, parentUrl: "http://127.0.0.1:8095" },
  "l4-kr": { id: "KR", layer: 4, port: 8095, parentUrl: "http://127.0.0.1:8096" },
  "l5-global": { id: "GLOBAL", layer: 5, port: 8096, parentUrl: null },
};
const CHILDREN_PORTS = {
  "l2-jeju": [8091, 8101, 8102, 8103, 8104, 8105, 8106, 8107, 8108, 8109, 8110, 8111, 8112, 8113, 8114, 8115, 8116, 8117, 8118, 8119, 8120, 8121, 8122, 8123, 8124, 8125],
  "l2-seogwipo": [8126, 8127, 8128, 8129, 8130, 8131, 8132, 8133, 8134, 8135, 8136, 8137, 8138, 8139, 8140, 8141, 8142],
  "l3-jejudo": [8092, 8093],
};
  const _selfFolder = $app.dataDir().split("/").pop();
  const _self = NODE_CONFIG[_selfFolder] || NODE_CONFIG["hanlim"];

  if (_self.layer >= 2) {
    const childPorts = CHILDREN_PORTS[_selfFolder] || [];
    let totalMinted = 0, totalBalance = 0, allValid = true;
    const children = [];
    const unreachable = [];
    for (const port of childPorts) {
      try {
        const resp = $http.send({ url: "http://127.0.0.1:" + port + "/api/supply/verify", method: "GET" });
        const data = JSON.parse(resp.raw);
        if (!data || !data.ok) { allValid = false; unreachable.push(port); continue; }
        totalMinted  += (data.total_minted  || 0);
        totalBalance += (data.total_balance || 0);
        if (!data.valid) allValid = false;
        children.push({ node: data.node, port, layer: data.layer || 1,
          total_minted: data.total_minted, total_balance: data.total_balance, valid: data.valid });
      } catch (e) {
        allValid = false;
        unreachable.push(port);
        children.push({ port, error: e.message });
      }
    }
    const diff  = Math.abs(totalMinted - totalBalance);
    const valid = allValid && diff < 0.01;
    if (!valid) {
      console.error("[SUPPLY][" + _self.id + "] 상위 계층 보존 검증 실패!",
        JSON.stringify({ totalMinted, totalBalance, diff, unreachable }));
    }
    return c.json(200, {
      ok: true,
      node: _self.id,
      layer: _self.layer,
      total_minted: totalMinted,
      total_balance: totalBalance,
      diff,
      valid,
      child_count: childPorts.length,
      unreachable_children: unreachable,
      children,
    });
  }

  // ── L1: 기존 로컬 보존 검증 (기존 로직 그대로, node만 동적화) ─────────
  try {
    const allBlocks = $app.dao().findRecordsByFilter("blocks", "block_type != ''", "", 10000, 0);

    let totalMinted = 0;
    const guidSet = new Set();
    for (const b of allBlocks) {
      let outputs;
      try { outputs = JSON.parse(b.getString("outputs") || "[]"); } catch (e) { continue; }
      const blockType = b.getString("block_type");
      for (const o of outputs) {
        if (o.recipient_guid) guidSet.add(o.recipient_guid);
        if (blockType === "deposit") totalMinted += (o.amount || 0);
      }
      const buyerGuid = b.getString("buyer_guid");
      if (buyerGuid && buyerGuid !== "gdc-mint") guidSet.add(buyerGuid);
    }

    function computeBalance(guid) {
      let balance = 0;
      for (const b of allBlocks) {
        let blkOutputs;
        try { blkOutputs = JSON.parse(b.getString("outputs") || "[]"); } catch (e) { continue; }
        for (const o of blkOutputs) {
          if (o.recipient_guid === guid) balance += (o.amount || 0);
        }
        if (b.getString("buyer_guid") === guid) {
          const total = blkOutputs.reduce((s, o) => s + (o.amount || 0), 0);
          balance -= total;
        }
      }
      return balance;
    }

    let totalBalance = 0;
    const balances = {};
    for (const g of guidSet) {
      const bal = computeBalance(g);
      balances[g] = bal;
      totalBalance += bal;
    }

    const diff  = Math.abs(totalMinted - totalBalance);
    const valid = diff < 0.01;
    if (!valid) {
      console.error("[SUPPLY][" + _self.id + "] 보존 검증 실패!", JSON.stringify({ totalMinted, totalBalance, diff }));
    }

    return c.json(200, {
      ok: true,
      node: _self.id,
      layer: 1,
      total_minted: totalMinted,
      total_balance: totalBalance,
      diff,
      valid,
      guid_count: guidSet.size,
      balances,
    });
  } catch (e) {
    return c.json(500, { ok: false, error: "SUPPLY_VERIFY_FAILED", detail: e.message });
  }
});

// GDC 발행 총량만 간단히 조회(검증 없이) — 대시보드 등에서 자주 호출할 땐 이쪽이 가볍다
routerAdd("GET", "/api/supply", (c) => {
  try {
const NODE_CONFIG = {
  "hanlim": { id: "KR-JEJU-JEJU-HANLIM", layer: 1, port: 8091, parentUrl: "http://127.0.0.1:8092" },
  "l1-aewol": { id: "KR-JEJU-JEJU-AEWOL", layer: 1, port: 8101, parentUrl: "http://127.0.0.1:8092" },
  "l1-jocheon": { id: "KR-JEJU-JEJU-JOCHEON", layer: 1, port: 8102, parentUrl: "http://127.0.0.1:8092" },
  "l1-gujwa": { id: "KR-JEJU-JEJU-GUJWA", layer: 1, port: 8103, parentUrl: "http://127.0.0.1:8092" },
  "l1-hangyeong": { id: "KR-JEJU-JEJU-HANGYEONG", layer: 1, port: 8104, parentUrl: "http://127.0.0.1:8092" },
  "l1-chuja": { id: "KR-JEJU-JEJU-CHUJA", layer: 1, port: 8105, parentUrl: "http://127.0.0.1:8092" },
  "l1-udo": { id: "KR-JEJU-JEJU-UDO", layer: 1, port: 8106, parentUrl: "http://127.0.0.1:8092" },
  "l1-ildo1": { id: "KR-JEJU-JEJU-ILDO1", layer: 1, port: 8107, parentUrl: "http://127.0.0.1:8092" },
  "l1-ildo2": { id: "KR-JEJU-JEJU-ILDO2", layer: 1, port: 8108, parentUrl: "http://127.0.0.1:8092" },
  "l1-ido1": { id: "KR-JEJU-JEJU-IDO1", layer: 1, port: 8109, parentUrl: "http://127.0.0.1:8092" },
  "l1-ido2": { id: "KR-JEJU-JEJU-IDO2", layer: 1, port: 8110, parentUrl: "http://127.0.0.1:8092" },
  "l1-samdo1": { id: "KR-JEJU-JEJU-SAMDO1", layer: 1, port: 8111, parentUrl: "http://127.0.0.1:8092" },
  "l1-samdo2": { id: "KR-JEJU-JEJU-SAMDO2", layer: 1, port: 8112, parentUrl: "http://127.0.0.1:8092" },
  "l1-yongdam1": { id: "KR-JEJU-JEJU-YONGDAM1", layer: 1, port: 8113, parentUrl: "http://127.0.0.1:8092" },
  "l1-yongdam2": { id: "KR-JEJU-JEJU-YONGDAM2", layer: 1, port: 8114, parentUrl: "http://127.0.0.1:8092" },
  "l1-geonip": { id: "KR-JEJU-JEJU-GEONIP", layer: 1, port: 8115, parentUrl: "http://127.0.0.1:8092" },
  "l1-hwabuk": { id: "KR-JEJU-JEJU-HWABUK", layer: 1, port: 8116, parentUrl: "http://127.0.0.1:8092" },
  "l1-samyang": { id: "KR-JEJU-JEJU-SAMYANG", layer: 1, port: 8117, parentUrl: "http://127.0.0.1:8092" },
  "l1-bonggae": { id: "KR-JEJU-JEJU-BONGGAE", layer: 1, port: 8118, parentUrl: "http://127.0.0.1:8092" },
  "l1-ara": { id: "KR-JEJU-JEJU-ARA", layer: 1, port: 8119, parentUrl: "http://127.0.0.1:8092" },
  "l1-ora": { id: "KR-JEJU-JEJU-ORA", layer: 1, port: 8120, parentUrl: "http://127.0.0.1:8092" },
  "l1-yeondong": { id: "KR-JEJU-JEJU-YEONDONG", layer: 1, port: 8121, parentUrl: "http://127.0.0.1:8092" },
  "l1-nohyeong": { id: "KR-JEJU-JEJU-NOHYEONG", layer: 1, port: 8122, parentUrl: "http://127.0.0.1:8092" },
  "l1-oedo": { id: "KR-JEJU-JEJU-OEDO", layer: 1, port: 8123, parentUrl: "http://127.0.0.1:8092" },
  "l1-iho": { id: "KR-JEJU-JEJU-IHO", layer: 1, port: 8124, parentUrl: "http://127.0.0.1:8092" },
  "l1-dodu": { id: "KR-JEJU-JEJU-DODU", layer: 1, port: 8125, parentUrl: "http://127.0.0.1:8092" },
  "l1-daejeong": { id: "KR-JEJU-SGP-DAEJEONG", layer: 1, port: 8126, parentUrl: "http://127.0.0.1:8093" },
  "l1-namwon": { id: "KR-JEJU-SGP-NAMWON", layer: 1, port: 8127, parentUrl: "http://127.0.0.1:8093" },
  "l1-seongsan": { id: "KR-JEJU-SGP-SEONGSAN", layer: 1, port: 8128, parentUrl: "http://127.0.0.1:8093" },
  "l1-andeok": { id: "KR-JEJU-SGP-ANDEOK", layer: 1, port: 8129, parentUrl: "http://127.0.0.1:8093" },
  "l1-pyoseon": { id: "KR-JEJU-SGP-PYOSEON", layer: 1, port: 8130, parentUrl: "http://127.0.0.1:8093" },
  "l1-songsan": { id: "KR-JEJU-SGP-SONGSAN", layer: 1, port: 8131, parentUrl: "http://127.0.0.1:8093" },
  "l1-jeongbang": { id: "KR-JEJU-SGP-JEONGBANG", layer: 1, port: 8132, parentUrl: "http://127.0.0.1:8093" },
  "l1-jungang-sgp": { id: "KR-JEJU-SGP-JUNGANG-SGP", layer: 1, port: 8133, parentUrl: "http://127.0.0.1:8093" },
  "l1-cheonji": { id: "KR-JEJU-SGP-CHEONJI", layer: 1, port: 8134, parentUrl: "http://127.0.0.1:8093" },
  "l1-hyodon": { id: "KR-JEJU-SGP-HYODON", layer: 1, port: 8135, parentUrl: "http://127.0.0.1:8093" },
  "l1-yeongcheon": { id: "KR-JEJU-SGP-YEONGCHEON", layer: 1, port: 8136, parentUrl: "http://127.0.0.1:8093" },
  "l1-donghong": { id: "KR-JEJU-SGP-DONGHONG", layer: 1, port: 8137, parentUrl: "http://127.0.0.1:8093" },
  "l1-seohong": { id: "KR-JEJU-SGP-SEOHONG", layer: 1, port: 8138, parentUrl: "http://127.0.0.1:8093" },
  "l1-daeryun": { id: "KR-JEJU-SGP-DAERYUN", layer: 1, port: 8139, parentUrl: "http://127.0.0.1:8093" },
  "l1-daecheon": { id: "KR-JEJU-SGP-DAECHEON", layer: 1, port: 8140, parentUrl: "http://127.0.0.1:8093" },
  "l1-jungmun": { id: "KR-JEJU-SGP-JUNGMUN", layer: 1, port: 8141, parentUrl: "http://127.0.0.1:8093" },
  "l1-yerae": { id: "KR-JEJU-SGP-YERAE", layer: 1, port: 8142, parentUrl: "http://127.0.0.1:8093" },
  "l2-jeju": { id: "KR-JEJU-JEJU-SI", layer: 2, port: 8092, parentUrl: "http://127.0.0.1:8094" },
  "l2-seogwipo": { id: "KR-JEJU-SGP-SI", layer: 2, port: 8093, parentUrl: "http://127.0.0.1:8094" },
  "l3-jejudo": { id: "KR-JEJU", layer: 3, port: 8094, parentUrl: "http://127.0.0.1:8095" },
  "l4-kr": { id: "KR", layer: 4, port: 8095, parentUrl: "http://127.0.0.1:8096" },
  "l5-global": { id: "GLOBAL", layer: 5, port: 8096, parentUrl: null },
};
    const _selfFolder = $app.dataDir().split("/").pop();
    const _self = NODE_CONFIG[_selfFolder] || NODE_CONFIG["hanlim"];
    const allBlocks = $app.dao().findRecordsByFilter("blocks", "block_type = 'deposit'", "", 10000, 0);
    let totalMinted = 0;
    for (const b of allBlocks) {
      let outputs;
      try { outputs = JSON.parse(b.getString("outputs") || "[]"); } catch (e) { continue; }
      totalMinted += outputs.reduce((s, o) => s + (o.amount || 0), 0);
    }
    return c.json(200, { ok: true, node: _self.id, total_minted: totalMinted });
  } catch (e) {
    return c.json(500, { ok: false, error: "SUPPLY_QUERY_FAILED", detail: e.message });
  }
});

// ══════════════════════════════════════════════════════════════
// 2026-07-07 신설(제주 L1~L3 필드 테스트) — 브릿지 트랜잭션 프로토콜
// jeju-l1-l3-field-test-plan-2026-07-07.md §5 참고.
// L1은 다른 L1을 직접 호출하지 않는다(P1) — 아래 세 엔드포인트는 전부
// Worker(허브)가 폴링·트리거하는 대상이지, L1끼리 서로 부르지 않는다.
// ══════════════════════════════════════════════════════════════

// POST /api/bridge-in — 다른 L1에서 이 L1 소속 판매자에게 들어오는 크레딧.
// tx_hash 기준 멱등 — 같은 tx_hash로 여러 번 호출돼도 한 번만 반영된다.
routerAdd("POST", "/api/bridge-in", (c) => {
  try {
    const body = $apis.requestInfo(c).data;
    const { tx_hash, source_node, guid, amount } = body;
    if (!tx_hash || !source_node || !guid || !(Number(amount) > 0)) {
      return c.json(400, { ok: false, error: "MISSING_FIELD" });
    }

    try {
      const existing = $app.dao().findFirstRecordByFilter("bridge_in", "tx_hash = '" + tx_hash + "'");
      if (existing) {
        return c.json(200, { ok: true, applied: false, reason: "ALREADY_APPLIED", tx_hash });
      }
    } catch (e) { /* 없음 — 최초 호출, 정상 진행 */ }

    function sha256hex(str) {
      const mathPow = Math.pow;
      const maxWord = mathPow(2, 32);
      let result = '';
      const words = [];
      const asciiBitLength = str.length * 8;
      let hash = [], k = [];
      let primeCounter = 0;
      const isComposite = {};
      for (let candidate = 2; primeCounter < 64; candidate++) {
        if (!isComposite[candidate]) {
          for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
          hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
          k[primeCounter++] = (mathPow(candidate, 1/3) * maxWord) | 0;
        }
      }
      let s = str + '\x80';
      while (s.length % 64 - 56) s += '\x00';
      for (let i = 0; i < s.length; i++) {
        const j = s.charCodeAt(i);
        if (j >> 8) return '';
        words[i >> 2] |= j << ((3 - i) % 4) * 8;
      }
      words[words.length] = ((asciiBitLength / maxWord) | 0);
      words[words.length] = (asciiBitLength | 0);
      for (let j = 0; j < words.length;) {
        const w = words.slice(j, j += 16);
        const oldHash = hash.slice(0);
        for (let i = 0; i < 64; i++) {
          const w15 = w[i-15], w2 = w[i-2];
          const a = hash[0], e = hash[4];
          const temp1 = hash[7]
            + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7))
            + ((e & hash[5]) ^ (~e & hash[6]))
            + k[i]
            + (w[i] = (i < 16) ? w[i] : (
              w[i-16]
              + ((w15 >>> 7 | w15 << 25) ^ (w15 >>> 18 | w15 << 14) ^ (w15 >>> 3))
              + w[i-7]
              + ((w2 >>> 17 | w2 << 15) ^ (w2 >>> 19 | w2 << 13) ^ (w2 >>> 10))
            ) | 0);
          const temp2 = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10))
            + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
          hash = [(temp1+temp2)|0].concat(hash);
          hash[4] = (hash[4]+temp1)|0;
          hash.length = 8;
        }
        hash = hash.map((v,i) => (v+oldHash[i])|0);
      }
      hash.forEach(val => {
        for (let i = 3; i+1; i--) {
          const byte = (val>>(i*8))&255;
          result += ((byte<16)?'0':'') + byte.toString(16);
        }
      });
      return result;
    }

    // 블록 생성 — buyer_guid를 sentinel("bridge-in:{source_node}")로 두어
    // 이 L1의 발행==잔액합 불변식이 그대로 유지된다(실제 신규 발행이
    // 아니라 다른 L1에서 넘어온 금액이므로 totalMinted는 안 늘린다).
    const contentHash = sha256hex("bridge-in:" + tx_hash + ":" + guid + ":" + Date.now());
    const col = $app.dao().findCollectionByNameOrId("blocks");
    const rec = new Record(col);
    rec.set("block_type",       "bridge_in");
    rec.set("tx_hash",          tx_hash);
    rec.set("buyer_guid",       "bridge-in:" + source_node);
    rec.set("seller_guid",      guid);
    rec.set("buyer_sig",        "");
    rec.set("outputs",          JSON.stringify([{ recipient_guid: guid, amount: Number(amount) }]));
    rec.set("prev_block_hash",  "");
    rec.set("content_hash",     contentHash);
    rec.set("height",           0);
    rec.set("prev_settle_hash", "");
    $app.dao().saveRecord(rec);

    const biCol = $app.dao().findCollectionByNameOrId("bridge_in");
    const biRec = new Record(biCol);
    biRec.set("tx_hash",     tx_hash);
    biRec.set("source_node", source_node);
    biRec.set("guid",        guid);
    biRec.set("amount",      Number(amount));
    biRec.set("status",      "applied");
    biRec.set("applied_at",  new Date().toISOString());
    $app.dao().saveRecord(biRec);

    console.log("[BRIDGE-IN]", guid.slice(0,20), "+" + amount + "T ←", source_node);
    return c.json(200, { ok: true, applied: true, tx_hash, block_id: rec.getId() });
  } catch (e) {
    return c.json(500, { ok: false, error: "BRIDGE_IN_FAILED", detail: e.message });
  }
});

// GET /api/bridge-out/pending — Worker가 폴링해 재시도 대상을 찾는다.
// L1이 다른 L1을 직접 부르지 않으므로(P1), 재시도 오케스트레이션은 항상
// Worker 쪽 책임이다 — 이 엔드포인트는 그 폴링을 위한 조회 창구일 뿐이다.
routerAdd("GET", "/api/bridge-out/pending", (c) => {
  try {
    const recs = $app.dao().findRecordsByFilter("bridge_out", "status = 'pending'", "-created", 500, 0);
    const pending = recs.map(r => ({
      tx_hash:     r.getString("tx_hash"),
      target_node: r.getString("target_node"),
      guid:        r.getString("guid"),
      amount:      r.getFloat("amount"),
      created_at:  r.getString("created_at"),
    }));
    return c.json(200, { ok: true, count: pending.length, pending });
  } catch (e) {
    return c.json(500, { ok: false, error: "BRIDGE_OUT_QUERY_FAILED", detail: e.message });
  }
});

// POST /api/bridge-out/complete — Worker가 대상 L1의 /api/bridge-in 성공을
// 확인한 뒤 호출. body: { tx_hash }
routerAdd("POST", "/api/bridge-out/complete", (c) => {
  try {
    const body = $apis.requestInfo(c).data;
    const { tx_hash } = body;
    if (!tx_hash) return c.json(400, { ok: false, error: "MISSING_FIELD" });
    const rec = $app.dao().findFirstRecordByFilter("bridge_out", "tx_hash = '" + tx_hash + "'");
    if (!rec) return c.json(404, { ok: false, error: "NOT_FOUND" });
    rec.set("status", "completed");
    rec.set("completed_at", new Date().toISOString());
    $app.dao().saveRecord(rec);
    return c.json(200, { ok: true, tx_hash, status: "completed" });
  } catch (e) {
    return c.json(500, { ok: false, error: "BRIDGE_OUT_COMPLETE_FAILED", detail: e.message });
  }
});

// POST /api/bridge-out/refund — §5.1 유예시간(예: 1시간) 초과 시 Worker가
// 호출하는 보상 트랜잭션. sentinel("bridge-out:{target}")에서 원 구매자
// 에게 되돌리는 블록을 만들어, 실패한 브릿지 시도를 상쇄한다.
// body: { tx_hash, buyer_guid }
routerAdd("POST", "/api/bridge-out/refund", (c) => {
  try {
    const body = $apis.requestInfo(c).data;
    const { tx_hash, buyer_guid } = body;
    if (!tx_hash || !buyer_guid) return c.json(400, { ok: false, error: "MISSING_FIELD" });
    const rec = $app.dao().findFirstRecordByFilter("bridge_out", "tx_hash = '" + tx_hash + "'");
    if (!rec) return c.json(404, { ok: false, error: "NOT_FOUND" });
    if (rec.getString("status") === "completed") {
      return c.json(409, { ok: false, error: "ALREADY_COMPLETED", detail: "이미 정상 완료된 브릿지는 환불할 수 없습니다" });
    }
    if (rec.getString("status") === "refunded") {
      return c.json(200, { ok: true, tx_hash, status: "refunded", already: true });
    }
    const targetNode = rec.getString("target_node");
    const amount     = rec.getFloat("amount");

    function sha256hex(str) {
      const mathPow = Math.pow; const maxWord = mathPow(2, 32);
      let result = ''; const words = []; const asciiBitLength = str.length * 8;
      let hash = [], k = []; let primeCounter = 0; const isComposite = {};
      for (let candidate = 2; primeCounter < 64; candidate++) {
        if (!isComposite[candidate]) {
          for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
          hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
          k[primeCounter++] = (mathPow(candidate, 1/3) * maxWord) | 0;
        }
      }
      let s = str + '\x80';
      while (s.length % 64 - 56) s += '\x00';
      for (let i = 0; i < s.length; i++) {
        const j = s.charCodeAt(i); if (j >> 8) return '';
        words[i >> 2] |= j << ((3 - i) % 4) * 8;
      }
      words[words.length] = ((asciiBitLength / maxWord) | 0);
      words[words.length] = (asciiBitLength | 0);
      for (let j = 0; j < words.length;) {
        const w = words.slice(j, j += 16); const oldHash = hash.slice(0);
        for (let i = 0; i < 64; i++) {
          const w15 = w[i-15], w2 = w[i-2]; const a = hash[0], e = hash[4];
          const temp1 = hash[7]
            + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7))
            + ((e & hash[5]) ^ (~e & hash[6])) + k[i]
            + (w[i] = (i < 16) ? w[i] : (
              w[i-16]
              + ((w15 >>> 7 | w15 << 25) ^ (w15 >>> 18 | w15 << 14) ^ (w15 >>> 3))
              + w[i-7]
              + ((w2 >>> 17 | w2 << 15) ^ (w2 >>> 19 | w2 << 13) ^ (w2 >>> 10))
            ) | 0);
          const temp2 = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10))
            + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
          hash = [(temp1+temp2)|0].concat(hash);
          hash[4] = (hash[4]+temp1)|0; hash.length = 8;
        }
        hash = hash.map((v,i) => (v+oldHash[i])|0);
      }
      hash.forEach(val => { for (let i = 3; i+1; i--) {
        const byte = (val>>(i*8))&255; result += ((byte<16)?'0':'') + byte.toString(16);
      }});
      return result;
    }

    const contentHash = sha256hex("bridge-refund:" + tx_hash + ":" + Date.now());
    const col = $app.dao().findCollectionByNameOrId("blocks");
    const refundRec = new Record(col);
    refundRec.set("block_type",       "bridge_refund");
    refundRec.set("tx_hash",          tx_hash + ":refund");
    refundRec.set("buyer_guid",       "bridge-out:" + targetNode); // sentinel에서 차감
    refundRec.set("seller_guid",      buyer_guid);
    refundRec.set("buyer_sig",        "");
    refundRec.set("outputs",          JSON.stringify([{ recipient_guid: buyer_guid, amount }]));
    refundRec.set("prev_block_hash",  "");
    refundRec.set("content_hash",     contentHash);
    refundRec.set("height",           0);
    refundRec.set("prev_settle_hash", "");
    $app.dao().saveRecord(refundRec);

    rec.set("status", "refunded");
    rec.set("refunded_at", new Date().toISOString());
    $app.dao().saveRecord(rec);

    console.warn("[BRIDGE-REFUND]", tx_hash, "→", buyer_guid, "+" + amount + "T (원 대상:", targetNode, ")");
    return c.json(200, { ok: true, tx_hash, status: "refunded", block_id: refundRec.getId() });
  } catch (e) {
    return c.json(500, { ok: false, error: "BRIDGE_REFUND_FAILED", detail: e.message });
  }
});

routerAdd("GET", "/health", (c) => {
const NODE_CONFIG = {
  "hanlim": { id: "KR-JEJU-JEJU-HANLIM", layer: 1, port: 8091, parentUrl: "http://127.0.0.1:8092" },
  "l1-aewol": { id: "KR-JEJU-JEJU-AEWOL", layer: 1, port: 8101, parentUrl: "http://127.0.0.1:8092" },
  "l1-jocheon": { id: "KR-JEJU-JEJU-JOCHEON", layer: 1, port: 8102, parentUrl: "http://127.0.0.1:8092" },
  "l1-gujwa": { id: "KR-JEJU-JEJU-GUJWA", layer: 1, port: 8103, parentUrl: "http://127.0.0.1:8092" },
  "l1-hangyeong": { id: "KR-JEJU-JEJU-HANGYEONG", layer: 1, port: 8104, parentUrl: "http://127.0.0.1:8092" },
  "l1-chuja": { id: "KR-JEJU-JEJU-CHUJA", layer: 1, port: 8105, parentUrl: "http://127.0.0.1:8092" },
  "l1-udo": { id: "KR-JEJU-JEJU-UDO", layer: 1, port: 8106, parentUrl: "http://127.0.0.1:8092" },
  "l1-ildo1": { id: "KR-JEJU-JEJU-ILDO1", layer: 1, port: 8107, parentUrl: "http://127.0.0.1:8092" },
  "l1-ildo2": { id: "KR-JEJU-JEJU-ILDO2", layer: 1, port: 8108, parentUrl: "http://127.0.0.1:8092" },
  "l1-ido1": { id: "KR-JEJU-JEJU-IDO1", layer: 1, port: 8109, parentUrl: "http://127.0.0.1:8092" },
  "l1-ido2": { id: "KR-JEJU-JEJU-IDO2", layer: 1, port: 8110, parentUrl: "http://127.0.0.1:8092" },
  "l1-samdo1": { id: "KR-JEJU-JEJU-SAMDO1", layer: 1, port: 8111, parentUrl: "http://127.0.0.1:8092" },
  "l1-samdo2": { id: "KR-JEJU-JEJU-SAMDO2", layer: 1, port: 8112, parentUrl: "http://127.0.0.1:8092" },
  "l1-yongdam1": { id: "KR-JEJU-JEJU-YONGDAM1", layer: 1, port: 8113, parentUrl: "http://127.0.0.1:8092" },
  "l1-yongdam2": { id: "KR-JEJU-JEJU-YONGDAM2", layer: 1, port: 8114, parentUrl: "http://127.0.0.1:8092" },
  "l1-geonip": { id: "KR-JEJU-JEJU-GEONIP", layer: 1, port: 8115, parentUrl: "http://127.0.0.1:8092" },
  "l1-hwabuk": { id: "KR-JEJU-JEJU-HWABUK", layer: 1, port: 8116, parentUrl: "http://127.0.0.1:8092" },
  "l1-samyang": { id: "KR-JEJU-JEJU-SAMYANG", layer: 1, port: 8117, parentUrl: "http://127.0.0.1:8092" },
  "l1-bonggae": { id: "KR-JEJU-JEJU-BONGGAE", layer: 1, port: 8118, parentUrl: "http://127.0.0.1:8092" },
  "l1-ara": { id: "KR-JEJU-JEJU-ARA", layer: 1, port: 8119, parentUrl: "http://127.0.0.1:8092" },
  "l1-ora": { id: "KR-JEJU-JEJU-ORA", layer: 1, port: 8120, parentUrl: "http://127.0.0.1:8092" },
  "l1-yeondong": { id: "KR-JEJU-JEJU-YEONDONG", layer: 1, port: 8121, parentUrl: "http://127.0.0.1:8092" },
  "l1-nohyeong": { id: "KR-JEJU-JEJU-NOHYEONG", layer: 1, port: 8122, parentUrl: "http://127.0.0.1:8092" },
  "l1-oedo": { id: "KR-JEJU-JEJU-OEDO", layer: 1, port: 8123, parentUrl: "http://127.0.0.1:8092" },
  "l1-iho": { id: "KR-JEJU-JEJU-IHO", layer: 1, port: 8124, parentUrl: "http://127.0.0.1:8092" },
  "l1-dodu": { id: "KR-JEJU-JEJU-DODU", layer: 1, port: 8125, parentUrl: "http://127.0.0.1:8092" },
  "l1-daejeong": { id: "KR-JEJU-SGP-DAEJEONG", layer: 1, port: 8126, parentUrl: "http://127.0.0.1:8093" },
  "l1-namwon": { id: "KR-JEJU-SGP-NAMWON", layer: 1, port: 8127, parentUrl: "http://127.0.0.1:8093" },
  "l1-seongsan": { id: "KR-JEJU-SGP-SEONGSAN", layer: 1, port: 8128, parentUrl: "http://127.0.0.1:8093" },
  "l1-andeok": { id: "KR-JEJU-SGP-ANDEOK", layer: 1, port: 8129, parentUrl: "http://127.0.0.1:8093" },
  "l1-pyoseon": { id: "KR-JEJU-SGP-PYOSEON", layer: 1, port: 8130, parentUrl: "http://127.0.0.1:8093" },
  "l1-songsan": { id: "KR-JEJU-SGP-SONGSAN", layer: 1, port: 8131, parentUrl: "http://127.0.0.1:8093" },
  "l1-jeongbang": { id: "KR-JEJU-SGP-JEONGBANG", layer: 1, port: 8132, parentUrl: "http://127.0.0.1:8093" },
  "l1-jungang-sgp": { id: "KR-JEJU-SGP-JUNGANG-SGP", layer: 1, port: 8133, parentUrl: "http://127.0.0.1:8093" },
  "l1-cheonji": { id: "KR-JEJU-SGP-CHEONJI", layer: 1, port: 8134, parentUrl: "http://127.0.0.1:8093" },
  "l1-hyodon": { id: "KR-JEJU-SGP-HYODON", layer: 1, port: 8135, parentUrl: "http://127.0.0.1:8093" },
  "l1-yeongcheon": { id: "KR-JEJU-SGP-YEONGCHEON", layer: 1, port: 8136, parentUrl: "http://127.0.0.1:8093" },
  "l1-donghong": { id: "KR-JEJU-SGP-DONGHONG", layer: 1, port: 8137, parentUrl: "http://127.0.0.1:8093" },
  "l1-seohong": { id: "KR-JEJU-SGP-SEOHONG", layer: 1, port: 8138, parentUrl: "http://127.0.0.1:8093" },
  "l1-daeryun": { id: "KR-JEJU-SGP-DAERYUN", layer: 1, port: 8139, parentUrl: "http://127.0.0.1:8093" },
  "l1-daecheon": { id: "KR-JEJU-SGP-DAECHEON", layer: 1, port: 8140, parentUrl: "http://127.0.0.1:8093" },
  "l1-jungmun": { id: "KR-JEJU-SGP-JUNGMUN", layer: 1, port: 8141, parentUrl: "http://127.0.0.1:8093" },
  "l1-yerae": { id: "KR-JEJU-SGP-YERAE", layer: 1, port: 8142, parentUrl: "http://127.0.0.1:8093" },
  "l2-jeju": { id: "KR-JEJU-JEJU-SI", layer: 2, port: 8092, parentUrl: "http://127.0.0.1:8094" },
  "l2-seogwipo": { id: "KR-JEJU-SGP-SI", layer: 2, port: 8093, parentUrl: "http://127.0.0.1:8094" },
  "l3-jejudo": { id: "KR-JEJU", layer: 3, port: 8094, parentUrl: "http://127.0.0.1:8095" },
  "l4-kr": { id: "KR", layer: 4, port: 8095, parentUrl: "http://127.0.0.1:8096" },
  "l5-global": { id: "GLOBAL", layer: 5, port: 8096, parentUrl: null },
};
  const name = $app.dataDir().split("/").pop();
  const self = NODE_CONFIG[name] || NODE_CONFIG["hanlim"];
  return c.json(200, { ok: true, node: self.id, layer: self.layer, type: "real", timestamp: new Date().toISOString() });
});

routerAdd("GET", "/merkle", (c) => {
  let chainLength = 0, recent = [], myRoot = null;
  try {
    const all    = $app.dao().findRecordsByFilter("node_ledger", "1=1", "-created", 0, 0);
    const hashes = all.map(r => r.getString("child_root")).filter(Boolean);
    chainLength  = hashes.length;
    let layer = [...hashes];
    if (layer.length === 0) { myRoot = "GENESIS"; }
    else if (layer.length === 1) { myRoot = layer[0]; }
    else {
      while (layer.length > 1) {
        const next = [];
        for (let i = 0; i < layer.length; i += 2)
          next.push($security.md5(layer[i] + (layer[i+1] || layer[i])));
        layer = next;
      }
      myRoot = layer[0];
    }
    recent = all.slice(0, 10).map(r => ({
      child_node:  r.getString("child_node"),
      child_root:  r.getString("child_root"),
      merkle_root: r.getString("merkle_root"),
      parent_root: r.getString("parent_root"),
      propagated:  r.getBool("propagated"),
      created:     r.getString("created"),
    }));
  } catch {
    try {
      const all    = $app.dao().findRecordsByFilter("l1_ledger", "1=1", "-created", 0, 0);
      const hashes = all.map(r => r.getString("leaf_hash")).filter(Boolean);
      chainLength  = hashes.length;
      let layer = [...hashes];
      if (layer.length === 0) { myRoot = "GENESIS"; }
      else if (layer.length === 1) { myRoot = layer[0]; }
      else {
        while (layer.length > 1) {
          const next = [];
          for (let i = 0; i < layer.length; i += 2)
            next.push($security.md5(layer[i] + (layer[i+1] || layer[i])));
          layer = next;
        }
        myRoot = layer[0];
      }
      recent = all.slice(0, 10).map(r => ({
        tx_id:       r.getString("tx_id"),
        leaf_hash:   r.getString("leaf_hash"),
        parent_root: r.getString("parent_root"),
        created:     r.getString("created"),
      }));
    } catch {}
  }
  return c.json(200, { ok: true, chain_length: chainLength, merkle_root: myRoot, recent, timestamp: new Date().toISOString() });
});

routerAdd("POST", "/tx", (c) => {
  const body = $apis.requestInfo(c).data;
  const { tx_id, leaf_hash, from_guid, tx_type, signature, pubkey } = body;
  if (!tx_id || !leaf_hash) return c.json(400, { ok: false, error: "MISSING_FIELD" });
  let rec;
  try {
    const col = $app.dao().findCollectionByNameOrId("l1_ledger");
    rec = new Record(col);
    rec.set("tx_id",      tx_id);
    rec.set("tx_type",    tx_type   || "TX");
    rec.set("from_guid",  from_guid || "");
    rec.set("leaf_hash",  leaf_hash);
    rec.set("signature",  signature || "");
    rec.set("pubkey",     pubkey    || "");
    rec.set("l1_node",    NODE_ID);
    rec.set("parent_root", "");
    $app.dao().saveRecord(rec);
  } catch(e) {
    return c.json(500, { ok: false, error: "l1_ledger 저장 실패: " + e.message });
  }
  let myRoot = leaf_hash;
  try {
    const all = $app.dao().findRecordsByFilter("l1_ledger", "leaf_hash != ''", "-created", 10000, 0);
    let layer = all.map(r => r.getString("leaf_hash")).filter(Boolean);
    if (layer.length > 1) {
      while (layer.length > 1) {
        const next = [];
        for (let i = 0; i < layer.length; i += 2)
          next.push($security.md5(layer[i] + (layer[i+1] || layer[i])));
        layer = next;
      }
    }
    myRoot = layer[0] || leaf_hash;
  } catch(e) { console.log("[L1] Merkle 실패:", e.message); }
  let parentRoot = null;
  try {
    const resp = $http.send({
      url: "http://127.0.0.1:8092/push_root",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ child_node: NODE_ID, child_root: myRoot }),
    });
    parentRoot = JSON.parse(resp.raw).parent_root || null;
  } catch(e) { console.log("[L1] L2 전파 실패:", e.message); }
  if (parentRoot && rec) {
    try { rec.set("parent_root", parentRoot); $app.dao().saveRecord(rec); } catch(e) {}
  }
  return c.json(200, { ok: true, node: NODE_ID, tx_id, leaf_hash, merkle_root: myRoot, parent_root: parentRoot });
});

routerAdd("POST", "/push_root", (c) => {
  const body = $apis.requestInfo(c).data;
  const { child_node, child_root } = body;
  if (!child_node || !child_root) return c.json(400, { ok: false, error: "MISSING_FIELD" });
const NODE_CONFIG = {
  "hanlim": { id: "KR-JEJU-JEJU-HANLIM", layer: 1, port: 8091, parentUrl: "http://127.0.0.1:8092" },
  "l1-aewol": { id: "KR-JEJU-JEJU-AEWOL", layer: 1, port: 8101, parentUrl: "http://127.0.0.1:8092" },
  "l1-jocheon": { id: "KR-JEJU-JEJU-JOCHEON", layer: 1, port: 8102, parentUrl: "http://127.0.0.1:8092" },
  "l1-gujwa": { id: "KR-JEJU-JEJU-GUJWA", layer: 1, port: 8103, parentUrl: "http://127.0.0.1:8092" },
  "l1-hangyeong": { id: "KR-JEJU-JEJU-HANGYEONG", layer: 1, port: 8104, parentUrl: "http://127.0.0.1:8092" },
  "l1-chuja": { id: "KR-JEJU-JEJU-CHUJA", layer: 1, port: 8105, parentUrl: "http://127.0.0.1:8092" },
  "l1-udo": { id: "KR-JEJU-JEJU-UDO", layer: 1, port: 8106, parentUrl: "http://127.0.0.1:8092" },
  "l1-ildo1": { id: "KR-JEJU-JEJU-ILDO1", layer: 1, port: 8107, parentUrl: "http://127.0.0.1:8092" },
  "l1-ildo2": { id: "KR-JEJU-JEJU-ILDO2", layer: 1, port: 8108, parentUrl: "http://127.0.0.1:8092" },
  "l1-ido1": { id: "KR-JEJU-JEJU-IDO1", layer: 1, port: 8109, parentUrl: "http://127.0.0.1:8092" },
  "l1-ido2": { id: "KR-JEJU-JEJU-IDO2", layer: 1, port: 8110, parentUrl: "http://127.0.0.1:8092" },
  "l1-samdo1": { id: "KR-JEJU-JEJU-SAMDO1", layer: 1, port: 8111, parentUrl: "http://127.0.0.1:8092" },
  "l1-samdo2": { id: "KR-JEJU-JEJU-SAMDO2", layer: 1, port: 8112, parentUrl: "http://127.0.0.1:8092" },
  "l1-yongdam1": { id: "KR-JEJU-JEJU-YONGDAM1", layer: 1, port: 8113, parentUrl: "http://127.0.0.1:8092" },
  "l1-yongdam2": { id: "KR-JEJU-JEJU-YONGDAM2", layer: 1, port: 8114, parentUrl: "http://127.0.0.1:8092" },
  "l1-geonip": { id: "KR-JEJU-JEJU-GEONIP", layer: 1, port: 8115, parentUrl: "http://127.0.0.1:8092" },
  "l1-hwabuk": { id: "KR-JEJU-JEJU-HWABUK", layer: 1, port: 8116, parentUrl: "http://127.0.0.1:8092" },
  "l1-samyang": { id: "KR-JEJU-JEJU-SAMYANG", layer: 1, port: 8117, parentUrl: "http://127.0.0.1:8092" },
  "l1-bonggae": { id: "KR-JEJU-JEJU-BONGGAE", layer: 1, port: 8118, parentUrl: "http://127.0.0.1:8092" },
  "l1-ara": { id: "KR-JEJU-JEJU-ARA", layer: 1, port: 8119, parentUrl: "http://127.0.0.1:8092" },
  "l1-ora": { id: "KR-JEJU-JEJU-ORA", layer: 1, port: 8120, parentUrl: "http://127.0.0.1:8092" },
  "l1-yeondong": { id: "KR-JEJU-JEJU-YEONDONG", layer: 1, port: 8121, parentUrl: "http://127.0.0.1:8092" },
  "l1-nohyeong": { id: "KR-JEJU-JEJU-NOHYEONG", layer: 1, port: 8122, parentUrl: "http://127.0.0.1:8092" },
  "l1-oedo": { id: "KR-JEJU-JEJU-OEDO", layer: 1, port: 8123, parentUrl: "http://127.0.0.1:8092" },
  "l1-iho": { id: "KR-JEJU-JEJU-IHO", layer: 1, port: 8124, parentUrl: "http://127.0.0.1:8092" },
  "l1-dodu": { id: "KR-JEJU-JEJU-DODU", layer: 1, port: 8125, parentUrl: "http://127.0.0.1:8092" },
  "l1-daejeong": { id: "KR-JEJU-SGP-DAEJEONG", layer: 1, port: 8126, parentUrl: "http://127.0.0.1:8093" },
  "l1-namwon": { id: "KR-JEJU-SGP-NAMWON", layer: 1, port: 8127, parentUrl: "http://127.0.0.1:8093" },
  "l1-seongsan": { id: "KR-JEJU-SGP-SEONGSAN", layer: 1, port: 8128, parentUrl: "http://127.0.0.1:8093" },
  "l1-andeok": { id: "KR-JEJU-SGP-ANDEOK", layer: 1, port: 8129, parentUrl: "http://127.0.0.1:8093" },
  "l1-pyoseon": { id: "KR-JEJU-SGP-PYOSEON", layer: 1, port: 8130, parentUrl: "http://127.0.0.1:8093" },
  "l1-songsan": { id: "KR-JEJU-SGP-SONGSAN", layer: 1, port: 8131, parentUrl: "http://127.0.0.1:8093" },
  "l1-jeongbang": { id: "KR-JEJU-SGP-JEONGBANG", layer: 1, port: 8132, parentUrl: "http://127.0.0.1:8093" },
  "l1-jungang-sgp": { id: "KR-JEJU-SGP-JUNGANG-SGP", layer: 1, port: 8133, parentUrl: "http://127.0.0.1:8093" },
  "l1-cheonji": { id: "KR-JEJU-SGP-CHEONJI", layer: 1, port: 8134, parentUrl: "http://127.0.0.1:8093" },
  "l1-hyodon": { id: "KR-JEJU-SGP-HYODON", layer: 1, port: 8135, parentUrl: "http://127.0.0.1:8093" },
  "l1-yeongcheon": { id: "KR-JEJU-SGP-YEONGCHEON", layer: 1, port: 8136, parentUrl: "http://127.0.0.1:8093" },
  "l1-donghong": { id: "KR-JEJU-SGP-DONGHONG", layer: 1, port: 8137, parentUrl: "http://127.0.0.1:8093" },
  "l1-seohong": { id: "KR-JEJU-SGP-SEOHONG", layer: 1, port: 8138, parentUrl: "http://127.0.0.1:8093" },
  "l1-daeryun": { id: "KR-JEJU-SGP-DAERYUN", layer: 1, port: 8139, parentUrl: "http://127.0.0.1:8093" },
  "l1-daecheon": { id: "KR-JEJU-SGP-DAECHEON", layer: 1, port: 8140, parentUrl: "http://127.0.0.1:8093" },
  "l1-jungmun": { id: "KR-JEJU-SGP-JUNGMUN", layer: 1, port: 8141, parentUrl: "http://127.0.0.1:8093" },
  "l1-yerae": { id: "KR-JEJU-SGP-YERAE", layer: 1, port: 8142, parentUrl: "http://127.0.0.1:8093" },
  "l2-jeju": { id: "KR-JEJU-JEJU-SI", layer: 2, port: 8092, parentUrl: "http://127.0.0.1:8094" },
  "l2-seogwipo": { id: "KR-JEJU-SGP-SI", layer: 2, port: 8093, parentUrl: "http://127.0.0.1:8094" },
  "l3-jejudo": { id: "KR-JEJU", layer: 3, port: 8094, parentUrl: "http://127.0.0.1:8095" },
  "l4-kr": { id: "KR", layer: 4, port: 8095, parentUrl: "http://127.0.0.1:8096" },
  "l5-global": { id: "GLOBAL", layer: 5, port: 8096, parentUrl: null },
};
  const name = $app.dataDir().split("/").pop();
  const self = NODE_CONFIG[name] || NODE_CONFIG["hanlim"];
  let rec;
  try {
    const col = $app.dao().findCollectionByNameOrId("node_ledger");
    try { rec = $app.dao().findFirstRecordByFilter("node_ledger", "child_node = '" + child_node + "'"); }
    catch { rec = new Record(col); }
    rec.set("child_node",  child_node);
    rec.set("child_root",  child_root);
    rec.set("layer",       self.layer);
    rec.set("propagated",  false);
    rec.set("parent_root", "");
    $app.dao().saveRecord(rec);
  } catch(e) {
    return c.json(500, { ok: false, error: "저장 실패: " + e.message });
  }
  let myRoot = child_root;
  try {
    const all = $app.dao().findRecordsByFilter("node_ledger", "1=1", "-created", 0, 0);
    let layer = all.map(r => r.getString("child_root")).filter(Boolean);
    if (layer.length > 1) {
      while (layer.length > 1) {
        const next = [];
        for (let i = 0; i < layer.length; i += 2)
          next.push($security.md5(layer[i] + (layer[i+1] || layer[i])));
        layer = next;
      }
    }
    myRoot = layer[0] || child_root;
  } catch(e) { console.log("[" + self.id + "] Merkle 실패:", e.message); }
  let parentRoot = null;
  if (self.parentUrl) {
    try {
      const resp = $http.send({
        url: self.parentUrl + "/push_root",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ child_node: self.id, child_root: myRoot }),
      });
      parentRoot = JSON.parse(resp.raw).parent_root || null;
    } catch(e) { console.log("[" + self.id + "] 상위 전파 실패:", e.message); }
  } else {
    parentRoot = myRoot;
  }
  try {
    rec.set("merkle_root", myRoot);
    rec.set("parent_root", parentRoot || "");
    rec.set("propagated",  true);
    $app.dao().saveRecord(rec);
  } catch(e) {}
  return c.json(200, { ok: true, node: self.id, child_node, merkle_root: myRoot, parent_root: parentRoot });
});
