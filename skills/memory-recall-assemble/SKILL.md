---
name: memory-recall-assemble
description: >
  按层装配上下文用于回答前注入。
  调用 memory_retrieve_context MCP 工具，按 rule/memory/skill/knowledge 顺序返回匹配项，带规则约束。
  复杂问题回答前自动触发。
---

# Memory Recall Assemble

## 触发条件

满足以下任一条件即触发：

1. **复杂问题** — 用户提出需要多步推理、跨模块理解的复杂问题。
2. **需要历史上下文** — 用户的问题涉及之前的决策、约定、经验。
3. **自动触发** — 在回答任何非平凡问题前自动触发（可通过配置开关）。

## 执行步骤

1. 从用户问题中提取关键词和意图。
2. 调用 MCP 工具 `memory_retrieve_context`，传入：
   - `query` — 用户问题或关键词
   - `fingerprint_status` — 指纹状态（`matched` / `matched_or_na` / `unknown`）
3. 解析返回结果，按层装配上下文：
   - **Rule 层** — 检查是否有适用的门禁规则（必须遵守的约束）
   - **Memory 层** — 注入相关记忆（事实型知识、项目约定）
   - **Skill 层** — 检查是否有可复用的技能（流程型操作）
   - **Knowledge 层** — 注入合成知识（认知型综合）
4. 将装配的上下文注入到回答 prompt 中。
5. 如果有 Rule 层约束，在回答中遵守（如必须用中文回复）。

## MCP 工具调用

```
memory_retrieve_context({
  query: "用户问题关键词",
  fingerprint_status: "matched_or_na"
})
```

## 注意事项

- Rule 层约束**必须遵守**，优先级最高。
- Memory 层作为参考上下文，当前用户指令和仓库证据优先级更高。
- 如果无匹配结果，正常回答即可，不强注入无关上下文。
- 此 skill 对应 MCP 工具 `memory_retrieve_context`，不需要 HTTP 端点。
