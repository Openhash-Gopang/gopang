#!/usr/bin/env python3
"""
1) 상품 -> 업종(KSIC) 분류기
2단계 매칭: (1) 키워드 fast-path, (2) 임베딩 기반 의미 매칭(폴백)

의존: ../classification/out/ksic-flat.csv, ksic-paths.jsonl
(지난 산출물 재사용)
"""
import csv, json, re
from collections import defaultdict

class KsicClassifier:
    def __init__(self, flat_csv_path, paths_jsonl_path, embed_fn=None):
        """
        embed_fn: Callable[[str], List[float]] — 실제 임베딩 함수를 주입.
                  미지정 시 2단계(의미매칭)는 비활성화되고 1단계만 동작.
        """
        self.leaf_nodes = []  # level=5 항목만 (세세분류가 실제 업종 단위)
        self.keyword_index = defaultdict(list)  # 키워드 -> [code,...]
        self.embed_fn = embed_fn
        self._load(flat_csv_path, paths_jsonl_path)

    def _load(self, flat_csv_path, paths_jsonl_path):
        with open(paths_jsonl_path, encoding='utf-8') as f:
            for line in f:
                row = json.loads(line)
                if row['level'] == 5:
                    self.leaf_nodes.append(row)

        # 키워드 인덱스: 이름을 토큰화해서 역인덱스 구성
        for node in self.leaf_nodes:
            tokens = re.split(r'[,\s·/()]+', node['name'])
            for t in tokens:
                t = t.strip()
                if len(t) >= 2:  # 한글 1글자 토큰은 노이즈가 많아 제외
                    self.keyword_index[t].append(node['code'])

    def classify(self, product_text, top_k=3):
        """
        상품 설명 텍스트 -> 업종 후보 리스트
        return: [{"code":..., "path":..., "score":..., "method": "keyword"|"embedding"}]
        """
        tokens = re.split(r'[,\s·/()]+', product_text)
        tokens = [t.strip() for t in tokens if len(t.strip()) >= 2]

        # 1단계: 키워드 직접 매치
        hits = defaultdict(int)
        for t in tokens:
            for code in self.keyword_index.get(t, []):
                hits[code] += 1

        if hits:
            ranked = sorted(hits.items(), key=lambda x: -x[1])[:top_k]
            by_code = {n['code']: n for n in self.leaf_nodes}
            return [
                {
                    "code": code,
                    "path": by_code[code]['path'],
                    "score": score,
                    "method": "keyword"
                }
                for code, score in ranked
            ]

        # 2단계: 임베딩 폴백 (embed_fn 미주입 시 빈 결과 + 안내)
        if not self.embed_fn:
            return [{
                "code": None, "path": None, "score": 0,
                "method": "unresolved",
                "note": "키워드 매치 실패. embed_fn을 주입하면 의미 기반 매칭이 가능합니다."
            }]

        query_vec = self.embed_fn(product_text)
        scored = []
        for node in self.leaf_nodes:
            vec = self.embed_fn(node['path'])
            score = _cosine(query_vec, vec)
            scored.append((node, score))
        scored.sort(key=lambda x: -x[1])
        return [
            {"code": n['code'], "path": n['path'], "score": round(s, 4), "method": "embedding"}
            for n, s in scored[:top_k]
        ]


def _cosine(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    return dot / (na * nb) if na and nb else 0.0


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--flat", default="../classification/out/ksic-flat.csv")
    ap.add_argument("--paths", default="../classification/out/ksic-paths.jsonl")
    ap.add_argument("--query", required=True)
    args = ap.parse_args()

    clf = KsicClassifier(args.flat, args.paths)
    for r in clf.classify(args.query):
        print(r)
