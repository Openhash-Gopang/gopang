#!/usr/bin/env python3
"""
K-Law GDC 사건단위 정액과금 LIVE smoketest (F1/F3 대응).

기존 live_smoketest.py 계열(AC-PRO-CORE 라우팅 태그 채점)과 달리, 이
하네스는 DeepSeek을 직접 부르지 않고 실제 worker.js(hondi-proxy)
엔드포인트(/klaw/relay, /biz/balance-status)를 HTTP로 호출해 GDC 잔액
변화라는 "부수효과"로 채점한다 — /klaw/relay의 HTTP 응답 자체는 billing
성공/실패와 무관하게 200을 반환할 수 있으므로(정산이 ctx.waitUntil로
응답과 분리돼 비동기 처리됨), 응답 상태코드만으로는 F1/F3 수정이 실제로
작동하는지 확인할 수 없다. 대신 각 시나리오 전후로 /biz/balance-status를
조회해 잔액 차감액을 기대값과 비교한다.

Usage:
  python3 klaw_billing_live_smoketest.py \
      --scenarios scenarios_klaw_billing_f1_f3_20260813.json \
      --out ../../results/klaw_billing_f1_f3 \
      --funded-guid <잔액 5만원 이상 보유한 테스트 guid>

--funded-guid를 안 주면 requires_funded_guid=true인 시나리오는 전부
LIVE-SKIPPED로 표시되고, 비용 없는 F3 차단 시나리오만 실행된다.

Resumable: --resume 주면 이미 기록된 no는 재실행하지 않는다(재실행 시
이미 청구된 시나리오를 또 청구하는 사고 방지).
"""
import argparse
import csv
import json
import os
import sys
import time
import uuid

import requests

DEFAULT_WORKER_BASE = "https://hondi-proxy.tensor-city.workers.dev"
SETTLEMENT_POLL_ATTEMPTS = 6      # 비동기 정산(ctx.waitUntil) 완료 대기 재시도 횟수
SETTLEMENT_POLL_INTERVAL_S = 2    # 재시도 간격(초)
BALANCE_TOLERANCE_KRW = 1         # 환율 반올림 오차 허용치


def get_balance_krw(worker_base, guid):
    try:
        res = requests.get(f"{worker_base}/biz/balance-status", params={"guid": guid}, timeout=15)
        data = res.json()
        if not data.get("ok"):
            return None
        return data.get("balance_krw")
    except Exception as e:
        print(f"    [balance lookup error] {e}", file=sys.stderr)
        return None


def call_klaw_relay(worker_base, guid, case_id, claim_amount_krw):
    body = {
        "guid": guid,
        "tier": "klaw-flash",  # 정액과금 여부는 tier와 무관 — 비용 절감을 위해 flash 사용
        "messages": [
            {"role": "system", "content": "You are a test harness call. Reply with exactly one short sentence."},
            {"role": "user", "content": "이 요청은 K-Law GDC 과금 로직 라이브 스모크테스트입니다. 아주 짧게 한 문장으로만 답하세요."},
        ],
        "max_tokens": 40,
        "stream": False,
        "step_cycle": True,
        "case_id": case_id,
        "claim_amount_krw": claim_amount_krw,
    }
    t0 = time.time()
    try:
        # worker.js AI_PROXY_PATHS 보호 — Origin 헤더 없는 요청은 403
        # FORBIDDEN_NO_ORIGIN으로 차단된다(ALLOWED_ORIGINS 목록 중 klaw
        # 서비스 도메인 사용).
        headers = {"Origin": "https://klaw.hondi.net"}
        res = requests.post(f"{worker_base}/klaw/relay", json=body, headers=headers, timeout=90)
        elapsed = time.time() - t0
        try:
            data = res.json()
        except Exception:
            data = {"_raw_text": res.text[:500]}
        return {"status": res.status_code, "elapsed_s": round(elapsed, 2), "body": data}
    except Exception as e:
        elapsed = time.time() - t0
        return {"status": None, "elapsed_s": round(elapsed, 2), "body": {"error": "REQUEST_EXCEPTION", "message": str(e)}}


def wait_for_settlement_and_get_balance(worker_base, guid, balance_before):
    """정산이 ctx.waitUntil로 비동기 처리되므로, 잔액이 변하거나(또는 무변화가
    기대값인 시나리오라도 최소 대기는 동일하게) 최대 시도 횟수까지 폴링한다.
    잔액이 변하지 않는 게 정답인 시나리오(재생성 등)는 어차피 끝까지 폴링해
    최종값을 그대로 쓴다 — 폴링 자체가 판정을 왜곡하지 않는다."""
    last = balance_before
    for i in range(SETTLEMENT_POLL_ATTEMPTS):
        time.sleep(SETTLEMENT_POLL_INTERVAL_S)
        bal = get_balance_krw(worker_base, guid)
        if bal is not None:
            last = bal
            if bal != balance_before:
                # 변화가 감지되면 한 번 더 대기해 마지막 반영까지 흡수(여러
                # 부수효과가 있는 건 아니지만, 안전마진으로 1회 더 확인).
                time.sleep(SETTLEMENT_POLL_INTERVAL_S)
                bal2 = get_balance_krw(worker_base, guid)
                return bal2 if bal2 is not None else bal
    return last


def grade(scenario, result, balance_delta_krw):
    exp_status = scenario["expected_http_status"]
    exp_error = scenario.get("expected_error")
    exp_fee = scenario.get("expected_fee_krw")
    status = result["status"]
    body = result.get("body") or {}

    if status != exp_status:
        return "LIVE-FAIL", f"HTTP 상태 불일치 (기대 {exp_status}, 실제 {status})"

    if exp_status != 200:
        actual_error = body.get("error")
        if exp_error and actual_error != exp_error:
            return "LIVE-FAIL", f"에러 코드 불일치 (기대 {exp_error}, 실제 {actual_error})"
        soft_limit = scenario.get("max_elapsed_seconds_soft")
        if soft_limit and result.get("elapsed_s", 0) > soft_limit:
            return "LIVE-NEEDS-REVIEW", (
                f"차단 자체는 정상이지만 응답이 {result['elapsed_s']}초 걸림"
                f"(soft 기준 {soft_limit}초 초과) — DeepSeek이 실제로 호출됐을 가능성, 로그 확인 필요"
            )
        return "LIVE-PASS", "정상 차단"

    # exp_status == 200
    if exp_fee is None:
        return "LIVE-NEEDS-REVIEW", "expected_fee_krw 미지정 — 수동 확인 필요"
    if balance_delta_krw is None:
        return "LIVE-ERROR", "잔액 조회 실패로 차감액 확인 불가"
    if abs(balance_delta_krw - exp_fee) <= BALANCE_TOLERANCE_KRW:
        return "LIVE-PASS", f"차감액 {balance_delta_krw}원 (기대 {exp_fee}원)"
    return "LIVE-FAIL", f"차감액 불일치 (기대 {exp_fee}원, 실제 {balance_delta_krw}원)"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenarios", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--worker-base", default=DEFAULT_WORKER_BASE)
    ap.add_argument("--funded-guid", default=None, help="잔액 충분한 테스트 guid (requires_funded_guid 시나리오용)")
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

    case_id_by_no = {}  # 재생성 시나리오가 이전 case_id를 재사용할 수 있게 기록
    results = []
    if args.resume and os.path.exists(json_path):
        with open(json_path, encoding="utf-8") as f:
            try:
                results = json.load(f)
                for r in results:
                    if r.get("case_id"):
                        case_id_by_no[r["no"]] = r["case_id"]
            except Exception:
                results = []

    jsonl_f = open(jsonl_path, "a", encoding="utf-8")
    t_start = time.time()

    for sc in scenarios:
        no = sc["no"]
        if no in done_nos:
            print(f"[{no}] resume — skip (already recorded)")
            continue

        print(f"[{no}] {sc['title']}")

        requires_funded = sc.get("requires_funded_guid", False)
        if requires_funded and not args.funded_guid:
            record = {
                "no": no, "title": sc["title"], "finding": sc.get("finding"),
                "verdict": "LIVE-SKIPPED", "reason": "--funded-guid 미지정",
                "guid": None, "case_id": None, "http_status": None,
                "balance_before_krw": None, "balance_after_krw": None, "balance_delta_krw": None,
            }
            results.append(record)
            jsonl_f.write(json.dumps(record, ensure_ascii=False) + "\n")
            jsonl_f.flush()
            print(f"    -> LIVE-SKIPPED (--funded-guid 미지정)")
            continue

        guid = args.funded_guid if requires_funded else f"smoketest-{uuid.uuid4()}"

        reuse_from = sc.get("reuse_case_from")
        if reuse_from is not None:
            case_id = case_id_by_no.get(reuse_from)
            if not case_id:
                record = {
                    "no": no, "title": sc["title"], "finding": sc.get("finding"),
                    "verdict": "LIVE-ERROR", "reason": f"reuse_case_from={reuse_from}의 case_id를 찾을 수 없음(선행 시나리오 미실행?)",
                    "guid": guid, "case_id": None, "http_status": None,
                    "balance_before_krw": None, "balance_after_krw": None, "balance_delta_krw": None,
                }
                results.append(record)
                jsonl_f.write(json.dumps(record, ensure_ascii=False) + "\n")
                jsonl_f.flush()
                print(f"    -> LIVE-ERROR (선행 case_id 없음)")
                continue
        else:
            case_id = f"smoketest-case-{uuid.uuid4()}"
            case_id_by_no[no] = case_id

        balance_before = get_balance_krw(args.worker_base, guid) if requires_funded else None

        result = call_klaw_relay(args.worker_base, guid, case_id, sc["claim_amount_krw"])

        balance_after = None
        balance_delta = None
        if requires_funded and result["status"] == 200:
            balance_after = wait_for_settlement_and_get_balance(args.worker_base, guid, balance_before)
            if balance_before is not None and balance_after is not None:
                balance_delta = round(balance_before - balance_after, 2)

        verdict, reason = grade(sc, result, balance_delta)

        record = {
            "no": no, "title": sc["title"], "finding": sc.get("finding"),
            "verdict": verdict, "reason": reason,
            "guid": guid, "case_id": case_id,
            "http_status": result["status"], "elapsed_s": result.get("elapsed_s"),
            "response_body": result.get("body"),
            "balance_before_krw": balance_before, "balance_after_krw": balance_after,
            "balance_delta_krw": balance_delta,
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
            fieldnames = ["no", "title", "finding", "verdict", "reason", "guid", "case_id",
                          "http_status", "elapsed_s", "balance_before_krw", "balance_after_krw", "balance_delta_krw"]
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
        "funded_guid_provided": bool(args.funded_guid),
    }
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    print("\n=== SUMMARY ===")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
