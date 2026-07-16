#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
civil-petitions-raw.json(10,966건)의 target/eligibility/content 필드에서
eligibility_gate(v2 스키마, docs/BENEFIT-CATALOG-ELIGIBILITY-SCHEMA_v2_2026-07-16.md
참조)를 Anthropic Message Batches API로 추출한다.

★ 이 스크립트는 사용자 본인의 Anthropic API 키로 직접 실행해야 한다.
   이번 세션의 컨테이너에는 ANTHROPIC_API_KEY가 없어 여기서는 실행할 수
   없었다 — 설계·검증만 마친 상태다.

사전 준비:
    pip install anthropic
    export ANTHROPIC_API_KEY=sk-ant-...

사용법:
    # 1단계 — 배치 제출 (10,966건 전부 한 번에, Batch API 상한 100,000건 이내)
    python tools/batch_extract_eligibility.py submit

    # 2단계 — 상태 확인 (배치 처리는 보통 수 분~수 시간 소요, 최대 24시간)
    python tools/batch_extract_eligibility.py status --batch-id msgbatch_xxx

    # 3단계 — 결과 다운로드 및 파싱 (완료 후)
    python tools/batch_extract_eligibility.py fetch --batch-id msgbatch_xxx

    # 4단계 — 실패건 재시도 (max_tokens 부족으로 잘린 케이스, 더 큰 max_tokens로)
    python tools/batch_extract_eligibility.py retry
    python tools/batch_extract_eligibility.py status --batch-id msgbatch_yyy
    python tools/batch_extract_eligibility.py fetch --batch-id msgbatch_yyy --out-suffix _retry

    # 5단계 — 원본 성공분 + 재시도 성공분 병합
    python tools/batch_extract_eligibility.py merge

비용 참고: Batch API는 표준 대비 50% 할인. 이 작업은 입력이 레코드당
대략 500~1500 토큰(target+eligibility+content), 출력은 200~500 토큰
수준이라 10,966건이어도 총 토큰 규모는 크지 않다 — 정확한 금액은
실행 시점 모델 가격표로 사용자가 직접 확인할 것(이 스크립트가 비용을
보증하지 않음).
"""

import json
import sys
import time
import argparse

RAW_PATH = "tools/civil-petitions-raw.json"
OUT_DIR = "tools/batch_output"
MODEL = "claude-sonnet-4-6"  # 대량 구조화 추출이라 haiku급으로 낮춰도 무방 —
                              # 정확도 우선이면 sonnet 유지, 비용 우선이면
                              # 모델명을 실행 시점 최신 haiku로 교체할 것.
MAX_TOKENS_DEFAULT = 800
MAX_TOKENS_RETRY = 2500  # ★ 1차 배치(800)에서 656건이 중간에 잘려 파싱
                          # 실패 — 조건이 5~8개+긴 설명인 레코드는 800으로
                          # 부족함을 확인(2026-07-16 실사). 재시도는 넉넉히.

SYSTEM_PROMPT = """당신은 한국 정부 공공서비스 혜택 데이터를 구조화하는 추출기입니다.
주어진 target(지원대상)·eligibility(신청자격)·content(지원내용) 원문에서
아래 JSON 스키마에 맞춰 eligibility_gate를 추출하세요.

스키마:
{
  "universal": bool,
  "selection_method": "eligibility_only" | "priority_ranked" | "first_come_first_served" | "unknown",
  "conditions": [
    {
      "type": "age" | "income" | "residency_status" | "category_membership" | "diagnosis" | "legal_basis" | "household_composition" | "other",
      "description": "사람이 읽는 한국어 요약",
      "branches": [{"branch_key": "...", "value": "..."}] 또는 null,
      "confidence": "high" | "medium" | "low"
    }
  ],
  "excludes": [{"description": "...", "confidence": "high"|"medium"|"low"}],
  "raw_reference": "법조문/규정 번호가 명시된 경우만, 없으면 null"
}

규칙:
1. eligibility 필드가 "지원대상과 동일" 류이면 target 필드 내용을 조건으로 사용하세요.
2. "우선순위"·"선정기준"·"심사"라는 표현이 있으면 selection_method를 priority_ranked로,
   "선착순"이면 first_come_first_served로 표시하세요. 둘 다 없고 조건만 충족하면
   되는 것으로 읽히면 eligibility_only로 하세요.
3. "누구나 지원 가능"처럼 실질적 제약이 없으면 universal:true, conditions는 빈 배열로.
4. 원문에 없는 수치·기준을 추정해서 만들어내지 마세요. 애매하면 confidence를
   low로 두고 description에 원문 표현을 최대한 그대로 반영하세요.
5. 가구유형·연령대별로 기준이 갈리는 경우 branches를 사용하세요. 단일 조건에는
   branches를 쓰지 마세요(null로 둠).
6. 반드시 위 스키마와 정확히 일치하는 JSON 객체 하나만 출력하세요. 다른 텍스트,
   설명, 마크다운 코드펜스를 포함하지 마세요.
"""


def build_user_prompt(record: dict) -> str:
    return (
        f"petition_name: {record.get('petition_name', '')}\n"
        f"target: {record.get('target') or '(없음)'}\n"
        f"eligibility: {record.get('eligibility') or '(없음)'}\n"
        f"content: {record.get('content') or '(없음)'}\n"
    )


def cmd_submit(args):
    import anthropic

    client = anthropic.Anthropic()
    with open(RAW_PATH, encoding="utf-8") as f:
        data = json.load(f)

    requests = []
    for r in data:
        requests.append({
            "custom_id": r["petition_id"],
            "params": {
                "model": MODEL,
                "max_tokens": MAX_TOKENS_DEFAULT,
                "system": SYSTEM_PROMPT,
                "messages": [
                    {"role": "user", "content": build_user_prompt(r)},
                ],
            },
        })

    print(f"총 {len(requests)}건 요청 준비 완료. 배치 제출 중...")

    # Anthropic Message Batches API는 한 배치당 최대 100,000건 /
    # 256MB까지 지원하므로 10,966건은 단일 배치로 충분하다.
    batch = client.messages.batches.create(requests=requests)
    print(f"배치 제출 완료: id={batch.id}, status={batch.processing_status}")
    print(f"상태 확인: python3 {sys.argv[0]} status --batch-id {batch.id}")

    with open("tools/batch_last_id.txt", "w") as f:
        f.write(batch.id)


def cmd_status(args):
    import anthropic

    client = anthropic.Anthropic()
    batch = client.messages.batches.retrieve(args.batch_id)
    print(f"status: {batch.processing_status}")
    print(f"request_counts: {batch.request_counts}")
    if batch.processing_status == "ended":
        print(f"완료됨 — 다음 명령으로 결과를 받으세요:")
        print(f"  python {sys.argv[0]} fetch --batch-id {args.batch_id}")
    else:
        print("아직 처리 중입니다 — 잠시 후 이 명령을 다시 실행해 확인하세요"
              "(fetch는 status가 ended가 된 뒤에만 가능합니다).")


def cmd_fetch(args):
    import anthropic
    import os

    client = anthropic.Anthropic()

    # ★ 2026-07-16 — 배치가 아직 in_progress일 때 fetch를 실행하면 SDK가
    # 날것 AnthropicError traceback을 던져 원인을 알기 어려웠다. status를
    # 먼저 확인해 안내 메시지로 명확히 전달.
    batch = client.messages.batches.retrieve(args.batch_id)
    if batch.processing_status != "ended":
        print(f"아직 처리가 끝나지 않았습니다 (status: {batch.processing_status}).")
        print(f"request_counts: {batch.request_counts}")
        print(f"완료된 뒤 다시 시도하세요: python {sys.argv[0]} status --batch-id {args.batch_id}")
        return

    os.makedirs(OUT_DIR, exist_ok=True)
    suffix = args.out_suffix or ""

    results = {}
    errors = {}
    n_ok, n_err = 0, 0
    for entry in client.messages.batches.results(args.batch_id):
        cid = entry.custom_id
        if entry.result.type == "succeeded":
            text = entry.result.message.content[0].text
            try:
                parsed = json.loads(text)
                results[cid] = parsed
                n_ok += 1
            except json.JSONDecodeError:
                # ★ 2026-07-16 실사 — 대부분 max_tokens 부족으로 응답이
                # 중간에 잘려서 발생(마크다운 코드펜스 문제가 아니었음).
                # stop_reason을 같이 남겨 원인 재확인을 쉽게 한다.
                stop_reason = getattr(entry.result.message, "stop_reason", None)
                errors[cid] = {
                    "reason": "json_parse_failed",
                    "stop_reason": stop_reason,
                    "raw": text,
                }
                n_err += 1
        else:
            errors[cid] = {"reason": entry.result.type, "detail": str(entry.result)}
            n_err += 1

    with open(f"{OUT_DIR}/eligibility_gates{suffix}.json", "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    with open(f"{OUT_DIR}/eligibility_gates_errors{suffix}.json", "w", encoding="utf-8") as f:
        json.dump(errors, f, ensure_ascii=False, indent=2)

    print(f"성공: {n_ok}건 -> {OUT_DIR}/eligibility_gates{suffix}.json")
    print(f"실패: {n_err}건 -> {OUT_DIR}/eligibility_gates_errors{suffix}.json (사람 검토 필요)")
    if not suffix:
        print("\n실패건이 있으면: python", sys.argv[0], "retry")


def cmd_retry(args):
    """1차 배치에서 json_parse_failed(대부분 max_tokens 부족으로 잘린 케이스)
    로 떨어진 건만 더 큰 max_tokens로 재시도 배치를 제출한다."""
    import anthropic

    err_path = f"{OUT_DIR}/eligibility_gates_errors.json"
    with open(err_path, encoding="utf-8") as f:
        errors = json.load(f)

    retry_ids = [
        cid for cid, e in errors.items()
        if e.get("reason") in ("json_parse_failed", "errored")
    ]
    print(f"재시도 대상: {len(retry_ids)}건 (max_tokens={MAX_TOKENS_RETRY})")
    if not retry_ids:
        print("재시도할 게 없습니다.")
        return

    with open(RAW_PATH, encoding="utf-8") as f:
        raw = json.load(f)
    raw_by_id = {r["petition_id"]: r for r in raw}

    client = anthropic.Anthropic()
    requests = []
    missing = []
    for cid in retry_ids:
        r = raw_by_id.get(cid)
        if r is None:
            missing.append(cid)
            continue
        requests.append({
            "custom_id": cid,
            "params": {
                "model": MODEL,
                "max_tokens": MAX_TOKENS_RETRY,
                "system": SYSTEM_PROMPT,
                "messages": [{"role": "user", "content": build_user_prompt(r)}],
            },
        })
    if missing:
        print(f"경고: 원본에서 못 찾은 petition_id {len(missing)}건 (건너뜀): {missing[:5]}...")

    batch = client.messages.batches.create(requests=requests)
    print(f"재시도 배치 제출 완료: id={batch.id}, status={batch.processing_status}, 건수={len(requests)}")
    print(f"상태 확인: python {sys.argv[0]} status --batch-id {batch.id}")
    print(f"완료 후: python {sys.argv[0]} fetch --batch-id {batch.id} --out-suffix _retry")
    with open("tools/batch_retry_id.txt", "w") as f:
        f.write(batch.id)


def cmd_merge(args):
    """원본 성공분(eligibility_gates.json) + 재시도 성공분
    (eligibility_gates_retry.json)을 하나로 합친다. 재시도 결과가
    원본의 동일 custom_id를 덮어쓴다(재시도가 더 신뢰도 높음)."""
    base_path = f"{OUT_DIR}/eligibility_gates.json"
    retry_path = f"{OUT_DIR}/eligibility_gates_retry.json"

    with open(base_path, encoding="utf-8") as f:
        base = json.load(f)
    print(f"원본 성공분: {len(base)}건")

    try:
        with open(retry_path, encoding="utf-8") as f:
            retry = json.load(f)
        print(f"재시도 성공분: {len(retry)}건")
    except FileNotFoundError:
        print(f"{retry_path} 없음 — retry+fetch(--out-suffix _retry)를 먼저 실행하세요.")
        retry = {}

    merged = {**base, **retry}
    out_path = f"{OUT_DIR}/eligibility_gates_final.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)

    try:
        with open(f"{OUT_DIR}/eligibility_gates_errors_retry.json", encoding="utf-8") as f:
            still_failed = json.load(f)
        print(f"재시도해도 여전히 실패: {len(still_failed)}건 (사람이 직접 검토 필요)")
    except FileNotFoundError:
        pass

    print(f"최종 병합: {len(merged)}건 -> {out_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_submit = sub.add_parser("submit")
    p_submit.set_defaults(func=cmd_submit)

    p_status = sub.add_parser("status")
    p_status.add_argument("--batch-id", required=True)
    p_status.set_defaults(func=cmd_status)

    p_fetch = sub.add_parser("fetch")
    p_fetch.add_argument("--batch-id", required=True)
    p_fetch.add_argument("--out-suffix", default="", help="출력 파일명 접미사 (예: _retry)")
    p_fetch.set_defaults(func=cmd_fetch)

    p_retry = sub.add_parser("retry")
    p_retry.set_defaults(func=cmd_retry)

    p_merge = sub.add_parser("merge")
    p_merge.set_defaults(func=cmd_merge)

    args = parser.parse_args()
    args.func(args)
