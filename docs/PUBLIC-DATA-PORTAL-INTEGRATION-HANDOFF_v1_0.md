# 인수인계 — 공공데이터포털 통합 세션 (2026-07-16)

```
문서 코드: PUBLIC-DATA-PORTAL-INTEGRATION-HANDOFF
버전: v1.0
작성일: 2026-07-16
대상: 다음 세션(새 대화창)에서 STEP 3(K-Tax) 이후를 이어갈 사람/AI
관련 문서:
  - docs/PUBLIC-DATA-PORTAL-INTEGRATION-PLAN_v1_0.md (전체 계획·사고실험)
  - docs/POCKETBASE-STRUCTURE-GUIDE_v1_0.md (PocketBase 인프라 상세)
```

## 1. 오늘 완료된 것 — 라이브 정상 작동 확인됨

| STEP | 엔드포인트 | 데이터 출처 | 인증 |
|---|---|---|---|
| 1 | `GET /public-data/bdong-code?q={시도명}` | data.go.kr 행정표준코드(법정동코드) | `DATA_GO_KR_API_KEY` |
| 2 | `GET /public-data/law-search?q={검색어}` | data.go.kr 법제처 국가법령정보 | `DATA_GO_KR_API_KEY`(동일 키 재사용) |
| 2-b | `GET /public-data/law-precedent?mode=search\|detail&q=...&id=...` | open.law.go.kr 국가법령정보 공동활용(판례) | `LAW_GO_KR_OC`(별도 시스템, 별도 인증) |
| 2-c | (2-b 응답 정리) | `mode=search`일 때 `raw` 대신 `rows` 배열로 정리됨 — 실측 필드 확정 완료 | — |

모두 `https://hondi-proxy.tensor-city.workers.dev`에서 서빙 중. 테스트 예시:
```powershell
Invoke-RestMethod "https://hondi-proxy.tensor-city.workers.dev/public-data/law-search?q=개인정보보호법"
```

## 2. 오늘 새로 만든 인프라

### 2-1. PocketBase 자동배포 파이프라인
`.github/workflows/deploy-pb-migrations.yml` — `pb_migrations/**` 가 main에 push되면, **이번 커밋에서 실제로 바뀐 파일명만** 골라 L1(hanlim) 서버에 안전하게 반영한다(전체 폴더 동기화 방식은 사고 나서 폐기함 — 아래 4장 참고). 서버 쪽 실행 스크립트는 `/opt/gopang/ops/apply-pb-migrations.sh` (강제 SSH 커맨드로만 실행 가능, 개별 파일 다운로드 후 `migrate(` 문자열 검증까지 거침).

### 2-2. 관리자 전용 격리 워커 `hondi-admin-proxy`
공개 트래픽 받는 `hondi-proxy`와 완전히 분리된 별도 Cloudflare Worker
(`https://hondi-admin-proxy.tensor-city.workers.dev`). GitHub PAT는
**이 워커에만** 있고 `hondi-proxy`엔 절대 없음. 용도: GitHub Actions
수동 재트리거.
```powershell
Invoke-RestMethod -Method Post -Uri "https://hondi-admin-proxy.tensor-city.workers.dev/trigger-pb-migrations" -Headers @{ Authorization = "Bearer {ADMIN_MASTER_KEY}" }
```
로컬에서 `wrangler` 관련 작업은 **`C:\temp\` 같은 영문 경로에서만** —
`C:\Users\주피터\...` 한글 경로에서 `wrangler deploy` 시 esbuild가
깨지는 버그 확인됨(git push 기반 배포는 이 문제와 무관, Ubuntu에서
실행되므로 안전).

## 3. Secret 인벤토리 (값은 여기 없음, 이름과 위치만)

**`hondi-proxy`** (공개 워커):
`DATA_GO_KR_API_KEY`, `LAW_GO_KR_OC`, 그 외 기존 시크릿 다수(KOSIS, KAKAO, SOLAPI 등 — 오늘 작업과 무관).
**절대 GitHub PAT를 여기 넣지 말 것** — 오늘 실수로 한 번 들어갔다가 즉시 삭제함.

**`hondi-admin-proxy`** (관리자 전용 워커): `ADMIN_MASTER_KEY`(hondi-proxy와 동일 값), `GITHUB_PAT`(fine-grained, `Openhash-Gopang/gopang` 저장소 한정, Actions:Read/write, **Owner를 반드시 `Openhash-Gopang`으로 선택**— 개인 계정(nounweb)으로 잘못 만들면 403 남, 오늘 여러 번 반복된 실수).

**GitHub Actions secrets** (`Openhash-Gopang/gopang` 저장소): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`(기존), `L1_SSH_PRIVATE_KEY`/`L1_SSH_HOST`/`L1_SSH_USER`(오늘 신설, hanlim 서버 강제-커맨드 전용 키).

## 4. 오늘 겪은 사고와 원인 (다음에 반복하지 말 것)

1. **`text.replace(ANCHOR, NEW)` 방식으로 함수를 이어붙이다가 앵커에 포함된 직전 함수의 `return`/`}`를 함께 삭제해버림** → worker.js 문법 깨짐 → esbuild 배포 실패. `node --check`는 이걸 못 잡았다(Node가 관대하게 파싱함). **교훈: 텍스트 삽입형 코드 생성 후엔 esbuild로 실제 번들 검증까지 할 것.**
2. **`/opt/gopang/pb`가 git 저장소가 아님을 모르고 있었음** → `git push`만 하면 서버에 반영된다고 착각 → 마이그레이션 파일이 GitHub에만 있고 서버엔 없는 상태로 방치됨.
3. **`curl ... -o 파일` 실패(404) 시 에러 텍스트를 그대로 파일로 저장** → PocketBase가 그걸 JS로 파싱하려다 panic → 서비스 크래시. **교훈: 다운로드 후 반드시 내용 검증(최소 `grep migrate(`) 후 저장.**
4. **강제 SSH 커맨드(`command=`) 키로 rsync 시도** → 강제 커맨드가 rsync의 내부 SSH 세션까지 하이재킹 → 파일 전송 자체가 원천적으로 불가능. **교훈: 강제 커맨드 키는 파일 전송에 못 씀, `SSH_ORIGINAL_COMMAND`로 파라미터만 전달하는 방식으로 설계.**
5. **pb_migrations 폴더 전체를 GitHub에서 동기화** → 이 저장소에서 동시 진행 중이던 무관한 미완성 마이그레이션까지 서버로 끌려옴 → 크래시 → 502 다운타임. **교훈: 항상 "이번에 실제로 바뀐 파일"만 골라서 반영.**
6. **`_migrations` 이력 테이블과 실제 DB 스키마가 오랫동안 어긋나 있었음**(32건) — 이번 사고로 발견됨. 원인 불명(다른 세션들이 각자 마이그레이션 파일만 만들고 서버 반영을 놓쳤을 가능성). **교훈: 정기적으로 `migrate up` 드라이런해서 드리프트 점검 권장.**
7. **fine-grained GitHub PAT를 개인 계정(Owner: nounweb) 소유로 잘못 생성** → 조직 저장소(`Openhash-Gopang/gopang`) Actions 권한이 애초에 적용 안 됨, 여러 번 반복. **교훈: 토큰 생성 화면에서 Owner를 조직으로 정확히 선택했는지 항상 확인.**
8. **GitHub 워크플로우 파일(`.github/workflows/*`) 수정은 fine-grained PAT에 별도 `workflow` 권한이 필요** — Contents/Actions 권한과 별개. 이 경우 로컬 `git push`(사람 계정)로 우회함.
9. **Windows 한글 사용자 경로(`C:\Users\주피터`)에서 `wrangler deploy`가 esbuild 어설션 실패로 죽음** — `C:\temp\` 등 영문 경로에서 실행하면 정상.

## 5. STEP 3 (K-Tax) — 다음에 이어서 할 일

**데이터셋**: 국세청_사업자등록정보 진위확인 및 상태조회 서비스
(`data.go.kr/data/15081808/openapi.do`)

**확인된 스펙** (활용신청 아직 안 됨 — 이것부터):
- 상태조회: `POST https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey={인증키}`
  - body: `{"b_no": ["숫자만, 하이픈 없이", ...]}` (최대 100건)
  - 응답: `{request_cnt, status_code, data: [{b_no, b_stt, b_stt_cd, tax_type, ...}]}` (b_stt_cd: 01=계속사업자, 02=휴업자, 03=폐업자)
- 진위확인: `POST https://api.odcloud.kr/api/nts-businessman/v1/validate?serviceKey={인증키}`
  - body: `{"businesses": [{b_no, start_dt, p_nm, ...}]}` (b_no/start_dt/p_nm 필수)
- **인증키는 `DATA_GO_KR_API_KEY` 재사용** — data.go.kr 계정 공용 키, 새 발급 불필요. 단 도메인이 `apis.data.go.kr`이 아니라 `api.odcloud.kr`이라 이전 STEP들과 요청 방식(GET→POST, 쿼리스트링→JSON body)이 다름.

**구현 시 반드시 반영할 것** (PLAN 문서 §5 시나리오 5에서 미리 정한 원칙):
- **캐시 금지** — 휴폐업 상태는 즉시성이 신뢰성에 직결, 실시간 재조회
- **사업자번호를 로그/사용량 카운터에 절대 남기지 않음** — `public_data_usage` 테이블은 카운트만 저장(기존 패턴 그대로 재사용 가능), 쿼리 내용 자체는 어디에도 기록 금지
- 활용신청 시 이용허락범위 먼저 확인(다른 STEP들과 마찬가지)

**작업 순서**: (1) data.go.kr에서 15081808 활용신청 → (2) `handleBizStatus` 함수를 `worker.js`에 추가(패턴은 `handleLawSearch` 참고, POST+JSON body 호출 방식만 다름) → (3) esbuild 번들 검증 필수(4장 교훈 1번) → (4) `git push` → 배포 확인 → (5) 라이브 테스트.

## 6. 다음 우선순위 (원 계획 §1)

STEP 3(K-Tax) 다음은 STEP 4(K-Health, 건강보험심사평가원 병원정보), STEP 5(K-Estate, 국토교통부 실거래가) 순.

## 7. 새 세션 시작 시 빠른 체크리스트

```powershell
# 1. 로컬 저장소 최신화
cd C:\Users\주피터\Downloads\gopang
git pull origin main

# 2. 현재 라이브 상태 확인
Invoke-RestMethod "https://hondi-proxy.tensor-city.workers.dev/public-data/law-search?q=테스트"

# 3. GitHub Actions 최근 배포 이력 확인
# https://github.com/Openhash-Gopang/gopang/actions
```

이 문서 + `PUBLIC-DATA-PORTAL-INTEGRATION-PLAN_v1_0.md` +
`POCKETBASE-STRUCTURE-GUIDE_v1_0.md` 세 개를 새 대화창 시작할 때
공유하면, 별도 설명 없이 바로 STEP 3부터 이어갈 수 있다.
