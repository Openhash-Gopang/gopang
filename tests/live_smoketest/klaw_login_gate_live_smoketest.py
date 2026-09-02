#!/usr/bin/env python3
"""
K-Law 전화번호 로그인 게이트 LIVE smoketest (2026-09-02 신설).

klaw_billing_live_smoketest.py(2026-08-13)와 같은 관례(requests로 실제
hondi-proxy 엔드포인트를 HTTP로 호출, Origin 헤더로 AI_PROXY_PATHS 보호
통과, LIVE-PASS/LIVE-FAIL 채점, resumable)를 따르되, 이 하네스는 전부
"로그인 게이트가 DeepSeek 호출 전에 정확히 막는지"만 확인한다 — 실제
SMS 발송이나 GDC 차감이 필요한 시나리오는 하나도 없다(phone_verify_token
자체를 서버 비밀키 없이는 위조할 수 없으므로, "유효한 로그인" 경로는 이
하네스로 확인 불가 — 그건 실제 전화번호로 /biz/phone-otp-request →
/biz/phone-otp-verify를 직접 거쳐야 하고, klaw 저장소 webapp.html에서
수동으로 한 번 해보는 편이 빠르다).

Usage:
  python3 klaw_login_gate_live_smoketest.py \
      --scenarios scenarios_klaw_login_gate_20260902.json \
      --out ../../results/klaw_login_gate_20260902
"""
import argparse
import csv
import json
import os
import sys
import time

import requests

DEFAULT_WORKER_BASE = "https://hondi-proxy.tensor-city.workers.dev"
KLAW_ORIGIN = "https://klaw.hondi.net"


def call_endpoint(worker_base, endpoint, phone_verify_token):
    headers = {"Origin": KLAW_ORIGIN}
    t0 = time.time()
    try:
        if endpoint == "relay":
            body = {
                "guid": "smoketest-login-gate",  # 로그인 게이트가 이 값을 신뢰하지 않고 버려야 정상
                "tier": "klaw-flash",
                "messages": [
                    {"role": "system", "content": "test"},
                    {"role": "user", "content": "이 요청은 로그인 게이트 스모크테스트입니다."},
                ],
                "max_tokens": 10,
                "stream": False,
                "step_cycle": False,
                "phone_verify_token": phone_verify_token,
            }
            res = requests.post(f"{worker_base}/klaw/relay", json=body, headers=headers, timeout=30)
        elif endpoint == "quota":
            params = {}
            if phone_verify_token is not None:
                params["phone_verify_token"] = phone_verify_token
            res = requests.get(f"{worker_base}/klaw/quota", params=params, headers=headers, timeout=15)
        else:
            raise ValueError(f"unknown endpoint {endpoint}")
        elapsed = time.time() - t0
        try:
            data = res.json()
        except Exception:
            data = {"_raw_text": res.text[:500]}
        return {"status": res.status_code, "elapsed_s": round(elapsed, 2), "body": data}
    except Exception as e:
        elapsed = time.time() - t0
        return {"status": None, "elapsed_s": round(elapsed, 2), "body": {"error": "REQUEST_EXCEPTION", "message": str(e)}}


def grade(scenario, result):
    exp_status = scenario["expected_http_status"]
    exp_error = scenario.get("expected_error")
    status = result["status"]
    body = result.get("body") or {}

    if status != exp_status:
        return "LIVE-FAIL", f"HTTP 상태 불일치 (기대 {exp_status}, 실제 {status})"

    actual_error = body.get("error")
    if exp_error and actual_error != exp_error:
        return "LIVE-FAIL", f"에러 코드 불일치 (기대 {exp_error}, 실제 {actual_error})"

    if scenario.get("expect_nonempty_message"):
        msg = body.get("message")
        if not msg:
            return "LIVE-FAIL", (
                "message 필드가 비어있음 — _err()의 message 필드 추가(2026-09-02)가 "
                "실제 배포에는 반영 안 됐을 가능성"
            )
        # LOGIN_REQUIRED/TOKEN_MALFORMED/TOKEN_INVALID 코드 자체가 그대로 노출되는 것도
        # 사실상 "친절한 메시지가 아님"으로 본다 — 클라이언트가 이 문자열을 그대로
        # 화면에 띄우기 때문(§K-Law 로그인 게이트 사고실험 참고).
        if msg.strip() == actual_error:
            return "LIVE-FAIL", f"message가 에러 코드와 동일함('{msg}') — 사람이 읽을 안내문이 아님"

    soft_limit = scenario.get("max_elapsed_seconds_soft")
    if soft_limit and result.get("elapsed_s", 0) > soft_limit:
        return "LIVE-NEEDS-REVIEW", (
            f"차단 자체는 정상이지만 응답이 {result['elapsed_s']}초 걸림"
            f"(soft 기준 {soft_limit}초 초과) — DeepSeek이 실제로 호출됐을 가능성, 로그 확인 필요"
        )

    return "LIVE-PASS", f"정상 차단 (message: {body.get('message')!r})"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenarios", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--worker-base", default=DEFAULT_WORKER_BASE)
    ap.add_argument("--resume", action="store_true")
    args = ap.parse_args()

    with open(args.scenarios, encoding="utf-8") as f:
        scenarios = json.load(f)

    os.makedirs(args.out, exist_ok=True)
    jsonl_path = os.path.join(args.out, "live_results.jsonl")
    json_path = os.path.join(args.out, "live_results.json")
    csv_path = os.path.join(args.out, "live_results.csv")
    summary_path = os.path.join(args.out, "live_summary.json")

    done_nos = set()
    if args.resume and os.path.exists(jsonl_path):
        with open(jsonl_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    done_nos.add(json.loads(line)["no"])
                except Exception:
                    pass

    results = []
    jsonl_f = open(jsonl_path, "a", encoding="utf-8")
    t_start = time.time()

    for sc in scenarios:
        no = sc["no"]
        if no in done_nos:
            print(f"[{no}] resume — skip (already recorded)")
            continue

        print(f"[{no}] {sc['title']}")
        result = call_endpoint(args.worker_base, sc["endpoint"], sc.get("phone_verify_token"))
        verdict, reason = grade(sc, result)

        record = {
            "no": no, "title": sc["title"], "finding": sc.get("finding"),
            "verdict": verdict, "reason": reason,
            "endpoint": sc["endpoint"],
            "http_status": result["status"], "elapsed_s": result.get("elapsed_s"),
            "response_body": result.get("body"),
        }
        results.append(record)
        jsonl_f.write(json.dumps(record, ensure_ascii=False) + "\n")
        jsonl_f.flush()
        print(f"    -> {verdict} ({reason})")

    jsonl_f.close()

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    if results:
        with open(csv_path, "w", encoding="utf-8", newline="") as f:
            fieldnames = ["no", "title", "finding", "verdict", "reason", "endpoint",
                          "http_status", "elapsed_s"]
            w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
            w.writeheader()
            for r in results:
                w.writerow(r)

    counts = {}
    for r in results:
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
    summary = {
        "total": len(results),
        "counts": counts,
        "runtime_seconds": round(time.time() - t_start, 1),
    }
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    print("\n=== SUMMARY ===")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
