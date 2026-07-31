#!/usr/bin/env python3
"""
Hondi profile-assistant LIVE smoketest against DeepSeek API — 두 개의
DeepSeek 에이전트(PA 역할 / 가상 가입자 역할)가 서로 멀티턴으로 대화하며
실제 profile-assistant SP(+UNIVERSAL-INTEGRITY+TASK-DELEGATION-GUIDE+
HONDI-CAPABILITIES-COMMON 합성, manifest-loader.js의 _loadSpByKey와 동일
순서)를 라이브로 실행한다. tests/live_smoketest/live_smoketest.py(AC-PRO-CORE
단일턴 라우팅 테스트)와 같은 계열이지만, profile-assistant는 멀티턴
STEP1~STEP-FINAL 흐름이라 별도 하네스로 분리했다.

[TEMPLATE_LOOKUP] 태그는 실제 L1 PocketBase를 호출하지 않고(운영 DB에
스모크테스트가 쓰기/읽기 부하를 주지 않기 위함, 그리고 DB seed 상태에
의존하지 않는 재현 가능한 테스트를 위함) 하네스가 클라이언트를 흉내 내
"(참조 사례 없음 — 최초 사례)"로 즉시 응답한다 — §TEMPLATE-REFERENCE의
계층 조회 자체는 이미 별도로 단위 테스트됐으므로(worker.js), 여기서는
PA의 대화 흐름 자체(STEP 진행·태그 출력 규칙 준수)만 검증한다.

Usage:
  DEEPSEEK_API_KEY=... python3 profile_assistant_smoketest.py \
      --scenarios profile_assistant_scenarios.json \
      --out ../../results/profile-assistant \
      --resume

Resumable: writes results incrementally to <out>/live_results.jsonl.
"""
import argparse
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions"
MODEL = "deepseek-chat"
MAX_TURNS = 14  # STEP1~STEP-FINAL이 정상이면 이 안에 끝나야 함(무한루프 방지)
MAX_WORKERS = 4  # 시나리오당 최대 2*MAX_TURNS 호출이 걸릴 수 있어 AC-PRO-CORE보다 낮춤
MAX_RETRIES = 4
RETRY_BASE_SLEEP = 3

PARTIAL_SAVE_RE = re.compile(r"\[PARTIAL_SAVE\]\s*(\{.*?\})(?=\n|\[|$)", re.DOTALL)
TEMPLATE_LOOKUP_RE = re.compile(r"\[TEMPLATE_LOOKUP:\s*([^\]]*)\]")
PROFILE_SUBMIT_RE = re.compile(r"\[?PROFILE_SUBMIT\]?\s*(\{.*)", re.DOTALL)
# (2026-0X-XX 3차 수정) 확인요청 "문장"을 쫓는 접근 자체가 한계였다 —
# "맞으면"→"맞으시면"(존댓말), "눌러주세요"→"말씀해 주세요"(동사 변형)
# 등 자연어 패러프레이즈가 끝없이 이어졌다(10건 파일럿 3회 반복 실측).
# 대신 §PROFILE_CARD가 리터럴로 못박은 선행 이모지(모델이 잘 안 바꾸는
# 부분 — 10건 전부 카드 자체는 정확했음)를 신호로 쓴다. 같은 대화에서
# 이 카드 패턴이 2번째로 나오면(1번째=STEP-FINAL 확인요청, 2번째=완료
# 메시지) 완료 턴으로 간주한다.
CARD_LINE_RE = re.compile(r"^[ \t]*(🏪|👤|🏛|🤝|💻|🚗|🤖)\s", re.MULTILINE)
TERMINAL_TAGS = ["PROFILE_SUBMIT", "[PROFILE_SKIP]", "[PROFILE_INTERRUPT_HANDOFF]"]
FIELD_ADD_RE = re.compile(r"\[FIELD_ADD:")
FIELD_REMOVE_RE = re.compile(r"\[FIELD_REMOVE:")


def _load_composited_sp(repo_root):
    """manifest-loader.js의 _loadSpByKey('profile-assistant', ...)와 동일한
    합성 순서를 로컬 파일에서 재현한다: UNIVERSAL-INTEGRITY + TASK-DELEGATION-
    GUIDE + HONDI-CAPABILITIES-COMMON + profile-assistant SP.
    (2026-0X-XX 수정 배선 반영 — fix_manifest_loader_capabilities_common.py
    적용 이후 상태를 전제로 한다. 아직 적용 전이면 마지막 파츠를 빼고 3파츠만
    합성하도록 --no-capabilities-common 플래그로 이전 동작 재현 가능.)"""
    catalog = json.load(open(os.path.join(repo_root, 'prompts', 'sp-catalog.json'), encoding='utf-8'))
    parts = []
    for key in ('UNIVERSAL-INTEGRITY', 'TASK-DELEGATION-GUIDE', 'HONDI-CAPABILITIES-COMMON'):
        fname = catalog.get(key)
        if fname:
            parts.append(open(os.path.join(repo_root, 'prompts', fname), encoding='utf-8').read())
    pa_fname = catalog['profile-assistant']
    parts.append(open(os.path.join(repo_root, 'prompts', 'profile-assistant', os.path.basename(pa_fname)), encoding='utf-8').read())
    return '\n\n---\n\n'.join(parts)


def _persona_system_prompt(scenario):
    facts = scenario['persona_facts']
    directives = '\n'.join(f'- {d}' for d in scenario['persona_directives'])
    return f"""당신은 혼디(Hondi)라는 앱에서 프로필을 등록하려는 가상의 사용자입니다.
AI 비서(상대방)가 프로필 작성을 도와주는 대화 상대이고, 당신은 실제 사람처럼 자연스럽게 답합니다.

당신의 배경 사실(대화 중 자연스럽게, AI가 물어볼 때만 답하세요 — 먼저 전부 나열하지 마세요):
- entity_type: {scenario['entity_type_expected']}
- 관련 코드/라벨: {facts.get('code_label') or '(해당 없음)'}
- 나이/성별: {facts.get('age_gender') or '(해당 없음)'}

이번 대화에서 반드시 지켜야 할 행동:
{directives}

규칙: 한국어로, 실제 사람처럼 짧고 자연스럽게 답하세요. AI 비서 역할을 절대 하지 말고, 오직 사용자 역할만 하세요.
AI가 프로필 작성을 마쳤다고 확인을 요청하면 "네, 맞아요" 등으로 승인하세요.
AI가 "🎉 프로필 완성됐어요"처럼 완료를 알리면, "네, 감사합니다!" 한 마디로만 짧게 답하고
더 이상 새로운 화제나 인사를 만들지 마세요 — 대화를 길게 끌지 않습니다.
"""


def _call_deepseek(api_key, messages, max_tokens=1600):
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {"model": MODEL, "temperature": 0.3, "max_tokens": max_tokens, "messages": messages}
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = requests.post(DEEPSEEK_URL, headers=headers, json=payload, timeout=60)
            if resp.status_code == 200:
                data = resp.json()
                return data["choices"][0]["message"]["content"], data.get("usage", {}), None
            elif resp.status_code == 429:
                time.sleep(RETRY_BASE_SLEEP * attempt); last_err = f"429 (attempt {attempt})"; continue
            else:
                last_err = f"HTTP {resp.status_code}: {resp.text[:300]}"; time.sleep(RETRY_BASE_SLEEP); continue
        except requests.RequestException as e:
            last_err = f"request_exception: {e}"; time.sleep(RETRY_BASE_SLEEP * attempt); continue
    return None, {}, last_err


def _mock_template_lookup_context(pa_reply):
    """실제 /template-lookup 서버 호출 대신, 클라이언트가 하던 일을 하네스가
    대신한다 — 최초 사례로 통일 응답(재현성 우선, DB seed 불필요)."""
    m = TEMPLATE_LOOKUP_RE.search(pa_reply)
    if not m:
        return None
    params = {}
    for part in m.group(1).split(','):
        if '=' in part:
            k, v = part.split('=', 1)
            params[k.strip()] = v.strip()
    blocks = []
    if 'schema_id' in params:
        blocks.append('[CONTEXT: INDUSTRY_TEMPLATE]\n(참조 사례 없음 — 최초 사례)\n[/CONTEXT]')
    if 'job_ksco_code' in params or 'work_domain' in params:
        blocks.append('[CONTEXT: PERSON_TEMPLATE]\n(참조 사례 없음 — 최초 사례)\n[/CONTEXT]')
    return '\n'.join(blocks) if blocks else None


def run_scenario(api_key, pa_system, scenario):
    pa_messages = [{"role": "system", "content": pa_system}]
    persona_messages = [{"role": "system", "content": _persona_system_prompt(scenario)}]

    transcript = []
    partial_saves = {}
    terminal = None
    submit_json = None
    field_add_seen = False
    field_remove_seen = False
    card_seen_count = 0  # §PROFILE_CARD 선행 이모지가 몇 번째 응답에 나왔는지
    total_usage = {"prompt_tokens": 0, "completion_tokens": 0}

    user_turn_text = scenario['opening_line']

    for turn in range(MAX_TURNS):
        pa_messages.append({"role": "user", "content": user_turn_text})
        pa_reply, usage, err = _call_deepseek(api_key, pa_messages, max_tokens=1600)
        if err:
            return _error_result(scenario, transcript, f"PA 호출 실패(turn {turn}): {err}")
        for k in total_usage:
            total_usage[k] += usage.get(k, 0)
        pa_messages.append({"role": "assistant", "content": pa_reply})
        # (2026-0X-XX 수정) user_turn_text는 오프닝 또는 이전 루프 끝에서 이미
        # "user(persona-next)"로 기록됐으므로 여기서 다시 안 찍는다 — 최초
        # 진입(turn==0)일 때만 오프닝 발화를 여기서 기록한다(그 전엔 기록된 적
        # 없으므로).
        if turn == 0:
            transcript.append({"role": "user(persona)", "content": user_turn_text})
        transcript.append({"role": "assistant(PA)", "content": pa_reply})

        if FIELD_ADD_RE.search(pa_reply):
            field_add_seen = True
        if FIELD_REMOVE_RE.search(pa_reply):
            field_remove_seen = True
        for m in PARTIAL_SAVE_RE.finditer(pa_reply):
            try:
                partial_saves.update(json.loads(m.group(1)))
            except (json.JSONDecodeError, ValueError):
                pass

        # 종료 태그 판정
        # (2026-0X-XX 3차 수정) §PROFILE_CARD 선행 이모지가 2번째로 등장한
        # 응답인데 PROFILE_SUBMIT이 없으면 완료 턴으로 간주한다(1번째=
        # STEP-FINAL 확인요청 카드, 2번째=완료 메시지 카드 — SP §4
        # STEP-FINAL 스펙 순서 그대로). 확인요청 "문장"이 아니라 카드
        # "구조"를 세므로 존댓말·동사 변형 등 자연어 패러프레이즈에
        # 영향받지 않는다.
        if 'PROFILE_SUBMIT' not in pa_reply.upper() and len(CARD_LINE_RE.findall(pa_reply)) >= 1:
            card_seen_count += 1
            if card_seen_count >= 2:
                terminal = 'SOFT_COMPLETION_NO_TAG'
                break
        if 'PROFILE_SUBMIT' in pa_reply:
            terminal = 'PROFILE_SUBMIT'
            sm = PROFILE_SUBMIT_RE.search(pa_reply)
            if sm:
                raw = sm.group(1)
                depth, end = 0, None
                for i, ch in enumerate(raw):
                    if ch == '{': depth += 1
                    elif ch == '}':
                        depth -= 1
                        if depth == 0:
                            end = i + 1; break
                if end:
                    try:
                        submit_json = json.loads(raw[:end])
                    except (json.JSONDecodeError, ValueError):
                        submit_json = None
            break
        if '[PROFILE_SKIP]' in pa_reply:
            terminal = 'PROFILE_SKIP'; break
        if '[PROFILE_INTERRUPT_HANDOFF]' in pa_reply:
            terminal = 'PROFILE_INTERRUPT_HANDOFF'; break

        # TEMPLATE_LOOKUP이면 페르소나 턴을 쓰지 않고 하네스가 CONTEXT를 대신 주입
        mocked_ctx = _mock_template_lookup_context(pa_reply)
        if mocked_ctx:
            user_turn_text = mocked_ctx
            transcript.append({"role": "user(mocked-template-context)", "content": user_turn_text})
            continue

        # 페르소나 다음 응답 생성
        persona_messages.append({"role": "user", "content": pa_reply})
        persona_reply, usage2, err2 = _call_deepseek(api_key, persona_messages, max_tokens=300)
        if err2:
            return _error_result(scenario, transcript, f"페르소나 호출 실패(turn {turn}): {err2}")
        for k in total_usage:
            total_usage[k] += usage2.get(k, 0)
        persona_messages.append({"role": "assistant", "content": persona_reply})
        transcript.append({"role": "user(persona-next)", "content": persona_reply})
        user_turn_text = persona_reply

    verdict, notes = _grade(scenario, terminal, submit_json, partial_saves, field_add_seen, field_remove_seen, transcript)

    pa_turn_count = sum(1 for t in transcript if t["role"] == "assistant(PA)")
    return {
        "no": scenario["no"], "entity_type_expected": scenario["entity_type_expected"],
        "edge_case_tags": scenario["edge_case_tags"], "terminal": terminal,
        "turns_used": pa_turn_count, "submit_entity_type": (submit_json or {}).get('entity_type'),
        "verdict": verdict, "notes": notes, "usage": total_usage,
        "transcript": transcript, "submit_json": submit_json,
    }


def _error_result(scenario, transcript, err):
    return {
        "no": scenario["no"], "entity_type_expected": scenario["entity_type_expected"],
        "edge_case_tags": scenario["edge_case_tags"], "terminal": None, "turns_used": len(transcript) // 2,
        "submit_entity_type": None, "verdict": "LIVE-ERROR", "notes": err, "usage": {},
        "transcript": transcript, "submit_json": None,
    }


def _grade(scenario, terminal, submit_json, partial_saves, field_add_seen, field_remove_seen, transcript):
    notes = []
    if terminal is None:
        return "LIVE-FAIL", [f"MAX_TURNS({MAX_TURNS}) 안에 종료 태그 없음 — 무한 루프 또는 STEP 정체 의심"]

    if terminal == 'SOFT_COMPLETION_NO_TAG':
        return "LIVE-NEEDS-REVIEW", [
            "완료 메시지(①)는 나왔으나 PROFILE_SUBMIT 머신 태그(②)가 응답에 없음 — "
            "SP는 두 개를 같은 응답에 함께 내라고 명시하는데 모델이 ②를 누락했을 가능성. "
            "여러 건 반복되면 모델별 SP 준수도 문제로 보고 필요."
        ]

    if terminal == 'PROFILE_INTERRUPT_HANDOFF':
        if any(t in scenario['edge_case_tags'] for t in ('SAFETY_GATE', 'INTERRUPT_A')):
            return "LIVE-PASS", ["의도된 핸드오프 태그(SAFETY_GATE/INTERRUPT_A) 발생 확인"]
        return "LIVE-NEEDS-REVIEW", ["의도치 않은 시점에 PROFILE_INTERRUPT_HANDOFF 발생 — 대화록 확인 필요"]

    if terminal == 'PROFILE_SKIP':
        if 'SKIP_RESUME' in scenario['edge_case_tags']:
            return "LIVE-PASS", ["의도된 SKIP_RESUME 태그 발생 확인"]
        return "LIVE-NEEDS-REVIEW", ["의도치 않은 시점에 PROFILE_SKIP 발생 — 대화록 확인 필요"]

    if terminal == 'PROFILE_SUBMIT':
        if submit_json is None:
            notes.append("PROFILE_SUBMIT 태그는 나왔으나 JSON 파싱 실패 — 형식 확인 필요")
            return "LIVE-NEEDS-REVIEW", notes
        actual_et = submit_json.get('entity_type')
        if actual_et != scenario['entity_type_expected']:
            notes.append(f"entity_type 불일치: 기대 {scenario['entity_type_expected']} vs 실제 {actual_et}")
        if scenario['skip_payment_steps_expected']:
            if submit_json.get('gdc_accepted') or submit_json.get('payout_account'):
                notes.append("person/thing/concept인데 GDC/계좌이체 필드가 채워짐 — STEP3~3A 스킵 원칙 위반 의심")
        if 'FIELD_ADD' in scenario['edge_case_tags'] and not field_add_seen:
            notes.append("FIELD_ADD 유도 지시가 있었는데 [FIELD_ADD:] 태그가 대화록에 없음")
        if 'FIELD_REMOVE' in scenario['edge_case_tags'] and not field_remove_seen:
            notes.append("FIELD_REMOVE 유도 지시가 있었는데 [FIELD_REMOVE:] 태그가 대화록에 없음")
        if notes:
            return "LIVE-FAIL", notes
        return "LIVE-PASS", ["entity_type 일치, 결제STEP 스킵 원칙 위반 없음, 유도된 필드 태그 확인됨(있는 경우)"]

    return "LIVE-NEEDS-REVIEW", ["알 수 없는 종료 상태"]


def load_done_numbers(jsonl_path):
    done = set()
    if os.path.exists(jsonl_path):
        with open(jsonl_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line: continue
                try: done.add(json.loads(line)["no"])
                except (json.JSONDecodeError, KeyError): pass
    return done


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenarios", default="profile_assistant_scenarios.json")
    ap.add_argument("--repo-root", default="../..")
    ap.add_argument("--out", default="../../results/profile-assistant")
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()

    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        print("ERROR: DEEPSEEK_API_KEY env var not set", file=sys.stderr); sys.exit(1)

    scenarios = json.load(open(args.scenarios, encoding="utf-8"))
    if args.limit:
        scenarios = scenarios[:args.limit]

    pa_system = _load_composited_sp(args.repo_root)
    print(f"PA 시스템 프롬프트 합성 완료: {len(pa_system)} chars")

    os.makedirs(args.out, exist_ok=True)
    jsonl_path = os.path.join(args.out, "live_results.jsonl")
    done = load_done_numbers(jsonl_path) if args.resume else set()
    todo = [s for s in scenarios if s["no"] not in done]
    print(f"{len(scenarios)} total, {len(done)} already done, {len(todo)} to run")

    start = time.time()
    with open(jsonl_path, "a", encoding="utf-8") as out_f:
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
            futures = {pool.submit(run_scenario, api_key, pa_system, s): s for s in todo}
            n = 0
            for fut in as_completed(futures):
                s = futures[fut]
                try:
                    result = fut.result()
                except Exception as e:
                    result = _error_result(s, [], f"unhandled_exception: {e}")
                out_f.write(json.dumps(result, ensure_ascii=False) + "\n")
                out_f.flush()
                n += 1
                if n % 10 == 0:
                    print(f"  ...{n}/{len(todo)} done ({time.time()-start:.0f}s)")

    print(f"Done. {n if todo else 0} results written in {time.time()-start:.0f}s")

    all_results = {}
    with open(jsonl_path, encoding="utf-8") as f:
        for line in f:
            r = json.loads(line); all_results[r["no"]] = r
    final = [all_results[k] for k in sorted(all_results)]
    json.dump(final, open(os.path.join(args.out, "live_results.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    from collections import Counter
    counts = Counter(r["verdict"] for r in final)
    summary = {"total": len(final), "counts": dict(counts), "runtime_seconds": round(time.time() - start)}
    json.dump(summary, open(os.path.join(args.out, "live_summary.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
