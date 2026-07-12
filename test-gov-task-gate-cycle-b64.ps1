# test-gov-task-gate-cycle.ps1 (Base64-only version, pure ASCII except BOM)
# Verifies the full unregistered-agency draft -> approval -> submit cycle
# against the deployed worker. All Korean text is Base64-encoded to avoid
# Windows PowerShell 5.1 codepage misreading (confirmed root cause, 2026-07-12).

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
function _b64d($s) { [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s)) }

$agencyNameB64 = "7Jes7ISx6rCA7KGx67aA"
$taskNameB64 = "7ZWc67aA66qo6rCA7KGx7KeA7JuQIOuMgOyDgeyekCDrk7HroZ0="
$legalBasisB64 = "7ZWc67aA66qo6rCA7KGx7KeA7JuQ67KVIOygnDXsobA="
$doc1NameB64 = "7ZWc67aA66qo6rCA7KGx7KeA7JuQIOyLoOyyreyEnA=="
$doc2NameB64 = "7KO866+865Ox66Gd65Ox67O4"
$doc3NameB64 = "7IaM65OdIOymneu5meyekOujjA=="
$doc4NameB64 = "6rCA7KGx6rSA6rOE7Kad66qF7ISc"
$step1B64 = "YG49PT0gU1RFUCAxOiBSZXF1ZXN0ZXIgQSAtIGNyZWF0ZSBkcmFmdCAodW5yZWdpc3RlcmVkIGFnZW5jeSwgZnJlc2ggcmVzZWFyY2gpID09PQ=="
$step2B64 = "YG49PT0gU1RFUCAyOiBSZXF1ZXN0ZXIgQiAoZGlmZmVyZW50IGd1aWQpIC0gbXVzdCBOT1Qgc2VlIEEncyBkcmFmdCA9PT0="
$step2FailB64 = "RkFJTCAtIGlzb2xhdGlvbiBicm9rZW46IEIgcmV1c2VkIEFzIGRyYWZ0IGFzLWlzLiBDaGVjayB0aGUgZ3VpZCBmaWx0ZXIgaW4gX3Jlc29sdmVEb2NTY2hlbWEu"
$step2OkB64 = "T0sgLSBpc29sYXRpb24gd29ya3M6IEIgY3JlYXRlZCBhIHNlcGFyYXRlIGRyYWZ0"
$step3B64 = "YG49PT0gU1RFUCAzOiBBZG1pbiAtIGxpc3QgcGVuZGluZyBkcmFmdHMgPT09"
$step4B64 = "YG49PT0gU1RFUCA0OiBBZG1pbiAtIGFwcHJvdmUgb25seSBBJ3MgZHJhZnQgPT09"
$step5B64 = "YG49PT0gU1RFUCA1OiBSZXF1ZXN0ZXIgQyAodGhpcmQgcGFydHksIHNob3VsZCBub3QgaGF2ZSBzZWVuIGl0IHByZS1hcHByb3ZhbCkgLSBzaG91bGQgc2VlIGl0IGltbWVkaWF0ZWx5IHBvc3QtYXBwcm92YWwgPT09"
$step6B64 = "YG49PT0gU1RFUCA2OiBDIHN1Ym1pdHMgMy80IGRvY3VtZW50cyAtIGV4cGVjdCBwZW5kaW5nX2RvY3VtZW50cyA9PT0="
$step7B64 = "YG49PT0gU1RFUCA3OiBDIHN1Ym1pdHMgdGhlIGxhc3QgZG9jdW1lbnQgLSBleHBlY3QgYWNjZXB0ZWQgKyBkaXNjbGFpbWVyID09PQ=="
$summaryB64 = "YG49PT0gQ2hlY2tsaXN0IHN1bW1hcnkgPT09"
$chk1B64 = "WyBdIFNURVAxIGRyYWZ0X2lkIGlzc3VlZA=="
$chk2B64 = "WyBdIFNURVAyIEEgYW5kIEIgZHJhZnRfaWQgZGlmZmVyIChpc29sYXRpb24p"
$chk3B64 = "WyBdIFNURVA0IGFwcHJvdmFsIHN1Y2NlZWRlZCAoc3RhdHVzPWFjdGl2ZSk="
$chk4B64 = "WyBdIFNURVA1IEMgZ290IHJldXNlZD10cnVlIGltbWVkaWF0ZWx5"
$chk5B64 = "WyBdIFNURVA2IDMvNCBzdWJtaXQgLT4gcGVuZGluZ19kb2N1bWVudHMgKyBjb3JyZWN0IG1pc3NpbmcgbGlzdA=="
$chk6B64 = "WyBdIFNURVA3IDQvNCBzdWJtaXQgLT4gYWNjZXB0ZWQgKyByZWNlaXB0X25vICsgZGlzY2xhaW1lciB0ZXh0IHByZXNlbnQ="

$agencyName = _b64d $agencyNameB64
$taskName = _b64d $taskNameB64
$legalBasis = _b64d $legalBasisB64
$doc1Name = _b64d $doc1NameB64
$doc2Name = _b64d $doc2NameB64
$doc3Name = _b64d $doc3NameB64
$doc4Name = _b64d $doc4NameB64
$step1 = _b64d $step1B64
$step2 = _b64d $step2B64
$step2Fail = _b64d $step2FailB64
$step2Ok = _b64d $step2OkB64
$step3 = _b64d $step3B64
$step4 = _b64d $step4B64
$step5 = _b64d $step5B64
$step6 = _b64d $step6B64
$step7 = _b64d $step7B64
$summary = _b64d $summaryB64
$chk1 = _b64d $chk1B64
$chk2 = _b64d $chk2B64
$chk3 = _b64d $chk3B64
$chk4 = _b64d $chk4B64
$chk5 = _b64d $chk5B64
$chk6 = _b64d $chk6B64

$WORKER_URL  = "https://hondi-proxy.tensor-city.workers.dev"
$ADMIN_TOKEN = Read-Host "Admin bearer token (from /admin/login)"

$draftBody = @{
  guid         = "test-guid-requester-A"
  agency       = "mogef"
  task_key     = "single_parent_support_registration"
  agency_name  = $agencyName
  task_name    = $taskName
  legal_basis  = $legalBasis
  documents    = @(
    @{ id = "app_form";      name = $doc1Name; required = $true;  acquisition = "user_authored" },
    @{ id = "resident_cert"; name = $doc2Name; required = $true;  acquisition = "gov24" },
    @{ id = "income_proof";  name = $doc3Name; required = $true;  acquisition = "user_authored" },
    @{ id = "family_cert";   name = $doc4Name; required = $true;  acquisition = "gov24" }
  )
  source_urls  = @("https://www.mogef.go.kr/sp/hmf/sp_hmf_f001.do")
} | ConvertTo-Json -Depth 5

Write-Host $step1
$r1 = Invoke-RestMethod -Uri "$WORKER_URL/gov/task/schema/draft" -Method Post -Body $draftBody -ContentType "application/json"
$r1 | ConvertTo-Json -Depth 5
# expected: ok=true, reused=false, verified=false, draft_id=<value>, warning present
$draftId = $r1.draft_id

Write-Host $step2
$draftBodyB = ($draftBody | ConvertFrom-Json)
$draftBodyB.guid = "test-guid-requester-B"
$r2 = Invoke-RestMethod -Uri "$WORKER_URL/gov/task/schema/draft" -Method Post -Body ($draftBodyB | ConvertTo-Json -Depth 5) -ContentType "application/json"
$r2 | ConvertTo-Json -Depth 5
if ($r2.draft_id -eq $draftId) {
  Write-Warning $step2Fail
} else {
  Write-Host "$step2Ok ($($r2.draft_id))"
}

Write-Host $step3
$headers = @{ Authorization = "Bearer $ADMIN_TOKEN" }
$r3 = Invoke-RestMethod -Uri "$WORKER_URL/admin/gov-task-drafts" -Headers $headers
$r3.items | Format-Table id, agency, task_key, status, created_by_guid, created

Write-Host $step4
$reviewBody = @{ draft_id = $draftId; decision = "approve" } | ConvertTo-Json
$r4 = Invoke-RestMethod -Uri "$WORKER_URL/admin/gov-task-drafts/review" -Method Post -Headers $headers -Body $reviewBody -ContentType "application/json"
$r4 | ConvertTo-Json
# expected: ok=true, status='active'

Write-Host $step5
$draftBodyC = ($draftBody | ConvertFrom-Json)
$draftBodyC.guid = "test-guid-requester-C"
$r5 = Invoke-RestMethod -Uri "$WORKER_URL/gov/task/schema/draft" -Method Post -Body ($draftBodyC | ConvertTo-Json -Depth 5) -ContentType "application/json"
$r5 | ConvertTo-Json -Depth 5
# expected: reused=true, verified=true

Write-Host $step6
$submitBody1 = @{
  guid     = "test-guid-requester-C"
  agency   = "mogef"
  task_key = "single_parent_support_registration"
  documents = @(
    @{ doc_id = "app_form";      sha256 = ("a" * 64) },
    @{ doc_id = "resident_cert"; sha256 = ("b" * 64) },
    @{ doc_id = "income_proof";  sha256 = ("c" * 64) }
  )
} | ConvertTo-Json -Depth 5
$r6 = Invoke-RestMethod -Uri "$WORKER_URL/gov/task/submit" -Method Post -Body $submitBody1 -ContentType "application/json"
$r6 | ConvertTo-Json -Depth 5
# expected: status='pending_documents', receipt_no=null, disclaimer=null, documents_missing has family_cert

Write-Host $step7
$submitBody2 = @{
  guid     = "test-guid-requester-C"
  agency   = "mogef"
  task_key = "single_parent_support_registration"
  documents = @(
    @{ doc_id = "app_form";      sha256 = ("a" * 64) },
    @{ doc_id = "resident_cert"; sha256 = ("b" * 64) },
    @{ doc_id = "income_proof";  sha256 = ("c" * 64) },
    @{ doc_id = "family_cert";   sha256 = ("d" * 64) }
  )
} | ConvertTo-Json -Depth 5
$r7 = Invoke-RestMethod -Uri "$WORKER_URL/gov/task/submit" -Method Post -Body $submitBody2 -ContentType "application/json"
$r7 | ConvertTo-Json -Depth 5
# expected: status='accepted', receipt_no='GOV-mogef-...', disclaimer mentions not official, schema_verified=true

Write-Host $summary
Write-Host $chk1
Write-Host $chk2
Write-Host $chk3
Write-Host $chk4
Write-Host $chk5
Write-Host $chk6
