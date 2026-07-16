#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
민원 배치 자동 분류 + 이상탐지 스크립트 (파이프라인 2단계)

입력: data/minwon-raw/batch_NNN_*.json
출력: data/minwon-classified/batch_NNN.json

이상탐지 규칙 5개 (지난 50건 수작업 감사에서 실제로 발견한 패턴을 규칙화):
  R1. 카테고리-키워드 불일치 (예: 주민등록 관련인데 "주택 및 부동산"으로 태깅)
  R2. 제목 동사 vs 버튼 라벨 동사 불일치 (예: 제목은 "열람"인데 버튼은 "발급하기")
  R3. 설명(description) 텍스트 중복 해시 (복붙 오류 탐지 + 배치 간 문서군 탐지)
  R4. 통합/일괄형(관문서비스) 문구 탐지
  R5. 기존 REQUIRED_DOCUMENTS_REGISTRY / 알려진 도메인 taxonomy와 매칭 안 되는 신규 task_key
  R6. 배치 간(cross-batch) 동일 제목(공백 정규화), 다른 소관기관 충돌 탐지
  R7. 폐지·통합된 행정구역/기관명(예: 전라남도·광주광역시)이 소관기관으로
      그대로 들어온 경우 — 승계기관 확인 요구(SUCCESSOR_AGENCY_MAP)
  R8. 전국 표준형 서비스인데 특정 시군구 하나만 소관기관인 경우 — 검증 요청

도메인 taxonomy는 SP-CIVIL-* (죽은 라우팅 경로지만 분류 사전으로는 재사용)의
17개 도메인 근사치를 시드로 사용한다. 여기서 신규 도메인이 나오면(예: "치안/신고")
그 자체가 taxonomy 갱신이 필요하다는 신호다.

검토 프로토콜 (2026-07-16 추가 — UNIVERSAL-common U2-1 반영):
  이 스크립트가 잡아내지 못하는 이상(예: 기관명·지명이 낯설어 보이는 경우)을
  검토자(Claude)가 수동으로 짚을 때는, "생소하다"를 "존재하지 않는다/오류다"로
  단정하지 않는다. 실제 사례: "전남광주통합특별시"(2026-07-01 전라남도·
  광주광역시 통폐합으로 신설된 실제 행정구역)를 확인 없이 데이터 오류로
  오판한 적이 있다 — 이런 항목은 반드시 웹검색으로 먼저 검증한 뒤 판단을
  반영해야 한다. 이 스크립트 자체는 웹 접근이 없으므로, 이런 유형의 발견은
  "확정된 오류"가 아니라 "검증 필요"로 표시해 검토자에게 넘긴다.
"""

import json
import re
import hashlib
import sys
from pathlib import Path
from collections import defaultdict

# ── 도메인 taxonomy 시드 (SP-CIVIL-IO-VALIDATION-TABLE 기준 + 이번 배치에서 드러난 추가 후보) ──
DOMAIN_KEYWORDS = {
    "FAMILY":       ["가족관계", "혼인", "출생", "입양", "친양자"],
    "REALESTATE":   ["부동산", "건축물", "토지", "임야", "등기", "공동주택가격"],
    "TAX":          ["세무", "납세", "과세", "부가가치세", "지방세", "환급금", "위택스", "체납"],
    "VEHICLE":      ["차량", "운송", "운전면허", "자동차", "하이패스"],
    "HEALTH":       ["건강", "의료", "보건의료인", "건강보험", "보건소", "진료"],
    "BIZ":          ["사업자", "농지", "농업경영체", "중소기업", "통신판매업", "공장등록"],
    "IMMIGRATION":  ["출입국", "외국인", "여권"],
    "MILITARY":     ["병역", "보훈", "예비군", "병무청", "병적", "병력동원"],
    "WELFARECERT":  ["복지", "수급자", "장애인", "감면", "한부모가족"],
    "STUPARENT":    ["학생", "학부모", "재학", "졸업", "성적", "학교생활기록부", "검정고시"],
    "TEACHER":      ["교원", "교육공무직", "재직증명서"],
    "PENSION":      ["연금", "국민연금"],
    "LABOR":        ["고용보험", "산재보험", "근로복지", "고용노동부", "휴직", "실업급여"],
    "FINANCE":      ["금융거래", "신용"],
    "IDENTITY_REG": ["주민등록", "전자본인서명확인서", "인감"],  # 2026-07-16 확정 편입(4회 반복 확인)
    "MATERNITY":    ["임신", "난임", "출산", "육아"],
    "PUBLIC_SAFETY":["성매매", "사건조회", "신고", "분실", "습득", "고소", "고발"],  # 2026-07-16 확정 편입(3회+)
    "RESERVATION":  ["예약", "검사 예약", "방문 예약"],  # 2026-07-16 확정 편입(2회)
    "CERT_EXAM":    ["자격검정", "지도사", "어학성적"],          # 관찰 대상 — 1회만 관찰(배치2 #35)
    "POLICY_INFO":  ["제도", "지원 제도"],                       # 관찰 대상 — 1회만 관찰(배치2 #43)
}


PROC_VERB_MAP = {
    "발급": "ISSUE", "발급하기": "ISSUE",
    "신청": "APPLY", "신청하기": "APPLY",
    "신고": "REPORT", "신고하기": "REPORT",
    "정정": "CHANGE", "변경": "CHANGE",
    "조회": "INQUIRY", "조회하기": "INQUIRY", "열람": "INQUIRY",
    "예약": "RESERVE", "내용보기": "RESERVE_OR_VIEW",
    "사이트가기": "PORTAL_REDIRECT",
}

BUNDLE_PATTERNS_WEAK = ["일괄", "통합", "한 번에", "한번에", "다량"]
# 강신호: 제목 자체가 "통합/일괄 처리"를 표방하는 경우 — 3배치 누적 검증 결과
# 이 패턴은 오탐이 한 건도 없었다(요금감면일괄신청·행복출산 통합처리·
# 임신지원 통합제공). 정규식은 중간 공백 허용(원문에 "통합 제공"처럼
# 띄어쓰기가 섞여 있음).
BUNDLE_TITLE_STRONG_RE = re.compile(r"통합\s*(처리|제공|신청)|일괄\s*(신청|정산|접수)")

# ── 폐지·통합된 행정구역/기관 매핑 (2026-07-16 신설) ─────────────────────
# U2-1 원칙("생소함과 오류를 혼동하지 않는다")의 반대 방향 안전장치:
# 이번엔 "실제로 없어진 기관"을 옛 이름 그대로 신뢰하는 반대쪽 오류를
# 막는다. 전남광주통합특별시 출범(2026-07-01)으로 전라남도·광주광역시가
# 법적으로 폐지됐다 — 옛 이름이 그대로 들어오면 자동으로 플래그한다.
# 신규 통폐합이 생기면 이 맵에 항목만 추가하면 된다(코드 로직 변경 불필요).
SUCCESSOR_AGENCY_MAP = {
    "전라남도": {
        "successor": "전남광주통합특별시",
        "effective_date": "2026-07-01",
        "basis": "전남광주통합특별시 설치를 위한 특별법(2026-03-05 공포)",
    },
    "광주광역시": {
        "successor": "전남광주통합특별시",
        "effective_date": "2026-07-01",
        "basis": "전남광주통합특별시 설치를 위한 특별법(2026-03-05 공포)",
    },
}


def normalize_task_key(agency, title):
    slug = re.sub(r"[()\s·,\-.]+", "_", title).strip("_")
    agency_slug = agency[0] if agency else "unknown_agency"
    return f"{agency_slug}:{slug}"


def title_verb(title: str):
    for verb in ["열람", "조회", "발급", "신청", "신고", "정정", "예약"]:
        if verb in title:
            return verb
    return None


def normalize_title(title: str) -> str:
    return re.sub(r"\s+", "", title or "")


def button_verb(button):
    if not button:
        return None
    return PROC_VERB_MAP.get(button, None)


def guess_domain(item):
    text = (item.get("title") or "") + " " + (item.get("description") or "")
    hits = []
    for domain, kws in DOMAIN_KEYWORDS.items():
        if any(kw in text for kw in kws):
            hits.append(domain)
    return hits


def load_prior_batches(classified_dir: Path, exclude_batch_id: str):
    """이미 분류된 이전 배치들을 불러와 배치 간 대조 자료로 사용한다."""
    prior_items = []  # [{batch_id, id, title, agency, ...}]
    if not classified_dir.exists():
        return prior_items
    for f in sorted(classified_dir.glob("batch_*.json")):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        if d.get("batch_id") == exclude_batch_id:
            continue
        for it in d.get("items", []):
            prior_items.append(it)
    return prior_items


def load_prior_raw_batches(raw_dir: Path, exclude_batch_id: str):
    """이전 배치의 원본(raw) 파일을 불러온다 — description 교차대조용(분류 산출물에는 원문 description이 없음)."""
    prior_items = []
    if not raw_dir.exists():
        return prior_items
    for f in sorted(raw_dir.glob("batch_*.json")):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        if d.get("batch_id") == exclude_batch_id:
            continue
        for it in d.get("items", []):
            prior_items.append({**it, "_batch_id": d.get("batch_id")})
    return prior_items


def classify_batch(raw_path: Path, out_path: Path, classified_dir: Path = None, raw_dir: Path = None):
    raw = json.loads(raw_path.read_text(encoding="utf-8"))
    items = raw["items"]
    classified_dir = classified_dir or out_path.parent
    raw_dir = raw_dir or raw_path.parent
    prior_items = load_prior_batches(classified_dir, raw["batch_id"])
    prior_raw_items = load_prior_raw_batches(raw_dir, raw["batch_id"])

    # 배치 간 대조용: 이전 배치의 (제목 -> agency 목록), (description hash -> [(batch_id,id,title)])
    prior_title_agency = defaultdict(set)
    prior_desc_hash = defaultdict(list)
    for pit in prior_items:
        prior_title_agency[normalize_title(pit["title"])].update(pit.get("agency", []) or [])
        # 이전 배치 산출물에는 원본 description이 없으므로(분류 결과만 저장) 여기선 제목 기준만 비교.
    for pit in prior_raw_items:
        h = hashlib.sha256((pit.get("description") or "").strip().encode("utf-8")).hexdigest()
        prior_desc_hash[h].append({"batch_id": pit.get("_batch_id"), "id": pit.get("id"), "title": pit.get("title")})

    # R3용: description 해시 -> id 목록 (이번 배치 내부)
    desc_hash_map = defaultdict(list)
    for it in items:
        h = hashlib.sha256((it.get("description") or "").strip().encode("utf-8")).hexdigest()
        desc_hash_map[h].append(it["id"])


    classified = []
    domain_counts = defaultdict(int)
    watch_domain_candidates = set()  # 아직 1회만 관찰돼 정식 편입 보류 중인 것만

    # 2026-07-16 taxonomy 확정: 3배치(150건) 누적 검증 결과 아래 3개는
    # 반복 확인(각 2회 이상)돼 정식 도메인으로 편입한다 — 더 이상
    # "17개 밖 후보"로 매번 재보고하지 않는다(원래 17개 + 이 3개 = 20개).
    #   IDENTITY_REG: 배치1(3건) + 배치2(1건) + 배치3(1건) = 4회
    #   PUBLIC_SAFETY: 배치1(1건) + 배치2(1건, 습득조회) + 배치3(2건, 고소고발/여권분실) = 3회+
    #   RESERVATION: 배치1(1건, 자동차검사예약) + 배치3(1건, 방문예약) = 2회
    CONFIRMED_NEW_DOMAINS = {"IDENTITY_REG", "PUBLIC_SAFETY", "RESERVATION"}
    # 아직 1회만 나온 것(CERT_EXAM: 배치2 #35, POLICY_INFO: 배치2 #43)은
    # 계속 관찰 대상으로만 표시 — 다음 배치에서 재확인되면 그때 정식 편입.
    WATCH_LIST = {"CERT_EXAM", "POLICY_INFO"}

    for it in items:
        flags = []

        domain_hits = guess_domain(it)
        for d in domain_hits:
            domain_counts[d] += 1
            if d in WATCH_LIST:
                watch_domain_candidates.add(d)

        # R1: 카테고리-키워드 불일치
        cat = it.get("category")
        implausible_categories_for_identity = {"주택 및 부동산", "세무 및 납세", "차량 및 운송"}
        if cat in implausible_categories_for_identity and "IDENTITY_REG" in domain_hits and cat.split()[0] not in it["title"]:
            flags.append({
                "rule": "R1_category_keyword_mismatch",
                "detail": f"원문 카테고리='{cat}'이지만 내용상 주민등록/신원 계열(IDENTITY_REG)로 추정됨 — 해당 도메인과 무관해 보임."
            })
        if it.get("agency") == ["법무부"] and ("검찰" in it["title"] or "경찰" in it["title"]):
            flags.append({
                "rule": "R1_agency_label_ambiguous",
                "detail": "소관기관 라벨이 '법무부'로만 표기됐으나 실제 서비스명은 경찰/검찰로 구분됨 — 동일 라벨이 서로 다른 실집행기관을 가리킴."
            })

        # R2: 제목 동사 vs 버튼 동사 불일치
        tv, bv = title_verb(it["title"]), button_verb(it.get("button"))
        if tv == "열람" and bv == "ISSUE":
            flags.append({
                "rule": "R2_title_button_verb_mismatch",
                "detail": f"제목 동사='열람'(조회형)인데 버튼='{it.get('button')}'(발급형) — 처리유형 판단 기준이 문서 내에서 상충."
            })

        # R3: 설명 텍스트 중복
        h = hashlib.sha256((it.get("description") or "").strip().encode("utf-8")).hexdigest()
        dupes = [i for i in desc_hash_map[h] if i != it["id"]]
        if dupes:
            flags.append({
                "rule": "R3_duplicate_description",
                "detail": f"설명 텍스트가 항목 {dupes}와 완전히 동일 — 원본 데이터 복붙 오류 가능성."
            })
        cross_dupes = prior_desc_hash.get(h, [])
        if cross_dupes:
            flags.append({
                "rule": "R3_cross_batch_duplicate_description",
                "detail": f"설명 텍스트가 이전 배치 항목 {cross_dupes}와 완전히 동일 — "
                          f"같은 서류군(문서군)의 다른 하위유형일 가능성(§문서군 패턴, task_key 병합 검토 대상)."
            })

        # R4: 관문서비스(번들형) 탐지 — 2026-07-16 정밀도 개선.
        text = (it["title"] or "") + " " + (it.get("description") or "")
        # 3배치(150건) 누적 검증 결과, 설명문 단독 키워드("통합이력"·"한 번에
        # 쉽고 간편하게"·"일괄정정" 등)만으로 판단하면 오탐이 반복됐다
        # (배치2 #19·#30, 배치3 #43 — 전부 실제로는 단일 서비스). 제목이
        # "통합처리/통합제공/일괄신청" 등으로 명시적으로 표방하는 경우만
        # high 신뢰도로 두고, 설명문에만 약한 키워드가 있는 경우는 low
        # 신뢰도로 구분해 표시한다 — 후자는 검토자가 노이즈를 감안할 것.
        if BUNDLE_TITLE_STRONG_RE.search(it["title"] or ""):
            flags.append({
                "rule": "R4_bundled_gateway_service",
                "confidence": "high",
                "detail": "제목이 통합/일괄 처리를 명시적으로 표방 — 단일 agency:task_key로 처리하면 부정확, 하위 항목별 분해 필요(§BUNDLED-TASK 대상)."
            })
        elif any(p in text for p in BUNDLE_PATTERNS_WEAK):
            flags.append({
                "rule": "R4_bundled_gateway_service",
                "confidence": "low",
                "detail": "설명문에만 약한 번들 키워드 존재 — 3배치 누적 검증 결과 이 경우 오탐 비율이 높다(단일 서비스의 '통합 이력'·'일괄 처리 편의성' 표현일 가능성). 실제 여러 기관·서비스가 묶이는지 본문을 직접 확인할 것."
            })

        # R5: 처리유형이 5개 PROC(ISSUE/APPLY/REPORT/CHANGE/INQUIRY) 밖인지
        if bv in ("RESERVE", "RESERVE_OR_VIEW", None) and it.get("button"):
            flags.append({
                "rule": "R5_proc_type_out_of_taxonomy",
                "detail": f"버튼 라벨='{it.get('button')}' — 기존 5개 PROC 유형에 대응 안 됨(예약형 등 taxonomy 공백)."
            })
        if it.get("button") is None:
            flags.append({
                "rule": "R5_missing_button_data",
                "detail": "버튼 라벨 자체가 원문에 없음 — 항목 데이터 자체가 불완전(설명 복붙 오류인 #50과 동일 항목일 가능성)."
            })

        # R7: 폐지·통합된 행정구역/기관명이 소관기관으로 그대로 들어온 경우
        for ag in (it.get("agency") or []):
            if ag in SUCCESSOR_AGENCY_MAP:
                info = SUCCESSOR_AGENCY_MAP[ag]
                flags.append({
                    "rule": "R7_defunct_agency_reference",
                    "detail": f"소관기관 '{ag}'은 {info['effective_date']}부로 폐지되어 "
                              f"'{info['successor']}'로 승계됨({info['basis']}). 이 항목이 "
                              f"실제로 승계기관 소관인지, 혹은 원본 데이터가 통합 이전 시점의 "
                              f"스냅샷인지 웹검색으로 확인 후 반영할 것(U2-1 원칙)."
                })

        # R8: 전국 표준형 서비스로 보이는데 특정 시군구 하나만 소관기관인 경우
        # (예: batch2 #26 '충청북도 보은군', batch3 #47 '충청남도 홍성군' —
        # 실제 오류인지, 원본 수집 시 한 지자체 사례만 샘플링된 것인지는
        # 스크립트가 판단할 수 없다 — U2-1 원칙에 따라 "확인 필요"로만 표시.)
        SPECIFIC_MUNICIPALITY_RE = re.compile(r"(특별시|광역시|특별자치시|특별자치도|도)\s?[가-힣]+(시|군|구)$")
        for ag in (it.get("agency") or []):
            if SPECIFIC_MUNICIPALITY_RE.search(ag) and ag.split()[-1][:2] not in it["title"]:
                flags.append({
                    "rule": "R8_single_municipality_for_generic_service",
                    "detail": f"소관기관이 특정 기초자치단체 하나('{ag}')인데, 서비스명·설명에 "
                              f"그 지역명이 등장하지 않아 전국 표준형 서비스로 보임 — 실제로 이 "
                              f"지자체만 제공하는 서비스인지, 원본이 여러 지자체 중 한 곳의 사례만 "
                              f"수집한 것인지 웹검색으로 확인 필요(U2-1)."
                })

        # R6: 배치 간(cross-batch) 동일 제목, 다른 소관기관 충돌
        norm_title = normalize_title(it["title"])
        if norm_title in prior_title_agency:
            prior_agencies = prior_title_agency[norm_title]
            cur_agencies = set(it.get("agency", []) or [])
            if prior_agencies and cur_agencies and not (prior_agencies & cur_agencies):
                flags.append({
                    "rule": "R6_cross_batch_agency_conflict",
                    "detail": f"동일 제목 '{it['title']}'이 이전 배치에서는 소관기관={sorted(prior_agencies)}로, "
                              f"이번 배치에서는 {sorted(cur_agencies)}로 기록됨 — 동일 서비스명에 서로 다른 "
                              f"소관기관이 붙는 원본 데이터 불일치, 혹은 실제로는 유사명의 별개 서비스."
                })

        classified.append({
            "id": it["id"],
            "title": it["title"],
            "agency": it.get("agency", []),
            "category_raw": cat,
            "domain_candidates": domain_hits,
            "task_key_candidate": normalize_task_key(it.get("agency", []), it["title"]),
            "proc_type_candidate": bv,
            "auth_required": it.get("auth_required"),
            "flags": flags,
            "review_required": len(flags) > 0,
            "priority": (
                "none" if not flags else
                ("low" if all(f.get("confidence") == "low" for f in flags) else "high")
            ),
        })

    out = {
        "batch_id": raw["batch_id"],
        "classified_at": raw["ingested_at"],
        "total_items": len(items),
        "flagged_items": sum(1 for c in classified if c["review_required"]),
        "flagged_high_priority": sum(1 for c in classified if c["priority"] == "high"),
        "flagged_low_priority": sum(1 for c in classified if c["priority"] == "low"),
        "domain_discovery": {
            "taxonomy_size": 17 + len(CONFIRMED_NEW_DOMAINS),  # 2026-07-16부로 20개 확정
            "known_domain_hit_counts": dict(domain_counts),
            "watch_list_candidates": sorted(watch_domain_candidates),  # 아직 편입 보류(1회만 관찰)
        },
        "items": classified,
    }

    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    return out


if __name__ == "__main__":
    raw_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("data/minwon-raw/batch_001_2026-07-16.json")
    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("data/minwon-classified/batch_001.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    result = classify_batch(raw_path, out_path, classified_dir=out_path.parent, raw_dir=raw_path.parent)
    print(f"총 {result['total_items']}건 중 {result['flagged_items']}건 검토 필요로 플래그됨"
          f"(high:{result['flagged_high_priority']}, low:{result['flagged_low_priority']}).")
    print(f"taxonomy 크기: {result['domain_discovery']['taxonomy_size']}개(확정). "
          f"관찰 대상(편입 보류): {result['domain_discovery']['watch_list_candidates']}")
