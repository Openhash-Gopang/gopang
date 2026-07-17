# create-project-states-collection.ps1
# 2026-07-17 신설 — mode=project(SP-19 K-Intent v1.2/SP-20 K-Compose
# v1.6/SP-22 K-Execute v1.1) human_action 일시정지 상태를 저장하는
# L1 PocketBase 컬렉션.
#
# [2026-07-17 수정 — 최초 버전 실행 실패 후 원인 확인:
#  (1) collection id가 13자였음 — PocketBase는 정확히 15자 요구.
#  (2) json 타입 필드는 options.maxSize가 필수인데 비어 있었음.
#  (3) $ErrorActionPreference를 안 정해서 Invoke-RestMethod가 실패해도
#      스크립트가 멈추지 않고 아래 성공 메시지까지 그대로 찍혔음 —
#      실제로는 컬렉션이 생성 안 된 채 "생성 완료"가 출력된 상태였다.
#      이번 수정: Stop으로 바꾸고 try/catch로 실패를 명확히 드러낸다.]
$ErrorActionPreference = 'Stop'
$base = "https://l1-hanlim.hondi.net"
$email    = Read-Host "PocketBase admin email"
$password = Read-Host "PocketBase admin password" -AsSecureString
$plainPw  = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
              [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password))
$authBody = @{ identity = $email; password = $plainPw } | ConvertTo-Json
$authRes  = Invoke-RestMethod -Method POST -Uri "$base/api/admins/auth-with-password" -ContentType "application/json" -Body $authBody
$token = $authRes.token
if (-not $token) { Write-Host "로그인 실패"; exit 1 }
$headers = @{ Authorization = $token }

$existing = $null
try { $existing = Invoke-RestMethod -Method GET -Uri "$base/api/collections/project_states" -Headers $headers -ErrorAction Stop } catch {}
if ($existing) {
    Write-Host "project_states 컬렉션이 이미 있습니다 — 건너뜁니다."
} else {
    # collection id는 정확히 15자여야 함(PocketBase 요구사항)
    $body = @{
        id = "prjsttcol000001"; name = "project_states"; type = "base"
        schema = @(
            @{ system=$false; id="pst0000000001"; name="project_id";      type="text";   required=$true;  presentable=$true;  unique=$true;  options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="pst0000000002"; name="guid";            type="text";   required=$true;  presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="pst0000000003"; name="goal";            type="text";   required=$true;  presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="pst0000000004"; name="status";          type="text";   required=$true;  presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="pst0000000005"; name="paused_at_seq";   type="number"; required=$false; presentable=$false; unique=$false; options=@{ min=0; max=$null } }
            @{ system=$false; id="pst0000000006"; name="remaining_steps"; type="json";   required=$false; presentable=$false; unique=$false; options=@{ maxSize=2000000 } }
            @{ system=$false; id="pst0000000007"; name="fan_out_targets"; type="json";   required=$false; presentable=$false; unique=$false; options=@{ maxSize=2000000 } }
            @{ system=$false; id="pst0000000008"; name="results_so_far";  type="json";   required=$false; presentable=$false; unique=$false; options=@{ maxSize=2000000 } }
            @{ system=$false; id="pst0000000009"; name="human_action_desc"; type="text"; required=$false; presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
        )
        indexes = @(
            "CREATE UNIQUE INDEX idx_project_states_project_id ON project_states (project_id)",
            "CREATE INDEX idx_project_states_guid_status ON project_states (guid, status)"
        )
        listRule = $null; viewRule = $null; createRule = $null; updateRule = $null; deleteRule = $null
    } | ConvertTo-Json -Depth 10

    try {
        Invoke-RestMethod -Method POST -Uri "$base/api/collections" -Headers $headers -ContentType "application/json" -Body $body -ErrorAction Stop | Out-Null
        Write-Host "✅ project_states 컬렉션 생성 완료."
    } catch {
        Write-Host "❌ 컬렉션 생성 실패:"
        Write-Host $_.ErrorDetails.Message
        exit 1
    }
}

# 생성 확인 — 실제로 조회되는지 재확인(이전처럼 실패를 성공으로 오인하지 않기 위함)
try {
    $verify = Invoke-RestMethod -Method GET -Uri "$base/api/collections/project_states" -Headers $headers -ErrorAction Stop
    Write-Host "확인됨 — 필드 수: $($verify.schema.Count)"
} catch {
    Write-Host "❌ 생성 확인 실패 — 컬렉션이 실제로 없을 수 있습니다:"
    Write-Host $_.ErrorDetails.Message
    exit 1
}
