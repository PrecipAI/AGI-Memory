---
name: memory-host-action-execute
description: >
  消费 host-actions 队列，把审批通过的 Rule 落地为 .trae/gates/*.hook.ts（GateMaster 逻辑），
  把审批通过的 Skill 落地为 .trae/skills/*/SKILL.md（Skill Creator 逻辑）。
  审批通过后自动触发，无需用户手动介入。
---

# Memory Host Action Execute

## 触发条件

满足以下任一条件即触发：

1. **审批通过后自动触发** — `memory-governance-review` 中用户 approve 了候选。
2. **批量审批后触发** — 用户一次审批多条规则后，单次 execute 批量生成。
3. **显式触发** — 用户说"生成硬编码""执行落地""消费队列"。

## 执行步骤

1. 调用 `GET /internal/host-actions/pending`，获取待处理的 host-action 列表。
2. 如果队列为空，告知用户"无待处理的 host-action"。
3. 如果队列非空，调用 `POST /internal/host-actions/execute`，传入 `limit`（默认 100）：
   ```
   POST /internal/host-actions/execute
   Body: { "limit": 100 }
   ```
4. 解析返回结果：
   - `succeeded` — 成功生成数量
   - `failed` — 失败数量
   - `items` — 每条 action 的处理结果
5. 向用户汇报：
   ```
   成功生成 N 条硬编码：
   - rule host-rule-xxx → .trae/gates/host-rule-xxx.hook.ts
   - skill memory-lifecycle → .trae/skills/memory-lifecycle/SKILL.md
   ```
6. 验证生成文件是否存在。

## API 调用

```
# 查询待处理
GET /internal/host-actions/pending

# 执行生成
POST /internal/host-actions/execute
Body: { "limit": 100 }

# 更新状态（执行器内部自动调用）
POST /internal/host-actions/{objectType}/{id}/status
Body: { "status": "completed", "output_path": "..." }
```

## 生成产物

| 类型 | 产物路径 | 说明 |
|------|----------|------|
| Rule | `.trae/gates/{rule_key}.hook.ts` | GateMaster 生成的 Hook 文件 |
| Rule | `.trae/gates/types.ts` | 共享类型定义（首次自动创建） |
| Rule | `.trae/gates/registry.json` | Hook 注册表 |
| Skill | `.trae/skills/{skill_key}/SKILL.md` | Skill Creator 生成的技能文件 |

## 注意事项

- `.trae/` 目录是**运行时产物**，已被 `.gitignore` 忽略，不会提交到仓库。
- `types.ts` 在首次生成 hook 时自动创建，已存在则跳过。
- 重复 execute **不会重复生成**（幂等设计）。
- 批量审批后单次 execute 可同时生成多条硬编码。
- 只有 `proposed_action=create_rule` 且审批通过的候选才会进入 host-actions 队列。
