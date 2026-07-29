#!/usr/bin/env python3
"""
tools/check_no_hardcoded_sp_refs.py
------------------------------------
"모든 SP는 SP-TREE-REGISTRY를 통해서만 다른 SP를 참조한다"는 원칙을
기계적으로 강제한다.

배경 (2026-07-29): worker.js/gov-router.js가 GOV-TREE-PROTOCOL_v1.0.md처럼
URL에 버전을 직접 박아 fetch하던 버그를 고치면서, 같은 패턴이 코드가 아니라
prompts/*.md·*.txt 문서 자체에도 널리 퍼져 있다는 게 드러났다. 각 SP가 자기
헤더에 "상위 상속: A_v1_0 → B_v2_1 → C_v1_0" 식으로 다른 SP의 파일명+버전을
직접 적어 놓으면, 그 상위 SP가 개정되어도 하위 파일은 조용히 구버전 이름을
계속 참조하게 된다 — 이건 강제가 아니라 관습이라 시간이 지나면 반드시
어긋난다(tools/check_sp_inheritance.py, check_no_embedded_sp.py와 같은 이유).

이 스크립트는 prompts/sp-catalog.json에 등록된 모든 SP 파일을 스캔해서,
"다른 SP 이름 + 버전 번호(_v숫자_숫자 또는 _v숫자.숫자)"가 나란히 등장하는
곳을 전부 위반으로 잡는다. 자기 자신을 가리키는 경우와, 이미 지나간 사실을
기록하는 변경이력 섹션(예: "이 문서는 X_v1_0을 대체했다") 안의 언급은
제외한다 — 그런 곳은 역사 기록이지 실행 시점에 참조하는 경로가 아니다.

예외 처리 대상 헤딩(대소문자/공백 변형 포함): 변경 이력, 버전 이력, 변경 요지.
SP-TREE-REGISTRY 자신은 이 검사에서 제외한다 — 정의상 그 문서가 전체 상속
구조를 나열하는 유일한 곳이기 때문이다.

사용법: python3 tools/check_no_hardcoded_sp_refs.py
CI: .github/workflows/check-no-hardcoded-sp-refs.yml 에서 prompts/** 변경 시 실행.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
PROMPTS = ROOT / "prompts"
CATALOG = PROMPTS / "sp-catalog.json"

SELF_EXEMPT_NAMES = {"SP-TREE-REGISTRY"}

CHANGELOG_HEADING = re.compile(
    r"^#{1,4}\s*(?:\d+\.\s*)?"
    r"(변경\s*이력|버전\s*이력|변경\s*요지|버전\s*변경\s*이력)"
    r"[^\n]*$",
    re.MULTILINE,
)
ANY_HEADING = re.compile(r"^#{1,4}\s", re.MULTILINE)


def strip_changelog_sections(text: str) -> str:
    """변경이력류 헤딩부터 다음 헤딩(또는 파일 끝) 전까지를 잘라낸다."""
    out = []
    pos = 0
    for m in CHANGELOG_HEADING.finditer(text):
        out.append(text[pos:m.start()])
        # find next heading after this one
        rest = text[m.end():]
        nxt = ANY_HEADING.search(rest)
        if nxt:
            pos = m.end() + nxt.start()
        else:
            pos = len(text)
    out.append(text[pos:])
    return "".join(out)


def load_catalog_names():
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    return catalog


def build_ref_pattern(other_names):
    # longest names first so e.g. "SP_advisor" doesn't shadow
    # "SP_advisor-extended" style collisions
    escaped = sorted((re.escape(n) for n in other_names), key=len, reverse=True)
    alt = "|".join(escaped)
    # NAME then _v<digits>[._]<digits> (allow trailing .0.1 style too)
    return re.compile(rf"(?:{alt})_v\d+[._]\d+(?:[._]\d+)?")


def main():
    catalog = load_catalog_names()
    all_names = set(catalog.keys())

    violations = {}  # file -> list of (name_matched, context)

    for sp_name, filename in catalog.items():
        if sp_name in SELF_EXEMPT_NAMES:
            continue
        path = PROMPTS / filename
        if not path.exists():
            continue

        text = path.read_text(encoding="utf-8", errors="ignore")
        scanned = strip_changelog_sections(text)

        other_names = all_names - {sp_name}
        pattern = build_ref_pattern(other_names)

        for m in pattern.finditer(scanned):
            matched = m.group(0)
            # skip self-references (defensive; matched name already excludes sp_name,
            # but catalog names can be substrings of each other)
            if matched.startswith(sp_name + "_v"):
                continue
            line_start = scanned.rfind("\n", 0, m.start()) + 1
            line_end = scanned.find("\n", m.end())
            if line_end == -1:
                line_end = len(scanned)
            context = scanned[line_start:line_end].strip()
            violations.setdefault(filename, []).append((matched, context))

    if not violations:
        print("OK: 등록된 모든 SP에서 하드코딩된 상호 참조가 발견되지 않았습니다.")
        return 0

    total = sum(len(v) for v in violations.values())
    print(f"FAIL: {len(violations)}개 파일에서 총 {total}건의 하드코딩된 SP 상호 참조 발견\n")
    for filename in sorted(violations):
        print(f"  {filename}")
        for matched, context in violations[filename]:
            print(f"    - {matched}")
            print(f"      | {context[:120]}")
        print()

    print(
        "다른 SP를 가리킬 때는 파일명_버전 대신 SP-TREE-REGISTRY를 참조하도록\n"
        "고쳐 주세요 (예: \"SP-TREE-REGISTRY 참조\" 한 줄). 변경이력 섹션 안의\n"
        "과거 기록이라면 헤딩이 '## 변경 이력' / '## 버전 이력' / '## 변경 요지'\n"
        "패턴과 일치하는지 확인하세요."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
