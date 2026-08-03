#!/usr/bin/env python3
"""
verify_gov_tree_registry_seeding.py — policy-bodies 70개가 실제로
K-Search(profiles 테이블)에 등록됐는지 읽기 전용으로 재확인한다.

배경: seed_gov_tree_registry.py --apply가 2026-08-02에 실행돼 "70/70
성공"으로 보고됐으나(WORK-ORDER-policy-bodies-hierarchy-content-review
_2026-08-03.md §1.2), 그 실행이 남겼어야 할 로그(docs/GOV-TREE-REGISTRY-
SEEDING-RUN_2026-08-03.md)가 이 저장소에 존재하지 않는다 — 커밋이
빠졌거나, 실제로는 일부만 성공했는데 기록이 안 남았을 가능성이 있다.
이 스크립트는 그 주장을 사후 검증하기 위해, 등록 당시 발급된 guid를
몰라도 각 기관 코드로 POST /search(읽기 전용)를 호출해 entity_subtype
='policy:{CODE}' 프로필이 실제로 존재하는지 하나씩 확인한다.

**쓰기 없음** — /profile(POST, 쓰기)이 아니라 /search(POST, 읽기)만
호출한다. 데이터를 생성·수정·삭제하지 않는다.

Claude(2026-08-03 세션)는 이 스크립트가 호출하는 hondi-proxy.tensor-
city.workers.dev(및 api.hondi.net)에 샌드박스 네트워크 egress가
막혀 있어 직접 실행할 수 없었다 — 그래서 실행 가능한 환경(주피터 PC 등)에서
돌려달라고 이 스크립트만 작성해 전달한다.

사용법:
  python3 tools/verify_gov_tree_registry_seeding.py
  python3 tools/verify_gov_tree_registry_seeding.py --worker-base https://api.hondi.net
  python3 tools/verify_gov_tree_registry_seeding.py --only ACRC,ASSEMBLY

주의: seed_gov_tree_registry.py의 docstring은 기본 WORKER_BASE를
"https://api.hondi.net"라고 적어뒀지만, 실제 코드의 argparse 기본값은
"https://hondi-proxy.tensor-city.workers.dev"이다(2026-08-03 발견,
불일치 — 어느 쪽이 실제 프로덕션인지 주피터님 확인 필요). 이 스크립트도
동일한 기본값을 쓰되, 다르면 --worker-base로 지정할 것.
"""
import argparse
import json
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

# collect_records()를 재사용 — seed 스크립트와 같은 디렉터리이므로 바로 import.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from seed_gov_tree_registry import collect_records, REPO_ROOT  # noqa: E402

VERIFY_LOG = REPO_ROOT / "docs" / "GOV-TREE-REGISTRY-SEEDING-VERIFY_2026-08-03.md"

_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
       "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")


def _search(worker_base, query, timeout=15):
    """POST /search — 읽기 전용. 실패 시 예외를 그대로 올린다(호출부에서 처리)."""
    req = urllib.request.Request(
        f"{worker_base.rstrip('/')}/search",
        data=json.dumps({"q": query, "etype": "institution", "lim": 20}).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": _UA},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _identity(entity):
    """검색 결과 entity에서 extra.public.identity를 안전하게 꺼낸다.

    ★ 2026-08-03 정정 — 최초 버전은 entity.get('entity_subtype')/
    entity.get('tags')로 톱레벨에서 찾았으나, worker.js의
    _l1SearchEntities()/_filterProfileByVisibility()를 직접 읽어보니
    실제 응답 구조는 entity.extra.public.identity.entity_subtype /
    .tags다(1차 실행에서 전부 MISSING으로 나온 원인 — 필드 경로 자체가
    틀렸었다). identity 객체는 description 필드만 field_visibility에
    따라 선택적으로 지워지고, entity_subtype/tags/display_name은
    그대로 남는다(_filterProfileByVisibility 확인).
    """
    extra = entity.get("extra") or {}
    public = extra.get("public") or {}
    return public.get("identity") or {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--worker-base", default="https://hondi-proxy.tensor-city.workers.dev",
                     help="기본값은 seed 스크립트 코드와 동일. 실제 프로덕션이 "
                          "api.hondi.net이면 --worker-base https://api.hondi.net로 지정.")
    ap.add_argument("--only", default="", metavar="CODE1,CODE2,...",
                     help="쉼표구분 code 목록만 검증(전체 70개 대신 일부만 빠르게 확인)")
    ap.add_argument("--sleep", type=float, default=0.3,
                     help="요청 간 대기 초(레이트리밋 방지, 기본 0.3초)")
    args = ap.parse_args()

    records = collect_records()
    if args.only:
        wanted = {c.strip().upper() for c in args.only.split(",") if c.strip()}
        records = [r for r in records if r["code"] in wanted]

    print(f"검증 대상 {len(records)}건 — worker_base={args.worker_base}\n")

    found, name_match, missing, errored = [], [], [], []
    for i, rec in enumerate(records):
        try:
            try:
                results = _search(args.worker_base, rec["name"])
            except (urllib.error.URLError, TimeoutError) as e:
                # ★ 2026-08-03 추가 — 실사용에서 앞쪽 2~3건이 타임아웃(콜드
                # 스타트로 추정)되는 게 확인돼 1회 재시도를 넣는다.
                print(f"  [RETRY] {rec['code']} — 1차 실패({e}), 재시도 중...", file=sys.stderr)
                time.sleep(2.0)
                results = _search(args.worker_base, rec["name"], timeout=25)
            match = None
            for e in results:
                if e.get("entity_type") != "institution":
                    continue
                ident = _identity(e)
                subtype = ident.get("entity_subtype")
                etags = ident.get("tags") or []
                if subtype == rec["gov_code"] or rec["gov_code"] in etags or rec["code"] in etags:
                    match = e
                    break
            if match:
                found.append({"code": rec["code"], "name": rec["name"],
                               "guid": match.get("primary_guid") or match.get("guid")})
                print(f"  [FOUND] {rec['code']} ({rec['name']}) → "
                      f"{match.get('primary_guid') or match.get('guid')}")
            else:
                # entity_subtype 매칭은 실패했지만, 이름이 정확히 일치하는
                # institution이 있으면 "이름은 있는데 subtype 태그가 없다"는
                # 별도 상태로 구분해 보고한다(완전 MISSING과 헷갈리지 않도록).
                name_only = next(
                    (e for e in results
                     if e.get("entity_type") == "institution" and e.get("name") == rec["name"]),
                    None,
                )
                if name_only:
                    name_match.append({"code": rec["code"], "name": rec["name"],
                                        "guid": name_only.get("primary_guid") or name_only.get("guid")})
                    print(f"  [NAME-ONLY] {rec['code']} ({rec['name']}) → "
                          f"이름은 일치하나 entity_subtype 태그 불일치/누락 "
                          f"({name_only.get('primary_guid') or name_only.get('guid')})")
                else:
                    missing.append({"code": rec["code"], "name": rec["name"],
                                     "result_count": len(results)})
                    print(f"  [MISSING] {rec['code']} ({rec['name']}) — "
                          f"검색결과 {len(results)}건 중 매칭 없음")
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            errored.append({"code": rec["code"], "error": f"HTTP {e.code}: {body[:200]}"})
            print(f"  [ERROR] {rec['code']} — HTTP {e.code}: {body[:200]}", file=sys.stderr)
        except Exception as e:
            errored.append({"code": rec["code"], "error": str(e)})
            print(f"  [ERROR] {rec['code']} — {e}", file=sys.stderr)
        if i < len(records) - 1:
            time.sleep(args.sleep)

    print(f"\n합계 — found={len(found)} / name_only(태그 불일치)={len(name_match)} / "
          f"missing={len(missing)} / error={len(errored)} (대상 {len(records)}건)")

    VERIFY_LOG.parent.mkdir(parents=True, exist_ok=True)
    import datetime
    with open(VERIFY_LOG, "w", encoding="utf-8") as f:
        f.write("# GOV-TREE-REGISTRY-SEEDING-VERIFY_2026-08-03.md\n\n")
        f.write(f"실행 시각: {datetime.datetime.now().isoformat(timespec='seconds')}\n")
        f.write(f"worker_base: {args.worker_base}\n\n")
        f.write(f"found={len(found)} / name_only={len(name_match)} / "
                f"missing={len(missing)} / error={len(errored)} (대상 {len(records)}건)\n\n")
        f.write("## FOUND(entity_subtype 태그까지 정상 등록 확인됨)\n")
        for r in found:
            f.write(f"- {r['code']} ({r['name']}) → {r['guid']}\n")
        f.write("\n## NAME-ONLY(이름은 검색되나 entity_subtype 태그 불일치/누락 — "
                 "[GWP:] 자동 연결 안 될 가능성)\n")
        for r in name_match:
            f.write(f"- {r['code']} ({r['name']}) → {r['guid']}\n")
        f.write("\n## MISSING(검색해도 이름조차 안 나옴 — 재시딩 필요 가능성)\n")
        for r in missing:
            f.write(f"- {r['code']} ({r['name']}) — 검색결과 {r['result_count']}건 중 매칭 없음\n")
        f.write("\n## ERROR(네트워크/서버 오류로 확인 불가 — 재시도 필요)\n")
        for r in errored:
            f.write(f"- {r['code']}: {r['error']}\n")
    print(f"\n로그 기록: {VERIFY_LOG}")
    print("\n이 로그 파일을 커밋해서 다음 세션이 참고할 수 있게 해주세요 "
          "(git add docs/GOV-TREE-REGISTRY-SEEDING-VERIFY_2026-08-03.md).")

    if missing:
        print(f"\n[안내] MISSING {len(missing)}건은 다음으로 재시딩할 수 있습니다:")
        codes = ",".join(r["code"] for r in missing)
        print(f"  python3 tools/seed_gov_tree_registry.py --apply --only {codes}")
    if errored:
        print(f"\n[안내] ERROR {len(errored)}건은 타임아웃/일시 오류일 수 있으니 재실행 권장:")
        codes = ",".join(r["code"] for r in errored)
        print(f"  python3 tools/verify_gov_tree_registry_seeding.py --only {codes}")


if __name__ == "__main__":
    main()
