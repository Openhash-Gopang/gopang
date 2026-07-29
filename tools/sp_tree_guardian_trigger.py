#!/usr/bin/env python3
"""
sp_tree_guardian_trigger.py — SP-TREE-GUARDIAN 주간 감사 트리거

역할: 저장소 안에는 크론이 없다는 원칙(sp_refresh_scheduler.py와 동일) —
.github/workflows/sp-tree-guardian.yml이 매주 1회 이 스크립트를 실행해
"저장소 밖 스케줄러" 역할을 대신한다.

이 스크립트 자체는 아무 판단도 하지 않는다 — POST /sp-tree-guardian/audit를
호출할 뿐이고, 실제 diff 수집·LLM 감사·findings 저장은 worker.js
(_runSpTreeGuardianAudit)가 수행한다. findings는 사람이 검토하는 큐에만
쌓이며, 이 스크립트도 worker.js도 SP-TREE-REGISTRY나 SP 파일을 직접
수정하지 않는다.

사용법:
  python3 tools/sp_tree_guardian_trigger.py [--base-url URL]

환경변수:
  HONDI_PROXY_URL — 기본값 https://hondi-proxy.tensor-city.workers.dev
"""
import argparse
import json
import os
import sys
import urllib.request
import urllib.error

DEFAULT_BASE_URL = "https://hondi-proxy.tensor-city.workers.dev"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default=os.environ.get("HONDI_PROXY_URL", DEFAULT_BASE_URL))
    args = ap.parse_args()

    url = f"{args.base_url.rstrip('/')}/sp-tree-guardian/audit"
    req = urllib.request.Request(url, data=b"{}", method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            body = json.loads(res.read().decode("utf-8"))
            status = res.status
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode("utf-8"))
        except Exception:
            body = {"error": str(e)}
        status = e.code
    except urllib.error.URLError as e:
        print(f"FAIL: {url} 연결 실패: {e}")
        return 1

    print(f"HTTP {status}: {json.dumps(body, ensure_ascii=False)}")
    if status >= 400:
        return 1
    if body.get("status") == "ok":
        print(f"감사 완료 — findings {body.get('findings_count', 0)}건")
    else:
        print(f"감사 스킵 — {body.get('note', body.get('status'))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
