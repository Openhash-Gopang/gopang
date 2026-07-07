#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
provision-l1-nodes.py
제주도 OpenHash L1~L3 필드 테스트 — 42개 신규 L1(읍면동) PocketBase 프로비저닝

jeju-l1-l3-field-test-plan-2026-07-07.md §2.3 참고.

전제:
  - hanlim(8091)은 이미 떠 있고 정상 동작 중(blocks/gdc_keys/l1_ledger/
    node_ledger 컬렉션 보유).
  - 서버(168.110.123.175, l1-hanlim)에서 root 또는 sudo 권한으로 실행.
  - PocketBase 바이너리 경로/pb_data 상위 경로는 --pb-bin/--base-dir로
    지정(기본값은 기존 hanlim과 동일한 관례를 따름 — 실제 경로 확인 후 조정).
  - main.pb.js(패치된 버전)를 모든 인스턴스가 --hooksDir로 공유한다
    (§2.3 "훅 하나 고치면 전체가 재시작된다" 유의사항 그대로 적용됨).

이 스크립트가 하는 일 (신규 L1 42개 + L3의 guid_home_l1 1개):
  1. pb_data 디렉터리 생성
  2. systemd 유닛 파일 생성·기동 (openhash-l1-{folder}.service)
  3. hanlim의 admin 계정과 동일한 이메일/비밀번호로 각 신규 인스턴스에
     superuser 생성 (L1_ADMIN_EMAIL/L1_ADMIN_PASSWORD 환경변수 — worker.js가
     노드별로 별도 토큰을 발급받으므로, 자격증명 자체는 동일해도 무방)
  4. hanlim에서 blocks/gdc_keys/l1_ledger/node_ledger 컬렉션 스키마를
     export → 각 신규 인스턴스에 import, + bridge_out/bridge_in 신설
  5. l3-jejudo에 guid_home_l1 컬렉션 신설(이미 있으면 건너뜀)

실행 전 반드시 §2.2(free -h / df -h)로 리소스 여유를 확인할 것 — 이
스크립트는 리소스 검증을 자동으로 하지 않는다(사람이 판단할 문제).
"""
import argparse
import json
import subprocess
import sys
import time
import urllib.request
import urllib.error

TOPOLOGY_FILE = "topology.json"

SOURCE_COLLECTIONS = ["blocks", "gdc_keys", "l1_ledger", "node_ledger"]
NEW_L1_COLLECTIONS = ["bridge_out", "bridge_in"]  # 신규 L1 전용, hanlim에도 이번에 추가해야 함

BRIDGE_OUT_SCHEMA = {
    "name": "bridge_out",
    "type": "base",
    "schema": [
        {"name": "tx_hash",     "type": "text",   "required": True},
        {"name": "target_node", "type": "text",   "required": True},
        {"name": "guid",        "type": "text",   "required": True},
        {"name": "amount",      "type": "number", "required": True},
        {"name": "status",      "type": "text",   "required": True},  # pending|completed|refunded
        {"name": "created_at",  "type": "text",   "required": False},
        {"name": "completed_at","type": "text",   "required": False},
        {"name": "refunded_at", "type": "text",   "required": False},
    ],
}
BRIDGE_IN_SCHEMA = {
    "name": "bridge_in",
    "type": "base",
    "schema": [
        {"name": "tx_hash",     "type": "text",   "required": True},
        {"name": "source_node", "type": "text",   "required": True},
        {"name": "guid",        "type": "text",   "required": True},
        {"name": "amount",      "type": "number", "required": True},
        {"name": "status",      "type": "text",   "required": True},
        {"name": "applied_at",  "type": "text",   "required": False},
    ],
}
GUID_HOME_L1_SCHEMA = {
    "name": "guid_home_l1",
    "type": "base",
    "schema": [
        {"name": "guid",          "type": "text", "required": True},
        {"name": "node_id",       "type": "text", "required": True},
        {"name": "registered_at", "type": "text", "required": False},
    ],
}

SYSTEMD_TEMPLATE = """[Unit]
Description=Gopang PocketBase - {folder}
After=network.target

[Service]
Type=simple
User={run_user}
WorkingDirectory=/opt/gopang
ExecStart={pb_bin} serve --http=127.0.0.1:{port} --dir={base_dir}/{folder} --hooksDir={hooks_dir}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
"""


def http_json(method, url, token=None, body=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def admin_token(base_url, email, password):
    status, data = http_json("POST", f"{base_url}/api/admins/auth-with-password",
                              body={"identity": email, "password": password})
    if status != 200:
        raise RuntimeError(f"admin auth 실패({base_url}): {status} {data}")
    return data["token"]


def ensure_superuser(base_url, email, password):
    # 최초 부팅 직후엔 superuser가 없으므로 /api/admins 로 직접 생성 시도.
    # 이미 있으면(초기 setup을 이미 했으면) 그냥 auth만 확인.
    status, data = http_json("POST", f"{base_url}/api/admins",
                              body={"email": email, "password": password, "passwordConfirm": password})
    if status in (200, 201):
        print(f"  [+] superuser 생성: {base_url}")
    else:
        print(f"  [.] superuser 이미 존재하거나 스킵({status}): {base_url}")


def clone_collection_schema(source_base, target_base, token_src, token_dst, name):
    status, data = http_json("GET", f"{source_base}/api/collections/{name}", token=token_src)
    if status != 200:
        print(f"  [!] {name} 스키마 조회 실패({source_base}): {status}")
        return
    payload = {"name": data["name"], "type": data.get("type", "base"), "schema": data.get("schema", [])}
    status2, data2 = http_json("POST", f"{target_base}/api/collections", token=token_dst, body=payload)
    if status2 in (200, 201):
        print(f"  [+] {name} 컬렉션 생성 완료 @ {target_base}")
    else:
        print(f"  [.] {name} 생성 스킵/실패({status2}) @ {target_base}: {data2.get('message','')}")


def create_collection(base_url, token, schema_def):
    status, data = http_json("POST", f"{base_url}/api/collections", token=token, body=schema_def)
    if status in (200, 201):
        print(f"  [+] {schema_def['name']} 신설 완료 @ {base_url}")
    else:
        print(f"  [.] {schema_def['name']} 신설 스킵/실패({status}) @ {base_url}: {data.get('message','')}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-dir", default="/opt/gopang/pb")
    ap.add_argument("--pb-bin", default="/opt/gopang/pocketbase")
    ap.add_argument("--hooks-dir", default="/opt/gopang/pb_hooks")
    ap.add_argument("--run-user", default="ubuntu")
    ap.add_argument("--source-base", default="http://127.0.0.1:8091", help="스키마 원본(hanlim)")
    ap.add_argument("--l3-base", default="http://127.0.0.1:8094")
    ap.add_argument("--admin-email", required=True)
    ap.add_argument("--admin-password", required=True)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only", help="쉼표구분 폴더명만 처리(테스트용, 예: l1-aewol)")
    args = ap.parse_args()

    topo = json.load(open(TOPOLOGY_FILE, encoding="utf-8"))
    new_l1 = {f: c for f, c in topo.items()
              if c["layer"] == 1 and f != "hanlim"}
    if args.only:
        wanted = set(args.only.split(","))
        new_l1 = {f: c for f, c in new_l1.items() if f in wanted}

    print(f"대상 신규 L1: {len(new_l1)}개")

    src_token = admin_token(args.source_base, args.admin_email, args.admin_password)

    for folder, cfg in sorted(new_l1.items(), key=lambda kv: kv[1]["port"]):
        port = cfg["port"]
        base_url = f"http://127.0.0.1:{port}"
        print(f"\n=== {folder} (port {port}, {cfg['id']}) ===")

        unit = SYSTEMD_TEMPLATE.format(
            folder=folder, port=port, run_user=args.run_user,
            base_dir=args.base_dir, pb_bin=args.pb_bin, hooks_dir=args.hooks_dir,
        )
        unit_path = f"/etc/systemd/system/gopang-pb-{folder}.service"

        if args.dry_run:
            print(f"  [dry-run] mkdir -p {args.base_dir}/{folder}")
            print(f"  [dry-run] chown -R {args.run_user}:{args.run_user} {args.base_dir}/{folder}")
            print(f"  [dry-run] write {unit_path}")
            print(f"  [dry-run] systemctl enable --now gopang-pb-{folder}")
            continue

        subprocess.run(["mkdir", "-p", f"{args.base_dir}/{folder}"], check=True)
        # 2026-07-08 수정: 이 스크립트는 systemd unit 파일 쓰기(/etc/systemd/system/)
        # 때문에 sudo(root)로 실행된다. mkdir도 root 권한으로 실행되므로 방금 만든
        # 디렉토리가 root:root 소유가 되는데, systemd 유닛은 run_user(기본 ubuntu)로
        # PocketBase를 돌리기 때문에 "unable to open database file: out of memory (14)"
        # + "types.d.ts: permission denied"로 크래시 루프에 빠진다(실제로는 메모리가
        # 아니라 권한 문제 — SQLite의 오해 소지 있는 에러 메시지).
        # jocheon/gujwa/hangyeong/chuja/udo 5개 노드 배포 중 매번 반복 발생해 확인됨.
        subprocess.run(["chown", "-R", f"{args.run_user}:{args.run_user}", f"{args.base_dir}/{folder}"], check=True)
        with open(unit_path, "w") as f:
            f.write(unit)
        subprocess.run(["systemctl", "daemon-reload"], check=True)
        subprocess.run(["systemctl", "enable", "--now", f"gopang-pb-{folder}"], check=True)

        # 기동 대기
        for _ in range(20):
            try:
                urllib.request.urlopen(f"{base_url}/health", timeout=2)
                break
            except Exception:
                time.sleep(1)

        ensure_superuser(base_url, args.admin_email, args.admin_password)
        dst_token = admin_token(base_url, args.admin_email, args.admin_password)

        for name in SOURCE_COLLECTIONS:
            clone_collection_schema(args.source_base, base_url, src_token, dst_token, name)
        create_collection(base_url, dst_token, BRIDGE_OUT_SCHEMA)
        create_collection(base_url, dst_token, BRIDGE_IN_SCHEMA)

    # ── hanlim 자신에도 bridge_out/bridge_in이 없으면 추가 ──────────────
    print("\n=== hanlim(기존)에 bridge_out/bridge_in 추가 확인 ===")
    if not args.dry_run:
        create_collection(args.source_base, src_token, BRIDGE_OUT_SCHEMA)
        create_collection(args.source_base, src_token, BRIDGE_IN_SCHEMA)

    # ── L3에 guid_home_l1 추가 ───────────────────────────────────────
    print("\n=== l3-jejudo에 guid_home_l1 레지스트리 컬렉션 추가 ===")
    if not args.dry_run:
        l3_token = admin_token(args.l3_base, args.admin_email, args.admin_password)
        create_collection(args.l3_base, l3_token, GUID_HOME_L1_SCHEMA)

    print("\n완료. 각 인스턴스 상태는 systemctl status 'gopang-pb-l1-*' 로 확인하고,"
          "\nnginx-l1-routes.conf(별도 생성분)를 nginx에 include한 뒤 reload할 것.")


if __name__ == "__main__":
    main()
