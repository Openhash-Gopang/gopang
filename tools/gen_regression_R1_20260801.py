#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scenarios_regression_R1_20260801.json 생성기

목적: scenarios_batch2_20260801.json 라이브 300건 중 진짜 FAIL 39건
(하네스 인식 한계로 인한 오탐 15건 제외)만 뽑아, 그새 적용된 두 패치의
효과를 재검증한다.
  1. AC-PRO-CORE_v1_0.txt §CORE 2단계 R1 tie-break 규칙 신설(PR #160/163) —
     GWP↔EXPERT 경계 23건(59%)이 여기 해당.
  2. kbank 철회 + kgdc 은행 어휘 보강(PR #164) — kbank/kgdc 관련 라우팅.

교정 사항(원본 batch2 대비):
  - no=47: expected_id를 'kbank'(철회됨)에서 'kgdc'로 정정.
  - no=49/50/284(ktelecom), no=125/131/181/268/281(kestate): 이 두 서비스는
    여전히 gwp-registry.js status:'active' vs AC-PRO-CORE '미구현' 불일치가
    미해결 상태다(2026-08-01 발견, 이번 패치 범위 밖) — AC-PRO-CORE 지시대로
    "태그 없이 텍스트 안내만"이 현재로선 정답이므로, expected를
    PLATFORM/direct-response로 정정해 무라우팅 시 PASS로 채점되게 한다.
    (라우팅 자체를 다시 원하시면 그건 별도의 ktelecom/kestate 재설계
    패치가 먼저 필요하다 — batch2 인수인계 노트 참고.)
"""
import json

SOURCE = "tests/live_smoketest/scenarios_batch2_20260801.json"
OUT = "tests/live_smoketest/scenarios_regression_R1_20260801.json"

TARGET_NOS = [
    7, 8, 10, 16, 24, 28, 29, 34, 36, 47, 49, 50, 70, 75, 88,
    116, 119, 124, 125, 129, 131, 132, 145, 149, 152, 169, 174,
    176, 178, 179, 181, 182, 265, 268, 270, 271, 281, 284, 291,
]

# no -> (신규 expected_type, 신규 expected_id, 신규 expected_name, 정정 사유)
OVERRIDES = {
    47: ("GWP", "kgdc", "GDC",
         "2026-08-01 kbank 철회(PR#164) — kbank는 더 이상 존재하지 않고 "
         "kgdc가 은행 기능을 흡수했다. kgdc triggers에 '대출'·'상환' 등이 "
         "추가됐으므로 이제 kgdc로 라우팅되는 게 정답."),
    49: ("PLATFORM", "direct-response", "라우팅 불필요(ktelecom 여전히 실질 미구현)",
         "2026-08-01 발견 — ktelecom은 gwp-registry.js status:'active'인데 "
         "AC-PRO-CORE는 '미구현, 태그 내지 말고 텍스트로만 안내'라고 명시. "
         "이 불일치는 아직 안 고쳤으므로 무라우팅(텍스트 안내)이 현재 정답."),
    50: ("PLATFORM", "direct-response", "라우팅 불필요(ktelecom 여전히 실질 미구현)",
         "위 no=49와 동일 사유."),
    284: ("PLATFORM", "direct-response", "라우팅 불필요(ktelecom 여전히 실질 미구현)",
          "위 no=49와 동일 사유."),
    125: ("EXPERT", "appraiser", "감정평가사",
          "2026-08-01 발견 — kestate도 ktelecom과 동일한 미해결 불일치 상태. "
          "다만 이 케이스는 원래도 R1(GWP↔EXPERT) 축 문제였다 — kestate가 "
          "막혀있으므로 appraiser(EXPERT)로 가는 게 유일한 정답 경로가 됨, "
          "R1 패치 검증 목적상 EXPERT 기대값은 유지."),
    131: ("EXPERT", "patent-attorney", "변리사",
          "R1(GWP↔EXPERT) 축 문제 — klaw가 아니라 patent-attorney로 가야 "
          "하는 게 원래 쟁점이었다(kestate 불일치와 무관). 기대값 유지."),
    181: ("EXPERT", "real-estate-agent", "공인중개사",
          "kestate가 막혀있어 EXPERT(real-estate-agent)가 유일한 정답 경로 — "
          "R1 축 검증 목적상 기대값 유지."),
    268: ("EXPERT", "architect", "건축사",
          "kestate와 무관한 순수 R1(GWP↔EXPERT) 축 문제(엉뚱하게 kcommerce로 "
          "샜던 사례) — 기대값 유지."),
    281: ("PLATFORM", "direct-response", "라우팅 불필요(kestate 여전히 실질 미구현)",
          "no=281은 원래 kestate GWP 자체를 기대했던 케이스라(EXPERT 위임 "
          "의도 없음) ktelecom과 동일하게 무라우팅 텍스트 안내가 현재 정답. "
          "klaw로 간 것도 대안으로는 합리적이나, 채점 기준은 '태그 없음'으로 "
          "통일한다."),
}

with open(SOURCE, encoding="utf-8") as f:
    all_rows = json.load(f)
by_no = {r["no"]: r for r in all_rows}

rows = []
for i, no in enumerate(TARGET_NOS, start=1):
    src = by_no[no]
    row = dict(src)
    row["no"] = i
    row["source_batch2_no"] = no
    if no in OVERRIDES:
        etype, eid, ename, reason = OVERRIDES[no]
        row["expected_type"] = etype
        row["expected_id"] = eid
        row["expected_name"] = ename
        row["category"] = "회귀(R1 패치 재검증 — 기대값 정정: " + reason[:40] + "...)"
        row["static_verdict"] = "N/A"
        row["basis"] = reason
    else:
        row["category"] = "회귀(R1 패치 재검증 — 원본 batch2 기대값 유지)"
    rows.append(row)

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(rows, f, ensure_ascii=False, indent=2)

print(f"wrote {len(rows)} rows to {OUT}")
from collections import Counter
c = Counter(r["expected_type"] for r in rows)
print(c)
