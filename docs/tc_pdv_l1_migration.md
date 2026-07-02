# T-C: PDV → L1 직접 이관 설계서
**작성** 2026-06-23 | 탈중앙화 이관 계획서 v2 Phase T-C 선행 작업

## 1. L1 PocketBase 신설 컬렉션: `pdv_records`

PocketBase Admin UI (https://l1-hanlim.hondi.net/_/) 에서 생성:

```
Collection name: pdv_records
Type: Base

Fields:
  guid          Text   (required)  — 사용자 guid (who.ipv6)
  report_id     Text   (required, unique) — session_id + reporter_svc 조합
  reporter_svc  Text   (required)
  svc           Text   (required)
  type          Text   (required)  — p2p_conversation, session_end, register ...
  summary       Text   
  summary_6w    JSON   — {who,when,where,what,how,why}
  block_hash    Text   — OpenHash entryHash
  risk_level    Text   (default: "low")
  source        Text
  openhash_anchored  Bool (default: false)
  created_at    Date   (auto)
```

## 2. 중복 방지 Rule (PocketBase Collection Rules)

Create Rule:
```
@request.auth.id != "" || @collection.pdv_records.count(@request.body.report_id ?= report_id) = 0
```

단순화 (인증 없는 단말 직접 호출 허용):
```javascript
// Before Create Hook (JavaScript)
onRecordBeforeCreate('pdv_records', (e) => {
  const reportId = e.record.get('report_id')
  if (reportId) {
    const existing = $app.dao().findFirstRecordByData('pdv_records', 'report_id', reportId)
    if (existing) {
      throw new BadRequestError('DUPLICATE_SESSION')
    }
  }
})
```

## 3. 단말 직접 호출 형식 (Worker /pdv/report 대체)

```javascript
// 이전 (Worker 경유)
await fetch(`${PROXY}/pdv/report`, {
  method: 'POST',
  body: JSON.stringify({ report: { svc, type, session_id, ... } })
})

// 이후 (L1 직접)
const L1_PDV = 'https://l1-hanlim.hondi.net/api/collections/pdv_records/records'
await fetch(L1_PDV, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    guid:         report.who?.ipv6,
    report_id:    `${report.session_id}:${report.reporter_svc}`,
    reporter_svc: report.reporter_svc,
    svc:          report.svc,
    type:         report.type,
    summary:      report.what?.summary,
    summary_6w:   JSON.stringify({ who, when, where, what, how, why }),
    block_hash:   report.block_hash,
    risk_level:   'low',
    source:       report.svc,
    openhash_anchored: !!report.block_hash,
  })
})
```

## 4. 앵커링 After Save Hook

OpenHash anchor.yml이 repository_dispatch를 받는 구조 → PocketBase After Save Hook으로 이전:

```javascript
// After Save Hook (L1 PocketBase)
onRecordAfterCreate('pdv_records', async (e) => {
  const blockHash = e.record.get('block_hash')
  if (!blockHash) return  // 앵커링 불필요
  
  // anchor_records에 자동 기록 (T-C OpenHash 직접 앵커링)
  await $app.dao().saveRecord($app.dao().newRecord(
    $app.dao().findCollectionByNameOrId('anchor_records'),
    {
      entry_hash:   blockHash,
      content_hash: e.record.get('report_id'),
      msg_id:       e.record.get('report_id'),
      source:       'pdv_records',
      created_at:   new Date().toISOString(),
    }
  ))
})
```

## 5. 이관 순서

1. L1 Admin에서 `pdv_records` 컬렉션 생성
2. Before Create Hook 등록 (중복 방지)
3. `anchor_records` 컬렉션 생성 (없는 경우)
4. After Save Hook 등록 (자동 앵커링)
5. 코드 이관: p2p-chat.js, auth.js, session.js의 /pdv/report → L1 직접
6. 병렬 운영: 30일간 Worker + L1 동시 기록 → L1 안정화 확인 후 Worker 제거

## 6. 필요 작업 시간

L1 Admin UI 작업: ~30분
Hook 설정: ~1시간
코드 이관: ~1시간 (패턴이 반복적)
