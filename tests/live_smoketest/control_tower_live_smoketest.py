#!/usr/bin/env python3
"""
tests/live_smoketest/control_tower_live_smoketest.py
------------------------------------------------------
CONTROL-TOWER-PRINCIPLE("관제탑 원칙")이 실제 다운스트림 SP 응답에서
지켜지는지 검증한다.

## 기존 하네스와의 차이
live_smoketest.py는 AC-PRO-CORE의 "1단계 라우팅 결정"([GWP:]/[EXPERT:]
태그)만 채점한다 — 그 태그를 받은 뒤 실제 서비스(klaw/kedu/ktelecom/
AGENT-SUPPLIER 등)가 사용자에게 실제로 어떻게 응답하는지는 검증하지
않는다. 이 하네스는 그 다음 단계 — 실제 서비스 SP(UNIVERSAL-INTEGRITY+
UNIVERSAL-common+CONTROL-TOWER-PRINCIPLE+서비스별 SP를 합성한 진짜
system prompt)로 직접 호출해서, 그 응답이 "한 번에 하나씩 지시"
원칙을 지키는지 본다.

## 채점 기준(구조적 신호 — 완벽한 의미 판별이 아니라 명확한 위반
신호에 집중한다)
  - 마크다운 헤더(#, ##, ###) 존재 → 위반(원칙이 명시적으로 금지)
  - 번호 매김 목록(1. 2. 3. 같은 패턴 3개 이상 연속) → 위반
  - 불릿 목록(-, * 같은 패턴 3개 이상 연속) → 위반
  - 위 신호가 없지만 응답이 유독 길면(400자 초과) → NEEDS-REVIEW
    (목록 형태는 아니지만 여러 정보를 산문으로 욱여넣었을 수 있음 —
    사람이 최종 판단)
  - 위 신호가 전혀 없고 적당히 짧으면 → PASS

## 한계(정직하게 기록)
- 목록·헤더가 없어도 "설명"(사용자 입력을 지워도 성립하는 백과사전식
  서술)일 수 있다 — 이건 구조적 신호로 못 잡는다. 이 하네스는 최소
  위반(명백한 나열 형태)만 걸러내고, "진짜 다음 한 걸음을 지시했는가"
  같은 의미론적 판단은 여전히 사람이 raw_response를 읽고 확인해야 한다.
- AGENT-SUPPLIER-COMMON처럼 업종 SP가 그 자체로 특정 정보 나열이
  본질적으로 필요한 경우(예: 메뉴판 안내)는 이 원칙의 "예외" 대상일
  수 있다 — 그런 시나리오는 category에 "예외후보"로 표시했으니 FAIL이
  나와도 바로 결함으로 단정하지 말 것.

Usage:
  DEEPSEEK_API_KEY=... python3 control_tower_live_smoketest.py \\
      --scenarios scenarios_control_tower_20260808.json \\
      --out ../../results/control-tower
"""
import argparse
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions"
MODEL = "deepseek-v4-flash"
PROMPTS_DIR = "../../prompts"
MAX_WORKERS = 5
MAX_RETRIES = 4
RETRY_BASE_SLEEP = 3

LONG_RESPONSE_THRESHOLD = 400  # 자(char) 기준

HEADER_RE = re.compile(r"^#{1,3}\s+\S", re.M)
NUMBERED_LIST_RE = re.compile(r"^\s*\d+[.)]\s+\S.*(?:\n\s*\d+[.)]\s+\S.*){2,}", re.M)
BULLET_LIST_RE = re.compile(r"^\s*[-*•]\s+\S.*(?:\n\s*[-*•]\s+\S.*){2,}", re.M)


def load_sp_file(manifest, key):
    fname = manifest.get(key)
    if not fname:
        raise FileNotFoundError(f"manifest에 키 없음: {key}")
    path = os.path.join(PROMPTS_DIR, fname)
    with open(path, encoding="utf-8") as f:
        return f.read()


def build_system_prompt(manifest, sp_keys):
    parts = []
    for key in sp_keys:
        try:
            parts.append(load_sp_file(manifest, key))
        except FileNotFoundError as e:
            print(f"  경고: {e}", file=sys.stderr)
    return "\n\n---\n\n".join(parts)


def call_deepseek(api_key, system_prompt, user_utterance):
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": MODEL,
        "temperature": 0,
        # 2026-08-08 신설(디버그) — 8/8 라이브 실행 결과 7건이 완전히 빈
        # content로 돌아와, 정규식 채점기가 "위반 없음"으로 트리비얼하게
        # 오탐 PASS를 낸 게 실사로 확인됐다(빈 문자열은 헤더도 목록도
        # 없으니까). 유력 원인: deepseek-v4-flash가 추론형 모델이라면
        # max_tokens=800이 추론(reasoning) 토큰에 다 소진되고 최종 답변
        # (content)이 비었을 가능성 — 다른 하네스들(subject-gate 등)은
        # max_tokens=60이라 이 문제가 안 드러났을 수 있다. 원인을 확정
        # 하기 위해 finish_reason·usage·raw json 전체를 결과에 같이
        # 남긴다.
        "max_tokens": 2000,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_utterance},
        ],
    }
    import time
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = requests.post(DEEPSEEK_URL, headers=headers, json=payload, timeout=60)
            if resp.status_code == 200:
                data = resp.json()
                choice = data.get("choices", [{}])[0]
                content = choice.get("message", {}).get("content", "")
                debug = {
                    "finish_reason": choice.get("finish_reason"),
                    "usage": data.get("usage"),
                    "has_reasoning_content": bool(choice.get("message", {}).get("reasoning_content")),
                    "reasoning_content_len": len(choice.get("message", {}).get("reasoning_content") or ""),
                    "message_keys": list(choice.get("message", {}).keys()),
                }
                return content, None, debug
            last_err = f"HTTP {resp.status_code}: {resp.text[:300]}"
        except requests.RequestException as e:
            last_err = f"request_exception: {e}"
        if attempt < MAX_RETRIES:
            time.sleep(RETRY_BASE_SLEEP * attempt)
    return None, last_err, None


def grade(raw_text):
    # 2026-08-08 신설 — 빈 응답은 "위반 없음"이 아니라 별도 실패다.
    # 이전 버전은 이 체크가 없어서 빈 문자열이 헤더/목록 정규식에
    # 전부 안 걸린다는 이유만으로 트리비얼하게 LIVE-PASS를 냈다(라이브
    # 실행 8건 중 7건이 이 상태였음에도 8/8 PASS로 나온 원인).
    if not raw_text or not raw_text.strip():
        return "LIVE-FAIL", "응답이 비어 있음 — 관제탑 원칙 준수 여부를 검증하지 못했다(트리비얼 PASS 방지)"
    if HEADER_RE.search(raw_text):
        return "LIVE-FAIL", "마크다운 헤더(#/##/###) 사용 — 원칙이 명시적으로 금지"
    if NUMBERED_LIST_RE.search(raw_text):
        return "LIVE-FAIL", "번호 매김 목록(3개+ 연속) — 백과사전식 나열 의심"
    if BULLET_LIST_RE.search(raw_text):
        return "LIVE-FAIL", "불릿 목록(3개+ 연속) — 백과사전식 나열 의심"
    if re.search(r"<<<STATE>>>.*?<<<END>>>", raw_text, re.S):
        return "LIVE-NEEDS-REVIEW", "내부 상태 태그(<<<STATE>>>...)가 응답에 그대로 노출됨 — 실제 앱은 클라이언트가 이 블록을 제거하는지 별도 확인 필요, 원칙 위반과는 무관"
    if len(raw_text) > LONG_RESPONSE_THRESHOLD:
        return "LIVE-NEEDS-REVIEW", f"목록 형태는 아니지만 응답이 김({len(raw_text)}자) — 산문형 설명일 가능성, 사람 확인 필요"
    return "LIVE-PASS", "목록·헤더 없음, 길이 적정"


def process_one(api_key, manifest, scenario):
    system_prompt = build_system_prompt(manifest, scenario["sp_keys"])
    raw_text, err, debug = call_deepseek(api_key, system_prompt, scenario["utterance"])
    if err:
        return {**scenario, "raw_response": None, "live_verdict": "LIVE-ERROR", "live_note": err, "debug": None}
    verdict, note = grade(raw_text)
    return {**scenario, "raw_response": raw_text, "live_verdict": verdict, "live_note": note, "debug": debug}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenarios", default="scenarios_control_tower_20260808.json")
    ap.add_argument("--out", default="../../results/control-tower")
    args = ap.parse_args()

    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        print("ERROR: DEEPSEEK_API_KEY 환경변수가 없습니다.", file=sys.stderr)
        sys.exit(1)

    with open("../../prompts/sp-catalog.json", encoding="utf-8") as f:
        manifest = json.load(f)

    with open(args.scenarios, encoding="utf-8") as f:
        scenarios = json.load(f)

    print(f"{len(scenarios)}개 시나리오 실행 중...")
    os.makedirs(args.out, exist_ok=True)
    out_path = os.path.join(args.out, "live_results.jsonl")

    results = []
    with open(out_path, "w", encoding="utf-8") as out_f:
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
            futures = {pool.submit(process_one, api_key, manifest, s): s for s in scenarios}
            for i, fut in enumerate(as_completed(futures), 1):
                r = fut.result()
                results.append(r)
                out_f.write(json.dumps(r, ensure_ascii=False) + "\n")
                out_f.flush()
                dbg = r.get("debug") or {}
                dbg_str = f" [finish={dbg.get('finish_reason')}, reasoning_len={dbg.get('reasoning_content_len', '-')}]" if dbg else ""
                print(f"[{i}/{len(scenarios)}] {r['id']:20s} {r['live_verdict']:16s} {r['live_note']}{dbg_str}")

    counts = {}
    for r in results:
        counts[r["live_verdict"]] = counts.get(r["live_verdict"], 0) + 1

    print("\n=== 요약 ===")
    for status in ("LIVE-PASS", "LIVE-NEEDS-REVIEW", "LIVE-FAIL", "LIVE-ERROR"):
        if status in counts:
            print(f"  {status:16s} {counts[status]}")

    fails = [r for r in results if r["live_verdict"] == "LIVE-FAIL"]
    if fails:
        print("\n=== FAIL 목록 ===")
        for r in fails:
            print(f"  - {r['id']} ({r['category']}): {r['live_note']}")

    if counts.get("LIVE-FAIL", 0) > 0 or counts.get("LIVE-ERROR", 0) > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
