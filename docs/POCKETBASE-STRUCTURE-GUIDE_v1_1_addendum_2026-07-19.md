# PocketBase 구조 & 지침 (L1-hanlim 인프라) — v1.1 addendum

```
문서 코드: POCKETBASE-STRUCTURE-GUIDE
버전: v1.1 addendum (base: v1.0, 2026-07-16)
작성일: 2026-07-19
근거: 2026-07-19 세션에서 K-Security 로깅을 Supabase → L1 PocketBase로
      이관하고, users 저장소의 register/검색 기능을 profiles 컬렉션
      기반으로 재설계하며 SSH로 직접 확인한 사실만 기록한다.
      v1.0의 내용을 재서술하지 않는다 — v1.0을 먼저 읽고 이 문서를 참고할 것.
```

## 0. 이 문서를 왜 읽어야 하는가

오늘 `security_log` 컬렉션 존재 여부를 확인하는 데만 30분 이상 걸렸다.
원인은 v1.0을 먼저 읽지 않고 처음부터 재조사했기 때문이다. v1.0의
"`hanlim/` ← hanlim 인스턴스 데이터(data.db 등)"라는 서술이 이미 정확했는데,
그 옆에 방치된 낡은 `pb_data/` 서브폴더(§1)에 낚여서 "컬렉션이 없다"는
잘못된 결론을 냈었다. **이 문서를 읽기 전에 반드시 v1.0을 먼저 읽어라.**

## 1. ⚠️ `pb_data` 서브폴더 함정 — v1.0에 없던 내용

v1.0은 `pb/hanlim/`에 `data.db`가 바로 있다고 정확히 서술했다. 문제는
**그 옆에 `pb/hanlim/pb_data/data.db`라는 별개의 낡은 파일(96KB, 과거
세션 잔재)이 방치돼 있어서, 무심코 그쪽을 먼저 열어보면 완전히 다른
(거의 빈) 데이터베이스를 보게 된다**는 것이다. 진짜 파일과 가짜 파일이
같은 이름(`data.db`)으로 서로 다른 경로에 공존하므로 경로를 안 외우고
있으면 반드시 틀린다.

**절대 틀리지 않는 확인법** — `--dir` 플래그나 기억에 의존하지 말고,
실행 중인 프로세스가 실제로 열어둔 파일을 직접 본다:
```bash
ps aux | grep pocketbase                    # PID 확인
sudo lsof -p {PID} 2>/dev/null | grep -i db  # 실제로 연 파일 경로
# 또는: sudo ls -la /proc/{PID}/fd/ | grep -i db
```
여기 나온 경로만 신뢰한다. `(deleted)` 표시가 있으면 파일이 나중에
교체/이동된 것이므로 더욱 주의.

조회 시 WAL 미체크포인트로 인한 오탐도 있었다 — 최신 상태를 보려면:
```bash
sqlite3 {실제경로}/data.db "PRAGMA wal_checkpoint(FULL); SELECT name FROM _collections ORDER BY name;"
```

## 2. nginx 라우팅 — l1-hanlim.gopang.net의 실제 진입점

v1.0은 hanlim만 `0.0.0.0:8091`로 공개돼 있다고 서술했는데, 실측 결과
**PocketBase 프로세스 자체는 `127.0.0.1:8091`에만 바인딩되어 있고,
nginx가 443을 물고 리버스 프록시하는 구조**였다(2026-07-19 `ss -tlnp`
실측). 둘 중 뭐가 최신인지는 배포 방식이 그 사이 바뀌었을 수 있으니
작업 전 항상 재확인:
```bash
sudo ss -tlnp | grep -E ":443|:80|:8091"
```

nginx를 쓰는 경우, vhost 설정은 `/etc/nginx/sites-enabled/l1-hanlim`
(확장자 없음 — `find -name "*.conf"`로 검색하면 놓친다):
```bash
grep -n "location\|proxy_pass\|server_name" /etc/nginx/sites-enabled/l1-hanlim
```
`location /` → 8091(hanlim 자신), `location /n/{노드명}/` → 각 L1 노드
포트로 rewrite 후 프록시하는 구조. **L4(kr, 8095)/L5(global, 8096)는
nginx location에 아직 안 걸려있음** — 외부에서 접근하려면 location
추가 필요.

## 3. API 접근 규칙(Rules) — sqlite3로는 NULL과 빈 문자열을 구분 못 한다

`_collections` 테이블의 `listRule`/`createRule`/`updateRule` 등을
sqlite3로 조회하면 `NULL`(관리자 전용)과 `''`(공개 허용)이 **화면에
똑같이 빈 칸으로 보인다.** 반드시 실제 API 호출로 검증할 것:
```bash
# CREATE 권한 테스트 (안전한 값으로)
curl -s -X POST "https://l1-hanlim.gopang.net/api/collections/{컬렉션}/records" \
  -H "Content-Type: application/json" -d '{"guid":"test-probe-delete-me", ...}'
# 정상 JSON 응답 = createRule=""(공개) / 401·403 = createRule=null(관리자 전용)
```
테스트 레코드는 관리자 토큰으로 반드시 DELETE해서 정리.

관리자 인증(v1.0에 없던 실제 엔드포인트, PocketBase 0.22.14 기준):
```bash
curl -s -X POST "https://l1-hanlim.gopang.net/api/admins/auth-with-password" \
  -H "Content-Type: application/json" \
  -d '{"identity":"tensor.city@gmail.com","password":"{현재 비밀번호}"}'
```
(`/api/collections/_superusers/...` 아님 — 그건 0.23+ 문법)

## 4. `pb_hooks`가 Rule 시스템을 우회하는 실제 사례

v1.0은 `pb_hooks/`가 "모든 인스턴스가 공유하는 JS 훅"이라고만 언급했는데,
실제로 **Rule 설정과 무관하게 커스텀 검증을 강제하는 사례**를 확인했다.

`profiles` 컬렉션: `updateRule`을 무시하고, 아무 PATCH 요청이나 보내면
```json
{"code":400,"message":"프로필 수정에는 guid, pubkey, signature가 필요합니다."}
```
즉 **Ed25519 서명(OpenHash TOFU 지갑 서명 패턴)이 있어야만 레코드 수정
가능** — 훅이 자체적으로 서명 검증 로직을 갖고 있다는 뜻. `createRule`은
이 훅에 안 걸려서 생성은 서명 없이 된다(생성 시엔 pubkey/signature
요구 안 함, 확인됨).

**교훈**: 컬렉션 CRUD가 Rule 설정과 다르게 동작하면 십중팔구
`pb_hooks`가 개입 중이라는 뜻이다. 다음에 `profiles` 수정 기능을
구현해야 하면, Rule을 아무리 만져도 소용없고 **먼저
`/opt/gopang/pb_hooks/` 안의 실제 훅 파일을 열어봐야 한다**
(이번 세션에선 존재만 확인, 내용은 안 열어봄 — 다음 작업 시 필수):
```bash
ls -la /opt/gopang/pb_hooks/
cat /opt/gopang/pb_hooks/*.pb.js   # 파일명은 실제 확인 필요
```

## 5. 신규 컬렉션 생성 — Import UI의 숨은 위험

관리자 UI의 "Import collections" 기능은 **JSON에 없는 기존 컬렉션을
삭제하는 옵션이 기본 동작에 포함될 수 있다.** hanlim에 58개나 되는
기존 컬렉션이 있는 상태에서 신규 3~4개만 담긴 JSON을 그대로 Import하면
나머지가 전부 삭제될 위험이 있다.

**안전한 대안**: `POST /api/collections`를 컬렉션별로 개별 호출(삭제
API를 아예 안 부르므로 기존 데이터에 영향 자체가 불가능). 관리자 인증
→ 컬렉션 JSON 배열 순회 → 개별 POST → 이미 있으면 스킵, 패턴의
스크립트(`create_security_collections.py`, gopang 저장소 밖에 있음)로
검증 완료.

**PocketBase 0.22.x 스키마 작성 시 숨은 필수값** (안 채우면
`validation_required: Cannot be blank` 400 에러):
- `select` 타입 → `options.values`(배열) + `options.maxSelect`(정수) 필수
- `json` 타입 → `options.maxSize`(바이트, 정수) 필수. 관례: `2000000`(2MB)

## 6. `profiles` 컬렉션 — Supabase `user_profiles` 계열의 실질적 후속 설계

과거 세션에서 "이관 중"이라고만 알려져 있던 `profiles` 컬렉션의 정확한
실체를 확인했다. 옛 Supabase `user_profiles` + `location_log` +
`seller_ratings` 3개 테이블을 flat하게 통합한 설계로 보인다
(PocketBase가 JOIN을 지원 안 하므로 이런 구조가 된 것으로 추정):

```
guid(unique), handle, nickname_hash, native_lang, entity_type, is_public,
fpHex, e164, country_code, nickname, region,
pubkey_ed25519, x25519_pubkey, x25519_registered_at,
push_subscription, push_sound,
extra(json, maxSize 2MB — services/website/phone/trust_level/gdc_accepted
      등 전용 컬럼 없는 값들을 여기 몰아넣음),
digit_code_id, temp_score, temp_rating_count, temp_updated_at,
name, address, lat, lng, occupation,
search_text(← 통합검색용, search_entities RPC의 ILIKE 매칭 대체),
claim_status(claimed/unclaimed), claim_source
```
Rule: `listRule`/`viewRule` = `"is_public = true"`, `createRule` = `""`,
`updateRule`은 §4의 서명 검증 훅에 걸림.

**주의**: `org_profiles`라는 이름이 비슷한 컬렉션이 따로 있는데, 이건
전혀 다른 개념(정부기관 데이터 연동 상태 추적, GOV-TIER-IO-SCHEMA 계열)
이다. `profiles` ≠ `org_profiles` — 헷갈리지 말 것.

`search_entities`(옛 Supabase RPC, 6테이블 JOIN + Haversine 거리계산 +
평점 가중평균)는 PocketBase가 지원 못 하는 기능들이라 그대로 이관 불가.
`search_text` 필터 + 클라이언트(JS)에서 거리/정렬 재계산하는 방식으로
대체함(users 저장소 webapp.html/desktop.html의 `pbSearchEntities()` 참고).

## 7. v1.0 §7 "TBD" 갱신

- L1~L5 인스턴스별 `--hooksDir`은 전부 `/opt/gopang/pb_hooks` 공유 확인됨
  (2026-07-19 `ps aux` 실측) — hanlim만이 아니라 49개 전체가 같은 훅을 씀.
  즉 `pb_hooks` 수정은 49개 노드 전체에 영향을 준다는 뜻이므로 더 신중해야 함.
- 나머지 TBD(마이그레이션 공유 여부, L1~L5 간 데이터 동기화)는 이번
  세션에서도 다루지 않음 — 여전히 미확인.
