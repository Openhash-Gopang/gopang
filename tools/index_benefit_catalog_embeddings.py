#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
procedure_maps(10,310건)를 worker.js의 /orchestration/benefit-embed-index
로 배치 전송해 Vectorize에 인덱싱한다.

★ 사전 준비 (실제 배포 권한이 있는 쪽에서 1회 실행 — 이 스크립트를
돌리기 전에 반드시 먼저):
    wrangler vectorize create hondi-benefit-catalog --dimensions=1024 --metric=cosine
    (bge-m3 차원이 실제로 1024가 아니면 이 값을 맞춰 재생성 필요 —
    아래 스크립트가 첫 배치 결과로 실제 차원을 알려준다)

★ wrangler.toml에 [ai]·[[vectorize]] 바인딩을 추가하고 배포까지
마친 뒤 이 스크립트를 실행한다(로컬에서 Workers AI/Vectorize를
직접 호출할 방법이 없어 반드시 배포된 worker 엔드포인트를 거쳐야
한다).

사용법:
    python3 index_benefit_catalog_embeddings.py --base-url https://hondi.net
    (또는 실제 배포 도메인)
"""
import json
import time
import argparse
import urllib.request
import urllib.error

ELIGIBILITY_PATH = "tools/batch_output/eligibility_gates_final.json"  # merge 완료본
FALLBACK_PATH = "/mnt/user-data/uploads/eligibility_gates.json"  # merge 전 10,310건
RAW_PATH = "tools/civil-petitions-raw.json"
BATCH_SIZE = 100  # worker.js handleBenefitEmbedIndex의 1회 상한과 일치


def build_embed_text(petition_name, gate):
    """임베딩할 원문 — goal + eligibility_gate 핵심 조건 요약.
    조건 설명을 전부 이어붙이되 너무 길면(8192 토큰 bge-m3 상한) 앞부분
    위주로 자른다 — 대부분의 레코드는 이 정도로 충분히 짧다."""
    parts = [petition_name]
    for c in (gate.get("conditions") or [])[:8]:  # 조건 8개까지만(상한 보호)
        desc = c.get("description", "")
        if desc:
            parts.append(desc)
    text = " ".join(parts)
    return text[:2000]  # 문자 기준 대략적 안전 상한(토큰 아님, 보수적으로)


def load_records():
    try:
        gates = json.load(open(ELIGIBILITY_PATH, encoding="utf-8"))
        print(f"병합 완료본 사용: {ELIGIBILITY_PATH} ({len(gates)}건)")
    except FileNotFoundError:
        gates = json.load(open(FALLBACK_PATH, encoding="utf-8"))
        print(f"병합 전 원본 사용(656건 재시도분 미포함): {FALLBACK_PATH} ({len(gates)}건)")

    raw = json.load(open(RAW_PATH, encoding="utf-8"))
    raw_by_id = {r["petition_id"]: r for r in raw}

    records = []
    skipped = 0
    for pid, gate in gates.items():
        r = raw_by_id.get(pid)
        if not r:
            skipped += 1
            continue
        goal = f"{r['petition_name']} ({pid})"
        records.append({
            "petition_id": pid,
            "goal": goal,
            "domain": r["service_category"],
            "text": build_embed_text(r["petition_name"], gate),
        })
    if skipped:
        print(f"원본에서 못 찾아 건너뜀: {skipped}건")
    return records


def post_json(url, payload, timeout=60):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", required=True, help="배포된 worker 도메인, 예: https://hondi.net")
    ap.add_argument("--start", type=int, default=0, help="중단 후 재개할 시작 인덱스")
    args = ap.parse_args()

    records = load_records()
    total = len(records)
    print(f"총 {total}건 인덱싱 예정, 배치 크기 {BATCH_SIZE}")

    endpoint = f"{args.base_url.rstrip('/')}/orchestration/benefit-embed-index"

    n_ok = 0
    n_err = 0
    errors = []
    for i in range(args.start, total, BATCH_SIZE):
        batch = records[i:i + BATCH_SIZE]
        try:
            result = post_json(endpoint, {"records": batch})
            if result.get("status") == "indexed":
                n_ok += result.get("count", len(batch))
                print(f"[{i}~{i+len(batch)}/{total}] 성공 ({result.get('count')}건)")
            else:
                n_err += len(batch)
                errors.append((i, result))
                print(f"[{i}~{i+len(batch)}/{total}] 실패: {result}")
        except urllib.error.HTTPError as e:
            n_err += len(batch)
            body = e.read().decode("utf-8", errors="ignore")
            errors.append((i, body))
            print(f"[{i}~{i+len(batch)}/{total}] HTTP 에러 {e.code}: {body[:200]}")
            print(f"  -> 재개하려면: python3 {__file__} --base-url {args.base_url} --start {i}")
        except Exception as e:
            n_err += len(batch)
            errors.append((i, str(e)))
            print(f"[{i}~{i+len(batch)}/{total}] 예외: {e}")
            print(f"  -> 재개하려면: python3 {__file__} --base-url {args.base_url} --start {i}")
        time.sleep(0.3)  # Workers AI 배치 한도 보호(정확한 rate limit은 실제 배포 시 재확인 필요)

    print(f"\n완료 — 성공 {n_ok}건, 실패 {n_err}건")
    if errors:
        json.dump(errors, open("index_errors.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print("실패 내역: index_errors.json 저장")


if __name__ == "__main__":
    main()
