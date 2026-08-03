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
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="실제로 POST 실행(기본은 dry-run)")
    ap.add_argument("--worker-base", default=os.environ.get("WORKER_BASE", "https://api.hondi.net"))
    ap.add_argument("--only-active", action="store_true",
                     help="status=pending_review(역할서술 공백 31개 추정) 건은 건너뛰기")
    args = ap.parse_args()

    records = collect_records()
    active = [r for r in records if r["status"] == "active"]
    pending = [r for r in records if r["status"] == "pending_review"]

    print(f"총 {len(records)}건 — active(역할서술 있음) {len(active)}건 / "
          f"pending_review(역할서술 공백 추정) {len(pending)}건")

    to_send = active if args.only_active else records
    if not args.apply:
        print("\n[DRY-RUN] --apply 없이 실행됨 — 실제 등록 없음. 아래는 전송될 내용 미리보기:")
        for r in to_send[:5]:
            print(json.dumps(build_payload(r), ensure_ascii=False, indent=2))
        print(f"... 총 {len(to_send)}건 전송 예정(미리보기 5건만 출력)")
        return

    results = {"success": [], "failed": []}
    for rec in to_send:
        payload = build_payload(rec)
        req = urllib.request.Request(
            f"{args.worker_base.rstrip('/')}/profile",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
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
    with open(RUN_LOG, "w", encoding="utf-8") as f:
        f.write("# GOV-TREE-REGISTRY-SEEDING-RUN_2026-08-03.md\n\n")
        f.write(f"성공 {len(results['success'])}건 / 실패 {len(results['failed'])}건 "
                f"(전체 대상 {len(to_send)}건, only_active={args.only_active})\n\n")
        f.write("## 성공\n")
        for r in results["success"]:
            f.write(f"- {r['code']} → {r['guid']}\n")
        f.write("\n## 실패\n")
        for r in results["failed"]:
            f.write(f"- {r['code']}: {r['error']}\n")

    print(f"\n로그 기록: {RUN_LOG}")


if __name__ == "__main__":
    main()
