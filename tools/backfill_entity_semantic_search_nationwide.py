#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
backfill_entity_semantic_search_nationwide.py — HANDOFF_2026-08-03_PM.md
§3-2 설계항목5. 전국 institution 프로필 전수를 배치(최대 100건/호출,
Workers AI 배치 한도)로 entity-semantic-search에 임베딩·인덱싱한다.

배경: §3-2 항목4(자동 인덱싱 훅)로 "앞으로 생성되는" 프로필은 자동으로
인덱싱되지만, 이미 존재하는 프로필들(전국 gov-tree 시딩분 포함)은 훅이
생기기 전에 만들어졌으므로 소급 인덱싱이 필요하다. 오늘 §3-2 파일럿으로
검증된 교훈을 그대로 반영한다:
  - description이 아니라 search_text를 임베딩 원문으로 쓴다(description은
    field_visibility 기본 비공개라 공개 API로는 비어있는 경우가 많았음
    — institution 기본 공개 정책 패치를 이미 적용했다면 이제 description도
    채워지지만, search_text가 name+handle+description+occupation+tags를
    이미 조합해둔 완제품이라 그대로 쓰는 편이 더 안전하고 일관적이다).
  - L1 PocketBase를 worker.js 우회해서 직접 페이지네이션 조회한다
    (is_public=true 공개 레코드라 admin 토큰 없이도 읽힌다) — /search는
    LIKE 필터라 "전수 나열"에 안 맞고, entity-embed-index 자체는 admin
    토큰이 필요해 worker.js를 거쳐야 한다(그래서 인덱싱 호출만 worker
    경유, 목록 조회는 L1 직접).

대상: entity_type = 'institution' 전체(제주 267건에 한정하지 않고 전국).
gov-tree seed 여부로 좁히지 않은 이유: entity-semantic-search가 검색
대상으로 삼아야 할 건 "institution 전체"이지 "gov-tree로 시딩된 것"이라는
출처 기준이 아니기 때문 — 수동 등록된 기관도 똑같이 검색 가능해야 한다.

사용:
  python backfill_entity_semantic_search_nationwide.py \
      --worker-base https://hondi-proxy.tensor-city.workers.dev \
      --out results_entity_semantic_backfill_nationwide

  # 먼저 소규모로 시험(권장 — 전량 인덱싱 전에 100건만):
  python backfill_entity_semantic_search_nationwide.py --max-total 100

  # 중단 후 이어서(진행상황은 --out 아래 progress.json에 커서로 기록):
  python backfill_entity_semantic_search_nationwide.py --resume

  # 실제 인덱싱 없이 몇 건이 대상인지만 확인:
  python backfill_entity_semantic_search_nationwide.py --dry-run
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

L1_BASE = "https://l1-hanlim.hondi.net"
L1_PAGE_SIZE = 100  # entity-embed-index의 배치 한도(100건/호출)와 맞춤 — 페이지=배치


def _l1_list_page(entity_type, page, per_page, sort_field, timeout, retries, backoff_base):
    """L1 PocketBase 페이지네이션 목록 조회 — 공개(is_public=true) 레코드라
    admin 토큰 없이 읽힌다."""
    filt = urllib.request.quote(f"entity_type = '{entity_type}'")
    url = (f"{L1_BASE}/api/collections/profiles/records"
           f"?filter={filt}&perPage={per_page}&page={page}&sort={sort_field}")
    last_err = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, headers={"User-Agent": _UA})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8")), None
        except Exception as e:
            last_err = str(e)
            if attempt < retries:
                time.sleep(backoff_base * (2 ** attempt))
    return None, last_err


def _embed_index_batch(worker_base, records, timeout, retries, backoff_base):
    body = json.dumps({"records": records}).encode("utf-8")
    last_err = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(
            f"{worker_base.rstrip('/')}/orchestration/entity-embed-index",
            data=body,
            headers={"Content-Type": "application/json", "User-Agent": _UA},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8")), None
        except Exception as e:
            last_err = str(e)
            if attempt < retries:
                time.sleep(backoff_base * (2 ** attempt))
    return None, last_err


def _record_to_embed_payload(p):
    extra = p.get("extra") or {}
    identity = (extra.get("public") or {}).get("identity") or {}
    search_text = p.get("search_text") or p.get("name") or ""
    return {
        "guid": p.get("guid"),
        "name": p.get("name"),
        "description": search_text,  # ★ description 자리에 search_text 투입 — §3-2 파일럿 교훈
        "entity_type": p.get("entity_type"),
        "entity_subtype": identity.get("entity_subtype"),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--worker-base", default="https://hondi-proxy.tensor-city.workers.dev")
    ap.add_argument("--out", default="results_entity_semantic_backfill_nationwide")
    ap.add_argument("--entity-type", default="institution")
    ap.add_argument("--sort", default="created", help="L1 정렬 필드 — 안정적 페이지네이션 위해 고정 정렬 필요")
    ap.add_argument("--timeout", type=int, default=30)
    ap.add_argument("--retries", type=int, default=3)
    ap.add_argument("--backoff-base", type=float, default=2.0)
    ap.add_argument("--sleep-between-batches", type=float, default=1.5,
                     help="배치 사이 대기(초) — Workers AI 요청 폭주 방지")
    ap.add_argument("--max-total", type=int, default=None, help="시험용 상한(전량 인덱싱 전 소규모 검증)")
    ap.add_argument("--resume", action="store_true", help="progress.json의 마지막 완료 페이지부터 재개")
    ap.add_argument("--dry-run", action="store_true", help="인덱싱 호출 없이 대상 건수·내용만 확인")
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    progress_path = out_dir / "progress.json"
    log_path = out_dir / "backfill_log.jsonl"

    start_page = 1
    total_indexed = 0
    total_skipped = 0
    if args.resume and progress_path.exists():
        prog = json.loads(progress_path.read_text(encoding="utf-8"))
        start_page = prog.get("next_page", 1)
        total_indexed = prog.get("total_indexed", 0)
        total_skipped = prog.get("total_skipped", 0)
        print(f"[재개] {start_page}페이지부터 재개 (지금까지 인덱싱 {total_indexed}건)")

    page = start_page
    log_mode = "a" if (args.resume and log_path.exists()) else "w"
    logf = open(log_path, log_mode, encoding="utf-8")

    try:
        while True:
            data, err = _l1_list_page(args.entity_type, page, L1_PAGE_SIZE, args.sort,
                                       args.timeout, args.retries, args.backoff_base)
            if err is not None:
                print(f"[FATAL] {page}페이지 조회 실패(재시도 {args.retries}회 모두 실패): {err}")
                print("        --resume으로 이어서 실행하세요.")
                sys.exit(1)

            items = data.get("items", [])
            total_pages = data.get("totalPages", page)
            total_items = data.get("totalItems", "?")

            if not items:
                print(f"[완료] {page}페이지에 항목 없음 — 종료.")
                break

            print(f"[{page}/{total_pages}페이지, 전체 {total_items}건] {len(items)}건 처리 중…")

            records = [_record_to_embed_payload(p) for p in items]
            records = [r for r in records if r["guid"] and r["name"]]
            skipped_this_page = len(items) - len(records)
            total_skipped += skipped_this_page

            if args.dry_run:
                print(f"  [dry-run] 인덱싱 대상 {len(records)}건(스킵 {skipped_this_page}건) — 실제 호출 안 함")
                for r in records[:3]:
                    print("    예시:", json.dumps(r, ensure_ascii=False)[:200])
            else:
                idx_result, err = _embed_index_batch(args.worker_base, records,
                                                       args.timeout, args.retries, args.backoff_base)
                if err is not None:
                    print(f"[FATAL] {page}페이지 인덱싱 실패: {err}")
                    print("        --resume으로 이 페이지부터 재시도하세요.")
                    sys.exit(1)
                print(f"  → {idx_result}")
                total_indexed += len(records)

            logf.write(json.dumps({
                "page": page, "items": len(items), "indexed": len(records),
                "skipped": skipped_this_page, "dry_run": args.dry_run,
            }, ensure_ascii=False) + "\n")
            logf.flush()

            progress_path.write_text(json.dumps({
                "next_page": page + 1, "total_indexed": total_indexed, "total_skipped": total_skipped,
            }, ensure_ascii=False), encoding="utf-8")

            if args.max_total and total_indexed >= args.max_total:
                print(f"[중단] --max-total {args.max_total}건 도달 — 시험 실행 종료.")
                break
            if page >= total_pages:
                print("[완료] 전 페이지 처리 완료.")
                break

            page += 1
            time.sleep(args.sleep_between_batches)
    finally:
        logf.close()

    print("\n=== 요약 ===")
    print(json.dumps({
        "total_indexed": total_indexed, "total_skipped": total_skipped, "last_page": page,
        "dry_run": args.dry_run,
    }, ensure_ascii=False, indent=2))
    print(f"\n로그: {log_path}")
    print(f"진행상황: {progress_path} (--resume으로 이어서 실행 가능)")


if __name__ == "__main__":
    main()
