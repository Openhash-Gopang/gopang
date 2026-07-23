# gdc 저장소 wrangler 정적자산 배포 시 `.git` 폴더 전체 공개 노출 (2026-07-23)

`wrangler deploy`로 gdc 저장소를 Cloudflare Workers 정적 자산(assets)으로
처음 배포하는 과정에서, 업로드 로그에 `/.git/HEAD`, `/.git/objects/...`,
`/.git/logs/...` 등 **`.git` 폴더 전체가 공개 자산으로 함께 업로드**된
것을 발견하고 수정한 기록입니다.

## 1. 원인

`wrangler.jsonc`의 `assets.directory`를 저장소 루트(`.`)로 지정했는데,
**wrangler의 정적 자산 업로드는 기본적으로 `.gitignore`를 따르지
않습니다.** 그래서 `.git/objects/*`(전체 커밋 히스토리 blob)까지 그대로
공개 배포돼, `https://<worker>.workers.dev/.git/HEAD` 같은 경로로
누구나 저장소의 전체 git 히스토리를 재구성할 수 있는 상태가 됐습니다.

## 2. 발견 경위

배포 로그를 그대로 눈으로 확인(`+ /.git/HEAD`, `+ /.git/objects/e8/...`
등 341개 업로드 자산 중 다수)한 것으로 발견 — 별도 스캐너나 알림 없이
**배포 로그 자체를 검토하는 습관**으로 잡힌 사고입니다. 자동으로는
아무 경고도 뜨지 않았습니다.

## 3. 수정

저장소 루트에 `.assetsignore` 파일을 신설:

```
.git
.git/**
node_modules
node_modules/**
```

재배포 후 업로드 로그에 `.git` 관련 항목이 전부 사라진 것을 확인했고,
`https://gdc.tensor-city.workers.dev/.git/HEAD`를 직접 요청해 `404`
(더 이상 접근 불가)임을 확인했습니다.

## 4. 재발 방지 — 앞으로 정적 자산 배포를 새로 설정할 때

- `assets.directory`를 저장소 루트로 잡는 모든 wrangler 프로젝트는
  **첫 배포 전에 `.assetsignore`부터 만들 것.** `.gitignore`가 있다고
  안심하면 안 됩니다 — 이번 사고가 정확히 그 착각에서 나왔습니다.
- 배포 후에는 로그에서 `+ /.git`, `+ /node_modules`, `+ /.env` 같은
  항목이 없는지 매번 눈으로 확인할 것 — 자동 검증이 없는 한 이 습관이
  유일한 안전장치입니다.
- (참고) gopang 저장소는 순수 Worker 스크립트(`worker.js`) 배포라
  정적 자산 업로드 자체가 없어 이번과 같은 경로의 사고는 해당되지
  않습니다 — 하지만 향후 gopang도 정적 자산을 함께 배포하게 되면
  똑같이 `.assetsignore`부터 확인해야 합니다.
