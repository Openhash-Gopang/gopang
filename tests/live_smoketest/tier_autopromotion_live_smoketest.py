#!/usr/bin/env python3
"""
복잡도 기반 flash/pro 자동승격 LIVE smoketest.

2026-08-14 리팩터링(주피터 지시)으로 이 판단이 브라우저에서 서버
(worker.js callDeepSeek/handleGovRelay, _resolveServerTier 공유 함수)로
옮겨졌다 — 그 덕분에 브라우저 없이 실제 배포 서버에 HTTP로 직접
검증할 수 있다. 클라이언트가 어떤 model/tier를 보내든 서버가
messages 내용을 보고 재계산하므로, 여기서는 항상 같은 값("hondi-flash"/
"gov-flash")을 보내고 messages만 단순/복잡으로 바꿔가며 실제로 다른
백엔드 모델이 쓰였는지를 PocketBase ai_usage_log로 확인한다.

klaw_billing_live_smoketest.py와 동일한 컨벤션 — Origin 헤더 필수
(worker.js AI_PROXY_PATHS 보호), guid는 매 시나리오 새로 발급해
과거 로그와 안 섞이게 한다.

Usage:
  python3 tier_autopromotion_live_smoketest.py \
      --scenarios scenarios_tier_autopromotion_20260814.json \
      --out ../../results/tier_autopromotion \
      --pb-base https://l1-hanlim.hondi.net \
      --pb-admin-email <email> --pb-admin-password <password>
"""
import argparse
import json
import os
import sys
import time
import uuid

import requests

DEFAULT_WORKER_BASE = "https://hondi-proxy.tensor-city.workers.dev"
DEFAULT_PB_BASE = "https://l1-hanlim.hondi.net"
LOG_PROPAGATION_WAIT_S = 3
ORIGIN_HEADER = {"Origin": "https://hondi.net"}  # AI_PROXY_PATHS 보호 통과용


def pb_admin_login(pb_base, email, password):
    res = requests.post(
        f"{pb_base}/api/admins/auth-with-password",
        json={"identity": email, "password": password}, timeout=15,
    )
    data = res.json()
    token = data.get("token")
    if not token:
        raise RuntimeError(f"PocketBase admin 로그인 실패: {data}")
    return token


def pb_get_latest_usage_log(pb_base, token, guid):
    headers = {"Authorization": f"Bearer {token}"}
    filt = f"guid='{guid}'"
    res = requests.get(
        f"{pb_base}/api/collections/ai_usage_log/records",
        params={"filter": filt, "sort": "-created", "perPage": 1}, headers=headers, timeout=15,
    )
    items = res.json().get("items", [])
    return items[0] if items else None


def call_deepseek_relay(worker_base, guid, messages):
    body = {
        "guid": guid, "model": "hondi-flash",  # 서버가 무시하고 재계산 — 값 자체는 무관
        "messages": messages, "max_tokens": 40, "stream": False,
    }
    t0 = time.time()
    try:
        res = requests.post(f"{worker_base}/deepseek", json=body, headers=ORIGIN_HEADER, timeout=60)
        elapsed = time.time() - t0
        try:
            data = res.json()
        except Exception:
            data = {"_raw_text": res.text[:300]}
        return {"status": res.status_code, "elapsed_s": round(elapsed, 2), "body": data}
    except Exception as e:
        return {"status": None, "elapsed_s": round(time.time() - t0, 2), "body": {"error": str(e)}}


def call_gov_relay(worker_base, guid, messages):
    body = {
        "guid": guid, "agency": "public", "agencyPrompt": "You are a test harness call. Reply with exactly one short sentence.",
        "messages": messages, "max_tokens": 40, "stream": False, "tier": "gov-flash",  # 서버가 무시하고 재계산
    }
    t0 = time.time()
    try:
        res = requests.post(f"{worker_base}/gov/relay", json=body, headers=ORIGIN_HEADER, timeout=60)
        elapsed = time.time() - t0
        try:
            data = res.json()
        except Exception:
            data = {"_raw_text": res.text[:300]}
        return {"status": res.status_code, "elapsed_s": round(elapsed, 2), "body": data}
    except Exception as e:
        return {"status": None, "elapsed_s": round(time.time() - t0, 2), "body": {"error": str(e)}}


SIMPLE_MESSAGE = "안녕하세요"

COMPLEX_MESSAGE = (
    "제가 이번에 사업자등록을 하려고 하는데요, 절차가 어떻게 되는지 궁금합니다. "
    "그리고 세금 신고는 어떻게 해야 하나요? 필요한 서류는 다음과 같이 준비했습니다.\n"
    "- 신분증\n- 임대차계약서\n- 사업계획서\n"
    "이 서류들로 충분한지, 추가로 뭐가 더 필요한지, 처리 기간은 얼마나 걸리는지, "
    "수수료는 얼마인지 전부 자세히 비교해서 알려주시고 각 단계별로 순서대로 정리해 주세요. "
) * 2


def run_scenario(sc, worker_base, pb_base, token):
    guid = f"smoketest-tier-{uuid.uuid4()}"
    text = SIMPLE_MESSAGE if sc["complexity"] == "simple" else COMPLEX_MESSAGE
    messages = [{"role": "user", "content": text}]

    caller = call_deepseek_relay if sc["endpoint"] == "deepseek" else call_gov_relay
    result = caller(worker_base, guid, messages)

    if result["status"] != 200:
        return "LIVE-ERROR", f"HTTP {result['status']} — {json.dumps(result['body'], ensure_ascii=False)[:300]}", guid, None

    time.sleep(LOG_PROPAGATION_WAIT_S)
    log = pb_get_latest_usage_log(pb_base, token, guid)
    if log is None:
        return "LIVE-FAIL", "ai_usage_log에 기록이 없음", guid, None

    actual_model = log.get("model", "")
    expected_model = sc["expected_model"]
    if actual_model != expected_model:
        return "LIVE-FAIL", f"모델 불일치(기대 {expected_model}, 실제 {actual_model})", guid, log
    return "LIVE-PASS", f"모델 일치 확인: {actual_model}", guid, log


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenarios", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--worker-base", default=DEFAULT_WORKER_BASE)
    ap.add_argument("--pb-base", default=DEFAULT_PB_BASE)
    ap.add_argument("--pb-admin-email", default=os.environ.get("PB_ADMIN_EMAIL"))
    ap.add_argument("--pb-admin-password", default=os.environ.get("PB_ADMIN_PASSWORD"))
    ap.add_argument("--resume", action="store_true")
    args = ap.parse_args()

    if not args.pb_admin_email or not args.pb_admin_password:
        print("PocketBase admin 계정 정보 없음 — 전체 시나리오 LIVE-SKIPPED", file=sys.stderr)
        token = None
    else:
        token = pb_admin_login(args.pb_base, args.pb_admin_email, args.pb_admin_password)

    with open(args.scenarios, encoding="utf-8") as f:
        scenarios = json.load(f)

    os.makedirs(args.out, exist_ok=True)
    jsonl_path = os.path.join(args.out, "live_results.jsonl")
    json_path = os.path.join(args.out, "live_results.json")
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
            print(f"[{no}] resume — skip")
            continue
        print(f"[{no}] {sc['title']}")

        if token is None:
            record = {"no": no, "title": sc["title"], "verdict": "LIVE-SKIPPED",
                       "reason": "PocketBase admin 계정 정보 없음", "guid": None}
        else:
            verdict, reason, guid, log = run_scenario(sc, args.worker_base, args.pb_base, token)
            record = {"no": no, "title": sc["title"], "verdict": verdict, "reason": reason, "guid": guid, "log": log}
            print(f"    -> {verdict} ({reason})")

        results.append(record)
        jsonl_f.write(json.dumps(record, ensure_ascii=False) + "\n")
        jsonl_f.flush()

    jsonl_f.close()
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    counts = {}
    for r in results:
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
    summary = {"total": len(results), "counts": counts, "runtime_seconds": round(time.time() - t_start, 1)}
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    print("\n=== SUMMARY ===")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
