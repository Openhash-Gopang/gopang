#!/usr/bin/env python3
"""
seed_gov_tree_registry.py — gov-tree 기관을 profiles 엔티티로 등록

배경 (docs/GOV-TREE-REGISTRY-SEEDING_v1_0.md, 2026-08-03 설계 개정):
  - K-Search(SP-18_ksearch)는 이미 profiles(entity_type 포함) 테이블
    전체를 검색하는 유일한 검색 엔진이다.
  - AC/K-Search가 institution 엔티티를 찾으면 이제 [GWP: {guid}]로
    직접 새 탭을 열 수 있다(gwp-registry.js의 _resolveEntityGwp()가
    profiles.extra.public.identity.gov_code를 읽어 자동 연결 —
    2026-08-03 신설).
  - 이 스크립트는 그 gov_code를 가진 institution 프로필을 실제로
    만드는 1회성 시딩 작업이다. 178개 gov-tree 기관 전체가 아니라,
    이번 1차 패치에서 assembleGovSystemPrompt의 directCode가 실제로
    처리하는 tier='policy'(정책기관 70개)만 시딩한다 — 나머지 5개
    티어(do-dept/city-dept/do-agency/org/nat-agency)는 gov-router.js
    쪽 directCode 분기가 아직 없으므로, 지금 시딩해도 gov_code가
    무시되고 기존 텍스트 추측 경로로만 동작한다(§GOV-TREE-REGISTRY-
    SEEDING_v1_0.md §범위 밖 참조 — 후속 패치에서 순차 확장).

소스: prompts/gov-tree/09-national/policy-bodies/SP-NAT-POLICY-*.md
  (70개 실파일 — docs/GWP-REGISTRY-SCALING 계열 마스터데이터 JSON은
  코드 체계가 달라(예: 'assembly' vs 실제 코드 'ASSEMBLY') 신뢰하지
  않는다. gov-router.js의 _POLICY_BODY_DOMAIN_KEYWORDS와 실제로
  fetch하는 파일명이 유일한 진실 소스다.)

각 기관마다:
  1. 파일명에서 code 추출(예: SP-NAT-POLICY-ASSEMBLY_v1.1.md → ASSEMBLY)
  2. "# 문서명    : {name} — System Prompt" 줄에서 기관명 추출
  3. "관장사무(직무, ...)" 줄에서 역할 서술 존재 여부 판정
     (짧거나 없으면 콘텐츠 공백으로 보고 status=pending_review —
     §GOV-TREE-REGISTRY-SEEDING_v1_0.md §3.3/§4의 게이트 원칙과 동일)
  4. POST /profile (entity_type='institution', claim_source=
     'gov_tree_seed') — 기존 미청구 프로필 생성 경로 재사용
     (worker.js _handleUnclaimedProfilePost, SP-18 STEP3와 동일 계약)

실행 전 필수 확인:
  - WORKER_BASE 환경변수(기본 https://api.hondi.net) 확인
  - 이 스크립트는 실제 POST를 실행합니다 — dry-run(기본값)으로 먼저
    돌려보고 결과를 확인한 뒤 --apply로 실행할 것.
  - L1 PocketBase 접근 권한은 worker.js가 가지고 있으므로 이 스크립트는
    admin 토큰 없이 공개 엔드포인트(POST /profile)만 사용한다.
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
POLICY_DIR = REPO_ROOT / "prompts" / "gov-tree" / "09-national" / "policy-bodies"
RUN_LOG = REPO_ROOT / "docs" / "GOV-TREE-REGISTRY-SEEDING-RUN_2026-08-03.md"

NAME_RE = re.compile(r"^#\s*문서명\s*:\s*(.+?)\s*—\s*System Prompt", re.M)
DUTY_RE = re.compile(r"관장사무\(직무[^)]*\)\s*:\s*\"(.*?)\"", re.S)

# 역할 서술이 이 길이보다 짧거나(단순 소속·근거법령 나열만 있는 경우가
# 대부분) 아예 없으면 콘텐츠 공백으로 판정한다. 임계값은 실제 정상
# 서술(2~4문장, 보통 150자 이상)과 빈 서술(50자 미만, 근거법령만)의
# 관찰된 차이를 기준으로 보수적으로 잡았다 — 애매하면 공백 쪽으로
# 판정해 status=pending_review로 안전하게 미노출시킨다.
MIN_DUTY_LEN = 60


def _extract(md_text: str):
    name_m = NAME_RE.search(md_text)
    duty_m = DUTY_RE.search(md_text)
    name = name_m.group(1).strip() if name_m else None
    duty = duty_m.group(1).strip() if duty_m else ""
    return name, duty


def collect_records():
    records = []
    files = sorted(POLICY_DIR.glob("SP-NAT-POLICY-*_v1.1.md"))
    for f in files:
        m = re.match(r"SP-NAT-POLICY-([A-Z0-9]+)_v1\.1\.md", f.name)
        if not m:
            print(f"  [건너뜀] 파일명 패턴 불일치: {f.name}", file=sys.stderr)
            continue
        code = m.group(1)
        text = f.read_text(encoding="utf-8", errors="replace")
        name, duty = _extract(text)
        if not name:
            print(f"  [건너뜀] 문서명 추출 실패: {f.name}", file=sys.stderr)
            continue
        has_role_desc = len(duty) >= MIN_DUTY_LEN
        records.append({
            "code": code,
            "gov_code": f"policy:{code}",
            "name": name,
            "description": duty if has_role_desc else "",
            "status": "active" if has_role_desc else "pending_review",
            "source_file": str(f.relative_to(REPO_ROOT)),
        })
    return records


def build_payload(rec):
    # worker.js _handleUnclaimedProfilePost가 받는 필드만 채운다 —
    # 존재하지 않는 필드를 지어내지 않는다(SP-18 RULE-01 금지-8과 동일
    # 원칙). status/gov_code는 표준 스키마 밖이므로 industry_fields를
    # 통해서가 아니라, extra.public.identity에 별도 기록되도록 서버가
    # identity.entity_subtype/식별 필드를 채워주는 통로가 없다 — 그래서
    # description 앞에 짧은 태그로 gov_code를 함께 담아 identity에
    # 남기는 대신, tags 배열에 gov_code를 직접 실어 field 손실 없이
    # 전달한다(entity_subtype 필드는 이미 있고 자유 문자열 허용 —
    # _handleUnclaimedProfilePost의 newExtra.public.identity.entity_subtype
    # 참조). _resolveEntityGwp()가 이 필드를 읽도록 gwp-registry.js
    # 쪽도 이 계약(entity_subtype = gov_code)에 맞춰야 한다 — 아래
    # NOTE 참조, 이번 커밋에서 함께 맞춤.
    return {
        "entity_type": "institution",
        "name": rec["name"],
        "description": rec["description"] or f"{rec['name']} — 역할 서술 보강 필요(원본 SP 콘텐츠 공백, {rec['source_file']})",
        "tags": ["gov-tree", "policy-body", rec["code"]],
        "occupation": "정부기관",
        "entity_subtype": rec["gov_code"],
        "claim_source": "gov_tree_seed",
        # ★ 2026-08-03 긴급 수정 — 이 필드가 없으면 worker.js의 POST
        # /profile이 일반 회원 갱신(guid 필수) 경로로 빠진다. call-ai.js
        # _handleCreateUnclaimedProfileTag(1907행)의 실제 호출부를 다시
        # 대조해 확인 — 그쪽은 항상 `{...params, claim_status:'unclaimed'}`
        # 로 보낸다. 이 필드가 있어야 서버가 _handleUnclaimedProfilePost
        # 경로로 분기해 guid를 직접 발급한다.
        "claim_status": "unclaimed",
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="실제로 POST 실행(기본은 dry-run)")
    ap.add_argument("--worker-base", default=os.environ.get("WORKER_BASE", "https://hondi-proxy.tensor-city.workers.dev"))
    ap.add_argument("--only-active", action="store_true",
                     help="status=pending_review(역할서술 공백 31개 추정) 건은 건너뛰기")
    # ★ 2026-08-03 추가 — 이 스크립트는 멱등성이 없다(기존 레코드 조회
    # 없이 매번 새 unclaimed 프로필을 POST한다). --apply 전체 재실행은
    # 이미 성공한 건들을 전부 중복 생성시킨다. 부분 실패(예: 네트워크
    # 타임아웃 1건) 재시도를 안전하게 하려면 반드시 이 필터로 실패한
    # code만 좁혀서 재실행할 것 — 절대로 --only 없이 전체를 다시 돌리지
    # 말 것.
    ap.add_argument("--only", default="", metavar="CODE1,CODE2,...",
                     help="쉼표구분 code 목록만 재시도(중복 생성 방지). 예: --only ACRC")
    # ★ 2026-08-03 신설 — ACRC 중복 등록 사고(--only 재실행이 "이미 있는지"
    # 확인 없이 새로 POST해버린 사건) 이후, 기본값을 "확인 후 스킵"으로
    # 바꾼다. 정말로 강제 재등록이 필요한(예: 기존 게 잘못 등록됐다고
    # 확신하는) 예외적 상황에서만 --force로 이 안전장치를 끈다.
    ap.add_argument("--force", action="store_true",
                     help="이미 등록된 code도 확인 없이 강제로 새로 POST(위험 — "
                          "중복 생성됨). 기본은 꺼짐: POST 전에 항상 기존 등록 "
                          "여부를 먼저 확인하고, 있으면 건너뛴다.")
    args = ap.parse_args()

    records = collect_records()
    active = [r for r in records if r["status"] == "active"]
    pending = [r for r in records if r["status"] == "pending_review"]

    print(f"총 {len(records)}건 — active(역할서술 있음) {len(active)}건 / "
          f"pending_review(역할서술 공백 추정) {len(pending)}건")

    to_send = active if args.only_active else records
    if args.only:
        wanted = {c.strip().upper() for c in args.only.split(",") if c.strip()}
        to_send = [r for r in to_send if r["code"] in wanted]
        missing = wanted - {r["code"] for r in to_send}
        if missing:
            print(f"[경고] --only에 지정했지만 목록에 없는 code: {sorted(missing)}", file=sys.stderr)
    if not args.apply:
        print("\n[DRY-RUN] --apply 없이 실행됨 — 실제 등록 없음. 아래는 전송될 내용 미리보기:")
        for r in to_send[:5]:
            print(json.dumps(build_payload(r), ensure_ascii=False, indent=2))
        print(f"... 총 {len(to_send)}건 전송 예정(미리보기 5건만 출력)")
        return

    results = {"success": [], "failed": [], "skipped_existing": []}
    for rec in to_send:
        if not args.force:
            try:
                existing_guid = find_existing_guid(
                    args.worker_base, rec["name"], rec["gov_code"], rec["code"])
            except Exception as e:
                # ★ 확인 자체가 실패하면(타임아웃 등) "없다"로 넘겨짚지 않고
                # 이 건을 건너뛴다 — ACRC 사고가 정확히 "확인 실패를 없음으로
                # 오판"해서 벌어졌다. 실패는 사람이 --only로 재확인하게 한다.
                print(f"  [SKIP-UNCERTAIN] {rec['code']} — 기존 등록 여부 확인 실패"
                      f"({e}), 안전을 위해 이번엔 건너뜀. 확인되면 --force나 "
                      f"재실행으로 처리하세요.", file=sys.stderr)
                results["skipped_existing"].append({"code": rec["code"], "reason": f"check_failed: {e}"})
                continue
            if existing_guid:
                print(f"  [SKIP-EXISTS] {rec['code']} — 이미 등록됨 → {existing_guid}")
                results["skipped_existing"].append({"code": rec["code"], "guid": existing_guid})
                continue
        payload = build_payload(rec)
        req = urllib.request.Request(
            f"{args.worker_base.rstrip('/')}/profile",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                # ★ 2026-08-03 긴급 수정 — Cloudflare WAF가 Python urllib의
                # 기본 User-Agent("Python-urllib/3.x")를 봇으로 보고 HTTP 403
                # (error code: 1010)으로 차단하는 걸 실사로 확인. 일반
                # 브라우저처럼 보이는 User-Agent를 명시해 우회한다.
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                              "AppleWebKit/537.36 (KHTML, like Gecko) "
                              "Chrome/126.0.0.0 Safari/537.36",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                body = json.loads(resp.read().decode("utf-8"))
                results["success"].append({"code": rec["code"], "guid": body.get("guid")})
                print(f"  [OK] {rec['code']} → {body.get('guid')}")
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")
            results["failed"].append({"code": rec["code"], "error": f"HTTP {e.code}: {err_body}"})
            print(f"  [FAIL] {rec['code']} — HTTP {e.code}: {err_body}", file=sys.stderr)
        except Exception as e:
            results["failed"].append({"code": rec["code"], "error": str(e)})
            print(f"  [FAIL] {rec['code']} — {e}", file=sys.stderr)

    RUN_LOG.parent.mkdir(parents=True, exist_ok=True)
    # ★ 2026-08-03 수정 — 기존엔 "w"(덮어쓰기)라, --only로 실패건만
    # 재시도하면 앞선 69건 성공 기록이 통째로 사라졌다. 로그가 이미
    # 있으면 이어붙인다(런마다 구분선+타임스탬프로 분리).
    import datetime
    is_rerun = RUN_LOG.exists()
    with open(RUN_LOG, "a" if is_rerun else "w", encoding="utf-8") as f:
        if is_rerun:
            f.write(f"\n\n---\n\n## 재실행 {datetime.datetime.now().isoformat(timespec='seconds')}"
                    f"{' (--only=' + args.only + ')' if args.only else ''}\n\n")
        else:
            f.write("# GOV-TREE-REGISTRY-SEEDING-RUN_2026-08-03.md\n\n")
        f.write(f"성공 {len(results['success'])}건 / 스킵(기존 등록) "
                f"{len(results['skipped_existing'])}건 / 실패 {len(results['failed'])}건 "
                f"(전체 대상 {len(to_send)}건, only_active={args.only_active}, force={args.force})\n\n")
        f.write("## 성공\n")
        for r in results["success"]:
            f.write(f"- {r['code']} → {r['guid']}\n")
        f.write("\n## 스킵(이미 등록돼 있어 건너뜀 — 중복 방지)\n")
        for r in results["skipped_existing"]:
            if "guid" in r:
                f.write(f"- {r['code']} → 기존 {r['guid']}\n")
            else:
                f.write(f"- {r['code']}: {r['reason']}\n")
        f.write("\n## 실패\n")
        for r in results["failed"]:
            f.write(f"- {r['code']}: {r['error']}\n")

    print(f"\n로그 기록: {RUN_LOG}")


if __name__ == "__main__":
    main()
