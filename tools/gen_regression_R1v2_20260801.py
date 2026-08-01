#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scenarios_regression_R1v2_20260801.json 생성기

목적: 두 가지를 한 번에 검증한다.
  (A) 확신도 기반 되묻기 패치가 기존 39건 FAIL을 얼마나 더 고쳤는가
      — scenarios_regression_R1_20260801.json의 39건을 그대로 재사용.
  (B) 그 패치가 원래 잘 맞히던 케이스까지 불필요하게 되묻는 쪽으로
      과잉반응하지 않는가(회귀 감시) — scenarios_batch2_20260801.json
      라이브 실행(2026-08-01)에서 LIVE-PASS였던 194건 중, 새 규칙이
      건드리는 위험군(범용↔세부 자격직 축에 걸리는 lawyer/physician/
      dentist/teacher/professor, GWP↔EXPERT 경계에 걸리는 klaw/khealth/
      kedu/kgdc/kfinance/kbusiness/kgov 및 그 인접 EXPERT들) 34건 전부 +
      그 외 무작위 8건(GWP/EXPERT/PLATFORM 골고루)을 섞어 "여전히 PASS인가"
      를 감시한다. 이 42건이 CLARIFY로 밀리면 과잉반응 신호다.

파일 구성: no 1~39는 (A), no 40~81은 (B, "회귀감시" 카테고리).
"""
import json
import random

REG_R1_SOURCE = "tests/live_smoketest/scenarios_regression_R1_20260801.json"
BATCH2_SOURCE = "tests/live_smoketest/scenarios_batch2_20260801.json"
OUT = "tests/live_smoketest/scenarios_regression_R1v2_20260801.json"

# no=47(batch2)이 원래 kbank 기대값으로 LIVE-PASS 기록에 안 잡혀 있을 수
# 있으므로(당시엔 kbank가 살아있었음) 이 스크립트는 batch2 결과 파일이
# 아니라 "이번에 다시 뽑아써야 할 PASS 후보 34건"을 하드코딩된 no 목록으로
# 받는다 — 실행 환경에 옛 live_results.json이 없을 수 있어 재현성을 위해
# 목록 자체를 코드에 박아둔다(2026-08-01 batch2 1회차 라이브 결과 기준).
RISK_PASS_NOS = [
    6, 9, 19, 20, 21, 22, 27, 30, 32, 33, 35, 37, 38, 77, 79, 85, 86,
    120, 123, 126, 128, 130, 138, 139, 168, 190, 191, 267, 269, 275,
    276, 278, 280, 294,
]
CONTROL_OTHER_NOS = [18, 93, 134, 167, 173, 218, 253, 263]

with open(REG_R1_SOURCE, encoding="utf-8") as f:
    reg_rows = json.load(f)

with open(BATCH2_SOURCE, encoding="utf-8") as f:
    batch2_rows = json.load(f)
b2_by_no = {r["no"]: r for r in batch2_rows}

rows = []
for r in reg_rows:
    row = dict(r)
    rows.append(row)

idx = len(rows)
seen_utterances = {r["utterance"] for r in rows}
control_candidates = RISK_PASS_NOS + CONTROL_OTHER_NOS
added = 0
for no in control_candidates:
    src = b2_by_no.get(no)
    if not src:
        continue
    if src["utterance"] in seen_utterances:
        continue
    idx += 1
    row = dict(src)
    row["no"] = idx
    row["source_batch2_no"] = no
    row["category"] = "회귀감시(원래 PASS — 되묻기 과잉반응 여부 확인)"
    rows.append(row)
    seen_utterances.add(src["utterance"])
    added += 1

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(rows, f, ensure_ascii=False, indent=2)

print(f"wrote {len(rows)} rows ({len(reg_rows)} regression + {added} control) to {OUT}")
