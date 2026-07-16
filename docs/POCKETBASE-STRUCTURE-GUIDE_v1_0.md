# PocketBase 구조 & 지침 (L1-hanlim 인프라)

```
문서 코드: POCKETBASE-STRUCTURE-GUIDE
버전: v1.0
작성일: 2026-07-16
근거: 이 문서의 모든 내용은 2026-07-16 세션에서 SSH로 직접 서버에
      접속해 확인한 사실이다. 추측이나 문서만 보고 적은 내용은 없다.
      "PocketBase는 보통 이렇다"가 아니라 "이 서버는 실제로 이렇다"를
      기록한다.
```

## 0. 이 문서를 왜 읽어야 하는가

2026-07-16 하루 동안 `public_data_usage` 컬렉션 하나를 배포하려다가 서비스
크래시 루프, 502 다운타임, GitHub Actions 3연속 실패를 겪었다. 원인은 전부
"PocketBase/이 서버의 실제 동작 방식을 몰라서 생긴 것"이었다. 이 문서는
그 시행착오를 다음 사람(사람이든 AI든)이 반복하지 않게 하기 위해 쓴다.

## 1. 인프라 전체 지도

**서버 1대(Oracle Cloud, hostname `l1-hanlim`)에 PocketBase 인스턴스가
43개(L1 노드) + 5개(L2/L3/L4/L5) + 1개(hanlim 자체) = 총 49개** 개별
systemd 서비스로 떠 있다. 전부 같은 바이너리(`/opt/gopang/pocketbase`)를
쓰지만 데이터 디렉토리(`--dir`)와 포트가 전부 다르다.

| 계층 | 서비스명 패턴 | 데이터 경로 | 예시 |
|---|---|---|---|
| hanlim(공개 게이트웨이) | `gopang-pb-hanlim.service` | `pb/hanlim` | 포트 8091, `0.0.0.0` 바인딩(유일하게 외부 공개) |
| L1(읍면동 43개) | `gopang-pb-l1-{동명}.service` | `pb/l1-{동명}` | `l1-aewol`, `l1-jocheon` 등, 포트 8101~8142대 |
| L2(시) | `gopang-pb-l2-{시명}.service` | `pb/l2-{시명}` | `l2-jeju`(8092), `l2-seogwipo`(8093) |
| L3(도) | `gopang-pb-l3-jejudo.service` | `pb/l3-jejudo` | 포트 8094 |
| L4(국가) | `gopang-pb-l4-kr.service` | `pb/l4-kr` | 포트 8095 |
| L5(글로벌) | `gopang-pb-l5-global.service` | `pb/l5-global` | 포트 8096 |

**전부 `127.0.0.1`에만 바인딩된 내부 인스턴스이고, hanlim만
`0.0.0.0:8091`로 공개돼 있다** (`.service.d/override.conf`에서
`--http=0.0.0.0:8091`로 덮어씀). 즉 외부(Cloudflare Worker 포함)에서
직접 접근 가능한 건 hanlim 하나뿐이다.

### 1-1. Cloudflare Worker가 실제로 쓰는 인스턴스

`worker.js`의 `const L1_DEFAULT = 'https://l1-hanlim.hondi.net';` —
**Worker가 부르는 PocketBase는 hanlim 하나뿐이다.** 나머지 48개는
게이트웨이(hanlim)가 내부적으로 라우팅하는 대상이거나, 각 지역 SP가
자체적으로 참조하는 로컬 저장소로 추정된다(이 부분은 미확인 —
GDC/L1-L3 계층 라우팅 로직을 직접 읽어보지 않고서는 단정할 수 없다).

**→ 결론: 공용 카운터/설정류 컬렉션(오늘 만든 `public_data_usage`
같은 것)은 hanlim 하나에만 적용하면 된다. 43개 L1 노드 전체에
반복 적용할 필요 없다.**

## 2. `/opt/gopang` 디렉토리 구조

```
/opt/gopang/
├── pocketbase              ← 바이너리 (버전 0.22.14, 2026-07-16 확인)
├── pb_hooks/                ← 모든 인스턴스가 공유하는 JS 훅
├── pb/
│   ├── pb_migrations/       ← ★ 마이그레이션 파일 저장 위치 (아래 3장 참고)
│   ├── hanlim/               ← hanlim 인스턴스 데이터 (data.db 등)
│   ├── l1-aewol/
│   ├── l1-jocheon/
│   └── ... (L1~L5 전체, 49개 폴더)
├── logs/
│   ├── hanlim.log
│   ├── hanlim_err.log       ← ★ panic/에러는 전부 여기로 감
│   └── ...
├── ops/
│   └── apply-pb-migrations.sh   ← GitHub Actions 강제 커맨드 스크립트
├── gopang.env                ← systemd EnvironmentFile (전화인증 시크릿 등)
└── pb_migrations_quarantine/  ← 임시 격리 폴더(사고 대응용, 상시 존재 안 함)
```

**★★★ 가장 중요한 사실: `/opt/gopang/pb`는 git 저장소가 아니다.**
`git remote -v`를 쳐보면 `fatal: not a git repository`가 뜬다. 즉
**GitHub main에 파일을 push해도 이 서버엔 저절로 안 온다.** 로컬
PowerShell에서 `git push`만 하고 끝냈다고 착각하면 100% 사고 난다
(2026-07-16 실제 사고 원인).

## 3. 마이그레이션 시스템 — 알아야 할 것들

### 3-1. `--migrationsDir`을 반드시 명시하라

hanlim의 systemd 유닛(`ExecStart`)엔 `--migrationsDir` 플래그가 없다.
PocketBase 기본값에 의존하지 말 것 — **항상 명시적으로
`--migrationsDir=pb/pb_migrations`를 붙여라.** (`--dir=pb/hanlim`과는
다른 값이다 — 헷갈리기 쉽다. `--dir`은 DB 데이터, `--migrationsDir`은
마이그레이션 JS 파일 위치.)

```bash
./pocketbase migrate up --dir=pb/hanlim --migrationsDir=pb/pb_migrations
```

### 3-2. PocketBase는 `serve` 실행 시(★automigrate 여부와 무관하게★)
### 모든 마이그레이션 JS 파일을 즉시 파싱해서 등록한다

`--automigrate=false`를 줘도 소용없다. 부팅 시점에
`jsvm.MustRegister`가 `pb_migrations/` 안의 **모든** `.js` 파일을
JS VM에 로드하려 시도하고, 그중 **단 하나라도 문법 오류가 있으면
`panic`으로 전체 서비스가 죽는다.** `automigrate`는 "로드된 마이그레이션을
자동으로 실행할지"만 결정하지, "로드 자체를 할지"는 결정하지 않는다.

**교훈: 마이그레이션 파일을 서버에 놓기 전에 반드시 내용을 검증하라.**
`grep -q "migrate("` 정도의 최소 검증이라도 거치지 않은 파일을
`pb_migrations/`에 절대 넣지 말 것. (`ops/apply-pb-migrations.sh`가
이걸 자동으로 한다 — 6장 참고.)

### 3-3. `_migrations` 이력 테이블과 실제 DB 스키마가 어긋날 수 있다

`_migrations` 테이블(`file`, `applied` 두 컬럼, `applied`는
**마이크로초** 단위 유닉스 타임스탬프)엔 "이 파일을 실행했다"는
기록만 있고, 실제 DB 스키마 상태와 별개로 관리된다. 만약 컬렉션이나
필드가 **다른 경로로**(수동 SQL, 이전 버전 마이그레이션 등) 이미
생겼는데 `_migrations`엔 기록이 안 남아있으면, `migrate up`을 돌릴
때마다 다음 종류의 에러가 반복된다:

- `constraint failed: UNIQUE constraint failed: _collections.name` (컬렉션명 중복)
- `duplicate column name: xxx` (컬럼 중복)
- `index xxx already exists` (인덱스 중복)

**이건 진짜 문제가 아니라 "이력 누락"일 가능성이 크다.** 확인 후
안전하면 이력에 강제로 기록하고 넘어가면 된다:

```bash
sqlite3 pb/hanlim/data.db \
  "INSERT OR IGNORE INTO _migrations (file, applied) VALUES ('{파일명}.js', $(date +%s)000000);"
```

**단, 반드시 먼저 확인**: 해당 컬렉션/필드가 진짜 이미 존재하고
마이그레이션이 하려던 것과 일치하는지 (`sqlite3 ... "PRAGMA table_info(테이블명);"`,
`SELECT id,name FROM _collections WHERE ...`). 확인 없이 무작정
이력만 채우면 실제로 필요한 스키마 변경이 누락된 채 "적용됨"으로
거짓 기록될 위험이 있다.

2026-07-16 세션에서 32개 파일이 한꺼번에 이 상태였다 — 오랫동안
누적된 문제였다는 뜻. 정기적으로 (예: 월 1회) `migrate up`을 그냥
한번 돌려보고 이런 드리프트가 없는지 점검하는 걸 권한다.

### 3-4. systemd drop-in(.conf) 파일은 알파벳 순으로 적용된다

`/etc/systemd/system/gopang-pb-hanlim.service.d/`에 여러 `.conf`
파일이 있으면, **파일명 알파벳 순으로 마지막 것이 이긴다.**
`no-automigrate.conf`가 `override.conf`보다 알파벳상 먼저 오면
`override.conf`가 그걸 덮어써버린다. 새 drop-in을 추가할 때 반드시
`systemctl cat {서비스명}`으로 최종 `ExecStart`가 의도한 대로
합쳐졌는지 확인할 것. 확실하게 마지막에 적용되게 하려면 `zz-` 같은
접두어를 쓴다.

## 4. 배포 파이프라인 (2026-07-16 구축)

### 4-1. 구조

```
로컬(PowerShell) git push (pb_migrations/*.js 포함)
  → GitHub Actions: deploy-pb-migrations.yml 트리거
    (push 시 자동, 또는 workflow_dispatch 수동)
  → 이번 커밋에서 실제로 바뀐 pb_migrations/*.js 파일명만 추출
    (git diff, 전체 폴더 아님 — 3-5 참고)
  → SSH_ORIGINAL_COMMAND로 그 파일명 목록만 서버에 전달
    (authorized_keys의 command= 강제 커맨드가 자동 실행됨)
  → /opt/gopang/ops/apply-pb-migrations.sh:
      1) 파일명마다 raw.githubusercontent.com에서 개별 다운로드
      2) 내용에 "migrate(" 문자열 있는지 검증 (없으면 즉시 중단)
      3) 검증 통과분만 pb/pb_migrations/에 저장
      4) migrate up 실행
      5) gopang-pb-hanlim.service 재시작 + health check
```

### 4-2. 왜 이렇게 설계했는가 (실패했던 방식들)

- **처음엔 GitHub 전체를 codeload tarball로 받아 `pb_migrations/`
  폴더 전체를 덮어쓰는 방식**이었다 → 이 저장소에서 동시에 진행
  중이던 다른(우리와 무관한) 미완성 마이그레이션까지 같이 끌려와서
  서비스 크래시 → 502 다운타임 발생(2026-07-16).
- **rsync로 파일 전송 + SSH로 스크립트 실행, 2단계**로도 시도했다 →
  강제 커맨드(`command=`)는 그 키로 맺는 **모든** SSH 세션에
  적용되기 때문에, rsync 내부 SSH 세션까지 하이재킹당해 rsync
  자체가 작동 불가능했다.
- **최종 방식(위 4-1)**: SSH 접속 1번만 필요하고(강제 커맨드와
  호환), "변경된 파일만" 정확히 골라서(다른 작업 오염 방지),
  받은 내용을 검증 후에만 저장(깨진 파일 사고 방지) — 세 문제를
  전부 해결한다.

### 4-3. 필요한 GitHub Secrets

| Secret | 용도 |
|---|---|
| `L1_SSH_PRIVATE_KEY` | 전용 배포키(ed25519) — 개인용 키와 별도, CI 전용 |
| `L1_SSH_HOST` | `l1-hanlim.hondi.net` |
| `L1_SSH_USER` | `ubuntu` |

이 키는 서버 `~/.ssh/authorized_keys`에 다음처럼 **강제 커맨드로
제한**돼 있다 — 이 키로는 `apply-pb-migrations.sh` 외에 어떤 명령도
실행할 수 없다:

```
command="/opt/gopang/ops/apply-pb-migrations.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA... github-actions-pb-migrations-deploy
```

### 4-4. GitHub 워크플로우 파일 수정 시 주의

**GitHub는 fine-grained PAT로 `.github/workflows/*` 파일을 수정하려면
별도의 `workflow` 권한이 명시적으로 있어야 한다** (Contents/Actions
권한과 별개). 이 권한 없는 토큰으로 API PUT을 시도하면 403이 뜬다 —
이 경우 로컬 `git push`(사람 계정, 이미 권한 있음)로 해야 한다.

### 4-5. 로그 확인 시 주의 — 내 환경 한계

GitHub Actions 로그 원문은 Azure Blob Storage의 presigned URL로
리다이렉트되는데, 이 URL(`*.blob.core.windows.net`)은 샌드박스 egress
허용 목록에 없어서 직접 못 읽는다. `check-runs/{id}/annotations`
API로 요약된 에러 메시지("Process completed with exit code N" 등)는
읽을 수 있다 — 이걸로 1차 진단하고, 필요하면 서버에서 같은 명령을
직접 재현(`ssh -i {키} user@127.0.0.1`)하는 게 가장 빠르다.

## 5. 표준 운영 절차 (Runbook)

### 5-1. 새 마이그레이션 배포하는 법 (일반적인 경우)

1. 로컬에서 `pb_migrations/{timestamp}_{설명}.js` 작성
2. `git add pb_migrations/{파일명} && git commit && git push`
3. GitHub Actions("Deploy PB Migrations to L1 (hanlim)")가 자동
   트리거됨 — Actions 탭에서 성공(초록 체크) 확인
4. 필요시 서버에서 직접 확인:
   ```bash
   sqlite3 /opt/gopang/pb/hanlim/data.db "SELECT file FROM _migrations WHERE file='{파일명}';"
   curl -sf http://127.0.0.1:8091/api/health
   ```

### 5-2. 서비스가 죽었을 때 (크래시 루프 등)

```bash
# 1. 상태 확인
sudo systemctl status gopang-pb-hanlim.service --no-pager -l
tail -30 /opt/gopang/logs/hanlim_err.log

# 2. panic 원인이 특정 마이그레이션 파일이면(SyntaxError 등),
#    그 파일부터 격리
mkdir -p /opt/gopang/pb_migrations_quarantine
mv /opt/gopang/pb/pb_migrations/{문제파일}.js /opt/gopang/pb_migrations_quarantine/

# 3. 재시작
sudo systemctl restart gopang-pb-hanlim.service
sleep 2
systemctl is-active gopang-pb-hanlim.service
curl -sf http://127.0.0.1:8091/api/health
```

격리한 파일은 **삭제하지 말고 보관** — 나중에 내용을 고쳐서
다시 넣거나, 원 작성자가 검토할 수 있게.

### 5-3. "이미 존재함" 계열 마이그레이션 충돌 일괄 정리

```bash
cd /opt/gopang
for i in $(seq 1 40); do
  OUT=$(./pocketbase migrate up --dir=pb/hanlim --migrationsDir=pb/pb_migrations 2>&1)
  echo "$OUT"
  if echo "$OUT" | grep -q "^Applied\|No new migrations" && ! echo "$OUT" | grep -q "^Error"; then
    echo "=== 완료 ==="; break
  fi
  FAILED_FILE=$(echo "$OUT" | sed -n 's/.*Failed to apply migration \([^:]*\)\.js:.*/\1/p' | head -1)
  if echo "$OUT" | grep -qE "UNIQUE constraint failed: _collections\.name|duplicate column name|already exists" && [ -n "$FAILED_FILE" ]; then
    sqlite3 pb/hanlim/data.db "INSERT OR IGNORE INTO _migrations (file, applied) VALUES ('${FAILED_FILE}.js', $(date +%s)000000);"
  else
    echo "=== 자동 처리 불가 — 수동 확인 필요 ==="; break
  fi
done
```

**주의**: 이 루프는 "이미 존재함" 패턴만 자동으로 건너뛴다. 다른
종류의 에러(진짜 버그가 있는 마이그레이션)에서는 멈추도록 설계돼
있다 — 멈추면 그 에러 메시지를 읽고 수동으로 판단할 것.

### 5-4. 격리된 파일을 다시 적용해도 되는지 판단하는 법

1. 파일 내용을 읽고 어떤 컬렉션/필드를 건드리는지 확인
2. `grep -rn "{필드명 또는 값}" worker.js src/` 로 **이미 배포된
   애플리케이션 코드가 이 스키마를 전제로 짜여 있는지** 확인 —
   있으면 이건 "미완성 작업"이 아니라 "적용을 놓친 완성된 작업"이다
3. `sqlite3 ... "SELECT id, name FROM _collections WHERE id='...'"`,
   `PRAGMA table_info(...)`로 대상 컬렉션/필드가 실제로 있는지,
   마이그레이션이 추가하려는 게 이미 있는 건 아닌지 확인
4. 안전 확인되면 `pb_migrations/`로 복귀시키고 `migrate up`

## 6. 핵심 파일 위치 요약표

| 파일 | 경로 | 용도 |
|---|---|---|
| PocketBase 바이너리 | `/opt/gopang/pocketbase` | v0.22.14 |
| 마이그레이션 파일들 | `/opt/gopang/pb/pb_migrations/` | git 저장소 아님(2장 참고) |
| hanlim DB | `/opt/gopang/pb/hanlim/data.db` | Worker가 실제로 쓰는 유일한 인스턴스 |
| hanlim 에러 로그 | `/opt/gopang/logs/hanlim_err.log` | panic 원인 확인용 |
| 배포 강제 스크립트 | `/opt/gopang/ops/apply-pb-migrations.sh` | GitHub Actions 전용, 직접 실행도 가능 |
| systemd 유닛 | `/etc/systemd/system/gopang-pb-hanlim.service` | + `.service.d/*.conf` drop-in들 |
| GitHub 워크플로우 | `.github/workflows/deploy-pb-migrations.yml` | push(pb_migrations/**) 또는 수동 트리거 |

## 7. 아직 확인 안 된 것 (TBD — 다음에 확인 필요)

- 43개 L1 노드와 L2~L5 인스턴스들의 `--migrationsDir`이 hanlim과
  같은 `pb/pb_migrations`를 공유하는지, 아니면 각자 다른 규칙인지
  미확인. 이번 사고 대응은 hanlim에만 집중했음 — 다른 인스턴스에도
  같은 마이그레이션이 필요한지는 GDC 라우팅 구조를 더 봐야 안다.
- L1~L5 계층 간 데이터가 어떻게 동기화/브릿지되는지(GDC cross-L1
  bridge 관련 기존 작업과의 관계)는 이 세션에서 다루지 않았다.
