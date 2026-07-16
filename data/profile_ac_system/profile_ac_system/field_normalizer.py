#!/usr/bin/env python3
"""
2) 업종별 profile/AC 필드 정규화 파이프라인
field_observations(원본) -> 클러스터링 -> 빈도 필터 -> promotion_queue -> (승인) -> standard_fields

임베딩 함수는 주입식(pluggable). 실제 운영에서는 사내 임베딩 API를 연결.
이 스크립트는 데모/테스트용으로 간단한 문자열 유사도 폴백을 기본 제공.
"""
import json, argparse
from collections import defaultdict
from difflib import SequenceMatcher

def default_similarity(a, b):
    """embed_fn 미주입시 폴백: 문자열 유사도. 운영 배포 전 반드시 실제 임베딩으로 교체할 것."""
    return SequenceMatcher(None, a, b).ratio()


class FieldNormalizer:
    def __init__(self, similarity_fn=None, cluster_threshold=0.72, promotion_ratio=0.15):
        self.similarity_fn = similarity_fn or default_similarity
        self.cluster_threshold = cluster_threshold  # 이 이상 유사하면 같은 클러스터
        self.promotion_ratio = promotion_ratio        # 업종 내 사용자의 이 비율 이상 써야 승격 후보

    def cluster(self, raw_labels_with_count):
        """
        raw_labels_with_count: {label: count} — 이미 label별 관측 횟수 집계된 상태
        단순 single-link 클러스터링 (라벨 종류가 수백~수천 단위일 것으로 예상, 그 이상이면
        임베딩 기반 벡터 인덱스(faiss 등)로 교체 필요 — 이 구현은 프로토타입)
        """
        labels = list(raw_labels_with_count.keys())
        parent = {l: l for l in labels}

        def find(x):
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        def union(a, b):
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[ra] = rb

        for i in range(len(labels)):
            for j in range(i + 1, len(labels)):
                if self.similarity_fn(labels[i], labels[j]) >= self.cluster_threshold:
                    union(labels[i], labels[j])

        clusters = defaultdict(list)
        for l in labels:
            clusters[find(l)].append(l)

        return list(clusters.values())

    def build_promotion_queue(self, ksic_code, kind, raw_labels_with_count, total_users):
        clusters = self.cluster(raw_labels_with_count)
        queue = []
        for members in clusters:
            total_count = sum(raw_labels_with_count[m] for m in members)
            if total_users > 0 and (total_count / total_users) >= self.promotion_ratio:
                suggested = max(members, key=lambda m: raw_labels_with_count[m])
                queue.append({
                    "ksic_code": ksic_code,
                    "kind": kind,
                    "cluster_members": members,
                    "suggested_canonical": suggested,
                    "observation_count": total_count,
                    "status": "pending"
                })
        return queue


if __name__ == "__main__":
    # 데모: 카페 업종 profile_field 관측 예시
    demo_observations = {
        "영업시간": 40, "운영시간": 12, "오픈시간": 5,
        "원두 로스팅 정보": 22, "로스팅 정보": 9,
        "배달가능여부": 30, "배달 가능 여부": 8,
        "완전 유니크한 필드명 한번만나옴": 1,
    }
    fn = FieldNormalizer()
    queue = fn.build_promotion_queue(
        ksic_code="56220", kind="profile_field",
        raw_labels_with_count=demo_observations, total_users=50
    )
    print(json.dumps(queue, ensure_ascii=False, indent=2))
