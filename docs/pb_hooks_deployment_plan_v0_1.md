# pb_hooks 배포 워크플로우 — 현황 파악 및 계획 v0.1

작성일: 2026-07-18

## 1. 현재 상태 (확인 완료)

| 컴포넌트 | 배포 방식 | 상태 |
|---|---|---|
| `worker.js` | `deploy-worker.yml` — push 시 Cloudflare Wrangler 자동 배포 | ✅ 자동, 조치 불필요 |
| `profile.html`, `gopang-wallet.js` | GitHub Pages(`CNAME=hondi.net.`) — push 시 자동 게시 | ✅ 자동, 조치 불필요 |
| `pb_migrations/*.js` | `deploy-pb-migrations.yml` — SSH 강제커맨드로 hanlim에만 적용 | ✅ 있지만 pb_hooks와 무관한 별도 메커니즘 |
| **`pb_hooks/main.pb.js`** | **없음** | ❌ 자동 배포 파이프라인 전무 |

## 2. 인프라 사실 (`docs/POCKETBASE-STRUCTURE-GUIDE_v1_0.md` 기준, 2026-07-16 SSH 직접 확인)

- 외부에서 접근 가능한 PocketBase 인스턴스는 **hanlim 하나뿐**(나머지 48개는 `127.0.0.1` 바인딩).
- `worker.js`의 `L1_DEFAULT`가 hanlim만 가리키므로 **hanlim 하나만 고치면 실사용 트래픽엔 즉시 반영**됨.
- `pb_hooks/`는 "모든 인스턴스가 공유"라고만 문서화돼 있고, 정확한 `--hooksDir` 메커니즘·재시작 필요 여부는 **미확인(TBD)**.
- `/opt/gopang/pb`는 git 저장소 아님 — push해도 서버엔 안 옴(2026-07-16 실제 사고 원인).
- 기존 pb_migrations용 SSH 키는 강제 커맨드로 `apply-pb-migrations.sh`에만 제한돼 있어 재사용 불가.

## 3. 계획

### Phase A — 사전 확인 (사람이 SSH로 직접, 읽기 전용)
`phase_a_commands.sh` 실행 → hooksDir 플래그, 공유 방식, PocketBase 버전, 서버-저장소 드리프트 확인.

### Phase B — 1회성 안전 수동 배포 (자동화 완성 전 최초 1회)
`phase_b_commands.sh` 실행 → 백업 → 다운로드 → 최소 검증 → 교체 → 재시작 → 헬스체크(실패 시 자동 롤백) → 정상 거래 1건 + 위조 서명 1건 수동 테스트.

### Phase C — 향후 자동화 (이번에 git으로 커밋, 실행은 별도)
- `ops/apply-pb-hooks.sh` — GitHub Actions 강제 커맨드 전용 스크립트(백업/검증/재시작/자동롤백)
- `.github/workflows/deploy-pb-hooks.yml` — `pb_hooks/**` push 트리거, **신규 전용 SSH 키 필요**(`L1_HOOKS_SSH_PRIVATE_KEY` — 기존 pb_migrations 키와 절대 공유 금지)

## 4. 제가 할 수 없는 부분

이 환경은 `hondi.net`/SSH에 대한 네트워크 접근이 없습니다(egress 화이트리스트에 GitHub/npm/pypi만 허용). Phase A/B는 주피터님이 직접 SSH로 실행해야 합니다. Phase C는 코드로 커밋 가능하지만, 실제 동작하려면 서버에 `apply-pb-hooks.sh` 배치 + `authorized_keys`에 신규 강제커맨드 키 등록 + GitHub Secrets 설정이 별도로 필요합니다.

## 5. 2026-07-18 실전 배포 기록 (사고 및 교훈)

서명 검증 수정을 실제로 hanlim에 배포하며 겪은 일들을 기록한다. 다음
배포(및 Phase C 자동화 스크립트)에 전부 반영했다.

### 5-1. 백업 파일 위치 실수 — 첫 사고 원인

Phase B 초안 스크립트가 백업을 `pb_hooks/main.pb.js.bak-...`로 **감시
대상 디렉터리 안에** 만들었다. `--hooksWatch=true`(PocketBase 기본값,
서버에서 확인됨)가 `pb_hooks/` 전체를 감시하므로, 백업 파일 생성 자체가
재시작을 또 걸었다. 원래 배포(파일 교체)로 인한 정상 재시작과 겹치면서
부팅이 끝나지 못하는 상태가 이어졌다. → **교훈: 백업은 항상
`pb_hooks_backups/` 등 감시 대상 밖에 만들 것.**

### 5-2. `cp` 한 번에도 재시작이 중복 트리거된 정황 (미확증)

백업 위치를 고친 뒤에도, `cp`로 파일을 교체하고 성공적으로 기동한
직후(`Server started` 로그 확인됨) 곧바로 `File ... changed,
restarting...`가 다시 찍혀 두 번째 정체가 발생했다. 스크립트는 그 뒤로
파일을 건드리지 않았으므로, `cp` 한 번이 파일시스템 이벤트를 여러 개
발생시켜(open/write/close 등) fsnotify 기반 감시가 이를 복수의 변경으로
인식했을 가능성이 있다. **완전히 확증하지는 못했다** — Goja/fsnotify
내부 동작을 직접 코드로 확인하지 않은 추정이다. → 대응: 배포 스크립트는
`cp` 이후 어떤 이유로도 이 디렉터리에 다시 쓰기 작업을 하지 않도록
설계했고, 명시적 `systemctl restart`도 제거했다(자동 재시작과 중복
가능성 배제).

### 5-3. 근본 원인 — 메모리 956MB에 PocketBase 49개

이 서버는 Oracle Cloud **상시 무료(Always Free) 티어**의 마이크로 VM
스펙(메모리 1GB, 디스크 50GB)으로 운영되고 있다(웹 검색으로 스펙 일치
확인) — 30일 체험판이 "만료"된 게 아니라, 애초에 이 한도로 운영되고
있었던 것으로 보인다. 49개 PocketBase 인스턴스가 이 메모리를 나눠 쓰다
보니 hanlim 하나가 재부팅(마이그레이션 40여 개 파싱 +
`--hooksPool 25`개 Goja 런타임 프리워밍)할 때마다 스왑 압박이 걸렸고,
6-1/6-2의 재시작 중복과 겹치면서 **50분간 장애**로 번졌다.

**임시 완화**: 외부 트래픽을 받지 않는(hanlim만 `0.0.0.0` 공개, 나머지는
`127.0.0.1`) L1 42개를 배포 시점에 일시 정지해 메모리를 확보하는 방식을
현장에서 사용했다. 이후 배포는 메모리 여유가 충분한 상태에서 75초 만에
정상 완료됐다.

**근본 해결**: 혼디 앱 출시 시점에 Oracle 유료 업그레이드 예정(피터 확정
사항). 그 전까지는 pb_hooks 배포 시 아래 5-5 절차(또는 필요시 L1 임시
정지)를 따를 것. 참고로 Oracle Cloud Free Tier는 별도로 ARM Ampere A1
인스턴스를 상시 무료로 최대 24GB RAM까지 제공하는 옵션도 있어(계정
가용량에 따라), 유료 전환 없이 해결할 여지도 있다 — 확인 필요.

### 5-4. 배포 직후 콜드스타트 — 정상 현상으로 확인됨

배포 성공 후 실제 서명 검증 로직(SHA-512 + Ed25519 타원곡선 연산)이
처음 실행되는 요청들은 72~83초까지 걸렸다(3~5회 반복 관찰). 그 이후
요청은 1초 미만(대부분 0.01~0.1초)으로 안정화됐다. `--hooksPool 25`가
여러 개의 독립된 Goja 런타임을 유지하는데, 각 런타임이 이 코드를 처음
실행할 때 초기화 비용이 드는 것으로 추정된다. **버그가 아니라 배포
직후 일시적으로 감내해야 하는 정상 현상**으로 결론 내렸다 — 다만 배포
직후 곧바로 실거래가 몰리는 시점이라면 이 지연을 감안할 것.

### 5-5. 검증 완료 사항

- 위조 서명(`buyer_sig` 임의 문자열) → `TX_HASH_MISMATCH`로 정확히 차단 확인
- tx_hash 형식은 맞지만 재계산 불일치 → 동일하게 차단 확인
- 실제 Ed25519 키쌍으로 만든 유효 서명 → 정상 통과(`ok:true`) 확인
- 반복 요청 20회 중 콜드스타트 구간 이후 전부 1초 미만 확인
- `INVALID_SIGNATURE`(가짜 공개키/미등록 키) 경로는 기존 `UNREGISTERED_KEY`
  체크가 먼저 걸려 이번 세션에서 직접 트리거는 못 했음 — 다음 배포
  때 등록된 키 + 진짜로 다른 개인키로 서명한 케이스로 별도 확인 권장.



## 6. 다음 단계

1. ~~`phase_a_commands.sh` 결과 공유~~ — 완료 (2026-07-18)
2. ~~Phase B 완료 후 정상/위조 거래 테스트~~ — 완료 (2026-07-18, §5-5)
3. Phase C 자동화 워크플로우 실사용 준비: `ops/apply-pb-hooks.sh`를
   서버 `/opt/gopang/ops/`에 배치, 신규 SSH 키 발급 + `authorized_keys`
   강제커맨드 등록 + GitHub Secret(`L1_HOOKS_SSH_PRIVATE_KEY`) 등록
4. 정지해둔 L1 42개 인스턴스 — 필요 시점에 재기동(피터 확인 후 진행)
5. `INVALID_SIGNATURE`(등록된 키 + 다른 개인키로 위조한 서명) 경로는
   아직 직접 트리거해서 확인하지 못함 — 다음 배포 검증 때 포함 권장

