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

## 5. 다음 단계

1. `phase_a_commands.sh` 결과를 공유해 주시면, hooksDir 메커니즘에 따라 Phase B 스크립트를 필요시 조정합니다.
2. Phase B 완료 후 정상/위조 거래 테스트 결과를 공유해 주세요.
3. 문제없으면 Phase C(자동화 워크플로우 + 신규 SSH 키 발급/등록)로 넘어갑니다.
