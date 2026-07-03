---
name: memory-extract-preview
description: >
  [TWO-STEP MCP DANCE — STEP 1] 从当前会话历史抽取记忆候选预览（不写库）。
  返回 rule/memory/skill/knowledge 候选 + layer_links 派生关系 + preview_token。
  preview_token 必须在 Step 2 (memory-governance-run) 中原样带回，否则 Step 2 会被硬拒绝。
---

# Memory Extract Preview (Two-Step Dance — Step 1)

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

## 执行步骤（Two-Step Dance — Step 1）

1. 确定当前宿主类型（trae / codex / qoder / unknown）。
2. 调用 `POST /internal/host-capture/{host}/governance-batch-preview`，传入会话历史。
3. 解析返回结果，重点关注：
   - `mission_brief` — 服务端构建的任务简报，包含 Four-Layer Extraction Protocol 指令
   - `preview_token` — **关键**：Step 2 必须带回 `preview_token.token_id`，否则 Step 2 会被硬拒绝
   - `extraction_preview` — 规则引擎的兜底预览（仅作参考，**不要**直接拿这个当 Step 2 的 host_model_result）
4. **作为抽取引擎**：根据 `mission_brief` 中的 Four-Layer Extraction Protocol，自己阅读完整会话上下文，产出 typed candidate arrays：
   - `rule_candidates` — 规则候选（门禁型约束，IF/THEN 格式）
   - `memory_candidates` — 记忆候选（事实型知识，{symptom, root_cause, fix_action}）
   - `skill_proposal_candidates` — 技能候选（流程型操作）
   - `knowledge_candidates` — 知识候选（认知型综合，需满足 OOD + 可复用双重门槛）
   - `governance_evidence_candidates` — 证据候选（执行痕迹）
   - `layer_links` — 跨层派生关系
5. 向用户展示抽取预览，告知"以上为抽取预览，确认后说『存下来/治理一下/持久化』将执行写库"。
6. **记住 `preview_token.token_id`**，在用户确认后调用 `memory-governance-run` 时必须传入。

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

## 返回结构（关键字段）

```json
{
  "mission_brief": {
    "text": "...",              // Four-Layer Extraction Protocol 指令
    "governance_mode": "host_model"
  },
  "preview_token": {
    "token_id": "uuid",         // ← 必须在 Step 2 原样带回
    "expires_at": "ISO-8601",   // 10 分钟后过期
    "session_fingerprint": "sha256-hex",
    "message_count": 42
  },
  "extraction_preview": {       // 规则引擎兜底预览，仅参考
    "rule_candidates": [],
    "memory_candidates": [],
    ...
  }
}
```

## 注意事项

- 此操作**不写库**，仅返回预览结果 + preview_token。
- **preview_token 10 分钟过期**：如果用户在 Step 1 之后超过 10 分钟才确认，必须重新调用本 skill 拿新 token。
- **preview_token 一次性**：同一个 token 只能用于一次 `memory-governance-run`，不能重复使用。
- **前缀匹配约束**：Step 2 的会话内容必须是 Step 1 的超集（允许追加新消息，不允许替换/删除已有消息）。如果用户在两步之间大幅编辑了会话历史，需要重新调 Step 1。
- 预览结果中的 `extraction_preview` 是规则引擎兜底产物，**质量有限**。真正的抽取应该由你（宿主模型）根据 `mission_brief` 自己完成。
- 如果候选为空，告知用户"未抽取到有价值的记忆候选"。
