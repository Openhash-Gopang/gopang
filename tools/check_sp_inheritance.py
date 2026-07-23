#!/usr/bin/env python3
"""
tools/check_sp_inheritance.py
------------------------------
"하위 페르소나는 상위 페르소나를 상속해야 한다"는 원칙이 실제로 지켜지고
있는지 파일마다 기계적으로 검증한다. SP-AUTHOR가 13번 개정된 이유 대부분이
"상위 모듈을 안정시키기 전에 개별 산출물부터 만들었다가 나중에 손댄" 경우였던
것처럼, 이 원칙도 사람이 매번 기억해서 지키는 방식으로는 결국 잊힌다 —
tools/check_no_embedded_sp.py(SP는 prompts/ 파일 하나만 정본이어야 한다)와
같은 이유로, "기억"이 아니라 "CI가 매번 강제로 확인"하는 방식으로 바꾼다.

패밀리(상위 SP 하나에 여러 하위 파일이 딸린 그룹)마다 세 가지를 검사한다:
  1. 상속 선언 — 하위 파일 앞부분에 "<COMMON 이름> 상속"이라는 문구가
     실제로 있는가.
  2. 필수 섹션 커버리지 — 상위 SP가 요구하는 섹션/PHASE가 하위 파일에
     전부 있는가.
  3. 무단 복제 금지 — 하위 파일이 상위 SP 본문을 통째로 복사해 넣지
     않았는가(상속이 아니라 복붙이면, 나중에 상위가 개정될 때 하위 전체를
     다시 고쳐야 하는 사고로 이어진다).

## strict vs informational
패밀리마다 `strict` 플래그가 있다. strict=True면 위반 시 CI를 실패(exit 1)
시킨다. strict=False면 위반을 화면에는 보여주되 CI는 통과시킨다(exit 0).

AGENT-SUPPLIER는 2026-07-23 기준 informational로 뒀다 — 이미 77개 파일이
운영 중이고, 최초 점검에서 실제로 버전 세대 차이(v2.0/v2.1 40개 파일에
"## 분류 정보" 섹션이 없음 — v3.0부터 생긴 항목으로 추정)가 발견됐다. 이건
진짜 불일치이지 이 스크립트의 오탐이 아니지만, 지금 당장 77개 레거시 파일을
전부 고치라고 요구하는 건 이번 요청(향후 산업 페르소나 작성 시 상속 보장)의
범위 밖이다. informational로 두면 새로 이 파일들을 건드릴 때마다 눈에는
띄지만, 관련 없는 PR까지 막지는 않는다. 레거시를 정리하기로 결정하면
strict=True로 바꾸면 된다.

SP-INDUSTRY-TRANSFORM은 strict=True다 — 2026-07-23에 이제 막 시작하는
패밀리라 "처음부터 어겨진 적이 없는" 상태를 유지하는 비용이 훨씬 싸다.

새 패밀리(예: 다음에 또 다른 상위 SP가 생기면)는 FAMILIES 딕셔너리에 한
줄 추가하면 된다 — 코드 수정 없이 확장 가능하도록 설계.

사용법: python3 tools/check_sp_inheritance.py
CI: .github/workflows/check-sp-inheritance.yml 에서 prompts/** 변경 시마다 실행.
"""
import difflib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
PROMPTS = ROOT / "prompts"

FAMILIES = {
    "AGENT-SUPPLIER": {
        "common_glob": "AGENT-SUPPLIER-COMMON_v*.txt",
        "child_glob": "AGENT-SUPPLIER-[0-9]*_*.txt",
        "inherit_pattern": re.compile(r"AGENT-SUPPLIER-COMMON(?:\s+v[\d.]+)?\s*상속"),
        "required_sections": [
            "## 스키마", "## 핵심 업무 프로세스", "## 수행 기능",
            "## 업종별 법규", "## K-시스템 연계", "## 평가 기준", "## 분류 정보",
        ],
        "strict": False,
    },
    "SP-INDUSTRY-TRANSFORM": {
        "common_glob": "SP-INDUSTRY-TRANSFORM-COMMON_v*.md",
        "child_glob": "SP-INDUSTRY-TRANSFORM-[0-9]*_*.txt",
        "inherit_pattern": re.compile(r"SP-INDUSTRY-TRANSFORM-COMMON(?:\s+v[\d.]+)?\s*상속"),
        "required_sections": [
            "PHASE 0", "PHASE 1", "PHASE 2", "PHASE 3", "PHASE 4", "PHASE 5",
        ],
        "strict": True,
    },
}

INHERIT_PHRASE_MAX_LINE = 15
DUPLICATION_THRESHOLD_CHARS = 150


def latest_by_name(paths):
    if not paths:
        return None
    return sorted(paths, key=lambda p: p.name)[-1]


def check_family(cfg):
    violations = []

    common_candidates = list(PROMPTS.glob(cfg["common_glob"]))
    common_path = latest_by_name(common_candidates)
    if not common_path:
        return violations
    common_text = common_path.read_text(encoding="utf-8", errors="ignore")

    child_paths = [
        p for p in PROMPTS.glob(cfg["child_glob"])
        if p.resolve() != common_path.resolve()
    ]

    for child in sorted(child_paths):
        text = child.read_text(encoding="utf-8", errors="ignore")
        lines = text.split("\n")
        rel = child.relative_to(ROOT)

        head = "\n".join(lines[:INHERIT_PHRASE_MAX_LINE])
        if not cfg["inherit_pattern"].search(head):
            violations.append(
                f"{rel} — 상속 선언 없음: 앞 {INHERIT_PHRASE_MAX_LINE}줄 안에 "
                f"상속 문구 패턴이 없습니다."
            )

        missing = [s for s in cfg["required_sections"] if s not in text]
        if missing:
            violations.append(f"{rel} — 필수 섹션 누락: {', '.join(missing)}")

        matcher = difflib.SequenceMatcher(None, common_text, text, autojunk=False)
        match = matcher.find_longest_match(0, len(common_text), 0, len(text))
        if match.size >= DUPLICATION_THRESHOLD_CHARS:
            snippet = common_text[match.a: match.a + 60].replace("\n", " ")
            violations.append(
                f"{rel} — 상위 SP 본문 {match.size}자 연속 일치(복붙 의심), "
                f"시작 부분: \"{snippet}...\""
            )

    return violations


def main():
    exit_code = 0
    any_output = False

    for family_name, cfg in FAMILIES.items():
        violations = check_family(cfg)
        if not violations:
            continue
        any_output = True
        label = "✗ (실패)" if cfg["strict"] else "△ (참고용, CI 통과)"
        print(f"{label} {family_name} 패밀리 상속 규칙 위반:\n")
        for v in violations:
            print(" ", v)
        print()
        if cfg["strict"]:
            exit_code = 1

    if not any_output:
        total_children = sum(
            len(list(PROMPTS.glob(cfg["child_glob"]))) for cfg in FAMILIES.values()
        )
        print(f"✓ 상위 SP 상속 규칙 위반 없음 ({total_children}개 하위 파일 검사, {len(FAMILIES)}개 패밀리)")
    elif exit_code == 0:
        print("(strict 패밀리는 전부 통과 — 위는 참고용 경고이며 CI는 통과합니다)")

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
