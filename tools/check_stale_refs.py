#!/usr/bin/env python3
"""
tools/check_stale_refs.py
--------------------------
worker.js·expert-registry.js·expert-session.js·gwp-registry.js(및 필요시
추가 파일)가 참조하는 prompts/ 파일 경로가 (1) 실제로 존재하는지,
(2) 존재한다면 그게 진짜 최신 버전인지 검사한다.

2026-07-05부터는 여기에 더해 (3) GWP_REGISTRY에 등록된 서비스가
SP-00-ROUTER 프롬프트의 서비스 표에도 실제로 등재돼 있는지(=그 서비스로
라우팅될 방법이 존재하는지)도 검사한다 — 아래 "이 스크립트가 잡아내려는
사고 패턴" 목록의 네 번째 항목 참고.

이 스크립트가 잡아내려는 정확한 사고 패턴(2026-07-04~05 세션에서 반복
발견됨):
  - jeju-router.js가 존재하지 않는 SP-EXP-EMERGENCY_v1.1.md를 참조(404)
  - worker.js의 K_PUBLIC_COMMON_URL이 v1.0을 가리키는 동안 v1.1이 이미
    존재(staleness — 새 내용이 반영 안 됨)
  - expert-registry.js 27개 페르소나 중 16개가 v2.2를 참조하는 동안
    v2.3이 이미 존재(staleness)
  - gwp-registry.js에는 'jeju'(제주도청 AI) 서비스가 등록돼 있었지만
    SP-00-ROUTER-v5_0.txt의 서비스 표엔 없어서, 실제 LLM 라우터가 이
    서비스의 존재 자체를 몰라 어떤 시민 질의도 그리로 보낼 수 없는
    상태로 방치돼 있었다(2026-07-05, 정적 코드 분석으로 발견 —
    UNROUTABLE 클래스, 기존 MISSING/STALE과는 다른 새 실패 유형)

■ 종료 코드
  0: 문제 없음
  1: 하나 이상의 MISSING(존재하지 않는 파일 참조, 404 위험),
     STALE(최신 버전이 아닌 참조), 또는 UNROUTABLE(등록된 서비스가
     라우터 서비스 표에 없어 도달 불가능) 발견

■ 범위
  gopang 저장소 내부 .js 파일이 gopang 저장소 내부 prompts/ 파일을
  참조하는 경우만 검사한다. jeju-router.js(별도 jeju 저장소)는 공개
  GitHub raw 엔드포인트이므로 네트워크가 있으면 추가로 원격 fetch해
  검사한다(네트워크 실패 시 건너뛰고 경고만 출력, CI 자체를 막지 않음).
  school/market/stock/gdc 저장소는 자기 자신의 SP 파일만 참조하므로
  이 스크립트의 검사 대상이 아니다(별도 저장소별 점검 필요).
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent.parent
PROMPTS = ROOT / 'prompts'

JS_FILES_TO_SCAN = [
    ROOT / 'worker.js',
    ROOT / 'gwp-registry.js',
    ROOT / 'src' / 'gopang' / 'ai' / 'expert-registry.js',
    ROOT / 'src' / 'gopang' / 'ai' / 'expert-session.js',
    # 2026-07-06 추가 — pages/professional-ai.html(전문가 AI 소개 페이지)의
    # System Prompt 링크 26개가 전부 구버전(v2.2/v2.0)을 가리키고 있었고,
    # 세무사(tax-accountant, 2026-07-04 신설)는 이 페이지에 아예 없었던
    # 사고를 계기로 스캔 대상에 추가. 이 스크립트는 .js/.html을 구분하지
    # 않고 텍스트 패턴만 본다.
    ROOT / 'pages' / 'professional-ai.html',
]

# jeju-router.js는 별도 저장소 — 공개 raw 엔드포인트에서 fetch해 함께 검사.
# 실패해도(네트워크 등) CI를 막지 않고 경고만 남긴다.
REMOTE_JS = [
    ('jeju-router.js (jeju 저장소)',
     'https://raw.githubusercontent.com/Openhash-Gopang/jeju/main/jeju-router.js'),
]

FILE_REF_RE = re.compile(
    r"""['"]                                # 여는 따옴표
    (?:/prompts/|prompts/|gov-tree/)          # 상대경로 또는 raw URL의 prompts/ 이하
    ([\w./-]+\.(?:md|txt|json))             # 실제 파일 경로(하위 폴더 포함)
    ['"]""",
    re.VERBOSE,
)
# raw.githubusercontent.com 형태의 절대 URL도 함께 매칭
RAW_URL_RE = re.compile(
    r"https://raw\.githubusercontent\.com/Openhash-Gopang/gopang/main/prompts/([\w./-]+\.(?:md|txt|json))"
)
# 2026-07-06 추가 — github.com/.../blob/main/... 형태(웹 뷰어용 URL, raw가
# 아님)도 매칭. pages/professional-ai.html이 이 형식을 쓰는데, 기존
# RAW_URL_RE는 raw.githubusercontent.com만 잡아 26개 링크가 전부 감시
# 사각지대였다.
BLOB_URL_RE = re.compile(
    r"https://github\.com/Openhash-Gopang/gopang/blob/main/prompts/([\w./-]+\.(?:md|txt|json))"
)
# jeju-router.js 전용: _fetchText('00-common/JEJU-GOV-COMMON_v1_5.md')처럼
# 접두사 없는 상대경로(_RAW가 이미 prompts/gov-tree/를 포함하므로 문자열
# 자체엔 없다) — 매칭되면 'gov-tree/' 접두사를 붙여 로컬 인덱스 키와 맞춘다.
JEJU_RELATIVE_RE = re.compile(
    r"""_fetchText\(\s*['"]([\w./-]+\.(?:md|txt|json))['"]"""
)


def parse_version(fname: str) -> tuple:
    m = re.search(r'_v(\d+)[._](\d+)(?:[._](\d+))?', fname)
    if not m:
        return (0, 0, 0)
    return (int(m.group(1)), int(m.group(2)), int(m.group(3) or 0))


# ── 검사 2: (2026-07-17 제거) GWP_REGISTRY ↔ SP-00-ROUTER 동기화 ────────
# 2026-07-05 신설 당시엔 유의미했으나, 같은 날 나중에(6766c60) SP-00-ROUTER
# 자체가 "죽은 코드"로 완전히 삭제됐다 — 라우팅은 이제 AGENT-COMMON이
# GWP_REGISTRY를 직접 참조해 [GWP:]/[EXPERT:] 태그로 한 번에 판단하는
# 방식으로 바뀌었고(sp-tag-dispatch.test.mjs 참조), 별도의 "라우터 서비스
# 표"가 더 이상 존재하지 않는다. 그 결과 이 검사는 실행할 때마다
# "manifest에 SP-00-ROUTER 키 없음 — 검사 건너뜀" 경고만 찍고 항상
# no-op이었다(2026-07-17 마스터 테스트플랜 B2-6 조사에서 확인 — 스킵
# 자체는 안전했지만 죽은 코드였음). GWP_REGISTRY가 이제 그 자체로 유일한
# 진실 공급원(SSOT)이라 "두 표가 어긋난다"는 시나리오 자체가 성립하지
# 않으므로, 검사를 되살리는 게 아니라 완전히 제거하는 것이 맞다.


def base_key(path: str) -> str:
    """디렉터리 + 버전 제거한 파일명 기준 키. 'gov-tree/00-common/JEJU-GOV-COMMON_v1_5.md'
    -> 'gov-tree/00-common/JEJU-GOV-COMMON'
    2026-07-06: Path(path).parent를 쓰지 않는다 — Windows에서 str(Path(...))가
    입력 구분자와 무관하게 항상 백슬래시로 렌더링해서, index_prompts_dir()에서
    슬래시로 정규화해도 여기서 다시 깨진다(실사로 확인). 순수 문자열 split만
    쓰면 플랫폼과 무관하게 항상 슬래시를 유지한다."""
    path = path.replace('\\', '/')
    if '/' in path:
        d, name = path.rsplit('/', 1)
    else:
        d, name = '.', path
    name = re.sub(r'_v\d+[._]\d+(?:[._]\d+)?\.(md|txt|json)$', '', name)
    return f"{d}/{name}" if d != '.' else name


def index_prompts_dir() -> dict:
    """base_key -> 실제 최신 파일 상대경로(prompts/ 기준)"""
    idx: dict[str, list[str]] = {}
    for p in PROMPTS.rglob('*'):
        if not p.is_file():
            continue
        if 'archive' in p.parts:
            continue  # 아카이브는 의도적 구버전 — 검사 제외
        # 2026-07-06: Windows에서 str(Path.relative_to(...))가 백슬래시(\)를
        # 쓰는데, 소스 코드(worker.js, jeju-router.js 등)의 참조는 항상
        # URL 스타일 슬래시(/)다. 정규화 안 하면 Windows에서만 "같은 파일인데
        # 문자열이 달라서" 전부 STALE로 오탐된다(실사로 확인 — gov-tree 하위
        # 폴더 참조 18건 전부 이 버그였음, 실제 내용 문제는 0건).
        rel = str(p.relative_to(PROMPTS)).replace('\\', '/')
        idx.setdefault(base_key(rel), []).append(rel)
    latest = {k: max(v, key=lambda f: (parse_version(Path(f).name), len(f))) for k, v in idx.items()}
    return latest


def check_refs(label: str, text: str, latest_map: dict, results: list, jeju_relative: bool = False):
    refs = set(m.group(1) for m in FILE_REF_RE.finditer(text)) | \
           set(m.group(1) for m in RAW_URL_RE.finditer(text)) | \
           set(m.group(1) for m in BLOB_URL_RE.finditer(text))
    if jeju_relative:
        refs |= set(f"gov-tree/{m.group(1)}" for m in JEJU_RELATIVE_RE.finditer(text))
    for ref in refs:
        key = base_key(ref)
        if key not in latest_map:
            continue  # 이 스크립트가 다루는 SP류 파일이 아님(예: emd-master-data.json 등 데이터 파일) — 스킵
        latest_file = latest_map[key]
        if latest_file == ref:
            results.append(('OK', label, ref, latest_file))
        else:
            # ref 자체가 디스크에 있는지에 따라 MISSING/STALE 구분
            exists = (PROMPTS / ref).exists()
            status = 'STALE' if exists else 'MISSING'
            results.append((status, label, ref, latest_file))


# ── 검사 3(2026-07-17 신설, B4-2) — HONDI_FAQ_REGISTRY 참조 파일 존재 ────
# 배경: check_stale_refs.py는 지금까지 FILE_REF_RE/RAW_URL_RE/BLOB_URL_RE/
# JEJU_RELATIVE_RE 네 패턴 전부 문자열 안에 'prompts/' 또는 'gov-tree/'가
# 리터럴로 박혀있어야 매칭됐다. 그런데 src/gopang/ai/hondi-faq-router.js의
# HONDI_FAQ_REGISTRY는 `file: 'pdv.txt'`처럼 접두사 없는 파일명만 갖고
# 있고(접두사 `/prompts/HONDI-FAQ/`는 런타임에 별도 상수와 문자열
# 결합으로 붙는다), JS_FILES_TO_SCAN에도 이 파일이 애초에 없었다 —
# 즉 이 레지스트리 19개 항목은 지금까지 이 스크립트의 완전한 사각지대였다
# (2026-07-17 마스터 테스트플랜 B4-2 조사에서 발견 — 지금 당장 깨진 참조는
# 없었지만, 향후 오타/삭제가 나도 이 스크립트가 못 잡는 상태였음).
FAQ_FILE_RE = re.compile(r"""file:\s*'([\w.-]+\.txt)'""")


def check_hondi_faq_registry(results: list):
    router_path = ROOT / 'src' / 'gopang' / 'ai' / 'hondi-faq-router.js'
    if not router_path.exists():
        return
    text = router_path.read_text(encoding='utf-8')
    faq_dir = PROMPTS / 'HONDI-FAQ'
    for fname in FAQ_FILE_RE.findall(text):
        target = faq_dir / fname
        if target.exists():
            results.append(('OK', 'hondi-faq-router.js → HONDI-FAQ', fname, str(target.relative_to(ROOT))))
        else:
            results.append((
                'MISSING', 'hondi-faq-router.js → HONDI-FAQ', fname,
                f'prompts/HONDI-FAQ/{fname} 없음',
            ))


def main():
    latest_map = index_prompts_dir()
    results = []

    for path in JS_FILES_TO_SCAN:
        if not path.exists():
            continue
        check_refs(str(path.relative_to(ROOT)), path.read_text(encoding='utf-8', errors='ignore'), latest_map, results)

    for label, url in REMOTE_JS:
        try:
            with urllib.request.urlopen(url, timeout=10) as r:
                text = r.read().decode('utf-8', errors='ignore')
            check_refs(label, text, latest_map, results, jeju_relative=True)
        except Exception as e:
            print(f"[경고] {label} 원격 fetch 실패, 건너뜀: {e}", file=sys.stderr)

    # (2026-07-17) check_router_registry_sync() 호출 제거 — 위 주석 참조
    check_hondi_faq_registry(results)

    problems = [r for r in results if r[0] != 'OK']
    ok_count = len(results) - len(problems)

    print(f"검사한 참조: {len(results)}건 (정상 {ok_count}건, 문제 {len(problems)}건)\n")
    for status, label, ref, latest_file in problems:
        icon = {'MISSING': '🔴', 'STALE': '🟡', 'UNROUTABLE': '🟠'}.get(status, '⚠️')
        print(f"{icon} [{status}] {label}")
        print(f"    참조: {ref}")
        print(f"    실제 최신: {latest_file}\n")

    if problems:
        print(f"실패 — {len(problems)}건의 참조 불일치 발견.", file=sys.stderr)
        sys.exit(1)

    print("모든 참조가 최신 파일과 일치합니다.")
    sys.exit(0)


if __name__ == '__main__':
    main()
