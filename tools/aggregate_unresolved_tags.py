#!/usr/bin/env python3
"""
tools/aggregate_unresolved_tags.py
-----------------------------------
docs/SP-AUTHOR-AUTOMATION_v1_0.md §1-3(search_miss_pattern)과 동일한 원칙을
새 신호 소스 unresolved_tag_signal(2026-07-14 신설 — expert-session.js
_reportUnresolvedTag가 EXPERT/GWP 태그 해석 실패마다 등록)에 적용한다.

문제의식(§1-3과 동일): 한 사람이 미등록 태그("연금회계사" 등)에 걸려 실패하면
그 한 번만 큐에 남는다. 여러 사람이 같은 미등록 항목에 반복해서 걸리면
매번 개별 레코드로만 쌓이고 "이건 진짜 수요"라는 신호로 승격되지 않는다.

설계:
  1. GET /sp-author/queue?status=queued 로 전체 큐 조회
  2. signal_source가 expert_tag_resolution 또는 gwp_tag_resolution인 것만 필터
  3. 최근 N일(기본 7일) 이내 생성된 것만 대상
  4. institution(raw_id) 기준으로 그룹화 — 이 신호는 institution 필드에
     원본 태그 문자열(raw_id)을 그대로 담아서 큐잉되므로(expert-session.js
     _reportUnresolvedTag 참조), 동일 raw_id는 사실상 동일 미등록 항목이다
     (search_miss_pattern처럼 임베딩 유사도까지는 필요 없다 — 태그 raw_id는
     이미 정규화된 문자열이라 정확히 일치하는 그룹화로 충분하다).
  5. 그룹 크기 ≥ THRESHOLD(기본 3)면:
     - 대표 레코드 1건만 남기고 나머지는 status=duplicate, duplicate_of=대표ID로 병합
     - 대표 레코드의 priority를 high로 승격 (POST /sp-author/queue/:id/status,
       2026-07-14 worker.js 확장 — 이전엔 이 엔드포인트가 priority를 못 받았다)
     - POST /sp-author/escalate로 승격 알림(reason=sp_draft_request) 생성

사용법:
  python3 tools/aggregate_unresolved_tags.py [--dry-run] [--base-url URL]
                                              [--days 7] [--threshold 3]

환경변수:
  HONDI_PROXY_URL — 기본값 https://hondi-proxy.tensor-city.workers.dev
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error
from collections import defaultdict
from datetime import datetime, timedelta, timezone

DEFAULT_BASE_URL = "https://hondi-proxy.tensor-city.workers.dev"
TARGET_SIGNAL_SOURCES = {"expert_tag_resolution", "gwp_tag_resolution"}


def _request(base_url, method, path, body=None, timeout=20):
    url = f"{base_url.rstrip('/')}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except Exception:
            return e.code, {"error": str(e)}
    except urllib.error.URLError as e:
        return None, {"error": str(e)}


def _parse_created(item):
    # PocketBase 기본 형식: "2026-07-14 06:52:00.000Z" 유사 — 안전하게 파싱.
    raw = item.get("created", "")
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00").replace(" ", "T", 1))
    except Exception:
        return None


def fetch_candidates(base_url, days):
    status, data = _request(base_url, "GET", "/sp-author/queue?status=queued")
    if status != 200:
        print(f"[error] 큐 조회 실패: {status} {data}", file=sys.stderr)
        return None
    items = data.get("items", [])
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    filtered = []
    for item in items:
        if item.get("signal_source") not in TARGET_SIGNAL_SOURCES:
            continue
        created = _parse_created(item)
        if created is not None and created < cutoff:
            continue
        filtered.append(item)
    return filtered


def group_by_institution(items):
    groups = defaultdict(list)
    for item in items:
        # institution 필드에 raw_id(태그 원문)가 그대로 들어있다
        # (_reportUnresolvedTag 참조) — 이게 그룹 키다.
        key = (item.get("signal_source"), item.get("institution", ""))
        groups[key].append(item)
    return groups


def promote_group(base_url, key, records, dry_run):
    signal_source, raw_id = key
    kind = "전문가" if signal_source == "expert_tag_resolution" else "서비스"
    # created 오름차순으로 정렬해 가장 먼저 발생한 레코드를 대표로 삼는다
    # (최초 발생 시점 보존 — SP-Author가 "언제부터 이 수요가 있었는지" 볼 수 있게).
    records_sorted = sorted(records, key=lambda r: r.get("created", ""))
    representative = records_sorted[0]
    duplicates = records_sorted[1:]

    print(f"[group] {kind} '{raw_id}' — {len(records)}건 발견 (대표: {representative['id']})")

    if dry_run:
        print(f"  [dry-run] 대표 {representative['id']} priority → high")
        for dup in duplicates:
            print(f"  [dry-run] {dup['id']} → status=duplicate (duplicate_of={representative['id']})")
        return

    # 1) 나머지 레코드를 대표로 병합
    for dup in duplicates:
        pstatus, pdata = _request(
            base_url, "POST", f"/sp-author/queue/{dup['id']}/status",
            {"status": "duplicate", "duplicate_of": representative["id"]},
        )
        if pstatus == 200:
            print(f"  [merged] {dup['id']} → duplicate_of {representative['id']}")
        else:
            print(f"  [warn] {dup['id']} 병합 실패: {pstatus} {pdata}", file=sys.stderr)

    # 2) 대표 레코드 priority 승격
    pstatus, pdata = _request(
        base_url, "POST", f"/sp-author/queue/{representative['id']}/status",
        {"priority": "high"},
    )
    if pstatus == 200:
        print(f"  [promoted] {representative['id']} priority → high")
    else:
        print(f"  [warn] {representative['id']} 승격 실패: {pstatus} {pdata}", file=sys.stderr)
        return

    # 3) 승격 알림
    estatus, edata = _request(base_url, "POST", "/sp-author/escalate", {
        "to": "@owner",
        "reason": "sp_draft_request",
        "ref_collection": "sp_draft_requests",
        "ref_id": representative["id"],
        "summary": (
            f"[unresolved_tag_signal] {kind} '{raw_id}' 반복 실패 {len(records)}건 감지 — "
            f"우선순위 high로 승격 (대표 레코드 {representative['id']})"
        ),
    })
    if estatus == 200:
        print(f"  [escalated] 알림 생성 완료")
    else:
        print(f"  [warn] 알림 생성 실패: {estatus} {edata}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description="unresolved_tag_signal 반복 집계 → 우선순위 승격")
    parser.add_argument("--base-url", default=os.environ.get("HONDI_PROXY_URL", DEFAULT_BASE_URL))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--days", type=int, default=7, help="집계 대상 기간(일), 기본 7일")
    parser.add_argument("--threshold", type=int, default=3, help="승격 최소 건수, 기본 3건")
    args = parser.parse_args()

    items = fetch_candidates(args.base_url, args.days)
    if items is None:
        sys.exit(1)
    print(f"[fetch] 최근 {args.days}일 내 unresolved_tag_signal 후보 {len(items)}건")

    groups = group_by_institution(items)
    promoted = 0
    for key, records in groups.items():
        if len(records) >= args.threshold:
            promote_group(args.base_url, key, records, args.dry_run)
            promoted += 1
    print(f"[done] {promoted}개 그룹 승격 처리 (임계값 {args.threshold}건 이상)")
    sys.exit(0)


if __name__ == "__main__":
    main()
