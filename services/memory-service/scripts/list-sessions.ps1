$base = 'http://127.0.0.1:3101'

Write-Output "=== 列出所有 Codex 会话（找内容丰富的）==="
$sessions = Invoke-RestMethod -Uri "$base/internal/host-capture/codex/sessions?limit=50" -Method Get -TimeoutSec 10
Write-Output ("会话总数: " + $sessions.items.Count)
Write-Output ""
$sessions.items | ForEach-Object {
  Write-Output ("  " + $_.thread_id + " | " + $_.thread_name + " | " + $_.updated_at)
}

Write-Output ""
Write-Output "=== 预览第一个会话的内容量 ==="
if ($sessions.items.Count -gt 0) {
  $first = $sessions.items[0]
  $body = @{
    codex_home = $null
    thread_id = $first.thread_id
  } | ConvertTo-Json
  $preview = Invoke-RestMethod -Uri "$base/internal/host-capture/codex/preview" -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 30
  Write-Output ("user_messages: " + $preview.raw_inputs.user_messages.Count)
  Write-Output ("commands: " + $preview.raw_inputs.commands.Count)
  Write-Output ("tool_calls: " + $preview.raw_inputs.tool_calls.Count)
  Write-Output ("mcp_calls: " + $preview.raw_inputs.mcp_calls.Count)
  Write-Output ("extraction_preview rules: " + $preview.extraction_preview.rule_candidates.Count)
  Write-Output ("extraction_preview memories: " + $preview.extraction_preview.memory_candidates.Count)
  Write-Output ("extraction_preview skills: " + $preview.extraction_preview.skill_proposal_candidates.Count)
  Write-Output ("extraction_preview knowledge: " + $preview.extraction_preview.knowledge_candidates.Count)
}
