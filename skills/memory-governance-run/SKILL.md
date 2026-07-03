---
name: memory-governance-run
description: >
  [TWO-STEP MCP DANCE — STEP 2] 执行完整治理运行并持久化（写库）。
  必须先调用 memory-extract-preview 拿到 preview_token，然后带着 preview_token + 自己产出的 host_model_result 调用本 skill。
  缺少 preview_token 或 token 过期/无效，请求会被硬拒绝（不进 quarantine，直接报错）。
  包含 L2 冲突检测、L3 演进扫描、L4 认知合成、layer_links 跨层派生写入。
---

# Memory Governance Run (Two-Step Dance — Step 2)

## 触发条件

满足以下任一条件即触发：

1. **用户确认持久化** — 用户在看到 `memory-extract-preview` 的候选后说"存下来""治理一下""持久化"。
2. **完成有价值工作后** — bug 修复完成、新功能上线、解决棘手问题后，即使用户没明确要求，也可主动建议触发。
3. **显式触发** — 用户说"跑一下治理""执行治理运行"。

## 前置条件（硬约束）

**必须先调用 `memory-extract-preview`（Step 1）拿到 `preview_token`。**

如果没有 preview_token，本 skill 会直接报错拒绝，不会进入 quarantine 分支。这是因为：
- governance_mode 默认是 `host_model`，意味着"宿主模型是抽取引擎"
- host_model 模式要求宿主真的做了抽取（产出 host_model_result.extraction_preview）
- preview_token 证明你确实调了 Step 1，不是编的 extraction

## 执行步骤（Two-Step Dance — Step 2）

1. 确定当前宿主类型（trae / codex / qoder / unknown）。
2. 准备请求体，**必须包含**：
   - `governance_mode: "host_model"`（或省略，服务端默认 host_model）
   - `preview_token: "{Step 1 返回的 token_id}"` ← **必填**
   - `host_model_result.extraction_preview: { 你在 Step 1 之后自己产出的候选 }` ← **必填**
3. 调用 `POST /internal/host-capture/{host}/governance-run`。
4. 解析返回结果，向用户汇报：
   - `pipeline.l2` — L2 冲突检测结果：`skipped_count`（重复丢弃）、`merged_count`（合并）、`conflict_proposal_count`（冲突提案）
   - `pipeline.l3` — L3 演进扫描：`signals_count`、`relations_count`
   - `pipeline.l4` — L4 认知合成：`hypotheses_count`、`synthesized_knowledge_ids`
   - `persisted` — 已持久化的 rule/memory/skill/knowledge ID 列表
5. 告知用户："治理运行完成，N 条候选已持久化，其中 M 条进入待审批。"
6. **自动触发** `memory-governance-review` 通知用户审批。

## API 调用

```
POST /internal/host-capture/{host}/governance-run

Headers:
  x-tenant-id: {tenant}
  x-scope: {scope}
  x-trace-id: {trace-id}

Body:
{
  "governance_mode": "host_model",
  "preview_token": "{token_id from Step 1}",       // ← 必填，否则报 PREVIEW_TOKEN_MISSING
  "host_model_result": {                            // ← 必填，否则报 schema 校验失败
    "model_ref": "claude-sonnet-4.5",
    "extraction_preview": {
      "rule_candidates": [...],
      "memory_candidates": [...],
      "skill_proposal_candidates": [...],
      "knowledge_candidates": [...],
      "governance_evidence_candidates": [...],
      "layer_links": [...]
    }
  }
}
```

## 错误处理

| 错误码 | 含义 | 处理 |
|--------|------|------|
| `PREVIEW_TOKEN_MISSING` | 没传 preview_token | 重新调 Step 1 拿 token |
| `PREVIEW_TOKEN_NOT_FOUND` | token 不存在或已被消费 | 重新调 Step 1 拿新 token（token 一次性） |
| `PREVIEW_TOKEN_EXPIRED` | token 超过 10 分钟 | 重新调 Step 1 拿新 token |
| `PREVIEW_TOKEN_CONTEXT_MISMATCH` | token 的 session 上下文对不上 | 重新调 Step 1，确保两步用同一个 session |
| `PREVIEW_TOKEN_PREFIX_VIOLATION` | Step 2 的会话内容不是 Step 1 的超集 | 重新调 Step 1，不要在两步之间替换/删除已有消息 |

遇到上述任一错误，**不要重试当前请求**，必须先重新调 `memory-extract-preview` 拿新 token。

## 注意事项

- 此操作**写库**，会持久化候选数据。
- **preview_token 一次性**：同一个 token 只能用一次，成功后立即失效。
- **不要传 `governance_mode: "rules_fallback"`**：那是调试模式，产出的候选全部进 quarantine（`recall_state='audit_only'`），永远不会被 `memory_retrieve_context` 召回。生产环境必须走 `host_model`。
- **不要直接拿 Step 1 返回的 `extraction_preview` 当 `host_model_result`**：那是规则引擎的兜底产物，质量有限。你应该根据 `mission_brief` 自己阅读会话上下文，产出真正的 typed candidate arrays。
- L2 冲突检测会自动丢弃重复候选（相似度 ≥ 0.96），合并相似候选（0.50-0.96）。
- L4 合成的知识需要满足双重门槛：模型 OOD + 可复用。
- 治理运行完成后应自动触发 `memory-governance-review`。
