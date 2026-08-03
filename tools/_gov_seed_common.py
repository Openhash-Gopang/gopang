#!/usr/bin/env python3
"""
_gov_seed_common.py — gov-tree 시딩 스크립트 3종(seed_gov_tree_registry.py,
seed_gov_tree_citydept_natagency.py, seed_gov_tree_remaining_registry.py)이
공유하는 "재시딩 전 기존 등록 여부 확인" 헬퍼.

배경(2026-08-03): seed_gov_tree_registry.py --apply를 --only ACRC로
재실행했다가, ACRC가 실제로는 이미 등록돼 있었는데도(최초 70건 배치에
포함, 성공 기록 있음) 중복으로 새 unclaimed 프로필이 하나 더 생성되는
사고가 실제로 발생했다(K-Search에서 "국민권익위원회" 검색 시 서로 다른
guid를 가진 결과가 2건 나옴 — [GWP:guid] 단일 진입 원칙 위반).
원인은 검증 스크립트가 아니라 seed 스크립트 자체 — POST /profile 전에
"이미 있는지" 확인하는 절차가 아예 없었다(스크립트 자신의 docstring도
"멱등성이 없다"고 스스로 경고하고 있었다). 이 모듈은 그 구멍을 구조적으로
막는다: 매 --apply 실행 시 POST하기 전에 먼저 POST /search(읽기 전용)로
동일 entity_subtype이 이미 존재하는지 확인하고, 있으면 건너뛴다.

**쓰기 없음** — 이 모듈 자체는 /search(읽기)만 호출한다. 실제 POST
/profile은 각 seed 스크립트가 그대로 수행한다(이 모듈은 게이트 역할만).
"""
import json
import urllib.request
import urllib.error

_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
       "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")


def search_institutions(worker_base, query, entity_type="institution", timeout=15):
    """POST /search — 읽기 전용. 네트워크/서버 오류는 그대로 예외로 전파한다
    (호출자가 '확인 불가'와 '없음'을 구분해서 처리하도록 — 확인 불가를
    '없음'으로 잘못 해석하면 이번 ACRC 사고의 원인과 똑같은 함정에 빠진다).

    entity_type 기본값은 'institution'(gov-tree 계열)이지만, GWP/EXPERT
    처럼 entity_type='platform'인 계열도 있어 파라미터화했다(2026-08-03 —
    seed_gwp_expert_registry.py 연동 시 발견: 하드코딩돼 있었다면 platform
    엔티티는 전부 '없음'으로 오판돼 매번 새로 생성됐을 것).
    """
    req = urllib.request.Request(
        f"{worker_base.rstrip('/')}/search",
        data=json.dumps({"q": query, "etype": entity_type, "lim": 20}).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": _UA},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def extract_identity(entity):
    """검색 결과 entity에서 extra.public.identity를 안전하게 꺼낸다.
    entity_subtype/tags가 실제로 위치하는 경로 — worker.js의
    _l1SearchEntities()/_filterProfileByVisibility() 확인 결과
    (2026-08-03, verify_gov_tree_registry_seeding.py와 동일한 수정).
    """
    extra = entity.get("extra") or {}
    public = extra.get("public") or {}
    return public.get("identity") or {}


def find_existing_guid(worker_base, name, gov_code, code, entity_type="institution", timeout=15):
    """gov_code(entity_subtype)로 이미 등록된 엔티티가 있으면 그 guid를
    반환한다. 확실히 없으면 None. 확인 자체가 실패하면(타임아웃 등)
    예외를 그대로 올린다 — 호출자가 "모르면 스킵하지 말고 사람에게 물어라"
    원칙을 지키도록 강제한다.

    entity_type 기본값 'institution'은 gov-tree 계열 3개 스크립트용.
    GWP/EXPERT(entity_type='platform')처럼 다른 계열은 호출 시 명시할 것.
    """
    results = search_institutions(worker_base, name, entity_type=entity_type, timeout=timeout)
    for e in results:
        if e.get("entity_type") != entity_type:
            continue
        ident = extract_identity(e)
        subtype = ident.get("entity_subtype")
        etags = ident.get("tags") or []
        if subtype == gov_code or gov_code in etags or code in etags:
            return e.get("primary_guid") or e.get("guid")
    return None
