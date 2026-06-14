# deploy.ps1 — 고팡 배포 스크립트
# 사용법: .\deploy.ps1 "커밋 메시지"

param([string]$msg = "")

# 1. SW 캐시 버전 갱신
$date = Get-Date -Format "yyyyMMdd-HHmm"
(Get-Content "sw.js" -Raw) -replace "const CACHE_NAME\s+=\s+'gopang-[\w-]+'", "const CACHE_NAME    = 'gopang-$date'" |
Set-Content "sw.js" -NoNewline
Write-Host "✅ SW 캐시 버전: gopang-$date"

# 2. git add
git add -A

# 3. 커밋 메시지
if ($msg -eq "") { $msg = "deploy: $date" }
git commit -m $msg

# 4. push
git push
Write-Host "✅ 배포 완료: $msg"
