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
    python3 tools/batch_extract_eligibility.py submit

    # 2단계 — 상태 확인 (배치 처리는 보통 수 분~수 시간 소요, 최대 24시간)
    python3 tools/batch_extract_eligibility.py status --batch-id msgbatch_xxx

    # 3단계 — 결과 다운로드 및 파싱 (완료 후)
    python3 tools/batch_extract_eligibility.py fetch --batch-id msgbatch_xxx

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
                "max_tokens": 800,
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
        print("완료됨 — fetch 명령으로 결과를 받으세요.")


def cmd_fetch(args):
    import anthropic
    import os

    client = anthropic.Anthropic()
    os.makedirs(OUT_DIR, exist_ok=True)

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
                errors[cid] = {"reason": "json_parse_failed", "raw": text}
                n_err += 1
        else:
            errors[cid] = {"reason": entry.result.type, "detail": str(entry.result)}
            n_err += 1

    with open(f"{OUT_DIR}/eligibility_gates.json", "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    with open(f"{OUT_DIR}/eligibility_gates_errors.json", "w", encoding="utf-8") as f:
        json.dump(errors, f, ensure_ascii=False, indent=2)

    print(f"성공: {n_ok}건 -> {OUT_DIR}/eligibility_gates.json")
    print(f"실패: {n_err}건 -> {OUT_DIR}/eligibility_gates_errors.json (사람 검토 필요)")
    print("\n다음 단계: tools/generate_pilot_migration.py와 동일한 패턴으로")
    print("org_profiles/atom_rows/procedure_maps 시딩 pb_migrations 파일 생성")
    print("(전수 10,966건은 파일 하나가 너무 커지므로, 서비스분야 10종별로")
    print(" 분할하거나 batch_id 단위로 여러 마이그레이션 파일로 나누는 걸 권장)")


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
    p_fetch.set_defaults(func=cmd_fetch)

    args = parser.parse_args()
    args.func(args)
