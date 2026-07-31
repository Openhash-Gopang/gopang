#!/usr/bin/env python3
"""
tools/check_ksic_parent_map_freshness.py
------------------------------------------
CI 게이트 — data/classification/ksic-parent-map.json이
data/classification/ksic-flat.csv를 다시 컴파일한 결과와 완전히 같은지
대조한다. 다르면(즉 ksic-flat.csv만 고치고 parent-map.json 재생성을
깜빡했으면) 빌드를 실패시킨다.

check_capabilities_registry.py·check_wallet_sync.py와 동일한 철학 —
"코드가 스스로 보고한 최신 상태"를 믿지 않고, 소스에서 직접 재계산해
실측 대조한다.

실행: python3 tools/check_ksic_parent_map_freshness.py
종료 코드: 0=일치, 1=불일치(CI 실패)
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).parent.parent
COMMITTED = ROOT / 'data' / 'classification' / 'ksic-parent-map.json'
BUILD_SCRIPT = ROOT / 'tools' / 'build_ksic_parent_map.py'


def main():
    if not COMMITTED.exists():
        print(f'[실패] {COMMITTED} 없음 — python3 {BUILD_SCRIPT.name} 먼저 실행하세요', file=sys.stderr)
        sys.exit(1)

    committed = json.loads(COMMITTED.read_text(encoding='utf-8'))

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        (tmp_path / 'data' / 'classification').mkdir(parents=True)
        (tmp_path / 'tools').mkdir()
        # 소스 csv를 임시 디렉터리로 복사해 그 안에서 재빌드(원본 위치 오염 방지)
        src_csv = ROOT / 'data' / 'classification' / 'ksic-flat.csv'
        (tmp_path / 'data' / 'classification' / 'ksic-flat.csv').write_bytes(src_csv.read_bytes())
        (tmp_path / 'tools' / 'build_ksic_parent_map.py').write_bytes(BUILD_SCRIPT.read_bytes())

        result = subprocess.run(
            [sys.executable, 'tools/build_ksic_parent_map.py'],
            cwd=tmp_path, capture_output=True, text=True,
        )
        if result.returncode != 0:
            print('[실패] 재빌드 자체가 실패함:\n' + result.stdout + result.stderr, file=sys.stderr)
            sys.exit(1)

        rebuilt = json.loads((tmp_path / 'data' / 'classification' / 'ksic-parent-map.json').read_text(encoding='utf-8'))

    # generated_from은 메타 정보라 비교 대상에서 제외, parent/level만 실측 대조
    if committed.get('parent') != rebuilt.get('parent') or committed.get('level') != rebuilt.get('level'):
        print('[실패] ksic-parent-map.json이 ksic-flat.csv와 어긋납니다.', file=sys.stderr)
        print('       python3 tools/build_ksic_parent_map.py 를 다시 실행하고 커밋하세요.', file=sys.stderr)
        sys.exit(1)

    print(f'[통과] ksic-parent-map.json 최신 상태 확인 (코드 {committed.get("code_count")}개)')


if __name__ == '__main__':
    main()
