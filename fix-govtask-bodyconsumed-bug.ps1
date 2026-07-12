# fix-govtask-bodyconsumed-bug.ps1
# Fixes two real bugs found via live testing (2026-07-12):
#  1. /admin/gov-task-drafts GET route was unreachable dead code
#     (placed after the blanket POST-only gate)
#  2. handleGovTaskSubmit/handleGovTaskSchemaDraft/handleGovTaskDraftReview
#     called request.json() after the router already drained the body
#     via bodyText = await request.text() -> always INVALID_JSON
# Base64-only (pure ASCII except BOM) - confirmed reliable method.

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
function _b64d($s) { [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s)) }
$path = ".\worker.js"
if (-not (Test-Path $path)) { throw "worker.js not found - run from repo root." }
$encRead  = [System.Text.Encoding]::UTF8
$encWrite = New-Object System.Text.UTF8Encoding($false)
$rawContent = [System.IO.File]::ReadAllText((Resolve-Path $path), $encRead)
$hadCRLF = $rawContent -match "`r`n"
$content = $rawContent -replace "`r`n", "`n"
$backupPath = ".\worker.js.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
Copy-Item $path $backupPath
Write-Host "Backup created: $backupPath"

$routeOldB64 = "ICAgIGlmIChwYXRobmFtZSA9PT0gJy9nb3YvcmVsYXknKSAgICAgICAgICAgICAgICByZXR1cm4gaGFuZGxlR292UmVsYXkoYm9keVRleHQsIGVudiwgY29yc0hlYWRlcnMsIF9tZXRhLCBjdHgpOwogICAgaWYgKHBhdGhuYW1lID09PSAnL2dvdi90YXNrL3N1Ym1pdCcpICAgICAgICAgIHJldHVybiBoYW5kbGVHb3ZUYXNrU3VibWl0KHJlcXVlc3QsIGVudiwgY29yc0hlYWRlcnMpOwogICAgaWYgKHBhdGhuYW1lID09PSAnL2dvdi90YXNrL3NjaGVtYS9kcmFmdCcpICAgIHJldHVybiBoYW5kbGVHb3ZUYXNrU2NoZW1hRHJhZnQocmVxdWVzdCwgZW52LCBjb3JzSGVhZGVycyk7CiAgICBpZiAocGF0aG5hbWUgPT09ICcvYWRtaW4vZ292LXRhc2stZHJhZnRzJyAmJiByZXF1ZXN0Lm1ldGhvZCA9PT0gJ0dFVCcpIHJldHVybiBoYW5kbGVHb3ZUYXNrRHJhZnRMaXN0KHJlcXVlc3QsIGVudiwgY29yc0hlYWRlcnMpOwogICAgaWYgKHBhdGhuYW1lID09PSAnL2FkbWluL2dvdi10YXNrLWRyYWZ0cy9yZXZpZXcnKSByZXR1cm4gaGFuZGxlR292VGFza0RyYWZ0UmV2aWV3KHJlcXVlc3QsIGVudiwgY29yc0hlYWRlcnMpOw=="
$routeNewB64 = "ICAgIGlmIChwYXRobmFtZSA9PT0gJy9nb3YvcmVsYXknKSAgICAgICAgICAgICAgICByZXR1cm4gaGFuZGxlR292UmVsYXkoYm9keVRleHQsIGVudiwgY29yc0hlYWRlcnMsIF9tZXRhLCBjdHgpOwogICAgaWYgKHBhdGhuYW1lID09PSAnL2dvdi90YXNrL3N1Ym1pdCcpICAgICAgICAgIHJldHVybiBoYW5kbGVHb3ZUYXNrU3VibWl0KGJvZHlUZXh0LCBlbnYsIGNvcnNIZWFkZXJzKTsKICAgIGlmIChwYXRobmFtZSA9PT0gJy9nb3YvdGFzay9zY2hlbWEvZHJhZnQnKSAgICByZXR1cm4gaGFuZGxlR292VGFza1NjaGVtYURyYWZ0KGJvZHlUZXh0LCBlbnYsIGNvcnNIZWFkZXJzKTsKICAgIGlmIChwYXRobmFtZSA9PT0gJy9hZG1pbi9nb3YtdGFzay1kcmFmdHMvcmV2aWV3JykgcmV0dXJuIGhhbmRsZUdvdlRhc2tEcmFmdFJldmlldyhyZXF1ZXN0LCBib2R5VGV4dCwgZW52LCBjb3JzSGVhZGVycyk7"
$getRouteOldB64 = "ICAgIC8vIEdFVCAvYWRtaW4vc3RhdHMg4oCUIOuMgOyLnOuztOuTnCDthrXqs4QgKEhNQUMg7J247KadLCBMMSBQb2NrZXRCYXNlIO2UhOuhneyLnCkKICAgIGlmIChwYXRobmFtZSA9PT0gJy9hZG1pbi9zdGF0cycgJiYgcmVxdWVzdC5tZXRob2QgPT09ICdHRVQnKQogICAgICByZXR1cm4gaGFuZGxlQWRtaW5TdGF0cyhyZXF1ZXN0LCBlbnYsIGNvcnNIZWFkZXJzKTs="
$getRouteNewB64 = "ICAgIC8vIEdFVCAvYWRtaW4vc3RhdHMg4oCUIOuMgOyLnOuztOuTnCDthrXqs4QgKEhNQUMg7J247KadLCBMMSBQb2NrZXRCYXNlIO2UhOuhneyLnCkKICAgIGlmIChwYXRobmFtZSA9PT0gJy9hZG1pbi9zdGF0cycgJiYgcmVxdWVzdC5tZXRob2QgPT09ICdHRVQnKQogICAgICByZXR1cm4gaGFuZGxlQWRtaW5TdGF0cyhyZXF1ZXN0LCBlbnYsIGNvcnNIZWFkZXJzKTsKCiAgICAvLyBHRVQgL2FkbWluL2dvdi10YXNrLWRyYWZ0cyDigJQg64yA6riw7KSRIEdPVl9UQVNLIGRyYWZ0IOuqqeuhnSAoMjAyNi0wNy0xMiDsnITsuZgg7KCV7KCVCiAgICAvLyDigJQg6riw7KG07JeUIFBPU1Qg7KCE7JqpIOqyjOydtO2KuCDrkqTsl5Ag7J6I7Ja07IScIEdFVCDsmpTssq3snbQg6re4IOqyjOydtO2KuOyXkOyEnCDrqLzsoIAKICAgIC8vIDQwNeuhnCDrp4ntnojripQg7KO97J2AIOy9lOuTnOyYgOuLpC4gYWRtaW4vc3RhdHPsmYAg64+Z7J287ZWY6rKMIOqyjOydtO2KuCDslZ7snLzroZwg7J2064+ZKQogICAgaWYgKHBhdGhuYW1lID09PSAnL2FkbWluL2dvdi10YXNrLWRyYWZ0cycgJiYgcmVxdWVzdC5tZXRob2QgPT09ICdHRVQnKQogICAgICByZXR1cm4gaGFuZGxlR292VGFza0RyYWZ0TGlzdChyZXF1ZXN0LCBlbnYsIGNvcnNIZWFkZXJzKTs="
$schemaOldB64 = "YXN5bmMgZnVuY3Rpb24gaGFuZGxlR292VGFza1NjaGVtYURyYWZ0KHJlcXVlc3QsIGVudiwgY29yc0hlYWRlcnMpIHsKICBpZiAocmVxdWVzdC5tZXRob2QgIT09ICdQT1NUJykgcmV0dXJuIG5ldyBSZXNwb25zZSgnTWV0aG9kIE5vdCBBbGxvd2VkJywgeyBzdGF0dXM6IDQwNSB9KTsKICBjb25zdCBib2R5ID0gYXdhaXQgcmVxdWVzdC5qc29uKCkuY2F0Y2goKCkgPT4gbnVsbCk7CiAgaWYgKCFib2R5KSByZXR1cm4gX2Vycig0MDAsICdJTlZBTElEX0pTT04nLCAnJywgY29yc0hlYWRlcnMpOw=="
$schemaNewB64 = "YXN5bmMgZnVuY3Rpb24gaGFuZGxlR292VGFza1NjaGVtYURyYWZ0KGJvZHlUZXh0LCBlbnYsIGNvcnNIZWFkZXJzKSB7CiAgLy8g4piFIDIwMjYtMDctMTIg7KCV7KCVIOKAlCDrnbzsmrDthLDqsIAg7J2066+4IGJvZHlUZXh0ID0gYXdhaXQgcmVxdWVzdC50ZXh0KCnroZwg67O466y47J2ECiAgLy8g7IaM7KeE7ZWcIOuSpCDsnbQg7ZWo7IiY66W8IO2YuOy2nO2VnOuLpC4gcmVxdWVzdC5qc29uKCnsnYQg64uk7IucIOu2gOultOuptCDsiqTtirjrprzsnbQKICAvLyDsnbTrr7gg67mE7Ja0IOyeiOyWtCDtla3sg4Eg7Iuk7Yyo7ZWc64ukKOyCrOqzoOyLpO2XmOycvOuhnCDrsJzqsqztlZwg7KeE7KecIOybkOyduCkuIGJvZHlUZXh066W8CiAgLy8g7KeB7KCRIO2MjOyLse2VmOuKlCDqsoPsnLzroZwg6rWQ7LK0LgogIGxldCBib2R5ID0gbnVsbDsKICB0cnkgeyBib2R5ID0gSlNPTi5wYXJzZShib2R5VGV4dCk7IH0gY2F0Y2gge30KICBpZiAoIWJvZHkpIHJldHVybiBfZXJyKDQwMCwgJ0lOVkFMSURfSlNPTicsICcnLCBjb3JzSGVhZGVycyk7"
$reviewOldB64 = "YXN5bmMgZnVuY3Rpb24gaGFuZGxlR292VGFza0RyYWZ0UmV2aWV3KHJlcXVlc3QsIGVudiwgY29yc0hlYWRlcnMpIHsKICBjb25zdCBhZG1pbiA9IGF3YWl0IF9yZXF1aXJlQWRtaW4ocmVxdWVzdCwgZW52KTsKICBpZiAoIWFkbWluKSByZXR1cm4gX2Vycig0MDEsICdVTkFVVEhPUklaRUQnLCAnYWRtaW4g7Yag7YGwIO2VhOyalCcsIGNvcnNIZWFkZXJzKTsKICBjb25zdCBib2R5ID0gYXdhaXQgcmVxdWVzdC5qc29uKCkuY2F0Y2goKCkgPT4gbnVsbCk7"
$reviewNewB64 = "YXN5bmMgZnVuY3Rpb24gaGFuZGxlR292VGFza0RyYWZ0UmV2aWV3KHJlcXVlc3QsIGJvZHlUZXh0LCBlbnYsIGNvcnNIZWFkZXJzKSB7CiAgY29uc3QgYWRtaW4gPSBhd2FpdCBfcmVxdWlyZUFkbWluKHJlcXVlc3QsIGVudik7CiAgaWYgKCFhZG1pbikgcmV0dXJuIF9lcnIoNDAxLCAnVU5BVVRIT1JJWkVEJywgJ2FkbWluIO2GoO2BsCDtlYTsmpQnLCBjb3JzSGVhZGVycyk7CiAgLy8g4piFIDIwMjYtMDctMTIg7KCV7KCVIOKAlCBzY2hlbWFEcmFmdOyZgCDrj5nsnbztlZwg7J207Jyg66GcIHJlcXVlc3QuanNvbigpIOuMgOyLoCBib2R5VGV4dCDtjIzsi7EuCiAgbGV0IGJvZHkgPSBudWxsOwogIHRyeSB7IGJvZHkgPSBKU09OLnBhcnNlKGJvZHlUZXh0KTsgfSBjYXRjaCB7fQ=="
$submitOldB64 = "YXN5bmMgZnVuY3Rpb24gaGFuZGxlR292VGFza1N1Ym1pdChyZXF1ZXN0LCBlbnYsIGNvcnNIZWFkZXJzKSB7CiAgaWYgKHJlcXVlc3QubWV0aG9kICE9PSAnUE9TVCcpIHJldHVybiBuZXcgUmVzcG9uc2UoJ01ldGhvZCBOb3QgQWxsb3dlZCcsIHsgc3RhdHVzOiA0MDUgfSk7CgogIGNvbnN0IGJvZHkgPSBhd2FpdCByZXF1ZXN0Lmpzb24oKS5jYXRjaCgoKSA9PiBudWxsKTsKICBpZiAoIWJvZHkpIHJldHVybiBfZXJyKDQwMCwgJ0lOVkFMSURfSlNPTicsICcnLCBjb3JzSGVhZGVycyk7"
$submitNewB64 = "YXN5bmMgZnVuY3Rpb24gaGFuZGxlR292VGFza1N1Ym1pdChib2R5VGV4dCwgZW52LCBjb3JzSGVhZGVycykgewogIC8vIOKYhSAyMDI2LTA3LTEyIOygleyglSDigJQg65287Jqw7YSw6rCAIOydtOuvuCBib2R5VGV4dOuhnCDrs7jrrLjsnYQg7J297Ja064aT7J2AIOuSpCDtmLjstpzrkJjrr4DroZwKICAvLyByZXF1ZXN0Lmpzb24oKeydtCDslYTri4jrnbwgYm9keVRleHTrpbwg7KeB7KCRIO2MjOyLse2VnOuLpChoYW5kbGVHb3ZUYXNrU2NoZW1hRHJhZnTsmYAg64+Z7J28IOybkOyduCkuCiAgbGV0IGJvZHkgPSBudWxsOwogIHRyeSB7IGJvZHkgPSBKU09OLnBhcnNlKGJvZHlUZXh0KTsgfSBjYXRjaCB7fQogIGlmICghYm9keSkgcmV0dXJuIF9lcnIoNDAwLCAnSU5WQUxJRF9KU09OJywgJycsIGNvcnNIZWFkZXJzKTs="

$routeOld = _b64d $routeOldB64
$routeNew = _b64d $routeNewB64
$getRouteOld = _b64d $getRouteOldB64
$getRouteNew = _b64d $getRouteNewB64
$schemaOld = _b64d $schemaOldB64
$schemaNew = _b64d $schemaNewB64
$reviewOld = _b64d $reviewOldB64
$reviewNew = _b64d $reviewNewB64
$submitOld = _b64d $submitOldB64
$submitNew = _b64d $submitNewB64

$replacements = @(
  @{ Name = 'Route table: submit/schema-draft use bodyText, review takes bodyText too'; Old = $routeOld; New = $routeNew },
  @{ Name = 'GET drafts-list route moved before POST-only gate';                        Old = $getRouteOld; New = $getRouteNew },
  @{ Name = 'handleGovTaskSchemaDraft: parse bodyText instead of request.json()';       Old = $schemaOld; New = $schemaNew },
  @{ Name = 'handleGovTaskDraftReview: parse bodyText instead of request.json()';       Old = $reviewOld; New = $reviewNew },
  @{ Name = 'handleGovTaskSubmit: parse bodyText instead of request.json()';            Old = $submitOld; New = $submitNew }
)
$applied = 0
foreach ($r in $replacements) {
  if ($content.Contains($r.Old)) {
    $content = $content.Replace($r.Old, $r.New)
    Write-Host "OK: $($r.Name)"
    $applied++
  } else {
    Write-Warning "NOT FOUND: $($r.Name)"
  }
}
if ($applied -gt 0) {
  [System.IO.File]::WriteAllText((Resolve-Path $path), $content, $encWrite)
  Write-Host "worker.js saved (${applied}/5 blocks applied)"
} else {
  Write-Host "No blocks matched - file left unchanged."
}
