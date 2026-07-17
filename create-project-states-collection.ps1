# create-project-states-collection.ps1
# 2026-07-17 신설 — mode=project(SP-19 K-Intent v1.2/SP-20 K-Compose
# v1.6/SP-22 K-Execute v1.1) human_action 일시정지 상태를 저장하는
# L1 PocketBase 컬렉션. 기존 create-pdv-merkle-anchors-collection.ps1과
# 동일 패턴(handlePdvReport가 pdv_records를 쓰는 것과 같은 L1 방식 —
# Supabase pdv_log는 쓰지 않는다, 그쪽은 이미 알려진 읽기/쓰기 경로
#불일치 문제가 있음, sql/pdv_domain_split.sql 주석 참조).
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
    $body = @{
        id = "prjstt0000001"; name = "project_states"; type = "base"
        schema = @(
            @{ system=$false; id="pst0000000001"; name="project_id";      type="text";   required=$true;  presentable=$true;  unique=$true;  options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="pst0000000002"; name="guid";            type="text";   required=$true;  presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="pst0000000003"; name="goal";            type="text";   required=$true;  presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="pst0000000004"; name="status";          type="text";   required=$true;  presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="pst0000000005"; name="paused_at_seq";   type="number"; required=$false; presentable=$false; unique=$false; options=@{ min=0; max=$null } }
            @{ system=$false; id="pst0000000006"; name="remaining_steps"; type="json";   required=$false; presentable=$false; unique=$false; options=@{} }
            @{ system=$false; id="pst0000000007"; name="fan_out_targets"; type="json";   required=$false; presentable=$false; unique=$false; options=@{} }
            @{ system=$false; id="pst0000000008"; name="results_so_far";  type="json";   required=$false; presentable=$false; unique=$false; options=@{} }
            @{ system=$false; id="pst0000000009"; name="human_action_desc"; type="text"; required=$false; presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
        )
        indexes = @(
            "CREATE UNIQUE INDEX idx_project_states_project_id ON project_states (project_id)",
            "CREATE INDEX idx_project_states_guid_status ON project_states (guid, status)"
        )
        listRule = $null; viewRule = $null; createRule = $null; updateRule = $null; deleteRule = $null
    } | ConvertTo-Json -Depth 10
    Invoke-RestMethod -Method POST -Uri "$base/api/collections" -Headers $headers -ContentType "application/json" -Body $body | Out-Null
    Write-Host "project_states 컬렉션 생성 완료."
}
