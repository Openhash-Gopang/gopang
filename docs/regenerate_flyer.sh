#!/usr/bin/env bash
# docs/regenerate_flyer.sh
# 2026-07-26 신설 — docs/hondi_flyer_A4_source.html을 수정한 뒤
# docs/hondi_flyer_A4_v1_0.pdf를 재생성하는 절차를 문서화한다.
#
# 배경: 이전까지는 PDF를 수정할 때마다 그때그때 임시로 처리해왔다
# (2026-07-26 세션에서 K-Law 정확도 문구, 교통·물류 커버리지 문구를 고칠
# 때 매번 새로 방법을 찾음). wkhtmltopdf로 렌더링한 결과가 원본 PDF와
# 레이아웃·색상·폰트가 동일함을 육안으로 확인했다 — 이 스크립트가 그
# 검증된 방법을 고정한다.
#
# 요구사항:
#   - wkhtmltopdf (https://wkhtmltopdf.org/downloads.html)
#     · Windows: 설치 파일 다운로드 후 PATH에 추가, Git Bash 또는 WSL에서
#       이 스크립트를 실행할 것(PowerShell 네이티브 .sh 실행 불가).
#     · Mac: brew install --cask wkhtmltopdf
#     · Linux: apt-get install wkhtmltopdf (또는 배포판 패키지 매니저)
#
# 사용법:
#   cd gopang  (저장소 루트)
#   bash docs/regenerate_flyer.sh
#
# 결과 검증(권장, 매번 스킵하지 말 것):
#   생성된 PDF를 열어 원본과 레이아웃이 같은지, 수정한 문구가 정확히
#   반영됐는지 육안으로 확인한다. wkhtmltopdf 버전이 바뀌면 렌더링
#   결과가 미묘하게 달라질 수 있다.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_HTML="$SCRIPT_DIR/hondi_flyer_A4_source.html"
OUT_PDF="$SCRIPT_DIR/hondi_flyer_A4_v1_0.pdf"

if [ ! -f "$SRC_HTML" ]; then
  echo "오류: $SRC_HTML 을 찾을 수 없습니다." >&2
  exit 1
fi

if ! command -v wkhtmltopdf >/dev/null 2>&1; then
  echo "오류: wkhtmltopdf가 설치되어 있지 않습니다. 위 요구사항을 참고하세요." >&2
  exit 1
fi

echo "[1/2] 백업: 기존 PDF를 ${OUT_PDF}.bak 로 보관"
if [ -f "$OUT_PDF" ]; then
  cp "$OUT_PDF" "${OUT_PDF}.bak"
fi

echo "[2/2] 렌더링: $SRC_HTML → $OUT_PDF"
wkhtmltopdf --page-size A4 --enable-local-file-access "$SRC_HTML" "$OUT_PDF"

echo "완료. 반드시 PDF를 직접 열어 레이아웃·문구를 육안으로 확인한 뒤 커밋하세요."
echo "  (문제가 있으면 ${OUT_PDF}.bak 으로 되돌릴 수 있습니다 — 커밋 전에만 유효)"
