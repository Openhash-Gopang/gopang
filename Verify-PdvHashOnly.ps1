<#
.SYNOPSIS
  PDV 해시전용 재설계(PR #461) 배포 후 실사용 검증.

.DESCRIPTION
  4가지를 확인합니다:
  1. POST /pdv/report — content_hash 없이 보내면 400 CONTENT_HASH_REQUIRED
  2. POST /pdv/report — content_hash와 함께 보내면 200 (실제 저장값은
     PocketBase Admin UI에서 눈으로 확인 필요 — 이 스크립트는 응답 코드만 검증)
  3. POST /owner-pdv/report — what_hash 없이 보내면 400 SCHEMA_ERROR
  4. GET/POST /owner-pdv/self-history, /pdv/query — 둘 다 410 확인

.EXAMPLE
  .\Verify-PdvHashOnly.ps1 -ProxyBase "https://hondi-proxy.tensor-city.workers.dev"
#>

param(
    [string]$ProxyBase = "https://hondi-proxy.tensor-city.workers.dev",
    [string]$Origin    = "https://hondi.net"
)

function Get-Sha256Hex([string]$Text) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    $hash = $sha.ComputeHash($bytes)
    return ($hash | ForEach-Object { $_.ToString("x2") }) -join ""
}

$results = New-Object System.Collections.Generic.List[object]

function Invoke-Check {
    param([string]$Name, [string]$Path, [string]$Method, [hashtable]$Body, [int]$ExpectStatus, [string]$Origin = $Origin)
    $uri = "$ProxyBase$Path"
    $json = if ($Body) { $Body | ConvertTo-Json -Depth 8 } else { $null }
    try {
        if ($json) {
            Invoke-WebRequest -Uri $uri -Method $Method -Body $json -ContentType "application/json" `
                -Headers @{ "Origin" = $Origin } -ErrorAction Stop | Out-Null
        } else {
            Invoke-WebRequest -Uri $uri -Method $Method -Headers @{ "Origin" = $Origin } -ErrorAction Stop | Out-Null
        }
        $actual = 200
    } catch {
        $actual = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { -1 }
    }
    $status = if ($actual -eq $ExpectStatus) { "OK" } else { "FAIL" }
    $results.Add([pscustomobject]@{ name = $Name; expect = $ExpectStatus; actual = $actual; status = $status })
}

Write-Host "=== 1. content_hash 없이 /pdv/report → 400 기대 ===" -ForegroundColor Cyan
Invoke-Check -Name "pdv_report_no_hash" -Path "/pdv/report" -Method Post -ExpectStatus 400 -Body @{
    report = @{
        svc = "ktax"; type = "conversation_transcript"
        who = @{ ipv6 = "VERIFY-HASH-ONLY-TEST"; role = "user" }
        when = @{ period_start = (Get-Date).ToUniversalTime().ToString("o"); period_end = (Get-Date).ToUniversalTime().ToString("o") }
        where = @{ svc_url = "https://ktax.hondi.net" }
        # content_hash 의도적으로 누락
    }
} -Origin "https://ktax.hondi.net"

Write-Host "=== 2. content_hash와 함께 /pdv/report → 200 기대 ===" -ForegroundColor Cyan
$testHash = Get-Sha256Hex "hash-only-verify-$(Get-Date -Format o)"
Invoke-Check -Name "pdv_report_with_hash" -Path "/pdv/report" -Method Post -ExpectStatus 200 -Body @{
    report = @{
        svc = "ktax"; type = "conversation_transcript"
        who = @{ ipv6 = "VERIFY-HASH-ONLY-TEST"; role = "user" }
        when = @{ period_start = (Get-Date).ToUniversalTime().ToString("o"); period_end = (Get-Date).ToUniversalTime().ToString("o") }
        where = @{ svc_url = "https://ktax.hondi.net" }
        content_hash = $testHash
    }
} -Origin "https://ktax.hondi.net"
Write-Host "  (PocketBase pdv_records에서 guid=VERIFY-HASH-ONLY-TEST 레코드의" -ForegroundColor Yellow
Write-Host "   summary 필드가 정확히 다음 값인지 Admin UI에서 눈으로 확인하세요:" -ForegroundColor Yellow
Write-Host "   $testHash" -ForegroundColor Yellow

Write-Host "`n=== 3. what_hash 없이 /owner-pdv/report → 400 기대 ===" -ForegroundColor Cyan
Invoke-Check -Name "owner_pdv_no_hash" -Path "/owner-pdv/report" -Method Post -ExpectStatus 400 -Body @{
    record = @{
        record_type = "consultation"; owner_agency = "ktax"
        guid_for_hashing = "VERIFY-HASH-ONLY-TEST"; how = "completed"
        # what_hash 의도적으로 누락
    }
}

Write-Host "=== 4. what_hash와 함께 /owner-pdv/report → 200 기대 ===" -ForegroundColor Cyan
$testWhatHash = Get-Sha256Hex "owner-pdv-verify-$(Get-Date -Format o)"
Invoke-Check -Name "owner_pdv_with_hash" -Path "/owner-pdv/report" -Method Post -ExpectStatus 200 -Body @{
    record = @{
        record_type = "consultation"; owner_agency = "ktax"
        guid_for_hashing = "VERIFY-HASH-ONLY-TEST"; what_hash = $testWhatHash; how = "completed"
    }
}
Write-Host "  (PocketBase owner_pdv에서 방금 만든 레코드의 what 필드가" -ForegroundColor Yellow
Write-Host "   정확히 다음 값인지 Admin UI에서 눈으로 확인하세요:" -ForegroundColor Yellow
Write-Host "   $testWhatHash" -ForegroundColor Yellow

Write-Host "`n=== 5. /owner-pdv/self-history → 410 기대 ===" -ForegroundColor Cyan
Invoke-Check -Name "owner_self_history_410" -Path "/owner-pdv/self-history" -Method Post -ExpectStatus 410 -Body @{
    owner_agency = "ktax"; guid_for_hashing = "VERIFY-HASH-ONLY-TEST"
}

Write-Host "=== 6. /pdv/query → 410 기대 ===" -ForegroundColor Cyan
Invoke-Check -Name "pdv_query_410" -Path "/pdv/query" -Method Post -ExpectStatus 410 -Body @{
    guid = "VERIFY-HASH-ONLY-TEST"; scope = @("ktax")
}

Write-Host "`n=== 결과 요약 ===" -ForegroundColor Cyan
$results | Format-Table -AutoSize
$fails = $results | Where-Object { $_.status -eq "FAIL" }
if ($fails.Count -gt 0) {
    Write-Host "`n실패 $($fails.Count)건 — 배포가 아직 안 됐거나 예상과 다른 상태입니다." -ForegroundColor Red
    exit 1
} else {
    Write-Host "`n6건 모두 통과. 위에 안내된 두 해시 값을 PocketBase Admin UI에서 대조 확인해 주세요." -ForegroundColor Green
    exit 0
}
