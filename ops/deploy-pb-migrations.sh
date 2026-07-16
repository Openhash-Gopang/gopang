#!/usr/bin/env bash
# ops/deploy-pb-migrations.sh
#
# L1(hanlim) PocketBase에 pb_migrations/*.js 를 반영하는 표준 절차.
#
# ★ 2026-07-16 확인된 실제 인프라 사실 (추측 아님, SSH로 직접 확인):
#   - /opt/gopang/pb 는 git 저장소가 아니다 — GitHub main에 마이그레이션
#     파일을 push해도 이 서버에는 자동으로 오지 않는다. fix.py 표준
#     워크플로우(로컬 실행 -> git push)는 여기서 끝나지 않는다.
#   - PocketBase 인스턴스는 이 서버 하나에만 43개 L1 + L2/L3/L4/L5 +
#     hanlim, 총 40개 이상이 개별 systemd 서비스로 떠 있다
#     (gopang-pb-{node}.service, --dir=pb/{node} 각각 별도).
#   - worker.js의 L1_DEFAULT = 'https://l1-hanlim.hondi.net' 이므로
#     Cloudflare Worker가 실제로 쓰는 PocketBase는 hanlim 인스턴스 하나뿐.
#     따라서 공용 카운터/설정류 컬렉션(예: public_data_usage)은 hanlim
#     한 곳에만 적용하면 된다 — 43개 L1 노드 전부에 적용할 필요 없음.
#   - hanlim의 systemd 유닛(WorkingDirectory=/opt/gopang, --dir=pb/hanlim)엔
#     --migrationsDir이 지정돼 있지 않다. 기본값에 의존해 추측하지 않고,
#     이 스크립트는 항상 --migrationsDir=pb/pb_migrations 를 명시한다.
#
# 사용법 (L1 서버 SSH 접속 상태에서):
#   sudo bash ops/deploy-pb-migrations.sh
#
# 이 스크립트가 하는 일:
#   1) GitHub main의 pb_migrations/ 폴더 전체를 codeload tarball로 받아
#      /opt/gopang/pb/pb_migrations/ 를 최신 상태로 덮어쓴다
#      (git clone 불필요 — 현재 서버 구조를 그대로 존중)
#   2) hanlim 서비스를 잠깐 멈추고 migrate up 실행
#   3) 서비스 재기동 + 상태 확인

set -euo pipefail

PB_ROOT="/opt/gopang"
PB_DATA_DIR="pb/hanlim"
PB_MIGRATIONS_DIR="pb/pb_migrations"
SERVICE="gopang-pb-hanlim.service"
REPO_TARBALL="https://codeload.github.com/Openhash-Gopang/gopang/tar.gz/refs/heads/main"

cd "$PB_ROOT"

echo "[1/5] GitHub main의 pb_migrations/ 최신 상태 내려받는 중..."
TMPDIR=$(mktemp -d)
curl -sL "$REPO_TARBALL" -o "$TMPDIR/repo.tar.gz"
tar -xzf "$TMPDIR/repo.tar.gz" -C "$TMPDIR" --wildcards "*/pb_migrations/*"
SRC_DIR=$(find "$TMPDIR" -maxdepth 2 -type d -name "pb_migrations")

if [ -z "$SRC_DIR" ]; then
  echo "[FAIL] tarball에서 pb_migrations 폴더를 못 찾았습니다."
  rm -rf "$TMPDIR"
  exit 1
fi

NEW_COUNT=$(comm -13 \
  <(ls "$PB_MIGRATIONS_DIR" | sort) \
  <(ls "$SRC_DIR" | sort) | wc -l)
echo "     신규 마이그레이션 파일 ${NEW_COUNT}개 발견"

cp -n "$SRC_DIR"/*.js "$PB_MIGRATIONS_DIR"/ 2>/dev/null || true
rm -rf "$TMPDIR"

echo "[2/5] hanlim 서비스 정지..."
sudo systemctl stop "$SERVICE"

echo "[3/5] migrate up 실행 (dir=$PB_DATA_DIR, migrationsDir=$PB_MIGRATIONS_DIR)..."
./pocketbase migrate up --dir="$PB_DATA_DIR" --migrationsDir="$PB_MIGRATIONS_DIR"

echo "[4/5] hanlim 서비스 재기동..."
sudo systemctl start "$SERVICE"
sleep 2

echo "[5/5] 상태 확인..."
systemctl is-active "$SERVICE"
curl -sf "http://127.0.0.1:8091/api/health" || echo "[WARN] health check 실패 — 로그 확인 필요: /opt/gopang/logs/hanlim_err.log"

echo "완료."
