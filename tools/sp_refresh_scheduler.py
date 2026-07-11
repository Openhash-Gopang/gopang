#!/usr/bin/env python3
"""
sp_refresh_scheduler.py — SP 정기 갱신 스케줄러 (파이프라인 보완계획 Phase 4)
저장 위치: gopang/tools/sp_refresh_scheduler.py

역할: 이 저장소 안에는 크론이 없다(worker.js는 무상태 HTTP 핸들러만 제공한다는
원칙, docs/SP-AUTHOR-AUTOMATION_v1_0.md 참조) — 그래서 이 스크립트를
.github/workflows/sp-refresh-scheduler.yml이 매일 실행해 "저장소 밖 스케줄러"
역할을 대신한다.

두 단계:
  1) tier 재계산 — gwp_registry의 active 항목 전체를 조회해, call_count_30d
     기준(docs/SP-AUTHOR-AUTOMATION_v1_0.md §2-2 표와 동일한 절대 임계값)으로
     weekly/monthly/quarterly를 재배정하고 POST /sp-author/refresh-schedule로
     반영한다. Phase 0(계측)이 이제 막 배포돼 데이터가 적을 수 있으므로,
     call_count_30d가 아예 없거나 0인 항목은 기본값 monthly로 둔다(과소추정
     방지 — 데이터 부족을 "안 써서 낮은 등급"으로 오판하지 않는다).
  2) 갱신 큐잉 — GET /sp-author/refresh-due로 마감 도래 항목을 가져와
     POST /sp-author/queue(signal_source=refresh_schedule, request_type=update)
     로 SP-Author 큐에 넣는다. 실제 조사·갱신(PHASE UPDATE)은 여전히 사람이
     수행한다 — 이 스크립트는 "무엇을 갱신해야 하는지"만 큐에 올린다.

사용법:
  python3 tools/sp_refresh_scheduler.py [--dry-run] [--base-url URL]

환경변수:
  HONDI_PROXY_URL — 기본값 https://hondi-proxy.tensor-city.workers.dev
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error
import urllib.parse

DEFAULT_BASE_URL = "https://hondi-proxy.tensor-city.workers.dev"

# docs/SP-AUTHOR-AUTOMATION_v1_0.md §2-2 표와 동일 — 절대 임계값(퍼센타일
# 실시간 계산 아님. 항목 수가 적을 때 퍼센타일은 왜곡되기 쉬워, 문서에
# 명시된 예시 수치를 그대로 절대 기준으로 쓴다).
WEEKLY_THRESHOLD = 200
MONTHLY_THRESHOLD = 20


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


def _tier_for(call_count):
    # 데이터 부족(0 또는 None)은 monthly로 — "안 써서 낮은 등급"으로
    # 오판하지 않는다(§SP-AUTHOR-AUTOMATION_v1_0.md §2-2 최초 배정 원칙과
    # 동일 정신, Phase 0 이제 막 켜져서 데이터가 적은 지금 특히 중요).
    if not call_count:
        return "monthly"
    if call_count >= WEEKLY_THRESHOLD:
        return "weekly"
    if call_count >= MONTHLY_THRESHOLD:
        return "monthly"
    return "quarterly"


def recompute_tiers(base_url, dry_run):
    status, data = _request(base_url, "GET", "/gwp-registry/search?limit=1000")
    if status != 200:
        print(f"[error] gwp-registry/search 실패: {status} {data}", file=sys.stderr)
        return 1
    items = data.get("items", [])
    print(f"[tier] active 항목 {len(items)}개 확인")

    changed = 0
    for entry in items:
        gwp_id = entry.get("gwp_id")
        call_count = entry.get("call_count_30d")
        tier = _tier_for(call_count)
        current_tier = entry.get("tier")
        # entry.tier는 gwp_registry(범주: core/institutional/...)의 필드고
        # sp_refresh_schedule.tier(주기: weekly/monthly/quarterly)는 별개
        # 스키마다 — 여기서는 후자를 계산해서 refresh-schedule에만 반영한다.
        if dry_run:
            print(f"  [dry-run] {gwp_id}: call_count_30d={call_count} → tier={tier}")
            continue
        rstatus, rdata = _request(base_url, "POST", "/sp-author/refresh-schedule", {
            "sp_id": gwp_id,
            "tier": tier,
            "call_count_30d": call_count or 0,
        })
        if rstatus == 200:
            changed += 1
        else:
            print(f"  [warn] {gwp_id} 갱신스케줄 반영 실패: {rstatus} {rdata}", file=sys.stderr)
    print(f"[tier] {changed}개 반영 완료")
    return 0


def queue_due_refreshes(base_url, dry_run):
    status, data = _request(base_url, "GET", "/sp-author/refresh-due")
    if status != 200:
        print(f"[error] refresh-due 조회 실패: {status} {data}", file=sys.stderr)
        return 1
    items = data.get("items", [])
    print(f"[due] 갱신 마감 도래 {len(items)}건")

    for item in items:
        sp_id = item.get("sp_id")
        if dry_run:
            print(f"  [dry-run] {sp_id} → 갱신 큐잉 예정")
            continue
        qstatus, qdata = _request(base_url, "POST", "/sp-author/queue", {
            "request_type": "update",
            "signal_source": "refresh_schedule",
            "target_sp_id": sp_id,
            "task": "정기 갱신 — tier 스케줄 도래(수치·법령·연락처 재검증)",
            "priority": "low",  # 실사용자 신호(kcompose_match_fail 등)보다 낮은 우선순위 — SP-AUTHOR-AUTOMATION_v1_0.md §1-4 gov_data_monitor와 동일한 선제적/저우선 원칙
        })
        if qstatus == 200:
            print(f"  [queued] {sp_id}: {qdata.get('status')}")
        else:
            print(f"  [warn] {sp_id} 큐잉 실패: {qstatus} {qdata}", file=sys.stderr)
    return 0


def main():
    parser = argparse.ArgumentParser(description="SP 정기 갱신 스케줄러(Phase 4)")
    parser.add_argument("--base-url", default=os.environ.get("HONDI_PROXY_URL", DEFAULT_BASE_URL))
    parser.add_argument("--dry-run", action="store_true", help="실제로 반영/큐잉하지 않고 계획만 출력")
    args = parser.parse_args()

    rc1 = recompute_tiers(args.base_url, args.dry_run)
    rc2 = queue_due_refreshes(args.base_url, args.dry_run)
    sys.exit(1 if (rc1 or rc2) else 0)


if __name__ == "__main__":
    main()
