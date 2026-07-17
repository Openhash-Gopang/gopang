#!/usr/bin/env python3
"""
tools/triage_feedback.py
-------------------------
사용자 개선 제안 주기적 취합 (docs/user_feedback_mechanism_proposal_v1.md §4)

user_feedback 컬렉션에 쌓인 status=new 항목을 훑어서:
  1. 이미 만든 bge-m3 임베딩 인프라(benefit-semantic-search용, worker.js
     /embed-text 통로로 재사용 — 새 NLP 파이프라인을 또 만들지 않는다)로
     전부 임베딩
  2. 코사인 유사도로 단순 클러스터링(같은 요청을 한 사람이 여럿인지 파악)
  3. 사람이 읽을 요약 리포트 생성(클러스터별 대표 인용 + 빈도)
  4. 클러스터가 명확히 특정 SP 하나로 귀결되면 sp_update_proposals에
     source=user_feedback로 "초안"만 올린다 — RULE-03과 동일하게
     ★ 자동 승인 없음 ★. 애매하면 올리지 않고 리포트에만 남긴다.

이 스크립트는 절대 SP 파일을 직접 수정하지 않는다. 절대 sp_update_
proposals의 상태를 approved로 바꾸지 않는다 — 사람(주피터님)만 한다.

■ 실행 방식
  tools/renew_identity_templates.py와 동일 관례. 필요한 환경변수:

    POCKETBASE_URL / POCKETBASE_ADMIN_EMAIL / POCKETBASE_ADMIN_PASSWORD
    HONDI_WORKER_URL   (예: https://hondi-proxy.tensor-city.workers.dev
                         — /embed-text, /sp-updates/propose 호출용)

  실행: python3 tools/triage_feedback.py [--dry-run] [--cluster-threshold 0.82]
  출력: data/feedback_triage_report.json (git commit 대상 — 사람이 읽을
        요약. renew_identity_templates.py의 identity_template_stats.json과
        동일 관례)

■ 주의 — 아직 실전 검증 안 됨
  user_feedback 컬렉션 스키마는 worker.js handleUserFeedbackSubmit()의
  payload를 기준으로 추정했다. 클러스터링 임계값(기본 0.82)도 실측
  데이터 없이 잡은 값이라, 실제 피드백이 쌓이면 재조정이 필요할 가능성이
  높다 — 매 실행마다 리포트에 클러스터 크기 분포를 남겨 조정 근거로 쓴다.
"""
import json
import os
import sys
import math
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent.parent
OUT = ROOT / 'data' / 'feedback_triage_report.json'

POCKETBASE_URL = os.environ.get('POCKETBASE_URL', '').rstrip('/')
ADMIN_EMAIL = os.environ.get('POCKETBASE_ADMIN_EMAIL', '')
ADMIN_PASSWORD = os.environ.get('POCKETBASE_ADMIN_PASSWORD', '')
WORKER_URL = os.environ.get('HONDI_WORKER_URL', '').rstrip('/')

DEFAULT_CLUSTER_THRESHOLD = 0.82  # 코사인 유사도 — 실측 전 잠정값(위 docstring 참조)

# 클러스터가 "명확히 특정 SP로 귀결"됐다고 볼 최소 조건 — 표본 부족한
# 채 브릿지하면 RENEWALING이 겪었던 것과 같은 과신 문제가 재현된다.
MIN_CLUSTER_SIZE_FOR_BRIDGE = 3


def _http_json(url, method='GET', headers=None, body=None):
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    if data is not None:
        req.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read().decode('utf-8'))


def _admin_token():
    url = f'{POCKETBASE_URL}/api/admins/auth-with-password'
    try:
        res = _http_json(url, method='POST', body={'identity': ADMIN_EMAIL, 'password': ADMIN_PASSWORD})
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'관리자 인증 실패 ({e.code}): {e.read().decode("utf-8", "ignore")}')
    token = res.get('token')
    if not token:
        raise RuntimeError('관리자 토큰 없음 — PocketBase 버전별 엔드포인트 경로 확인 필요')
    return token


def _fetch_new_feedback(token):
    headers = {'Authorization': f'Bearer {token}'}
    items, page = [], 1
    while True:
        qs = urllib.parse.urlencode({'filter': "status = 'new'", 'perPage': 200, 'page': page})
        res = _http_json(f'{POCKETBASE_URL}/api/collections/user_feedback/records?{qs}', headers=headers)
        items.extend(res.get('items', []))
        if page >= res.get('totalPages', 1):
            break
        page += 1
    return items


def _embed_batch(texts):
    # worker.js /embed-text 통로 — 한 번에 최대 100건(서버측 제한과 동일)
    vectors = []
    for i in range(0, len(texts), 100):
        chunk = texts[i:i + 100]
        res = _http_json(f'{WORKER_URL}/embed-text', method='POST', body={'texts': chunk})
        vectors.extend(res.get('vectors', []))
    return vectors


def _cosine(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def _cluster(items, vectors, threshold):
    """아주 단순한 탐욕적 클러스터링 — 외부 라이브러리(scikit-learn 등)
    의존 없이 표준 라이브러리만으로 돌아가게 했다(배치 서버 환경 제약
    고려, build_manifest.py·renew_identity_templates.py와 동일 관례:
    표준 라이브러리 우선). 대규모(수천 건) 피드백이 쌓이면 O(n²)라
    느려질 수 있다 — 그때는 실제 라이브러리 도입을 검토할 것.
    """
    n = len(items)
    assigned = [-1] * n
    clusters = []
    for i in range(n):
        if assigned[i] != -1:
            continue
        cluster_id = len(clusters)
        assigned[i] = cluster_id
        members = [i]
        for j in range(i + 1, n):
            if assigned[j] != -1:
                continue
            if _cosine(vectors[i], vectors[j]) >= threshold:
                assigned[j] = cluster_id
                members.append(j)
        clusters.append(members)
    return clusters


def main():
    dry_run = '--dry-run' in sys.argv
    threshold = DEFAULT_CLUSTER_THRESHOLD
    if '--cluster-threshold' in sys.argv:
        idx = sys.argv.index('--cluster-threshold')
        threshold = float(sys.argv[idx + 1])

    missing = [k for k, v in [
        ('POCKETBASE_URL', POCKETBASE_URL), ('POCKETBASE_ADMIN_EMAIL', ADMIN_EMAIL),
        ('POCKETBASE_ADMIN_PASSWORD', ADMIN_PASSWORD), ('HONDI_WORKER_URL', WORKER_URL),
    ] if not v]
    if missing:
        print(f'환경변수 누락: {", ".join(missing)}', file=sys.stderr)
        sys.exit(1)

    token = _admin_token()
    items = _fetch_new_feedback(token)
    print(f'신규 피드백 {len(items)}건 조회 완료')
    if not items:
        print('처리할 게 없음 — 종료')
        return

    texts = [it.get('raw_text', '') for it in items]
    vectors = _embed_batch(texts)
    if len(vectors) != len(items):
        print(f'경고: 임베딩 개수({len(vectors)})와 피드백 개수({len(items)})가 다름 — 중단', file=sys.stderr)
        sys.exit(1)

    clusters = _cluster(items, vectors, threshold)
    clusters.sort(key=len, reverse=True)

    report_clusters = []
    bridged = 0
    for members in clusters:
        member_items = [items[i] for i in members]
        # 클러스터 내 가장 흔한 category를 대표값으로(동률이면 먼저 나온 것)
        cats = [it.get('category', 'question') for it in member_items]
        top_category = max(set(cats), key=cats.count)
        # 대표 인용 — 가장 긴 원문(보통 정보량이 많다) 최대 3개
        quotes = sorted({it.get('raw_text', '') for it in member_items}, key=len, reverse=True)[:3]
        context_sps = sorted(set(it.get('context_sp') for it in member_items if it.get('context_sp')))

        cluster_info = {
            'size': len(members),
            'category': top_category,
            'context_sps': context_sps,
            'sample_quotes': quotes,
            'bridged_to_sp_update_proposal': False,
        }

        # 브릿지 조건: 표본 충분(과신 방지) + context_sp가 단일(모호하지
        # 않음) + bug/feature_request 계열(칭찬·단순 질문은 SP 수정
        # 제안거리가 아니다)
        if (len(members) >= MIN_CLUSTER_SIZE_FOR_BRIDGE
                and len(context_sps) == 1
                and top_category in ('bug', 'feature_request')):
            if not dry_run:
                try:
                    _http_json(f'{WORKER_URL}/sp-updates/propose', method='POST', body={
                        'sp_id': context_sps[0],
                        'current_version': '',
                        'trigger': 'user_correction',
                        'issue': f'사용자 {len(members)}명이 비슷한 취지로 언급: ' + ' / '.join(quotes[:2]),
                        'proposed_patch': '(사람 검토 필요 — 자동 생성된 초안이라 구체적 문안 없음, 위 인용을 참고해 판단)',
                        'confidence': 'low',  # 자동 클러스터링 기반이라 항상 low로 시작 — 사람이 격상 판단
                        'protected_sections_touched': False,
                        'source': 'user_feedback',
                        'user_feedback_ids': [it.get('id') for it in member_items if it.get('id')],
                    })
                    cluster_info['bridged_to_sp_update_proposal'] = True
                    bridged += 1
                except Exception as e:
                    print(f'브릿지 실패(무시, 리포트에는 남음): {e}', file=sys.stderr)

        report_clusters.append(cluster_info)

    output = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'total_feedback_processed': len(items),
        'cluster_threshold': threshold,
        'cluster_count': len(clusters),
        'bridged_to_review_queue': bridged,
        'clusters': report_clusters,
    }

    print(f'클러스터 {len(clusters)}개 (표본 {MIN_CLUSTER_SIZE_FOR_BRIDGE}건 이상·단일 SP·bug/feature_request인 {bridged}개는 검토 대기열로 브릿지)')

    if dry_run:
        print('--dry-run 지정 — 파일에 안 씀, 브릿지도 안 함. 요약:')
        print(json.dumps(output, ensure_ascii=False, indent=2)[:4000])
        return

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'✓ {OUT} 갱신 완료')


if __name__ == '__main__':
    main()
