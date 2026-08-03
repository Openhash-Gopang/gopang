#!/usr/bin/env python3
"""
seed_gov_tree_remaining_registry.py — gov-tree 나머지 기관들을 institution
엔티티(profiles)로 등록 (2026-08-03, 정책기관 70개 이후 2차 확장)

seed_gov_tree_registry.py(정책기관 70개 전용)와 소스 코드 체계가 달라
별도 스크립트로 분리했다 — 파일명 규칙이 tier마다 다르고(SP-DO-*,
SP-AGY-*, SP-CITY(DIV|DEPT)?-*, SP-ORG-*, SP-NAT-(ENT|OTHER|QGOV|
UNLISTED)-*), "관장사무" 필드가 정책기관에만 있어 설명 추출 방식도
다르다.

공통 확인 사실(실사):
  - 모든 tier가 동일한 헤더 규약을 씀: "# 문서 코드  : {CODE}",
    "# 문서명    : {name} — System Prompt(...)"
  - 설명("주요 소관: ...")은 271개 중 59개(약 22%)에만 있다 — 있으면
    active로, 없으면 pending_review로(검색 노출 보류, 이름만으로는
    검색되지만 GWP_REGISTRY_SEARCH류 키워드 검색엔 안 걸림 — 설계상
    "역할 서술 없이 확신 있게 안내하지 않는다" 원칙과 동일).
  - technopark 디렉터리는 "{지역명}테크노파크" 원형 프로토타입 1건뿐
    (실제 인스턴스 없음) — 제외한다.

tier → entity_subtype 접두사:
  02-do-dept          → do-dept
  03-do-agency        → do-agency
  04-city              → city   (시청 자체 + 국/과 division 파일 전부 포함
                                  — 세분화하면 검색엔 오히려 방해, 하나로
                                  묶는다)
  07-org               → org
  09-national/enterprises → nat-ent
  09-national/other       → nat-other
  09-national/qgov        → nat-qgov
  09-national/unlisted    → nat-unlisted

★ 주의 ★ directCode(gov-router.js assembleGovSystemPrompt)는 아직
tier='policy'만 처리한다(§GOV-TREE-REGISTRY-SEEDING_v1_0.md 참조) — 이
스크립트로 등록되는 엔티티들은 검색은 되지만(§1 원칙의 "등록" 요건
충족), [GWP: guid] 발사 시 gwp-registry.js의 _resolveEntityGwp()가
아직 이 tier들을 모르므로 kgov로 낙착한다(안전한 폴백, §1 원칙이
보장하는 동작 — 절대 실패하지 않는다). 각 tier의 directCode 직접
연결은 각 tier의 lazy resolver 시그니처를 확인하는 후속 작업이다.
"""
import argparse
import json
import os
import re
import sys
import urllib.request
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _gov_seed_common import find_existing_guid  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
RUN_LOG = REPO_ROOT / "docs" / "GOV-TREE-REMAINING-REGISTRY-SEEDING-RUN_2026-08-03.md"

TIERS = [
    ("do-dept",     REPO_ROOT / "prompts/gov-tree/02-do-dept"),
    ("do-agency",   REPO_ROOT / "prompts/gov-tree/03-do-agency"),
    ("city",        REPO_ROOT / "prompts/gov-tree/04-city"),
    ("org",         REPO_ROOT / "prompts/gov-tree/07-org"),
    ("nat-ent",     REPO_ROOT / "prompts/gov-tree/09-national/enterprises"),
    ("nat-other",   REPO_ROOT / "prompts/gov-tree/09-national/other"),
    ("nat-qgov",    REPO_ROOT / "prompts/gov-tree/09-national/qgov"),
    ("nat-unlisted", REPO_ROOT / "prompts/gov-tree/09-national/unlisted"),
]

CODE_RE = re.compile(r"^#\s*문서\s*코드\s*:\s*(\S+)", re.M)
NAME_RE = re.compile(r"^#\s*문서명\s*:\s*(.+?)\s*—\s*System Prompt", re.M)
DUTY_RE = re.compile(r"^-\s*주요\s*소관\s*:\s*(.+)$", re.M)

MIN_DUTY_LEN = 15  # '주요 소관:' 필드는 정책기관 '관장사무'보다 원래 짧게
                    # 쓰는 관례라 임계값을 낮춘다(실사 샘플 기준).


def _extract(md_text):
    codem = CODE_RE.search(md_text)
    namem = NAME_RE.search(md_text)
    dutym = DUTY_RE.search(md_text)
    code = codem.group(1).strip() if codem else None
    name = namem.group(1).strip() if namem else None
    duty = dutym.group(1).strip() if dutym else ""
    return code, name, duty


def collect_records():
    records = []
    seen_codes = set()
    for tier_prefix, tier_dir in TIERS:
        if not tier_dir.exists():
            print(f"  [경고] 디렉터리 없음, 건너뜀: {tier_dir}", file=sys.stderr)
            continue
        files = sorted(tier_dir.rglob("SP-*.md"))
        # templates/ 하위, PROTOTYPE(원형) 파일은 실제 인스턴스가 아니므로 제외.
        files = [f for f in files if "templates" not in f.parts and "PROTOTYPE" not in f.name]
        for f in files:
            text = f.read_text(encoding="utf-8", errors="replace")
            code, name, duty = _extract(text)
            if not code or not name:
                print(f"  [건너뜀] 코드/이름 추출 실패: {f}", file=sys.stderr)
                continue
            if code in seen_codes:
                # 08-schema, benefit-categories 등과 code 충돌 가능성 방어.
                print(f"  [건너뜀] 중복 코드: {code} ({f})", file=sys.stderr)
                continue
            seen_codes.add(code)
            has_duty = len(duty) >= MIN_DUTY_LEN
            records.append({
                "code": code,
                "gov_code": f"{tier_prefix}:{code}",
                "name": name,
                "description": duty if has_duty else "",
                "status": "active" if has_duty else "pending_review",
                "source_file": str(f.relative_to(REPO_ROOT)),
                "tier_prefix": tier_prefix,
            })
    return records


def build_payload(rec):
    return {
        "entity_type": "institution",
        "name": rec["name"],
        "description": rec["description"] or f"{rec['name']} — 역할 서술 보강 필요(원본 SP에 '주요 소관' 필드 없음, {rec['source_file']})",
        "tags": ["gov-tree", rec["tier_prefix"], rec["code"]],
        "occupation": "정부기관" if rec["tier_prefix"] in ("do-dept", "do-agency", "city", "org") else "공공기관",
        "entity_subtype": rec["gov_code"],
        "claim_source": "gov_tree_seed_v2",
        "claim_status": "unclaimed",
    }


def post_profile(worker_base, payload):
    req = urllib.request.Request(
        f"{worker_base.rstrip('/')}/profile",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                          "AppleWebKit/537.36 (KHTML, like Gecko) "
                          "Chrome/126.0.0.0 Safari/537.36",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--worker-base", default=os.environ.get(
        "WORKER_BASE", "https://hondi-proxy.tensor-city.workers.dev"))
    ap.add_argument("--only-tier", default=None,
                     help="쉼표구분 tier 접두사만 처리(예: do-dept,city) — 배치를 나눠 돌릴 때 사용")
    ap.add_argument("--only", default=None, help="쉼표구분 code만 처리(재시도용)")
    ap.add_argument("--force", action="store_true",
                     help="이미 등록된 code도 확인 없이 강제로 새로 POST(위험 — "
                          "중복 생성됨). 기본은 꺼짐.")
    args = ap.parse_args()

    records = collect_records()
    if args.only_tier:
        want = set(t.strip() for t in args.only_tier.split(','))
        records = [r for r in records if r["tier_prefix"] in want]
    if args.only:
        want_codes = set(c.strip() for c in args.only.split(','))
        records = [r for r in records if r["code"] in want_codes]

    by_tier = {}
    for r in records:
        by_tier.setdefault(r["tier_prefix"], []).append(r)
    print(f"총 {len(records)}건")
    for t, rs in by_tier.items():
        active = sum(1 for r in rs if r["status"] == "active")
        print(f"  {t}: {len(rs)}건 (active {active} / pending_review {len(rs)-active})")

    if not args.apply:
        print("\n[DRY-RUN] --apply 없이 실행됨. 미리보기 3건:")
        for r in records[:3]:
            print(json.dumps(build_payload(r), ensure_ascii=False, indent=2))
        return

    results = {"success": [], "failed": [], "skipped_existing": []}
    for i, rec in enumerate(records):
        if not args.force:
            try:
                existing_guid = find_existing_guid(
                    args.worker_base, rec["name"], rec["gov_code"], rec["code"])
            except Exception as e:
                print(f"  [SKIP-UNCERTAIN {i+1}/{len(records)}] {rec['gov_code']} — "
                      f"기존 등록 여부 확인 실패({e}), 안전을 위해 건너뜀.", file=sys.stderr)
                results["skipped_existing"].append({"id": rec["gov_code"], "reason": f"check_failed: {e}"})
                continue
            if existing_guid:
                print(f"  [SKIP-EXISTS {i+1}/{len(records)}] {rec['gov_code']} — "
                      f"이미 등록됨 → {existing_guid}")
                results["skipped_existing"].append({"id": rec["gov_code"], "guid": existing_guid})
                continue
        payload = build_payload(rec)
        try:
            body = post_profile(args.worker_base, payload)
            results["success"].append({"id": rec["gov_code"], "guid": body.get("guid")})
            print(f"  [OK {i+1}/{len(records)}] {rec['gov_code']} → {body.get('guid')}")
        except Exception as e:
            detail = e.read().decode("utf-8", errors="replace") if hasattr(e, "read") else str(e)
            results["failed"].append({"id": rec["gov_code"], "error": detail})
            print(f"  [FAIL {i+1}/{len(records)}] {rec['gov_code']} — {detail}", file=sys.stderr)

    RUN_LOG.parent.mkdir(parents=True, exist_ok=True)
    # ★ 2026-08-03 수정 — 다른 두 시딩 스크립트와 동일하게 append로 변경
    # (기존엔 "w"로 재실행 시 이전 성공 기록이 사라졌다).
    import datetime
    is_rerun = RUN_LOG.exists()
    with open(RUN_LOG, "a" if is_rerun else "w", encoding="utf-8") as f:
        if is_rerun:
            f.write(f"\n\n---\n\n## 재실행 {datetime.datetime.now().isoformat(timespec='seconds')}\n\n")
        else:
            f.write("# GOV-TREE-REMAINING-REGISTRY-SEEDING-RUN_2026-08-03.md\n\n")
        f.write(f"성공 {len(results['success'])}건 / 스킵(기존 등록) "
                f"{len(results['skipped_existing'])}건 / 실패 {len(results['failed'])}건\n\n## 성공\n")
        for r in results["success"]:
            f.write(f"- {r['id']} → {r['guid']}\n")
        f.write("\n## 스킵(이미 등록돼 있어 건너뜀 — 중복 방지)\n")
        for r in results["skipped_existing"]:
            if "guid" in r:
                f.write(f"- {r['id']} → 기존 {r['guid']}\n")
            else:
                f.write(f"- {r['id']}: {r['reason']}\n")
        f.write("\n## 실패\n")
        for r in results["failed"]:
            f.write(f"- {r['id']}: {r['error']}\n")
    print(f"\n로그 기록: {RUN_LOG}")


if __name__ == "__main__":
    main()
