#!/usr/bin/env python3
"""
KSIC/KSCO -> Gopang 3-format 변환 파이프라인
원본(2column raw CSV: code,name) -> nested JSON / flat CSV / path-flattened JSONL

사용법:
  python3 build_classification.py --input ksic10.csv --prefix ksic --out ./out
"""
import csv, json, argparse, os

def load_raw(path):
    rows = []
    with open(path, encoding='utf-8') as f:
        reader = csv.reader(f)
        header = next(reader)
        for r in reader:
            if len(r) < 2:
                continue
            code, name = r[0].strip(), r[1].strip()
            if code:
                rows.append((code, name))
    return rows

def build_flat(rows):
    """level = len(code); parent_code = code[:-1] (해당 코드가 존재하는 경우만)"""
    code_set = set(c for c, _ in rows)
    flat = []
    for code, name in rows:
        level = len(code)
        parent = code[:-1] if level > 2 and code[:-1] in code_set else (
            code[:2] if level > 2 else None
        )
        flat.append({
            "code": code,
            "name": name,
            "level": level,
            "parent_code": parent
        })
    return flat

def build_tree(flat):
    by_code = {f["code"]: {**f, "children": []} for f in flat}
    roots = []
    for f in flat:
        node = by_code[f["code"]]
        parent = f["parent_code"]
        if parent and parent in by_code:
            by_code[parent]["children"].append(node)
        else:
            roots.append(node)
    return roots

def build_paths(flat):
    """리프 노드까지의 전체 경로를 풀어쓴 라인 생성 (매칭/임베딩용)"""
    by_code = {f["code"]: f for f in flat}
    def get_path(code):
        chain = []
        cur = code
        seen = set()
        while cur and cur not in seen:
            seen.add(cur)
            node = by_code.get(cur)
            if not node:
                break
            chain.append(node["name"])
            cur = node["parent_code"]
        return " > ".join(reversed(chain))

    paths = []
    for f in flat:
        paths.append({
            "code": f["code"],
            "level": f["level"],
            "name": f["name"],
            "path": get_path(f["code"])
        })
    return paths

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--prefix", required=True, help="ksic | ksco 등 출력 파일 접두사")
    ap.add_argument("--out", default=".")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    rows = load_raw(args.input)
    flat = build_flat(rows)
    tree = build_tree(flat)
    paths = build_paths(flat)

    # 1) flat CSV
    flat_path = os.path.join(args.out, f"{args.prefix}-flat.csv")
    with open(flat_path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["code", "name", "level", "parent_code"])
        for r in flat:
            w.writerow([r["code"], r["name"], r["level"], r["parent_code"] or ""])

    # 2) nested JSON
    tree_path = os.path.join(args.out, f"{args.prefix}-tree.json")
    with open(tree_path, "w", encoding="utf-8") as f:
        json.dump(tree, f, ensure_ascii=False, indent=2)

    # 3) path-flattened JSONL
    paths_path = os.path.join(args.out, f"{args.prefix}-paths.jsonl")
    with open(paths_path, "w", encoding="utf-8") as f:
        for p in paths:
            f.write(json.dumps(p, ensure_ascii=False) + "\n")

    print(f"[OK] {len(rows)} rows -> {flat_path}, {tree_path}, {paths_path}")

if __name__ == "__main__":
    main()
