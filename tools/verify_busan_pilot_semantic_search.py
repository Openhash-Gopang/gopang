#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verify_busan_pilot_semantic_search.py — 부산 파일럿(부산교통공사) 등록
직후, entity-semantic-search가 자연어 쿼리로 실제로 이 프로필을 찾아내는지
확인한다(PR #218 자동 인덱싱 훅이 정말 작동했는지의 최종 확인).

재시도(exponential backoff)는 pilot_entity_semantic_search_29_v2.py의
_http() 패턴을 그대로 가져왔다(known: 이 서버 엔드포인트들이 가끔
타임아웃 낸다 — 이번 세션에서 seed 스크립트로 직접 겪음).

사용:
  python verify_busan_pilot_semantic_search.py \
      --worker-base https://hondi-proxy.tensor-city.workers.dev
"""
import argparse
import json
import sys
import time
import urllib.request
import urllib.error
import urllib.parse

_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
       "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

EXPECTED_SUBTYPE = "org:SP-ORG-BUSANTRANSIT"

QUERIES = [
    "부산교통공사",
    "부산 지하철 운영하는 기관",
    "부산 도시철도 분실물 신고",
    "휴메트로",
]


def _http(worker_base, path, timeout=20, retries=3, backoff_base=2.0):
    last_err = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(
            f"{worker_base.rstrip('/')}{path}",
            headers={"User-Agent": _UA},
            method="GET",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8")), None
        except Exception as e:
            last_err = str(e)
            if attempt < retries:
                print(f"  [재시도 {attempt + 1}/{retries}] {e}", file=sys.stderr)
                time.sleep(backoff_base * (2 ** attempt))
    return None, last_err


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--worker-base", default="https://hondi-proxy.tensor-city.workers.dev")
    ap.add_argument("--limit", type=int, default=10)
    args = ap.parse_args()

    ok_count = 0
    for q in QUERIES:
        qs = urllib.parse.urlencode({"query": q, "etype": "institution", "limit": args.limit})
        data, err = _http(args.worker_base, f"/entity-semantic-search?{qs}")
        if err:
            print(f"❌ \"{q}\" → 조회 실패: {err}")
            continue
        rows = (data or {}).get("candidates", [])
        hit_rank = None
        for i, r in enumerate(rows or []):
            if not isinstance(r, dict):
                continue
            # ★ 2026-08-04 정정 — worker.js의 handleEntitySemanticSearch 응답을
            # 다시 확인하니 {status,count,candidates} 형태이고, 각 candidate는
            # entity_subtype을 최상위가 아니라 extra.public.identity.entity_subtype
            # 에 담고 있었다(newExtra 구조와 동일). 최상위 r.get("entity_subtype")만
            # 보던 최초 버전은 항상 빈 판정만 냈다 — 응답 파싱 버그였다(실제
            # 색인 여부와 무관).
            subtype = (r.get("extra") or {}).get("public", {}).get("identity", {}).get("entity_subtype")
            if subtype == EXPECTED_SUBTYPE:
                hit_rank = i + 1
                break
        if hit_rank:
            ok_count += 1
            print(f"✅ \"{q}\" → {hit_rank}위로 매칭됨 (총 {len(rows)}건 중)")
        else:
            names = [r.get("name") for r in (rows or []) if isinstance(r, dict)][:5]
            status = (data or {}).get("status")
            count = (data or {}).get("count")
            print(f"❌ \"{q}\" → 매칭 안 됨 (API status={status}, count={count}). 상위 결과: {names}")

    print(f"\n총 {len(QUERIES)}건 중 {ok_count}건 매칭됨")
    if ok_count == 0:
        print("한 건도 안 잡히면: 자동 인덱싱 훅이 아직 안 탔거나(색인은 비동기일 수 있음, "
              "몇 분 뒤 재시도 권장), 등록 시 search_text 계산에 필요한 필드(name/description/"
              "occupation/tags)가 실제로 채워졌는지 확인이 필요합니다.")


if __name__ == "__main__":
    main()
