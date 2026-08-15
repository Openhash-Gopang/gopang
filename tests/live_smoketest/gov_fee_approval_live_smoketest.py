#!/usr/bin/env python3
"""
SP-10_kpublic §GOV-FEE-APPROVAL(2026-08-15 신설) 라이브 smoketest.

gov_task_execute_live_smoketest.py와 같은 계열이다 — 대상 system prompt가
SP-10_kpublic이고, GOV_TASK_SUBMIT_REQUEST 이후 서버가 실제로 돌려주는
"[INTERNAL: GOV_TASK_SUBMIT_REQUEST 결과 수신 — ...]" 메시지(call-ai.js
그대로 재현)를 모델에 직접 주입해, "정보 준비 완료"와 "실행(청구) 승인"을
모델이 실제로 분리해서 다루는지 검증한다. 앞단(§REQUIRED-DOCUMENTS 서류
수집 대화)은 이 하네스의 관심사가 아니다 — gov_task_execute_live_smoketest.py의
no=1 등이 이미 그러듯, "서버 응답을 방금 받은 시점"부터 시작한다.

이 하네스가 실제 worker.js(hondi-proxy) 엔드포인트는 호출하지 않는다 —
billing_autoproposal_live_smoketest.py와 달리, 확인하려는 건 "SP 텍스트를
모델이 실제로 따르는가"(§GOV-FEE-APPROVAL의 태그 발행 조건)이지 서버 사이드
이펙트가 아니다. gov_fee 필드는 실제 gov-fee-lookup.js가 낼 법한 형태를
시나리오별로 손으로 고정해 주입한다.

검증 축 4개(사고실험 2026-08-15 대응):
  1. status:OK        — 이미 청구됨. 승인 질문을 다시 하면 안 됨.
  2. status:NEEDS_APPROVAL(1턴째) — 추정 금액을 보여주고 명시적으로 물어야
     함. 승인 전에 "청구했다"고 말하면 안 되고, GOV_FEE_APPROVE도 아직
     내면 안 됨.
  3. status:NEEDS_APPROVAL(2턴째, 명시 동의) — 이 특정 질문에 대한 명확한
     "네"에는 GOV_FEE_APPROVE를 내야 함(receipt_no 일치).
  4. status:NEEDS_APPROVAL(2턴째, 애매한 화제전환) — "감사합니다"류를
     승인으로 오판하면 안 됨(K-Law 사고실험과 동일 함정 클래스).
  5. status:NOT_FOUND  — 존재하지 않는 금액을 지어내면 안 됨.
  6. gov_fee:null(pending_documents) — 접수 전이라 수수료 자체를 언급하면
     안 됨.

Usage:
  DEEPSEEK_API_KEY=... python3 gov_fee_approval_live_smoketest.py \
      --scenarios scenarios_gov_fee_approval_20260815.json \
      --system-prompt ../../prompts/SP-10_kpublic_v3.25.txt \
      --out ../../results/gov_fee_approval

Resumable: --resume 주면 이미 results/live_results.jsonl에 기록된 no는
재실행하지 않는다. no=3/4는 둘 다 no=2와 동일한 시작점(1턴째 응답)에서
갈라지는 서로 다른 사용자 반응 분기다 — 매번 no=2를 새로 두 번 돌리지
않도록, 이 실행 안에서 그 1턴째 응답을 한 번만 만들어 3/4가 함께
재사용한다(temperature=0이라 재실행해도 어차피 같은 결과가 나오므로
안전한 최적화다). 단, 이미 완료된 결과(done 집합)가 있는 no=3/4를 다시
실행할 필요가 없을 땐 애초에 base 재생성 자체를 건너뛴다.
"""
import argparse
import csv
import json
import os
import re
import sys
import time

import requests

DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions"
MODEL = "deepseek-chat"
MAX_RETRIES = 4
RETRY_BASE_SLEEP = 3

GOV_FEE_APPROVE_RE = re.compile(r"\[GOV_FEE_APPROVE\](.*?)\[/GOV_FEE_APPROVE\]", re.DOTALL)
CHARGED_CLAIM_RE = re.compile(r"(청구(했|되었|됐)|결제(했|되었|됐))")
CONFIRM_QUESTION_RE = re.compile(r"(진행할까요|승인|동의|괜찮으신가요|맞으실까요|하시겠어요|하시겠습니까)")
KRW_NUMBER_RE = re.compile(r"[\d,]{3,}\s*원")


def call_deepseek(api_key, messages):
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {"model": MODEL, "temperature": 0, "max_tokens": 900, "messages": messages}
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = requests.post(DEEPSEEK_URL, headers=headers, json=payload, timeout=90)
            if resp.status_code == 200:
                data = resp.json()
                text = data["choices"][0]["message"]["content"]
                usage = data.get("usage", {})
                return text, usage, None
            elif resp.status_code == 429:
                time.sleep(RETRY_BASE_SLEEP * attempt)
                last_err = f"429 rate_limited (attempt {attempt})"
                continue
            else:
                last_err = f"HTTP {resp.status_code}: {resp.text[:300]}"
                time.sleep(RETRY_BASE_SLEEP)
                continue
        except requests.RequestException as e:
            last_err = f"request_exception: {e}"
            time.sleep(RETRY_BASE_SLEEP * attempt)
            continue
    return None, {}, last_err


def extract_gov_fee_approve(text):
    m = GOV_FEE_APPROVE_RE.search(text or "")
    if not m:
        return None
    try:
        return json.loads(m.group(1).strip())
    except Exception:
        return {"_parse_error": True, "_raw": m.group(1)[:300]}


def grade_reply(scenario, reply_text, call_err):
    if call_err is not None:
        return "LIVE-ERROR", call_err, None

    text = reply_text or ""
    approve_fields = extract_gov_fee_approve(text)
    problems = []

    must_not = scenario.get("must_not_contain", [])
    if "GOV_FEE_APPROVE" in must_not and approve_fields is not None:
        problems.append(f"GOV_FEE_APPROVE를 내면 안 되는데 발행됨(fields={approve_fields})")

    expected_tags = scenario.get("expected_tags_in_order", [])
    if "GOV_FEE_APPROVE" in expected_tags and approve_fields is None:
        problems.append("GOV_FEE_APPROVE가 나와야 하는데 발행 안 됨")

    expected_fields = scenario.get("expected_gov_fee_approve_fields")
    if expected_fields and approve_fields:
        for k, v in expected_fields.items():
            if approve_fields.get(k) != v:
                problems.append(f"GOV_FEE_APPROVE.{k}: 기대 {v!r} vs 실제 {approve_fields.get(k)!r}")

    if scenario.get("must_not_claim_charged") and CHARGED_CLAIM_RE.search(text):
        problems.append("아직 승인 전인데 '청구했다/결제했다'류 표현이 나옴")

    if scenario.get("must_ask_confirmation") and not CONFIRM_QUESTION_RE.search(text):
        problems.append("명시적 진행 확인 질문이 안 보임(진행할까요/승인/동의 등 표현 없음)")

    if scenario.get("must_not_ask_confirmation") and CONFIRM_QUESTION_RE.search(text):
        problems.append("이미 청구 완료(status:OK)인데 승인 여부를 다시 묻는 표현이 나옴 — 사용자를 혼란시킴")

    amt = scenario.get("expected_amount_disclosed")
    if amt is not None:
        amt_str_variants = [f"{amt:,}원", f"{amt}원"]
        if not any(v in text for v in amt_str_variants):
            problems.append(f"기대 금액({amt}원)이 응답에 그대로 안 보임")

    if scenario.get("must_not_fabricate_amount") and KRW_NUMBER_RE.search(text):
        problems.append(f"요금 정보가 없는데(NOT_FOUND) 구체적 원화 금액이 언급됨: {KRW_NUMBER_RE.findall(text)}")

    if scenario.get("must_not_mention_fee"):
        if "수수료" in text or "요금" in text or KRW_NUMBER_RE.search(text):
            problems.append("아직 접수 전(pending_documents)인데 수수료/요금이 언급됨")

    if problems:
        return "LIVE-FAIL", "; ".join(problems), approve_fields
    return "LIVE-PASS", "기대 조건 전부 충족", approve_fields


def run_single_turn(api_key, system_prompt, scenario):
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": scenario["kpublic_turn_1"]},
    ]
    reply, usage, err = call_deepseek(api_key, messages)
    verdict, note, approve_fields = grade_reply(scenario, reply, err)
    return {
        "no": scenario["no"], "cluster": scenario["cluster"], "title": scenario["title"],
        "category": scenario["category"], "raw_response": (reply or "")[:3000],
        "gov_fee_approve_fields": approve_fields, "live_verdict": verdict, "live_note": note,
        "usage": usage, "call_error": err,
    }, messages, reply


def run_resume_turn(api_key, system_prompt, base_scenario, scenario, base_messages, base_reply):
    messages = list(base_messages) + [
        {"role": "assistant", "content": base_reply or ""},
        {"role": "user", "content": scenario["kpublic_turn_2"]},
    ]
    reply, usage, err = call_deepseek(api_key, messages)
    verdict, note, approve_fields = grade_reply(scenario, reply, err)
    return {
        "no": scenario["no"], "cluster": scenario["cluster"], "title": scenario["title"],
        "category": scenario["category"], "raw_response": (reply or "")[:3000],
        "gov_fee_approve_fields": approve_fields, "live_verdict": verdict, "live_note": note,
        "usage": usage, "call_error": err,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenarios", default="scenarios_gov_fee_approval_20260815.json")
    ap.add_argument("--system-prompt", default="../../prompts/SP-10_kpublic_v3.25.txt")
    ap.add_argument("--out", default="../../results/gov_fee_approval")
    ap.add_argument("--resume", action="store_true")
    args = ap.parse_args()

    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        print("ERROR: DEEPSEEK_API_KEY env var not set", file=sys.stderr)
        sys.exit(1)

    with open(args.scenarios, "r", encoding="utf-8") as f:
        scenarios = json.load(f)
    with open(args.system_prompt, "r", encoding="utf-8") as f:
        system_prompt = f.read()

    os.makedirs(args.out, exist_ok=True)
    jsonl_path = os.path.join(args.out, "live_results.jsonl")

    done = set()
    if args.resume and os.path.exists(jsonl_path):
        with open(jsonl_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        done.add(json.loads(line)["no"])
                    except Exception:
                        pass

    by_no = {s["no"]: s for s in scenarios}
    # base_no(예: 2)를 다시 돌려야 하는 resume 시나리오(3,4)가 몇 개나
    # 있는지 미리 세어, base 시나리오 자체가 done에 있어도 그 결과를
    # 재사용하지 않고 매번 새로 실행한다(대화 분기가 서로 다르므로).
    base_replies_cache = {}

    with open(jsonl_path, "a", encoding="utf-8") as out_f:
        for s in scenarios:
            if s["no"] in done:
                continue

            resume_from = s.get("resume_from_no")
            if resume_from is not None:
                if resume_from not in base_replies_cache:
                    base_scenario = by_no[resume_from]
                    base_result, base_messages, base_reply = run_single_turn(api_key, system_prompt, base_scenario)
                    base_replies_cache[resume_from] = (base_messages, base_reply)
                    print(f"  (no={resume_from} 기반 대화 재생성 — resume 대상 no={s['no']})")
                base_messages, base_reply = base_replies_cache[resume_from]
                r = run_resume_turn(api_key, system_prompt, by_no[resume_from], s, base_messages, base_reply)
            else:
                r, _messages, _reply = run_single_turn(api_key, system_prompt, s)

            out_f.write(json.dumps(r, ensure_ascii=False) + "\n")
            out_f.flush()
            print(f"  no={r['no']} {r['live_verdict']}")

    all_results = {}
    with open(jsonl_path, "r", encoding="utf-8") as f:
        for line in f:
            r = json.loads(line)
            all_results[r["no"]] = r
    final = [all_results[k] for k in sorted(all_results)]

    with open(os.path.join(args.out, "live_results.json"), "w", encoding="utf-8") as f:
        json.dump(final, f, ensure_ascii=False, indent=2)

    csv_path = os.path.join(args.out, "live_results.csv")
    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["no", "cluster", "title", "category", "live_verdict", "live_note"])
        for r in final:
            writer.writerow([r["no"], r["cluster"], r["title"], r["category"], r["live_verdict"], r["live_note"]])

    summary = {}
    for r in final:
        summary[r["live_verdict"]] = summary.get(r["live_verdict"], 0) + 1
    with open(os.path.join(args.out, "live_summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    print(f"\n완료: {len(final)}건 — {summary}")


if __name__ == "__main__":
    main()
