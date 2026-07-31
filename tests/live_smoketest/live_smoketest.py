#!/usr/bin/env python3
"""
Hondi 300-scenario LIVE smoketest against DeepSeek API.

Loads the real prompts/AC-PRO-CORE_v1_0.txt system prompt (contains
§CATALOG / §CATALOG-EXPERT tables), sends each of the 300 scenarios as a
user turn, parses the model's [GWP: id] / [EXPERT: id] routing tag (or
absence of one), and compares against the expected target recorded in
scenarios.json (extracted from hondi_smoketest_report_v2.xlsx).

Special-cased categories:
  - expected_id == "direct-response"   -> PASS iff NO [GWP:]/[EXPERT:] tag emitted
  - expected_id == "prompt-injection"  -> NEVER auto-graded PASS/FAIL. Raw output is
                                           saved for human review (jailbreak resistance
                                           is a judgment call, not a string match).

Usage:
  DEEPSEEK_API_KEY=... python3 live_smoketest.py \
      --scenarios scenarios.json \
      --system-prompt ../../prompts/AC-PRO-CORE_v1_0.txt \
      --out ../../results

Resumable: writes results incrementally to <out>/live_results.jsonl so a
killed/timed-out run can be restarted without re-paying for already-graded
scenarios (pass --resume).
"""
import argparse
import json
import os
import re
import sys
import time
import csv
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions"
MODEL = "deepseek-chat"

GWP_TAG_RE = re.compile(r"\[\s*GWP\s*:\s*([\w\-]+)\s*\]", re.IGNORECASE)
EXPERT_TAG_RE = re.compile(r"\[\s*EXPERT\s*:\s*([\w\-]+)\s*\]", re.IGNORECASE)

# Heuristics for detecting "legitimate single-turn clarifying question" responses,
# per §CORE's "넘겨짚지 않고 되묻는다" instruction. A response matching these is NOT
# routing failure — the system is designed to clarify before routing on ambiguous
# single-turn utterances, and this harness only tests one turn.
CLARIFY_PATTERNS = [
    r"말씀해\s*주(시겠|세요|시면)",
    r"알려\s*주(시겠|세요|시면)",
    r"여쭤보겠습니다",
    r"어떤\s*상황",
    r"어떻게\s*되시나요",
    r"\?\s*$",  # response ends with a question mark
]
CLARIFY_RE = re.compile("|".join(CLARIFY_PATTERNS), re.IGNORECASE | re.MULTILINE)

MAX_WORKERS = 5
MAX_RETRIES = 4
RETRY_BASE_SLEEP = 3  # seconds, exponential backoff


def call_deepseek(api_key, system_prompt, user_utterance):
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": MODEL,
        "temperature": 0,
        "max_tokens": 600,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_utterance},
        ],
    }
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = requests.post(DEEPSEEK_URL, headers=headers, json=payload, timeout=60)
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


def grade(scenario, raw_text, call_err):
    expected_type = scenario["expected_type"]
    expected_id = scenario["expected_id"]

    if call_err is not None:
        return "LIVE-ERROR", call_err

    gwp_match = GWP_TAG_RE.search(raw_text or "")
    expert_match = EXPERT_TAG_RE.search(raw_text or "")
    extracted_type = None
    extracted_id = None
    if gwp_match:
        extracted_type, extracted_id = "GWP", gwp_match.group(1)
    elif expert_match:
        extracted_type, extracted_id = "전문가AI", expert_match.group(1)

    # Prompt-injection resistance is a judgment call, never auto-graded.
    if expected_id == "prompt-injection":
        return "LIVE-NEEDS-REVIEW", "탈옥 저항력은 사람이 응답 원문을 직접 판단해야 함"

    # Expected: model answers directly, no routing tag at all.
    if expected_id == "direct-response":
        if extracted_id is None:
            return "LIVE-PASS", "태그 없이 직접 응답 (기대대로)"
        else:
            return "LIVE-FAIL", f"라우팅 불필요 상황인데 [{extracted_type}: {extracted_id}] 오발동"

    # Normal routing comparison
    if extracted_id is None:
        if CLARIFY_RE.search(raw_text or ""):
            return (
                "LIVE-CLARIFY",
                "태그 없이 되물음 — §CORE 되묻기 지침에 따른 정상 동작일 수 있음 (1턴 테스트 한계, 사람 검토 필요)",
            )
        return "LIVE-FAIL", "기대된 라우팅 태그가 없고 되묻지도 않음 (직접 답변으로 종료)"
    if extracted_type == expected_type and extracted_id == expected_id:
        return "LIVE-PASS", f"[{extracted_type}: {extracted_id}] 일치"
    return "LIVE-FAIL", f"기대 [{expected_type}: {expected_id}] vs 실제 [{extracted_type}: {extracted_id}]"


def load_done_numbers(jsonl_path):
    done = set()
    if os.path.exists(jsonl_path):
        with open(jsonl_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    done.add(json.loads(line)["no"])
                except (json.JSONDecodeError, KeyError):
                    pass
    return done


def process_one(api_key, system_prompt, scenario):
    raw_text, usage, err = call_deepseek(api_key, system_prompt, scenario["utterance"])
    verdict, note = grade(scenario, raw_text, err)
    return {
        "no": scenario["no"],
        "utterance": scenario["utterance"],
        "expected_type": scenario["expected_type"],
        "expected_id": scenario["expected_id"],
        "category": scenario["category"],
        "static_verdict": scenario["static_verdict"],
        "raw_response": (raw_text or "")[:2000],
        "live_verdict": verdict,
        "live_note": note,
        "usage": usage,
        "call_error": err,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenarios", default="scenarios.json")
    ap.add_argument("--system-prompt", default="../../prompts/AC-PRO-CORE_v1_0.txt")
    ap.add_argument("--out", default="../../results")
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--limit", type=int, default=None, help="only run first N scenarios (debug)")
    args = ap.parse_args()

    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        print("ERROR: DEEPSEEK_API_KEY env var not set", file=sys.stderr)
        sys.exit(1)

    with open(args.scenarios, "r", encoding="utf-8") as f:
        scenarios = json.load(f)
    if args.limit:
        scenarios = scenarios[: args.limit]

    with open(args.system_prompt, "r", encoding="utf-8") as f:
        system_prompt = f.read()

    os.makedirs(args.out, exist_ok=True)
    jsonl_path = os.path.join(args.out, "live_results.jsonl")

    done = load_done_numbers(jsonl_path) if args.resume else set()
    todo = [s for s in scenarios if s["no"] not in done]
    print(f"{len(scenarios)} total, {len(done)} already done, {len(todo)} to run")

    start = time.time()
    results_written = 0
    with open(jsonl_path, "a", encoding="utf-8") as out_f:
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
            futures = {
                pool.submit(process_one, api_key, system_prompt, s): s for s in todo
            }
            for fut in as_completed(futures):
                s = futures[fut]
                try:
                    result = fut.result()
                except Exception as e:  # noqa: BLE001 - keep the run alive
                    result = {
                        "no": s["no"],
                        "utterance": s["utterance"],
                        "expected_type": s["expected_type"],
                        "expected_id": s["expected_id"],
                        "category": s["category"],
                        "static_verdict": s["static_verdict"],
                        "raw_response": "",
                        "live_verdict": "LIVE-ERROR",
                        "live_note": f"unhandled_exception: {e}",
                        "usage": {},
                        "call_error": str(e),
                    }
                out_f.write(json.dumps(result, ensure_ascii=False) + "\n")
                out_f.flush()
                results_written += 1
                if results_written % 20 == 0:
                    print(f"  ...{results_written}/{len(todo)} done ({time.time()-start:.0f}s)")

    print(f"Done. {results_written} results written in {time.time()-start:.0f}s")

    # Build final consolidated JSON + CSV + summary from the jsonl (dedup by 'no', last wins)
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
        w = csv.DictWriter(
            f,
            fieldnames=[
                "no", "utterance", "expected_type", "expected_id", "category",
                "static_verdict", "live_verdict", "live_note", "raw_response", "call_error",
            ],
        )
        w.writeheader()
        for r in final:
            row = {k: r.get(k, "") for k in w.fieldnames}
            w.writerow(row)

    from collections import Counter
    counts = Counter(r["live_verdict"] for r in final)
    summary = {
        "total": len(final),
        "counts": dict(counts),
        "runtime_seconds": round(time.time() - start),
    }
    with open(os.path.join(args.out, "live_summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()