#!/usr/bin/env bash
# ops/apply-pb-hooks.sh — GitHub Actions 강제 커맨드 전용 (SSH_ORIGINAL_COMMAND
# 로 전달되는 인자는 무시 — pb_hooks/main.pb.js 파일은 항상 통째로 하나뿐이라
# pb_migrations처럼 "바뀐 파일명 목록"을 받을 필요가 없다).
#
# 2026-07-18 실전 배포 경험으로 v2 수정:
#   - 백업을 pb_hooks/ 밖(pb_hooks_backups/)에 만든다. --hooksWatch=true
#     (PocketBase 기본값)가 pb_hooks/ 디렉터리 전체를 감시하기 때문에,
#     백업 파일을 그 안에 만들면 그 생성 자체가 재시작을 또 유발해서
#     부팅 도중에 재시작이 겹치는 사고가 실제로 났었다(50분 장애).
#   - 명시적 systemctl restart를 안 쓴다. hooksWatch가 파일 변경을 감지해
#     자동으로 재시작하므로, cp 이후 systemctl restart를 추가로 부르면
#     오히려 재시작이 중복 트리거될 수 있다(의심되나 완전히 확증은 못함
#     — docs/pb_hooks_deployment_plan_v0_1.md §6 참고). 파일 교체 후에는
#     헬스체크로 자연스러운 기동만 기다린다.
#   - 헬스체크 대기를 2초→최대 120초로 늘렸다. 이 서버는 메모리 956MB에
#     PocketBase 49개가 떠 있어(도입 초기 스펙, 출시 시 업그레이드 예정)
#     정상 배포도 60~90초씩 걸릴 수 있다.
#   - 배포 직후 첫 요청들은 hooksPool(기본 25개 Goja 런타임) 각각이
#     이 파일을 최초 파싱하며 콜드스타트가 발생해 70~80초까지 걸릴 수
#     있음을 확인했다(3~5회 정도 후 1초 미만으로 안정화). 이건 정상
#     현상이며 헬스체크 자체와는 무관하다 — 배포 직후 바로 실거래가
#     몰리는 시점이라면 이 지연을 감안할 것.
#
# 이 스크립트가 하는 일 (모두 자동, 실패 시 자동 롤백):
#   1) 현재 pb_hooks/main.pb.js를 pb_hooks_backups/ 에 백업(감시 밖)
#   2) GitHub main의 최신 pb_hooks/main.pb.js 다운로드(/tmp, 감시 밖)
#   3) 최소 검증(필수 라우트/함수 존재 확인)
#   4) 교체(단 1회 cp) — 이후 hooksWatch가 자동 재시작
#   5) 최대 120초 헬스체크 대기
#   6) 실패 시 백업으로 즉시 롤백(교체만, 재시작은 자동 감지에 맡김)

set -euo pipefail

PB_ROOT="/opt/gopang"
SERVICE="gopang-pb-hanlim.service"
RAW_URL="https://raw.githubusercontent.com/Openhash-Gopang/gopang/main/pb_hooks/main.pb.js"
BACKUP_DIR="$PB_ROOT/pb_hooks_backups"

cd "$PB_ROOT"
mkdir -p "$BACKUP_DIR"

echo "[0/6] 배포 전 여유 메모리 확인..."
AVAIL_MB=$(free -m | awk '/^Mem:/{print $7}')
echo "     available: ${AVAIL_MB}Mi"
if [ "$AVAIL_MB" -lt 100 ]; then
  echo "     [WARN] 여유 메모리가 100Mi 미만입니다. 배포가 느리거나"
  echo "     실패할 위험이 있습니다. 그래도 강행합니다(자동화 컨텍스트라"
  echo "     사람 확인을 기다릴 수 없음 — 실패 시 자동 롤백에 의존)."
fi

echo "[1/6] 백업 (pb_hooks 밖 — 불필요한 재시작 트리거 방지)..."
BACKUP="$BACKUP_DIR/main.pb.js.bak-$(date +%Y%m%d-%H%M%S)"
cp pb_hooks/main.pb.js "$BACKUP"

echo "[2/6] 최신 파일 다운로드 (/tmp — 역시 감시 밖)..."
TMPFILE=$(mktemp)
curl -sL "$RAW_URL" -o "$TMPFILE"

echo "[3/6] 최소 검증..."
if [ ! -s "$TMPFILE" ]; then
  echo "[FAIL] 빈 파일 — 중단"; rm -f "$TMPFILE"; exit 1
fi
if ! grep -q 'routerAdd("POST", "/api/tx"' "$TMPFILE"; then
  echo "[FAIL] /api/tx 라우트가 없음 — 중단(잘못된 파일 가능성)"; rm -f "$TMPFILE"; exit 1
fi

echo "[4/6] 교체 (단 1회 cp — 이후 아무것도 이 디렉터리를 건드리지 않음."
echo "      hooksWatch가 자동으로 재시작을 트리거한다)..."
cp "$TMPFILE" pb_hooks/main.pb.js
rm -f "$TMPFILE"

echo "[5/6] 자동 재시작 대기 (최대 120초)..."
OK=0
for i in $(seq 1 120); do
  sleep 1
  if curl -sf http://127.0.0.1:8091/api/health >/dev/null 2>&1; then
    OK=1
    echo "     ${i}초 후 정상 기동 확인"
    break
  fi
  if [ $((i % 30)) -eq 0 ]; then
    echo "     ...${i}초 경과 ($(free -m | awk '/^Mem:/{print $7"Mi avail"}'))"
  fi
done

echo "[6/6] 최종 확인..."
if [ "$OK" = "1" ]; then
  echo "[OK] 배포 완료"
  sha256sum pb_hooks/main.pb.js
else
  echo "[FAIL] 120초 내 헬스체크 실패 — 롤백"
  cp "$BACKUP" pb_hooks/main.pb.js
  echo "     롤백 파일 교체 완료 — 자동 재시작 대기(최대 60초)..."
  for i in $(seq 1 60); do
    sleep 1
    if curl -sf http://127.0.0.1:8091/api/health >/dev/null 2>&1; then
      echo "     [ROLLBACK OK] ${i}초 후 정상 복구됨"
      exit 1
    fi
  done
  echo "     [ROLLBACK FAIL] 롤백 후에도 비정상 — 즉시 수동 개입 필요:"
  echo "       tail -30 /opt/gopang/logs/hanlim_err.log"
  echo "       ps aux | grep [p]ocketbase | grep 8091"
  exit 1
fi
