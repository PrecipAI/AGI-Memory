---
name: memory-extract-preview
description: >
  从当前会话历史抽取记忆候选预览（不写库）。
  返回 rule/memory/skill/knowledge 候选 + layer_links 派生关系。
  用于在持久化前先看抽取结果是否合理。
---

# Memory Extract Preview

## 触发条件

满足以下任一条件即触发：

1. **显式记忆信号** — 用户明确表达记忆意图，例如：
   - "记住 XX" / "请记住 XX" / "必须记住"
   - "记下来" / "记一下" / "存起来"
   - "以后别再犯" / "不准再犯"
   - "这个经验要存" / "这个要存" / "给我记住"
   - "别忘了 XX"

   命中显式信号时**必须触发抽取**，无论内容是否像稳定事实；具体落 rule/memory/skill/knowledge 哪一层由内容本身决定。
2. **隐式记忆信号** — 用户完成一段有价值工作（修复 bug、新功能上线、解决棘手问题）后，或长对话末尾自然总结点。
3. **用户主动询问** — 用户问"你学到了什么""总结一下""这次有啥收获"。

普通对话**不触发**，避免误抽取。

## 执行步骤

1. 确定当前宿主类型（trae / codex / qoder / unknown）。
2. 调用 `POST /internal/host-capture/{host}/governance-batch-preview`，传入会话历史。
3. 解析返回结果，向用户展示：
   - `rule_candidates` — 规则候选（门禁型约束）
   - `memory_candidates` — 记忆候选（事实型知识）
   - `skill_proposal_candidates` — 技能候选（流程型操作）
   - `knowledge_candidates` — 知识候选（认知型综合）
   - `layer_links` — 跨层派生关系
4. 告知用户："以上为抽取预览，确认后说『存下来/治理一下/持久化』将执行写库。"

## API 调用

```
POST /internal/host-capture/{host}/governance-batch-preview

Headers:
  x-tenant-id: {tenant}
  x-scope: {scope}
  x-trace-id: {trace-id}

Body:
  { "messages": [...] }   # 会话历史
```

## 注意事项

- 此操作**不写库**，仅返回预览结果。
- 预览结果中的候选需经用户确认后，由 `memory-governance-run` 执行持久化。
- 如果候选为空，告知用户"未抽取到有价值的记忆候选"。
