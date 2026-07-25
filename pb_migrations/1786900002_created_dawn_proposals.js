/// <reference path="../pb_data/types.d.ts" />
// 2026-07-26 신설 — DAWN(Democracy is All We Need) 안건 공중 게시판.
//
// 배경: democracy 저장소 desktop.html의 "안건 제안" 기능이 지금까지
// PDV.writePropose()로 제안자 본인의 PDV(개인 암호화 저장소)에만 기록되고
// 있었다 — 다른 사용자에게 보이지 않고, 동의(endorsement)도 집계되지
// 않는데 UI는 "안건이 게재됐습니다"라고 안내해 실제 상태와 다른 인상을
// 줬다(주피터님 지시로 발견·시정: "사용자의 안건이 공중(public bulletin)에
// 실제로 게재되고, 일정한 동의 숫자를 획득하면, 정식 안건으로 회부되어,
// 투표에 의해 결정되는 과정을 구현"). 이 컬렉션이 그 공중 게시판 저장소다.
//
// 스코프 축소 고지: 백서(kdemocracy_whitepaper.html)와
// ai_democracy_system_prompts.md의 SP-01~08 파이프라인(AI 배심원 무작위
// 선발·찬반 논거 상호차단 작성·Claude Opus 교차검증·인간 위원단 브리핑)은
// 이번 구현 범위에 포함하지 않는다 — 이번 구현은 "게시 → 동의 임계치 →
// 정식 회부(투표 개시) → 투표 → 가결/부결"까지의 골격만 만든다. 또한
// 투표권 가중치(GDC 사용량·코드 공헌·K-Law 준법 수준 등 AI 산정 최대
// 1,000표)도 이번 범위 밖이다 — weight 필드는 스키마상 존재하지만 현재
// 코드에서는 1인 1가중치(=1)로 고정 기록한다(추후 별도 설계·구현 필요).
//
// 개인정보: 원문 guid는 저장하지 않는다. instance_enrichment_drafts와
// 동일한 패턴(도메인 분리 salt + SHA-256)으로 해싱한 author_guid_hash만
// 남긴다(U5 개인정보 최소화 원칙).
migrate((db) => {
  const collection = new Collection({
    "id": "dwn001propsl01",
    "created": "2026-07-26 00:00:00.000Z",
    "updated": "2026-07-26 00:00:00.000Z",
    "name": "dawn_proposals",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false, "id": "dwn101title", "name": "title",
        "type": "text", "required": true, "presentable": true, "unique": false,
        "options": { "min": 1, "max": 200, "pattern": "" }
      },
      {
        "system": false, "id": "dwn102category", "name": "category",
        "type": "text", "required": false, "presentable": true, "unique": false,
        "options": { "min": null, "max": 100, "pattern": "" }
      },
      {
        "system": false, "id": "dwn103background", "name": "background",
        "type": "text", "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": 5000, "pattern": "" }
      },
      {
        "system": false, "id": "dwn104summary", "name": "summary",
        "type": "text", "required": false, "presentable": true, "unique": false,
        "options": { "min": null, "max": 1000, "pattern": "" }
      },
      {
        "system": false, "id": "dwn105authorhash", "name": "author_guid_hash",
        "type": "text", "required": false, "presentable": false, "unique": false,
        "options": { "min": null, "max": 64, "pattern": "" }
      },
      {
        // pending_endorsement: 동의 수집 중 (아직 1,000표 미달)
        // voting: 동의 임계치 달성, 정식 회부되어 투표 진행 중
        // passed / rejected: 투표 마감, 가결/부결
        // withdrawn: 제안자 철회(현재 미구현, 스키마만 예약)
        "system": false, "id": "dwn106status", "name": "status",
        "type": "select", "required": true, "presentable": true, "unique": false,
        "options": { "maxSelect": 1, "values": ["pending_endorsement", "voting", "passed", "rejected", "withdrawn"] }
      },
      {
        "system": false, "id": "dwn107endorsew", "name": "endorsement_weight_total",
        "type": "number", "required": true, "presentable": true, "unique": false,
        "options": { "min": 0, "max": null }
      },
      {
        "system": false, "id": "dwn108threshold", "name": "endorsement_threshold",
        "type": "number", "required": true, "presentable": true, "unique": false,
        "options": { "min": 1, "max": null }
        // 기본값 1,000(desktop.html·백서에 이미 노출된 수치). 레코드별로
        // 값을 다르게 둘 수 있게 컬럼으로 뒀다(추후 카테고리별 임계치
        // 차등 등 조정 가능하도록 — 지금은 항상 1000으로 생성).
      },
      {
        "system": false, "id": "dwn109voteforw", "name": "vote_for_weight",
        "type": "number", "required": true, "presentable": true, "unique": false,
        "options": { "min": 0, "max": null }
      },
      {
        "system": false, "id": "dwn110voteagstw", "name": "vote_against_weight",
        "type": "number", "required": true, "presentable": true, "unique": false,
        "options": { "min": 0, "max": null }
      },
      {
        "system": false, "id": "dwn111voteopen", "name": "vote_opened_at",
        "type": "date", "required": false, "presentable": true, "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false, "id": "dwn112voteclose", "name": "vote_closes_at",
        "type": "date", "required": false, "presentable": true, "unique": false,
        "options": { "min": "", "max": "" }
        // 2026-07-26: 투표 기간은 임의로 7일 기본값을 잡았다(어디에도
        // 명시된 수치가 없어 worker.js에서 상수로 관리 — 조정하려면
        // DAWN_VOTE_WINDOW_MS 상수만 바꾸면 됨). 주피터님 확인 필요.
      },
      {
        "system": false, "id": "dwn113decidedat", "name": "decided_at",
        "type": "date", "required": false, "presentable": true, "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false, "id": "dwn114createdat", "name": "created_at",
        "type": "date", "required": true, "presentable": true, "unique": false,
        "options": { "min": "", "max": "" }
      }
    ],
    "indexes": [
      "CREATE INDEX idx_dwn_proposals_status ON dawn_proposals (status)",
      "CREATE INDEX idx_dwn_proposals_created ON dawn_proposals (created_at)"
    ],
    // instance_enrichment_drafts와 동일한 fail-safe 원칙 — 클라이언트는
    // PocketBase를 직접 두드리지 않는다. worker.js(/democracy/*)가 서비스
    // 계정으로만 읽고 쓴다.
    "listRule": null,
    "viewRule": null,
    "createRule": null,
    "updateRule": null,
    "deleteRule": null
  });

  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("dawn_proposals");
  return dao.deleteCollection(collection);
});
