---
name: memory-governance-run
description: >
  执行完整治理运行并持久化（写库）。
  包含 L2 冲突检测、L3 演进扫描、L4 认知合成、layer_links 跨层派生写入。
  用户完成一段有价值工作后触发。
---

# Memory Governance Run

## 触发条件

满足以下任一条件即触发：

1. **用户确认持久化** — 用户在看到 `memory-extract-preview` 的候选后说"存下来""治理一下""持久化"。
2. **完成有价值工作后** — bug 修复完成、新功能上线、解决棘手问题后，即使用户没明确要求，也可主动建议触发。
3. **显式触发** — 用户说"跑一下治理""执行治理运行"。

## 执行步骤

1. 确定当前宿主类型（trae / codex / qoder / unknown）。
2. 调用 `POST /internal/host-capture/{host}/governance-run`，传入会话历史。
3. 解析返回结果，向用户汇报：
   - `pipeline.l2` — L2 冲突检测结果：`skipped_count`（重复丢弃）、`merged_count`（合并）、`conflict_proposal_count`（冲突提案）
   - `pipeline.l3` — L3 演进扫描：`signals_count`、`relations_count`
   - `pipeline.l4` — L4 认知合成：`hypotheses_count`、`synthesized_knowledge_ids`
   - `persisted` — 已持久化的 rule/memory/skill/knowledge ID 列表
4. 告知用户："治理运行完成，N 条候选已持久化，其中 M 条进入待审批。"
5. **自动触发** `memory-governance-review` 通知用户审批。

## API 调用

```
POST /internal/host-capture/{host}/governance-run

Headers:
  x-tenant-id: {tenant}
  x-scope: {scope}
  x-trace-id: {trace-id}

Body:
  { "messages": [...] }   # 会话历史
```

## 注意事项

- 此操作**写库**，会持久化候选数据。
- L2 冲突检测会自动丢弃重复候选（相似度 ≥ 0.96），合并相似候选（0.50-0.96）。
- L4 合成的知识需要满足双重门槛：模型 OOD + 可复用。
- 治理运行完成后应自动触发 `memory-governance-review`。
