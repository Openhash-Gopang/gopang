#!/usr/bin/env python3
"""
tools/build_ksic_parent_map.py
--------------------------------
data/classification/ksic-flat.csv(code,name,level,parent_code)를 유일한
소스로 삼아 data/classification/ksic-parent-map.json({code: parent_code})을
생성한다. worker.js가 §TEMPLATE-REFERENCE 계층 조회(세분류→소분류→중분류
→대분류)에서 이 JSON을 그대로 임베드해 쓴다.

새 계층 정의 파일을 손으로 만들지 않는 이유: ksic-flat.csv가 이미
parent_code를 갖고 있는데 별도 파일을 또 만들면, HONDI-CAPABILITIES-COMMON
신설 전 겪었던 "사본 두 개가 따로 갱신되며 갈라지는" 문제를 그대로
반복하게 된다. build_manifest.py(sp-catalog.json 생성)와 동일한 자리·
관례(빌드 시점 1회 컴파일, git commit 대상, 사람이 diff로 리뷰)를 따른다.

실행: python3 tools/build_ksic_parent_map.py
검증: tools/check_ksic_parent_map_freshness.py가 CI에서 매 배포·매일
      이 출력물이 ksic-flat.csv와 어긋나지 않았는지 대조한다(자기보고
      불신, 실측 — check_wallet_sync.py와 동일 철학).
"""
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
SRC = ROOT / 'data' / 'classification' / 'ksic-flat.csv'
OUT = ROOT / 'data' / 'classification' / 'ksic-parent-map.json'


def build():
    if not SRC.exists():
        print(f'[오류] 소스 파일 없음: {SRC}', file=sys.stderr)
        sys.exit(1)

    parent_map = {}
    level_map = {}
    with open(SRC, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            code = row['code'].strip()
            parent = row['parent_code'].strip()
            level = row['level'].strip()
            if not code:
                continue
            parent_map[code] = parent if parent else None
            level_map[code] = int(level) if level else None

    # 대분류(level=1)는 parent_code가 원래 비어 있다 — None으로 정확히 남긴다.
    # (worker.js 쪽 순회 루프가 code=None을 만나면 계층을 더 안 올라가고 멈춘다.)

    out = {
        'generated_from': 'data/classification/ksic-flat.csv',
        'code_count': len(parent_map),
        'parent': parent_map,   # {code: parent_code | null}
        'level': level_map,     # {code: 1~5}
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'[완료] {OUT} 생성 — 코드 {len(parent_map)}개 (source: {SRC.name})')

    # 최상위 무결성 자체 점검 — 순환 참조나 끊긴 체인이 있으면 즉시 실패시킨다.
    for code, parent in parent_map.items():
        seen = {code}
        cur = parent
        depth = 0
        while cur is not None:
            if cur in seen:
                print(f'[오류] 순환 참조 발견: {code} 체인에 {cur} 중복', file=sys.stderr)
                sys.exit(1)
            seen.add(cur)
            cur = parent_map.get(cur)
            depth += 1
            if depth > 10:
                print(f'[오류] {code} 부모 체인이 비정상적으로 깊음(>10)', file=sys.stderr)
                sys.exit(1)


if __name__ == '__main__':
    build()
