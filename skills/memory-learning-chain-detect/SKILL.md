---
name: memory-learning-chain-detect
description: >
  扫描 tool_call + message 序列，识别 search→learn→apply→summary 学习行为链。
  仅当 isComplete=true 时才允许合成 Knowledge 候选。
  序列后无总结性文本则不硬造 Knowledge（防御原则）。
---

# Memory Learning Chain Detect

## 触发条件

满足以下任一条件即触发：

1. **跨工具检索后应用** — 用户通过多个工具检索信息后，将结论应用到当前任务中。
2. **显式触发** — 用户说"检测一下学习链""看看有没有完整的学习行为"。
3. **治理运行后** — 在 `memory-governance-run` 完成后，自动检测是否有完整学习链。

## 执行步骤

1. 收集会话中的 tool_call 序列和 message 序列。
2. 调用 `POST /internal/learning-chain/detect`，传入：
   - `messages` — 会话消息列表
   - `tool_calls` — 工具调用列表
   - `search_window_minutes` — 搜索窗口（默认 30 分钟）
   - `apply_window_minutes` — 应用窗口（默认 60 分钟）
3. 解析返回结果：
   - `chains` — 检测到的学习链列表
   - 每条链包含：`search_step`（检索）→ `learn_step`（学习）→ `apply_step`（应用）→ `summary_step`（总结）
   - `isComplete` — 链是否完整（缺少 learn/apply/summary 则为 false）
4. 向用户汇报：
   - 完整链："检测到 N 条完整学习行为链，可合成 Knowledge 候选。"
   - 不完整链："检测到 N 条不完整学习链（缺少总结步骤），不合成 Knowledge。"

## API 调用

```
POST /internal/learning-chain/detect

Headers:
  x-tenant-id: {tenant}
  x-scope: {scope}
  x-trace-id: {trace-id}

Body:
  {
    "messages": [...],
    "tool_calls": [...],
    "search_window_minutes": 30,
    "apply_window_minutes": 60
  }
```

## 注意事项

- **防御原则**：序列后无总结性文本则**不硬造 Knowledge**。
- `isComplete=false` 的链只记录不合成。
- 学习链检测使用 30 分钟搜索窗口和 60 分钟应用窗口。
- 检测到完整学习链后，应建议触发 `memory-governance-run` 合成 Knowledge。
