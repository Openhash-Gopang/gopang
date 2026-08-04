#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verify_busan_pilot_live_ksearch.py — 부산 파일럿(부산교통공사)이 실제
K-Search 실행 경로(POST /search, LIKE 기반 _l1SearchEntities)로 찾아지는지
검증한다.

★ 2026-08-04 정정 ★ 이전에 만든 verify_busan_pilot_semantic_search.py는
GET /entity-semantic-search(Vectorize 기반)를 검증했는데, 이건 실제 사용자
발화가 지나가는 경로가 아니다 — call-ai.js의 _handleKSearchExecutionTag
(SP-18 K-Search [SEARCH] 태그 실행부, 오늘도 여전히 실사용 중)는 지금도
POST /search(LIKE 기반 _l1SearchEntities)만 호출한다. entity-semantic-search
로의 전환(§3-2 항목6)은 아직 미착수 상태다 — 그러니 "이 프로필이 지금
실제로 사용자에게 도달 가능한가"를 확인하려면 이 엔드포인트로 검증해야
정확하다.

사용:
  python verify_busan_pilot_live_ksearch.py \
      --worker-base https://hondi-proxy.tensor-city.workers.dev
"""
import argparse
import json
import sys
import time
import urllib.request
import urllib.error

_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
       "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

EXPECTED_SUBTYPE = "org:SP-ORG-BUSANTRANSIT"

# call-ai.js _handleKSearchExecutionTag가 실제로 SP-18로부터 받는 것과
# 동일한 형태의 파라미터(p_keyword 등 alias, handleSearch 참조)를 쓴다.
QUERIES = ["부산교통공사", "휴메트로", "부산 지하철", "부산 도시철도"]


def _search(worker_base, q, timeout=20, retries=3, backoff_base=2.0):
    last_err = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(
            f"{worker_base.rstrip('/')}/search",
            data=json.dumps({"q": q, "etype": "institution", "lim": 20}).encode("utf-8"),
            headers={"Content-Type": "application/json", "User-Agent": _UA},
            method="POST",
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


def _extract_subtype(entity):
    """handleSearch 응답 형태 — 최상위 entity_subtype 필드로 오는지,
    extra.public.identity.entity_subtype 중첩으로 오는지 둘 다 확인한다
    (직전 검증 스크립트에서 응답 구조를 잘못 짐작했던 실수를 반복하지
    않기 위해 양쪽 다 본다)."""
    if not isinstance(entity, dict):
        return None
    if entity.get("entity_subtype"):
        return entity["entity_subtype"]
    identity = (entity.get("extra") or {}).get("public", {}).get("identity", {})
    return identity.get("entity_subtype")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--worker-base", default="https://hondi-proxy.tensor-city.workers.dev")
    args = ap.parse_args()

    ok_count = 0
    for q in QUERIES:
        data, err = _search(args.worker_base, q)
        if err:
            print(f"❌ \"{q}\" → 조회 실패: {err}")
            continue
        rows = data if isinstance(data, list) else []
        hit_rank = None
        for i, r in enumerate(rows):
            if _extract_subtype(r) == EXPECTED_SUBTYPE:
                hit_rank = i + 1
                break
        if hit_rank:
            ok_count += 1
            print(f"✅ \"{q}\" → {hit_rank}위로 매칭됨 (총 {len(rows)}건 중, 실제 K-Search 경로)")
        else:
            names = [r.get("name") for r in rows if isinstance(r, dict)][:5]
            print(f"❌ \"{q}\" → 매칭 안 됨(총 {len(rows)}건 반환). 상위 결과: {names}")

    print(f"\n총 {len(QUERIES)}건 중 {ok_count}건 매칭됨 (실제 K-Search 실행 경로 기준)")
    if ok_count == 0:
        print("한 건도 안 잡히면: LIKE 기반 검색이라 name/handle/occupation/address/search_text 컬럼 "
              "중 하나에 쿼리어가 부분일치해야 한다 — 등록된 name(\"부산교통공사\")과 정확히 겹치는 "
              "쿼리(\"휴메트로\" 등 별칭)는 name 필드에 없으니 못 찾는 게 오히려 정상일 수 있다. "
              "\"부산교통공사\" 쿼리조차 안 잡히면 그때는 진짜 문제(등록 자체 실패 또는 is_public 등)를 봐야 한다.")


if __name__ == "__main__":
    main()
