#!/usr/bin/env python3
"""
tools/check_no_hardcoded_prompt_urls.py
-----------------------------------------
worker.js가 prompts/ 안의 "버전이 계속 갱신되는" 문서를 GitHub raw URL에
파일명(버전 포함)으로 하드코딩해 가져오고 있지 않은지 검사한다.

배경: UNIVERSAL-common(v1_7에 박제 → U11 신설분 유실 뻔함), UNIVERSAL-INTEGRITY
(v1_0에 박제, 2026-07-09 수정), SP_lawyer(v3.2에 몇 주간 고정) 등 이 세션에서만
3번 이상 반복된 사고의 공통 원인 — "최신 버전"이 파일명 안에 있고, 그 파일명을
참조하는 곳이 여러 군데로 흩어져 있어 갱신 시 한 곳이라도 빠뜨리면 조용히
구버전을 계속 서빙한다.

정답 경로는 항상: sp-catalog.json에 안정된 키로 등록 →
_fetchByManifestKeyFromGithub(key)로 조회. 이 스크립트는 그 우회로가 다시
생기는 것을 빌드 단계에서 차단한다.

사용법: python3 tools/check_no_hardcoded_prompt_urls.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
WORKER = ROOT / 'worker.js'

# raw.githubusercontent.com/.../prompts/{경로}_v{숫자}.{md|txt} 형태 —
# 버전 번호가 파일명에 박힌 하드코딩 패턴만 잡는다(디렉토리 계층 있는
# Jejudo/01-do/... 도 포함되도록 prompts/ 뒤는 자유 경로로 허용).
HARDCODED_VERSIONED_URL_RE = re.compile(
    r"raw\.githubusercontent\.com/Openhash-Gopang/gopang/main/prompts/"
    r"([\w\-/]+_v[\d._]+\.(?:md|txt))"
)

# 의도적으로 허용하는 예외 — SP_DELEGATION_REGISTRY의 via:'url' 항목처럼
# "이 문서는 아직 sp-catalog.json에 등록 전이며, 그 사실이 코드 주석으로
# 이미 명시돼 있다"는 경우만 여기 등록한다. 새 항목을 추가할 때는 반드시
# 이유를 주석으로 남기고, 가능하면 sp-catalog.json 등록 쪽을 우선 검토한다.
ALLOWLIST = {
    # SP_DELEGATION_REGISTRY(제주 지역 트리 전용, via:'url' 명시) —
    # 2026-07-20 실사 시점 기준 sp-catalog.json 미등록 상태. 등록되면
    # via:'manifest'로 전환하고 이 allowlist에서 제거해야 한다.
    'Jejudo/01-do/JEJU-DO-SP_v1.5.md',
    'Jejudo/09-national/JEJU-NATIONAL-SP_v1.0.md',
}


def main() -> int:
    text = WORKER.read_text(encoding='utf-8')
    found = sorted(set(HARDCODED_VERSIONED_URL_RE.findall(text)))
    violations = [f for f in found if f not in ALLOWLIST]

    if violations:
        print("✗ worker.js에 매니페스트(sp-catalog.json)를 우회하는 하드코딩 버전 URL 발견:")
        for v in violations:
            print("  -", v)
        print("  → sp-catalog.json에 안정된 키로 등록하고 _fetchByManifestKeyFromGithub()")
        print("    로 조회하도록 고치세요. (참고: UNIVERSAL-common이 이 문제로 세 번째")
        print("    stale 사고가 날 뻔했던 사례가 이 검사를 만든 계기입니다.)")
        return 1

    print(f"✓ 하드코딩된 버전 URL 없음 (allowlist {len(ALLOWLIST)}건 제외, "
          f"발견된 URL {len(found)}건 전부 처리됨)")
    return 0


if __name__ == '__main__':
    sys.exit(main())
