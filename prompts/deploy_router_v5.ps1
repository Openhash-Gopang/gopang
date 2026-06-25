# SP-00-ROUTER 통합 배포 스크립트
# 구버전 5개 삭제 + v5.0 신규 배포 + LATEST 포인터 갱신

$PROMPTS = "C:\Users\주피터\Downloads\gopang\prompts"

# 1. 구버전 삭제
$OLD = @(
    "SP-00-ROUTER-v3.0.txt",
    "SP-00-ROUTER-v3.1.txt",
    "SP-00-ROUTER-v3_2.txt",
    "SP-00-ROUTER-v4_0.txt",
    "SP-00-ROUTER-v4_1.txt"
)
foreach ($f in $OLD) {
    $p = Join-Path $PROMPTS $f
    if (Test-Path $p) { Remove-Item $p -Force; Write-Host "Deleted: $f" }
    else { Write-Host "Not found (skip): $f" }
}

# 2. v5.0 복사
Copy-Item "SP-00-ROUTER-v5_0.txt" -Destination $PROMPTS -Force
Write-Host "Deployed: SP-00-ROUTER-v5_0.txt"

# 3. LATEST 포인터 갱신
"SP-00-ROUTER-v5_0.txt" | Set-Content -Path (Join-Path $PROMPTS "SP-00-ROUTER-LATEST.txt") -Encoding UTF8
Write-Host "Updated: SP-00-ROUTER-LATEST.txt -> SP-00-ROUTER-v5_0.txt"

Write-Host "`nDone. Remaining router files:"
Get-ChildItem $PROMPTS -Filter "SP-00-ROUTER*" | Select-Object Name
