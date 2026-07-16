#!/usr/bin/env python3
"""
tools/renew_identity_templates.py
----------------------------------
RENEWALING — 정체성/업종 ↔ 템플릿 관계를 주기적으로 재계산한다.

profile-assistant SP(§TEMPLATE-REFERENCE)는 매 세션 실시간으로 같은
schema_id(KSIC)/job_ksco 코드/work_domain.statuses 조합을 가진 공개
프로필을 최대 8건 조회해 템플릿을 동적으로 조합한다 — 이 스크립트는
그 조회 대상 풀 자체를 바꾸지 않는다(여전히 L1 profiles 컬렉션을
그대로 조회함). 이 스크립트가 하는 일은 그와 별개로, 누적된 전체
프로필을 정기적으로 훑어 코드별 필드 등장 빈도를 집계해두는 것이다 —
표본이 아직 적은 조합(예: 이제 막 3~4건 쌓인 신생 직업군)에서 [§ONE-
AT-A-TIME]이 "과반수 패턴"을 판단할 근거가 부족할 때 참고할 수 있는
보조 통계이자, 운영진(주피터님/Team Jupiter)이 "이 조합엔 아직 특이
사례가 하나뿐이라 강한 신호가 아니다" 같은 걸 파악하는 관측 도구다.

한 세션(profile-assistant)은 한 사용자만 보므로 전체 사용자 통계를 낼
수 없다 — 그래서 이 작업은 SP 안이 아니라 여기, 주기적 배치로 분리돼
있다(tools/build_manifest.py, tools/check_stale_refs.py와 같은 자리).

■ 실행 방식
  이 저장소의 다른 배치 도구와 마찬가지로 GitHub Actions cron 또는
  서버 크론으로 주기 실행하는 것을 전제로 작성했다. 필요한 환경변수:

    POCKETBASE_URL            (예: https://l1.hondi.net)
    POCKETBASE_ADMIN_EMAIL
    POCKETBASE_ADMIN_PASSWORD

  실행: python3 tools/renew_identity_templates.py
  출력: data/identity_template_stats.json (git commit 대상 — 사람이
        리뷰할 수 있는 텍스트 diff로 남긴다. build_manifest.py의
        sp-catalog.json과 동일한 관례)

■ 주의 — 아직 실전 검증 안 됨
  이 스크립트는 worker.js가 실제로 쓰는 PocketBase 컬렉션 스키마(필드
  명·중첩 구조)를 코드 열람으로 추정해 작성했다. 실행 전에 반드시
  1회 --dry-run으로 실제 응답 구조를 확인하고, extra.public.identity/
  industry_fields 경로가 실제 데이터와 맞는지 대조할 것을 권장한다.
"""
import json
import os
import sys
import urllib.request
import urllib.parse
import urllib.error
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent.parent
OUT = ROOT / 'data' / 'identity_template_stats.json'

POCKETBASE_URL = os.environ.get('POCKETBASE_URL', '').rstrip('/')
ADMIN_EMAIL = os.environ.get('POCKETBASE_ADMIN_EMAIL', '')
ADMIN_PASSWORD = os.environ.get('POCKETBASE_ADMIN_PASSWORD', '')

# schema_id(KSIC)와 job_ksco(KSCO)를 같은 통계표에서 구분하기 위한 접두사.
# work_domain.statuses는 조합 자체가 키이므로 정렬해 결합한다(순서 무관하게
# 같은 조합이 같은 키로 모이도록).
BUSINESS_PREFIX = 'ksic:'
PERSON_JOB_PREFIX = 'ksco:'
PERSON_DOMAIN_PREFIX = 'workdomain:'


def _http_json(url, method='GET', headers=None, body=None):
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    if data is not None:
        req.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read().decode('utf-8'))


def _admin_token():
    # worker.js의 _l1AdminToken()과 동일한 PocketBase 관리자 인증 흐름
    # (컬렉션명은 실제 배포판 확인 필요 — _admins 또는 _superusers일 수
    # 있음, PocketBase 버전에 따라 다르다).
    url = f'{POCKETBASE_URL}/api/admins/auth-with-password'
    try:
        res = _http_json(url, method='POST', body={
            'identity': ADMIN_EMAIL, 'password': ADMIN_PASSWORD,
        })
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'관리자 인증 실패 ({e.code}): {e.read().decode("utf-8", "ignore")}')
    token = res.get('token')
    if not token:
        raise RuntimeError('관리자 토큰을 응답에서 찾지 못함 — PocketBase 버전별 엔드포인트 경로 확인 필요')
    return token


def _fetch_all_public_profiles(token):
    headers = {'Authorization': f'Bearer {token}'}
    items = []
    page = 1
    while True:
        qs = urllib.parse.urlencode({
            'filter': 'is_public = true',
            'perPage': 200,
            'page': page,
        })
        url = f'{POCKETBASE_URL}/api/collections/profiles/records?{qs}'
        res = _http_json(url, headers=headers)
        batch = res.get('items', [])
        items.extend(batch)
        if page >= res.get('totalPages', 1):
            break
        page += 1
    return items


def _identity_keys(profile):
    """한 프로필이 속하는 통계 키(들)를 뽑는다. 여러 개일 수 있다
    (예: 사업자이면서 개인 job_ksco도 있는 경우, work_domain 다중결합)."""
    keys = []
    extra = profile.get('extra') or {}
    pub = extra.get('public') or {}
    identity = pub.get('identity') or {}
    industry = pub.get('industry_fields') or {}

    schema_id = industry.get('schema_id') or (extra.get('industry_fields') or {}).get('schema_id')
    if schema_id:
        keys.append(f'{BUSINESS_PREFIX}{schema_id}')

    job_ksco = identity.get('job_ksco') or {}
    if job_ksco.get('code'):
        keys.append(f'{PERSON_JOB_PREFIX}{job_ksco["code"]}')

    wd = identity.get('work_domain') or {}
    statuses = wd.get('statuses') or ([wd['status']] if wd.get('status') else [])
    if statuses:
        combo = '+'.join(sorted(set(statuses)))
        keys.append(f'{PERSON_DOMAIN_PREFIX}{combo}')

    return keys, pub


def _present_fields(pub):
    """이 프로필에 실제로 값이 채워진 상위 필드 이름 집합(빈도 집계 대상).
    필드명 자체는 프로필 카드/PROFILE_SUBMIT 스키마와 맞춘다."""
    present = set()
    identity = pub.get('identity') or {}
    for f in ('address', 'phone'):
        if (pub.get('contact') or pub.get('location') or {}).get(f):
            present.add(f)
    if (pub.get('location') or {}).get('address_short'):
        present.add('address')
    if (pub.get('contact') or {}).get('phone_display'):
        present.add('phone')
    if pub.get('products'):
        present.add('products')
    if (pub.get('activity') or {}).get('hours'):
        present.add('hours')
    if identity.get('description'):
        present.add('description')
    if (pub.get('finance') or {}).get('gdc_accepted'):
        present.add('gdc_accepted')
    industry = pub.get('industry_fields') or {}
    for k, v in industry.items():
        if v not in (None, '', [], {}):
            present.add(f'industry_fields.{k}')
    return present


def compute_stats(profiles):
    grouped = defaultdict(list)  # key -> [set(present_fields), ...]
    for p in profiles:
        keys, pub = _identity_keys(p)
        if not keys:
            continue
        present = _present_fields(pub)
        for k in keys:
            grouped[k].append(present)

    stats = {}
    for key, samples in grouped.items():
        n = len(samples)
        field_counts = defaultdict(int)
        for s in samples:
            for f in s:
                field_counts[f] += 1
        stats[key] = {
            'sample_size': n,
            # 과반수(50% 초과) 등장 필드만 "권장" — SP의 [§TEMPLATE-
            # REFERENCE] "과반수 패턴만 참고" 원칙과 동일 기준.
            'recommended_fields': sorted([f for f, c in field_counts.items() if c > n / 2]),
            'field_frequency': {f: round(c / n, 3) for f, c in sorted(field_counts.items())},
        }
    return stats


def main():
    dry_run = '--dry-run' in sys.argv
    if not POCKETBASE_URL or not ADMIN_EMAIL or not ADMIN_PASSWORD:
        print('POCKETBASE_URL / POCKETBASE_ADMIN_EMAIL / POCKETBASE_ADMIN_PASSWORD 환경변수 필요', file=sys.stderr)
        sys.exit(1)

    token = _admin_token()
    profiles = _fetch_all_public_profiles(token)
    print(f'공개 프로필 {len(profiles)}건 조회 완료')

    stats = compute_stats(profiles)

    prev = {}
    if OUT.exists():
        try:
            prev = json.loads(OUT.read_text(encoding='utf-8')).get('identities', {})
        except Exception:
            prev = {}

    # 변경 리포트 — 새로 생긴 조합, 권장 필드가 바뀐 조합만 출력(사람이
    # 리뷰할 diff 노이즈를 줄인다).
    for key, cur in sorted(stats.items()):
        old = prev.get(key)
        if old is None:
            print(f'[신규] {key} (표본 {cur["sample_size"]}건) → {cur["recommended_fields"]}')
        elif set(old.get('recommended_fields', [])) != set(cur['recommended_fields']):
            print(f'[변경] {key}: {old.get("recommended_fields")} → {cur["recommended_fields"]} (표본 {cur["sample_size"]}건)')

    output = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'total_public_profiles_scanned': len(profiles),
        'identities': stats,
    }

    if dry_run:
        print('--dry-run 지정 — 파일에 쓰지 않음. 아래는 계산된 요약:')
        print(json.dumps(output, ensure_ascii=False, indent=2)[:4000])
        return

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'✓ {OUT} 갱신 완료 ({len(stats)}개 조합)')


if __name__ == '__main__':
    main()
