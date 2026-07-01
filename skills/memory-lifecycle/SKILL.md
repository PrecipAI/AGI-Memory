---
name: memory-lifecycle
description: >
  触发 memory-service 的 lifecycle 维护任务（重算 importance_weight、归档低权重知识、阈值校准）。
  当用户说整理记忆/跑生命周期/清理过期知识时调用。
---

# Memory Lifecycle

## 触发条件

满足以下任一条件即触发：

1. **用户要求整理** — 用户说"整理记忆""跑生命周期""清理过期知识""归档旧记忆"。
2. **定期维护** — 长时间运行后主动建议触发。
3. **显式触发** — 用户说"跑一下 lifecycle""执行维护任务"。

## 执行步骤

1. 调用 `POST /internal/memory/governance/run`，触发 lifecycle worker：
   ```
   POST /internal/memory/governance/run
   Body: { "action": "lifecycle" }
   ```
2. 等待执行完成，解析返回结果。
3. 向用户汇报：
   - 重算了多少条记忆的 `importance_weight`
   - 归档了多少条低权重知识
   - 是否执行了阈值校准
   - 当前知识库总量

## API 调用

```
POST /internal/memory/governance/run

Headers:
  x-tenant-id: {tenant}
  x-scope: {scope}
  x-trace-id: {trace-id}

Body:
  { "action": "lifecycle" }
```

## Lifecycle Worker 执行内容

| 任务 | 说明 |
|------|------|
| 重算 importance_weight | 根据访问频率、时间衰减、引用次数重新计算权重 |
| 归档低权重知识 | importance_weight 低于阈值的记忆标记为 `archived` |
| 阈值校准 | 根据近期数据分布调整 L2 冲突检测阈值 |

## 注意事项

- Lifecycle 运行**不影响** active 状态的记忆，仅处理低权重的。
- 归档后的记忆不会出现在 recall 结果中，但数据仍在数据库中。
- 阈值校准结果写入 `kp_threshold_calibration` 表，L2 检测器会读取并缓存 5 分钟。
