#!/usr/bin/env python3
"""
3) 표준화된 필드(standard_fields)로부터 업종별 신규 사용자 템플릿 생성
standard_fields -> industry_templates

승격 검토(promotion_queue -> approved)까지 끝난 데이터를 입력으로 받는다고 가정.
"""
import json, argparse
from collections import defaultdict

def generate_templates(standard_fields, min_users_for_confidence=5):
    """
    standard_fields: [{"ksic_code","kind","canonical_label","observation_count", ...}, ...]
    return: {ksic_code: {"profile_fields":[...], "ac_features":[...], "confidence": "low"|"ok"}}
    """
    by_industry = defaultdict(lambda: {"profile_field": [], "ac_feature": []})

    for f in standard_fields:
        by_industry[f["ksic_code"]][f["kind"]].append(f)

    templates = {}
    for ksic_code, kinds in by_industry.items():
        profile_fields = sorted(kinds["profile_field"], key=lambda x: -x["observation_count"])
        ac_features = sorted(kinds["ac_feature"], key=lambda x: -x["observation_count"])
        total_obs = sum(f["observation_count"] for f in profile_fields + ac_features) or 1

        templates[ksic_code] = {
            "ksic_code": ksic_code,
            "profile_fields": [f["canonical_label"] for f in profile_fields],
            "ac_features": [f["canonical_label"] for f in ac_features],
            "confidence": "ok" if total_obs >= min_users_for_confidence else "low_sample",
            "based_on_observation_count": total_obs
        }
    return templates


if __name__ == "__main__":
    demo_standard_fields = [
        {"ksic_code": "56220", "kind": "profile_field", "canonical_label": "영업시간", "observation_count": 52},
        {"ksic_code": "56220", "kind": "profile_field", "canonical_label": "원두 로스팅 정보", "observation_count": 31},
        {"ksic_code": "56220", "kind": "profile_field", "canonical_label": "배달가능여부", "observation_count": 38},
        {"ksic_code": "56220", "kind": "ac_feature", "canonical_label": "예약 관리", "observation_count": 44},
    ]
    result = generate_templates(demo_standard_fields)
    print(json.dumps(result, ensure_ascii=False, indent=2))
