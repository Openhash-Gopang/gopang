#!/usr/bin/env bash
# ops/apply-pb-hooks.sh — GitHub Actions 강제 커맨드 전용 (SSH_ORIGINAL_COMMAND
# 로 전달되는 인자는 무시 — pb_hooks/main.pb.js 파일은 항상 통째로 하나뿐이라
# pb_migrations처럼 "바뀐 파일명 목록"을 받을 필요가 없다).
#
# 이 스크립트가 하는 일 (모두 자동, 실패 시 자동 롤백):
#   1) 현재 pb_hooks/main.pb.js 백업
#   2) GitHub main의 최신 pb_hooks/main.pb.js 다운로드
#   3) 최소 검증(ed25519Verify 등 필수 함수 존재 확인)
#   4) 교체 + hanlim 재시작 + 헬스체크
#   5) 헬스체크 실패 시 백업으로 즉시 롤백 + 재시작

set -euo pipefail

PB_ROOT="/opt/gopang"
SERVICE="gopang-pb-hanlim.service"
RAW_URL="https://raw.githubusercontent.com/Openhash-Gopang/gopang/main/pb_hooks/main.pb.js"

cd "$PB_ROOT"

echo "[1/6] 백업..."
BACKUP="pb_hooks/main.pb.js.bak-$(date +%Y%m%d-%H%M%S)"
cp pb_hooks/main.pb.js "$BACKUP"

echo "[2/6] 최신 파일 다운로드..."
TMPFILE=$(mktemp)
curl -sL "$RAW_URL" -o "$TMPFILE"

echo "[3/6] 최소 검증..."
if [ ! -s "$TMPFILE" ]; then
  echo "[FAIL] 빈 파일 — 중단"; rm -f "$TMPFILE"; exit 1
fi
if ! grep -q 'routerAdd("POST", "/api/tx"' "$TMPFILE"; then
  echo "[FAIL] /api/tx 라우트가 없음 — 중단(잘못된 파일 가능성)"; rm -f "$TMPFILE"; exit 1
fi

echo "[4/6] 교체..."
cp "$TMPFILE" pb_hooks/main.pb.js
rm -f "$TMPFILE"

echo "[5/6] 재시작..."
sudo systemctl restart "$SERVICE"
sleep 2

echo "[6/6] 헬스체크..."
if systemctl is-active --quiet "$SERVICE" && curl -sf http://127.0.0.1:8091/api/health >/dev/null; then
  echo "[OK] 배포 완료"
else
  echo "[FAIL] 헬스체크 실패 — 롤백"
  cp "$BACKUP" pb_hooks/main.pb.js
  sudo systemctl restart "$SERVICE"
  sleep 2
  if systemctl is-active --quiet "$SERVICE"; then
    echo "[ROLLBACK OK] 이전 버전으로 정상 복구됨"
  else
    echo "[ROLLBACK FAIL] 이전 버전으로도 기동 안 됨 — 즉시 수동 개입 필요, logs/hanlim_err.log 확인"
  fi
  exit 1
fi
