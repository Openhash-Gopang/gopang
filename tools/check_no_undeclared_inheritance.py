#!/usr/bin/env python3
"""
tools/check_no_undeclared_inheritance.py
------------------------------------------
"개별 SP가 자체적인 계층 구조를 신규 작성하는 행위"를 막는다
(2026-07-29 요청). check_no_hardcoded_sp_refs.py가 "버전을 박았는가"를
막는 것과는 다른 문제 — 이건 "이름만으로도, 등록되지 않은 새 부모-자식
관계를 선언할 수 있는가"를 막는다.

방식: 전체 파일을 매번 재검사하지 않는다. gov-tree 계열에만 893건의
"# 상위 상속" 선언이 이미 존재하고 표기 형식도 제각각이라(폐기 경고·
조건부 표시가 헤더 문장 안에 섞여 있음), 기존 선언을 전부 지금 규칙으로
소급 검증하면 오탐이 쏟아져 정상 작업을 막는다. 대신 **git diff로 이번
커밋/PR에서 새로 추가되거나 바뀐 "# 상위 상속" 선언 줄만** 검사한다 —
기존 관계는 건드리지 않되, 새로 생기는 관계는 반드시 SP-TREE-REGISTRY
edges 블록에 먼저(같은 PR 안에서) 등록돼야만 통과한다.

strict 범위: sp-catalog.json에 등록되고 prompts/gov-tree/ 밖에 있는
최상위 SP만 strict(위반 시 CI 실패)로 검사한다. gov-tree 안은
informational(출력만, CI는 통과) — SP-TREE-REGISTRY §F의 "적용 범위"
설명과 정확히 같은 경계선이다. gov-tree 헤더 형식이 정규화되면 이
스크립트의 GOVTREE_STRICT를 True로 바꾸면 된다.

부가 검증: edges 블록 자체가 순환 참조(A→B→A)를 만들지 않는지도 확인한다.

사용법: python3 tools/check_no_undeclared_inheritance.py [--base <git-ref>]
CI: .github/workflows/check-no-hardcoded-sp-refs.yml에 스텝으로 추가.
    PR 워크플로에서는 origin/main과 비교하므로 fetch-depth: 0 필요.
"""
import argparse
import fnmatch
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
PROMPTS = ROOT / "prompts"
CATALOG = PROMPTS / "sp-catalog.json"
REGISTRY = PROMPTS / "SP-TREE-REGISTRY_v1_0.md"

GOVTREE_STRICT = False  # gov-tree 헤더 정규화 전까지 False로 유지

HEADER_LINE = re.compile(r"^\+?#\s*상위\s*상속\s*[:：]\s*(.+)$")
FILE_HEADER = re.compile(r"^diff --git a/(.+?) b/(.+?)$")
HUNK_ADD = re.compile(r"^\+(?!\+\+)")


def parse_edges_block(text: str):
    m = re.search(r"```edges\n(.*?)```", text, re.DOTALL)
    if not m:
        print("FAIL: SP-TREE-REGISTRY에서 ```edges 블록을 찾지 못했습니다.")
        sys.exit(1)
    aliases = {}
    edges = []  # (child_pattern, parent)
    for line in m.group(1).splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("ALIAS:"):
            rest = line[len("ALIAS:"):].strip()
            short, _, full = rest.partition("=")
            aliases[short.strip()] = full.strip()
            continue
        child, _, parent = line.partition("->")
        if not parent:
            continue
        edges.append((child.strip(), parent.strip()))
    return edges, aliases


def resolve_alias(name, aliases):
    return aliases.get(name, name)


def edge_allowed(child, parent, edges, aliases):
    parent = resolve_alias(parent, aliases)
    for pattern, allowed_parent in edges:
        if resolve_alias(allowed_parent, aliases) != parent:
            continue
        if fnmatch.fnmatch(child, pattern):
            return True
    return False


def first_parent_token(rest: str) -> str:
    cut = re.split(r"[→>(\[,]", rest)[0].strip()
    return cut.strip(" .")


def check_cycles(edges, aliases, catalog_names):
    # 명시적(글롭 아닌) 엣지만으로 그래프를 만들어 순환을 찾는다.
    graph = {}
    for child, parent in edges:
        if "*" in child:
            continue
        graph.setdefault(child, set()).add(resolve_alias(parent, aliases))

    visiting, visited = set(), set()

    def dfs(node, path):
        if node in visiting:
            cycle = path[path.index(node):] + [node]
            print(f"FAIL: SP-TREE-REGISTRY edges 블록에 순환 참조 발견: {' -> '.join(cycle)}")
            return True
        if node in visited:
            return False
        visiting.add(node)
        for nxt in graph.get(node, ()):
            if dfs(nxt, path + [node]):
                return True
        visiting.discard(node)
        visited.add(node)
        return False

    for n in list(graph):
        if dfs(n, []):
            return False
    return True


def git_diff(base_ref: str):
    try:
        out = subprocess.run(
            ["git", "diff", f"{base_ref}...HEAD", "--", "prompts/"],
            cwd=ROOT, capture_output=True, text=True, check=True,
        ).stdout
    except subprocess.CalledProcessError:
        # base_ref가 로컬에 없는 얕은 체크아웃 등 — HEAD~1로 대체 시도.
        out = subprocess.run(
            ["git", "diff", "HEAD~1...HEAD", "--", "prompts/"],
            cwd=ROOT, capture_output=True, text=True,
        ).stdout
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="origin/main")
    args = ap.parse_args()

    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    catalog_names = set(catalog.keys())
    filename_to_name = {v: k for k, v in catalog.items()}

    edges, aliases = parse_edges_block(REGISTRY.read_text(encoding="utf-8"))

    ok = check_cycles(edges, aliases, catalog_names)

    diff_text = git_diff(args.base)
    if not diff_text.strip():
        print("검사할 prompts/ 변경분이 없습니다 (diff 비어 있음).")
        return 0 if ok else 1

    violations = []
    info_only = []
    current_file = None
    for line in diff_text.splitlines():
        fm = FILE_HEADER.match(line)
        if fm:
            current_file = fm.group(2)
            continue
        if current_file is None or not line.startswith("+") or line.startswith("+++"):
            continue
        m = HEADER_LINE.match(line)
        if not m:
            continue

        rel = current_file
        # prompts/ 이하 상대경로로 정규화
        rel_in_prompts = rel[len("prompts/"):] if rel.startswith("prompts/") else rel
        if "archive/" in rel_in_prompts:
            continue

        sp_name = filename_to_name.get(Path(rel_in_prompts).name)
        # 카탈로그에 없으면(주로 gov-tree) 이름 대신 파일명을 그대로 child로 사용
        child_id = sp_name or Path(rel_in_prompts).stem

        declared_parent = first_parent_token(m.group(1))
        is_govtree = rel_in_prompts.startswith("gov-tree/")

        allowed = edge_allowed(child_id, declared_parent, edges, aliases)
        entry = (rel_in_prompts, child_id, declared_parent, line.strip())

        if not allowed:
            if is_govtree and not GOVTREE_STRICT:
                info_only.append(entry)
            else:
                violations.append(entry)

    if info_only:
        print(f"참고(비차단, gov-tree informational): {len(info_only)}건")
        for rel, child, parent, raw in info_only:
            print(f"  {rel}: {child} -> {parent} (레지스트리 미등록)")
        print()

    if violations:
        print(f"FAIL: {len(violations)}건의 미등록 상속 관계 선언 발견\n")
        for rel, child, parent, raw in violations:
            print(f"  {rel}")
            print(f"    선언: {child} -> {parent}")
            print(f"    원문: {raw}")
        print(
            "\n새 상속 관계는 SP-TREE-REGISTRY_v1_0.md §F의 edges 블록에 먼저 "
            "등록해야 합니다(같은 PR 안에서 함께 수정). 등록 없이 SP 헤더에서만 "
            "새 부모를 선언하는 것은 허용되지 않습니다."
        )
        ok = False

    if ok and not violations:
        print("OK: 새로 선언된 상속 관계가 모두 SP-TREE-REGISTRY에 등록돼 있습니다"
              " (또는 변경분 없음).")

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
