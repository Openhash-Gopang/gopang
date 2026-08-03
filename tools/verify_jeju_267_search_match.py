#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verify_jeju_267_search_match.py — 제주 지역 267개 기관/부서 K-Search 매칭
정확도 결정론적 검증.

배경: AC의 판단력(①, LLM 필요) 테스트와 검색·매칭 정확도(②, LLM 불필요)
테스트를 분리한다 — 후자는 POST /search(_l1SearchEntities, profiles
컬렉션)에 기관명을 직접 던져서, 반환된 entity_subtype이 기대값과
일치하는지만 확인하는 순수 백엔드 함수 테스트다. DeepSeek API 호출이
전혀 없어 267건이든 향후 수백만 건이든 비용·시간 없이 스케일한다.

입력: jeju_267_entities.json (name, entity_subtype, query 필드 포함)
출력: match_results.jsonl(건별 상세) + match_summary.json(집계)

주의: /search 엔드포인트가 타임아웃을 자주 낸다는 게 어제
seed_gov_tree_citydept_natagency.py 실행에서 이미 확인됐다(15초 timeout
+ 5~7건 SKIP-UNCERTAIN). 이 스크립트는 그 경험을 반영해 재시도(exponential
backoff)를 기본 내장한다 — "확인 실패"와 "매칭 실패"를 반드시 구분해서
보고한다(전자를 후자로 오판하면 어제와 같은 종류의 착오가 재발한다).

사용:
  python verify_jeju_267_search_match.py \
      --worker-base https://hondi-proxy.tensor-city.workers.dev \
      --entities jeju_267_entities.json \
      --out results_jeju_267_match
"""
import argparse
import json
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
       "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")


def search(worker_base, query, timeout, retries, backoff_base, lat=None, lng=None):
    """POST /search — 재시도 포함. 반환: (raw_response_or_None, error_or_None)"""
    last_err = None
    body = {"q": query, "etype": "institution", "lim": 10}
    # 2026-08-03 신설 — 한림읍 금능남로 거주 전제 반영. lat/lng을 실어
    # 보내면 _l1SearchEntities가 distance_km을 계산해 동점 시 실제 거리
    # 기준으로 재정렬한다(AC가 PDV로 위치를 이미 아는 실제 상황에 더 가까움).
    if lat is not None and lng is not None:
        body["lat"] = lat
        body["lng"] = lng
    for attempt in range(retries + 1):
        req = urllib.request.Request(
            f"{worker_base.rstrip('/')}/search",
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json", "User-Agent": _UA},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8")), None
        except Exception as e:
            last_err = str(e)
            if attempt < retries:
                time.sleep(backoff_base * (2 ** attempt))
    return None, last_err


def extract_subtype(entity):
    extra = entity.get("extra") or {}
    public = extra.get("public") or {}
    identity = public.get("identity") or {}
    return identity.get("entity_subtype")


def grade(entity_record, results):
    """results: /search 응답 리스트. 기대 entity_subtype이 결과 안에 있는지 확인."""
    expected = entity_record["entity_subtype"]
    if not results:
        return "NO-MATCH", "검색 결과 0건", None

    found_subtypes = []
    for r in results:
        st = extract_subtype(r)
        found_subtypes.append(st)
        if st == expected:
            rank = found_subtypes.index(st)
            if rank == 0:
                return "MATCH-TOP1", f"1순위로 정확히 매칭 (guid={r.get('primary_guid')})", r.get("primary_guid")
            return "MATCH-LOWER", f"{rank+1}순위에서 매칭 — 상위에 다른 후보 존재 (guid={r.get('primary_guid')})", r.get("primary_guid")

    return "WRONG-MATCH", f"기대 {expected} 없음, 실제 반환: {found_subtypes[:5]}", None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--worker-base", default="https://hondi-proxy.tensor-city.workers.dev")
    ap.add_argument("--entities", default="jeju_267_entities.json")
    ap.add_argument("--out", default="results_jeju_267_match")
    ap.add_argument("--timeout", type=int, default=20)
    ap.add_argument("--retries", type=int, default=3)
    ap.add_argument("--backoff-base", type=float, default=2.0)
    ap.add_argument("--only-tier", default=None, help="쉼표구분, 예: do-dept,city-div")
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--lat", type=float, default=None,
                     help="사용자 위치 위도(예: 한림읍 금능남로 ~= 33.394)")
    ap.add_argument("--lng", type=float, default=None,
                     help="사용자 위치 경도(예: 한림읍 금능남로 ~= 126.240)")
    args = ap.parse_args()

    entities = json.load(open(args.entities, encoding="utf-8"))
    if args.only_tier:
        want = set(t.strip() for t in args.only_tier.split(","))
        entities = [e for e in entities if e["tier"] in want]

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    jsonl_path = out_dir / "match_results.jsonl"

    done = set()
    if args.resume and jsonl_path.exists():
        for line in open(jsonl_path, encoding="utf-8"):
            try:
                done.add(json.loads(line)["entity_subtype"])
            except Exception:
                pass

    print(f"총 {len(entities)}건 (재개모드: {len(done)}건 이미 완료)")

    mode = "a" if args.resume and jsonl_path.exists() else "w"
    counts = {}
    with open(jsonl_path, mode, encoding="utf-8") as jf:
        for i, e in enumerate(entities, 1):
            if e["entity_subtype"] in done:
                continue
            results, err = search(args.worker_base, e["query"], args.timeout, args.retries,
                                   args.backoff_base, lat=args.lat, lng=args.lng)
            if err is not None:
                status, detail, guid = "CHECK-FAILED", f"재시도 {args.retries}회 모두 실패: {err}", None
            else:
                status, detail, guid = grade(e, results)

            counts[status] = counts.get(status, 0) + 1
            record = {
                "tier": e["tier"], "name": e["name"], "query": e["query"],
                "entity_subtype": e["entity_subtype"], "status": status,
                "detail": detail, "matched_guid": guid,
            }
            jf.write(json.dumps(record, ensure_ascii=False) + "\n")
            jf.flush()
            print(f"[{i}/{len(entities)}] {status:14s} {e['tier']:14s} {e['name']}")

    summary = {"total": len(entities), "counts": counts}
    json.dump(summary, open(out_dir / "match_summary.json", "w", encoding="utf-8"),
               ensure_ascii=False, indent=2)
    print("\n=== 요약 ===")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"\n상세: {jsonl_path}")


if __name__ == "__main__":
    main()
