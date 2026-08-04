#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pilot_entity_semantic_search_29_v2.py — v1과 동일한 목적(K-Search 의미검색
파일럿 검증)이지만, guid·임베딩 원문 확보 방식을 바꿨다.

v1의 문제(2026-08-04 실사로 발견): guid·description을 POST /search(공개
검색, LIKE 기반)로 확보했는데, _filterProfileByVisibility가
field_visibility.description이 명시적 true가 아니면 description을
기본 비공개로 지운다(개인정보 보호 목적 — 기관에는 안 맞는 기본값이지만
별도 정책 결정 사항). 그래서 v1은 29건 전부 빈 description으로
인덱싱했고, 이름만으로 임베딩되다 보니 "소통청렴담당관"·"기획조정실"·
"대변인"처럼 이름 자체가 범용적인 기관이 모든 쿼리의 상위권을 휩쓰는
현상(WRONG-MATCH 4건 전부 이 3개가 오답으로 낌)이 나타났다.

v2는 L1 PocketBase를 직접 조회한다(is_public=true 공개 레코드라
admin 토큰 없이도 읽힌다) — description 대신 필터링을 안 거치는
`search_text` 필드를 쓴다. 이 필드는 name+description+occupation+
gov-tree 계층 태그를 이미 조합해둔 완제품이라, 별도 구성 로직 없이
그대로 임베딩 원문으로 넣는다. 인덱싱·쿼리 엔드포인트(entity-embed-index/
entity-semantic-search) 자체는 안 바뀐다 — 원문 품질만 개선.

사용:
  python pilot_entity_semantic_search_29_v2.py \
      --worker-base https://hondi-proxy.tensor-city.workers.dev \
      --queries jeju_29_genuine_task_queries.json \
      --out results_entity_semantic_pilot_29_v2
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

L1_BASE = "https://l1-hanlim.hondi.net"


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


def _l1_direct(name, timeout=15, retries=3, backoff_base=2.0):
    """L1 PocketBase를 worker.js 우회해서 직접 조회 — 공개 레코드는
    is_public listRule 덕에 admin 토큰 없이도 읽힌다. field_visibility
    필터링을 안 거치므로 search_text 원본을 그대로 얻는다."""
    filt = urllib.parse.quote(f"name = '{name}'")
    url = f"{L1_BASE}/api/collections/profiles/records?filter={filt}&perPage=1"
    last_err = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, headers={"User-Agent": _UA})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = json.loads(r.read().decode("utf-8"))
                items = data.get("items", [])
                return (items[0] if items else None), None
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


def grade(expected_subtype, results):
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--worker-base", default="https://hondi-proxy.tensor-city.workers.dev")
    ap.add_argument("--queries", default="jeju_29_genuine_task_queries.json")
    ap.add_argument("--out", default="results_entity_semantic_pilot_29_v2")
    ap.add_argument("--timeout", type=int, default=25)
    ap.add_argument("--retries", type=int, default=3)
    ap.add_argument("--backoff-base", type=float, default=2.0)
    ap.add_argument("--limit", type=int, default=10)
    ap.add_argument("--skip-index", action="store_true")
    args = ap.parse_args()

    entities = json.load(open(args.queries, encoding="utf-8"))
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    # ── 1단계: L1 직접조회로 guid·search_text 확보 ──
    print(f"[1/3] {len(entities)}건 guid·search_text 확보 중(L1 직접조회, 필터링 우회)…")
    resolved = []
    for i, e in enumerate(entities, 1):
        p, err = _l1_direct(e["name"], args.timeout, args.retries, args.backoff_base)
        if err is not None:
            print(f"  [{i}/{len(entities)}] SKIP  {e['name']} — 조회 실패: {err}")
            continue
        if not p:
            print(f"  [{i}/{len(entities)}] SKIP  {e['name']} — L1에 없음")
            continue
        search_text = p.get("search_text") or p.get("name") or e["name"]
        resolved.append({**e, "guid": p.get("guid"), "search_text": search_text})
        print(f"  [{i}/{len(entities)}] OK    {e['name']} — search_text {len(search_text)}자")

    if not resolved:
        print("[FATAL] guid를 확보한 entity가 0건 — 인덱싱·채점 진행 불가")
        sys.exit(1)

    # ── 2단계: 인덱싱(search_text를 description 자리에 그대로 투입) ──
    if not args.skip_index:
        print(f"\n[2/3] {len(resolved)}건 재인덱싱 중(원문: search_text)…")
        records = [{
            "guid": r["guid"],
            "name": r["name"],
            "description": r["search_text"],  # ★ v1의 빈 description 대신 search_text
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
        print("  (Vectorize eventual consistency — 조회 전 대기 권장)")
        time.sleep(10)
    else:
        print("\n[2/3] --skip-index — 인덱싱 생략")

    # ── 3단계: 채점 ──
    print(f"\n[3/3] {len(resolved)}건 자연어 쿼리 채점 중…")
    jsonl_path = out_dir / "pilot_results.jsonl"
    counts = {}
    with open(jsonl_path, "w", encoding="utf-8") as jf:
        for i, r in enumerate(resolved, 1):
            qs = urllib.parse.urlencode({"query": r["query"], "etype": "institution", "limit": args.limit})
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
    print("\n비교 기준:")
    print("  LIKE 3차(순수 자연어): 0%")
    print("  v1(빈 description, 이름만 임베딩): TOP1 37.9% / LOWER 48.3% / WRONG 13.8%")
    print("  이 v2(search_text 임베딩) 결과와 비교해 원문 보강 효과를 판단할 것.")


if __name__ == "__main__":
    main()
