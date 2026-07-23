#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
add_top_level.py

한국표준산업분류(KSIC) 10차 개정 데이터(ksic-tree.json 등, 중분류~세세분류
2,000개 노드)에 대분류(A~U, 21개) 레이어를 씌운다.

원본: 주피터님이 통계분류포털(kssc.kostat.go.kr)에서 직접 받아 업로드해주신
공식 엑셀 "한국표준산업분류10차_표.xlsx"(대분류 21/중분류 77/소분류 232/
세분류 495/세세분류 1,196 — 전부 공식 통계와 일치 확인됨).

이 스크립트는 그 원본 엑셀을 다시 입력받아 실행할 수 있도록 재구성해둔
것이다(2026-07-23 최초 실행 당시엔 대화 중 1회성 스크립트로 돌렸으나,
README가 예고했던 이름과 재현 가능성을 위해 정식 스크립트로 남겨둔다).

실행:
    python add_top_level.py 한국표준산업분류10차_표.xlsx

결과: 같은 폴더의 ksic-tree.json / ksic-flat.csv / ksic-paths.jsonl을
      대분류 포함 버전으로 덮어쓴다(ksic-tree.json이 없으면 새로 만들지
      않고 에러 — 이 스크립트는 "레이어를 씌우는" 용도이지 최초 생성용이
      아니다. 최초 생성은 build_classification.py 참고).
"""
import sys
import re
import json
import csv
import pathlib

try:
    import openpyxl
except ImportError:
    print("[에러] openpyxl이 필요합니다: pip install openpyxl --break-system-packages")
    sys.exit(1)

HERE = pathlib.Path(__file__).parent
TREE_PATH = HERE / "ksic-tree.json"
FLAT_PATH = HERE / "ksic-flat.csv"
PATHS_PATH = HERE / "ksic-paths.jsonl"


def parse_official_excel(xlsx_path):
    """공식 분류표 엑셀(대분류~세세분류 5단 병합 셀)을 파싱해
    {대분류코드: 대분류명}, {중분류코드: 대분류코드} 두 매핑을 반환한다."""
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    ws = wb.active  # 시트가 하나뿐이라 가정(원본 파일 기준)

    rows = list(ws.iter_rows(min_row=4, values_only=True))  # 1~3행은 헤더

    # 병합 셀 forward-fill
    last = [None] * 10
    records = []
    for r in rows:
        filled = list(r)
        for i in range(10):
            if filled[i] is None:
                filled[i] = last[i]
        last = filled
        records.append(filled)

    major = {}
    mid_to_major = {}
    for r in records:
        mcode, mname, dcode = r[0], r[1], r[2]
        if mname:
            clean_name = re.sub(r"\(\d+~?\d*\)$", "", mname).strip()
            major[mcode] = clean_name
        if dcode:
            mid_to_major[dcode] = mcode

    return major, mid_to_major


def apply_major_layer(major, mid_to_major):
    if not TREE_PATH.exists():
        print(f"[에러] {TREE_PATH}를 찾을 수 없습니다 — 이 스크립트가 있는 폴더에서 실행하세요.")
        sys.exit(1)

    existing = json.loads(TREE_PATH.read_text(encoding="utf-8"))

    if existing and existing[0].get("level") == 1:
        print("[스킵] 이미 대분류 레이어가 적용되어 있습니다 (변경 없음).")
        return

    existing_mid_codes = {n["code"] for n in existing}
    new_mid_codes = set(mid_to_major.keys())
    if existing_mid_codes != new_mid_codes:
        print("[에러] 기존 ksic-tree.json의 중분류 코드 집합과 엑셀의 중분류 코드 집합이 다릅니다.")
        print("       차이:", existing_mid_codes.symmetric_difference(new_mid_codes))
        print("       버전이 다른 개정본을 섞어 쓰고 있을 수 있습니다 — 수동 확인 필요.")
        sys.exit(1)

    by_major = {}
    for node in existing:
        dcode = mid_to_major[node["code"]]
        node["parent_code"] = dcode
        by_major.setdefault(dcode, []).append(node)

    new_tree = [
        {"code": dcode, "name": major[dcode], "level": 1, "parent_code": None, "children": by_major[dcode]}
        for dcode in sorted(by_major.keys())
    ]

    TREE_PATH.write_text(json.dumps(new_tree, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[완료] {TREE_PATH} 갱신됨 — 대분류 {len(new_tree)}개 추가.")

    _regenerate_flat_and_paths(new_tree)


def _regenerate_flat_and_paths(tree):
    flat_rows, path_rows = [], []

    def walk(node, path_prefix):
        path = f"{path_prefix} > {node['name']}" if path_prefix else node["name"]
        flat_rows.append([node["code"], node["name"], node["level"], node["parent_code"] or ""])
        path_rows.append({"code": node["code"], "level": node["level"], "name": node["name"], "path": path})
        for c in node.get("children", []):
            walk(c, path)

    for n in tree:
        walk(n, "")

    with open(FLAT_PATH, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["code", "name", "level", "parent_code"])
        w.writerows(flat_rows)

    with open(PATHS_PATH, "w", encoding="utf-8") as f:
        for r in path_rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    print(f"[완료] {FLAT_PATH}, {PATHS_PATH} 재생성됨 ({len(flat_rows)}행).")


def main():
    if len(sys.argv) != 2:
        print("사용법: python add_top_level.py <한국표준산업분류10차_표.xlsx>")
        sys.exit(1)

    xlsx_path = pathlib.Path(sys.argv[1])
    if not xlsx_path.exists():
        print(f"[에러] {xlsx_path} 파일을 찾을 수 없습니다.")
        sys.exit(1)

    major, mid_to_major = parse_official_excel(xlsx_path)
    print(f"엑셀 파싱 완료 — 대분류 {len(major)}개, 중분류 매핑 {len(mid_to_major)}개.")
    apply_major_layer(major, mid_to_major)


if __name__ == "__main__":
    main()
