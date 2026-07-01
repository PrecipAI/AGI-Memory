---
name: memory-governance-review
description: >
  查询待审批的治理候选并通知用户。
  调用 GET /internal/governance/change-proposals?status=recorded，返回待审批的 L2/L3/L4 候选列表。
  治理运行完成后自动触发，告知用户有 N 条候选待审批。
---

# Memory Governance Review

## 触发条件

满足以下任一条件即触发：

1. **治理运行完成后自动触发** — `memory-governance-run` 执行完毕后。
2. **用户主动询问** — 用户问"有没有待审批的""有什么需要我确认的"。
3. **显式触发** — 用户说"看看审批队列""检查待审批"。

## 执行步骤

1. 调用 `GET /internal/governance/change-proposals?status=recorded&limit=50`，获取待审批候选列表。
2. 如果有 pending 候选，向用户展示：
   ```
   有 N 条候选待审批：
   1. [create_rule] 禁止提交未格式化代码 (rule_key=host-rule-xxx)
      理由: 保持代码风格一致
      操作: approve / reject
   2. [l2_conflict_skip] 检测到重复规则 (similarity=0.98)
      操作: approve / reject
   ```
3. 等待用户回复 `approve` 或 `reject`。
4. 根据用户决策调用 `POST /internal/governance/change-proposals/{id}/actions`：
   ```json
   { "action": "approve", "payload": { "feedback": "同意" } }
   ```
   或
   ```json
   { "action": "reject", "payload": { "feedback": "不需要" } }
   ```
5. 审批通过后，**自动触发** `memory-host-action-execute` 消费 host-actions 队列。

## API 调用

```
# 查询待审批
GET /internal/governance/change-proposals?status=recorded&limit=50

# 审批操作
POST /internal/governance/change-proposals/{proposalId}/actions
Body: { "action": "approve" | "reject", "payload": { "feedback": "..." } }
```

## 注意事项

- 审批历史可通过 `GET /internal/governance/change-proposals?status=resolved&human_decision=approved` 查询。
- 审批历史按 ID 去重，防止重复展示。
- 只有 `proposed_action=create_rule` 的候选审批通过后才会生成 hook 文件。
- `l2_conflict_*` 类型的候选审批后会更新对应冲突状态。
