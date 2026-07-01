$base = 'http://127.0.0.1:3101'

Write-Output "=== 1. 列出 Codex 会话 ==="
$sessions = Invoke-RestMethod -Uri "$base/internal/host-capture/codex/sessions?limit=5" -Method Get -TimeoutSec 10
Write-Output ("会话总数: " + $sessions.items.Count)
$sessions.items | Select-Object -First 3 | ForEach-Object {
  Write-Output ("  thread=" + $_.thread_id + " | name=" + $_.thread_name + " | updated=" + $_.updated_at)
}

Write-Output ""
Write-Output "=== 2. 触发 Codex 抽取 + 治理运行 ==="
$body = @{
  codex_home = $null
  max_items = 5
  governance_mode = "rules_fallback"
} | ConvertTo-Json

try {
  $result = Invoke-RestMethod -Uri "$base/internal/host-capture/codex/governance-run" -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 120
  Write-Output "治理运行完成:"
  $result | ConvertTo-Json -Depth 4
} catch {
  Write-Output ("错误: " + $_.Exception.Message)
  if ($_.ErrorDetails) { Write-Output $_.ErrorDetails.Message }
}
