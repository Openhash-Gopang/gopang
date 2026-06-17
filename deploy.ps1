# deploy.ps1 - 고팡 배포 스크립트
# 사용법: .\deploy.ps1 "커밋 메시지"
#
# 사전 준비 (한 번만):
#   [System.Environment]::SetEnvironmentVariable('CF_API_TOKEN', '토큰', 'User')
#   [System.Environment]::SetEnvironmentVariable('CF_ZONE_ID', 'ZoneID', 'User')

param([string]$msg = "")

# 1. SW 캐시 버전 갱신
$date = Get-Date -Format "yyyyMMdd-HHmm"
$swContent = Get-Content "sw.js" -Raw
$swContent = $swContent -replace "const CACHE_NAME\s+=\s+'gopang-[\w-]+'", "const CACHE_NAME    = 'gopang-$date'"
Set-Content -Path "sw.js" -Value $swContent -NoNewline
Write-Host "SW 캐시 버전: gopang-$date"

# 2. git add
git add -A

# 3. 커밋 메시지
if ($msg -eq "") {
    $msg = "deploy: $date"
}
git commit -m $msg

# 4. push
git push
Write-Host "배포 완료: $msg"

# 5. Cloudflare 캐시 강제 퍼지 (sw.js)
Write-Host "--- Cloudflare 캐시 퍼지 시작 ---"

$cfToken = $env:CF_API_TOKEN
$cfZone = $env:CF_ZONE_ID

if ([string]::IsNullOrEmpty($cfToken)) {
    Write-Host "CF_API_TOKEN 환경변수가 없어 캐시 퍼지를 건너뜁니다."
}
elseif ([string]::IsNullOrEmpty($cfZone)) {
    Write-Host "CF_ZONE_ID 환경변수가 없어 캐시 퍼지를 건너뜁니다."
}
else {
    $purgeUrl = "https://api.cloudflare.com/client/v4/zones/" + $cfZone + "/purge_cache"
    $purgeHeaders = @{}
    $purgeHeaders["Authorization"] = "Bearer " + $cfToken
    $purgeHeaders["Content-Type"] = "application/json"
    $purgeFiles = @("https://gopang.net/sw.js", "https://www.gopang.net/sw.js")
    $purgeBodyObj = @{}
    $purgeBodyObj["files"] = $purgeFiles
    $purgeBody = $purgeBodyObj | ConvertTo-Json

    try {
        $resp = Invoke-RestMethod -Method POST -Uri $purgeUrl -Headers $purgeHeaders -Body $purgeBody
        if ($resp.success -eq $true) {
            Write-Host "Cloudflare 캐시 퍼지 완료: sw.js"
        }
        else {
            Write-Host "Cloudflare 캐시 퍼지 실패"
            $resp | ConvertTo-Json -Depth 5
        }
    }
    catch {
        Write-Host "Cloudflare 캐시 퍼지 요청 중 오류 발생"
        Write-Host $_.Exception.Message
    }
}

Write-Host "--- 배포 스크립트 종료 ---"
