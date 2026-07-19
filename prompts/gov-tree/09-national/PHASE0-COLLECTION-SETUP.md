# Phase 0 — 민원 목록 자동 수집 착수 가이드

> 작성일: 2026-07-09
> 상태: **활용신청 전 — 아래 1단계부터 주피터님이 직접 진행 필요**

---

## 1. API 활용신청 (주피터님 직접 진행 필요)

data.go.kr 페이지를 확인한 결과, 실제 REST 엔드포인트·응답 필드는 로그인 후 활용신청을 해야 Swagger UI로 확인할 수 있어 제가 대신 확인할 수 없었습니다. 아래 두 API를 신청해주세요 — 둘 다 **무료, 자동승인**이라 신청 즉시 바로 쓸 수 있습니다.

| API명 | 용도 | URL |
|---|---|---|
| 행정안전부_대한민국 공공서비스(혜택) 정보 | 민원·공공서비스 목록 전체 | https://www.data.go.kr/data/15113968/openapi.do |
| 행정안전부_통계연보_정부24 민원서비스 사무 종류 | 신청/발급/열람 통계(우선순위 산정용) | https://www.data.go.kr/data/15107413/openapi.do |

**진행 방법**: 각 페이지에서 로그인 후 "활용신청" 버튼 클릭 → 자동승인 → 마이페이지에서 발급된 `serviceKey` 확인 → Swagger UI("활용 명세")에서 실제 엔드포인트 URL과 응답 필드명 확인.

`serviceKey`를 확인하시면 아래 스크립트의 `TODO` 부분을 채워서 바로 실행할 수 있습니다.

---

## 2. 수집 스크립트 골격 (`tools/fetch_civil_petitions.py`)

data.go.kr 계열 API는 대부분 `serviceKey`·`pageNo`·`numOfRows`·`type=json` 파라미터 관례를 따릅니다. 정확한 엔드포인트 경로와 필드명은 Swagger UI 확인 후 `TODO` 표시 부분만 교체하면 됩니다.

```python
"""
tools/fetch_civil_petitions.py
Phase 0 — data.go.kr 공공서비스(민원) 목록 자동 수집

사용법:
    python fetch_civil_petitions.py --service-key {발급받은 키}

출력:
    civil-petitions-raw.json — 82개 부서 매핑용 뼈대 (input/output은 비어있음)
"""
import requests
import json
import time
import argparse

# TODO: Swagger UI 확인 후 정확한 엔드포인트로 교체
BASE_URL = "https://api.data.go.kr/openapi/tn_pubr_public_svc_api"  # 추정 — 실제 확인 필요

def fetch_page(service_key: str, page_no: int, num_of_rows: int = 100) -> dict:
    params = {
        "serviceKey": service_key,
        "pageNo": page_no,
        "numOfRows": num_of_rows,
        "type": "json",
    }
    resp = requests.get(BASE_URL, params=params, timeout=10)
    resp.raise_for_status()
    return resp.json()

def collect_all(service_key: str) -> list:
    all_items = []
    page = 1
    while True:
        data = fetch_page(service_key, page)
        # TODO: 실제 응답 구조 확인 후 경로 수정
        items = data.get("response", {}).get("body", {}).get("items", [])
        if not items:
            break
        all_items.extend(items)
        print(f"page {page}: {len(items)}건 수집, 누적 {len(all_items)}건")
        page += 1
        time.sleep(0.2)  # 과도한 호출 방지
    return all_items

def to_petition_skeleton(raw_item: dict) -> dict:
    """82개 부서 매핑 및 procedure_maps 스키마에 맞는 뼈대로 변환.
    TODO: 실제 필드명 확인 후 키 매핑 수정."""
    return {
        "petition_name": raw_item.get("서비스명", ""),  # TODO
        "petition_code": raw_item.get("서비스ID", ""),  # TODO
        "org_dept": raw_item.get("소관기관명", ""),      # TODO — 82개 부서 매핑과 연결
        "legal_basis": raw_item.get("근거법령", ""),     # TODO
        "apply_type": raw_item.get("신청방식", ""),      # 신청/열람/발급 구분, TODO
        "input": None,   # Phase 1/2/3에서 채움
        "output": None,  # Phase 1/2/3에서 채움
        "status": "draft",
    }

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--service-key", required=True)
    parser.add_argument("--out", default="civil-petitions-raw.json")
    args = parser.parse_args()

    raw_items = collect_all(args.service_key)
    skeletons = [to_petition_skeleton(item) for item in raw_items]

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(skeletons, f, ensure_ascii=False, indent=2)

    print(f"완료: {len(skeletons)}건을 {args.out}에 저장")

if __name__ == "__main__":
    main()
```

---

## 3. 이 스크립트가 하는 일 / 하지 않는 일

- **한다**: 약 2,800건의 민원명·소관부처·근거법령을 자동으로 긁어와 `status: draft` 뼈대로 저장 — 이게 계획서 Phase 0의 전부입니다.
- **하지 않는다**: input/output을 채우지 않습니다. 그건 Phase 1(20~30건 수작업) + 온디맨드(나머지 전부)의 몫입니다.

---

## 4. 다음 단계

1. 위 활용신청 진행 → `serviceKey` 확보
2. Swagger UI에서 실제 필드명 확인 → 스크립트 TODO 4곳 교체
3. 스크립트 실행 → `civil-petitions-raw.json` 생성
4. 그 결과를 `prompts/Jejudo/09-national/`의 82개 부서 매핑과 대조해 소관부처 필드 정합성 확인

`serviceKey` 발급받으시면 알려주세요 — 스크립트 TODO 부분을 실제 필드명에 맞춰 완성해드리겠습니다.
