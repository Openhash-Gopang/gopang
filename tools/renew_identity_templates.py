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

■ KSIC 계층 증류 (2026-0X-XX 신설)
  주피터님 관찰: "대분류·중분류·소분류·세분류는 SP-Tree와 같은 상속
  구조를 이룬다. 소분류로부터 중분류를 증류하고, 중분류에서 대분류
  템플릿을 증류하는 메커니즘이 필요하다." worker.js의
  _l1FindTemplateReferenceProfiles(라이브 조회, 세션 중 실시간으로
  TEMPLATE_MIN_SAMPLE 미만이면 부모 코드로 즉시 올라감)와 짝을 이루는
  배치판이다 — 라이브 쪽은 "이번 세션에 필요한 만큼만 그때그때 조회",
  이 스크립트는 "전체 트리를 미리 다 계산해 사람이 리뷰할 수 있게
  남겨둠"이라는 역할 차이가 있다(RENEWALING 문단이 이미 명시한
  "한 세션은 전체 통계를 볼 수 없다"는 원칙과 동일선상).

  ksic:{code} 키에 한해, 자기 코드에 직접 태깅된 프로필만 보는
  "own"(기존 필드명 그대로 최상위에 유지, 하위호환)과, 자기 코드 +
  모든 하위 코드(재귀적으로 이미 증류된 풀)를 합친 "distilled" 두
  통계를 함께 낸다. distilled 풀은 세분류→소분류→중분류→대분류 순으로
  레벨별로 처리해야 자식이 이미 증류된 뒤에 부모를 계산할 수 있다
  (레벨 5부터 역순으로 순회). job_ksco:/workdomain: 키는 KSIC 계층
  개념이 없으므로 이번 확장 대상이 아니다 — 기존 방식 그대로.

  계층 정의는 data/classification/ksic-parent-map.json 하나만 신뢰한다
  (tools/build_ksic_parent_map.py가 ksic-flat.csv에서 생성, worker.js도
  동일 파일을 씀 — 계층 정의를 이 스크립트 안에 따로 만들면 두 사본이
  갈라지는 문제를 반복하게 된다).

■ 실행 방식
  이 저장소의 다른 배치 도구와 마찬가지로 GitHub Actions cron 또는
  서버 크론으로 주기 실행하는 것을 전제로 작성했다(주피터님 지시 —
  월 1회 또는 분기 1회). 필요한 환경변수:

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
KSIC_PARENT_MAP_PATH = ROOT / 'data' / 'classification' / 'ksic-parent-map.json'

POCKETBASE_URL = os.environ.get('POCKETBASE_URL', '').rstrip('/')
ADMIN_EMAIL = os.environ.get('POCKETBASE_ADMIN_EMAIL', '')
ADMIN_PASSWORD = os.environ.get('POCKETBASE_ADMIN_PASSWORD', '')

# schema_id(KSIC)와 job_ksco(KSCO)를 같은 통계표에서 구분하기 위한 접두사.
# work_domain.statuses는 조합 자체가 키이므로 정렬해 결합한다(순서 무관하게
# 같은 조합이 같은 키로 모이도록).
BUSINESS_PREFIX = 'ksic:'
PERSON_JOB_PREFIX = 'ksco:'
PERSON_DOMAIN_PREFIX = 'workdomain:'

# 2026-07-17 신설 — 최소 표본 크기 임계값(주피터님 지시로 Claude가 의견
# 제시 후 반영). 100인 사고실험(§4)에서 n=1일 때 "과반수(50% 초과)" 기준이
# 우연히 채워진 필드까지 자동으로 "권장"으로 승격시키는 과신 문제를 실측으로
# 확인했다 — 그 해결. worker.js의 TEMPLATE_MIN_SAMPLE(라이브 조회 상향
# 임계값)과 동일한 3을 쓴다 — 배치·라이브 두 메커니즘이 "표본이 몇 건이면
# 믿을 만한가"라는 같은 질문에 서로 다른 답을 하면 혼란스러우므로 숫자를
# 맞춘다(의미는 다르다 — 라이브는 "언제 상위로 올라갈지", 배치는 "언제
# confidence를 승격할지").
MIN_SAMPLE_PROVISIONAL = 3
MIN_SAMPLE_STABLE = 5


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

    # 2026-07-17 신설 — 위 하드코딩된 체크리스트가 정확히 worker.js의
    # _filterProfileByVisibility가 겪었던 것과 같은 함정이다(같은 세션에서
    # 발견·수정): 필드를 하나씩 나열하다 보니 finance의 currencies·
    # price_range·payout_account, activity의 holidays 같은 나머지 필드,
    # 그리고 PA가 자연어 대화로 만들 향후 신규 최상위 슬롯은 전부
    # 빠져있었다. industry_fields처럼 제네릭 순회로 보완 — 이미 위에서
    # 개별 처리한 키(_HANDLED)는 건너뛰고, finance의 나머지 필드까지
    # 코드 수정 없이 자동으로 잡히게 한다.
    _HANDLED = {'address', 'phone', 'products', 'hours', 'description', 'gdc_accepted'}
    finance = pub.get('finance') or {}
    for k, v in finance.items():
        if k == 'gdc_accepted':
            continue  # 이미 위에서 처리
        if v not in (None, '', [], {}) and f'finance.{k}' not in _HANDLED:
            present.add(f'finance.{k}')
    activity = pub.get('activity') or {}
    for k, v in activity.items():
        if k in ('hours', 'timezone'):
            continue  # hours는 이미 처리, timezone은 거의 항상 고정값이라 빈도 집계 의미 없음
        if v not in (None, '', [], {}):
            present.add(f'activity.{k}')

    return present


def _group_by_identity(profiles):
    """key(ksic:.../ksco:.../workdomain:...) -> [present_field_set, ...]"""
    grouped = defaultdict(list)
    for p in profiles:
        keys, pub = _identity_keys(p)
        if not keys:
            continue
        present = _present_fields(pub)
        for k in keys:
            grouped[k].append(present)
    return grouped


def _stats_for_pool(pool):
    n = len(pool)
    field_counts = defaultdict(int)
    for s in pool:
        for f in s:
            field_counts[f] += 1
    if n < MIN_SAMPLE_PROVISIONAL:
        confidence = 'insufficient'
        recommended = []
    else:
        confidence = 'provisional' if n < MIN_SAMPLE_STABLE else 'stable'
        # 과반수(50% 초과) 등장 필드만 "권장" — SP의 [§TEMPLATE-
        # REFERENCE] "과반수 패턴만 참고" 원칙과 동일 기준.
        recommended = sorted([f for f, c in field_counts.items() if c > n / 2])
    return {
        'sample_size': n,
        'confidence': confidence,
        'recommended_fields': recommended,
        'field_frequency': {f: round(c / n, 3) for f, c in sorted(field_counts.items())},
    }


def compute_stats(grouped):
    """기존 동작 그대로 — key별 완전일치(own-level) 통계만."""
    return {key: _stats_for_pool(samples) for key, samples in grouped.items()}


def _load_ksic_parent_map():
    """단일 소스 — worker.js가 §TEMPLATE-REFERENCE 계층 조회에 쓰는 것과
    동일한 data/classification/ksic-parent-map.json을 그대로 읽는다.
    별도 계층 정의를 여기 다시 만들지 않는다(사본 두 개 갈라짐 방지 —
    HONDI-CAPABILITIES-COMMON 신설 전 겪었던 문제와 동일 계보)."""
    if not KSIC_PARENT_MAP_PATH.exists():
        return {}, {}
    data = json.loads(KSIC_PARENT_MAP_PATH.read_text(encoding='utf-8'))
    return data.get('parent', {}) or {}, data.get('level', {}) or {}


def distill_ksic_hierarchy(grouped, parent_map, level_map):
    """세분류(5)→소분류(4)→중분류(3)... 실제로는 KSIC 레벨 정의가
    5(세세분류)~1(대분류)이므로 5부터 1까지 역순으로 처리한다. 각
    상위 코드의 증류 풀은 자기 코드에 직접 태깅된 프로필 + 모든 직계
    자식의 "이미 증류된" 풀을 그대로 물려받는다 — 재귀적으로 조상
    코드일수록 더 넓은 하위 트리 전체를 포함하게 된다. 이렇게 하면
    "소분류로부터 중분류를 증류하고, 중분류에서 대분류를 증류"하는
    단계적 상속이 성립한다.

    반환값: {code: {'level': N, 'own': {...} | None, 'distilled': {...}}}
    (own은 자기 코드에 직접 태깅된 프로필이 1건도 없으면 None — 없는
    데이터를 0건으로 지어내지 않는다, U2 원칙과 동일)
    """
    ksic_own = {}
    for key, samples in grouped.items():
        if key.startswith(BUSINESS_PREFIX):
            ksic_own[key[len(BUSINESS_PREFIX):]] = samples

    children = defaultdict(list)
    for code, parent in parent_map.items():
        if parent:
            children[parent].append(code)

    codes_by_level = defaultdict(list)
    for code in set(parent_map.keys()) | set(ksic_own.keys()):
        lvl = level_map.get(code)
        if lvl:
            codes_by_level[lvl].append(code)

    aggregated_pool = {}  # code -> [present_field_set, ...]
    for lvl in sorted(codes_by_level.keys(), reverse=True):  # 5,4,3,2,1
        for code in codes_by_level[lvl]:
            pool = list(ksic_own.get(code, []))
            for child in children.get(code, []):
                pool.extend(aggregated_pool.get(child, []))
            if pool:
                aggregated_pool[code] = pool

    result = {}
    for code, pool in aggregated_pool.items():
        result[code] = {
            'level': level_map.get(code),
            'own': _stats_for_pool(ksic_own[code]) if code in ksic_own else None,
            'distilled': _stats_for_pool(pool),
        }
    return result


def main():
    dry_run = '--dry-run' in sys.argv
    if not POCKETBASE_URL or not ADMIN_EMAIL or not ADMIN_PASSWORD:
        print('POCKETBASE_URL / POCKETBASE_ADMIN_EMAIL / POCKETBASE_ADMIN_PASSWORD 환경변수 필요', file=sys.stderr)
        sys.exit(1)

    token = _admin_token()
    profiles = _fetch_all_public_profiles(token)
    print(f'공개 프로필 {len(profiles)}건 조회 완료')

    grouped = _group_by_identity(profiles)
    stats = compute_stats(grouped)  # 기존 동작(job_ksco/workdomain 포함 전체 키의 own-level)

    parent_map, level_map = _load_ksic_parent_map()
    if not parent_map:
        print('[경고] data/classification/ksic-parent-map.json 없음 — KSIC 계층 증류 스킵, 기존 완전일치 통계만 생성합니다.', file=sys.stderr)
        ksic_distilled = {}
    else:
        ksic_distilled = distill_ksic_hierarchy(grouped, parent_map, level_map)
        print(f'KSIC 계층 증류 완료 — {len(ksic_distilled)}개 코드(own 데이터가 없어도 하위에서 증류된 코드 포함)')

    # ksic: 키 결과를 own(기존 필드명 그대로, 하위호환) + level + distilled로
    # 재구성한다. job_ksco:/workdomain: 키는 기존 그대로 손대지 않는다.
    final_identities = {}
    for key, own_stat in stats.items():
        if key.startswith(BUSINESS_PREFIX):
            code = key[len(BUSINESS_PREFIX):]
            entry = dict(own_stat)  # sample_size/confidence/recommended_fields/field_frequency 그대로 유지(하위호환)
            entry['level'] = level_map.get(code)
            if code in ksic_distilled:
                entry['distilled'] = ksic_distilled[code]['distilled']
            final_identities[key] = entry
        else:
            final_identities[key] = own_stat

    # own 데이터가 전혀 없지만(직접 태깅된 프로필 0건) 하위 코드에서 증류된
    # 조상 코드(대분류·중분류가 흔함 — 이 코드로 직접 가입하는 경우는
    # 드물다)도 새 엔트리로 추가한다. 이게 이번 확장의 핵심이다 — 예전
    # 스크립트는 own 데이터가 있는 코드만 stats에 등장했다.
    for code, info in ksic_distilled.items():
        key = f'{BUSINESS_PREFIX}{code}'
        if key not in final_identities:
            final_identities[key] = {'level': info['level'], 'distilled': info['distilled']}

    prev = {}
    if OUT.exists():
        try:
            prev = json.loads(OUT.read_text(encoding='utf-8')).get('identities', {})
        except Exception:
            prev = {}

    # 변경 리포트 — 새로 생긴 조합, 권장 필드가 바뀐 조합만 출력(사람이
    # 리뷰할 diff 노이즈를 줄인다). own/distilled 각각 비교.
    for key, cur in sorted(final_identities.items()):
        old = prev.get(key)
        cur_own = cur.get('recommended_fields')  # None이면 own 데이터 없음(ksic 조상 코드 등)
        cur_distilled = (cur.get('distilled') or {}).get('recommended_fields')
        old_own = old.get('recommended_fields') if old else None
        old_distilled = (old.get('distilled') or {}).get('recommended_fields') if old else None
        if old is None:
            print(f'[신규] {key} own={cur_own} distilled={cur_distilled}')
        elif set(old_own or []) != set(cur_own or []) or set(old_distilled or []) != set(cur_distilled or []):
            print(f'[변경] {key}: own {old_own}→{cur_own} / distilled {old_distilled}→{cur_distilled}')

    output = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'total_public_profiles_scanned': len(profiles),
        'identities': final_identities,
    }

    if dry_run:
        print('--dry-run 지정 — 파일에 쓰지 않음. 아래는 계산된 요약:')
        print(json.dumps(output, ensure_ascii=False, indent=2)[:4000])
        return

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'✓ {OUT} 갱신 완료 ({len(final_identities)}개 조합, KSIC 계층 증류 {len(ksic_distilled)}개 포함)')


if __name__ == '__main__':
    main()
