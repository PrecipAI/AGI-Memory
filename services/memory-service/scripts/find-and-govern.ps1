$base = 'http://127.0.0.1:3101'

# 选几个有内容的会话预览
$threads = @(
  @{ id = "019e2ea5-172d-7050-ac2c-854bccb244b3"; name = "电力预测比赛！" },
  @{ id = "019e2e96-112d-7ef1-b9c0-60420883e310"; name = "提升 GitHub Star" },
  @{ id = "019e76f2-7e26-7a81-8d08-d63d5d21a97e"; name = "总结 AI 网关与压缩方案" },
  @{ id = "019e2fc2-38e2-70f3-8134-86067fc6c5b1"; name = "评审纯上下文压缩插件" }
)

$best = $null
$bestScore = 0

foreach ($t in $threads) {
  $body = @{ codex_home = $null; thread_id = $t.id } | ConvertTo-Json
  try {
    $preview = Invoke-RestMethod -Uri "$base/internal/host-capture/codex/preview" -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 30
    $um = $preview.raw_inputs.user_messages.Count
    $tc = $preview.raw_inputs.tool_calls.Count
    $mc = $preview.raw_inputs.mcp_calls.Count
    $cmd = $preview.raw_inputs.commands.Count
    $score = $um + $tc + $mc + $cmd
    Write-Output ("  " + $t.name + " | user_msg=" + $um + " tools=" + $tc + " mcp=" + $mc + " cmds=" + $cmd + " | score=" + $score)
    if ($score -gt $bestScore) {
      $bestScore = $score
      $best = $t
    }
  } catch {
    Write-Output ("  " + $t.name + " | ERROR: " + $_.Exception.Message)
  }
}

Write-Output ""
Write-Output ("最佳会话: " + $best.name + " (score=" + $bestScore + ")")

if ($best -and $bestScore -gt 0) {
  Write-Output ""
  Write-Output "=== 触发治理运行 ==="
  $body = @{
    codex_home = $null
    thread_id = $best.id
    governance_mode = "rules_fallback"
  } | ConvertTo-Json
  $result = Invoke-RestMethod -Uri "$base/internal/host-capture/codex/governance-run" -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 120
  Write-Output ("thread: " + $result.thread_name)
  Write-Output ("task_request_id: " + $result.task_request_id)
  $p = $result.persisted
  Write-Output ("持久化: rule_ids=" + $p.rule_ids.Count + " memory_ids=" + $p.memory_ids.Count + " skill_proposal_ids=" + $p.skill_proposal_ids.Count + " knowledge_ids=" + $p.knowledge_ids.Count + " evidence_ids=" + $p.evidence_ids.Count)
  $a = $result.acceptance_report.governance_candidates
  Write-Output ("候选: rule=" + $a.rule_count + " memory=" + $a.memory_count + " skill=" + $a.skill_proposal_count + " knowledge=" + $a.knowledge_count)
}
