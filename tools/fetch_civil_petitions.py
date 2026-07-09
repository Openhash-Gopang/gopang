"""
tools/fetch_civil_petitions.py
Phase 0 — data.go.kr "대한민국 공공서비스(혜택) 정보" API 자동 수집

확인된 스펙 (2026-07-09, Swagger UI 캡처 기준):
  Base URL: https://api.odcloud.kr/api
  Endpoint: /gov24/v3/serviceList
  응답 구조: {page, perPage, totalCount, currentCount, matchCount, data: [...]}
  data 항목 필드: 서비스ID, 지원유형, 서비스명, 서비스목적요약, 지원대상, 선정기준,
                 지원내용, 신청방법, 신청기한, 상세조회URL, 소관기관코드, 소관기관명,
                 부서명, 조회수, 소관기관유형, 사용자구분, 서비스분야, 접수기관,
                 전화문의, 등록일시, 수정일시

★ 요청 파라미터(serviceKey/page/perPage/returnType)는 odcloud.kr 관례를 따른 추정치다.
  첫 실행에서 400/401 에러가 나면 Swagger UI의 "Try it out"으로 정확한 파라미터명을
  확인해 아래 PARAMS만 교체하면 된다 — 그 외 로직은 변경 불필요.

사용법:
    python fetch_civil_petitions.py --service-key {발급받은 Decoding 키}

출력:
    civil-petitions-raw.json — 82개 부서 매핑용 뼈대 (input/output은 비어있음, status: draft)
"""
import requests
import json
import time
import argparse

BASE_URL = "https://api.odcloud.kr/api/gov24/v3/serviceList"

def fetch_page(service_key: str, page: int, per_page: int = 100) -> dict:
    params = {
        "serviceKey": service_key,
        "page": page,
        "perPage": per_page,
        "returnType": "JSON",
    }
    resp = requests.get(BASE_URL, params=params, timeout=10)
    resp.raise_for_status()
    return resp.json()

def collect_all(service_key: str) -> list:
    all_items = []
    page = 1
    total_count = None
    while True:
        body = fetch_page(service_key, page)
        items = body.get("data", [])
        if total_count is None:
            total_count = body.get("totalCount", 0)
            print(f"전체 {total_count}건 확인됨")
        if not items:
            break
        all_items.extend(items)
        print(f"page {page}: {len(items)}건 수집, 누적 {len(all_items)}/{total_count}건")
        if len(all_items) >= total_count:
            break
        page += 1
        time.sleep(0.2)  # 과도한 호출 방지 (일 50만 건 한도 내에서도 서버 배려)
    return all_items

def to_petition_skeleton(raw: dict) -> dict:
    """82개 부서 매핑 및 procedure_maps 스키마에 맞는 뼈대로 변환."""
    return {
        "petition_id": raw.get("서비스ID", ""),
        "petition_name": raw.get("서비스명", ""),
        "summary": raw.get("서비스목적요약", ""),
        "target": raw.get("지원대상", ""),
        "eligibility": raw.get("선정기준", ""),
        "content": raw.get("지원내용", ""),
        "apply_method": raw.get("신청방법", ""),
        "apply_deadline": raw.get("신청기한", ""),
        "detail_url": raw.get("상세조회URL", ""),
        "org_code": raw.get("소관기관코드", ""),
        "org_name": raw.get("소관기관명", ""),          # ★ 82개 부서 매핑과 여기서 조인
        "org_dept": raw.get("부서명", ""),
        "org_branch_hint": raw.get("소관기관유형", ""),   # ★ org_profiles.branch 매핑 후보
        "service_category": raw.get("서비스분야", ""),
        "receiving_org": raw.get("접수기관", ""),
        "phone": raw.get("전화문의", ""),
        # 아래 두 필드는 이후 Phase 1/2/3에서 채움 (지금은 항상 비어있음)
        "input": None,
        "output": None,
        "status": "draft",
    }

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--service-key", required=True, help="data.go.kr Decoding 인증키")
    parser.add_argument("--out", default="civil-petitions-raw.json")
    args = parser.parse_args()

    raw_items = collect_all(args.service_key)
    skeletons = [to_petition_skeleton(item) for item in raw_items]

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(skeletons, f, ensure_ascii=False, indent=2)

    print(f"완료: {len(skeletons)}건을 {args.out}에 저장")
    # 소관기관명 기준 분포 요약 (82개 부서 매핑 커버리지 확인용)
    org_counts = {}
    for s in skeletons:
        org_counts[s["org_name"]] = org_counts.get(s["org_name"], 0) + 1
    print("\n상위 소관기관 (건수 기준):")
    for name, cnt in sorted(org_counts.items(), key=lambda x: -x[1])[:15]:
        print(f"  {name}: {cnt}건")

if __name__ == "__main__":
    main()
