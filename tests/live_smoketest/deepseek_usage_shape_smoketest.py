#!/usr/bin/env python3
"""
DeepSeek usage 필드 형태 LIVE smoketest (2026-09-02 신설).

worker.js의 _deepseekUsageToKRW()(1304행)는 DeepSeek 응답의
usage.prompt_cache_hit_tokens / usage.prompt_cache_miss_tokens /
usage.completion_tokens 필드명에 의존해 GDC 과금액을 계산한다. 이
필드명이 DeepSeek 쪽에서 조용히 바뀌면(모델 교체, API 버전업 등)
캐시 히트분을 전부 미스로 계산해 hondi 전체 서비스가 소리 없이
과청구하게 된다 — HTTP 상태코드만으로는 절대 못 잡는 종류의 결함이라
(klaw_billing_live_smoketest.py가 GDC 잔액 변화로 채점하는 것과 같은
이유로) 실제 API를 직접 호출해 usage 오브젝트 자체를 까봐야 한다.

이 하네스는 DeepSeek API를 worker.js를 거치지 않고 직접 호출한다(GDC
차감·전화번호 로그인과 무관 — 순수하게 DeepSeek 쪽 계약이 안 깨졌는지만
확인). 같은 system+user 프리픽스로 두 번 호출해 두 번째 호출에서
prompt_cache_hit_tokens > 0이 찍히는지까지 확인한다(캐시가 실제로 켜져
있는지 — 꺼져 있으면 예상보다 훨씬 비싸게 청구되고 있다는 뜻).

가격표(HONDI_TIER_MODELS) 자체가 맞는지는 이 스크립트로 확정할 수
없다 — DeepSeek 대시보드의 실제 청구 내역과 대조해야 한다. 이 스크립트는
usage.*원본값과 그 값으로 계산한 KRW를 둘 다 출력만 하니, 사람이
DeepSeek 대시보드와 눈으로 대조할 것.

Usage:
  DEEPSEEK_API_KEY=... python3 deepseek_usage_shape_smoketest.py --out ../../results/deepseek_usage_shape
"""
import argparse
import json
import os
import time

import requests

DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"

# worker.js HONDI_TIER_MODELS(1162행)를 그대로 미러링 — 이 스크립트가
# worker.js와 갈라지지 않도록, 값을 바꿀 땐 항상 두 곳을 함께 확인할 것.
PRICE_TABLE = {
    "deepseek-v4-flash": {"cacheHit": 0.0028, "cacheMiss": 0.14, "output": 0.28},
    "deepseek-v4-pro":   {"cacheHit": 0.0145, "cacheMiss": 0.435, "output": 0.87},
}
USD_TO_KRW = 1500

# 캐시 히트를 실제로 유도하기 위한 긴 고정 프리픽스(짧으면 캐시가 안 걸릴 수 있음).
LONG_PREFIX = (
    "당신은 K-Law 판결 시뮬레이션 스모크테스트용 시스템 프롬프트입니다. "
    "이 지시문은 매 호출마다 완전히 동일하게 반복되어 DeepSeek 프롬프트 캐시를 "
    "의도적으로 유도합니다. " * 20
)


def compute_krw(usage, model):
    price = PRICE_TABLE[model]
    hit = usage.get("prompt_cache_hit_tokens", 0) or 0
    miss = usage.get("prompt_cache_miss_tokens")
    if miss is None:
        miss = max((usage.get("prompt_tokens", 0) or 0) - hit, 0)
    out = usage.get("completion_tokens", 0) or 0
    usd = (hit / 1e6) * price["cacheHit"] + (miss / 1e6) * price["cacheMiss"] + (out / 1e6) * price["output"]
    return round(usd * USD_TO_KRW, 4)


def call_deepseek(api_key, model, turn_label):
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": LONG_PREFIX},
            {"role": "user", "content": f"이것은 스모크테스트 {turn_label}번째 호출입니다. 한 단어로만 답하세요."},
        ],
        "max_tokens": 10,
        "stream": False,
    }
    t0 = time.time()
    try:
        res = requests.post(
            DEEPSEEK_URL,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
            json=body, timeout=60,
        )
        elapsed = time.time() - t0
        try:
            data = res.json()
        except Exception:
            data = {"_raw_text": res.text[:500]}
        return {"status": res.status_code, "elapsed_s": round(elapsed, 2), "body": data}
    except Exception as e:
        return {"status": None, "elapsed_s": round(time.time() - t0, 2), "body": {"error": "REQUEST_EXCEPTION", "message": str(e)}}


def check_model(api_key, model, results):
    # 1차 호출 — 캐시 미스 유발(첫 사용).
    r1 = call_deepseek(api_key, model, 1)
    time.sleep(1)  # 캐시 반영 대기(문서상 즉시지만 안전마진)
    # 2차 호출 — 동일 프리픽스라 캐시 히트가 기대됨.
    r2 = call_deepseek(api_key, model, 2)

    record = {"model": model, "call_1": r1, "call_2": r2, "checks": {}}

    for label, r in (("call_1", r1), ("call_2", r2)):
        if r["status"] != 200:
            record["checks"][f"{label}_http_ok"] = False
            record["verdict"] = "LIVE-FAIL"
            record["reason"] = f"{label} HTTP {r['status']} — 모델 ID 폐기/이름 변경 가능성"
            results.append(record)
            return
        record["checks"][f"{label}_http_ok"] = True

    usage2 = r2["body"].get("usage") or {}
    required_fields = ["prompt_cache_hit_tokens", "prompt_cache_miss_tokens", "completion_tokens"]
    missing = [f for f in required_fields if f not in usage2]
    record["checks"]["usage_fields_present"] = not missing
    record["checks"]["missing_fields"] = missing
    record["checks"]["cache_hit_on_repeat"] = (usage2.get("prompt_cache_hit_tokens") or 0) > 0
    record["usage_call_2"] = usage2
    record["computed_krw_call_2"] = compute_krw(usage2, model)

    if missing:
        record["verdict"] = "LIVE-FAIL"
        record["reason"] = f"필수 usage 필드 누락: {missing} — worker.js _deepseekUsageToKRW()가 깨질 위험"
    elif not record["checks"]["cache_hit_on_repeat"]:
        record["verdict"] = "LIVE-NEEDS-REVIEW"
        record["reason"] = (
            "동일 프리픽스 2회 호출에도 prompt_cache_hit_tokens가 0 — 캐시가 꺼져있거나 "
            "지연될 수 있음. 필드 자체는 존재하니 치명적은 아니지만, 캐시 미작동이면 "
            "실제 비용이 가정보다 높다는 뜻이라 확인 필요"
        )
    else:
        record["verdict"] = "LIVE-PASS"
        record["reason"] = f"필드 정상 + 캐시 히트 확인됨 (2차 호출 예상 청구액 {record['computed_krw_call_2']}원)"

    results.append(record)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--api-key", default=os.environ.get("DEEPSEEK_API_KEY"))
    args = ap.parse_args()

    if not args.api_key:
        raise SystemExit("DEEPSEEK_API_KEY가 필요합니다(--api-key 또는 환경변수)")

    os.makedirs(args.out, exist_ok=True)
    results = []
    for model in PRICE_TABLE:
        print(f"[{model}] 호출 중...")
        check_model(args.api_key, model, results)
        print(f"    -> {results[-1]['verdict']} ({results[-1]['reason']})")

    with open(os.path.join(args.out, "live_results.json"), "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    summary = {
        "total": len(results),
        "counts": {r["verdict"]: sum(1 for x in results if x["verdict"] == r["verdict"]) for r in results},
    }
    with open(os.path.join(args.out, "live_summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    print("\n=== SUMMARY ===")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print("\n※ 가격표(HONDI_TIER_MODELS) 자체가 맞는지는 위 결과의 usage_call_2를")
    print("   DeepSeek 대시보드 실제 청구내역과 사람이 직접 대조해야 확정됩니다.")
    print("   특히 deepseek-v4-pro의 cacheHit 단가(worker.js: 0.0145)는 최근 웹 검색")
    print("   결과(여러 3자 소스, 0.003625)와 어긋나 별도 확인이 필요합니다.")


if __name__ == "__main__":
    main()
