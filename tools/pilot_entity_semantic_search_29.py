#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pilot_entity_semantic_search_29.py — K-Search 의미검색(entity-semantic-search)
소규모 파일럿 검증 (HANDOFF_2026-08-03_PM.md §3-2 설계항목 7).

배경: 오늘(2026-08-03) 3라운드 테스트로 기존 LIKE 기반 검색(_l1SearchEntities)이
자연어 문장(jeju_29_genuine_task_queries.json, 정답 기관명 글자를 하나도 안
쓰고 업무 내용만으로 지은 문장)에 29/29 NO-MATCH(0%)였다는 게 확인됐다.
2026-08-04에 benefit-semantic-search 패턴을 그대로 이식한
handleEntityEmbedIndex(POST /orchestration/entity-embed-index)·
handleEntitySemanticSearch(GET /entity-semantic-search)를 추가했는데,
bge-m3가 한국 행정 도메인 전문용어에서 실제로 얼마나 잘 되는지는
아직 검증 전이다(정직한 한계로 코드 주석에도 명시). 267건 전량 인덱싱
전에 이 29건으로 먼저 확인한다.

절차:
  1) jeju_29_genuine_task_queries.json의 각 entity를 POST /search(기존
     LIKE, 정확한 name으로 조회 — 1라운드가 96.6% 성공했던 것과 동일 조건)
     로 먼저 찾아 guid·description을 확보한다. ★ 이 단계는 파일럿용 guid
     확보 수단일 뿐, 의미검색 자체를 테스트하는 게 아니다.
  2) 확보한 guid로 POST /orchestration/entity-embed-index 호출해
     VECTORIZE_ENTITIES에 인덱싱한다(29건 — 배치 분할 불필요).
  3) 같은 29건의 자연어 query로 GET /entity-semantic-search를 호출해,
     기대 entity_subtype이 top-K 결과에 있는지 채점한다(verify_jeju_267_
     search_match.py의 grade() 로직을 그대로 재사용 — 판정 기준 일관성
     유지, 두 검증 결과를 나란히 비교 가능하게).

★ 이 스크립트는 worker.js가 실제로 배포돼 있고(entity-semantic-search
엔드포인트 포함) VECTORIZE_ENTITIES 인덱스가 사전 생성돼 있어야 동작한다
(wrangler vectorize create hondi-entity-registry --dimensions=1024
--metric=cosine). 로컬/샌드박스에서는 실행할 수 없다 — 배포 권한이 있는
환경에서 실행할 것.

사용:
  python pilot_entity_semantic_search_29.py \
      --worker-base https://hondi-proxy.tensor-city.workers.dev \
      --queries jeju_29_genuine_task_queries.json \
      --out results_entity_semantic_pilot_29
"""
import argparse
import json
import sys
import time
import urllib.request
import urllib.error
import urllib.parse
from pathlib import Path

_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
       "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")


def _http(worker_base, path, method="GET", body=None, timeout=20, retries=3, backoff_base=2.0):
    last_err = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(
            f"{worker_base.rstrip('/')}{path}",
            data=json.dumps(body).encode("utf-8") if body is not None else None,
            headers={"Content-Type": "application/json", "User-Agent": _UA},
            method=method,
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


def extract_description(entity):
    extra = entity.get("extra") or {}
    public = extra.get("public") or {}
    identity = public.get("identity") or {}
    return identity.get("description") or ""


def grade(expected_subtype, results):
    """results: /entity-semantic-search candidates. verify_jeju_267_search_
    match.py의 grade()와 동일한 판정 기준(순위·WRONG-MATCH/NO-MATCH 구분)을
    재사용해, 기존 LIKE 결과와 나란히 비교 가능하게 한다."""
    if not results:
        return "NO-MATCH", "검색 결과 0건", None, None

    found_subtypes = []
    for r in results:
        st = extract_subtype(r)
        found_subtypes.append(st)
        if st == expected_subtype:
            rank = found_subtypes.index(st)
            score = r.get("score")
            if rank == 0:
                return "MATCH-TOP1", f"1순위 매칭 (score={score})", r.get("guid"), score
            return "MATCH-LOWER", f"{rank+1}순위 매칭 (score={score})", r.get("guid"), score

    return "WRONG-MATCH", f"기대 {expected_subtype} 없음, 실제: {found_subtypes[:5]}", None, None


def resolve_guid_and_description(worker_base, entity, timeout, retries, backoff_base):
    """1단계 — 기존 LIKE 검색(정확한 name)으로 guid·description 확보."""
    body = {"q": entity["name"], "etype": "institution", "lim": 5}
    data, err = _http(worker_base, "/search", method="POST", body=body,
                       timeout=timeout, retries=retries, backoff_base=backoff_base)
    if err is not None:
        return None, None, f"조회 실패: {err}"
    for r in (data or []):
        if extract_subtype(r) == entity["entity_subtype"]:
            return r.get("primary_guid") or r.get("guid"), extract_description(r), None
    return None, None, "정확한 name으로도 entity_subtype 매칭 실패 — 파일럿 대상에서 제외"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--worker-base", default="https://hondi-proxy.tensor-city.workers.dev")
    ap.add_argument("--queries", default="jeju_29_genuine_task_queries.json")
    ap.add_argument("--out", default="results_entity_semantic_pilot_29")
    ap.add_argument("--timeout", type=int, default=25)
    ap.add_argument("--retries", type=int, default=3)
    ap.add_argument("--backoff-base", type=float, default=2.0)
    ap.add_argument("--limit", type=int, default=10, help="entity-semantic-search topK")
    ap.add_argument("--skip-index", action="store_true",
                     help="이미 인덱싱된 상태에서 쿼리 채점만 다시 돌릴 때")
    args = ap.parse_args()

    entities = json.load(open(args.queries, encoding="utf-8"))
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    # ── 1단계: guid·description 확보 ──
    print(f"[1/3] {len(entities)}건 guid·description 확보 중(기존 LIKE 검색)…")
    resolved = []
    for i, e in enumerate(entities, 1):
        guid, desc, err = resolve_guid_and_description(
            args.worker_base, e, args.timeout, args.retries, args.backoff_base)
        status = "OK" if guid else "SKIP"
        print(f"  [{i}/{len(entities)}] {status:5s} {e['name']} — {err or ''}")
        if guid:
            resolved.append({**e, "guid": guid, "description": desc})

    if not resolved:
        print("[FATAL] guid를 확보한 entity가 0건 — 인덱싱·채점 진행 불가")
        sys.exit(1)

    # ── 2단계: 인덱싱 ──
    if not args.skip_index:
        print(f"\n[2/3] {len(resolved)}건 인덱싱 중(POST /orchestration/entity-embed-index)…")
        records = [{
            "guid": r["guid"],
            "name": r["name"],
            "description": r["description"],
            "entity_type": "institution",
            "entity_subtype": r["entity_subtype"],
        } for r in resolved]
        idx_result, err = _http(args.worker_base, "/orchestration/entity-embed-index",
                                 method="POST", body={"records": records},
                                 timeout=args.timeout, retries=args.retries,
                                 backoff_base=args.backoff_base)
        if err is not None:
            print(f"[FATAL] 인덱싱 실패: {err}")
            sys.exit(1)
        print(f"  → {idx_result}")
        print("  (Vectorize eventual consistency — 조회 전 몇 초 대기 권장)")
        time.sleep(5)
    else:
        print("\n[2/3] --skip-index — 인덱싱 생략")

    # ── 3단계: 자연어 쿼리 채점 ──
    print(f"\n[3/3] {len(resolved)}건 자연어 쿼리 채점 중(GET /entity-semantic-search)…")
    jsonl_path = out_dir / "pilot_results.jsonl"
    counts = {}
    with open(jsonl_path, "w", encoding="utf-8") as jf:
        for i, r in enumerate(resolved, 1):
            qs = urllib.parse.urlencode({
                "query": r["query"], "etype": "institution", "limit": args.limit,
            })
            data, err = _http(args.worker_base, f"/entity-semantic-search?{qs}",
                               method="GET", timeout=args.timeout, retries=args.retries,
                               backoff_base=args.backoff_base)
            if err is not None:
                status, detail, guid, score = "CHECK-FAILED", f"조회 실패: {err}", None, None
            else:
                candidates = (data or {}).get("candidates", [])
                status, detail, guid, score = grade(r["entity_subtype"], candidates)

            counts[status] = counts.get(status, 0) + 1
            record = {
                "tier": r.get("tier"), "name": r["name"], "query": r["query"],
                "entity_subtype": r["entity_subtype"], "status": status,
                "detail": detail, "matched_guid": guid, "score": score,
            }
            jf.write(json.dumps(record, ensure_ascii=False) + "\n")
            jf.flush()
            print(f"  [{i}/{len(resolved)}] {status:14s} {r['name']}")

    summary = {"total": len(resolved), "counts": counts}
    json.dump(summary, open(out_dir / "pilot_summary.json", "w", encoding="utf-8"),
               ensure_ascii=False, indent=2)
    print("\n=== 요약 ===")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"\n상세: {jsonl_path}")
    print("\n비교 기준(오늘 3라운드 LIKE 검색 결과, 같은 29건):")
    print("  1차(정답 이름 그대로): 96.6% / 2차(접두어 제거): 73.4% / 3차(순수 자연어): 0%")
    print("  이 파일럿의 status 분포(특히 MATCH-TOP1+MATCH-LOWER 비율)를 3차와 비교해")
    print("  bge-m3 의미검색이 실제로 그 격차를 메우는지 판단할 것.")


if __name__ == "__main__":
    main()
