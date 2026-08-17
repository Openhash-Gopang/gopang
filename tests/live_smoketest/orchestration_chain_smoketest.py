#!/usr/bin/env python3
"""
orchestration_chain_smoketest.py

오케스트레이션 5단계(K-Intent → K-Compose → K-Execute → K-Deliver →
K-Report)를 실제로 처음부터 끝까지 라이브 실행해 검증한다.

── 왜 기존 하네스로는 안 되는가 ──
live_smoketest.py(scenarios.json)는 AC-PRO-CORE 단일턴 라우팅 태그
([GWP:]/[EXPERT:]/[CALL_KINTENT] 등 "무엇으로 넘기는가")만 확인하고,
그 뒤 K-Intent~K-Report 체인 내부가 실제로 끝까지 흘러가는지는
검증하지 않는다(HONDI_UTTERANCE_ROUTING_TABLE 부록 문서 §5 "정직하게
밝힘"에서 이미 스코프 밖으로 명시된 부분).

── 실제 동작 방식(call-ai.js 실사 확인, 2026-08-17) ──
각 HANDOFF는 대화 히스토리를 통째로 비우고(history.length = 0) 완전히
새 시스템 프롬프트로 전환한 뒤, 딱 한 개의 "[INTERNAL: ...]" 메시지로
이전 단계의 결과물만 넘긴다 — 즉 연속 대화가 아니라 "각 단계마다 새
세션 + 인수인계 메시지 1개"의 연쇄다. 이 harness는 그 방식을 그대로
재현한다: 단계마다 완전히 새로운 DeepSeek 호출을 만들고, 이전 단계
응답에서 뽑아낸 HANDOFF 태그 본문을 다음 단계의 유일한 사용자 메시지로
넣는다.

── 태그 정규식은 call-ai.js에서 그대로 가져왔다(2026-08-17 실사) ──
AC→K-Intent: [CALL_KINTENT: query=...] (또는 콜론/본문 없는 변형)
K-Intent→K-Compose: [HANDOFF_TO_KCOMPOSE: ...]
K-Compose→K-Execute: [HANDOFF_TO_KEXECUTE: ...]  (plan={steps:[...]} 중첩 배열 포함 가능 — 괄호 매칭 필요)
K-Execute/K-Compose→K-Deliver: [HANDOFF_TO_KDELIVER: ...]
K-Deliver→K-Report: [HANDOFF_TO_KREPORT: ...]
K-Report→AC: [ORCHESTRATION_COMPLETE: ...]
비상 복귀(모든 단계): [ORCHESTRATION_HANDOFF_BACK: reason=emergency]

실행 전 필요:
  export DEEPSEEK_API_KEY=sk-xxxx
  cd tests/live_smoketest
  python3 orchestration_chain_smoketest.py --scenarios scenarios_orchestration_chain.json --resume

★ 정직하게 밝힘 — 이 harness 자체는 이 대화 세션(샌드박스)에서 한
번도 실행되지 않았다. bash_tool의 네트워크 허용 도메인 목록에
api.deepseek.com이 없어(허용: api.anthropic.com, github 계열,
npm/pip 레지스트리 등) 직접 호출이 불가능했다 — gov-router.js 패치는
raw.githubusercontent.com fetch만 필요해 직접 검증할 수 있었지만,
이건 실제 LLM 호출이 필요해 사용자 환경에서 DEEPSEEK_API_KEY로
직접 돌려야 한다.
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

import requests

DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions"
MODEL = "deepseek-chat"

SP_PATHS = {
    "AC": "../../prompts/AC-PRO-CORE_v1_7.txt",
    "KINTENT": "../../prompts/SP-19_kintent_v1.6.txt",
    "KCOMPOSE": "../../prompts/SP-20_kcompose_v2.1.txt",
    "KEXECUTE": "../../prompts/SP-22_kexecute_v1.5.txt",
    "KDELIVER": "../../prompts/SP-21_kdeliver_v1.6.txt",
    "KREPORT": "../../prompts/SP-23_kreport_v1.2.txt",
}

# call-ai.js 실사(2026-08-17)에서 그대로 옮긴 태그 정규식.
# HANDOFF_TO_KEXECUTE는 plan={steps:[...]} 중첩 배열 때문에 단순
# [^\]]*로는 첫 안쪽 ]에서 잘린다(call-ai.js의 _extractBracketTag와
# 동일한 문제) — 괄호 깊이를 세는 간단한 스캐너로 대체한다.
RE_CALL_KINTENT = re.compile(r"\[CALL_K?INTENT\s*(?::\s*query=([^\]]+))?\]", re.I)
RE_HANDOFF_KCOMPOSE = re.compile(r"\[HANDOFF_TO_KCOMPOSE:([^\]]*)\]")
RE_HANDOFF_KREPORT = re.compile(r"\[HANDOFF_TO_KREPORT:([^\]]*)\]")
RE_ORCH_COMPLETE = re.compile(r"\[ORCHESTRATION_COMPLETE:([^\]]*)\]")
RE_ORCH_HANDBACK = re.compile(r"\[ORCHESTRATION_HANDOFF_BACK:([^\]]*)\]")


def extract_bracket_tag(text, tag_name):
    """[TAG: ... {nested [...] ok} ...] 를 대괄호 깊이를 세어 추출한다
    (call-ai.js의 _extractBracketTag 재현 — HANDOFF_TO_KEXECUTE/
    KDELIVER의 plan={steps:[...]} 중첩 배열 대응)."""
    marker = f"[{tag_name}:"
    start = text.find(marker)
    if start == -1:
        return None
    i = start + len(marker)
    depth = 1
    body_start = i
    while i < len(text) and depth > 0:
        if text[i] == "[":
            depth += 1
        elif text[i] == "]":
            depth -= 1
        i += 1
    if depth != 0:
        return None  # 안 닫힘 — 응답이 잘렸을 가능성
    return text[body_start:i - 1]


def call_deepseek(system_prompt, user_message, api_key, retries=3):
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        "max_tokens": 1200,
    }
    for attempt in range(retries):
        try:
            r = requests.post(DEEPSEEK_URL, headers=headers, json=payload, timeout=60)
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"]
        except Exception as e:
            if attempt == retries - 1:
                raise
            time.sleep(2 * (attempt + 1))


def run_scenario(scenario, sp_texts, api_key):
    """한 시나리오를 AC부터 K-Report(또는 조기 종료)까지 끝까지 태운다."""
    trace = []
    utterance = scenario["utterance"]

    # 1) AC
    ac_reply = call_deepseek(sp_texts["AC"], utterance, api_key)
    trace.append({"stage": "AC", "input": utterance, "reply_snippet": ac_reply[:300]})
    m = RE_CALL_KINTENT.search(ac_reply)
    if not m:
        trace.append({"stage": "STOP", "reason": "AC가 CALL_KINTENT를 내지 않음(오케스트레이션 미진입)"})
        return {"scenario": scenario, "trace": trace, "verdict": "NO_ENTRY"}
    forward_query = (m.group(1) or utterance).strip()

    # 2) K-Intent
    msg = f"[INTERNAL: AC→K-Intent 위임 — 사용자에게 보이지 않는 내부 신호입니다. 다음 발화를 목표로 구조화하세요: \"{forward_query}\"]"
    reply = call_deepseek(sp_texts["KINTENT"], msg, api_key)
    trace.append({"stage": "K-Intent", "input": msg, "reply_snippet": reply[:300]})
    if RE_ORCH_HANDBACK.search(reply):
        trace.append({"stage": "STOP", "reason": "K-Intent에서 R0(응급) 감지 — AC로 복귀"})
        return {"scenario": scenario, "trace": trace, "verdict": "EMERGENCY_HANDBACK"}
    m = RE_HANDOFF_KCOMPOSE.search(reply)
    if not m:
        trace.append({"stage": "STOP", "reason": "K-Intent가 HANDOFF_TO_KCOMPOSE를 내지 않음(되묻기 중이거나 이탈)"})
        return {"scenario": scenario, "trace": trace, "verdict": "STUCK_AT_KINTENT"}
    kcompose_goal = m.group(1).strip()

    # 3) K-Compose
    msg = f"[INTERNAL: K-Intent→K-Compose 위임 — 아래 목표를 이어받아 진행하세요: {kcompose_goal}]"
    reply = call_deepseek(sp_texts["KCOMPOSE"], msg, api_key)
    trace.append({"stage": "K-Compose", "input": msg, "reply_snippet": reply[:300]})
    if RE_ORCH_HANDBACK.search(reply):
        trace.append({"stage": "STOP", "reason": "K-Compose에서 R0(응급) 감지 — AC로 복귀"})
        return {"scenario": scenario, "trace": trace, "verdict": "EMERGENCY_HANDBACK"}
    kexecute_body = extract_bracket_tag(reply, "HANDOFF_TO_KEXECUTE")
    kdeliver_body_direct = extract_bracket_tag(reply, "HANDOFF_TO_KDELIVER")  # 무료 이관 직행 경로
    if kdeliver_body_direct is not None:
        # K-Compose가 K-Execute를 안 거치고 바로 K-Deliver로 이관(무료 경로)
        return _continue_from_kdeliver(scenario, trace, sp_texts, api_key, kdeliver_body_direct)
    if kexecute_body is None:
        trace.append({"stage": "STOP", "reason": "K-Compose가 HANDOFF_TO_KEXECUTE/KDELIVER 어느 쪽도 안 냄(되묻기 중이거나 이탈)"})
        return {"scenario": scenario, "trace": trace, "verdict": "STUCK_AT_KCOMPOSE"}

    # 4) K-Execute
    msg = f"[INTERNAL: K-Compose→K-Execute 위임 — 아래 계획을 이어받아 실행하세요: {kexecute_body}]"
    reply = call_deepseek(sp_texts["KEXECUTE"], msg, api_key)
    trace.append({"stage": "K-Execute", "input": msg, "reply_snippet": reply[:300]})
    if RE_ORCH_HANDBACK.search(reply):
        trace.append({"stage": "STOP", "reason": "K-Execute에서 R0(응급) 감지 — AC로 복귀"})
        return {"scenario": scenario, "trace": trace, "verdict": "EMERGENCY_HANDBACK"}
    kdeliver_body = extract_bracket_tag(reply, "HANDOFF_TO_KDELIVER")
    if kdeliver_body is None:
        trace.append({"stage": "STOP", "reason": "K-Execute가 HANDOFF_TO_KDELIVER를 안 냄(재계획/중단 등 이탈)"})
        return {"scenario": scenario, "trace": trace, "verdict": "STUCK_AT_KEXECUTE"}

    return _continue_from_kdeliver(scenario, trace, sp_texts, api_key, kdeliver_body)


def _continue_from_kdeliver(scenario, trace, sp_texts, api_key, kdeliver_body):
    # 5) K-Deliver
    msg = f"[INTERNAL: →K-Deliver 위임 — 아래 결과를 정리해 제출하세요: {kdeliver_body}]"
    reply = call_deepseek(sp_texts["KDELIVER"], msg, api_key)
    trace.append({"stage": "K-Deliver", "input": msg, "reply_snippet": reply[:300]})
    m = RE_HANDOFF_KREPORT.search(reply)
    if not m:
        trace.append({"stage": "STOP", "reason": "K-Deliver가 HANDOFF_TO_KREPORT를 안 냄(project_paused 등으로 AC 조기 반환했을 수 있음 — 정상일 수도 있으니 사람이 확인)"})
        return {"scenario": scenario, "trace": trace, "verdict": "STOPPED_AT_KDELIVER_NEEDS_REVIEW"}
    kreport_body = m.group(1).strip()

    # 6) K-Report
    msg = f"[INTERNAL: K-Deliver→K-Report 위임 — 아래 결과에 대한 이해당사자 통지/신고를 처리하세요: {kreport_body}]"
    reply = call_deepseek(sp_texts["KREPORT"], msg, api_key)
    trace.append({"stage": "K-Report", "input": msg, "reply_snippet": reply[:300]})
    if RE_ORCH_COMPLETE.search(reply):
        return {"scenario": scenario, "trace": trace, "verdict": "COMPLETE"}
    trace.append({"stage": "STOP", "reason": "K-Report가 ORCHESTRATION_COMPLETE를 안 냄"})
    return {"scenario": scenario, "trace": trace, "verdict": "STUCK_AT_KREPORT"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenarios", default="scenarios_orchestration_chain.json")
    ap.add_argument("--out", default="../../results/orchestration_chain")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--resume", action="store_true")
    args = ap.parse_args()

    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        print("DEEPSEEK_API_KEY가 설정되지 않았습니다.", file=sys.stderr)
        sys.exit(1)

    sp_texts = {k: Path(v).read_text(encoding="utf-8") for k, v in SP_PATHS.items()}
    scenarios = json.loads(Path(args.scenarios).read_text(encoding="utf-8"))
    if args.limit:
        scenarios = scenarios[: args.limit]

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    results_path = out_dir / "live_results.jsonl"

    done_nos = set()
    if args.resume and results_path.exists():
        for line in results_path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                done_nos.add(json.loads(line)["scenario"]["no"])

    verdict_counts = {}
    with open(results_path, "a", encoding="utf-8") as f:
        for sc in scenarios:
            if sc["no"] in done_nos:
                continue
            print(f"[{sc['no']}] {sc['utterance'][:40]}...")
            try:
                result = run_scenario(sc, sp_texts, api_key)
            except Exception as e:
                result = {"scenario": sc, "trace": [{"stage": "ERROR", "reason": str(e)}], "verdict": "ERROR"}
            verdict_counts[result["verdict"]] = verdict_counts.get(result["verdict"], 0) + 1
            print(f"  → {result['verdict']}")
            f.write(json.dumps(result, ensure_ascii=False) + "\n")
            f.flush()

    print("\n" + "=" * 50)
    print("결과 분포:", verdict_counts)
    print(f"(COMPLETE 외에는 전부 체인이 끊긴 지점 — 사람이 {results_path} 확인 필요)")


if __name__ == "__main__":
    main()
